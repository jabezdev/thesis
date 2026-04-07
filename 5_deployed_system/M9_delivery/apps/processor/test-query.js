const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config({ path: '.env' });

const base64Content = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 || process.env.FIREBASE_SERVICE_ACCOUNT_64;
let account;
if (base64Content) {
  account = JSON.parse(Buffer.from(base64Content, 'base64').toString('utf8'));
} else {
  account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
}

admin.initializeApp({
  credential: admin.credential.cert(account)
});

const db = getFirestore();

async function run() {
  const snapshot = await db.collection('node_data_0v3').limit(1).get();
  snapshot.forEach(doc => {
    console.log(doc.id, '=>', doc.data().timestamp);
    console.log('type:', typeof doc.data().timestamp);
  });
}
run();
