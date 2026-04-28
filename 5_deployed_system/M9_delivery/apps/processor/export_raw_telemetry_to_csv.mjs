/**
 * Export Firestore raw telemetry → DATA/raw_telemetry_export.csv
 *
 * Source collection: node_data_0v3
 * Each document is expected to contain a `history[]` array. This script flattens
 * each history sample into one CSV row so downstream analysis can work on a
 * single, uniform table.
 */

import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadServiceAccount() {
  const envPath = resolve(__dirname, '.env');
  if (readFileSync && !admin.apps.length) {
    try {
      const envContent = readFileSync(envPath, 'utf8');
      const b64Match = envContent.match(/FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=(\S+)/);
      if (b64Match?.[1]) {
        return JSON.parse(Buffer.from(b64Match[1], 'base64').toString('utf8'));
      }
    } catch {
      // Fall back to process.env below.
    }
  }

  const base64Content = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 || process.env.FIREBASE_SERVICE_ACCOUNT_64;
  if (base64Content) {
    return JSON.parse(Buffer.from(base64Content, 'base64').toString('utf8'));
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }

  return null;
}

function normalizeTimestamp(value) {
  if (!value) return '';
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }

  const text = String(value).trim();
  if (!text) return '';

  if (/T|Z|\+/.test(text)) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
  }

  const parsed = new Date(text.replace(' ', 'T') + '+08:00');
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

function escapeCsv(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

function flattenDocument(doc) {
  const data = doc.data() ?? {};
  const docTimestamp = normalizeTimestamp(data.timestamp ?? data.ts ?? data.created_at ?? '');
  const history = Array.isArray(data.history) ? data.history : [];

  if (history.length > 0) {
    return history
      .map((sample, index) => ({ sample, index }))
      .filter(({ sample }) => sample && typeof sample === 'object')
      .map(({ sample, index }) => ({
        source_collection: 'node_data_0v3',
        doc_id: doc.id,
        doc_timestamp: docTimestamp,
        sample_index: index,
        node_id: sample.node_id ?? data.node_id ?? '',
        sample_ts: normalizeTimestamp(sample.ts ?? sample.timestamp ?? docTimestamp),
        uptime_ms: sample.uptime_ms ?? '',
        temp: sample.temp ?? '',
        hum: sample.hum ?? '',
        rain: sample.rain ?? '',
        batt_v: sample.batt_v ?? '',
        batt_i: sample.batt_i ?? '',
        solar_v: sample.solar_v ?? '',
        solar_i: sample.solar_i ?? '',
        samples: sample.samples ?? '',
        processed_at: sample.processed_at ?? data.processed_at ?? '',
      }));
  }

  return [{
    source_collection: 'node_data_0v3',
    doc_id: doc.id,
    doc_timestamp: docTimestamp,
    sample_index: 0,
    node_id: data.node_id ?? '',
    sample_ts: normalizeTimestamp(data.timestamp ?? data.ts ?? docTimestamp),
    uptime_ms: data.uptime_ms ?? '',
    temp: data.temp ?? '',
    hum: data.hum ?? '',
    rain: data.rain ?? '',
    batt_v: data.batt_v ?? '',
    batt_i: data.batt_i ?? '',
    solar_v: data.solar_v ?? '',
    solar_i: data.solar_i ?? '',
    samples: data.samples ?? '',
    processed_at: data.processed_at ?? '',
  }];
}

async function main() {
  const serviceAccount = loadServiceAccount();
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: serviceAccount ? admin.credential.cert(serviceAccount) : admin.credential.applicationDefault(),
      databaseURL: process.env.DATABASE_URL || 'https://panahon-live-default-rtdb.asia-southeast1.firebasedatabase.app/',
    });
  }

  const db = getFirestore();
  const snapshot = await db.collection('node_data_0v3').get();
  console.log(`Fetched ${snapshot.size} raw docs from node_data_0v3`);

  const startTs = Date.now();
  const rows = [];
  for (let i = 0; i < snapshot.docs.length; i++) {
    const doc = snapshot.docs[i];
    if ((i + 1) % 100 === 0 || i === 0) {
      console.log(`[Export] Processing doc ${i + 1}/${snapshot.size}: ${doc.id}`);
    }
    const flattened = flattenDocument(doc);
    for (const r of flattened) rows.push(r);
    if (rows.length >= 500 && rows.length % 500 === 0) {
      console.log(`[Export] Accumulated ${rows.length} flattened rows so far...`);
    }
  }

  // Sort after collecting all rows
  rows.sort((a, b) => {
    if (a.node_id < b.node_id) return -1;
    if (a.node_id > b.node_id) return 1;
    if (a.sample_ts < b.sample_ts) return -1;
    if (a.sample_ts > b.sample_ts) return 1;
    return a.sample_index - b.sample_index;
  });
  const collectMs = Date.now() - startTs;
  console.log(`[Export] Flattening complete — ${rows.length} rows collected (${collectMs}ms)`);

  const columns = [
    'source_collection',
    'doc_id',
    'doc_timestamp',
    'sample_index',
    'node_id',
    'sample_ts',
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
  ];

  const csv = [
    columns.join(','),
    ...rows.map((row) => columns.map((col) => escapeCsv(row[col])).join(',')),
  ].join('\n');

  const outPath = resolve(__dirname, '../../DATA/raw_telemetry_export.csv');
  try {
    const outDir = dirname(outPath);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(outPath, csv, 'utf8');
    console.log(`Saved ${rows.length} rows to ${outPath}`);
  } catch (err) {
    console.error('[Export] Write failed:', err && err.message ? err.message : err);
    console.error('[Export] Tried to write to:', outPath);
    throw err;
  }
}

main().catch((err) => {
  console.error('[Export] Failed:', err);
  process.exit(1);
});