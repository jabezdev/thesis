export type Reading = {
  ts: number;
  t: number | null;
  h: number | null;
  bv: number | null;
  bi: number | null;
  soc: number | null;
  ir: number | null;
  sourceDoc: string;
  fetchedAt: string;
};

export type Heartbeat = {
  stationId: string;
  timestamp: string | null;
  uptimeH: number | null;
  battVoltage: number | null;
  lastHttp: number | null;
  pendingRows: number | null;
  sdFault: number | null;
  sdOk: number | null;
  fetchedAt: string;
};

export type ChartPoint = {
  bucketTs: number;
  avg: number | null;
  min: number | null;
  max: number | null;
};
