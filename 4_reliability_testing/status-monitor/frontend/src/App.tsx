import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { realtimeDb } from './firebase';
import { MetricChart } from './components/MetricChart';
import type { HeartbeatSnapshot, StatusReport } from './types';

const chartConfigs = [
  { title: 'Temperature', subtitle: 'Celsius across the latest 10 packets', key: 'temperatureC', accent: '#6ee7b7', unit: '°C' },
  { title: 'Humidity', subtitle: 'Relative humidity across the latest 10 packets', key: 'humidityPct', accent: '#60a5fa', unit: '%' },
  { title: 'Battery Voltage', subtitle: 'Battery rail voltage trend', key: 'battVoltageV', accent: '#fbbf24', unit: ' V' },
  { title: 'Battery Current', subtitle: 'Battery current trend', key: 'battCurrentA', accent: '#f87171', unit: ' A' },
  { title: 'State of Charge', subtitle: 'Battery charge estimate', key: 'socPct', accent: '#22d3ee', unit: '%' },
  { title: 'Internal Resistance', subtitle: 'Battery internal resistance', key: 'battInternalResistanceMohm', accent: '#a3e635', unit: ' mΩ' },
] as const;

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function formatNumber(value: number | null | undefined, digits = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }

  return value.toFixed(digits);
}

function formatElapsed(receivedAt: string | null | undefined, nowMs: number = Date.now()) {
  if (!receivedAt) {
    return '—';
  }

  const ageSeconds = Math.max(0, Math.floor((nowMs - new Date(receivedAt).getTime()) / 1000));

  if (ageSeconds < 60) {
    return `${ageSeconds}s ago`;
  }

  const minutes = Math.floor(ageSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return '—';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return dateTimeFormatter.format(parsed);
}

function toHeartbeatHistory(value: unknown): HeartbeatSnapshot[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is HeartbeatSnapshot => Boolean(item));
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, HeartbeatSnapshot>).filter((item): item is HeartbeatSnapshot => Boolean(item));
  }

  return [];
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

function HeartbeatTable({ history, nowMs }: { history: HeartbeatSnapshot[]; nowMs: number }) {
  if (history.length === 0) {
    return <p className="empty-state">No heartbeat history has been captured yet.</p>;
  }

  return (
    <div className="history-list">
      {history.slice(-8).reverse().map((heartbeat) => (
        <article className="history-row" key={`${heartbeat.id}-${heartbeat.receivedAtMs}`}>
          <div>
            <strong>{formatDateTime(heartbeat.timestamp ?? heartbeat.receivedAt)}</strong>
            <p>{heartbeat.stationId ?? heartbeat.id}</p>
          </div>
          <div>
            <span>{formatElapsed(heartbeat.receivedAt, nowMs)}</span>
            <small>
              SD {heartbeat.sdOk ? 'OK' : 'FAULT'} · {heartbeat.pendingRows ?? 0} pending
            </small>
          </div>
        </article>
      ))}
    </div>
  );
}

function App() {
  const [report, setReport] = useState<StatusReport | null>(null);
  const [heartbeatHistory, setHeartbeatHistory] = useState<HeartbeatSnapshot[]>([]);
  const [connectionState, setConnectionState] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const currentRef = ref(realtimeDb, 'status/current');
    const historyRef = ref(realtimeDb, 'status/heartbeat-history');

    const unsubscribeCurrent = onValue(
      currentRef,
      (snapshot) => {
        const value = snapshot.val() as StatusReport | null;
        setReport(value);
        setConnectionState('live');
      },
      () => setConnectionState('error'),
    );

    const unsubscribeHistory = onValue(
      historyRef,
      (snapshot) => {
        setHeartbeatHistory(toHeartbeatHistory(snapshot.val()));
      },
      () => setConnectionState('error'),
    );

    return () => {
      unsubscribeCurrent();
      unsubscribeHistory();
    };
  }, []);

  const packetWindow = report?.packetWindow ?? [];
  const latestHeartbeat = heartbeatHistory.at(-1) ?? report?.latestHeartbeat ?? null;
  const latestPacket = report?.latestPacket ?? null;
  const discrepancyItems = report?.discrepancies ?? [];

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="hero panel">
        <div>
          <p className="eyebrow">Reliability Test Monitor</p>
          <h1>Firestore to Realtime Database status view</h1>
          <p className="hero-copy">
            The Bun service ingests Firestore readings, detects packet gaps, stores heartbeat history locally, and publishes the current report into Firebase Realtime Database.
          </p>
          <p className="hero-meta">Last report update: {formatDateTime(report?.generatedAt)}</p>
        </div>

        <div className={`connection-pill ${connectionState}`}>
          <span />
          <strong>{connectionState === 'live' ? 'Connected to RTDB' : connectionState === 'error' ? 'Connection issue' : 'Connecting'}</strong>
        </div>
      </header>

      <section className="stats-grid">
        <StatCard
          label="Total packets"
          value={report ? String(report.readingsTotal) : '—'}
          hint={report ? `Estimated interval ${report.expectedPacketIntervalSeconds}s` : 'Waiting for report'}
        />
        <StatCard
          label="Lost packets"
          value={report ? String(report.lostPackets) : '—'}
          hint={report ? (report.discrepancyCount === 1 ? '1 anomaly tracked' : `${report.discrepancyCount} anomalies tracked`) : 'Waiting for report'}
        />
        <StatCard
          label="Latest packet"
          value={latestPacket ? formatElapsed(latestPacket.receivedAt, nowMs) : '—'}
          hint={latestPacket ? `Sample time ${formatDateTime(latestPacket.sampleTimeIso)}` : 'No packet available'}
        />
        <StatCard
          label="Latest heartbeat"
          value={latestHeartbeat ? formatElapsed(latestHeartbeat.receivedAt, nowMs) : '—'}
          hint={latestHeartbeat ? `${formatDateTime(latestHeartbeat.receivedAt)} · ${heartbeatHistory.length} stored` : 'No heartbeat available'}
        />
      </section>

      <section className="grid split-grid">
        <article className="panel details-panel">
          <div className="panel-heading">
            <div>
              <h2>Latest packet</h2>
              <p>Contents of the most recent reading and the elapsed time since it arrived.</p>
            </div>
            <span className="subtle-chip">{latestPacket ? formatElapsed(latestPacket.receivedAt, nowMs) : 'no packet'}</span>
          </div>

          {latestPacket ? (
            <div className="details-grid">
              <div>
                <span>Temperature</span>
                <strong>{formatNumber(latestPacket.temperatureC)} °C</strong>
              </div>
              <div>
                <span>Humidity</span>
                <strong>{formatNumber(latestPacket.humidityPct)} %</strong>
              </div>
              <div>
                <span>Battery voltage</span>
                <strong>{formatNumber(latestPacket.battVoltageV)} V</strong>
              </div>
              <div>
                <span>Battery current</span>
                <strong>{formatNumber(latestPacket.battCurrentA)} A</strong>
              </div>
              <div>
                <span>State of charge</span>
                <strong>{formatNumber(latestPacket.socPct)} %</strong>
              </div>
              <div>
                <span>Internal resistance</span>
                <strong>{formatNumber(latestPacket.battInternalResistanceMohm)} mΩ</strong>
              </div>
              <div>
                <span>Sample time</span>
                <strong>{formatDateTime(latestPacket.sampleTimeIso)}</strong>
              </div>
              <div>
                <span>Received</span>
                <strong>{formatDateTime(latestPacket.receivedAt)}</strong>
              </div>
            </div>
          ) : (
            <p className="empty-state">No packet has been published yet.</p>
          )}
        </article>

        <article className="panel details-panel">
          <div className="panel-heading">
            <div>
              <h2>Packet anomalies</h2>
              <p>Estimated packet loss and arrival anomalies derived from Firestore upload timing (duplicate packets ignored).</p>
            </div>
            <span className="subtle-chip">{discrepancyItems.length} findings</span>
          </div>

          {discrepancyItems.length > 0 ? (
            <div className="discrepancy-list">
              {discrepancyItems.map((item, index) => (
                <article className="discrepancy-item" key={`${item.kind}-${index}`}>
                  <strong>{item.kind.replaceAll('_', ' ')}</strong>
                  <p>{item.message}</p>
                  {item.fromReceivedAt || item.toReceivedAt ? (
                    <small>
                      {item.fromReceivedAt ? `From ${formatDateTime(item.fromReceivedAt)}` : 'From —'}
                      {item.toReceivedAt ? ` to ${formatDateTime(item.toReceivedAt)}` : ''}
                    </small>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">No discrepancies detected in the current dataset.</p>
          )}
        </article>
      </section>

      <section className="charts-grid">
        {chartConfigs.map((chart) => (
          <MetricChart
            key={chart.key}
            title={chart.title}
            subtitle={chart.subtitle}
            data={packetWindow}
            valueKey={chart.key}
            accent={chart.accent}
            unit={chart.unit}
          />
        ))}
      </section>

      <section className="panel heartbeat-panel">
        <div className="panel-heading">
          <div>
            <h2>Heartbeat stream</h2>
            <p>Latest Firestore heartbeat and the locally stored snapshot history.</p>
          </div>
          <span className="subtle-chip">{latestHeartbeat ? formatElapsed(latestHeartbeat.receivedAt, nowMs) : 'no heartbeat'}</span>
        </div>

        <div className="heartbeat-summary">
          <div>
            <span>Station</span>
            <strong>{latestHeartbeat?.stationId ?? 'n/a'}</strong>
          </div>
          <div>
            <span>Uptime</span>
            <strong>{formatNumber(latestHeartbeat?.uptimeH)} h</strong>
          </div>
          <div>
            <span>Battery</span>
            <strong>{formatNumber(latestHeartbeat?.battVoltage)} V</strong>
          </div>
          <div>
            <span>HTTP 2xx</span>
            <strong>{String(latestHeartbeat?.http2xx ?? '—')}</strong>
          </div>
          <div>
            <span>HTTP 4xx</span>
            <strong>{String(latestHeartbeat?.http4xx ?? '—')}</strong>
          </div>
          <div>
            <span>HTTP 5xx</span>
            <strong>{String(latestHeartbeat?.http5xx ?? '—')}</strong>
          </div>
          <div>
            <span>HTTP transport</span>
            <strong>{String(latestHeartbeat?.httpTransport ?? '—')}</strong>
          </div>
          <div>
            <span>Pending rows</span>
            <strong>{String(latestHeartbeat?.pendingRows ?? '—')}</strong>
          </div>
          <div>
            <span>SD state</span>
            <strong>{latestHeartbeat ? (latestHeartbeat.sdOk ? 'OK' : 'FAULT') : '—'}</strong>
          </div>
          <div>
            <span>Received</span>
            <strong>{formatDateTime(latestHeartbeat?.receivedAt)}</strong>
          </div>
        </div>

        <HeartbeatTable history={heartbeatHistory} nowMs={nowMs} />
      </section>
    </main>
  );
}

export default App;
