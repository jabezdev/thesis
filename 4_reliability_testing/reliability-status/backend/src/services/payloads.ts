import { config } from "../config";
import {
  getChart,
  getLatestHeartbeat,
  getLatestReading,
  getReadingsForCsv,
  getRecentReadings
} from "../db";

const METRICS = ["t", "h", "bv", "bi", "soc", "ir"] as const;

export type MetricKey = (typeof METRICS)[number];

export type LatestEnvelope = {
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

export function buildLatestPayload(): LatestEnvelope {
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

export function buildReadingsCsv(hours: number): string {
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

export function buildChartsCsv(hours: number, bucketMinutes: number, metricParam: string | null): string {
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

export function isMetric(value: string): value is MetricKey {
  return METRICS.includes(value as MetricKey);
}

export function getMetrics(): readonly MetricKey[] {
  return METRICS;
}
