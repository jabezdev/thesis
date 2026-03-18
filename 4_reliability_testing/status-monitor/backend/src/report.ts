import type { ChartPacket, HeartbeatSnapshot, ReadingPacket, ReportDiscrepancy, StatusReport } from './types';

export function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    return value === '1' || value.toLowerCase() === 'true';
  }

  return false;
}

export function formatElapsedLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0s';
  }

  const rounded = Math.floor(seconds);

  if (rounded < 60) {
    return `${rounded}s`;
  }

  const minutes = Math.floor(rounded / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

export function toAgeSeconds(date: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
}

export function sortReadings(readings: ReadingPacket[]): ReadingPacket[] {
  return [...readings].sort((left, right) => left.receivedAtMs - right.receivedAtMs || left.id.localeCompare(right.id));
}

function sortReadingsBySampleTimestamp(readings: ReadingPacket[]): ReadingPacket[] {
  return [...readings].sort((left, right) => {
    const leftTimestamp = left.sampleTimestamp ?? Number.POSITIVE_INFINITY;
    const rightTimestamp = right.sampleTimestamp ?? Number.POSITIVE_INFINITY;

    if (leftTimestamp !== rightTimestamp) {
      return leftTimestamp - rightTimestamp;
    }

    return left.receivedAtMs - right.receivedAtMs || left.id.localeCompare(right.id);
  });
}

export function estimatePacketIntervalSeconds(readings: ReadingPacket[], fallbackSeconds: number): number {
  const sorted = sortReadingsBySampleTimestamp(readings);
  const gaps: number[] = [];

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];

    if (previous.sampleTimestamp === null || current.sampleTimestamp === null) {
      continue;
    }

    const gap = current.sampleTimestamp - previous.sampleTimestamp;
    if (Number.isFinite(gap) && gap > 0) {
      gaps.push(gap);
    }
  }

  if (gaps.length === 0) {
    return Math.max(1, Math.floor(fallbackSeconds));
  }

  gaps.sort((left, right) => left - right);
  const middle = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 === 0 ? (gaps[middle - 1] + gaps[middle]) / 2 : gaps[middle];

  return Math.max(1, Math.round(median));
}

export function buildPacketWindow(readings: ReadingPacket[], now: Date): ChartPacket[] {
  return sortReadings(readings)
    .slice(-10)
    .map((reading) => {
      const ageSeconds = toAgeSeconds(new Date(reading.receivedAt), now);

      return {
        label: formatElapsedLabel(ageSeconds),
        ageSeconds,
        temperatureC: reading.temperatureC,
        humidityPct: reading.humidityPct,
        battVoltageV: reading.battVoltageV,
        battCurrentA: reading.battCurrentA,
        socPct: reading.socPct,
        battInternalResistanceMohm: reading.battInternalResistanceMohm,
        receivedAt: reading.receivedAt,
      };
    });
}

export function analyzePackets(readings: ReadingPacket[], expectedIntervalSeconds: number, now: Date): {
  lostPackets: number;
  discrepancies: ReportDiscrepancy[];
} {
  const sorted = sortReadingsBySampleTimestamp(readings);
  const discrepancies: ReportDiscrepancy[] = [];
  let lostPackets = 0;

  for (const reading of sorted) {
    if (reading.sampleTimestamp === null) {
      discrepancies.push({
        kind: 'missing_sample_timestamp',
        message: `Packet ${reading.id} is missing the sample timestamp`,
      });
    }
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous.sampleTimestamp === null || current.sampleTimestamp === null) {
      continue;
    }

    const gapSeconds = Math.max(0, current.sampleTimestamp - previous.sampleTimestamp);
    const expectedGap = Math.max(1, expectedIntervalSeconds);

    if (gapSeconds > expectedGap * 1.5) {
      const missingPackets = Math.max(1, Math.round(gapSeconds / expectedGap) - 1);
      lostPackets += missingPackets;
      discrepancies.push({
        kind: 'arrival_gap',
        message: `Estimated ${missingPackets} missing packet(s) between sample timestamps ${previous.sampleTimestamp} and ${current.sampleTimestamp}`,
        gapSeconds: Math.round(gapSeconds),
        missingPackets,
        fromReceivedAt: previous.receivedAt,
        toReceivedAt: current.receivedAt,
      });
    }

    if (
      previous.sampleTimestamp !== null &&
      current.sampleTimestamp !== null &&
      previous.sampleTimestamp === current.sampleTimestamp
    ) {
      discrepancies.push({
        kind: 'duplicate_sample_timestamp',
        message: `Duplicate sample timestamp ${current.sampleTimestamp} observed in consecutive packets`,
      });
    }
  }

  return { lostPackets, discrepancies };
}

function refreshReadingForNow(reading: ReadingPacket, now: Date): ReadingPacket {
  const elapsedSeconds = toAgeSeconds(new Date(reading.receivedAt), now);

  return {
    ...reading,
    elapsedSeconds,
    elapsedLabel: formatElapsedLabel(elapsedSeconds),
  };
}

function refreshHeartbeatForNow(heartbeat: HeartbeatSnapshot, now: Date): HeartbeatSnapshot {
  const elapsedSeconds = toAgeSeconds(new Date(heartbeat.receivedAt), now);

  return {
    ...heartbeat,
    elapsedSeconds,
    elapsedLabel: formatElapsedLabel(elapsedSeconds),
  };
}

export function buildStatusReport(params: {
  readings: ReadingPacket[];
  heartbeats: HeartbeatSnapshot[];
  now?: Date;
  expectedPacketIntervalSeconds: number;
}): StatusReport {
  const now = params.now ?? new Date();
  const sortedReadings = sortReadings(params.readings);
  const inferredPacketIntervalSeconds = estimatePacketIntervalSeconds(sortedReadings, params.expectedPacketIntervalSeconds);
  const latestReading = sortedReadings.at(-1) ? refreshReadingForNow(sortedReadings.at(-1) as ReadingPacket, now) : null;
  const latestHeartbeat = params.heartbeats.at(-1) ? refreshHeartbeatForNow(params.heartbeats.at(-1) as HeartbeatSnapshot, now) : null;
  const packetWindow = buildPacketWindow(sortedReadings, now);
  const { lostPackets, discrepancies } = analyzePackets(sortedReadings, inferredPacketIntervalSeconds, now);

  return {
    generatedAt: now.toISOString(),
    readingsTotal: sortedReadings.length,
    expectedPacketIntervalSeconds: inferredPacketIntervalSeconds,
    lostPackets,
    discrepancyCount: discrepancies.length,
    discrepancies,
    latestPacket: latestReading,
    packetWindow,
    latestHeartbeat,
    heartbeatStoredCount: params.heartbeats.length,
  };
}
