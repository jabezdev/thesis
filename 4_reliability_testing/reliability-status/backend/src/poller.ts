import { config } from "./config";
import { fetchHeartbeat, fetchLatestReading, fetchReadingsAfter } from "./firestore";
import { getLastTimestamp, insertReading, upsertHeartbeat } from "./db";

let cursorTs: number | null = null;
let running = false;

async function bootstrapCursor(): Promise<void> {
  const fromDb = getLastTimestamp();
  if (fromDb !== null) {
    cursorTs = fromDb;
    return;
  }

  // Start from the most recent packet to avoid ingesting old history.
  const latest = await fetchLatestReading();
  if (!latest) {
    return;
  }

  insertReading(latest);
  cursorTs = latest.ts;
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

  cursorTs = newest[newest.length - 1].ts;
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
  running = true;
  try {
    await ingestNewReadings();
    await syncHeartbeat();
  } catch (error) {
    console.error("poller tick failed", error);
  } finally {
    running = false;
  }
}

export async function startPoller(): Promise<void> {
  await tick();
  setInterval(() => {
    void tick();
  }, config.pollIntervalMs);
}
