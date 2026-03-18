import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { fetchCharts, fetchLatest, fetchSession, login, logout } from "../api/reliabilityApi";
import { HttpError } from "../lib/http";
import type { ChartResponse, LatestPacket, LatestResponse } from "../types/api";
import { useInterval } from "./useInterval";

function toApiIssueMessage(status: number, route: string, fallback: string): string {
  if (status === 401 || status === 403) {
    return `API returned Unauthorized for ${route}. Check reverse proxy routing and access policy.`;
  }
  if (status === 404) {
    return `Endpoint ${route} is missing on backend.`;
  }
  if (status === 0) {
    return `Cannot reach ${route}. Check network, upstream target, or backend health.`;
  }
  return `${fallback} (HTTP ${status}).`;
}

export type DashboardState = {
  authChecked: boolean;
  authenticated: boolean;
  bootError: string;
  latestError: string;
  chartsError: string;
  loginError: string;
  latest: LatestResponse | null;
  charts: ChartResponse | null;
  packet: LatestPacket | null;
  elapsedSinceReceive: number | null;
  username: string;
  password: string;
  setUsername: (value: string) => void;
  setPassword: (value: string) => void;
  onLogin: (event: FormEvent) => Promise<void>;
  onLogout: () => Promise<void>;
};

export function useReliabilityDashboard(): DashboardState {
  const [latest, setLatest] = useState<LatestResponse | null>(null);
  const [charts, setCharts] = useState<ChartResponse | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [bootError, setBootError] = useState("");
  const [latestError, setLatestError] = useState("");
  const [chartsError, setChartsError] = useState("");
  const [username, setUsername] = useState("researcher");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [tick, setTick] = useState(Date.now());

  const loadSession = useCallback(async () => {
    try {
      const session = await fetchSession();
      setAuthenticated(session.authenticated);
      setBootError("");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 0;
      setAuthenticated(false);
      setBootError(
        toApiIssueMessage(
          status,
          "/api/auth/session",
          "Unable to read session state from backend"
        )
      );
    } finally {
      setAuthChecked(true);
    }
  }, []);

  const loadLatest = useCallback(async () => {
    try {
      const data = await fetchLatest();
      setLatest(data);
      setLatestError("");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 0;
      setLatestError(toApiIssueMessage(status, "/api/latest", "Unable to fetch latest packet from backend"));
    }
  }, []);

  const loadCharts = useCallback(async () => {
    try {
      const data = await fetchCharts(24, 5);
      setCharts(data);
      setChartsError("");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 0;
      setChartsError(toApiIssueMessage(status, "/api/charts", "Unable to fetch chart aggregates from backend"));
    }
  }, []);

  useEffect(() => {
    void loadSession();
    void loadLatest();
    void loadCharts();
  }, [loadSession, loadLatest, loadCharts]);

  useInterval(() => setTick(Date.now()), 1000);
  useInterval(() => {
    void loadLatest();
  }, 10000);
  useInterval(() => {
    void loadCharts();
  }, 30000);

  const packet = latest?.latestPacket ?? null;

  const elapsedSinceReceive = useMemo(() => {
    if (!packet) {
      return null;
    }

    const receivedMs = Date.parse(packet.fetchedAt);
    if (!Number.isFinite(receivedMs)) {
      return packet.elapsedSinceReceivedSec;
    }

    return Math.floor((tick - receivedMs) / 1000);
  }, [packet, tick]);

  const onLogin = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setLoginError("");

      try {
        await login(username, password);
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 0;
        if (status === 429) {
          setLoginError("Too many attempts. Please wait and try again.");
        } else if (status === 401 || status === 403) {
          setLoginError("Invalid credentials.");
        } else {
          setLoginError("Login failed. Check backend/API routing.");
        }
        return;
      }

      setPassword("");
      setAuthenticated(true);
      setLatest(null);
      setCharts(null);
      await Promise.all([loadLatest(), loadCharts()]);
    },
    [username, password, loadLatest, loadCharts]
  );

  const onLogout = useCallback(async () => {
    try {
      await logout();
    } finally {
      setAuthenticated(false);
      setLatest(null);
      setCharts(null);
    }
  }, []);

  return {
    authChecked,
    authenticated,
    bootError,
    latestError,
    chartsError,
    loginError,
    latest,
    charts,
    packet,
    elapsedSinceReceive,
    username,
    password,
    setUsername,
    setPassword,
    onLogin,
    onLogout
  };
}
