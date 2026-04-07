import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { getFirestore } from 'firebase/firestore';

// Provide placeholders for Firebase configuration.
// These need to match the Panahon.live web app credentials in Firebase Console.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCDsUNnLZuK8EyBa1XRfKrgxVkykFK-WVg", // Public demo key fallback
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "panahon-live.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://panahon-live-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "panahon-live",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "panahon-live.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || ""
};

const app = initializeApp(firebaseConfig);

export const rtdb = getDatabase(app);
export const db = getFirestore(app);
