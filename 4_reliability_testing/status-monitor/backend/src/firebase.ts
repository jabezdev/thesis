import admin from 'firebase-admin';

function parseServiceAccount(): admin.ServiceAccount | null {
  const inlineJson = Bun.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (inlineJson) {
    return JSON.parse(inlineJson) as admin.ServiceAccount;
  }

  const serviceAccountPath = Bun.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  if (serviceAccountPath) {
    return null;
  }

  return null;
}

export async function initializeFirebase() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  const inlineJson = Bun.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const serviceAccountPath = Bun.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  const databaseURL = Bun.env.FIREBASE_DATABASE_URL?.trim() || 'https://panahon-live-default-rtdb.firebaseio.com';

  let credential: admin.credential.Credential;
  if (inlineJson) {
    credential = admin.credential.cert(JSON.parse(inlineJson) as admin.ServiceAccount);
  } else if (serviceAccountPath) {
    const fileText = await Bun.file(serviceAccountPath).text();
    credential = admin.credential.cert(JSON.parse(fileText) as admin.ServiceAccount);
  } else {
    credential = admin.credential.applicationDefault();
  }

  admin.initializeApp({
    credential,
    databaseURL,
  });

  return admin.app();
}

export function getFirestore() {
  return admin.firestore();
}

export function getRealtimeDatabase() {
  return admin.database();
}
