import { useState, type FormEvent } from "react";
import { Sparkline } from "./components/Sparkline";
import { StatCard } from "./components/StatCard";
import { useReliabilityDashboard } from "./hooks/useReliabilityDashboard";

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

export default function App() {
  const [tab, setTab] = useState<Tab>("status");
  const {
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
  } = useReliabilityDashboard();

  const anomaly = latest?.anomalies;

  const handleLogin = async (event: FormEvent) => {
    await onLogin(event);
  };

  if (!authChecked) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-xl items-center justify-center px-4 text-slate-100">
        <div className="rounded-2xl border border-slate-700/80 bg-slate-900/60 p-6">Checking session...</div>
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
          {authenticated ? (
            <button onClick={onLogout} className="rounded-lg border border-slate-600 px-3 py-1 text-sm text-slate-200">
              Logout
            </button>
          ) : null}
        </div>
        <p className="mt-2 text-sm text-slate-300">Realtime packet visibility with server-side archived telemetry.</p>
        {bootError ? <p className="mt-2 text-sm text-amber-300">{bootError}</p> : null}
      </header>

      {authenticated ? (
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
      ) : (
        <form
          onSubmit={handleLogin}
          className="mt-3 rounded-2xl border border-slate-700/80 bg-slate-900/60 p-4 shadow-xl"
        >
          <p className="text-xs uppercase tracking-[0.2em] text-sky-300">Restricted Actions</p>
          <p className="mt-1 text-sm text-slate-300">Latest packet and trends are public. Sign in to download CSV files.</p>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm text-slate-300">Username</label>
              <input
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 outline-none focus:border-sky-400"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300">Password</label>
              <input
                type="password"
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 outline-none focus:border-sky-400"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
          </div>

          {loginError ? <p className="mt-3 text-sm text-rose-300">{loginError}</p> : null}

          <button className="mt-4 rounded-xl bg-sky-500 px-4 py-2 font-semibold text-slate-950" type="submit">
            Sign In For Exports
          </button>
        </form>
      )}

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
          {latestError ? (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-950/40 p-3 text-sm text-rose-200">{latestError}</div>
          ) : null}
          {!packet && latest?.message ? (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-950/40 p-3 text-sm text-amber-100">
              <p>{latest.message}</p>
              {latest.poller?.lastError ? (
                <p className="mt-1 text-amber-200/90">
                  Poller error: {latest.poller.lastError}
                  {latest.poller.lastErrorAt ? ` (at ${new Date(latest.poller.lastErrorAt).toLocaleString()})` : ""}
                </p>
              ) : latest.poller?.lastSuccessAt ? (
                <p className="mt-1 text-amber-200/90">Last poller success: {new Date(latest.poller.lastSuccessAt).toLocaleString()}</p>
              ) : (
                <p className="mt-1 text-amber-200/90">Poller has not completed a successful sync yet.</p>
              )}
            </div>
          ) : null}
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
          {chartsError ? (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-950/40 p-3 text-sm text-rose-200">{chartsError}</div>
          ) : null}
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
