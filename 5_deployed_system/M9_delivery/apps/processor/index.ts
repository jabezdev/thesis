import { db, rtdb, getLastProcessedCursor, setLastProcessedCursor } from './firebase';
import { RawSensorData } from '@panahon/shared';
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

/**
 * @panahonProcessor - Core Service
 */

const RAW_COLLECTION = 'node_data_0v3';
const NORMALIZED_COLLECTION = 'm6_node_data';

// Initialize Convex Client
const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!);

export async function syncConvexMetadata() {
  console.log('[Sync] Fetching node metadata from Convex...');
  try {
    const nodes = await convex.query(api.nodes.list);
    const registry: string[] = [];
    for (const node of nodes) {
      registry.push(node.node_id);
      await rtdb.ref(`nodes/${node.node_id}/metadata`).set({
        name: node.name,
        location: node.location,
        calibration: node.calibration,
        status: node.status,
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
  const history: RawSensorData[] = data.history.map((h: any) => ({
    ts: h.ts.stringValue || h.ts,
    uptime_ms: parseInt(h.uptime_ms.integerValue || h.uptime_ms),
    temp: parseFloat(h.temp.doubleValue || h.temp),
    hum: parseFloat(h.hum.doubleValue || h.hum),
    rain: parseFloat(h.rain.doubleValue || h.rain),
    batt_v: parseFloat(h.batt_v.doubleValue || h.batt_v),
    batt_i: parseFloat(h.batt_i.doubleValue || h.batt_i),
    solar_v: parseFloat(h.solar_v.doubleValue || h.solar_v),
    solar_i: parseFloat(h.solar_i.doubleValue || h.solar_i),
    samples: parseInt(h.samples.integerValue || h.samples),
  }));

  const batch = db.batch();

  for (const sample of history) {
    const tsKey = sample.ts.replace(/[: ]/g, '-');
    const docRef = db.collection(NORMALIZED_COLLECTION).doc(`${nodeId}_${tsKey}`);
    batch.set(docRef, { ...sample, node_id: nodeId, processed_at: new Date().toISOString() });

    // Update Realtime DB (Last Hour list)
    const epoch = new Date(sample.ts).getTime();
    rtdb.ref(`nodes/${nodeId}/last_hour/${epoch}`).set(sample);
  }

  // Update Latest (RTDB)
  if (history.length > 0) {
    const last = history[history.length - 1];
    rtdb.ref(`nodes/${nodeId}/latest`).set(last);
  }

  await batch.commit();
  console.log(`[Processor] Processed ${history.length} samples from doc: ${docId}`);
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
    console.log(`[Processor] Querying ${RAW_COLLECTION} for backfill...`);
    let hasMore = true;
    let lastDocSnap: any = null;
    let totalProcessed = 0;

    while (hasMore) {
      let query = db.collection(RAW_COLLECTION)
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
        console.log(`[Processor] Backfilling chunk of ${snapshot.size} raw documents...`);
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
        console.log(`[Processor] Backfill complete. Processed ${totalProcessed} new docs.`);
      }
    }
  } catch (e) {
    console.error('[Processor] Critical error in startup sequence:', e);
  }

  // 2. Continuous Listener
  console.log('[Processor] Listening for new telemetry docs...');
  const { str: finalLastStr } = await getLastProcessedCursor();
  
  let listenerQuery = db.collection(RAW_COLLECTION).orderBy('timestamp', 'asc');
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

  // 3. Periodic UI Cleanup
  setInterval(async () => {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
  }, 15 * 60 * 1000); 
}

startProcessor().catch(console.error);
