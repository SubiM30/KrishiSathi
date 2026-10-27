/**
 * store.js — KrishiSathi's farm data layer.
 * ─────────────────────────────────────────────────────────────────────
 * One place that owns everything the farmer enters: their profile, their
 * crops (each with a sowing date → crop-cycle stage) and each crop's
 * production-cost line items.
 *
 *  • Guests      → kept in localStorage on the device.
 *  • Signed in   → mirrored to Firestore (users/{uid}) through auth.js,
 *                  so the data follows the farmer across devices.
 *
 * Nothing in the UI is hard-coded any more: pages read from here and
 * re-render whenever the data changes (subscribe()).
 */
import { saveFarmData, loadFarmData } from './auth.js';

const KEY = 'ks_farm_v1';

const blank = () => ({ profile: { name: '', state: '', district: '', role: 'farmer' }, crops: [], updatedAt: null });

let farm = null;
let cloudUser = null;
let pushTimer = null;
const listeners = new Set();

/* ── read / write ─────────────────────────────────── */
function readLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...blank(), ...JSON.parse(raw) } : blank();
  } catch {
    return blank();
  }
}

export function getFarm() {
  if (!farm) farm = readLocal();
  return farm;
}

function emit() {
  listeners.forEach((fn) => {
    try {
      fn(farm);
    } catch {}
  });
}

function persist({ push = true } = {}) {
  farm.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(KEY, JSON.stringify(farm));
  } catch {}
  emit();
  if (push && cloudUser) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      saveFarmData(farm).catch(() => {});
    }, 600);
  }
}

/** Re-render hook: fn(farm) runs on every change. Returns an unsubscribe. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The name to stamp on anything this person posts. */
export function myName() {
  return String((getFarm().profile || {}).name || '').trim();
}

/* ── profile ──────────────────────────────────────── */
export function setProfile(patch) {
  getFarm().profile = { ...getFarm().profile, ...patch };
  persist();
}

/** 'farmer' or 'buyer' — one account holds one role. */
export function getRole() {
  return (getFarm().profile || {}).role || 'farmer';
}

/** Switch this account's role. */
export function setRole(role) {
  return setProfile({ role: role === 'buyer' ? 'buyer' : 'farmer' });
}

export function profileComplete() {
  const p = getFarm().profile;
  return Boolean(p.name && p.state);
}

/* ── crops ────────────────────────────────────────── */
export function addCrop(data) {
  const crop = {
    id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    commodity: data.commodity || '',
    variety: data.variety || '',
    area: Number(data.area) || 0,
    areaUnit: data.areaUnit || 'acre',
    sowingDate: data.sowingDate || '',
    expectedHarvestDate: data.expectedHarvestDate || '',
    expectedYield: Number(data.expectedYield) || 0, // quintals
    notes: data.notes || '',
    expenses: Array.isArray(data.expenses) ? data.expenses : [],
  };
  getFarm().crops.unshift(crop);
  persist();
  return crop;
}

export function updateCrop(id, patch) {
  const c = getFarm().crops.find((x) => x.id === id);
  if (!c) return;
  Object.assign(c, patch);
  if (patch.area !== undefined) c.area = Number(patch.area) || 0;
  if (patch.expectedYield !== undefined) c.expectedYield = Number(patch.expectedYield) || 0;
  persist();
}

export function removeCrop(id) {
  const f = getFarm();
  f.crops = f.crops.filter((c) => c.id !== id);
  persist();
}

export function getCrop(id) {
  return getFarm().crops.find((c) => c.id === id) || null;
}

/* ── production-cost line items ───────────────────── */
export function addExpense(cropId, item) {
  const c = getCrop(cropId);
  if (!c) return;
  c.expenses = c.expenses || [];
  c.expenses.push({
    id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    label: item.label || '',
    amount: Number(item.amount) || 0,
    date: item.date || '',
  });
  persist();
}

export function removeExpense(cropId, expenseId) {
  const c = getCrop(cropId);
  if (!c) return;
  c.expenses = (c.expenses || []).filter((e) => e.id !== expenseId);
  persist();
}

/* ── derived numbers ──────────────────────────────── */
export function totalCost(crop) {
  return (crop.expenses || []).reduce((n, e) => n + (Number(e.amount) || 0), 0);
}

export function costPerQuintal(crop) {
  const q = Number(crop.expectedYield) || 0;
  const cost = totalCost(crop);
  return q > 0 ? Math.round(cost / q) : 0;
}

export function totalArea() {
  return getFarm().crops.reduce((n, c) => n + (Number(c.area) || 0), 0);
}

export function totalFarmCost() {
  return getFarm().crops.reduce((n, c) => n + totalCost(c), 0);
}

/* ── cloud sync ───────────────────────────────────── */
/**
 * Called by app.js whenever the auth state changes.
 * Signed in → pull the cloud copy (or push the local one the first time).
 * Signed out → keep working from the local copy.
 */
export async function hydrate(user) {
  cloudUser = user || null;
  if (!user) return;
  try {
    const cloud = await loadFarmData();
    if (cloud && Array.isArray(cloud.crops)) {
      farm = { ...blank(), ...cloud };
      // The name given at sign-up (or taken from Google) is this person's name.
      // Carry it into the profile so My Farm / Settings shows it straight away
      // instead of an empty box, and so it stays the same everywhere.
      if (!(farm.profile && farm.profile.name) && user.displayName) {
        farm.profile = { ...(farm.profile || {}), name: user.displayName };
      }
      try {
        localStorage.setItem(KEY, JSON.stringify(farm));
      } catch {}
      emit();
    } else {
      // first sign-in on this device → seed the cloud with what we have
      const local = getFarm();
      if (!(local.profile && local.profile.name) && user.displayName) {
        local.profile = { ...(local.profile || {}), name: user.displayName };
        try {
          localStorage.setItem(KEY, JSON.stringify(local));
        } catch {}
      }
      await saveFarmData(local).catch(() => {});
    }
  } catch {
    /* offline — keep using the local copy */
  }
}

/* ── local data hygiene ──────────────────────────── */
/**
 * Wipe everything this device holds for the farmer. Called on logout so the
 * next person to use the phone starts clean — the signed-in farmer's data is
 * re-fetched from Firestore the next time they log in.
 * Chat logs, diagnosis history, price snapshots and weather memory are all
 * per-device caches and are cleared too, which keeps storage from growing.
 */
export function clearLocalData() {
  farm = null;
  cloudUser = null;
  clearTimeout(pushTimer);
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (
      k === KEY ||
      k === 'ks_profile' ||
      k === 'ks_diag_history' ||
      k === 'ks_mandi_last' ||
      k === 'ks_weather_last' ||
      k === 'ks_chat_seed' ||
      k.startsWith('ks_chat_log_') ||
      k.startsWith('ks_price_hist_') ||
      k.startsWith('ks_weather_')
    ) {
      keys.push(k);
    }
  }
  keys.forEach((k) => {
    try {
      localStorage.removeItem(k);
    } catch {}
  });
  try {
    sessionStorage.removeItem('ks_last_diag');
    sessionStorage.removeItem('ks_mandi_view');
    sessionStorage.removeItem('ks_chat_seed');
  } catch {}
  emit();
}
