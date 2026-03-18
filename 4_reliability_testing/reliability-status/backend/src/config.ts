export const config = {
  port: Number(process.env.PORT ?? 3000),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 15000),
  stationId: process.env.STATION_ID ?? "reliability_station_1",
  firestoreProjectId: process.env.FIREBASE_PROJECT_ID ?? "panahon-live",
  firestoreApiKey: process.env.FIREBASE_API_KEY ?? "AIzaSyCDsUNnLZuK8EyBa1XRfKrgxVkykFK-WVg",
  databasePath: process.env.SQLITE_PATH ?? "./data/reliability.db",
  authUsername: process.env.AUTH_USERNAME ?? "researcher",
  authPassword: process.env.AUTH_PASSWORD ?? "",
  authPasswordHash: process.env.AUTH_PASSWORD_HASH ?? "",
  sessionSecret: process.env.SESSION_SECRET ?? "change-this-secret",
  sessionTtlSec: Number(process.env.SESSION_TTL_SEC ?? 60 * 60 * 12),
  cookieSecure: (process.env.COOKIE_SECURE ?? "true") === "true",
  expectedPacketIntervalSec: Number(process.env.EXPECTED_PACKET_INTERVAL_SEC ?? 60),
  packetToleranceSec: Number(process.env.PACKET_TOLERANCE_SEC ?? 25),
  maxCsvRows: Number(process.env.MAX_CSV_ROWS ?? 50000)
};
