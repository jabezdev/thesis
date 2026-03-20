import { useState, useCallback, useMemo } from 'react';
import type { ReadingPacket } from './types';
import { UPlotChart } from './components/UPlotChart';

const API_BASE = '/api';

const PAGE_SIZE = 100;

const CHART_CONFIGS = [
  { title: 'Temperature', subtitle: 'Celsius (°C)', key: 'temperatureC' as const, accent: '#6ee7b7' },
  { title: 'Humidity', subtitle: 'Relative humidity (%)', key: 'humidityPct' as const, accent: '#60a5fa' },
  { title: 'Battery Voltage', subtitle: 'Volts (V)', key: 'battVoltageV' as const, accent: '#fbbf24' },
  { title: 'Battery Current', subtitle: 'Amperes (A)', key: 'battCurrentA' as const, accent: '#f87171' },
  { title: 'State of Charge', subtitle: 'Percentage (%)', key: 'socPct' as const, accent: '#22d3ee' },
  { title: 'Internal Resistance', subtitle: 'Milliohms (mΩ)', key: 'battInternalResistanceMohm' as const, accent: '#a3e635' },
] as const;

function toLocalDatetime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtTs(ts: number | undefined | null): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString();
}

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

function App() {
  const [fromDate, setFromDate] = useState(() => toLocalDatetime(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const [toDate, setToDate] = useState(() => toLocalDatetime(Date.now()));
  const [readings, setReadings] = useState<ReadingPacket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);
  const [page, setPage] = useState(0);

  const fromTs = useMemo(() => {
    if (!fromDate) return null;
    const t = new Date(fromDate).getTime();
    return Number.isNaN(t) ? null : Math.floor(t / 1000);
  }, [fromDate]);

  const toTs = useMemo(() => {
    if (!toDate) return null;
    const t = new Date(toDate).getTime();
    return Number.isNaN(t) ? null : Math.floor(t / 1000);
  }, [toDate]);

  const buildParams = useCallback(
    () => {
      const p = new URLSearchParams();
      if (fromTs !== null) p.set('from', String(fromTs));
      if (toTs !== null) p.set('to', String(toTs));
      return p;
    },
    [fromTs, toTs],
  );

  const fetchReadings = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPage(0);
    try {
      const res = await fetch(`${API_BASE}/readings?${buildParams()}`);
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
      const data = (await res.json()) as ReadingPacket[];
      setReadings(data);
      setFetched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  function applyPreset(hours: number | null) {
    const now = Date.now();
    setToDate(toLocalDatetime(now));
    setFromDate(hours === null ? '' : toLocalDatetime(now - hours * 60 * 60 * 1000));
  }

  const timestamps = useMemo(
    () => readings.map((r) => r.sampleTimestamp ?? Math.floor(r.receivedAtMs / 1000)),
    [readings],
  );

  const csvHref = useMemo(() => `${API_BASE}/readings.csv?${buildParams()}`, [buildParams]);

  const firstTs = readings[0]?.sampleTimestamp;
  const lastTs = readings[readings.length - 1]?.sampleTimestamp;
  const spanHours = firstTs && lastTs && lastTs > firstTs
    ? ((lastTs - firstTs) / 3600).toFixed(1)
    : null;
  const avgIntervalS =
    readings.length > 1 && firstTs && lastTs
      ? Math.round((lastTs - firstTs) / (readings.length - 1))
      : null;

  const totalPages = Math.max(1, Math.ceil(readings.length / PAGE_SIZE));
  const pageRows = readings.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="hero panel">
        <div>
          <p className="eyebrow">Project Sipat Banwa</p>
          <h1>Dataset Viewer</h1>
          <p className="hero-copy">
            Browse, filter, and export the complete Firestore readings dataset. Select a date range, load the data,
            and explore it via charts or raw table view.
          </p>
        </div>
      </header>

      {/* ── Filter bar ─────────────────────────────────────────── */}
      <section className="filter-panel panel">
        <div className="filter-row">
          <div className="filter-group">
            <label htmlFor="from-date">From</label>
            <input
              id="from-date"
              type="datetime-local"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          <div className="filter-group">
            <label htmlFor="to-date">To</label>
            <input
              id="to-date"
              type="datetime-local"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" onClick={() => void fetchReadings()} disabled={loading}>
            {loading ? 'Loading…' : 'Load data'}
          </button>
          {fetched && (
            <a href={csvHref} download className="btn btn-outline">
              Download CSV
            </a>
          )}
        </div>

        <div className="preset-row">
          <span>Quick range:</span>
          {[
            { label: 'Last hour', hours: 1 },
            { label: 'Last 24 h', hours: 24 },
            { label: 'Last 7 days', hours: 24 * 7 },
            { label: 'Last 30 days', hours: 24 * 30 },
            { label: 'All time', hours: null },
          ].map(({ label, hours }) => (
            <button key={label} className="btn btn-ghost" onClick={() => applyPreset(hours)}>
              {label}
            </button>
          ))}
        </div>

        {error && <p className="error-msg">Error: {error}</p>}
      </section>

      {/* ── Results ─────────────────────────────────────────────── */}
      {!fetched && !loading && (
        <section className="panel empty-panel">
          <p>Select a date range and click <strong>Load data</strong> to get started.</p>
        </section>
      )}

      {fetched && (
        <>
          {/* Stat cards */}
          <section className="stats-grid">
            <StatCard
              label="Readings loaded"
              value={String(readings.length)}
              hint={spanHours ? `${spanHours} h span` : undefined}
            />
            <StatCard label="First sample" value={fmtTs(firstTs)} />
            <StatCard label="Last sample" value={fmtTs(lastTs)} />
            <StatCard
              label="Avg interval"
              value={avgIntervalS !== null ? `~${avgIntervalS} s` : '—'}
              hint="between consecutive samples"
            />
          </section>

          {/* Charts */}
          <section className="charts-grid">
            {CHART_CONFIGS.map((cfg) => (
              <UPlotChart
                key={cfg.key}
                title={cfg.title}
                subtitle={cfg.subtitle}
                accent={cfg.accent}
                timestamps={timestamps}
                values={readings.map((r) => r[cfg.key])}
              />
            ))}
          </section>

          {/* Data table */}
          <section className="panel table-panel">
            <div className="table-header">
              <div>
                <h2>Raw data</h2>
                <p className="table-meta">
                  {readings.length.toLocaleString()} readings · page {page + 1} of {totalPages}
                </p>
              </div>
              <div className="pagination">
                <button
                  className="btn btn-ghost"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  ← Prev
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                >
                  Next →
                </button>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Sample time</th>
                    <th>Temp (°C)</th>
                    <th>Humidity (%)</th>
                    <th>Voltage (V)</th>
                    <th>Current (A)</th>
                    <th>SOC (%)</th>
                    <th>Resistance (mΩ)</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.sampleTimeIso ? new Date(r.sampleTimeIso).toLocaleString() : r.receivedAt}</td>
                      <td>{fmtNum(r.temperatureC)}</td>
                      <td>{fmtNum(r.humidityPct)}</td>
                      <td>{fmtNum(r.battVoltageV, 3)}</td>
                      <td>{fmtNum(r.battCurrentA, 3)}</td>
                      <td>{fmtNum(r.socPct, 1)}</td>
                      <td>{fmtNum(r.battInternalResistanceMohm, 1)}</td>
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="table-empty">No readings in this range.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

export default App;
