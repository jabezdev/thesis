import { config } from "../config";
import { checkRateLimit, clearFailedAttempts, clearSessionCookie, createSessionToken, getSessionFromRequest, recordFailedAttempt, sessionCookie, verifyCredentials } from "../auth";
import { getChart, getCount, getLatestReading } from "../db";
import { getClientIp, json, parseJson } from "../http";
import { getPollerStatus, seedLatestNow } from "../poller";
import { buildLatestPayload, getMetrics, isMetric } from "../services/payloads";
import { normalizeApiPath } from "./path";

export async function handlePublicRoute(req: Request, url: URL): Promise<Response | null> {
  const path = normalizeApiPath(url.pathname);

  if (path === "/api/health") {
    return json({
      ok: true,
      readingsStored: getCount(),
      poller: getPollerStatus()
    });
  }

  if (path === "/api/auth/login" && req.method === "POST") {
    const ip = getClientIp(req);
    const rate = checkRateLimit(ip);
    if (!rate.allowed) {
      return json(
        { error: "Too many attempts", retryAfterSec: rate.retryAfterSec },
        { status: 429, headers: { "retry-after": String(rate.retryAfterSec) } }
      );
    }

    const body = await parseJson<{ username?: string; password?: string }>(req);
    if (!body?.username || !body?.password) {
      return json({ error: "username and password are required" }, { status: 400 });
    }

    const ok = await verifyCredentials(body.username, body.password);
    if (!ok) {
      recordFailedAttempt(ip);
      return json({ error: "Invalid credentials" }, { status: 401 });
    }

    clearFailedAttempts(ip);
    const token = createSessionToken(body.username);
    return json(
      {
        ok: true,
        username: body.username,
        expiresInSec: config.sessionTtlSec
      },
      {
        headers: {
          "set-cookie": sessionCookie(token)
        }
      }
    );
  }

  if (path === "/api/auth/session" && req.method === "GET") {
    const session = getSessionFromRequest(req);
    if (!session) {
      return json({ authenticated: false });
    }
    return json({ authenticated: true, username: session.u });
  }

  if (path === "/api/auth/logout" && req.method === "POST") {
    return json(
      { ok: true },
      {
        headers: {
          "set-cookie": clearSessionCookie()
        }
      }
    );
  }

  if (path === "/api/latest") {
    if (!getLatestReading()) {
      try {
        await seedLatestNow();
      } catch (error) {
        console.error("/api/latest seed failed", error);
      }
    }

    const payload = buildLatestPayload();
    const poller = getPollerStatus();
    if (!payload.latestPacket) {
      return json({
        ...payload,
        poller: {
          ticks: poller.ticks,
          lastSuccessAt: poller.lastSuccessAt,
          lastErrorAt: poller.lastErrorAt,
          lastError: poller.lastError
        },
        message: "Waiting for first packet"
      });
    }

    return json(payload);
  }

  if (path === "/api/charts") {
    const hours = Math.min(72, Math.max(1, Number(url.searchParams.get("hours") ?? 24)));
    const bucketMinutes = Math.min(30, Math.max(1, Number(url.searchParams.get("bucketMinutes") ?? 5)));

    const metricParam = url.searchParams.get("metric");
    if (metricParam && isMetric(metricParam)) {
      return json({
        metric: metricParam,
        hours,
        bucketMinutes,
        points: getChart(metricParam, hours, bucketMinutes)
      });
    }

    const payload: Record<string, unknown> = {
      hours,
      bucketMinutes
    };

    for (const metric of getMetrics()) {
      payload[metric] = getChart(metric, hours, bucketMinutes);
    }

    return json(payload);
  }

  return null;
}
