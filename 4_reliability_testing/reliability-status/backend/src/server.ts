import { config } from "./config";
import {
  getChart,
  getCount,
  getLatestHeartbeat,
  getLatestReading,
  getReadingsForCsv,
  getRecentReadings
} from "./db";
import { getPollerStatus, seedLatestNow, startPoller } from "./poller";
import {
  checkRateLimit,
  clearFailedAttempts,
  clearSessionCookie,
  createSessionToken,
  getSessionFromRequest,
  recordFailedAttempt,
  sessionCookie,
  verifyCredentials
} from "./auth";

const METRICS = ["t", "h", "bv", "bi", "soc", "ir"] as const;

type MetricKey = (typeof METRICS)[number];

type LatestEnvelope = {
  latestPacket: {
    ts: number;
    t: number | null;
    h: number | null;
    bv: number | null;
    bi: number | null;
    soc: number | null;
    ir: number | null;
    sourceDoc: string;
    fetchedAt: string;
    packetIso: string;
    packetAgeSec: number;
    elapsedSinceReceivedSec: number | null;
  } | null;
  heartbeat: {
    stationId: string;
    timestamp: string | null;
    uptimeH: number | null;
    battVoltage: number | null;
    lastHttp: number | null;
    pendingRows: number | null;
    sdFault: number | null;
    sdOk: number | null;
    fetchedAt: string;
  } | null;
  anomalies: {
    heartbeatSingleDocMode: true;
    expectedPacketIntervalSec: number;
    packetStale: boolean;
    longPacketGap: boolean;
    cadenceIrregular: boolean;
    heartbeatStale: boolean;
    severity: "ok" | "warn" | "critical";
    flags: string[];
    details: {
      latestGapSec: number | null;
      medianGapSec: number | null;
      maxGapSec: number | null;
      heartbeatAgeSec: number | null;
    };
  };
  poller?: {
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastError: string | null;
    ticks: number;
  };
  backendTimeIso: string;
};

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "content-type",
      ...(init?.headers ?? {})
    }
  });
}

function csv(data: string, filename: string): Response {
  return new Response(data, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store"
    }
  });
}

function text(data: string, init?: ResponseInit): Response {
  return new Response(data, {
    ...init,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...(init?.headers ?? {})
    }
  });
}

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const raw = String(value);
  if (!/[",\n]/.test(raw)) {
    return raw;
  }
  return `"${raw.replaceAll('"', '""')}"`;
}

function parseManilaTimestamp(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2}:\d{2})$/);
  if (!match) {
    return null;
  }

  const parsed = Date.parse(`${match[1]}T${match[2]}+08:00`);
  return Number.isFinite(parsed) ? parsed : null;
}

function detectAnomalies(packetAgeSec: number | null, heartbeatTimestamp: string | null, recentTs: number[]): LatestEnvelope["anomalies"] {
  const expected = config.expectedPacketIntervalSec;
  const tolerance = config.packetToleranceSec;

  const diffs: number[] = [];
  for (let i = 0; i < recentTs.length - 1; i += 1) {
    const diff = recentTs[i] - recentTs[i + 1];
    if (diff > 0) {
      diffs.push(diff);
    }
  }

  const sorted = [...diffs].sort((a, b) => a - b);
  const medianGapSec =
    sorted.length === 0
      ? null
      : sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]
      : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);

  const latestGapSec = diffs.length > 0 ? diffs[0] : null;
  const maxGapSec = diffs.length > 0 ? Math.max(...diffs) : null;

  const heartbeatMs = parseManilaTimestamp(heartbeatTimestamp);
  const heartbeatAgeSec = heartbeatMs ? Math.max(0, Math.floor((Date.now() - heartbeatMs) / 1000)) : null;

  const packetStale = packetAgeSec !== null && packetAgeSec > expected + tolerance;
  const longPacketGap = maxGapSec !== null && maxGapSec > expected * 2 + tolerance;
  const cadenceIrregular =
    medianGapSec !== null && (medianGapSec < Math.max(1, expected - tolerance) || medianGapSec > expected + tolerance);
  const heartbeatStale = heartbeatAgeSec !== null && heartbeatAgeSec > expected * 2 + tolerance;

  const flags: string[] = [];
  if (packetStale) {
    flags.push("packet_stale");
  }
  if (longPacketGap) {
    flags.push("long_packet_gap");
  }
  if (cadenceIrregular) {
    flags.push("cadence_irregular");
  }
  if (heartbeatStale) {
    flags.push("heartbeat_stale");
  }

  let severity: "ok" | "warn" | "critical" = "ok";
  if (packetStale || longPacketGap || heartbeatStale) {
    severity = "critical";
  } else if (cadenceIrregular) {
    severity = "warn";
  }

  return {
    heartbeatSingleDocMode: true,
    expectedPacketIntervalSec: expected,
    packetStale,
    longPacketGap,
    cadenceIrregular,
    heartbeatStale,
    severity,
    flags,
    details: {
      latestGapSec,
      medianGapSec,
      maxGapSec,
      heartbeatAgeSec
    }
  };
}

async function parseJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (!forwarded) {
    return "unknown";
  }
  return forwarded.split(",")[0]?.trim() || "unknown";
}

function buildLatestPayload(): LatestEnvelope {
  const latest = getLatestReading();
  const heartbeat = getLatestHeartbeat(config.stationId);
  const nowMs = Date.now();

  if (!latest) {
    return {
      latestPacket: null,
      heartbeat,
      anomalies: detectAnomalies(null, heartbeat?.timestamp ?? null, []),
      backendTimeIso: new Date(nowMs).toISOString()
    };
  }

  const packetMs = latest.ts * 1000;
  const receivedMs = Date.parse(latest.fetchedAt);
  const packetAgeSec = Math.max(0, Math.floor((nowMs - packetMs) / 1000));
  const elapsedSinceReceivedSec = Number.isFinite(receivedMs)
    ? Math.max(0, Math.floor((nowMs - receivedMs) / 1000))
    : null;

  const recent = getRecentReadings(12);
  const anomalies = detectAnomalies(packetAgeSec, heartbeat?.timestamp ?? null, recent.map((r) => r.ts));

  return {
    latestPacket: {
      ...latest,
      packetIso: new Date(packetMs).toISOString(),
      packetAgeSec,
      elapsedSinceReceivedSec
    },
    heartbeat,
    anomalies,
    backendTimeIso: new Date(nowMs).toISOString()
  };
}

function buildReadingsCsv(hours: number): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const fromTs = nowSec - hours * 3600;
  const rows = getReadingsForCsv(fromTs, config.maxCsvRows);

  const lines = ["ts,packet_iso,fetched_at,t,h,bv,bi,soc,ir,source_doc"];
  for (const row of rows) {
    lines.push(
      [
        row.ts,
        new Date(row.ts * 1000).toISOString(),
        row.fetchedAt,
        row.t,
        row.h,
        row.bv,
        row.bi,
        row.soc,
        row.ir,
        row.sourceDoc
      ]
        .map(escapeCsvValue)
        .join(",")
    );
  }

  return `${lines.join("\n")}\n`;
}

function buildChartsCsv(hours: number, bucketMinutes: number, metricParam: string | null): string {
  const metrics = metricParam && isMetric(metricParam) ? [metricParam] : [...METRICS];

  const lines = ["bucket_ts,bucket_iso,metric,avg,min,max"];
  for (const metric of metrics) {
    const points = getChart(metric, hours, bucketMinutes);
    for (const point of points) {
      lines.push(
        [
          point.bucketTs,
          new Date(point.bucketTs * 1000).toISOString(),
          metric,
          point.avg,
          point.min,
          point.max
        ]
          .map(escapeCsvValue)
          .join(",")
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function isMetric(value: string): value is MetricKey {
  return METRICS.includes(value as MetricKey);
}

if (config.authPassword === "" && config.authPasswordHash === "") {
  console.warn("[SECURITY] AUTH_PASSWORD or AUTH_PASSWORD_HASH is not set. Login will always fail.");
}

if (config.sessionSecret === "change-this-secret") {
  console.warn("[SECURITY] SESSION_SECRET is using default value. Set a strong secret in production.");
}

console.log(
  `[AUTH] user=${config.authUsername.trim().toLowerCase()} mode=${config.authPasswordHash ? "hash_with_plain_fallback" : "plain"}`
);

Bun.serve({
  hostname: "0.0.0.0",
  port: config.port,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return json({}, { status: 204 });
    }

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        readingsStored: getCount(),
        poller: getPollerStatus()
      });
    }

    if (url.pathname === "/api/auth/login" && req.method === "POST") {
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

    if (url.pathname === "/api/auth/logout" && req.method === "POST") {
      return json(
        { ok: true },
        {
          headers: {
            "set-cookie": clearSessionCookie()
          }
        }
      );
    }

    if (url.pathname === "/api/auth/session" && req.method === "GET") {
      const session = getSessionFromRequest(req);
      if (!session) {
        return json({ authenticated: false });
      }
      return json({ authenticated: true, username: session.u });
    }

    if (url.pathname === "/api/latest") {
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

    if (url.pathname === "/api/charts") {
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

      for (const metric of METRICS) {
        payload[metric] = getChart(metric, hours, bucketMinutes);
      }

      return json(payload);
    }

    const session = getSessionFromRequest(req);
    if (!session) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    if (url.pathname === "/api/export/readings.csv") {
      const hours = Math.min(24 * 14, Math.max(1, Number(url.searchParams.get("hours") ?? 24)));
      return csv(buildReadingsCsv(hours), `readings_last_${hours}h.csv`);
    }

    if (url.pathname === "/api/export/charts.csv") {
      const hours = Math.min(24 * 14, Math.max(1, Number(url.searchParams.get("hours") ?? 24)));
      const bucketMinutes = Math.min(60, Math.max(1, Number(url.searchParams.get("bucketMinutes") ?? 5)));
      const metric = url.searchParams.get("metric");
      if (metric && !isMetric(metric)) {
        return text("Unsupported metric\n", { status: 400 });
      }
      return csv(buildChartsCsv(hours, bucketMinutes, metric), `charts_last_${hours}h.csv`);
    }

    return json({ error: "Not found" }, { status: 404 });
  }
});

console.log(`reliability-status backend listening on :${config.port}`);

// Keep API responsive even when Firestore is slow/unreachable.
void startPoller();
