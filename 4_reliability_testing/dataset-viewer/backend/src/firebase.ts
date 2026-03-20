import admin from 'firebase-admin';

export async function initializeFirebase() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  const inlineJson = Bun.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const inlineBase64 = Bun.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  const serviceAccountPath = Bun.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  const explicitProjectId =
    Bun.env.FIREBASE_PROJECT_ID?.trim() || Bun.env.GOOGLE_CLOUD_PROJECT?.trim() || Bun.env.GCLOUD_PROJECT?.trim();
  const databaseURL = Bun.env.FIREBASE_DATABASE_URL?.trim() || 'https://panahon-live-default-rtdb.firebaseio.com';

  const normalizeBase64 = (value: string) => {
    const withoutQuotes = value.trim().replace(/^['"]|['"]$/g, '');
    const compact = withoutQuotes.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    const paddedLength = Math.ceil(compact.length / 4) * 4;
    return compact.padEnd(paddedLength, '=');
  };

  const parseServiceAccount = (rawJson: string, source: string): admin.ServiceAccount & { project_id?: string } => {
    try {
      const parsed = JSON.parse(rawJson.trim()) as (admin.ServiceAccount & { project_id?: string }) | null;
      if (!parsed || typeof parsed !== 'object') throw new Error('not-an-object');
      return parsed;
    } catch {
      throw new Error(
        `[firebase] invalid ${source}: expected valid JSON object. ` +
          'If using env variables on Dokploy, use one-line complete base64 output (no truncation) from `base64 -w 0 firebase-service-account.json`.',
      );
    }
  };

  let credential: admin.credential.Credential | null = null;
  let projectId = explicitProjectId || null;

  if (inlineBase64) {
    const normalizedBase64 = normalizeBase64(inlineBase64);
    let decodedJson = '';
    try {
      decodedJson = Buffer.from(normalizedBase64, 'base64').toString('utf8');
    } catch {
      throw new Error(
        '[firebase] invalid FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: expected base64-encoded JSON.',
      );
    }
    const serviceAccount = parseServiceAccount(decodedJson, 'FIREBASE_SERVICE_ACCOUNT_JSON_BASE64');
    credential = admin.credential.cert(serviceAccount);
    projectId = projectId || serviceAccount.projectId || serviceAccount.project_id || null;
  } else if (inlineJson) {
    const serviceAccount = parseServiceAccount(inlineJson, 'FIREBASE_SERVICE_ACCOUNT_JSON');
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
      if (maybeCode !== 'ENOENT') throw error;
      console.warn(
        `[firebase] service account file not found at ${serviceAccountPath}; falling back to application default credentials.`,
      );
    }
  }

  if (!credential) {
    if (!projectId) {
      throw new Error(
        '[firebase] missing project id and service-account credentials. ' +
          'Set FIREBASE_PROJECT_ID and provide FIREBASE_SERVICE_ACCOUNT_JSON_BASE64, FIREBASE_SERVICE_ACCOUNT_JSON, or a valid FIREBASE_SERVICE_ACCOUNT_PATH.',
      );
    }
    credential = admin.credential.applicationDefault();
    try {
      await credential.getAccessToken();
    } catch {
      throw new Error(
        '[firebase] no usable credentials found. ' +
          'Provide FIREBASE_SERVICE_ACCOUNT_JSON_BASE64/FIREBASE_SERVICE_ACCOUNT_JSON or mount a service account file to FIREBASE_SERVICE_ACCOUNT_PATH.',
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
