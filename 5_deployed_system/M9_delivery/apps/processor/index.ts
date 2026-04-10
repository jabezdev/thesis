import { db, rtdb, getLastProcessedCursor, setLastProcessedCursor } from './firebase';
import { RawSensorData } from '@panahon/shared';
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

/**
 * @panahonProcessor - Core Service
 */

const RAW_COLLECTIONS = ['node_data_0v3'];
const NORMALIZED_COLLECTION = 'm6_node_data';

// Initialize Convex Client
// VITE_CONVEX_URL is used locally; CONVEX_URL is the plain name set on the VPS
const convexUrl = (process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL ?? '').replace(/\/$/, "");
if (!convexUrl) throw new Error('[Processor] Missing CONVEX_URL env var. Set it in the VPS environment.');
const convex = new ConvexHttpClient(convexUrl);

// Tracks the last processed sample time per node in memory to calculate gaps
const lastNodeSampleMap: Record<string, number> = {};
const nodeMetaCache = new Map<string, any>();

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
  // Periodic Sync every 5 minutes
  setInterval(syncConvexMetadata, 5 * 60 * 1000);

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
          await processBatch(change.doc.id, change.doc.data());
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
    });
  }

  // 3. Periodic UI Cleanup
  setInterval(async () => {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
  }, 15 * 60 * 1000);
}

startProcessor().catch(console.error);
