/**
 * Export Firestore m6_node_data → m6_node_data.csv
 *
 * Normalizations applied:
 *  - ts: unified to ISO 8601 UTC
 *      Historical records already store UTC ISO strings.
 *      Live records store local PHT (UTC+8) strings like "2026-04-10 13:15:02"
 *      → converted to UTC by subtracting 8 hours.
 *  - is_imported_historical: absent on live docs → normalized to false
 *  - Consistent column order
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { writeFileSync, readFileSync } from 'fs';

// Resolve paths relative to this script's location
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));

const envContent = readFileSync(resolve(__dirname, '.env'), 'utf8');
const b64Match = envContent.match(/FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=(\S+)/);
const serviceAccount = JSON.parse(Buffer.from(b64Match[1], 'base64').toString('utf8'));

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

console.log('Fetching m6_node_data...');
const snapshot = await db.collection('m6_node_data').get();
console.log(`Fetched ${snapshot.size} documents.`);

const COLUMNS = [
  'id',
  'node_id',
  'ts',               // normalized UTC ISO 8601
  'ts_raw',           // original ts value as stored
  'uptime_ms',
  'temp',
  'hum',
  'rain',
  'batt_v',
  'batt_i',
  'solar_v',
  'solar_i',
  'samples',
  'processed_at',
  'is_imported_historical',
];

/**
 * Normalize ts to UTC ISO 8601.
 * Historical: already UTC ISO → parse directly.
 * Live:       "YYYY-MM-DD HH:MM:SS" local PHT (UTC+8) → subtract 8h.
 */
function normalizeTs(ts) {
  if (!ts) return '';
  // Already ISO 8601 (contains T or Z or +)
  if (/T|Z|\+/.test(ts)) {
    return new Date(ts).toISOString();
  }
  // Local datetime string "YYYY-MM-DD HH:MM:SS" → treat as UTC+8
  const local = new Date(ts.replace(' ', 'T') + '+08:00');
  return local.toISOString();
}

const escape = (val) => {
  if (val === null || val === undefined) return '';
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
};

const rows = snapshot.docs.map(doc => {
  const d = doc.data();
  return {
    id: doc.id,
    node_id: d.node_id ?? '',
    ts: normalizeTs(d.ts),
    ts_raw: d.ts ?? '',
    uptime_ms: d.uptime_ms ?? '',
    temp: d.temp ?? '',
    hum: d.hum ?? '',
    rain: d.rain ?? '',
    batt_v: d.batt_v ?? '',
    batt_i: d.batt_i ?? '',
    solar_v: d.solar_v ?? '',
    solar_i: d.solar_i ?? '',
    samples: d.samples ?? '',
    processed_at: d.processed_at ?? '',
    is_imported_historical: d.is_imported_historical ?? false,
  };
});

// Sort by node_id then ts
rows.sort((a, b) => {
  if (a.node_id < b.node_id) return -1;
  if (a.node_id > b.node_id) return 1;
  return a.ts.localeCompare(b.ts);
});

const csv = [
  COLUMNS.join(','),
  ...rows.map(row => COLUMNS.map(col => escape(row[col])).join(','))
].join('\n');

const outPath = resolve(__dirname, '../../m6_node_data.csv');
writeFileSync(outPath, csv, 'utf8');
console.log(`Saved → m6_node_data.csv (${rows.length} rows)`);
