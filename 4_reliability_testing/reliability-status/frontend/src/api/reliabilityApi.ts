import { getJson, postJson, postNoContent } from "../lib/http";
import type { AuthSessionResponse, ChartResponse, LatestResponse } from "../types/api";

export function fetchSession(): Promise<AuthSessionResponse> {
  return getJson<AuthSessionResponse>("/api/auth/session");
}

export function fetchLatest(): Promise<LatestResponse> {
  return getJson<LatestResponse>("/api/latest");
}

export function fetchCharts(hours = 24, bucketMinutes = 5): Promise<ChartResponse> {
  return getJson<ChartResponse>(`/api/charts?hours=${hours}&bucketMinutes=${bucketMinutes}`);
}

export function login(username: string, password: string): Promise<{ ok: boolean; username: string; expiresInSec: number }> {
  return postJson<{ ok: boolean; username: string; expiresInSec: number }>("/api/auth/login", {
    username,
    password
  });
}

export function logout(): Promise<void> {
  return postNoContent("/api/auth/logout");
}
