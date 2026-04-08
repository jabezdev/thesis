import * as fs from 'fs';
import * as path from 'path';
import { db } from './firebase';

const CSV_PATH = path.resolve(__dirname, '../../../DATA/ota_1min.csv');
const NORMALIZED_COLLECTION = 'm6_node_data';
const NODE_ID = 'node_1';

async function importCSV() {
  console.log(`[Import] Starting CSV import from ${CSV_PATH}...`);
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`[Error] CSV file not found at ${CSV_PATH}`);
    process.exit(1);
  }

  const fileContent = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = fileContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Skip header if it exists
  let startIndex = 0;
  if (lines[0].toLowerCase().startsWith('timestamp')) {
    startIndex = 1;
  }

  let batch = db.batch();
  let opCount = 0;
  let totalProcessed = 0;

  for (let i = startIndex; i < lines.length; i++) {
    const columns = lines[i].split(',').map(c => c.trim());
    if (columns.length < 5) continue; // Invalid line

    const rawTs = columns[0];
    let temp = 0;
    let hum = 0;
    let rain = 0;
    let batt_v: number | null = null;
    let batt_i: number | null = null;
    let solar_v: number | null = null;
    let solar_i: number | null = null;
    let samples = 0;

    // Handle the evolving format of the CSV dynamically
    if (columns.length === 5) {
      temp = parseFloat(columns[1]);
      hum = parseFloat(columns[2]);
      rain = parseFloat(columns[3]);
      samples = parseInt(columns[4]);
    } else if (columns.length >= 9) {
      temp = parseFloat(columns[1]);
      hum = parseFloat(columns[2]);
      rain = parseFloat(columns[3]);
      batt_v = parseFloat(columns[4]);
      batt_i = parseFloat(columns[5]);
      solar_v = parseFloat(columns[6]);
      solar_i = parseFloat(columns[7]);
      samples = parseInt(columns[8]);
    }

    try {
      // Normalize timestamp to ISO formatting
      const dateStr = rawTs.replace(' ', 'T') + '+08:00'; // Assuming UTC+8 from context
      const dateObj = new Date(dateStr);
      if (isNaN(dateObj.getTime())) continue;

      const isoString = dateObj.toISOString();
      const tsKey = isoString.replace(/[: ]/g, '-');
      
      const docRef = db.collection(NORMALIZED_COLLECTION).doc(`${NODE_ID}_${tsKey}`);
      batch.set(docRef, {
        node_id: NODE_ID,
        ts: isoString,
        uptime_ms: null,
        temp,
        hum,
        rain,
        batt_v,
        batt_i,
        solar_v,
        solar_i,
        samples,
        processed_at: new Date().toISOString(),
        is_imported_historical: true
      });

      opCount++;
      totalProcessed++;

      if (opCount >= 450) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
        console.log(`[Import] Committed batch... Total processed: ${totalProcessed}`);
      }
    } catch (err) {
      console.warn(`[Import] Failed to parse line ${i}: ${lines[i]}`);
    }
  }

  if (opCount > 0) {
    await batch.commit();
    console.log(`[Import] Committed final batch... Total processed: ${totalProcessed}`);
  }

  console.log(`[Import] Complete! Successfully imported ${totalProcessed} historical data points.`);
}

importCSV().catch(console.error);
