/**
 * api.js — small helper layer for talking to the KrishiSathi backend.
 * Every function returns the parsed JSON, or throws an Error whose
 * .message is already farmer-friendly.
 */
import { getLangName } from './i18n.js';

async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status}).`);
  }
  return data;
}

/* ── Chat ──
   langName ("Hindi", "Tamil", …) tells the AI which language to answer in. */
export const sendChat = (messages, langName, profile) =>
  request('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages, lang: langName || 'English', profile: profile || undefined }),
  });

/* ── Summarise (used by the "read aloud" buttons) ── */
export const summariseText = (text, langName) =>
  request('/api/summarise', {
    method: 'POST',
    body: JSON.stringify({ text, lang: langName || 'English' }),
  });

/* ── Diagnosis ── */
export const diagnosePhoto = (image, notes, langName) =>
  request('/api/diagnose', {
    method: 'POST',
    body: JSON.stringify({ image, notes, lang: langName || 'English' }),
  });

/* ── Mandi ── */
/* `fresh: true` → the farmer tapped "Show prices": ask the server to bypass
   its 30-minute cache so the figures are live. The server falls back to the
   cached copy on its own if the government API is slow. */
export const getMandiPrices = ({ commodity, state, district, fresh }) => {
  const params = new URLSearchParams({ commodity });
  if (state) params.set('state', state);
  if (district) params.set('district', district);
  if (fresh) params.set('fresh', '1');
  return request(`/api/mandi/prices?${params.toString()}`);
};

export const getSellAdvice = (payload) =>
  request('/api/mandi/sell-advice', {
    method: 'POST',
    body: JSON.stringify({ ...payload, lang: getLangName() }),
  });

/* ── Weather ── */
export const searchPlaces = (q) => request(`/api/weather/search?q=${encodeURIComponent(q)}`);

/* The weather view can render twice while the app boots (once immediately,
   once after Firebase resolves), which used to fire two identical forecast
   requests. Two small in-memory guards fix that, and neither is the offline
   copy — nothing here is persisted or ever reported as `cached`:
     · inflight — a request already on its way is shared, not repeated
     · recent   — a result fetched seconds ago is reused by an automatic load
   An explicit search passes `fresh: true`, skips `recent`, and goes live. */
const inflightWeather = new Map();
const recentWeather = new Map();
const RECENT_MS = 45 * 1000;

/* Weather must always be current for a real search — a farmer tapping Search
   again is asking "has anything changed?". The last good copy is kept only as
   a fallback for when the service cannot be reached, and is flagged as
   `cached` so the card can say so honestly. */
export async function getWeather({ place, lat, lon, fresh = false }) {
  const key = `ks_weather_${place || `${lat},${lon}`}`;

  if (!fresh) {
    const hit = recentWeather.get(key);
    if (hit && Date.now() - hit.at < RECENT_MS) return { ...hit.data, cached: false };
  }
  if (inflightWeather.has(key)) return { ...(await inflightWeather.get(key)) };

  const params = new URLSearchParams();
  if (place) params.set('place', place);
  if (lat !== undefined) {
    params.set('lat', lat);
    params.set('lon', lon);
  }

  const pending = (async () => {
    try {
      const data = await request(`/api/weather/forecast?${params.toString()}`);
      recentWeather.set(key, { at: Date.now(), data });
      try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch {}
      return { ...data, cached: false };
    } catch (err) {
      // Only a genuine failure to reach the service falls back to the saved copy.
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const { at, data } = JSON.parse(raw);
          return { ...data, cached: true, savedAt: at };
        }
      } catch {}
      throw err;
    }
  })();

  inflightWeather.set(key, pending);
  try { return { ...(await pending) }; } finally { inflightWeather.delete(key); }
}
