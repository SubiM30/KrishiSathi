/**
 * market.js — the KrishiSathi marketplace data layer.
 * ─────────────────────────────────────────────────────────────────────
 * A two-sided board:
 *   • a farmer posts  "Want to Sell"  — what they have and how much
 *   • a buyer  posts  "Want to Buy"   — what they need and how much
 * Both are public: anyone can browse. Only the author can edit, extend,
 * close or delete their own listing.
 *
 * Storage follows store.js exactly: localStorage on the device, mirrored to
 * Firestore (collection `marketPosts`) once signed in, so listings follow the
 * account across devices. With no Firebase configured the local copy still
 * works, which is what makes the whole feature testable offline.
 *
 * A listing has a validity window. It is never deleted when that runs out —
 * it simply reads as expired, and the author can extend it.
 */
import { createPost, updatePost, deletePost, loadPosts,
         createInterest, loadInterests, updateInterest } from './auth.js';

const KEY = 'ks_market_v1';
const blank = () => ({ posts: [], updatedAt: null });

let state = null;
let cloudUser = null;
const listeners = new Set();

/* ── local store ─────────────────────────────────── */
function readLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...blank(), ...JSON.parse(raw) } : blank();
  } catch {
    return blank();
  }
}

function writeLocal() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

function emit() {
  listeners.forEach((fn) => {
    try { fn(getPosts()); } catch {}
  });
}

/** Subscribe to changes (used by the views so the list re-renders itself). */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ── reads ───────────────────────────────────────── */
export function getPosts() {
  if (!state) state = readLocal();
  return state.posts || [];
}

export function getPost(id) {
  return getPosts().find((p) => p.id === id) || null;
}

/** My own listings, newest first. Signed out, this is whatever this device
    posted itself (authorId null) — signed in, it is the account's own. */
export function myPosts(uid) {
  return getPosts()
    .filter((p) => (uid ? p.authorId === uid : !p.authorId))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** A listing is expired once its validity window has passed. */
export function isExpired(post) {
  if (!post) return false;
  if (post.status === 'closed') return true;
  return Boolean(post.expiresAt) && Number(post.expiresAt) < Date.now();
}

/** Days left, or 0 when expired. */
export function daysLeft(post) {
  if (!post || !post.expiresAt) return 0;
  return Math.max(0, Math.ceil((Number(post.expiresAt) - Date.now()) / 86400000));
}

/* ── writes ──────────────────────────────────────── */
const uid = () => (cloudUser && cloudUser.uid) || null;

/** Create a listing. Works signed out (local only) and signed in (mirrored). */
export async function addPost(fields) {
  if (!state) state = readLocal();
  const now = Date.now();
  const days = Math.max(1, Number(fields.validDays) || 15);
  const post = {
    id: `p_${now}_${Math.random().toString(36).slice(2, 7)}`,
    authorId: uid(),
    authorRole: fields.authorRole || 'farmer',
    authorName: fields.authorName || '',
    type: fields.type || 'sell',
    commodity: fields.commodity || '',
    quantity: fields.quantity || '',
    unit: fields.unit || 'quintal',
    price: fields.price || '',
    place: fields.place || '',
    phone: fields.phone || '',
    email: fields.email || '',
    notes: fields.notes || '',
    image: fields.image || '',
    validDays: days,
    expiresAt: now + days * 86400000,
    status: 'open',
    createdAt: now,
  };
  state.posts = [post, ...(state.posts || [])];
  state.updatedAt = now;
  writeLocal();
  emit();

  // mirror to the cloud when we can — a failure must not lose the local copy
  if (uid()) {
    try {
      const cloudId = await createPost({ ...post });
      if (cloudId) {
        post.cloudId = cloudId;
        state.posts = state.posts.map((p) => (p.id === post.id ? post : p));
        writeLocal();
      }
    } catch (err) {
      // Do not hide this: a listing that never reaches the board is the one
      // failure the author must be told about.
      post.syncError = (err && err.code) || (err && err.message) || 'sync failed';
      console.warn('[market] could not publish to the board:', err);
      emit();
    }
  }
  return post;
}

export function editPost(id, patch) {
  if (!state) state = readLocal();
  state.posts = getPosts().map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p));
  writeLocal();
  emit();
  const p = getPost(id);
  if (uid() && p) {
    const docId = p.cloudId || p.id;
    updatePost(docId, patch).catch((err) => console.warn('[market] could not save the change:', err));
  }
  return p;
}

/** Push the expiry out by three more days and re-open the listing. */
export function extendPost(id, days = 3) {
  const p = getPost(id);
  if (!p) return null;
  const base = Math.max(Date.now(), Number(p.expiresAt) || 0);
  const add = Math.max(1, Number(days) || 3);
  return editPost(id, { expiresAt: base + add * 86400000, status: 'open', validDays: add });
}

export function closePost(id) {
  return editPost(id, { status: 'closed' });
}

export function removePost(id) {
  if (!state) state = readLocal();
  const p = getPost(id);
  state.posts = getPosts().filter((x) => x.id !== id);
  writeLocal();
  emit();
  if (uid() && p) {
    const docId = p.cloudId || p.id;
    deletePost(docId).catch((err) => console.warn('[market] could not delete the listing:', err));
  }
  // a listing's responses go with it — nothing should be left pointing at a
  // post that no longer exists
  removeInterestsForPost(id);
}

/* ── cloud sync ──────────────────────────────────── */
/**
 * Called by app.js on every auth change, like store.hydrate().
 * Signed in → pull the shared board from Firestore and merge it with
 * anything this device made while offline.
 */
export async function hydrate(user) {
  cloudUser = user || null;
  if (!state) state = readLocal();
  try {
    const cloud = await loadPosts(60);
    if (Array.isArray(cloud)) {
      const mine = (state.posts || []).filter((p) => !p.cloudId);
      const seen = new Set();
      state.posts = [...cloud, ...mine]
        .filter((p) => (seen.has(p.id) ? false : seen.add(p.id)))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      state.updatedAt = Date.now();
      writeLocal();
      emit();
    }
  } catch (err) {
    // offline, or the rules/keys are not set up yet — keep the local copy but
    // say so, otherwise the board looks mysteriously empty
    console.warn('[market] could not load the board:', err);
  }
}

/** Wipe the local board (called on logout, with the rest of the device data). */
export function clearLocal() {
  state = null;
  cloudUser = null;
  try { localStorage.removeItem(KEY); } catch {}
  emit();
}

/* ══════════════════════════════════════════════════════════════════
   Interests — the other half of a listing.
   Tapping Buy on a farmer's listing (or Sell on a buyer's) records an
   interest. The person who wrote the listing sees it as a notification and
   can accept it; the person who responded sees the same connection from
   their side, with the accepted ones marked.
   ══════════════════════════════════════════════════════════════════ */
const IKEY = 'ks_interests_v1';
let interests = null;

function readInterests() {
  try {
    const raw = localStorage.getItem(IKEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeInterests() {
  try {
    localStorage.setItem(IKEY, JSON.stringify(interests || []));
  } catch {}
}

export function getInterests() {
  if (!interests) interests = readInterests();
  pruneInterests();
  return interests;
}

/** Everyone who has responded to one of MY listings. */
export function interestsForOwner(uid) {
  if (!uid) return [];
  return getInterests()
    .filter((i) => i.toId === uid && !i.dismissed && within(i, NOTIF_DAYS))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** The listings I have responded to. */
export function myInterests(uid) {
  return getInterests()
    .filter((i) => (uid ? i.fromId === uid : !i.fromId) && !i.dismissed && within(i, NOTIF_DAYS))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** Accepted responses of mine that I have not been told about yet. */
export function unseenForResponder(uid) {
  return getInterests().filter((i) => (uid ? i.fromId === uid : !i.fromId)
    && !i.dismissed && i.status !== 'new' && !i.responderSeen);
}

export function unseenCount(uid) {
  return interestsForOwner(uid).filter((i) => !i.seen).length;
}

/** Hide one response from my lists (this device only). */
export function dismissInterest(id) {
  if (!interests) interests = readInterests();
  interests = interests.map((i) => (i.id === id ? { ...i, dismissed: true } : i));
  writeInterests();
  emit();
}

/** Hide every response I am involved in. */
export function clearInterests(uid) {
  if (!interests) interests = readInterests();
  interests = interests.map((i) =>
    (i.toId === uid || i.fromId === uid) ? { ...i, dismissed: true, seen: true, responderSeen: true } : i);
  writeInterests();
  emit();
}

/** Turn down a response. The responder is told, the same way as an accept. */
export function rejectInterest(id) {
  if (!interests) interests = readInterests();
  interests = interests.map((i) => (i.id === id ? { ...i, status: 'rejected', seen: true } : i));
  writeInterests();
  emit();
  const it = getInterests().find((i) => i.id === id);
  if (uid() && it) {
    const docId = it.cloudId || it.id;
    updateInterest(docId, { status: 'rejected' }).catch((err) => {
      console.warn('[market] could not save the rejection:', err);
    });
  }
  return it;
}

export function markInterestsSeen(uid) {
  if (!interests) interests = readInterests();
  let changed = false;
  interests = interests.map((i) => {
    // the author's incoming responses…
    if (i.toId === uid && !i.seen) { changed = true; return { ...i, seen: true }; }
    // …and the outcomes of the ones I sent
    if (i.fromId === uid && i.status !== 'new' && !i.responderSeen) {
      changed = true;
      return { ...i, responderSeen: true };
    }
    return i;
  });
  if (changed) { writeInterests(); emit(); }
}

/**
 * Record that I want to deal on this listing. The listing's author is the one
 * who gets told, so `toId` is their id — not mine.
 */
export async function addInterest(post, from) {
  if (!interests) interests = readInterests();
  if (!post) return null;
  // one response per listing per person
  const already = getInterests().find((i) => i.postId === post.id && i.fromId === (from.id || null));
  if (already) return already;
  const now = Date.now();
  const interest = {
    id: `i_${now}_${Math.random().toString(36).slice(2, 7)}`,
    postId: post.id,
    postCommodity: post.commodity,
    postType: post.type,
    postPlace: post.place || '',
    fromId: from.id || null,
    fromRole: from.role || 'farmer',
    fromName: from.name || '',
    fromPhone: from.phone || '',
    toId: post.authorId || null,
    status: 'new',
    seen: false,          // the listing's author has not looked at it yet
    responderSeen: false, // the responder has not been told the outcome yet
    createdAt: now,
  };
  interests = [interest, ...interests];
  writeInterests();
  emit();
  if (uid()) {
    try {
      const cloudId = await createInterest({ ...interest });
      if (cloudId) {
        interest.cloudId = cloudId;
        interests = interests.map((i) => (i.id === interest.id ? interest : i));
        writeInterests();
      }
    } catch (err) {
      console.warn('[market] could not send the interest to the board:', err);
    }
  }
  return interest;
}

export function acceptInterest(id) {
  if (!interests) interests = readInterests();
  interests = interests.map((i) => (i.id === id ? { ...i, status: 'accepted', seen: true } : i));
  writeInterests();
  emit();
  const it = getInterests().find((i) => i.id === id);
  // An interest pulled from Firestore carries its DOCUMENT id as `id` and has
  // no `cloudId`, so writing only when `cloudId` exists meant an accepted
  // response was never saved. The next refresh pulled the old copy back and the
  // accept silently undid itself.
  if (uid() && it) {
    const docId = it.cloudId || it.id;
    updateInterest(docId, { status: 'accepted' }).catch((err) => {
      console.warn('[market] could not save the acceptance:', err);
    });
  }
  return it;
}

/** Pull the shared interest list, the same way the board is pulled. */
export async function hydrateInterests(user) {
  cloudUser = user || null;
  if (!interests) interests = readInterests();
  try {
    const cloud = await loadInterests(80);
    if (Array.isArray(cloud)) {
      const localOnly = (interests || []).filter((i) => !i.cloudId);
      // "have I looked at this yet" and "have I cleared it" are marks this
      // DEVICE makes, so they are never stored in Firestore. The cloud copy
      // used to win the merge, which is why the bell's number came back after
      // a refresh — the local flags have to be carried over.
      const localById = new Map((interests || []).map((i) => [i.id, i]));
      const seen = new Set();
      interests = [...cloud, ...localOnly]
        .filter((i) => (seen.has(i.id) ? false : seen.add(i.id)))
        .map((i) => {
          const l = localById.get(i.id);
          if (!l) return i;
          return {
            ...i,
            seen: Boolean(i.seen || l.seen),
            responderSeen: Boolean(i.responderSeen || l.responderSeen),
            dismissed: Boolean(l.dismissed),
          };
        })
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      writeInterests();
      emit();
    }
  } catch (err) {
    console.warn('[market] could not load interests:', err);
  }
}

/** Drop every response that belongs to a listing that is gone. */
function removeInterestsForPost(postId) {
  if (!interests) interests = readInterests();
  const before = interests.length;
  interests = interests.filter((i) => i.postId !== postId);
  if (interests.length !== before) { writeInterests(); emit(); }
}

/**
 * Two clocks, deliberately different.
 *   NOTIF_DAYS   — how long a response still counts as a notification.
 *   HISTORY_DAYS — how long the record itself is kept, for the history view.
 * A response drops out of the notifications after a week but stays in the
 * history for a month, and is only let go after that.
 */
const NOTIF_DAYS = 7;
const HISTORY_DAYS = 30;
const DAY = 86400000;

function pruneInterests() {
  if (!interests) interests = readInterests();
  const cutoff = Date.now() - HISTORY_DAYS * DAY;
  const kept = interests.filter((i) => (i.createdAt || 0) >= cutoff);
  if (kept.length !== interests.length) {
    interests = kept;
    writeInterests();
  }
}

/** Is this response still inside the notification window? */
function within(i, days) {
  return (i.createdAt || 0) >= Date.now() - days * DAY;
}

/** How long this record has left before it is let go. */
export function daysLeftInHistory(i) {
  const gone = (i.createdAt || 0) + HISTORY_DAYS * DAY;
  return Math.max(0, Math.ceil((gone - Date.now()) / DAY));
}

/**
 * Everything I was part of — as the listing's author or as the responder —
 * whether it is accepted, rejected or still waiting, and whether or not I have
 * cleared it from the notifications. This is the history.
 */
export function historyFor(uid) {
  if (!uid) return [];
  return getInterests()
    .filter((i) => (i.toId === uid || i.fromId === uid) && within(i, HISTORY_DAYS))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** Have I already responded to this listing? */
export function hasResponded(postId, uid) {
  return getInterests().some((i) => i.postId === postId && i.fromId === (uid || null));
}
