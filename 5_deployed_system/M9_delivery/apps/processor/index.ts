import { db, rtdb, getLastProcessedCursor, setLastProcessedCursor } from './firebase';
import { RawSensorData, applyCalibration, DEFAULT_CALIBRATION } from '@panahon/shared';
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

/**
 * @panahonProcessor - Core Service
 */

const RAW_COLLECTIONS = ['node_data_0v3'];
const NORMALIZED_COLLECTION = 'm6_node_data';
const DAILY_COLLECTION = 'm6_daily_records';
const MANILA_TZ = 'Asia/Manila';

// Initialize Convex Client
// VITE_CONVEX_URL is used locally; CONVEX_URL is the plain name set on the VPS
const convexUrl = (process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL ?? '').replace(/\/$/, "");
if (!convexUrl) throw new Error('[Processor] Missing CONVEX_URL env var. Set it in the VPS environment.');
const convex = new ConvexHttpClient(convexUrl);

// Tracks the last processed sample time per node in memory to calculate gaps
const lastNodeSampleMap: Record<string, number> = {};
const nodeMetaCache = new Map<string, any>();

function heatIndex(t: number, rh: number): number | null {
  if (t < 27 || rh < 40) return null;
  return (
    -8.78469475556 + 1.61139411 * t + 2.33854883889 * rh
    - 0.14611605 * t * rh - 0.012308094 * t * t
    - 0.0164248277778 * rh * rh + 0.002211732 * t * t * rh
    + 0.00072546 * t * rh * rh - 0.000003582 * t * t * rh * rh
  );
}

function manilaDayKey(epoch: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MANILA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epoch));
}

function dayBoundsUtcIso(dayKey: string): { startIso: string; endIso: string } {
  const start = new Date(`${dayKey}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

type MetricAgg = {
  min: number | null;
  max: number | null;
  avg: number | null;
  count: number;
  sum: number;
  min_ts: string | null;
  max_ts: string | null;
};

function emptyAgg(): MetricAgg {
  return { min: null, max: null, avg: null, count: 0, sum: 0, min_ts: null, max_ts: null };
}

function pushAgg(agg: MetricAgg, value: number | null, ts: string): void {
  if (value == null || !Number.isFinite(value)) return;
  if (agg.min == null || value < agg.min) {
    agg.min = value;
    agg.min_ts = ts;
  }
  if (agg.max == null || value > agg.max) {
    agg.max = value;
    agg.max_ts = ts;
  }
  agg.count += 1;
  agg.sum += value;
  agg.avg = agg.sum / agg.count;
}

function normalizeAgg(agg: MetricAgg): MetricAgg {
  const count = Number.isInteger(agg.count) && agg.count > 0 ? agg.count : 0;
  const min = agg.min != null && Number.isFinite(agg.min) ? agg.min : null;
  const max = agg.max != null && Number.isFinite(agg.max) ? agg.max : null;
  const sum = Number.isFinite(agg.sum) ? agg.sum : 0;
  const avg = count > 0 ? (Number.isFinite(sum / count) ? (sum / count) : null) : null;
  return {
    min,
    max,
    avg,
    count,
    sum,
    min_ts: agg.min_ts ?? null,
    max_ts: agg.max_ts ?? null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientFirestoreError(err: any): boolean {
  const code = String(err?.code ?? '').toLowerCase();
  const msg = String(err?.message ?? '').toLowerCase();
  return (
    code === 'aborted' ||
    code === 'unavailable' ||
    code === 'deadline-exceeded' ||
    code === 'resource-exhausted' ||
    msg.includes('deadline exceeded') ||
    msg.includes('unavailable') ||
    msg.includes('resource exhausted')
  );
}

async function recomputeDailyRollup(nodeId: string, dayKey: string) {
  const { startIso, endIso } = dayBoundsUtcIso(dayKey);
  const snap = await db.collection(NORMALIZED_COLLECTION)
    .where('ts', '>=', startIso)
    .where('ts', '<', endIso)
    .orderBy('ts', 'asc')
    .limit(20000)
    .get();

  const calibration = nodeMetaCache.get(nodeId)?.calibration ?? DEFAULT_CALIBRATION;
  const tempAgg = emptyAgg();
  const humAgg = emptyAgg();
  const rainAgg = emptyAgg();
  const hiAgg = emptyAgg();

  for (const doc of snap.docs) {
    const d = doc.data() as any;
    if (d.node_id !== nodeId) continue;
    if (d.is_placeholder) continue;
    if (d.temp == null || d.hum == null || d.rain == null || !d.ts) continue;

    const raw: RawSensorData = {
      ts: d.ts,
      node_id: d.node_id,
      uptime_ms: d.uptime_ms ?? 0,
      temp: d.temp,
      hum: d.hum,
      rain: d.rain,
      batt_v: d.batt_v ?? 0,
      batt_i: d.batt_i ?? 0,
      solar_v: d.solar_v ?? 0,
      solar_i: d.solar_i ?? 0,
      samples: d.samples ?? 0,
      processed_at: d.processed_at,
    };

    const corrected = applyCalibration(raw, calibration);
    const hi = heatIndex(corrected.temp_corrected, corrected.hum_corrected) ?? corrected.temp_corrected;

    pushAgg(tempAgg, corrected.temp_corrected, d.ts);
    pushAgg(humAgg, corrected.hum_corrected, d.ts);
    pushAgg(rainAgg, corrected.rain_corrected, d.ts);
    pushAgg(hiAgg, hi, d.ts);
  }

  const temp = normalizeAgg(tempAgg);
  const hum = normalizeAgg(humAgg);
  const rain = normalizeAgg(rainAgg);
  const hi = normalizeAgg(hiAgg);

  const payload = {
    node_id: nodeId,
    day_key: dayKey,
    timezone: MANILA_TZ,
    day_start_utc: startIso,
    day_end_utc: new Date(new Date(endIso).getTime() - 1).toISOString(),
    metrics: {
      temp_corrected: temp,
      hum_corrected: hum,
      rain_corrected: rain,
      hi,
    },
    updated_at: new Date().toISOString(),
  };

  const docRef = db.collection(DAILY_COLLECTION).doc(`${nodeId}_${dayKey}`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await docRef.set(payload, { merge: true });
      return;
    } catch (err: any) {
      const code = err?.code ?? 'unknown';
      const message = err?.message ?? String(err);
      const transient = isTransientFirestoreError(err);
      if (!transient || attempt === 3) {
        console.error(`[Rollup] Failed write for ${nodeId} ${dayKey} after ${attempt} attempt(s). code=${code}`, message);
        throw err;
      }
      const backoffMs = attempt * 1000;
      console.warn(`[Rollup] Transient write failure for ${nodeId} ${dayKey}. Retrying in ${backoffMs}ms...`);
      await sleep(backoffMs);
    }
  }
}

async function recomputeTouchedDailyRollups(nodeId: string, samples: any[]) {
  const touched = new Set<string>();
  for (const sample of samples) {
    const epoch = new Date(sample.ts).getTime();
    if (!Number.isNaN(epoch)) touched.add(manilaDayKey(epoch));
  }
  for (const key of touched) {
    try {
      await recomputeDailyRollup(nodeId, key);
    } catch (err: any) {
      console.error(`[Rollup] Skipping failed touched-day rollup for node=${nodeId} day=${key}:`, err?.message ?? err);
    }
  }
}

async function recomputeRecentDailyRollupsForAllNodes(days = 7) {
  const nodeIds = Array.from(nodeMetaCache.keys());
  if (!nodeIds.length) return;
  const dayKeys = Array.from({ length: days }, (_, i) => manilaDayKey(Date.now() - i * 24 * 60 * 60 * 1000));

  for (const nodeId of nodeIds) {
    for (const dayKey of dayKeys) {
      try {
        await recomputeDailyRollup(nodeId, dayKey);
      } catch (err: any) {
        console.error(`[Rollup] Skipping failed recent rollup for node=${nodeId} day=${dayKey}:`, err?.message ?? err);
      }
    }
  }
}

export async function syncConvexMetadata() {
  console.log('[Sync] Fetching node metadata from Convex...');
  try {
    const nodes = await convex.query(api.nodes.list);
    const registry: string[] = [];
    for (const node of nodes) {
      registry.push(node.node_id);
      const thresholds = node.alert_thresholds ?? { high_temp: 40, heavy_rain: 5 };
      nodeMetaCache.set(node.node_id, { calibration: node.calibration, alert_thresholds: thresholds });
      await rtdb.ref(`nodes/${node.node_id}/metadata`).set({
        name: node.name,
        location: node.location,
        calibration: node.calibration,
        status: node.status,
        alert_thresholds: thresholds,
        last_sync: new Date().toISOString()
      });
    }
    await rtdb.ref('registry/nodes').set(registry);
    console.log(`[Sync] Successfully synchronized ${nodes.length} nodes and registry to RTDB.`);
  } catch (err) {
    console.error('[Sync] Error syncing metadata:', err);
  }
}

async function processBatch(docId: string, data: any) {
  const nodeId = data.node_id;
  const history: any[] = data.history.map((h: any) => ({
    ts: h.ts.stringValue || h.ts,
    uptime_ms: parseInt(h.uptime_ms?.integerValue ?? h.uptime_ms ?? "0"),
    temp: parseFloat(h.temp?.doubleValue ?? h.temp ?? "0"),
    hum: parseFloat(h.hum?.doubleValue ?? h.hum ?? "0"),
    rain: parseFloat(h.rain?.doubleValue ?? h.rain ?? "0"),
    batt_v: parseFloat(h.batt_v?.doubleValue ?? h.batt_v ?? "0"),
    batt_i: parseFloat(h.batt_i?.doubleValue ?? h.batt_i ?? "0"),
    solar_v: parseFloat(h.solar_v?.doubleValue ?? h.solar_v ?? "0"),
    solar_i: parseFloat(h.solar_i?.doubleValue ?? h.solar_i ?? "0"),
    samples: parseInt(h.samples?.integerValue ?? h.samples ?? "0"),
  }));

  // Sort chronologically ascending
  history.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const realSamplesForRollup: any[] = [];

  let batch = db.batch();
  let opCount = 0;

  const commitBatchIfNeeded = async () => {
    if (opCount >= 450) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
  };

  // Recover state if node timeline is unknown (e.g. processor reboot limit)
  if (!lastNodeSampleMap[nodeId]) {
    const dbLast = await db.collection(NORMALIZED_COLLECTION)
      .where('node_id', '==', nodeId)
      .orderBy('ts', 'desc')
      .limit(1)
      .get();
    if (!dbLast.empty) {
      lastNodeSampleMap[nodeId] = new Date(dbLast.docs[0].data().ts).getTime();
    }
  }

  for (const sample of history) {
    const currentEpoch = new Date(sample.ts).getTime();

    // Check for gaps greater than 90 seconds (1.5 minutes) and fill with placeholders
    if (lastNodeSampleMap[nodeId] && (currentEpoch - lastNodeSampleMap[nodeId] > 90000)) {
      const delta = currentEpoch - lastNodeSampleMap[nodeId];
      // Number of missing minutes to insert (minus 1 to bracket it against the current valid sample)
      let missingCount = Math.floor(delta / 60000) - 1;

      // Absolute sanity cap to prevent memory exhaustion if timestamp gets corrupted (e.g. year 2099 glitch)
      // Caps placeholder insertion to ~3 days maximum per single batch jump.
      if (missingCount > 4320) missingCount = 4320;

      for (let i = 1; i <= missingCount; i++) {
        const gapEpoch = lastNodeSampleMap[nodeId] + (i * 60000);
        // Align gap timestamp purely to minute-level boundary visually
        const gapDate = new Date(gapEpoch);
        gapDate.setSeconds(0, 0);

        const gapIsoString = gapDate.toISOString();
        const placeholder = {
          node_id: nodeId,
          ts: gapIsoString,
          uptime_ms: null,
          temp: null,
          hum: null,
          rain: null,
          batt_v: null,
          batt_i: null,
          solar_v: null,
          solar_i: null,
          samples: null,
          is_placeholder: true,
          processed_at: new Date().toISOString()
        };

        const tsKey = placeholder.ts.replace(/[: ]/g, '-');
        const docRef = db.collection(NORMALIZED_COLLECTION).doc(`${nodeId}_${tsKey}`);
        batch.set(docRef, placeholder);
        opCount++;
        await commitBatchIfNeeded();
      }
    }

    // Process the actual legitimate sample
    const tsKey = sample.ts.replace(/[: ]/g, '-');
    const docRef = db.collection(NORMALIZED_COLLECTION).doc(`${nodeId}_${tsKey}`);
    batch.set(docRef, { ...sample, node_id: nodeId, processed_at: new Date().toISOString() });
    realSamplesForRollup.push(sample);
    opCount++;
    await commitBatchIfNeeded();

    // Update Realtime DB (Last Hour list) normally
    rtdb.ref(`nodes/${nodeId}/last_hour/${currentEpoch}`).set(sample);

    // Slide timeline forward only if it is chronologically newer
    if (!lastNodeSampleMap[nodeId] || currentEpoch > lastNodeSampleMap[nodeId]) {
      lastNodeSampleMap[nodeId] = currentEpoch;
    }
  }

  // Update Latest (RTDB) using ONLY real valid samples (non-placeholder)
  if (history.length > 0) {
    const last = history[history.length - 1];
    rtdb.ref(`nodes/${nodeId}/latest`).set(last);
  }

  if (opCount > 0) {
    await batch.commit();
  }

  // Recompute exact daily rollups for touched days from normalized data.
  // This keeps aggregates consistent even when processor retries or restarts.
  if (realSamplesForRollup.length > 0) {
    await recomputeTouchedDailyRollups(nodeId, realSamplesForRollup);
  }

  console.log(`[Processor] Processed ${history.length} raw samples from doc: ${docId}`);
}

async function startProcessor() {
  console.log('--- Panahon Live Telemetry Processor Starting ---');

  // ── HTTP /sync endpoint ─────────────────────────────────────────────
  const SYNC_PORT = parseInt(process.env.SYNC_PORT || '3001');
  const SYNC_SECRET = process.env.PROCESSOR_SYNC_SECRET || '';

  // Use Bun's native HTTP server (types come from @types/bun or bun itself)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Bun?.serve({
    port: SYNC_PORT,
    async fetch(req: Request) {
      const url = new URL(req.url);
      if (req.method === 'POST' && url.pathname === '/sync') {
        if (SYNC_SECRET && req.headers.get('x-sync-secret') !== SYNC_SECRET) {
          return new Response('Unauthorized', { status: 401 });
        }
        console.log('[HTTP /sync] Immediate sync triggered.');

        let body: any = {};
        try { body = await req.json(); } catch { /* no body is fine */ }

        // If the mutation passed calibration data directly, write it to RTDB immediately
        // so Public/Status pages receive the update within this HTTP round-trip.
        if (body.nodeId && body.calibration) {
          try {
            await rtdb.ref(`nodes/${body.nodeId}/metadata/calibration`).set(body.calibration);
            nodeMetaCache.set(body.nodeId, {
              ...nodeMetaCache.get(body.nodeId),
              calibration: body.calibration,
            });
            console.log(`[HTTP /sync] Wrote calibration for ${body.nodeId} directly to RTDB.`);
          } catch (err) {
            console.error('[HTTP /sync] Failed to write calibration to RTDB:', err);
          }
        }

        // Full metadata sync runs in the background for all other fields/nodes.
        syncConvexMetadata().catch(console.error);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    },
  });
  console.log(`[HTTP] Sync endpoint listening on port ${SYNC_PORT}`);

  // Initial Sync
  await syncConvexMetadata();
  try {
    await recomputeRecentDailyRollupsForAllNodes(7);
  } catch (err: any) {
    console.error('[Rollup] Initial recent rollup pass failed:', err?.message ?? err);
  }
  // Periodic Sync every 5 minutes
  setInterval(async () => {
    try {
      await syncConvexMetadata();
      await recomputeRecentDailyRollupsForAllNodes(7);
    } catch (err: any) {
      console.error('[Sync] Periodic sync/recompute failed:', err?.message ?? err);
    }
  }, 5 * 60 * 1000);

  try {
    console.log('[Processor] Calling getLastProcessedCursor()...');
    const { ts: lastTs, str: lastStr } = await getLastProcessedCursor();
    const resolvedLastTs = lastTs || 0;
    console.log(`[Processor] Resuming from timestamp: ${new Date(resolvedLastTs).toISOString()} (Cursor string: ${lastStr})`);

    // 1. Initial Migration (Backfill)
    for (const collectionName of RAW_COLLECTIONS) {
      console.log(`[Processor] Querying ${collectionName} for backfill...`);
      let hasMore = true;
      let lastDocSnap: any = null;
      let totalProcessed = 0;

      while (hasMore) {
        let query = db.collection(collectionName)
          .orderBy('timestamp', 'asc')
          .limit(100); // Process in chunks to be safe

        if (lastDocSnap) {
          query = query.startAfter(lastDocSnap);
        } else if (lastStr) {
          query = query.where('timestamp', '>', lastStr);
        } else if (resolvedLastTs > 0) {
          query = query.where('timestamp', '>', new Date(resolvedLastTs).toISOString());
        }

        const snapshot = await query.get();

        if (!snapshot.empty) {
          console.log(`[Processor] Backfilling chunk of ${snapshot.size} raw documents from ${collectionName}...`);
          for (const doc of snapshot.docs) {
            await processBatch(doc.id, doc.data());
            const rawTimestamp = doc.data().timestamp;

            let docTs = 0;
            if (rawTimestamp && typeof rawTimestamp.toDate === 'function') {
              docTs = rawTimestamp.toDate().getTime();
            } else if (rawTimestamp) {
              let isoish = String(rawTimestamp).replace(' ', 'T');
              docTs = new Date(isoish).getTime();
            }

            if (!isNaN(docTs) && docTs > 0) {
              await setLastProcessedCursor(docTs, typeof rawTimestamp === 'string' ? rawTimestamp : null);
            }
          }
          totalProcessed += snapshot.size;
          lastDocSnap = snapshot.docs[snapshot.docs.length - 1];
        } else {
          hasMore = false;
          console.log(`[Processor] Backfill complete for ${collectionName}. Processed ${totalProcessed} new docs.`);
        }
      }
    }
  } catch (e) {
    console.error('[Processor] Critical error in startup sequence:', e);
  }

  // 2. Continuous Listener
  console.log('[Processor] Listening for new telemetry docs across all collections...');
  const { str: finalLastStr } = await getLastProcessedCursor();

  for (const collectionName of RAW_COLLECTIONS) {
    let listenerQuery = db.collection(collectionName).orderBy('timestamp', 'asc');
    if (finalLastStr) {
      listenerQuery = listenerQuery.startAfter(finalLastStr);
    }

    listenerQuery.onSnapshot(async (snap) => {
      for (const change of snap.docChanges()) {
        if (change.type === 'added') {
          try {
            await processBatch(change.doc.id, change.doc.data());
          } catch (err: any) {
            console.error(`[Processor] Failed processing doc ${change.doc.id}:`, err?.message ?? err);
            continue;
          }
          const rawTimestamp = change.doc.data().timestamp;

          let docTs = 0;
          if (rawTimestamp && typeof rawTimestamp.toDate === 'function') {
            docTs = rawTimestamp.toDate().getTime();
          } else if (rawTimestamp) {
            let isoish = String(rawTimestamp).replace(' ', 'T');
            docTs = new Date(isoish).getTime();
          }

          if (!isNaN(docTs) && docTs > 0) {
            await setLastProcessedCursor(docTs, typeof rawTimestamp === 'string' ? rawTimestamp : null);
          }
        }
      }
    }, (err) => {
      console.error(`[Processor] Snapshot listener error for ${collectionName}:`, (err as any)?.message ?? err);
    });
  }

  // 3. Periodic UI Cleanup
  setInterval(async () => {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
  }, 15 * 60 * 1000);
}

startProcessor().catch(console.error);
