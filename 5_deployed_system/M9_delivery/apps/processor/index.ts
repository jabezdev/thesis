import { db, rtdb, getLastProcessedCursor, setLastProcessedCursor } from './firebase';
import { RawSensorData } from '@panahon/shared';

/**
 * @panahonProcessor - Core Service
 */

const RAW_COLLECTION = 'node_data_0v3';
const NORMALIZED_COLLECTION = 'm6_node_data';

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

  // 3. Periodic UI Cleanup (Optional, but keeps RTDB lean for public site)
  setInterval(async () => {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    // Cleanup nodes/{id}/last_hour/<epoch> if epoch < oneHourAgo
    // Note: In production, use Firebase Functions or a more efficient sweep.
  }, 15 * 60 * 1000); // Check every 15 mins
}

startProcessor().catch(console.error);
