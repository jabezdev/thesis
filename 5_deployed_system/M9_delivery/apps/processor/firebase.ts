import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database';
import * as dotenv from 'dotenv';

import * as fs from 'fs';
import * as path from 'path';

console.log(`[Firebase] Initializing... CWD: ${process.cwd()}`);
const envPath = path.resolve(process.cwd(), '.env');
console.log(`[Firebase] Checking for .env at: ${envPath}`);
if (fs.existsSync(envPath)) {
  console.log('[Firebase] Found .env file.');
  dotenv.config();
} else {
  console.warn('[Firebase] .env file NOT found in CWD.');
  // Try loading from apps/processor/.env as a fallback
  const fallbackPath = path.resolve(process.cwd(), 'apps/processor/.env');
  console.log(`[Firebase] Checking fallback at: ${fallbackPath}`);
  if (fs.existsSync(fallbackPath)) {
    console.log('[Firebase] Found fallback .env.');
    dotenv.config({ path: fallbackPath });
  }
}

/**
 * @panahonProcessor - Firebase setup
 */

const getServiceAccount = () => {
  console.log('[Firebase] Checking for credentials...');
  // Check for the specific base64 key name used in .env
  const base64Content = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 || process.env.FIREBASE_SERVICE_ACCOUNT_64;
  
  if (base64Content) {
    console.log('[Firebase] Found Base64 credentials.');
    try {
      const decoded = Buffer.from(base64Content, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      console.log(`[Firebase] Successfully decoded and parsed Service Account for project: ${parsed.project_id}`);
      return parsed;
    } catch (e) {
      console.error('[Firebase] Failed to decode Base64 credentials', e);
    }
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.log('[Firebase] Found FIREBASE_SERVICE_ACCOUNT (raw JSON)');
    try {
      const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      console.log(`[Firebase] Successfully parsed Service Account for project: ${parsed.project_id}`);
      return parsed;
    } catch (e) {
      console.error('[Firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT', e);
    }
  }
  console.warn('[Firebase] No Service Account credentials found in environment!');
  return null;
};

const serviceAccount = getServiceAccount();

if (!admin.apps.length) {
  console.log('[Firebase] Initializing Admin SDK...');
  try {
    admin.initializeApp({
      credential: serviceAccount ? admin.credential.cert(serviceAccount) : admin.credential.applicationDefault(),
      databaseURL: process.env.DATABASE_URL || "https://panahon-live-default-rtdb.asia-southeast1.firebasedatabase.app/"
    });
    console.log('[Firebase] Admin SDK Initialized.');
  } catch (e) {
    console.error('[Firebase] Failed to initialize Admin SDK', e);
  }
}

export const db = getFirestore();
export const rtdb = getDatabase();

export async function getLastProcessedCursor(): Promise<{ts: number | null, str: string | null}> {
  const doc = await db.collection('_system').doc('processor_cursor').get();
  if (doc.exists) {
    const data = doc.data();
    return { ts: data?.last_timestamp || null, str: data?.last_timestamp_string || null };
  }
  return { ts: null, str: null };
}

export async function setLastProcessedCursor(ts: number | null, str?: string | null) {
  const payload: any = {
    updated_at: admin.firestore.FieldValue.serverTimestamp()
  };
  if (ts !== null) payload.last_timestamp = ts;
  if (str) payload.last_timestamp_string = str;
  
  await db.collection('_system').doc('processor_cursor').set(payload, { merge: true });
}
