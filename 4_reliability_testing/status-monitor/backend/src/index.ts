import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import admin from 'firebase-admin';
import { initializeFirebase, getFirestore, getRealtimeDatabase } from './firebase';
import { asBoolean, asNumber, asString, buildStatusReport, formatElapsedLabel, toAgeSeconds } from './report';
import type { HeartbeatSnapshot, ReadingPacket, StatusReport } from './types';

const READINGS_COLLECTION = Bun.env.FIRESTORE_READINGS_COLLECTION?.trim() || 'readings';
const HEARTBEATS_COLLECTION = Bun.env.FIRESTORE_HEARTBEATS_COLLECTION?.trim() || 'heartbeats';
const HEARTBEAT_DOC_ID = Bun.env.FIRESTORE_HEARTBEAT_DOC_ID?.trim() || 'reliability_station_1';
const EXPECTED_PACKET_INTERVAL_SECONDS = Number(Bun.env.EXPECTED_PACKET_INTERVAL_SECONDS ?? '60');
const HEARTBEAT_HISTORY_LIMIT = Number(Bun.env.HEARTBEAT_HISTORY_LIMIT ?? '200');
const STATUS_PATH = Bun.env.RTDB_STATUS_PATH?.trim() || 'status/current';
const HEARTBEAT_HISTORY_PATH = Bun.env.RTDB_HEARTBEAT_HISTORY_PATH?.trim() || 'status/heartbeat-history';
const DATA_DIR = Bun.env.STATUS_DATA_DIR?.trim() || '/data';
const HEARTBEAT_HISTORY_FILE = Bun.env.HEARTBEAT_HISTORY_FILE?.trim() || join(DATA_DIR, 'heartbeat-history.json');
const PORT = Number(Bun.env.PORT ?? '3001');
const MAX_SAMPLE_CLOCK_SKEW_SECONDS = Number(Bun.env.MAX_SAMPLE_CLOCK_SKEW_SECONDS ?? `${90 * 24 * 60 * 60}`);

const firestore = await initializeFirebase().then(() => getFirestore());
const realtimeDb = getRealtimeDatabase();

const readingsById = new Map<string, ReadingPacket>();
let heartbeatHistory: HeartbeatSnapshot[] = [];
let latestReport: StatusReport | null = null;
let publishTimer: ReturnType<typeof setTimeout> | null = null;
let latestHeartbeatFingerprint = '';

function parseFirestoreTimestamp(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }

  return null;
}

function normalizeSampleTimestamp(rawValue: number | null, receivedAtMs: number): number | null {
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
    return null;
  }

  let normalizedSeconds = rawValue;
  if (normalizedSeconds > 100_000_000_000) {
    normalizedSeconds = normalizedSeconds / 1000;
  }

  normalizedSeconds = Math.floor(normalizedSeconds);
  if (normalizedSeconds <= 0) {
    return null;
  }

  const minReasonableEpochSeconds = 946_684_800;
  if (normalizedSeconds < minReasonableEpochSeconds) {
    return null;
  }

  const receivedAtSeconds = Math.floor(receivedAtMs / 1000);
  const skewSeconds = Math.abs(normalizedSeconds - receivedAtSeconds);
  if (Number.isFinite(MAX_SAMPLE_CLOCK_SKEW_SECONDS) && MAX_SAMPLE_CLOCK_SKEW_SECONDS > 0 && skewSeconds > MAX_SAMPLE_CLOCK_SKEW_SECONDS) {
    return null;
  }

  return normalizedSeconds;
}

function normalizeReading(snapshot: admin.firestore.DocumentSnapshot): ReadingPacket {
  const data = snapshot.data() ?? {};
  const rawSampleTimestamp = asNumber(data.ts);
  const createdAt = snapshot.createTime?.toDate() ?? new Date();
  const sampleTimestamp = normalizeSampleTimestamp(rawSampleTimestamp, createdAt.getTime());
  const receivedAt = createdAt.toISOString();
  const elapsedSeconds = toAgeSeconds(createdAt, new Date());

  return {
    id: snapshot.id,
    docPath: snapshot.ref.path,
    sampleTimestamp,
    sampleTimeIso: typeof sampleTimestamp === 'number' && sampleTimestamp > 0 ? new Date(sampleTimestamp * 1000).toISOString() : null,
    receivedAt,
    receivedAtMs: createdAt.getTime(),
    elapsedSeconds,
    elapsedLabel: formatElapsedLabel(elapsedSeconds),
    temperatureC: asNumber(data.t),
    humidityPct: asNumber(data.h),
    battVoltageV: asNumber(data.bv),
    battCurrentA: asNumber(data.bi),
    socPct: asNumber(data.soc),
    battInternalResistanceMohm: asNumber(data.ir),
  };
}

function normalizeHeartbeat(snapshot: admin.firestore.DocumentSnapshot): HeartbeatSnapshot {
  const data = snapshot.data() ?? {};
  const updatedAt = snapshot.updateTime?.toDate() ?? snapshot.createTime?.toDate() ?? new Date();
  const receivedAt = updatedAt.toISOString();
  const elapsedSeconds = toAgeSeconds(updatedAt, new Date());

  return {
    id: snapshot.id,
    docPath: snapshot.ref.path,
    receivedAt,
    receivedAtMs: updatedAt.getTime(),
    elapsedSeconds,
    elapsedLabel: formatElapsedLabel(elapsedSeconds),
    stationId: asString(data.station_id),
    timestamp: parseFirestoreTimestamp(data.timestamp),
    uptimeH: asNumber(data.uptime_h),
    battVoltage: asNumber(data.batt_voltage),
    http2xx: asNumber(data.http_2xx),
    http4xx: asNumber(data.http_4xx),
    http5xx: asNumber(data.http_5xx),
    httpTransport: asNumber(data.http_transport),
    lastHttp: asNumber(data.last_http),
    pendingRows: asNumber(data.pending_rows),
    sdFault: asBoolean(data.sd_fault),
    sdOk: asBoolean(data.sd_ok),
    sdRemountAttempts: asNumber(data.sd_remount_attempts),
    sdRemountSuccess: asNumber(data.sd_remount_success),
    ntpBackoffS: asNumber(data.ntp_backoff_s),
  };
}

async function loadHeartbeatHistory() {
  try {
    const fileText = await readFile(HEARTBEAT_HISTORY_FILE, 'utf8');
    const parsed = JSON.parse(fileText) as HeartbeatSnapshot[];
    if (Array.isArray(parsed)) {
      heartbeatHistory = parsed;
      latestHeartbeatFingerprint = heartbeatHistory.at(-1)
        ? `${heartbeatHistory.at(-1)?.id}:${heartbeatHistory.at(-1)?.receivedAtMs}`
        : '';
    }
  } catch {
    heartbeatHistory = [];
  }
}

async function persistHeartbeatHistory() {
  await mkdir(dirname(HEARTBEAT_HISTORY_FILE), { recursive: true });
  await writeFile(HEARTBEAT_HISTORY_FILE, JSON.stringify(heartbeatHistory, null, 2), 'utf8');
}

function queuePublish() {
  if (publishTimer) {
    clearTimeout(publishTimer);
  }

  publishTimer = setTimeout(() => {
    void publishStatus();
  }, 500);
}

function buildCurrentReport(): StatusReport {
  const readings = [...readingsById.values()];
  return buildStatusReport({
    readings,
    heartbeats: heartbeatHistory,
    expectedPacketIntervalSeconds: EXPECTED_PACKET_INTERVAL_SECONDS,
  });
}

async function publishStatus() {
  latestReport = buildCurrentReport();
  const currentPayload = {
    ...latestReport,
    heartbeatHistoryStored: heartbeatHistory.length,
    heartbeatHistoryTail: heartbeatHistory.slice(-25),
  };

  await Promise.all([
    realtimeDb.ref(STATUS_PATH).set(currentPayload),
    realtimeDb.ref(HEARTBEAT_HISTORY_PATH).set(heartbeatHistory.slice(-HEARTBEAT_HISTORY_LIMIT)),
  ]);

  console.log(
    `[publish] readings=${latestReport.readingsTotal} lost=${latestReport.lostPackets} heartbeats=${latestReport.heartbeatStoredCount}`,
  );
}

async function loadExistingReadings() {
  const snapshot = await firestore.collection(READINGS_COLLECTION).get();
  for (const doc of snapshot.docs) {
    readingsById.set(doc.id, normalizeReading(doc));
  }
  console.log(`[load] readings=${readingsById.size}`);
}

async function loadCurrentHeartbeat() {
  const snapshot = await firestore.collection(HEARTBEATS_COLLECTION).doc(HEARTBEAT_DOC_ID).get();
  if (!snapshot.exists) {
    return;
  }

  const heartbeat = normalizeHeartbeat(snapshot);
  const fingerprint = `${heartbeat.id}:${heartbeat.receivedAtMs}`;
  if (fingerprint !== latestHeartbeatFingerprint) {
    heartbeatHistory.push(heartbeat);
    heartbeatHistory = heartbeatHistory.slice(-HEARTBEAT_HISTORY_LIMIT);
    latestHeartbeatFingerprint = fingerprint;
    await persistHeartbeatHistory();
  }
}

function watchReadings() {
  firestore.collection(READINGS_COLLECTION).onSnapshot((snapshot) => {
    let changed = false;

    for (const change of snapshot.docChanges()) {
      if (change.type === 'removed') {
        changed = readingsById.delete(change.doc.id) || changed;
        continue;
      }

      readingsById.set(change.doc.id, normalizeReading(change.doc));
      changed = true;
    }

    if (changed) {
      queuePublish();
    }
  });
}

function watchHeartbeat() {
  firestore.collection(HEARTBEATS_COLLECTION).doc(HEARTBEAT_DOC_ID).onSnapshot((snapshot) => {
    if (!snapshot.exists) {
      return;
    }

    const heartbeat = normalizeHeartbeat(snapshot);
    const fingerprint = `${heartbeat.id}:${heartbeat.receivedAtMs}`;
    if (fingerprint === latestHeartbeatFingerprint) {
      return;
    }

    latestHeartbeatFingerprint = fingerprint;
    heartbeatHistory.push(heartbeat);
    heartbeatHistory = heartbeatHistory.slice(-HEARTBEAT_HISTORY_LIMIT);
    void persistHeartbeatHistory();
    queuePublish();
  });
}

function serializeReport() {
  return latestReport ?? buildCurrentReport();
}

function startServer() {
  Bun.serve({
    port: PORT,
    fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === '/healthz') {
        return Response.json({ ok: true, readings: readingsById.size, heartbeats: heartbeatHistory.length });
      }

      if (url.pathname === '/report') {
        return Response.json(serializeReport());
      }

      return new Response('Not found', { status: 404 });
    },
  });

  console.log(`[server] listening on ${PORT}`);
}

await loadHeartbeatHistory();
await loadExistingReadings();
await loadCurrentHeartbeat();
await publishStatus();
watchReadings();
watchHeartbeat();
startServer();
