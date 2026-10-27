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

/**
 * Keep the account's display name in step with the farm profile.
 * The name is one fact about one person, so wherever it is edited it should
 * follow through to the avatar, the account menu and the greeting.
 */
export async function updateDisplayName(name) {
  const clean = String(name || '').trim();
  if (!auth || !auth.currentUser || !clean) return false;
  try {
    await auth._mod.updateProfile(auth.currentUser, { displayName: clean });
    return true;
  } catch {
    return false;
  }
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

/* ── Marketplace ─────────────────────────────────────────────────────
   Listings live in their own collection. Farmers post "Want to Sell",
   buyers post "Want to Buy"; both are readable by anyone, and only the
   author can change or delete their own. `db._mod` is the Firestore module
   loaded on demand, the same way the farm data is handled above.        */

const POSTS = 'marketPosts';

/**
 * Firestore throws on ANY `undefined` value — `addDoc({ id: undefined })` is
 * enough to kill the whole write. Every listing therefore goes through this,
 * which drops the empty ones and turns anything left into a plain value.
 */
function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    out[k] = v;
  }
  return out;
}

/** Create a listing. Returns its new id. */
export async function createPost(post) {
  const fs = db._mod;
  const user = auth.currentUser;
  if (!user) throw new Error('Log in to post.');
  const ref = await fs.addDoc(fs.collection(db, POSTS), clean({
    ...post,
    id: undefined,
    authorId: user.uid,
    createdAt: Date.now(),
  }));
  return ref.id;
}

/** Update one of my listings. */
export async function updatePost(id, patch) {
  const fs = db._mod;
  const user = auth.currentUser;
  if (!user) throw new Error('Log in to edit.');
  await fs.updateDoc(fs.doc(db, POSTS, id), clean(patch));
  return true;
}

/** Delete one of my listings. */
export async function deletePost(id) {
  const fs = db._mod;
  const user = auth.currentUser;
  if (!user) throw new Error('Log in to delete.');
  await fs.deleteDoc(fs.doc(db, POSTS, id));
  return true;
}

/* ── Interests ──────────────────────────────────────────────────────
   A response to a listing. Like the board, the collection is publicly
   readable (the author has to be able to see who responded) but only the
   two people involved may create or change one.                        */

const INTERESTS = 'marketInterests';

export async function createInterest(interest) {
  const fs = db._mod;
  const user = auth.currentUser;
  if (!user) throw new Error('Log in to respond.');
  const ref = await fs.addDoc(fs.collection(db, INTERESTS), clean({
    ...interest, id: undefined, fromId: user.uid, createdAt: Date.now(),
  }));
  return ref.id;
}

export async function updateInterest(id, patch) {
  const fs = db._mod;
  const user = auth.currentUser;
  if (!user) throw new Error('Log in to respond.');
  await fs.updateDoc(fs.doc(db, INTERESTS, id), clean(patch));
  return true;
}

export async function loadInterests(limit = 80) {
  const fs = db._mod;
  const q = fs.query(fs.collection(db, INTERESTS), fs.orderBy('createdAt', 'desc'), fs.limit(limit));
  const snap = await fs.getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Every listing, newest first. Readable without an account. */
export async function loadPosts(limit = 60) {
  const fs = db._mod;
  const q = fs.query(fs.collection(db, POSTS), fs.orderBy('createdAt', 'desc'), fs.limit(limit));
  const snap = await fs.getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Just my listings. */
export async function loadMyPosts() {
  const fs = db._mod;
  const user = auth.currentUser;
  if (!user) return [];
  const q = fs.query(fs.collection(db, POSTS), fs.where('authorId', '==', user.uid));
  const snap = await fs.getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
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
