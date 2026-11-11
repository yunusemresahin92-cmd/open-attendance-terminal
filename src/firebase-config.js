// Firebase Web configuration is supplied at build time from `.env.local`.
// Firebase web keys are public identifiers; authorization is enforced by Authentication
// and the Firestore rules. Never commit service-account JSON or private keys.
const env = import.meta.env || {};
const config = {
  apiKey: String(env.VITE_FIREBASE_API_KEY || '').trim(),
  authDomain: String(env.VITE_FIREBASE_AUTH_DOMAIN || '').trim(),
  projectId: String(env.VITE_FIREBASE_PROJECT_ID || '').trim(),
  storageBucket: String(env.VITE_FIREBASE_STORAGE_BUCKET || '').trim(),
  messagingSenderId: String(env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim(),
  appId: String(env.VITE_FIREBASE_APP_ID || '').trim(),
  measurementId: String(env.VITE_FIREBASE_MEASUREMENT_ID || '').trim(),
};
export const embeddedFirebaseConfig = config.apiKey && config.authDomain && config.projectId && config.appId ? config : null;
