import { config } from "./config";
import type { Heartbeat, Reading } from "./types";

const base = `https://firestore.googleapis.com/v1/projects/${config.firestoreProjectId}/databases/(default)/documents`;
const FIRESTORE_TIMEOUT_MS = 10000;

type FirestoreDocument = {
  name: string;
  fields?: Record<string, Record<string, string | number | boolean>>;
};

function numFromField(value: Record<string, string | number | boolean> | undefined): number | null {
  if (!value) {
    return null;
  }
  if (value.integerValue !== undefined) {
    return Number(value.integerValue);
  }
  if (value.doubleValue !== undefined) {
    return Number(value.doubleValue);
  }
  return null;
}

function strFromField(value: Record<string, string | number | boolean> | undefined): string | null {
  if (!value) {
    return null;
  }
  if (value.stringValue !== undefined) {
    return String(value.stringValue);
  }
  return null;
}

async function runQuery(payload: unknown): Promise<FirestoreDocument[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FIRESTORE_TIMEOUT_MS);
  const res = await fetch(`${base}:runQuery?key=${config.firestoreApiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: controller.signal
  });
  clearTimeout(timeout);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firestore runQuery failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as Array<{ document?: FirestoreDocument }>;
  return data.map((entry) => entry.document).filter((doc): doc is FirestoreDocument => Boolean(doc));
}

function mapReading(document: FirestoreDocument): Reading | null {
  const fields = document.fields ?? {};
  const ts = numFromField(fields.ts);
  if (ts === null || !Number.isFinite(ts)) {
    return null;
  }

  const docParts = document.name.split("/");
  const sourceDoc = docParts[docParts.length - 1] ?? `reading_${ts}`;

  return {
    ts,
    t: numFromField(fields.t),
    h: numFromField(fields.h),
    bv: numFromField(fields.bv),
    bi: numFromField(fields.bi),
    soc: numFromField(fields.soc),
    ir: numFromField(fields.ir),
    sourceDoc,
    fetchedAt: new Date().toISOString()
  };
}

export async function fetchLatestReading(): Promise<Reading | null> {
  const docs = await runQuery({
    structuredQuery: {
      from: [{ collectionId: "readings" }],
      orderBy: [{ field: { fieldPath: "ts" }, direction: "DESCENDING" }],
      limit: 1
    }
  });

  if (!docs.length) {
    return null;
  }

  return mapReading(docs[0]);
}

export async function fetchReadingsAfter(tsExclusive: number, limit = 100): Promise<Reading[]> {
  const docs = await runQuery({
    structuredQuery: {
      from: [{ collectionId: "readings" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "ts" },
          op: "GREATER_THAN",
          value: { integerValue: String(tsExclusive) }
        }
      },
      orderBy: [{ field: { fieldPath: "ts" }, direction: "ASCENDING" }],
      limit
    }
  });

  return docs.map(mapReading).filter((r): r is Reading => Boolean(r));
}

export async function fetchHeartbeat(): Promise<Heartbeat | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FIRESTORE_TIMEOUT_MS);
  const res = await fetch(`${base}/heartbeats/${config.stationId}?key=${config.firestoreApiKey}`, {
    signal: controller.signal
  });
  clearTimeout(timeout);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Heartbeat fetch failed (${res.status}): ${body}`);
  }

  const doc = (await res.json()) as FirestoreDocument;
  const fields = doc.fields ?? {};

  return {
    stationId: strFromField(fields.station_id) ?? config.stationId,
    timestamp: strFromField(fields.timestamp),
    uptimeH: numFromField(fields.uptime_h),
    battVoltage: numFromField(fields.batt_voltage),
    lastHttp: numFromField(fields.last_http),
    pendingRows: numFromField(fields.pending_rows),
    sdFault: numFromField(fields.sd_fault),
    sdOk: numFromField(fields.sd_ok),
    fetchedAt: new Date().toISOString()
  };
}
