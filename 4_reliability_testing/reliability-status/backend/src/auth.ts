import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";

type SessionPayload = {
  u: string;
  exp: number;
};

type AttemptBucket = {
  count: number;
  resetAt: number;
};

const COOKIE_NAME = "rs_session";
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const attempts = new Map<string, AttemptBucket>();

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(input: string): string {
  return createHmac("sha256", config.sessionSecret).update(input).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export async function verifyCredentials(username: string, password: string): Promise<boolean> {
  const normalizedInputUser = username.trim().toLowerCase();
  const normalizedConfigUser = config.authUsername.trim().toLowerCase();

  if (!safeEqual(normalizedInputUser, normalizedConfigUser)) {
    return false;
  }

  if (config.authPasswordHash) {
    return Bun.password.verify(password, config.authPasswordHash);
  }

  if (!config.authPassword) {
    return false;
  }

  return safeEqual(password, config.authPassword);
}

export function createSessionToken(username: string): string {
  const payload: SessionPayload = {
    u: username,
    exp: Math.floor(Date.now() / 1000) + config.sessionTtlSec
  };

  const serialized = JSON.stringify(payload);
  const encoded = b64url(serialized);
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  const parts = cookieHeader.split(";");
  const entries: Array<[string, string]> = [];

  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    const key = p.slice(0, idx).trim();
    const value = p.slice(idx + 1).trim();
    entries.push([key, value]);
  }

  return Object.fromEntries(entries);
}

export function validateSessionToken(token: string | undefined): SessionPayload | null {
  if (!token) {
    return null;
  }

  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) {
    return null;
  }

  const expected = sign(encoded);
  if (!safeEqual(signature, expected)) {
    return null;
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }

  if (!payload.u || !payload.exp) {
    return null;
  }

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

export function sessionCookie(token: string): string {
  const secure = config.cookieSecure ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${config.sessionTtlSec}${secure}`;
}

export function clearSessionCookie(): string {
  const secure = config.cookieSecure ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export function getSessionFromRequest(req: Request): SessionPayload | null {
  const cookies = parseCookies(req.headers.get("cookie"));
  return validateSessionToken(cookies[COOKIE_NAME]);
}

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const found = attempts.get(ip);

  if (!found || now >= found.resetAt) {
    attempts.set(ip, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (found.count >= LOGIN_MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSec: Math.ceil((found.resetAt - now) / 1000) };
  }

  return { allowed: true, retryAfterSec: 0 };
}

export function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const found = attempts.get(ip);
  if (!found || now >= found.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  found.count += 1;
}

export function clearFailedAttempts(ip: string): void {
  attempts.delete(ip);
}
