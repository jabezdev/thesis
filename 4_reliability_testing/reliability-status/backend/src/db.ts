import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { config } from "./config";
import type { ChartPoint, Heartbeat, Reading } from "./types";

const METRICS = ["t", "h", "bv", "bi", "soc", "ir"] as const;
export type MetricKey = (typeof METRICS)[number];

mkdirSync(dirname(config.databasePath), { recursive: true });

const db = new Database(config.databasePath, { create: true });
db.exec("PRAGMA journal_mode=WAL;");
db.exec("PRAGMA synchronous=NORMAL;");

db.exec(`
CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  t REAL,
  h REAL,
  bv REAL,
  bi REAL,
  soc REAL,
  ir REAL,
  source_doc TEXT NOT NULL UNIQUE,
  fetched_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_readings_ts ON readings(ts);

CREATE TABLE IF NOT EXISTS heartbeat (
  station_id TEXT PRIMARY KEY,
  timestamp_text TEXT,
  uptime_h REAL,
  batt_voltage REAL,
  last_http INTEGER,
  pending_rows INTEGER,
  sd_fault INTEGER,
  sd_ok INTEGER,
  fetched_at TEXT NOT NULL
);
`);

const insertReadingStmt = db.prepare(`
  INSERT OR IGNORE INTO readings (ts, t, h, bv, bi, soc, ir, source_doc, fetched_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const upsertHeartbeatStmt = db.prepare(`
  INSERT INTO heartbeat (station_id, timestamp_text, uptime_h, batt_voltage, last_http, pending_rows, sd_fault, sd_ok, fetched_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(station_id) DO UPDATE SET
    timestamp_text = excluded.timestamp_text,
    uptime_h = excluded.uptime_h,
    batt_voltage = excluded.batt_voltage,
    last_http = excluded.last_http,
    pending_rows = excluded.pending_rows,
    sd_fault = excluded.sd_fault,
    sd_ok = excluded.sd_ok,
    fetched_at = excluded.fetched_at
`);

export function insertReading(reading: Reading): void {
  insertReadingStmt.run(
    reading.ts,
    reading.t,
    reading.h,
    reading.bv,
    reading.bi,
    reading.soc,
    reading.ir,
    reading.sourceDoc,
    reading.fetchedAt
  );
}

export function upsertHeartbeat(heartbeat: Heartbeat): void {
  upsertHeartbeatStmt.run(
    heartbeat.stationId,
    heartbeat.timestamp,
    heartbeat.uptimeH,
    heartbeat.battVoltage,
    heartbeat.lastHttp,
    heartbeat.pendingRows,
    heartbeat.sdFault,
    heartbeat.sdOk,
    heartbeat.fetchedAt
  );
}

export function getLastTimestamp(): number | null {
  const row = db.query("SELECT MAX(ts) AS ts FROM readings").get() as { ts: number | null };
  return row.ts;
}

export function getLatestReading(): Reading | null {
  const row = db
    .query(
      `SELECT ts, t, h, bv, bi, soc, ir, source_doc AS sourceDoc, fetched_at AS fetchedAt
       FROM readings
       ORDER BY ts DESC
       LIMIT 1`
    )
    .get() as Reading | null;

  return row;
}

export function getLatestHeartbeat(stationId: string): Heartbeat | null {
  const row = db
    .query(
      `SELECT station_id AS stationId, timestamp_text AS timestamp, uptime_h AS uptimeH,
              batt_voltage AS battVoltage, last_http AS lastHttp, pending_rows AS pendingRows,
              sd_fault AS sdFault, sd_ok AS sdOk, fetched_at AS fetchedAt
       FROM heartbeat
       WHERE station_id = ?`
    )
    .get(stationId) as Heartbeat | null;

  return row;
}

export function getRecentReadings(limit: number): Reading[] {
  return db
    .query(
      `SELECT ts, t, h, bv, bi, soc, ir, source_doc AS sourceDoc, fetched_at AS fetchedAt
       FROM readings
       ORDER BY ts DESC
       LIMIT ?`
    )
    .all(limit) as Reading[];
}

export function getChart(metric: MetricKey, hours: number, bucketMinutes: number): ChartPoint[] {
  if (!METRICS.includes(metric)) {
    throw new Error("Unsupported metric");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const fromTs = nowSec - hours * 3600;
  const bucketSec = Math.max(60, bucketMinutes * 60);

  const rows = db
    .query(
      `SELECT ((ts / ?) * ?) AS bucketTs,
              AVG(${metric}) AS avg,
              MIN(${metric}) AS min,
              MAX(${metric}) AS max
       FROM readings
       WHERE ts >= ?
       GROUP BY bucketTs
       ORDER BY bucketTs ASC`
    )
    .all(bucketSec, bucketSec, fromTs) as ChartPoint[];

  return rows;
}

export function getCount(): number {
  const row = db.query("SELECT COUNT(*) AS count FROM readings").get() as { count: number };
  return row.count;
}

export function getReadingsForCsv(fromTs: number, maxRows: number): Reading[] {
  return db
    .query(
      `SELECT ts, t, h, bv, bi, soc, ir, source_doc AS sourceDoc, fetched_at AS fetchedAt
       FROM readings
       WHERE ts >= ?
       ORDER BY ts ASC
       LIMIT ?`
    )
    .all(fromTs, maxRows) as Reading[];
}
