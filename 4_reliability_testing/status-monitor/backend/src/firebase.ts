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
    credential = admin.credential.applicationDefault();

    if (!projectId) {
      console.warn(
        '[firebase] using application default credentials without FIREBASE_PROJECT_ID. ' +
          'Firestore calls may fail with "Unable to detect a Project Id" outside Google Cloud.',
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
