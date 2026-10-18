/**
 * Firebase configuration — EDIT THIS FILE ONLY.
 * ---------------------------------------------------------------
 * 1. Go to https://console.firebase.google.com → "Add project" (free).
 * 2. In the project, click the "</>" (web) icon and register the app.
 * 3. Copy the config values it shows you and paste them below.
 * 4. In Firebase Console → Authentication → Sign-in method:
 *    enable "Email/Password" and "Google".
 *
 * IMPORTANT: these values are PUBLIC by design. This is not a security
 * hole — access to your database is controlled by firestore.rules,
 * which you paste into Firebase Console → Firestore → Rules.
 */
export const FIREBASE_CONFIG = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_PROJECT.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID",
};

/* ── Configuration check ─────────────────────────────────────────
   Every field must be a non-empty string that doesn't start with
   PASTE_. If anything is missing, we print EXACTLY which fields are
   still placeholders in the browser console (press F12 to see it),
   so a half-filled config is obvious instead of mysterious.        */
const unfilled = Object.entries(FIREBASE_CONFIG)
  .filter(
    ([, value]) =>
      typeof value !== 'string' ||
      value.trim() === '' ||
      value.trim().startsWith('PASTE_')
  )
  .map(([key]) => key);

/** True once you replace the placeholders above with real values. */
export const FIREBASE_ENABLED = unfilled.length === 0;

if (!FIREBASE_ENABLED) {
  console.warn(
    '[KrishiSathi] Firebase is NOT configured yet. These fields still have placeholders or are empty:',
    unfilled.join(', '),
    '→ edit public/js/firebase-config.js, save, then hard-refresh the browser (Ctrl+Shift+R).'
  );
}
