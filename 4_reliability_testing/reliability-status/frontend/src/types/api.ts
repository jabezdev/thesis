export type LatestPacket = {
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

export type LatestResponse = {
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
  message?: string;
  poller?: {
    ticks: number;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastError: string | null;
  };
};

export type ChartPoint = {
  bucketTs: number;
  avg: number | null;
  min: number | null;
  max: number | null;
};

export type ChartResponse = {
  hours: number;
  bucketMinutes: number;
  t: ChartPoint[];
  h: ChartPoint[];
  bv: ChartPoint[];
  bi: ChartPoint[];
  soc: ChartPoint[];
  ir: ChartPoint[];
};

export type AuthSessionResponse = {
  authenticated: boolean;
  username?: string;
};
