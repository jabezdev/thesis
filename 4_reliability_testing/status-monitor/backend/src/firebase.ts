import admin from 'firebase-admin';

export async function initializeFirebase() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  const inlineJson = Bun.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const serviceAccountPath = Bun.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  const databaseURL = Bun.env.FIREBASE_DATABASE_URL?.trim() || 'https://panahon-live-default-rtdb.firebaseio.com';

  let credential: admin.credential.Credential | null = null;
  if (inlineJson) {
    credential = admin.credential.cert(JSON.parse(inlineJson) as admin.ServiceAccount);
  }

  if (!credential && serviceAccountPath) {
    try {
      const fileText = await Bun.file(serviceAccountPath).text();
      credential = admin.credential.cert(JSON.parse(fileText) as admin.ServiceAccount);
    } catch (error) {
      const maybeCode = (error as NodeJS.ErrnoException | undefined)?.code;
      if (maybeCode !== 'ENOENT') {
        throw error;
      }

      console.warn(
        `[firebase] service account file not found at ${serviceAccountPath}; falling back to application default credentials.`,
      );
    }
  }

  if (!credential) {
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
