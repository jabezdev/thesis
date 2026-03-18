export interface PacketWindowPoint {
  label: string;
  ageSeconds: number;
  temperatureC: number | null;
  humidityPct: number | null;
  battVoltageV: number | null;
  battCurrentA: number | null;
  socPct: number | null;
  battInternalResistanceMohm: number | null;
  receivedAt: string;
}

export interface ReadingPacket {
  id: string;
  docPath: string;
  sampleTimestamp: number | null;
  sampleTimeIso: string | null;
  receivedAt: string;
  receivedAtMs: number;
  elapsedSeconds: number;
  elapsedLabel: string;
  temperatureC: number | null;
  humidityPct: number | null;
  battVoltageV: number | null;
  battCurrentA: number | null;
  socPct: number | null;
  battInternalResistanceMohm: number | null;
}

export interface HeartbeatSnapshot {
  id: string;
  docPath: string;
  receivedAt: string;
  receivedAtMs: number;
  elapsedSeconds: number;
  elapsedLabel: string;
  stationId: string | null;
  timestamp: string | null;
  uptimeH: number | null;
  battVoltage: number | null;
  http2xx: number | null;
  http4xx: number | null;
  http5xx: number | null;
  httpTransport: number | null;
  lastHttp: number | null;
  pendingRows: number | null;
  sdFault: boolean;
  sdOk: boolean;
  sdRemountAttempts: number | null;
  sdRemountSuccess: number | null;
  ntpBackoffS: number | null;
}

export interface ReportDiscrepancy {
  kind: string;
  message: string;
  gapSeconds?: number;
  missingPackets?: number;
  fromReceivedAt?: string;
  toReceivedAt?: string;
}

export interface StatusReport {
  generatedAt: string;
  readingsTotal: number;
  expectedPacketIntervalSeconds: number;
  lostPackets: number;
  discrepancyCount: number;
  discrepancies: ReportDiscrepancy[];
  latestPacket: ReadingPacket | null;
  packetWindow: PacketWindowPoint[];
  latestHeartbeat: HeartbeatSnapshot | null;
  heartbeatStoredCount: number;
  heartbeatHistoryStored?: number;
  heartbeatHistoryTail?: HeartbeatSnapshot[];
}
