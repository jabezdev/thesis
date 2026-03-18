import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Sparkline } from "./components/Sparkline";
import { StatCard } from "./components/StatCard";

type LatestPacket = {
  ts: number;
  t: number | null;
  h: number | null;
  bv: number | null;
  bi: number | null;
  soc: number | null;
  ir: number | null;
  fetchedAt: string;
  packetIso: string;
  packetAgeSec: number;
  elapsedSinceReceivedSec: number | null;
};

type LatestResponse = {
  latestPacket: LatestPacket | null;
  heartbeat: {
    pendingRows: number | null;
    lastHttp: number | null;
    sdFault: number | null;
    sdOk: number | null;
    timestamp: string | null;
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
};

type ChartPoint = {
  bucketTs: number;
  avg: number | null;
  min: number | null;
  max: number | null;
};

type ChartResponse = {
  hours: number;
  bucketMinutes: number;
  t: ChartPoint[];
  h: ChartPoint[];
  bv: ChartPoint[];
  bi: ChartPoint[];
  soc: ChartPoint[];
  ir: ChartPoint[];
};

const metricMeta = [
  { key: "t", label: "Temperature", unit: "C", color: "#f97316" },
  { key: "h", label: "Humidity", unit: "%", color: "#0ea5e9" },
  { key: "bv", label: "Battery Voltage", unit: "V", color: "#22c55e" },
  { key: "bi", label: "Battery Current", unit: "A", color: "#a78bfa" },
  { key: "soc", label: "State of Charge", unit: "%", color: "#facc15" },
  { key: "ir", label: "Battery IR", unit: "mohm", color: "#fb7185" }
] as const;

type Tab = "status" | "charts";

function formatSeconds(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) {
    return "-";
  }
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}h ${m}m ${sec}s`;
  }
  if (m > 0) {
    return `${m}m ${sec}s`;
  }
  return `${sec}s`;
}

function num(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return Number(value).toFixed(digits);
}

async function apiGet<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(path, { credentials: "include", signal: controller.signal });
    if (!res.ok) {
      throw new Error(`${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>("status");
  const [latest, setLatest] = useState<LatestResponse | null>(null);
  const [charts, setCharts] = useState<ChartResponse | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [bootError, setBootError] = useState("");
  const [username, setUsername] = useState("researcher");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [tick, setTick] = useState(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const boot = async () => {
      try {
        const session = await apiGet<{ authenticated: boolean }>("/api/auth/session");
        setAuthenticated(session.authenticated);
        setBootError("");
      } catch (error) {
        const code = (error as Error).message;
        setAuthenticated(false);

        // If backend responds with auth/client codes, connectivity is OK.
        if (code === "401" || code === "403") {
          setBootError("");
          return;
        }

        // Endpoint missing usually means stale backend deploy, not network outage.
        if (code === "404") {
          setBootError("Backend is reachable, but /api/auth/session is missing. Redeploy backend service.");
          return;
        }

        setBootError("Unable to reach backend API through /api. Check Dokploy service routing and backend status.");
      } finally {
        setAuthChecked(true);
      }
    };

    void boot();
  }, []);

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    const fetchLatest = async () => {
      try {
        const data = await apiGet<LatestResponse>("/api/latest");
        setLatest(data);
      } catch (error) {
        const code = (error as Error).message;
        if (code === "401") {
          setAuthenticated(false);
        }
      }
    };

    void fetchLatest();
    const id = window.setInterval(() => {
      void fetchLatest();
    }, 10000);

    return () => clearInterval(id);
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    const fetchCharts = async () => {
      try {
        const data = await apiGet<ChartResponse>("/api/charts?hours=24&bucketMinutes=5");
        setCharts(data);
      } catch (error) {
        const code = (error as Error).message;
        if (code === "401") {
          setAuthenticated(false);
        }
      }
    };

    void fetchCharts();
    const id = window.setInterval(() => {
      void fetchCharts();
    }, 30000);

    return () => clearInterval(id);
  }, [authenticated]);

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

  const anomaly = latest?.anomalies;

  const onLogin = async (event: FormEvent) => {
    event.preventDefault();
    setLoginError("");

    const res = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    if (!res.ok) {
      if (res.status === 429) {
        setLoginError("Too many attempts. Please wait and try again.");
      } else {
        setLoginError("Invalid credentials.");
      }
      return;
    }

    setPassword("");
    setAuthenticated(true);
    setLatest(null);
    setCharts(null);
  };

  const onLogout = async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include"
    });
    setAuthenticated(false);
    setLatest(null);
    setCharts(null);
  };

  if (!authChecked) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-xl items-center justify-center px-4 text-slate-100">
        <div className="rounded-2xl border border-slate-700/80 bg-slate-900/60 p-6">Checking session...</div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-xl items-center justify-center px-4 text-slate-100">
        <form onSubmit={onLogin} className="w-full rounded-3xl border border-slate-700/80 bg-slate-900/60 p-6 shadow-2xl">
          <p className="text-xs uppercase tracking-[0.2em] text-sky-300">Secure Access</p>
          <h1 className="mt-1 text-2xl font-black">Reliability Status Login</h1>
          <p className="mt-2 text-sm text-slate-300">This dashboard is restricted to the research team.</p>

          <label className="mt-4 block text-sm text-slate-300">Username</label>
          <input
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 outline-none focus:border-sky-400"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />

          <label className="mt-3 block text-sm text-slate-300">Password</label>
          <input
            type="password"
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 outline-none focus:border-sky-400"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />

          {loginError ? <p className="mt-3 text-sm text-rose-300">{loginError}</p> : null}
          {bootError ? <p className="mt-2 text-sm text-amber-300">{bootError}</p> : null}

          <button className="mt-4 w-full rounded-xl bg-sky-500 px-4 py-2 font-semibold text-slate-950" type="submit">
            Sign In
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 pb-6 pt-4 text-slate-100">
      <header className="rounded-3xl border border-slate-700/80 bg-slate-900/55 p-4 shadow-xl shadow-black/30 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-sky-300">Project Sipat Banwa</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-white">Reliability Status</h1>
          </div>
          <button onClick={onLogout} className="rounded-lg border border-slate-600 px-3 py-1 text-sm text-slate-200">
            Logout
          </button>
        </div>
        <p className="mt-2 text-sm text-slate-300">Realtime packet visibility with server-side archived telemetry.</p>
      </header>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <a
          href="/api/export/readings.csv?hours=24"
          className="rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-center text-sm text-slate-200"
        >
          Export Readings CSV
        </a>
        <a
          href="/api/export/charts.csv?hours=24&bucketMinutes=5"
          className="rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-center text-sm text-slate-200"
        >
          Export Charts CSV
        </a>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-950/40 p-1">
        <button
          className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
            tab === "status" ? "bg-sky-500 text-slate-950" : "bg-transparent text-slate-200"
          }`}
          onClick={() => setTab("status")}
        >
          Latest Packet
        </button>
        <button
          className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
            tab === "charts" ? "bg-sky-500 text-slate-950" : "bg-transparent text-slate-200"
          }`}
          onClick={() => setTab("charts")}
        >
          Trends
        </button>
      </div>

      {tab === "status" ? (
        <section className="mt-4 space-y-3">
          <StatCard
            label="Anomaly Status"
            value={(anomaly?.severity ?? "ok").toUpperCase()}
            note={
              anomaly?.flags.length
                ? `Flags: ${anomaly.flags.join(", ")}`
                : "No active anomaly flags. Heartbeat uses one mutable document by design."
            }
          />
          <StatCard
            label="Packet Timestamp"
            value={packet ? new Date(packet.packetIso).toLocaleString() : "Waiting for packet"}
            note="From firmware ts field"
          />
          <StatCard
            label="Received By Backend"
            value={packet ? new Date(packet.fetchedAt).toLocaleString() : "-"}
            note={`Elapsed since received: ${formatSeconds(elapsedSinceReceive)}`}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="Temperature" value={`${num(packet?.t)} C`} />
            <StatCard label="Humidity" value={`${num(packet?.h)} %`} />
            <StatCard label="Battery Voltage" value={`${num(packet?.bv)} V`} />
            <StatCard label="Battery Current" value={`${num(packet?.bi, 3)} A`} />
            <StatCard label="SOC" value={`${num(packet?.soc, 1)} %`} />
            <StatCard label="Battery IR" value={`${num(packet?.ir, 2)} mohm`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Packet Age" value={formatSeconds(packet?.packetAgeSec ?? null)} />
            <StatCard
              label="Heartbeat"
              value={latest?.heartbeat?.timestamp ?? "No heartbeat yet"}
              note={`HTTP ${latest?.heartbeat?.lastHttp ?? "-"} | Pending ${latest?.heartbeat?.pendingRows ?? "-"}`}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Latest Gap" value={`${num(anomaly?.details.latestGapSec, 0)} s`} />
            <StatCard label="Median Gap" value={`${num(anomaly?.details.medianGapSec, 0)} s`} />
            <StatCard label="Max Gap" value={`${num(anomaly?.details.maxGapSec, 0)} s`} />
            <StatCard label="Heartbeat Age" value={`${num(anomaly?.details.heartbeatAgeSec, 0)} s`} />
          </div>
        </section>
      ) : (
        <section className="mt-4 space-y-3">
          <p className="text-sm text-slate-300">
            Showing pre-aggregated averages for the last {charts?.hours ?? 24} hours in {charts?.bucketMinutes ?? 5}-minute buckets.
          </p>
          {metricMeta.map((metric) => {
            const points = charts?.[metric.key] ?? [];
            const values = points.map((p) => p.avg);
            const latestValue = values.length ? values[values.length - 1] : null;

            return (
              <div key={metric.key} className="rounded-2xl border border-slate-700/80 bg-slate-900/55 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-100">{metric.label}</p>
                  <p className="text-sm text-slate-300">
                    {num(latestValue, metric.key === "bi" ? 3 : 2)} {metric.unit}
                  </p>
                </div>
                <Sparkline values={values} stroke={metric.color} />
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
