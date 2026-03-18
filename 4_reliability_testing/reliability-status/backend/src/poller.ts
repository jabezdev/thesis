import { config } from "./config";
import { fetchHeartbeat, fetchLatestReading, fetchReadingsAfter } from "./firestore";
import { getLastTimestamp, insertReading, upsertHeartbeat } from "./db";

let cursorTs: number | null = null;
let running = false;

type PollerStatus = {
  startedAt: string;
  running: boolean;
  cursorTs: number | null;
  ticks: number;
  totalInserted: number;
  lastTickAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
};

const pollerStatus: PollerStatus = {
  startedAt: new Date().toISOString(),
  running: false,
  cursorTs: null,
  ticks: 0,
  totalInserted: 0,
  lastTickAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function bootstrapCursor(): Promise<void> {
  const fromDb = getLastTimestamp();
  if (fromDb !== null) {
    cursorTs = fromDb;
    pollerStatus.cursorTs = cursorTs;
    return;
  }

  // Start from the most recent packet to avoid ingesting old history.
  const latest = await fetchLatestReading();
  if (!latest) {
    console.warn("[POLLER] No readings available yet in Firestore.");
    return;
  }

  insertReading(latest);
  pollerStatus.totalInserted += 1;
  cursorTs = latest.ts;
  pollerStatus.cursorTs = cursorTs;
  console.log(`[POLLER] Bootstrapped cursor at ts=${cursorTs}.`);
}

async function ingestNewReadings(): Promise<void> {
  if (cursorTs === null) {
    await bootstrapCursor();
    return;
  }

  const newest = await fetchReadingsAfter(cursorTs, 100);
  if (!newest.length) {
    return;
  }

  for (const item of newest) {
    insertReading(item);
  }

  pollerStatus.totalInserted += newest.length;

  cursorTs = newest[newest.length - 1].ts;
  pollerStatus.cursorTs = cursorTs;
}

async function syncHeartbeat(): Promise<void> {
  const hb = await fetchHeartbeat();
  if (hb) {
    upsertHeartbeat(hb);
  }
}

async function tick(): Promise<void> {
  if (running) {
    return;
  }

  pollerStatus.ticks += 1;
  pollerStatus.lastTickAt = new Date().toISOString();
  running = true;
  pollerStatus.running = true;
  try {
    await ingestNewReadings();
    await syncHeartbeat();
    pollerStatus.lastSuccessAt = new Date().toISOString();
    pollerStatus.lastError = null;
    pollerStatus.lastErrorAt = null;
  } catch (error) {
    console.error("poller tick failed", error);
    pollerStatus.lastError = errorMessage(error);
    pollerStatus.lastErrorAt = new Date().toISOString();
  } finally {
    running = false;
    pollerStatus.running = false;
  }
}

export function getPollerStatus(): PollerStatus {
  return {
    ...pollerStatus,
    running,
    cursorTs
  };
}

export async function seedLatestNow(): Promise<{ seededPacket: boolean; syncedHeartbeat: boolean }> {
  let seededPacket = false;
  let syncedHeartbeat = false;

  const latest = await fetchLatestReading();
  if (latest) {
    insertReading(latest);
    if (cursorTs === null || latest.ts > cursorTs) {
      cursorTs = latest.ts;
      pollerStatus.cursorTs = cursorTs;
    }
    pollerStatus.totalInserted += 1;
    seededPacket = true;
  }

  const hb = await fetchHeartbeat();
  if (hb) {
    upsertHeartbeat(hb);
    syncedHeartbeat = true;
  }

  if (seededPacket || syncedHeartbeat) {
    pollerStatus.lastSuccessAt = new Date().toISOString();
    pollerStatus.lastError = null;
    pollerStatus.lastErrorAt = null;
  }

  return { seededPacket, syncedHeartbeat };
}

export async function startPoller(): Promise<void> {
  console.log(`[POLLER] Starting (interval=${config.pollIntervalMs}ms).`);
  await tick();
  setInterval(() => {
    void tick();
  }, config.pollIntervalMs);
}
