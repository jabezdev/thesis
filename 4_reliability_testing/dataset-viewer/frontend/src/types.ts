export interface ReadingPacket {
  id: string;
  sampleTimestamp: number | null;
  sampleTimeIso: string | null;
  receivedAt: string;
  receivedAtMs: number;
  temperatureC: number | null;
  humidityPct: number | null;
  battVoltageV: number | null;
  battCurrentA: number | null;
  socPct: number | null;
  battInternalResistanceMohm: number | null;
}
