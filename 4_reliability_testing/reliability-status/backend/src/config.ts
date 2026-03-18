function cleanEnvValue(value: string | undefined, fallback: string): string {
  const raw = value ?? fallback;
  const noCR = raw.replace(/\r/g, "");

  // Accept quoted env values pasted from dashboards.
  if (
    (noCR.startsWith('"') && noCR.endsWith('"') && noCR.length >= 2) ||
    (noCR.startsWith("'") && noCR.endsWith("'") && noCR.length >= 2)
  ) {
    return noCR.slice(1, -1);
  }

  return noCR;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 15000),
  stationId: cleanEnvValue(process.env.STATION_ID, "reliability_station_1"),
  firestoreProjectId: cleanEnvValue(process.env.FIREBASE_PROJECT_ID, "panahon-live"),
  firestoreApiKey: cleanEnvValue(process.env.FIREBASE_API_KEY, "AIzaSyCDsUNnLZuK8EyBa1XRfKrgxVkykFK-WVg"),
  databasePath: cleanEnvValue(process.env.SQLITE_PATH, "./data/reliability.db"),
  authUsername: cleanEnvValue(process.env.AUTH_USERNAME, "researcher"),
  authPassword: cleanEnvValue(process.env.AUTH_PASSWORD, ""),
  authPasswordHash: cleanEnvValue(process.env.AUTH_PASSWORD_HASH, ""),
  sessionSecret: cleanEnvValue(process.env.SESSION_SECRET, "change-this-secret"),
  sessionTtlSec: Number(process.env.SESSION_TTL_SEC ?? 60 * 60 * 12),
  cookieSecure: cleanEnvValue(process.env.COOKIE_SECURE, "true") === "true",
  expectedPacketIntervalSec: Number(process.env.EXPECTED_PACKET_INTERVAL_SEC ?? 60),
  packetToleranceSec: Number(process.env.PACKET_TOLERANCE_SEC ?? 25),
  maxCsvRows: Number(process.env.MAX_CSV_ROWS ?? 50000)
};
