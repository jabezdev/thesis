import admin from 'firebase-admin';

export async function initializeFirebase() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  const inlineJson = Bun.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const serviceAccountPath = Bun.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  const explicitProjectId =
    Bun.env.FIREBASE_PROJECT_ID?.trim() || Bun.env.GOOGLE_CLOUD_PROJECT?.trim() || Bun.env.GCLOUD_PROJECT?.trim();
  const databaseURL = Bun.env.FIREBASE_DATABASE_URL?.trim() || 'https://panahon-live-default-rtdb.firebaseio.com';

  let credential: admin.credential.Credential | null = null;
  let projectId = explicitProjectId || null;
  if (inlineJson) {
    const serviceAccount = JSON.parse(inlineJson) as admin.ServiceAccount & { project_id?: string };
    credential = admin.credential.cert(serviceAccount);
    projectId = projectId || serviceAccount.projectId || serviceAccount.project_id || null;
  }

  if (!credential && serviceAccountPath) {
    try {
      const fileText = await Bun.file(serviceAccountPath).text();
      const serviceAccount = JSON.parse(fileText) as admin.ServiceAccount & { project_id?: string };
      credential = admin.credential.cert(serviceAccount);
      projectId = projectId || serviceAccount.projectId || serviceAccount.project_id || null;
    } catch (error) {
      const maybeCode = (error as NodeJS.ErrnoException | undefined)?.code;
      if (maybeCode !== 'ENOENT') {
        throw error;
      }

      console.warn(
        `[firebase] service account file not found at ${serviceAccountPath}; falling back to application default credentials. ` +
          `Set FIREBASE_PROJECT_ID in env if running outside Google Cloud metadata environments.`,
      );
    }
  }

  if (!credential) {
    if (!projectId) {
      throw new Error(
        '[firebase] missing project id and service-account credentials. ' +
          'Set FIREBASE_PROJECT_ID and provide either FIREBASE_SERVICE_ACCOUNT_JSON or a valid FIREBASE_SERVICE_ACCOUNT_PATH.',
      );
    }

    credential = admin.credential.applicationDefault();

    try {
      await credential.getAccessToken();
    } catch {
      throw new Error(
        '[firebase] no usable credentials found. ' +
          'Provide FIREBASE_SERVICE_ACCOUNT_JSON or mount a service account file to FIREBASE_SERVICE_ACCOUNT_PATH ' +
          '(for Docker Compose: ./secrets/firebase-service-account.json -> /run/secrets/firebase-service-account.json).',
      );
    }
  }

  admin.initializeApp({
    credential,
    projectId: projectId || undefined,
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
