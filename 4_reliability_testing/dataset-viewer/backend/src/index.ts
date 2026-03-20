import { resolve } from 'node:path';
import admin from 'firebase-admin';
import { initializeFirebase, getFirestore } from './firebase';
import type { ReadingPacket } from './types';

const READINGS_COLLECTION = Bun.env.FIRESTORE_READINGS_COLLECTION?.trim() || 'readings';
const PORT = Number(Bun.env.PORT ?? '3002');
const DIST_DIR = resolve(Bun.env.DIST_DIR?.trim() || './dist');
const MAX_SAMPLE_CLOCK_SKEW_SECONDS = Number(Bun.env.MAX_SAMPLE_CLOCK_SKEW_SECONDS ?? `${90 * 24 * 60 * 60}`);

const firestore = await initializeFirebase().then(() => getFirestore());
const readingsById = new Map<string, ReadingPacket>();

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeSampleTimestamp(rawValue: number | null, receivedAtMs: number): number | null {
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) return null;
  let s = rawValue;
  if (s > 100_000_000_000) s = s / 1000;
  s = Math.floor(s);
  if (s <= 0 || s < 946_684_800) return null;
  const skew = Math.abs(s - Math.floor(receivedAtMs / 1000));
  if (skew > MAX_SAMPLE_CLOCK_SKEW_SECONDS) return null;
  return s;
}

function normalizeReading(snapshot: admin.firestore.DocumentSnapshot): ReadingPacket {
  const data = snapshot.data() ?? {};
  const createdAt = snapshot.createTime?.toDate() ?? new Date();
  const rawTs = asNumber(data.ts);
  const sampleTimestamp = normalizeSampleTimestamp(rawTs, createdAt.getTime());

  return {
    id: snapshot.id,
    sampleTimestamp,
    sampleTimeIso: sampleTimestamp !== null ? new Date(sampleTimestamp * 1000).toISOString() : null,
    receivedAt: createdAt.toISOString(),
    receivedAtMs: createdAt.getTime(),
    temperatureC: asNumber(data.t),
    humidityPct: asNumber(data.h),
    battVoltageV: asNumber(data.bv),
    battCurrentA: asNumber(data.bi),
    socPct: asNumber(data.soc),
    battInternalResistanceMohm: asNumber(data.ir),
  };
}

async function loadExistingReadings() {
  const snapshot = await firestore.collection(READINGS_COLLECTION).get();
  for (const doc of snapshot.docs) {
    readingsById.set(doc.id, normalizeReading(doc));
  }
  console.log(`[load] readings=${readingsById.size}`);
}

function watchReadings() {
  firestore.collection(READINGS_COLLECTION).onSnapshot((snapshot) => {
    let changed = false;
    for (const change of snapshot.docChanges()) {
      if (change.type === 'removed') {
        changed = readingsById.delete(change.doc.id) || changed;
      } else {
        readingsById.set(change.doc.id, normalizeReading(change.doc));
        changed = true;
      }
    }
    if (changed) {
      console.log(`[watch] readings=${readingsById.size}`);
    }
  });
}

function getFilteredSorted(from: number | null, to: number | null): ReadingPacket[] {
  const out: ReadingPacket[] = [];
  for (const r of readingsById.values()) {
    const ts = r.sampleTimestamp ?? Math.floor(r.receivedAtMs / 1000);
    if (from !== null && ts < from) continue;
    if (to !== null && ts > to) continue;
    out.push(r);
  }
  out.sort((a, b) => {
    const ats = a.sampleTimestamp ?? Math.floor(a.receivedAtMs / 1000);
    const bts = b.sampleTimestamp ?? Math.floor(b.receivedAtMs / 1000);
    return ats - bts;
  });
  return out;
}

function toCsv(readings: ReadingPacket[]): string {
  const header = 'id,sampleTimestamp,sampleTimeIso,receivedAt,temperatureC,humidityPct,battVoltageV,battCurrentA,socPct,battInternalResistanceMohm';
  const rows = readings.map((r) =>
    [
      r.id,
      r.sampleTimestamp ?? '',
      r.sampleTimeIso ?? '',
      r.receivedAt,
      r.temperatureC ?? '',
      r.humidityPct ?? '',
      r.battVoltageV ?? '',
      r.battCurrentA ?? '',
      r.socPct ?? '',
      r.battInternalResistanceMohm ?? '',
    ].join(','),
  );
  return [header, ...rows].join('\n');
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function serveStatic(pathname: string): Promise<Response | null> {
  try {
    const safePath = resolve(DIST_DIR, '.' + pathname);
    if (!safePath.startsWith(DIST_DIR)) return null;
    const file = Bun.file(safePath);
    if (await file.exists()) return new Response(file);
  } catch {
    // ignore fs errors
  }
  return null;
}

function startServer() {
  Bun.serve({
    port: PORT,
    async fetch(request) {
      const url = new URL(request.url);

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS });
      }

      // Strip optional /api prefix so the same routes work with or without it
      const path = url.pathname.startsWith('/api/')
        ? url.pathname.slice(4)
        : url.pathname;

      if (path === '/healthz') {
        return Response.json({ ok: true, readings: readingsById.size }, { headers: CORS });
      }

      if (path === '/readings' || path === '/readings.csv') {
        const fromParam = url.searchParams.get('from');
        const toParam = url.searchParams.get('to');
        const from = fromParam ? Number(fromParam) : null;
        const to = toParam ? Number(toParam) : null;
        const readings = getFilteredSorted(
          from !== null && Number.isFinite(from) ? from : null,
          to !== null && Number.isFinite(to) ? to : null,
        );

        if (path === '/readings.csv') {
          const filename = `readings_${from ?? 'all'}_${to ?? 'all'}.csv`;
          return new Response(toCsv(readings), {
            headers: {
              ...CORS,
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': `attachment; filename="${filename}"`,
            },
          });
        }

        return Response.json(readings, { headers: CORS });
      }

      // Serve built frontend static files
      const staticRes = await serveStatic(url.pathname);
      if (staticRes) return staticRes;

      // SPA fallback — let the React router handle unknown paths
      const index = Bun.file(`${DIST_DIR}/index.html`);
      if (await index.exists()) return new Response(index);

      return new Response('Not found', { status: 404 });
    },
  });

  console.log(`[server] listening on port ${PORT}`);
}

await loadExistingReadings();
watchReadings();
startServer();
