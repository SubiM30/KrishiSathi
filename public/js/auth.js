/**
 * auth.js — Firebase authentication + Firestore saves, plus guest mode.
 *
 * Three states:
 *   1. Logged in via Firebase (email or Google) → can save history.
 *   2. Guest mode (localStorage flag)          → browse everything, nothing saved.
 *   3. Not logged in, not guest                → shown a login prompt.
 *
 * If Firebase is not configured yet (placeholders still in
 * firebase-config.js), the app runs in guest-only mode with a notice.
 */
import { FIREBASE_CONFIG, FIREBASE_ENABLED } from './firebase-config.js';

let auth = null;
let db = null;

/** Dynamically import the Firebase SDK from Google's CDN only when configured. */
/** Initialise Firebase (only when configured). Called once at boot. */
export async function initFirebase() {
  if (!FIREBASE_ENABLED) return false;

  const [{ initializeApp }, authMod, fsMod] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
  ]);

  const app = initializeApp(FIREBASE_CONFIG);
  auth = authMod.getAuth(app);
  db = fsMod.getFirestore(app);

  // Expose modules for the functions below
  auth._mod = authMod;
  db._mod = fsMod;
  return true;
}

/* ── Guest mode ─────────────────────────────────── */
export const isGuest = () => localStorage.getItem('ks_guest') === '1';
export const setGuest = (on) => {
  if (on) localStorage.setItem('ks_guest', '1');
  else localStorage.removeItem('ks_guest');
};

/* ── Login / logout ──────────────────────────────── */
export async function loginEmail(email, password) {
  const m = auth._mod;
  await m.signInWithEmailAndPassword(auth, email, password);
}

/**
 * Create a NEW account with email + password (the Sign up tab).
 * This is what was missing before: signInWithEmailAndPassword only logs in
 * existing users — account creation needs createUserWithEmailAndPassword.
 */
export async function signUpEmail(email, password, name) {
  const m = auth._mod;
  const cred = await m.createUserWithEmailAndPassword(auth, email, password);
  if (name) {
    try {
      await m.updateProfile(cred.user, { displayName: name });
    } catch (e) {
      /* display name is optional — ignore failures */
    }
  }
  return cred;
}

export async function loginGoogle() {
  const m = auth._mod;
  const provider = new m.GoogleAuthProvider();
  await m.signInWithPopup(auth, provider);
}

export async function logout() {
  await auth._mod.signOut(auth);
  setGuest(false);
}

/** Register a callback fired whenever login state changes. */
export function onAuthChange(callback) {
  if (auth) auth._mod.onAuthStateChanged(auth, callback);
  else callback(null); // no Firebase → always effectively guest
}

export const isFirebaseReady = () => Boolean(auth);

/* ── Firestore saves (only meaningful when logged in) ── */

/** Save a diagnosis result to the user's private subcollection. */
export async function saveDiagnosis(diagnosis, imageUrl) {
  const fs = db._mod;
  const user = auth.currentUser;
  if (!user) throw new Error('Log in to save your history.');

  // Store the whole diagnosis (not just the headline) so a history entry can
  // be reopened in full. The photo itself lives in Cloudinary — we keep its URL.
  await fs.addDoc(fs.collection(db, 'users', user.uid, 'diagnoses'), {
    crop: diagnosis.cropGuess || null,
    problem: diagnosis.problem || null,
    severity: diagnosis.severity || null,
    confidence: diagnosis.confidence || null,
    symptoms: diagnosis.symptoms || null,
    organicTreatment: diagnosis.organicTreatment || null,
    chemicalTreatment: diagnosis.chemicalTreatment || null,
    prevention: diagnosis.prevention || null,
    ifHealthy: diagnosis.ifHealthy || null,
    disclaimer: diagnosis.disclaimer || null,
    imageUrl: imageUrl || null,
    createdAt: new Date().toISOString(),
  });
}

/** Save a sell-advice analysis. */
export async function saveSellAnalysis(input, advice) {
  const fs = db._mod;
  const user = auth.currentUser;
  if (!user) throw new Error('Log in to save your history.');

  await fs.addDoc(fs.collection(db, 'users', user.uid, 'sellAnalyses'), {
    commodity: input.commodity,
    quantity: input.quantityQuintals,
    recommendation: advice.recommendation || null,
    headline: advice.headline || null,
    createdAt: new Date().toISOString(),
  });
}

/** Save the farm profile (crop, costs) to the user's document. */
export async function saveProfile(profile) {
  const fs = db._mod;
  const user = auth.currentUser;
  if (!user) throw new Error('Log in to sync your profile.');

  await fs.setDoc(fs.doc(db, 'users', user.uid), { profile }, { merge: true });
  return true;
}

/** Load the farm profile (or null) for the signed-in farmer. */
export async function loadProfile() {
  const fs = db._mod;
  const user = auth.currentUser;
  if (!user) return null;

  const snap = await fs.getDoc(fs.doc(db, 'users', user.uid));
  const data = snap.data();
  return data && data.profile ? data.profile : null;
}

/** Save the whole farm (profile + crops + costs) to the user's document. */
export async function saveFarmData(farm) {
  const fs = db._mod;
  const user = auth.currentUser;
  if (!user) throw new Error('Log in to sync your farm.');
  await fs.setDoc(fs.doc(db, 'users', user.uid), { farm }, { merge: true });
  return true;
}

/** Load the farm (or null) for the signed-in farmer. */
export async function loadFarmData() {
  const fs = db._mod;
  const user = auth.currentUser;
  if (!user) return null;
  const snap = await fs.getDoc(fs.doc(db, 'users', user.uid));
  const data = snap.data();
  return data && data.farm ? data.farm : null;
}

/** Load recent diagnoses (newest first). */
export async function loadDiagnoses(limit = 10) {
  const fs = db._mod;
  const user = auth.currentUser;
  if (!user) return [];

  const q = fs.query(
    fs.collection(db, 'users', user.uid, 'diagnoses'),
    fs.orderBy('createdAt', 'desc'),
    fs.limit(limit)
  );
  const snap = await fs.getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
