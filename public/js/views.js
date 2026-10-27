/**
 * views.js — one render function per page.
 * Each returns an HTML string; its wire*() registers the handlers once the
 * HTML is on screen. Plain template literals, no templating library.
 *
 * Everything the farmer enters (crops, costs) comes from store.js, so the
 * screens are personalised and nothing is hard-coded. Icons come from
 * icons.js; strings from i18n.js.
 */
import {
  sendChat, diagnosePhoto, getMandiPrices, getSellAdvice, getWeather, searchPlaces, summariseText,
  uploadMarketPhoto,
} from './api.js';
import { saveDiagnosis, saveSellAnalysis, loadDiagnoses, updateDisplayName } from './auth.js';
import {
  SCHEMES, STATES, CROP_STAGES, EXPENSE_CATEGORIES, AREA_UNITS,
  cropStage, cropDays,
} from './data.js';
import { ICONS, weatherIcon } from './icons.js';
import { CROPS, COMMON_CROPS } from './crops.js';
import { renderCombobox, wireCombobox } from './combobox.js';
import { t, getLang, getLangName, getSpeechLang, LANGS } from './i18n.js';
import { openSheet, closeSheet } from './sheet.js';
import { showAnimated, hideAnimated } from './motion.js';
import * as store from './store.js';
import * as market from './market.js';

/* ── shared helpers ─────────────────────────────── */
const esc = (s) => {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
};
const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
/**
 * Parse a date from the various shapes the APIs use:
 *   "17/10/2026" (AGMARKNET arrival_date) · "2026-10-17" (ISO) · Date objects.
 * Returns a Date or null — never an "Invalid Date".
 */
function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
const dateLabel = (v) => {
  const d = parseDate(v);
  return d ? d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : '—';
};
const shortDate = (v) => {
  const d = parseDate(v);
  return d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';
};

/**
 * Shrink a data-URL photo so it stays under `maxBytes` (default 1 MB).
 * A crop leaf is perfectly diagnosable at ~1 MB, and small payloads upload to
 * Cloudinary reliably — which is what puts the photo in the diagnosis history.
 * Photos already under the limit are returned untouched.
 */
/** Read a picked File into a data URL. */
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
}

function shrinkImage(dataUrl, maxBytes = 1024 * 1024) {
  return new Promise((resolve) => {
    try {
      const comma = dataUrl.indexOf(',');
      const approxBytes = Math.ceil((dataUrl.length - comma - 1) * 0.75);
      if (approxBytes <= maxBytes) return resolve(dataUrl);
      const img = new Image();
      img.onload = () => {
        try {
          const MAX = 1280;
          let w = img.width;
          let h = img.height;
          const scale = Math.min(1, MAX / Math.max(w, h));
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          let q = 0.85;
          let out = canvas.toDataURL('image/jpeg', q);
          // base64 is ~4/3 of the byte size
          while (out.length > maxBytes * 1.34 && q > 0.4) {
            q -= 0.12;
            out = canvas.toDataURL('image/jpeg', q);
          }
          resolve(out);
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch {
      resolve(dataUrl);
    }
  });
}

/* ── dates: the app speaks dd/mm/yyyy (Indian convention) ── */
/** "18/10/2026" → "2026-10-18" ('' when unparseable) */
function toIsoDate(dmy) {
  const m = String(dmy || '').trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (!m) return '';
  const d = Number(m[1]);
  const mo = Number(m[2]);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return '';
  return `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
/** "2026-10-18" → "18/10/2026" */
function toDmyDate(iso) {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
/** A dd/mm/yyyy text field with a calendar button that opens the native picker. */
function dateFieldHtml(id, value) {
  return `<div class="date-field">
    <input type="text" id="${id}" inputmode="numeric" autocomplete="off" placeholder="dd/mm/yyyy" value="${esc(value || '')}" />
    <button type="button" class="date-pick" data-date-target="${id}" aria-label="${esc(t('crop_pick_date'))}">${ICONS.calendar}</button>
    <input type="date" id="${id}-native" class="date-native" tabindex="-1" aria-hidden="true" />
  </div>`;
}
function initDateField(id) {
  const text = document.getElementById(id);
  const native = document.getElementById(id + '-native');
  const btn = document.querySelector(`[data-date-target="${id}"]`);
  if (!text || !native || !btn) return;
  text.addEventListener('input', () => {
    const digits = text.value.replace(/\D/g, '').slice(0, 8);
    let out = digits.slice(0, 2);
    if (digits.length > 2) out += '/' + digits.slice(2, 4);
    if (digits.length > 4) out += '/' + digits.slice(4, 8);
    text.value = out;
  });
  btn.addEventListener('click', () => {
    const iso = toIsoDate(text.value);
    if (iso) native.value = iso;
    try { native.showPicker(); } catch { try { native.click(); } catch {} }
  });
  native.addEventListener('change', () => {
    if (native.value) text.value = toDmyDate(native.value);
  });
}

/** up / down / flat — used to colour the price chart. */
function trendTone(values) {
  if (!values || values.length < 2 || !values[0]) return 'flat';
  const pct = ((values[values.length - 1] - values[0]) / values[0]) * 100;
  if (pct > 2) return 'up';
  if (pct < -2) return 'down';
  return 'flat';
}
function seasonOf(d = new Date()) {
  const m = d.getMonth();
  if (m >= 5 && m <= 9) return 'Kharif';
  if (m === 10 || m === 11 || m <= 2) return 'Rabi';
  return 'Zaid';
}
function toast(msg, ms = 3400) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.innerHTML = `<span class="toast-ic">${ICONS.check}</span><span class="toast-text">${esc(msg)}</span>`;
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), ms);
}

/* ── tiny Markdown renderer for AI replies (escaped, so safe) ── */
function mdToHtml(md) {
  const lines = String(md || '').split(/\r?\n/);
  const out = [];
  let i = 0;
  const inline = (s) =>
    s
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
      .replace(/~~(.+?)~~/g, '<del>$1</del>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  const splitRow = (line) => {
    let v = line.trim().replace(/\\\|/g, '\u0001');
    if (v.startsWith('|')) v = v.slice(1);
    if (v.endsWith('|')) v = v.slice(0, -1);
    return v.split('|').map((c) => c.replace(/\u0001/g, '|').trim());
  };
  const isSeparator = (line) => {
    const cells = splitRow(line);
    return cells.length >= 1 && cells.some((c) => c.includes('-')) && cells.every((c) => /^:?-+:?$/.test(c));
  };
  const isList = (l) => /^\s*[-*•]\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l);
  const isBlockStart = (l) =>
    !l.trim() || isList(l) || /^#{1,4}\s/.test(l) || l.trim().startsWith('```') || /^\s*>/.test(l) || /^(-{3,}|\*{3,}|_{3,})$/.test(l.trim());

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) buf.push(lines[i++]);
      i++;
      out.push(`<pre class="md-pre"><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = Math.min(h[1].length + 2, 4);
      out.push(`<h${level} class="md-h">${inline(esc(h[2]))}</h${level}>`);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      out.push('<hr class="md-hr"/>');
      i++;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
      // The assistant is asked never to use tables; if one slips through we
      // render it as readable bullet lines instead of a table that cannot fit
      // on a phone screen.
      out.push(
        '<ul class="md-ul">' +
          rows.map((r) => {
            const first = r[0] || '';
            const rest = r.slice(1).filter(Boolean);
            return '<li>' + (first ? `<strong>${inline(esc(first))}</strong>` : '') +
              (rest.length ? (first ? ' — ' : '') + rest.map((c) => inline(esc(c))).join(' · ') : '') + '</li>';
          }).join('') +
        '</ul>'
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote class="md-quote">${inline(esc(buf.join('\n'))).replace(/\n/g, '<br/>')}</blockquote>`);
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i]))
        items.push(`<li>${inline(esc(lines[i++].replace(/^\s*[-*•]\s+/, '')))}</li>`);
      out.push(`<ul class="md-ul">${items.join('')}</ul>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]))
        items.push(`<li>${inline(esc(lines[i++].replace(/^\s*\d+[.)]\s+/, '')))}</li>`);
      out.push(`<ol class="md-ol">${items.join('')}</ol>`);
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para = [];
    while (i < lines.length && !isBlockStart(lines[i]) && !(lines[i].includes('|') && i + 1 < lines.length && isSeparator(lines[i + 1])))
      para.push(inline(esc(lines[i++])));
    out.push(`<p class="md-p">${para.join('<br/>')}</p>`);
  }
  return out.join('\n');
}

/* ── price chart ────────────────────────────────── */
let _chartId = 0;
function priceChart(values, labels, opts = {}) {
  const w = opts.w || 640;
  const h = opts.h || 170;
  if (!values || values.length < 2) return `<p class="muted small">—</p>`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padL = 10, padR = 10, padT = 16, padB = 24;
  const x = (i) => padL + (i / (values.length - 1)) * (w - padL - padR);
  const y = (v) => padT + (1 - (v - min) / range) * (h - padT - padB);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const area = `${padL},${h - padB} ${pts.join(' ')} ${w - padR},${h - padB}`;
  const last = pts[pts.length - 1].split(',');
  const change = values[0] ? Math.round(((values[values.length - 1] - values[0]) / values[0]) * 100) : 0;
  const gid = 'cg' + ++_chartId;
  const tone = opts.tone || trendTone(values);
  const toneColor = tone === 'up' ? 'var(--brand-500)' : tone === 'down' ? 'var(--danger-500)' : 'var(--accent-500)';
  return `<figure class="chart chart-${tone}">
    <svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Price trend">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${toneColor}" stop-opacity="0.34"/>
        <stop offset="100%" stop-color="${toneColor}" stop-opacity="0"/>
      </linearGradient></defs>
      <line class="chart-grid" x1="${padL}" y1="${y(max)}" x2="${w - padR}" y2="${y(max)}"/>
      <line class="chart-grid" x1="${padL}" y1="${y(min)}" x2="${w - padR}" y2="${y(min)}"/>
      <polygon points="${area}" fill="url(#${gid})"/>
      <polyline class="chart-line" points="${pts.join(' ')}"/>
      <circle class="chart-dot" cx="${last[0]}" cy="${last[1]}" r="4.5"/>
    </svg>
    <div class="chart-axis"><span>${esc(labels[0] || '')}</span><span>${esc(labels[labels.length - 1] || '')}</span></div>
    <figcaption class="chart-legend">
      <span class="muted small">${inr(min)} – ${inr(max)}</span>
      <span class="badge ${tone === 'up' ? 'badge-ok' : tone === 'down' ? 'badge-danger' : 'badge-warn'}">${tone === 'up' ? '▲' : tone === 'down' ? '▼' : '●'} ${Math.abs(change)}% ${t('home_change')}</span>
    </figcaption>
  </figure>`;
}

/* ── remembered weather + local history ─────────── */
function saveWeatherMemory(data) {
  try {
    localStorage.setItem(
      'ks_weather_last',
      JSON.stringify({
        place: data.location && data.location.name,
        admin: (data.location && data.location.admin) || '',
        temp: data.current && Math.round(data.current.temp),
        desc: data.current && data.current.description,
        humidity: data.current && Math.round(data.current.humidity),
        wind: data.current && Math.round(data.current.wind),
        code: data.current && data.current.weatherCode,
        days: (data.days || []).slice(0, 7),
        alertCount: (data.days || []).reduce((n, d) => n + (d.alerts ? d.alerts.length : 0), 0),
        at: Date.now(),
      })
    );
  } catch {}
}
function readWeatherMemory() {
  try {
    const raw = localStorage.getItem('ks_weather_last');
    if (!raw) return null;
    const m = JSON.parse(raw);
    return Date.now() - m.at < 6 * 60 * 60 * 1000 ? m : null;
  } catch {
    return null;
  }
}

/* Full diagnoses are kept (not just the headline) so a history entry can be
   re-opened in full. The photo lives in Cloudinary; only its URL is stored. */
function saveLocalDiagnosis(d, imageUrl) {
  try {
    const arr = JSON.parse(localStorage.getItem('ks_diag_history') || '[]');
    arr.unshift({
      id: 'd' + Date.now().toString(36),
      at: new Date().toISOString(),
      crop: d.cropGuess || '',
      problem: d.problem || '',
      severity: d.severity || '',
      confidence: d.confidence || '',
      symptoms: d.symptoms || '',
      organicTreatment: d.organicTreatment || '',
      chemicalTreatment: d.chemicalTreatment || '',
      prevention: d.prevention || '',
      ifHealthy: d.ifHealthy || '',
      disclaimer: d.disclaimer || '',
      imageUrl: imageUrl || null,
    });
    localStorage.setItem('ks_diag_history', JSON.stringify(arr.slice(0, 30)));
  } catch {}
}
function readLocalDiagnoses() {
  try {
    return JSON.parse(localStorage.getItem('ks_diag_history') || '[]');
  } catch {
    return [];
  }
}

/** Fold diagnoses pulled from Firestore into the on-device list. */
function mergeCloudDiagnoses(cloud) {
  const local = readLocalDiagnoses();
  const seen = new Set(local.map((x) => `${x.problem}|${x.imageUrl || x.at}`));
  (cloud || []).forEach((c) => {
    const item = {
      id: c.id || 'c' + Math.random().toString(36).slice(2),
      at: c.createdAt || c.at || '',
      crop: c.crop || '',
      problem: c.problem || '',
      severity: c.severity || '',
      confidence: c.confidence || '',
      symptoms: c.symptoms || '',
      organicTreatment: c.organicTreatment || '',
      chemicalTreatment: c.chemicalTreatment || '',
      prevention: c.prevention || '',
      ifHealthy: c.ifHealthy || '',
      disclaimer: c.disclaimer || '',
      imageUrl: c.imageUrl || null,
    };
    const key = `${item.problem}|${item.imageUrl || item.at}`;
    if (!seen.has(key)) {
      seen.add(key);
      local.push(item);
    }
  });
  local.sort((a, b) => (a.at < b.at ? 1 : -1));
  try {
    localStorage.setItem('ks_diag_history', JSON.stringify(local.slice(0, 30)));
  } catch {}
  return local;
}

/* ── price history (merges the API trend with stored daily snapshots) ── */
function mergePriceHistory(commodity, state, trend) {
  const key = `ks_price_hist_${(commodity || '').toLowerCase()}_${(state || '').toLowerCase()}`;
  let hist = [];
  try {
    hist = JSON.parse(localStorage.getItem(key) || '[]');
  } catch {}
  const byDate = new Map(hist.map((h) => [h.date, h.avg]));
  (trend || []).forEach((tr) => {
    if (tr && tr.date) byDate.set(tr.date, tr.avgPrice);
  });
  const merged = [...byDate.entries()].map(([date, avg]) => ({ date, avg })).sort((a, b) => (a.date < b.date ? -1 : 1));
  const trimmed = merged.slice(-40);
  try {
    localStorage.setItem(key, JSON.stringify(trimmed));
  } catch {}
  return trimmed;
}

/* ── voice capture (with a real stop()) ─────────── */
function createVoiceCapture({ onText, onInterim, onState }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const canRecord = typeof window.MediaRecorder !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;

  async function ensureMicPermission() {
    if (typeof window.isSecureContext !== 'undefined' && !window.isSecureContext) {
      toast('Voice needs the app opened on localhost or HTTPS. Then allow the microphone.', 9000);
      return false;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch (e) {
      if (e && e.name === 'NotAllowedError') toast('Microphone is blocked. Allow it in the site settings, then tap the mic again.', 9000);
      else toast('Microphone error: ' + ((e && e.name) || 'unknown'), 6000);
      return false;
    }
  }

  let activeRecorder = null;
  let activeStream = null;

  async function recordAndTranscribe(baseText) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    activeStream = stream;
    try {
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      activeRecorder = mr;
      const chunks = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise((resolve) => { mr.onstop = () => resolve(new Blob(chunks, { type: mr.mimeType || 'audio/webm' })); });
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      let spoke = false, silentSince = Date.now(), done = false;
      const startedAt = Date.now();
      const stopAll = () => { if (done) return; done = true; try { if (mr.state !== 'inactive') mr.stop(); } catch {} };
      const tick = () => {
        if (done) return;
        analyser.getFloatTimeDomainData(buf);
        const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
        if (rms > 0.015) { spoke = true; silentSince = Date.now(); }
        else if (spoke && Date.now() - silentSince > 3000) return stopAll();
        if (Date.now() - startedAt > 20000) return stopAll();
        setTimeout(tick, 150);
      };
      mr.start();
      tick();
      const blob = await stopped;
      try { await ctx.close(); } catch {}
      if (!blob.size) return;
      const res = await fetch('/api/voice/transcribe', { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || 'Voice transcription failed.');
      const text = (data.text || '').trim();
      if (text) onText && onText((baseText ? baseText + ' ' : '') + text);
    } finally {
      stream.getTracks().forEach((t) => t.stop());
      activeRecorder = null;
      activeStream = null;
    }
  }

  async function runRecordingEngine(baseText) {
    onState && onState(true);
    try { await recordAndTranscribe(baseText); }
    catch (e) { toast(e.message || 'Voice failed — please type your question.', 6000); }
    finally { onState && onState(false); }
  }

  if (!SR) {
    return {
      isListening: () => Boolean(activeRecorder),
      async start(opts = {}) {
        if (!canRecord) { toast('Voice input is not supported by this browser.', 6000); return; }
        if (!(await ensureMicPermission())) return;
        await runRecordingEngine((opts.baseText || '').trim());
      },
      stop() { try { if (activeRecorder && activeRecorder.state !== 'inactive') activeRecorder.stop(); } catch {} },
    };
  }

  const rec = new SR();
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.continuous = false;

  let listening = false, finalText = '', baseText = '', silenceTimer = null, switchingEngines = false;
  const clearSilence = () => { if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; } };
  const armSilence = () => {
    clearSilence();
    silenceTimer = setTimeout(() => { try { rec.stop(); } catch {} }, 3000);
  };

  rec.onstart = () => { listening = true; onState && onState(true); armSilence(); };
  rec.onend = () => {
    clearSilence();
    listening = false;
    if (!switchingEngines) onState && onState(false);
    if (finalText.trim()) {
      const text = (baseText ? baseText + ' ' : '') + finalText.trim();
      onText && onText(text);
      finalText = '';
    }
  };
  rec.onerror = (e) => {
    clearSilence();
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    if ((e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture' || e.error === 'network') && canRecord) {
      switchingEngines = true;
      runRecordingEngine(baseText).finally(() => { switchingEngines = false; });
      return;
    }
    toast('Voice: ' + e.error, 6000);
  };
  rec.onresult = (ev) => {
    let interim = '';
    finalText = '';
    for (let i = 0; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    armSilence();
    if (interim && onInterim) onInterim((baseText ? baseText + ' ' : '') + interim);
  };

  return {
    isListening: () => listening,
    async start(opts = {}) {
      if (listening) return;
      if (!(await ensureMicPermission())) return;
      baseText = (opts.baseText || '').trim();
      finalText = '';
      rec.lang = opts.lang || getSpeechLang();
      try { rec.start(); } catch {}
    },
    stop() {
      clearSilence();
      try { rec.stop(); } catch {}
      listening = false;
      onState && onState(false);
    },
  };
}

/** Wire a mic button so it toggles, and stops on any tap outside it. */
function wireMic(btn, voice, onStart) {
  if (!voice) { btn.classList.add('hidden'); return; }
  btn.addEventListener('click', () => {
    if (voice.isListening()) voice.stop();
    else onStart();
  });
  document.addEventListener('pointerdown', (e) => {
    if (voice.isListening() && !btn.contains(e.target)) voice.stop();
  }, true);
}

/* ══════════ crop-cycle building blocks ══════════ */
/* Each stage carries its own data-stage so the stylesheet can give it the
   colour of that phase of the crop's life (see .cycle-stage in styles.css).
   The bar takes the CURRENT stage's colour. Home and My Farm both render
   through here, so the two stay identical. */
function cycleHtml(st) {
  return `<div class="cycle" data-stage="${st.stageIndex}">
    <div class="cycle-bar"><span style="width:${Math.round(st.progress * 100)}%"></span></div>
    <div class="cycle-stages">
      ${CROP_STAGES.map((s, i) => `<span class="cycle-stage${i === st.stageIndex ? ' active' : ''}${i < st.stageIndex ? ' done' : ''}" data-stage="${i}">
        <i>${ICONS[s.icon]}</i><em><span class="st-long">${t(s.key)}</span><span class="st-short">${t('stage_short_' + s.key.replace('stage_', ''))}</span></em></span>`).join('')}
    </div>
  </div>`;
}

/** Sowing + crop duration → an approximate harvest date (used when the
 *  farmer leaves the harvest date blank, which is common). */
function estimateHarvest(commodity, sowingDate) {
  const d = parseDate(sowingDate);
  if (!d || !commodity) return '';
  const h = new Date(d.getTime() + cropDays(commodity) * 86400000);
  return h.toISOString().slice(0, 10);
}

/** The crop's harvest date, real or estimated. */
function harvestInfo(crop) {
  if (crop.expectedHarvestDate) return { date: crop.expectedHarvestDate, estimated: false };
  const est = estimateHarvest(crop.commodity, crop.sowingDate);
  return est ? { date: est, estimated: true } : null;
}

/** Shared sub-title line for a crop card. */
function cropSubHtml(crop) {
  const bits = [];
  if (crop.area) bits.push(crop.area + ' ' + esc(crop.areaUnit));
  if (crop.sowingDate) bits.push(t('crop_sowing') + ' ' + shortDate(crop.sowingDate));
  const hi = harvestInfo(crop);
  if (hi) bits.push(t('crop_harvest') + ' ' + shortDate(hi.date) + (hi.estimated ? ' (' + t('crop_estimated') + ')' : ''));
  return bits.join(' · ');
}

function cropCardHtml(crop) {
  const st = cropStage(crop);
  const cost = store.totalCost(crop);
  const perQ = store.costPerQuintal(crop);
  const ready = st.daysToHarvest !== null && st.daysToHarvest <= 0;
  return `<section class="card crop-card">
    <div class="crop-head">
      <span class="crop-badge">${ICONS.sprout}</span>
      <div class="crop-title">
        <div class="crop-name-row">
          <h3>${esc(crop.commodity)}${crop.variety ? ' · ' + esc(crop.variety) : ''}</h3>
          <span class="badge stage-badge" data-stage="${st.stageIndex}">${t(st.stage.key)}</span>
        </div>
        <p class="muted small">${cropSubHtml(crop)}</p>
      </div>
    </div>
    ${cycleHtml(st)}
    <div class="crop-stats">
      <div><strong>${st.daysSince}</strong><span>${t('crop_days_since')}</span></div>
      <div><strong>${ready ? '✓' : st.daysToHarvest ?? '—'}</strong><span>${ready ? t('crop_ready') : t('crop_days_to')}</span></div>
      <div><strong>${cost ? inr(perQ) : '—'}</strong><span>${t('cost_per_quintal')}</span></div>
    </div>
    <div class="crop-foot">
      <a class="btn btn-outline btn-sm" href="#/farm">${ICONS.sliders} ${t('farm_edit_crop')}</a>
      <a class="btn btn-amber btn-sm" href="#/sell">${ICONS.scale} ${t('sell_advice')}</a>
    </div>
  </section>`;
}

/** onFarm → the button opens the crop form instead of linking to #/farm
 *  (on the farm page a link to #/farm would do nothing). */
function emptyCropCardHtml(onFarm) {
  const action = onFarm
    ? `<button class="btn btn-primary" type="button" id="add-crop-empty">${ICONS.plus} ${t('home_add_first_crop')}</button>`
    : `<a class="btn btn-primary" href="#/farm">${ICONS.plus} ${t('home_add_first_crop')}</a>`;
  return `<section class="card empty-card">
    <div class="empty-art">${ICONS.sprout}</div>
    <h3>${t('farm_no_crops')}</h3>
    <p class="muted">${t('farm_no_crops_desc')}</p>
    ${action}
  </section>`;
}

function cropManageCardHtml(crop) {
  const st = cropStage(crop);
  const cost = store.totalCost(crop);
  const perQ = store.costPerQuintal(crop);
  const exps = crop.expenses || [];
  return `<section class="card crop-card">
    <div class="crop-head">
      <span class="crop-badge">${ICONS.sprout}</span>
      <div class="crop-title">
        <div class="crop-name-row">
          <h3>${esc(crop.commodity)}${crop.variety ? ' · ' + esc(crop.variety) : ''}</h3>
          <span class="badge stage-badge" data-stage="${st.stageIndex}">${t(st.stage.key)}</span>
        </div>
        <p class="muted small">${cropSubHtml(crop)}${crop.expectedYield ? ' · ' + crop.expectedYield + ' q' : ''}</p>
      </div>
      <div class="crop-actions">
        <button class="icon-btn" type="button" data-edit-crop="${crop.id}" title="${t('farm_edit_crop')}" aria-label="${t('farm_edit_crop')}">${ICONS.sliders}</button>
        <button class="icon-btn" type="button" data-del-crop="${crop.id}" title="${t('farm_delete_crop')}" aria-label="${t('farm_delete_crop')}">${ICONS.trash}</button>
      </div>
    </div>
    ${cycleHtml(st)}
    <div class="cost-block">
      <div class="cost-head"><h4>${ICONS.rupee} ${t('cost_title')}</h4><strong>${inr(cost)}</strong></div>
      ${exps.length
        ? `<ul class="cost-list">${exps.map((e) => `<li>
            <span class="cost-cat">${ICONS.coins}</span>
            <span class="cost-label">${esc(e.label)}</span>
            <span class="cost-amt">${inr(e.amount)}</span>
            <button class="cost-del" type="button" data-del-exp="${e.id}" data-crop="${crop.id}" title="${t('cost_remove')}" aria-label="${t('cost_remove')}">${ICONS.close}</button>
          </li>`).join('')}</ul>`
        : `<p class="muted small">${t('cost_none')}</p>`}
      <form class="cost-add" data-crop="${crop.id}">
        <input class="cost-item-in" placeholder="${t('cost_item')}" list="exp-cats" />
        <input class="cost-amt-in" type="number" min="0" inputmode="numeric" placeholder="${t('cost_amount')}" />
        <button class="btn btn-primary btn-sm" type="submit">${ICONS.plus} ${t('common_add')}</button>
      </form>
      <p class="cost-per muted small">${t('cost_per_quintal')}: <strong>${perQ ? inr(perQ) : '—'}</strong></p>
    </div>
  </section>`;
}

/* ══════════ HOME — personalised dashboard ══════════ */
export function renderHome(user, guest) {
  const farm = store.getFarm();
  const p = farm.profile;
  const crops = farm.crops || [];
  const now = new Date();
  const dateStr = now.toLocaleDateString(getLang() === 'en' ? 'en-IN' : getLang(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const season = seasonOf(now);
  const who = (p.name || (user && (user.displayName || user.email)) || '').split(' ')[0].split('@')[0];
  const wxPlace = [p.district, p.state].filter(Boolean).join(', ');
  const actions = [
    ['market', 'handshake', t('nav_direct_selling'), '#/market'],
    ['ai', 'chat', t('nav_chat'), '#/chat'],
    ['weather', 'cloudSun', t('nav_weather'), '#/weather'],
    ['sell', 'scale', t('nav_sell'), '#/sell'],
    ['farm', 'sprout', t('nav_farm'), '#/farm'],
    ['schemes', 'scroll', t('nav_schemes'), '#/schemes'],
  ];

  return `
  <div class="page page-home">
    <section class="greet">
      <div class="greet-copy">
        <p class="greet-hi">${ICONS.sprout} ${t('home_hello')}${who ? ', ' + esc(who) : ''}</p>
        <h1>${season} · ${esc(dateStr)}</h1>
        <p class="muted">${p.district ? esc(p.district) + ', ' : ''}${p.state ? esc(p.state) : t('set_place')}</p>
        ${!p.state ? `<a class="btn btn-primary btn-sm" href="#/farm" style="margin-top:.5rem">${ICONS.plus} ${t('farm_profile')}</a>` : ''}
      </div>
      <img class="greet-art" src="assets/farm-hero.svg" alt="" width="150" height="112" />
    </section>

    <section class="voice-hero">
      <button class="voice-hero-btn" type="button" data-voice-open aria-label="${esc(t('home_voice_title'))}">
        <span class="voice-hero-orb">${ICONS.mic}</span>
        <span class="voice-hero-copy">
          <span class="voice-hero-kicker">${esc(t('home_voice_kicker'))}</span>
          <strong>${esc(t('home_voice_title'))}</strong>
          <span class="voice-hero-sub">${esc(t('home_voice_desc'))}</span>
        </span>
        <span class="voice-hero-go" aria-hidden="true">${ICONS.chevronRight}</span>
      </button>
    </section>

    <h2 class="section-title">${ICONS.sprout} ${t('home_crop_cycle')}</h2>
    ${crops.length
      ? `<section class="crop-grid">${crops.map(cropCardHtml).join('')}</section>`
      : emptyCropCardHtml()}

    <div class="home-row">
      <div class="home-col">
        <h2 class="section-title">${ICONS.cloudSun} ${t('home_weather')}</h2>
        <section class="card dash-weather">
          <div class="dash-head">
            <span class="dash-head-t" id="home-wx-title">${wxPlace ? esc(wxPlace) : t('home_weather')}</span>
            <span class="dash-today">${t('home_today')}</span>
          </div>
          <div class="dash-body"><div class="loading-sm">${t('common_loading')}</div></div>
        </section>
      </div>
      <div class="home-col">
        <h2 class="section-title">${ICONS.store} ${t('home_mandi_details')}</h2>
        <section class="card dash-price">
          <div class="dash-head">
            <span class="dash-head-t">${ICONS.store} ${t('live_prices')}</span>
            ${crops.length > 1 ? `<select class="dash-select" id="home-price-crop" aria-label="${t('sell_select_crop')}">${crops.map((c) => `<option value="${c.id}">${esc(c.commodity)}</option>`).join('')}</select>` : ''}
          </div>
          <div class="dash-body"><div class="loading-sm">${t('common_loading')}</div></div>
        </section>
      </div>
    </div>

    <div class="home-row">
      <div class="home-col">
        <h2 class="section-title">${ICONS.sparkles} ${t('home_quick')}</h2>
        <section class="card dash-actions">
          <div class="dash-head">${ICONS.sprout} ${t('home_quick_card')}</div>
          <div class="dash-body">
            ${actions.map(([id, ic, label, href]) => `<a class="app-item" href="${href}">
              <span class="app-tile app-tile-${id}">${ICONS[ic]}</span>
              <span class="app-label">${esc(label)}</span>
            </a>`).join('')}
          </div>
        </section>
      </div>
      <div class="home-col">
        <h2 class="section-title">${ICONS.shield} ${t('home_advisory')}</h2>
        <section class="card" id="home-advisory">
          <h2 class="dash-head">${ICONS.listChecks} ${t('home_advisory_card')}</h2>
          <div class="loading-sm">${t('common_loading')}</div>
        </section>
      </div>
    </div>
  </div>`;
}

export function wireHome(user) {
  const farm = store.getFarm();
  const p = farm.profile;
  const crops = farm.crops || [];
  const primary = crops[0];

  /* weather widget */
  (async () => {
    const el = document.querySelector('.dash-weather .dash-body');
    if (!el) return;
    // The farm profile wins; otherwise fall back to the last place searched.
    const mem = readWeatherMemory();
    const place = [p.district, p.state].filter(Boolean).join(', ') || (mem && mem.place) || '';
    try {
      const data = place ? await getWeather({ place }) : null;
      if (data) {
        saveWeatherMemory(data);
        const days = data.days.slice(0, 3);
        const today = data.days[0] || {};
        const alerts = [];
        data.days.forEach((d) => (d.alerts || []).forEach((a) => alerts.push({ date: d.date, ...a })));
        const titleEl = document.getElementById('home-wx-title');
        if (titleEl && data.location && data.location.name) titleEl.textContent = data.location.name;
        else if (titleEl && !titleEl.textContent.trim()) titleEl.textContent = data.location && data.location.name ? data.location.name : '';
        el.innerHTML = `
          <div class="wx-row">
            <span class="wx-now">${weatherIcon(data.current.weatherCode ?? data.days[0].weatherCode)}</span>
            <div class="wx-now-txt">
              <span class="wx-temp">${Math.round(data.current.temp)}°C</span>
              <span class="wx-desc muted small">${esc(data.current.description)}</span>
            </div>
          </div>
          <div class="wx-facts">
            <span><em>${t('weather_humidity')}</em><b>${Math.round(data.current.humidity)}%</b></span>
            <span><em>${t('weather_wind')}</em><b>${Math.round(data.current.wind)} km/h</b></span>
            <span><em>${t('weather_rain')}</em><b>${today.precipitationSum ?? 0} mm</b><span class="wx-sub">${today.rainChance ?? 0}% ${t('weather_chance')}</span></span>
          </div>
          <div class="wx-mini">
            ${days.map((d) => `<span class="wx-mini-day"><em>${shortDate(d.date)}</em>${weatherIcon(d.weatherCode)}<b>${d.tempMax}°</b></span>`).join('')}
          </div>
          ${alerts.length ? `<span class="dash-flag warn">${ICONS.warning} ${alerts.length} ${t('home_alerts')}</span>` : `<span class="dash-flag ok">${ICONS.check} ${t('weather_ok')}</span>`}
          <a class="dash-more" href="#/weather">${t('weather_forecast7')} →</a>`;
        return;
      }
    } catch {}
    el.innerHTML = `<p class="muted small">${t('set_place')}</p>
      <a class="btn btn-primary btn-sm" href="#/weather">${ICONS.pin} ${t('weather_find')}</a>`;
  })();

  /* price widget — the crop the farmer grows, with trend + price history */
  const priceSel = document.getElementById('home-price-crop');
  const priceBody = document.querySelector('.dash-price .dash-body');

  async function fillHomePrice(cropId) {
    if (!priceBody) return;
    const f = store.getFarm();
    const crop = (cropId && store.getCrop(cropId)) || (f.crops || [])[0] || null;
    let last = null;
    try { last = JSON.parse(localStorage.getItem('ks_mandi_last') || 'null'); } catch {}
    const commodity = (crop && crop.commodity) || (last && last.commodity) || '';
    const state = f.profile.state || (last && last.state) || '';
    if (!commodity) {
      priceBody.innerHTML = `<p class="muted small">${t('choose_crop')}</p>
        <a class="btn btn-primary btn-sm" href="#/farm">${ICONS.plus} ${t('home_add_first_crop')}</a>`;
      return;
    }
    priceBody.innerHTML = `<div class="loading-sm">${t('common_loading')}</div>`;
    try {
      const data = await getMandiPrices({ commodity, state });
      const s = data.summary;
      if (!s) throw new Error('no data');
      const hist = mergePriceHistory(commodity, state, s.trend);
      const vals = hist.map((h) => h.avg);
      const labels = hist.map((h) => shortDate(h.date));
      const tone = trendTone(vals);
      const change = vals.length > 1 && vals[0] ? Math.round(((vals[vals.length - 1] - vals[0]) / vals[0]) * 100) : 0;
      priceBody.innerHTML = `
        <div class="wx-row">
          <span class="mandi-price">${inr(s.avgModalPrice)}<span class="per">/quintal</span></span>
          <span class="trend-pill trend-${tone}">${tone === 'up' ? '▲' : tone === 'down' ? '▼' : '●'} ${Math.abs(change)}%</span>
        </div>
        <div class="wx-desc">${esc(s.commodity)} · ${t('mandi_best')}: ${esc(s.bestMarket.market)}</div>
        ${vals.length > 1 ? priceChart(vals, labels, { w: 320, h: 110, tone }) : `<p class="muted small">${t('price_history_soon')}</p>`}
        <a class="dash-more" href="#/mandi">${t('mandi_avg')} →</a>`;
    } catch {
      priceBody.innerHTML = `<p class="muted small">${t('choose_crop')}</p>
        <a class="btn btn-primary btn-sm" href="#/mandi">${ICONS.store} ${t('mandi_show')}</a>`;
    }
  }
  fillHomePrice(priceSel ? priceSel.value : null);
  if (priceSel) priceSel.addEventListener('change', () => fillHomePrice(priceSel.value));

  /* advisory */
  (async () => {
    const el = document.getElementById('home-advisory');
    if (!el) return;
    const items = [];
    const mem = readWeatherMemory();
    if (mem && mem.days) {
      mem.days.forEach((d) => (d.alerts || []).forEach((a) => items.push({ icon: 'warning', level: a.level, title: a.title, body: a.advice, when: shortDate(d.date) })));
    }
    if (primary) {
      const st = cropStage(primary);
      // Advice is per stage, so the heading names the crop and the stage it is in.
      const advice = [t('advice_sowing'), t('advice_growth'), t('advice_flowering'), t('advice_ripening'), t('advice_harvest')][st.stageIndex];
      items.push({
        icon: st.stage.icon,
        level: 'info',
        title: `${primary.commodity} — ${t(st.stage.key)} ${t('crop_stage_label')}`,
        body: advice,
        when: '', // the card is already "what to do today"
      });
    }
    if (!items.length) {
      el.innerHTML = `<h2 class="dash-head">${ICONS.listChecks} ${t('home_advisory_card')}</h2><p class="muted small">${t('farm_no_crops_desc')}</p>`;
      return;
    }
    el.innerHTML = `<h2 class="dash-head">${ICONS.listChecks} ${t('home_advisory_card')}</h2>
      <ul class="advisory-list">${items.slice(0, 4).map((it) => `<li class="advisory ${it.level === 'danger' ? 'warn' : ''}">
        <span class="advisory-ic">${ICONS[it.icon] || ICONS.info}</span>
        <div><strong>${esc(it.title)}</strong>${it.when ? `<span class="advisory-when muted small">${esc(it.when)}</span>` : ''}<p>${esc(it.body)}</p></div>
      </li>`).join('')}</ul>`;
  })();
}

/* ══════════ CROP DOCTOR ══════════ */
export function renderCropDoctor() {
  return `
  <div class="page">
    <header class="page-header"><h1>${ICONS.leaf} ${t('nav_doctor')}</h1><p>${t('doctor_desc')}</p></header>
    <section class="card">
      <div class="upload-zone" id="dz" role="button" tabindex="0" aria-label="${t('doctor_choose')}">
        <div class="uz-icon">${ICONS.camera}</div>
        <p>${t('doctor_choose')}</p>
        <p class="muted small">JPG / PNG / WebP, up to ~4 MB. Close-up of the affected part works best.</p>
      </div>
      <input type="file" id="photo-input" accept="image/jpeg,image/png,image/webp" class="hidden" />
      <img id="photo-preview" class="upload-preview hidden" alt="Uploaded crop preview" />
      <div class="stack" style="margin-top:1.1rem">
        <label>${t('doctor_note')}<input type="text" id="diag-notes" placeholder="e.g. Tomato, yellow spots spreading for a week" /></label>
        <div class="btn-row">
          <button class="btn btn-primary" id="diag-submit" disabled>${ICONS.search} ${t('doctor_diagnose')}</button>
          <button class="btn btn-ghost btn-sm hidden" id="diag-reset">${t('doctor_choose')}</button>
        </div>
      </div>
    </section>
    <section id="diag-result"></section>
    <section id="diag-history"></section>
  </div>`;
}

/* ── "read aloud": the AI writes a short spoken summary, the browser speaks it ── */
let _spokenBtn = null;
function speakBtnLabel(btn, text) {
  const sp = btn.querySelector('span');
  if (sp) sp.textContent = text;
}
function resetSpeakBtn(btn) {
  if (!btn) return;
  btn.classList.remove('active');
  speakBtnLabel(btn, btn.dataset.speakLabel || t('speak'));
}
function stopSpeaking() {
  try { speechSynthesis.cancel(); } catch {}
  if (_spokenBtn) { resetSpeakBtn(_spokenBtn); _spokenBtn = null; }
}
function speakRawText(btn, raw) {
  if (!('speechSynthesis' in window)) { toast(t('speak_unsupported')); resetSpeakBtn(btn); return; }
  const clean = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!clean) { resetSpeakBtn(btn); return; }
  const parts = clean.match(/[^.!?\u0964]+[.!?\u0964]*/g) || [clean];
  const chunks = [];
  let buf = '';
  for (const part of parts) {
    if ((buf + part).length > 160) { if (buf.trim()) chunks.push(buf.trim()); buf = part; } else buf += part;
  }
  if (buf.trim()) chunks.push(buf.trim());
  const lang = getSpeechLang();
  _spokenBtn = btn;
  btn.classList.add('active');
  speakBtnLabel(btn, btn.dataset.stopLabel || t('stop'));
  chunks.forEach((chunk, i) => {
    const u = new SpeechSynthesisUtterance(chunk);
    u.lang = lang;
    const done = () => {
      if (i === chunks.length - 1 && _spokenBtn === btn) { resetSpeakBtn(btn); _spokenBtn = null; }
    };
    if (i === chunks.length - 1) u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  });
}
/** Read aloud: summarise with the AI first, then speak just that summary. */
async function toggleSpeakSummary(btn, text, fallback) {
  if (_spokenBtn === btn) { stopSpeaking(); return; }
  stopSpeaking();
  btn.disabled = true;
  speakBtnLabel(btn, t('summarising'));
  let summary = '';
  try {
    const r = await summariseText(String(text || '').slice(0, 4000), getLangName());
    summary = (r && r.summary) || '';
  } catch {}
  btn.disabled = false;
  speakRawText(btn, summary || fallback || text);
}
/** The standard read-aloud button. */
function speakButtonHtml(cls) {
  return `<button class="btn btn-outline btn-sm speak-btn ${cls || ''}" type="button"
    data-speak-label="${esc(t('speak'))}" data-stop-label="${esc(t('stop'))}">${ICONS.speaker} <span>${t('speak')}</span></button>`;
}
/** Wire every read-aloud button inside a rendered diagnosis. */
function wireDiagSpeak(root) {
  (root || document).querySelectorAll('.diag-speak, .sell-speak').forEach((btn) => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      const card = btn.closest('.card') || btn.parentElement;
      const text = Array.from(card.querySelectorAll('h2,h3,p,li,dd'))
        .filter((el) => !el.closest('.diag-actions'))
        .map((el) => el.textContent.trim())
        .filter(Boolean)
        .join('. ');
      toggleSpeakSummary(btn, text, text);
    });
  });
}

export function wireCropDoctor(user) {
  const dz = document.getElementById('dz');
  const input = document.getElementById('photo-input');
  const preview = document.getElementById('photo-preview');
  const submit = document.getElementById('diag-submit');
  const reset = document.getElementById('diag-reset');
  const result = document.getElementById('diag-result');
  let dataUrl = null;

  try {
    const last = JSON.parse(sessionStorage.getItem('ks_last_diag') || 'null');
    if (last && last.d) { result.innerHTML = renderDiagnosisCard(last.d, last.imageUrl, false); wireDiagSpeak(result); }
  } catch {}

  const pick = () => input.click();
  dz.addEventListener('click', pick);
  dz.addEventListener('keydown', (e) => e.key === 'Enter' && pick());

  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { toast(t('doctor_too_large')); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      // A crop leaf is diagnosable well under 1 MB, so shrink big photos
      // before sending: faster upload, and the Cloudinary upload (which is
      // what puts the photo in your history) succeeds reliably.
      dataUrl = await shrinkImage(reader.result, 1024 * 1024);
      preview.src = dataUrl;
      preview.classList.remove('hidden');
      dz.classList.add('hidden');
      submit.disabled = false;
      reset.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  });

  reset.addEventListener('click', () => {
    dataUrl = null;
    input.value = '';
    preview.classList.add('hidden');
    dz.classList.remove('hidden');
    submit.disabled = true;
    reset.classList.add('hidden');
    result.innerHTML = '';
    sessionStorage.removeItem('ks_last_diag');
  });

  submit.addEventListener('click', async () => {
    if (!dataUrl) return;
    submit.disabled = true;
    submit.textContent = t('doctor_analysing');
    result.innerHTML = `<div class="card"><div class="loading-block">${t('doctor_analysing')}</div></div>`;
    try {
      const notes = document.getElementById('diag-notes').value.trim();
      const { diagnosis: d, imageUrl, stored } = await diagnosePhoto(dataUrl, notes, getLangName());
      result.innerHTML = renderDiagnosisCard(d, imageUrl, stored);
      wireDiagSpeak(result);
      saveLocalDiagnosis(d, imageUrl);
      try { sessionStorage.setItem('ks_last_diag', JSON.stringify({ d, imageUrl: imageUrl || null })); } catch {}
      if (user) { try { await saveDiagnosis(d, imageUrl); } catch (e) { console.warn('Save failed', e); } }
      renderDiagHistory();
    } catch (err) {
      result.innerHTML = `<div class="card"><div class="form-error">${esc(err.message)}</div></div>`;
    } finally {
      submit.disabled = false;
      submit.innerHTML = `${ICONS.search} ${t('doctor_diagnose')}`;
    }
  });

  renderDiagHistory();

  // Signed-in farmers also pull their saved diagnoses (with Cloudinary photos)
  // back from Firestore, so history survives a reinstall or a new phone.
  if (user) {
    loadDiagnoses(30)
      .then((list) => {
        if (list && list.length) {
          mergeCloudDiagnoses(list);
          renderDiagHistory();
        }
      })
      .catch(() => {});
  }
}

function sevBadge(sev) {
  const cls = sev === 'Severe' ? 'badge-danger' : sev === 'None' ? 'badge-ok' : 'badge-warn';
  return `<span class="badge ${cls}">${esc(sev || '—')}</span>`;
}

/* History: every past diagnosis, with its Cloudinary photo. Tap a row to
   open the full diagnosis in place. */
function renderDiagHistory() {
  const el = document.getElementById('diag-history');
  if (!el) return;
  const items = readLocalDiagnoses();
  if (!items.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<section class="card">
    <h2>${ICONS.clock} ${t('doctor_history')}</h2>
    <div class="diag-history-list">
      ${items.map((it, i) => `<article class="diag-hist">
        <button class="diag-hist-head" type="button" data-toggle="${i}" aria-expanded="false">
          <span class="diag-thumb">${it.imageUrl
            ? `<img class="diag-img" src="${esc(it.imageUrl)}" alt="" loading="lazy" />`
            : `<span class="diag-thumb-fallback">${ICONS.image}</span>`}</span>
          <span class="diag-hist-txt">
            <strong>${esc(it.problem || t('doctor_unknown'))}</strong>
            <span class="muted small">${esc(it.crop || '—')} · ${it.at ? shortDate(it.at.slice(0, 10)) : '—'}</span>
          </span>
          ${sevBadge(it.severity)}
          <span class="diag-hist-chev">${ICONS.chevronDown}</span>
        </button>
        <div class="diag-hist-body hidden" id="diag-body-${i}"></div>
      </article>`).join('')}
    </div>
    <button class="btn btn-ghost btn-sm" id="diag-clear" style="margin-top:0.8rem">${t('doctor_clear')}</button>
  </section>`;

  // broken / expired Cloudinary image → show a placeholder instead
  el.querySelectorAll('.diag-img').forEach((img) =>
    img.addEventListener('error', () => {
      img.parentElement.innerHTML = `<span class="diag-thumb-fallback">${ICONS.image}</span>`;
    })
  );

  el.querySelectorAll('[data-toggle]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.toggle);
      const body = document.getElementById('diag-body-' + i);
      const open = !body.classList.contains('hidden');
      if (open) {
        body.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
        return;
      }
      const it = items[i];
      body.innerHTML = renderDiagnosisCard(
        {
          cropGuess: it.crop, problem: it.problem, severity: it.severity, confidence: it.confidence,
          symptoms: it.symptoms, organicTreatment: it.organicTreatment, chemicalTreatment: it.chemicalTreatment,
          prevention: it.prevention, ifHealthy: it.ifHealthy, disclaimer: it.disclaimer,
        },
        it.imageUrl,
        false
      );
      wireDiagSpeak(body);
      body.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
    })
  );

  document.getElementById('diag-clear').addEventListener('click', () => {
    localStorage.removeItem('ks_diag_history');
    renderDiagHistory();
  });
}

/** "N/A", "none", "-" … → nothing worth showing. */
function isNA(v) {
  const x = String(v == null ? '' : v).trim().toLowerCase();
  return !x || x === 'n/a' || x === 'na' || x === 'none' || x === 'nil' || x === '-';
}
/** Plain text of a diagnosis — what we hand to the summariser / the voice. */
function diagnosisPlainText(d) {
  return [
    d.problem || '',
    d.symptoms && !isNA(d.symptoms) ? d.symptoms : '',
    d.organicTreatment && !isNA(d.organicTreatment) ? d.organicTreatment : '',
    d.chemicalTreatment && !isNA(d.chemicalTreatment) ? d.chemicalTreatment : '',
    d.prevention && !isNA(d.prevention) ? d.prevention : '',
    d.ifHealthy && !isNA(d.ifHealthy) ? d.ifHealthy : '',
  ].filter(Boolean).join('. ');
}

function renderDiagnosisCard(d, imageUrl, stored) {
  if (!d || d.isCropPhoto === false) {
    return `<section class="card"><h2>${ICONS.warning} ${t('diag_not_crop_title')}</h2>
      <p>${t('diag_not_crop_desc')}</p></section>`;
  }
  const sev = d.severity || 'None';
  const sevClass = /^severe$/i.test(sev) ? 'badge-danger' : /^none$/i.test(sev) ? 'badge-ok' : 'badge-warn';
  const li = (txt) => `<ul class="diag-list">${String(txt).split(/\n|\u2022/).filter((s) => s.trim()).map((s) => `<li><span>${esc(s.trim())}</span></li>`).join('')}</ul>`;
  const meta = [
    [t('diag_crop_label'), d.cropGuess || t('doctor_unknown'), 'badge-ok'],
    [t('diag_severity_label'), sev, sevClass],
    [t('diag_confidence_label'), d.confidence || '—', 'badge-warn'],
  ];
  return `<section class="card">
    <h2>${ICONS.flask} ${esc(d.problem || t('doctor_unknown'))}${stored ? ` <span class="badge badge-ok">${t('diag_saved')}</span>` : ''}</h2>
    <dl class="diag-meta">
      ${meta.map(([k, v, c]) => `<div><dt>${esc(k)}</dt><dd><span class="badge ${c}">${esc(v)}</span></dd></div>`).join('')}
    </dl>
    ${!isNA(d.symptoms) ? `<h3>${t('diag_what_ai_sees')}</h3><p>${esc(d.symptoms)}</p>` : ''}
    ${!isNA(d.organicTreatment) ? `<h3>${t('diag_organic')}</h3>${li(d.organicTreatment)}` : ''}
    ${!isNA(d.chemicalTreatment) ? `<h3>${t('diag_chemical')}</h3><p>${esc(d.chemicalTreatment)}</p>` : ''}
    ${!isNA(d.prevention) ? `<h3>${t('diag_prevention')}</h3><p>${esc(d.prevention)}</p>` : ''}
    ${!isNA(d.ifHealthy) ? `<h3>${t('diag_care')}</h3><p>${esc(d.ifHealthy)}</p>` : ''}
    <div class="diag-actions">${speakButtonHtml('diag-speak')}</div>
    <div class="alert alert-warning"><strong>${ICONS.shield} ${t('diag_important')}</strong><p>${esc(d.disclaimer || 'AI advice — verify with your local agriculture officer or KVK before major action.')}</p></div>
    ${imageUrl ? `<img class="upload-preview" src="${esc(imageUrl)}" alt="Diagnosed crop photo" />` : ''}
  </section>`;
}

/* ══════════ MANDI PRICES ══════════ */
export function renderMandi() {
  const farm = store.getFarm();
  const primary = (farm.crops || [])[0];
  const commodityField = renderCombobox({
    id: 'm-commodity',
    items: CROPS,
    common: COMMON_CROPS,
    value: primary ? primary.commodity : '',
    placeholder: t('crop_search_ph'),
    noMatch: t('crop_no_match'),
    moreHint: t('crop_more_hint'),
  });
  const stateOptions = STATES.map((s) => `<option value="${esc(s)}"${farm.profile.state === s ? ' selected' : ''}>${esc(s)}</option>`).join('');
  return `
  <div class="page">
    <header class="page-header"><h1>${ICONS.store} ${t('nav_mandi')}</h1><p>${t('mandi_desc')}</p></header>
    <section class="card">
      <form class="form-row" id="mandi-form">
        <label>${t('mandi_commodity')}*${commodityField}</label>
        <label>${t('mandi_state')}<select id="m-state"><option value="">All India</option>${stateOptions}</select></label>
        <label>${t('mandi_district')}<input type="text" id="m-district" placeholder="e.g. Kolkata" value="${esc(farm.profile.district || '')}" /></label>
        <div style="align-self:end"><button class="btn btn-primary" type="submit" style="width:100%">${ICONS.search} ${t('mandi_show')}</button></div>
      </form>
    </section>
    <section id="mandi-result"></section>
  </div>`;
}

export function wireMandi() {
  const form = document.getElementById('mandi-form');
  const result = document.getElementById('mandi-result');
  const commoditySel = document.getElementById('m-commodity');
  wireCombobox('m-commodity');
  const stateSel = document.getElementById('m-state');
  const districtInput = document.getElementById('m-district');
  const VIEW_KEY = 'ks_mandi_view';

  function attachAsk(data) {
    const askBtn = document.getElementById('mandi-ask-ai');
    if (!askBtn) return;
    askBtn.addEventListener('click', () => {
      const s = data.summary;
      const f = store.getFarm();
      const cropLines = (f.crops || [])
        .map((c) => {
          const bits = [c.commodity];
          if (c.area) bits.push(`${c.area} ${c.areaUnit}`);
          if (c.expectedYield) bits.push(`expected ${c.expectedYield} q`);
          const cost = store.totalCost(c);
          if (cost) bits.push(`cost ₹${cost}`);
          return bits.join(', ');
        })
        .join('; ');
      const where = [f.profile.district, f.profile.state].filter(Boolean).join(', ');
      const seed = `I am a farmer${where ? ' in ' + where : ''}.${cropLines ? ' My crops: ' + cropLines + '.' : ''} I am checking ${s.commodity} prices. Latest government mandi data: average modal price ${inr(s.avgModalPrice)}/quintal, range ${inr(s.minSeen)} to ${inr(s.maxSeen)}, best market ${s.bestMarket.market} at ${inr(s.bestMarket.modalPrice)}/quintal (${s.recordCount} records, latest arrival ${s.latestDate || 'recent'}). Explain what this means for me: when and where should I sell?`;
      try { sessionStorage.setItem('ks_chat_seed', seed); } catch {}
      location.hash = '#/chat';
    });
  }

  /* `fresh` = the farmer pressed "Show prices" → live figures. If the live
     fetch fails we quietly fall back to the server's cached copy. */
  async function run(commodity, state, district, remember, fresh) {
    result.innerHTML = `<div class="card"><div class="loading-block">${t('common_loading')}</div></div>`;
    try {
      let data;
      try {
        data = await getMandiPrices({ commodity, state, district, fresh });
      } catch (e) {
        if (!fresh) throw e;
        toast(t('mandi_fallback'), 5000);
        data = await getMandiPrices({ commodity, state, district, fresh: false });
      }
      result.innerHTML = renderMandiResults(data);
      attachAsk(data);
      try {
        sessionStorage.setItem(VIEW_KEY, JSON.stringify({ commodity, state, district, data }));
        if (remember) localStorage.setItem('ks_mandi_last', JSON.stringify({ commodity, state, district }));
      } catch {}
    } catch (err) {
      const kept = result.querySelector('.card');
      if (!kept) result.innerHTML = `<div class="card"><div class="form-error">${esc(err.message)}</div></div>`;
      else toast(err.message, 6000);
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const commodity = commoditySel.value;
    if (!commodity) return;
    run(commodity, stateSel.value, districtInput.value.trim(), true, true);
  });

  try {
    const view = JSON.parse(sessionStorage.getItem(VIEW_KEY) || 'null');
    if (view && view.data) {
      commoditySel.value = view.commodity || '';
      stateSel.value = view.state || '';
      districtInput.value = view.district || '';
      result.innerHTML = renderMandiResults(view.data);
      attachAsk(view.data);
      return;
    }
  } catch {}

  let last = null;
  try { last = JSON.parse(localStorage.getItem('ks_mandi_last') || 'null'); } catch {}
  if (last) {
    commoditySel.value = last.commodity || '';
    stateSel.value = last.state || '';
    districtInput.value = last.district || '';
  }
  const farm = store.getFarm();
  const primary = (farm.crops || [])[0];
  const auto = primary && primary.commodity ? { commodity: primary.commodity, state: farm.profile.state || '' } : last;
  if (auto && auto.commodity) run(auto.commodity, auto.state || '', (auto.district || ''), false, false);
}

/**
 * When the exact district had no data we widen the search (state, then all
 * India) — this banner tells the farmer what we did instead of showing
 * "no data found".
 */
function scopeNotice(scope, requested) {
  const r = requested || {};
  if (!scope || scope === 'none') return '';
  // What the farmer actually asked for.
  const askedScope = r.district ? 'district' : r.state ? 'state' : 'india';
  // We only widen when the requested area had nothing — searching exactly
  // what was asked for is not a "wider search".
  if (scope === askedScope) return '';
  const place = scope === 'state' ? (r.state || t('scope_india')) : t('scope_india');
  const asked = [r.district, r.state].filter(Boolean).join(', ') || place;
  return `<div class="alert alert-warning scope-notice">
    <span class="scope-title">${ICONS.info} ${t('mandi_wider_title')}</span>
    <p>${t('mandi_showing_for')} <b>${esc(place)}</b> — ${t('mandi_no_data_for')} ${esc(asked)}.</p>
  </div>`;
}

function renderMandiResults(data) {
  const s = data.summary;
  if (!s) return `<div class="card"><p>${t('mandi_no_records')}</p></div>`;
  const hist = mergePriceHistory(s.commodity, '', s.trend);
  const vals = hist.map((h) => h.avg);
  const labels = hist.map((h) => shortDate(h.date));

  return `
  <section class="card">
    <h2>${esc(s.commodity)} <span class="badge ${data.stale ? 'badge-warn' : data.cached ? 'badge-warn' : 'badge-ok'}">${data.stale ? t('mandi_stale') : data.cached ? t('mandi_cached') : t('mandi_live')}</span></h2>
    ${scopeNotice(data.scope, data.requested)}
    <p class="muted small">${t('mandi_latest')}: ${s.latestDate ? dateLabel(s.latestDate) : '—'} · ${s.recordCount} ${t('mandi_records')}</p>
    <div class="grid-2" style="margin-top:0.8rem">
      <div class="alert alert-info"><strong>${t('mandi_avg')}</strong><p class="big">${inr(s.avgModalPrice)} <span class="small muted">/quintal</span></p></div>
      <div class="alert alert-info"><strong>${t('mandi_range')}</strong><p class="big">${inr(s.minSeen)} – ${inr(s.maxSeen)}</p></div>
    </div>
    <div class="alert alert-warning"><strong>${t('mandi_best')}: ${esc(s.bestMarket.market)}</strong>
      <p>${inr(s.bestMarket.modalPrice)}/quintal · ${esc(s.worstMarket.market)}: ${inr(s.worstMarket.modalPrice)}</p></div>
    ${vals.length > 1 ? `<h3>${t('home_price_trend')}</h3>${priceChart(vals, labels, { w: 640, h: 190 })}` : ''}
  </section>

  <section class="card">
    <h2>${t('mandi_market_table')}</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>${t('mandi_col_market')}</th><th>${t('mandi_col_district')}</th><th>${t('mandi_col_min')}</th><th>${t('mandi_col_modal')}</th><th>${t('mandi_col_max')}</th><th>${t('mandi_col_date')}</th></tr></thead>
      <tbody>${data.records.map((r) => `<tr>
        <td>${esc(r.market)}</td><td>${esc(r.district)}</td>
        <td>${r.minPrice ? inr(r.minPrice) : '—'}</td>
        <td><strong>${r.modalPrice ? inr(r.modalPrice) : '—'}</strong></td>
        <td>${r.maxPrice ? inr(r.maxPrice) : '—'}</td>
        <td>${r.arrivalDate ? shortDate(r.arrivalDate) : ''}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div class="mandi-ask"><button class="btn btn-amber" id="mandi-ask-ai">${ICONS.chat} ${t('discuss_ai')}</button></div>
    <p class="muted small" style="margin-top:0.8rem">${t('sources')}: AGMARKNET via data.gov.in · ₹/quintal</p>
  </section>`;
}

/* ══════════ SELL ADVISOR ══════════ */
export function renderSell() {
  const farm = store.getFarm();
  const crops = farm.crops || [];
  if (!crops.length) {
    return `<div class="page">
      <header class="page-header"><h1>${ICONS.scale} ${t('nav_sell')}</h1><p>${t('sell_desc')}</p></header>
      <section class="card empty-card">
        <div class="empty-art">${ICONS.scale}</div>
        <h3>${t('sell_no_crop')}</h3>
        <a class="btn btn-primary" href="#/farm">${ICONS.plus} ${t('home_add_first_crop')}</a>
      </section>
    </div>`;
  }
  return `
  <div class="page">
    <header class="page-header"><h1>${ICONS.scale} ${t('nav_sell')}</h1><p>${t('sell_desc')}</p></header>
    <section class="card">
      <label>${t('sell_select_crop')}
        <select id="s-crop">${crops.map((c) => `<option value="${c.id}">${esc(c.commodity)}${c.variety ? ' · ' + esc(c.variety) : ''}${c.area ? ' — ' + c.area + ' ' + esc(c.areaUnit) : ''}</option>`).join('')}</select>
      </label>
    </section>
    <section id="sell-summary"></section>
    <section id="sell-result"></section>
  </div>`;
}

export function wireSell(user) {
  const sel = document.getElementById('s-crop');
  const summary = document.getElementById('sell-summary');
  const result = document.getElementById('sell-result');

  /* The whole panel (including the "Get my sell advice" button) is rebuilt on
     every crop change — otherwise the button vanished after switching crop. */
  function renderSummary() {
    const crop = store.getCrop(sel.value);
    result.innerHTML = '';
    if (!crop) { summary.innerHTML = ''; return; }
    const cost = store.totalCost(crop);
    const perQ = store.costPerQuintal(crop);
    const qty = crop.expectedYield || 0;
    const ready = qty > 0 && cost > 0;
    summary.innerHTML = `<section class="card saved-card">
      <div class="saved-head">
        <span class="saved-ic">${ICONS.check}</span>
        <div class="saved-head-txt">
          <strong>${t('sell_using_saved')}</strong>
          <span class="saved-crop">${esc(crop.commodity)}${crop.variety ? ' · ' + esc(crop.variety) : ''}${qty ? ' · ' + qty + ' q' : ''}</span>
        </div>
        <a class="icon-btn" href="#/farm" title="${t('sell_edit_details')}" aria-label="${t('sell_edit_details')}">${ICONS.sliders}</a>
      </div>
      <dl class="saved-stats">
        <div><dt>${t('cost_total')}</dt><dd>${cost ? inr(cost) : '—'}</dd></div>
        <div><dt>${t('cost_per_quintal')}</dt><dd>${perQ ? inr(perQ) : '—'}</dd></div>
      </dl>
      ${ready ? '' : `<p class="muted small" style="margin-top:.6rem">${t('sell_need_details')} <a href="#/farm">${t('sell_edit_details')}</a></p>`}
      <div class="btn-row" style="margin-top:.8rem">
        <button class="btn btn-amber" id="sell-run" type="button">${ICONS.rupee} ${t('sell_advice')}</button>
      </div>
    </section>`;
  }

  sel.addEventListener('change', renderSummary);
  summary.addEventListener('click', (e) => {
    if (e.target.closest('#sell-run')) run();
  });
  renderSummary();

  async function run() {
    const crop = store.getCrop(sel.value);
    if (!crop) return;
    const qty = Number(crop.expectedYield) || 0;
    const cost = store.totalCost(crop);
    if (!qty || !cost) { toast(t('sell_no_crop')); location.hash = '#/farm'; return; }
    const payload = {
      commodity: crop.commodity,
      state: store.getFarm().profile.state || '',
      district: store.getFarm().profile.district || '',
      quantityQuintals: qty,
      totalCost: cost,
      storageCostPerDay: 0,
    };
    result.innerHTML = `<div class="card"><div class="loading-block">${t('common_loading')}</div></div>`;
    try {
      const { facts, advice, scope, requested } = await getSellAdvice(payload);
      result.innerHTML = renderSellResults(facts, advice, scope, requested);
      wireDiagSpeak(result);
      if (user) { try { await saveSellAnalysis(payload, advice); } catch (e) { console.warn(e); } }
    } catch (err) {
      result.innerHTML = `<div class="card"><div class="form-error">${esc(err.message)}</div></div>`;
    }
  }

}

const REC_LABELS = {
  SELL_NOW: [() => t('rec_sell_now'), 'badge-ok'],
  HOLD: [() => t('rec_hold'), 'badge-warn'],
  USE_STORAGE: [() => t('rec_storage'), 'badge-warn'],
  DIRECT_BUYER: [() => t('rec_direct'), 'badge-ok'],
  WAIT_FOR_BETTER_PRICE: [() => t('rec_wait'), 'badge-warn'],
};

function renderSellResults(facts, a, scope, requested) {
  const [label, cls] = REC_LABELS[a.recommendation] || [() => a.recommendation || '', 'badge-warn'];
  const recLabel = typeof label === 'function' ? label() : label;
  return `
  <section class="card">
    ${scopeNotice(scope, requested)}
    <h2><span class="badge ${cls}">${esc(recLabel)}</span></h2>
    <p style="font-size:1.08rem"><strong>${esc(a.headline || '')}</strong></p>
    <div class="grid-2" style="margin-top:1rem">
      <div class="alert ${facts.estimatedProfitAtAvgMarket >= 0 ? 'alert-info' : 'alert-danger'}">
        <strong>${inr(facts.avgModalPrice)}/quintal</strong><p class="big">${inr(facts.estimatedProfitAtAvgMarket)}</p></div>
      <div class="alert alert-info"><strong>${esc(facts.bestMarket.market)}</strong><p class="big">${inr(facts.estimatedProfitAtBestMarket)}</p></div>
    </div>
    <h3>${t('sell_your_numbers')}</h3>
    <dl class="fact-list">
      <div><dt>${t('mandi_commodity')}</dt><dd><strong>${esc(facts.commodity || '')} — ${esc(String(facts.quantityQuintals ?? ''))} q</strong></dd></div>
      <div><dt>${t('cost_per_quintal')}</dt><dd>${inr(facts.yourCostPerQuintal)}</dd></div>
      <div><dt>${t('mandi_avg')}</dt><dd>${inr(facts.avgModalPrice)}</dd></div>
      <div><dt>${t('mandi_best')}</dt><dd><strong>${inr(facts.bestMarket.modalPrice)}</strong><span class="fact-sub">${esc(facts.bestMarket.market)}</span></dd></div>
    </dl>
    ${a.reasoning ? `<h3>${t('sell_why')}</h3><p>${esc(a.reasoning)}</p>` : ''}
    ${Array.isArray(a.bestMarkets) && a.bestMarkets.length ? `<h3>${t('mandi_best')}</h3><ul class="diag-list">${a.bestMarkets.map((m) => `<li><span>${esc(m)}</span></li>`).join('')}</ul>` : ''}
    ${Array.isArray(a.actionSteps) && a.actionSteps.length ? `<h3>${t('sell_next')}</h3><ul class="diag-list">${a.actionSteps.map((m) => `<li><span>${esc(m)}</span></li>`).join('')}</ul>` : ''}
    ${Array.isArray(a.risks) && a.risks.length ? `<h3>${t('sell_risks')}</h3><ul class="diag-list">${a.risks.map((m) => `<li><span>${esc(m)}</span></li>`).join('')}</ul>` : ''}
    <div class="diag-actions">${speakButtonHtml('sell-speak')}</div>
    <div class="alert alert-warning"><strong>${ICONS.shield} ${t('sell_disclaimer')}</strong><p>${esc(a.disclaimer || 'Based on government AGMARKNET data; prices change daily — confirm at the mandi before selling.')}</p></div>
  </section>`;
}

/** Plain text of a sell recommendation — for the summariser / the voice. */
function sellPlainText(facts, a) {
  return [
    a.headline || '',
    a.reasoning || '',
    ...(Array.isArray(a.actionSteps) ? a.actionSteps : []),
    ...(Array.isArray(a.risks) ? a.risks : []),
  ].filter(Boolean).join('. ');
}

/* ══════════ WEATHER ══════════ */
export function renderWeather() {
  const mem = readWeatherMemory();
  const prof = store.getFarm().profile;
  const place = [prof.district, prof.state].filter(Boolean).join(', ') || (mem && mem.place) || '';
  return `
  <div class="page">
    <header class="page-header"><h1>${ICONS.cloudSun} ${t('nav_weather')}</h1><p>${t('weather_desc')}</p></header>
    <section class="card w-search-card">
      <div class="form-row">
        <label>${t('weather_find')}
          <div class="w-search-wrap">
            <input type="text" id="w-place" placeholder="District or city, e.g. Kolkata" autocomplete="off" value="${esc(place)}" />
            <div class="suggest hidden" id="w-suggest"></div>
          </div>
        </label>
        <div class="btn-row w-actions">
          <button class="btn btn-primary" id="w-search">${ICONS.search} ${t('weather_search')}</button>
          <button class="btn btn-outline" id="w-gps">${ICONS.pin} ${t('weather_gps')}</button>
        </div>
      </div>
    </section>
    <section id="weather-result"></section>
  </div>`;
}

export function wireWeather() {
  const search = document.getElementById('w-search');
  const gps = document.getElementById('w-gps');
  const placeInput = document.getElementById('w-place');
  const suggestBox = document.getElementById('w-suggest');
  const result = document.getElementById('weather-result');

  async function load(opts) {
    result.innerHTML = `<div class="card"><div class="loading-block">${t('common_loading')}</div></div>`;
    try {
      const data = await getWeather(opts);
      saveWeatherMemory(data);
      result.innerHTML = renderWeatherResults(data);
      wireWeatherDays(data);
    } catch (err) {
      result.innerHTML = `<div class="card"><div class="form-error">${esc(err.message)}</div></div>`;
    }
  }

  let debounceTimer = null;
  let activeRequest = null;
  placeInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = placeInput.value.trim();
    if (q.length < 2) { suggestBox.classList.add('hidden'); return; }
    debounceTimer = setTimeout(async () => {
      try {
        const { results: hits } = await searchPlaces(q);
        if (!hits.length) { suggestBox.classList.add('hidden'); return; }
        suggestBox.innerHTML = hits.map((h, idx) => `<button type="button" class="suggest-item" data-idx="${idx}">${esc(h.name)}${h.admin ? '<span class="s-admin">, ' + esc(h.admin) + '</span>' : ''}</button>`).join('');
        suggestBox.classList.remove('hidden');
        activeRequest = hits;
        suggestBox.querySelectorAll('.suggest-item').forEach((item) => {
          item.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            const hit = activeRequest[Number(item.dataset.idx)];
            if (!hit) return;
            placeInput.value = hit.name;
            suggestBox.classList.add('hidden');
            load({ place: hit.name });
          });
        });
      } catch { suggestBox.classList.add('hidden'); }
    }, 300);
  });
  placeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') suggestBox.classList.add('hidden');
    if (e.key === 'Enter') { e.preventDefault(); search.click(); }
  });
  placeInput.addEventListener('blur', () => setTimeout(() => suggestBox.classList.add('hidden'), 200));

  // An explicit search always asks for live figures.
  search.addEventListener('click', () => {
    const place = placeInput.value.trim();
    if (place) load({ place, fresh: true });
  });

  gps.addEventListener('click', () => {
    if (typeof window.isSecureContext !== 'undefined' && !window.isSecureContext) { toast(t('gps_insecure'), 8000); return; }
    if (!navigator.geolocation) { toast(t('gps_unavailable')); return; }
    gps.disabled = true;
    const old = gps.innerHTML;
    gps.innerHTML = `${ICONS.pin} …`;
    navigator.geolocation.getCurrentPosition(
      (pos) => { gps.disabled = false; gps.innerHTML = old; load({ lat: pos.coords.latitude, lon: pos.coords.longitude, fresh: true }); },
      (err) => { gps.disabled = false; gps.innerHTML = old; toast(err.code === err.PERMISSION_DENIED ? t('gps_denied') : t('gps_unavailable'), 8000); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10 * 60 * 1000 }
    );
  });

  // Auto-load: the farm profile's location wins, then the last place searched.
  const mem = readWeatherMemory();
  const prof = store.getFarm().profile;
  const auto = [prof.district, prof.state].filter(Boolean).join(', ') || (mem && mem.place) || '';
  if (auto) load({ place: auto });
}

function renderWeatherResults(data) {
  const alertDays = data.days.filter((d) => d.alerts.length);
  const cur = data.current;
  const today = data.days[0];
  return `
  <section class="card weather-now">
    <h2>${ICONS.pin} ${esc(data.location.name || t('home_weather'))}${data.location.admin ? ', ' + esc(data.location.admin) : ''}
      ${data.cached ? `<span class="badge badge-warn">${t('weather_saved')}</span>` : ''}</h2>
    <div class="day-hero now-hero">
      <span class="day-ic">${weatherIcon(cur.weatherCode ?? today.weatherCode)}</span>
      <div><strong>${Math.round(cur.temp)}°</strong><span><em class="now-chip">${t('weather_now')}</em>${esc(cur.description)}</span></div>
    </div>
    <div class="day-grid now-stats">
      <div class="day-stat"><em>${t('weather_humidity')}</em><b>${Math.round(cur.humidity)}%</b></div>
      <div class="day-stat"><em>${t('weather_wind')}</em><b>${Math.round(cur.wind)} km/h</b></div>
      <div class="day-stat"><em>${t('weather_rain')}</em><b>${today.precipitationSum ?? 0} mm</b><span>${today.rainChance ?? 0}% ${t('weather_chance')}</span></div>
      <div class="day-stat"><em>${t('weather_today_hi')}</em><b>${today.tempMax}° / ${today.tempMin}°</b></div>
    </div>
    ${alertDays.length
      ? alertDays.map((d) => d.alerts.map((a) => `<div class="alert ${a.level === 'danger' ? 'alert-danger' : 'alert-warning'}">
          <strong>${ICONS.warning} ${esc(a.title)} — ${dateLabel(d.date)}</strong><p>${esc(a.advice)}</p></div>`).join('')).join('')
      : `<div class="alert alert-info"><strong>${ICONS.check} ${t('weather_no_risk')}</strong></div>`}
  </section>

  <section class="card">
    <h2>${t('weather_forecast7')}</h2>
    <p class="muted small" style="margin-bottom:.6rem">${t('weather_pick_day')}</p>
    <div class="weather-grid">
      ${data.days.map((d, i) => `<button class="weather-day${i === 0 ? ' today' : ''}" type="button" data-day="${i}">
        <div class="wd-date">${i === 0 ? t('today') : dateLabel(d.date)}</div>
        <div class="wd-icon">${weatherIcon(d.weatherCode)}</div>
        <div class="wd-desc">${esc(d.description)}${d.rainChance != null ? ' · ' + d.rainChance + '%' : ''}</div>
        <div class="wd-temp">${d.tempMax}° / ${d.tempMin}°</div>
        <div class="wd-meta">${d.precipitationSum} mm<br/>${d.windGusts} km/h</div>
      </button>`).join('')}
    </div>
    <p class="muted small" style="margin-top:0.9rem">${t('sources')}: Open-Meteo · IMD thresholds</p>
  </section>`;
}

function wireWeatherDays(data) {
  document.querySelectorAll('[data-day]').forEach((btn) => {
    btn.addEventListener('click', () => openWeatherDay(data, Number(btn.dataset.day)));
  });
}

function openWeatherDay(data, idx) {
  const d = data.days[idx];
  if (!d) return;
  const place = (data.location.name || '') + (data.location.admin ? ', ' + data.location.admin : '');
  openSheet(`
    <div class="sheet-grabber" aria-hidden="true"></div>
    <div class="sheet-head">
      <h2>${ICONS.cloudSun} ${dateLabel(d.date)}</h2>
      <button class="icon-btn" type="button" data-sheet-close aria-label="Close">${ICONS.close}</button>
    </div>
    <p class="muted small" style="margin-bottom:.6rem">${esc(place)}</p>
    <div class="day-hero">
      <span class="day-ic">${weatherIcon(d.weatherCode)}</span>
      <div><strong>${d.tempMax}° / ${d.tempMin}°</strong><span>${esc(d.description)}</span></div>
    </div>
    <div class="day-grid">
      <div class="day-stat"><em>${t('weather_rain')}</em><b>${d.precipitationSum} mm</b><span>${d.rainChance}% ${t('weather_chance')}</span></div>
      <div class="day-stat"><em>${t('weather_gusts')}</em><b>${d.windGusts} km/h</b></div>
      <div class="day-stat"><em>${t('weather_today_hi')}</em><b>${d.tempMax}°</b><span>${t('weather_low')} ${d.tempMin}°</span></div>
    </div>
    ${d.alerts && d.alerts.length
      ? d.alerts.map((a) => `<div class="alert ${a.level === 'danger' ? 'alert-danger' : 'alert-warning'}">
          <strong>${ICONS.warning} ${esc(a.title)}</strong><p>${esc(a.advice)}</p></div>`).join('')
      : `<div class="alert alert-info"><strong>${ICONS.check} ${t('weather_no_risk')}</strong></div>`}
    <button class="btn btn-primary btn-block" type="button" data-sheet-close style="margin-top:1rem">${t('common_done')}</button>`);
}

/* ══════════ SCHEMES ══════════ */
export function renderSchemes() {
  return `
  <div class="page">
    <header class="page-header"><h1>${ICONS.scroll} ${t('nav_schemes')}</h1><p>${t('schemes_desc')}</p></header>
    <div class="scheme-list">
      ${SCHEMES.map((s, i) => `<section class="card scheme-card">
        <div class="scheme-head">
          <span class="scheme-ic">${ICONS.landmark}</span>
          <h2>${esc(s.name)}</h2>
        </div>
        <p>${esc(s.description)}</p>
        <div class="scheme-facts">
          <div class="scheme-fact"><em>${ICONS.banknote} ${t('scheme_benefit')}</em><b>${esc(s.benefit)}</b></div>
          <div class="scheme-fact"><em>${ICONS.user} ${t('scheme_who')}</em><b>${esc(s.eligibility)}</b></div>
        </div>
        <div class="btn-row" style="margin-top:.9rem">
          <a class="btn btn-primary" href="${esc(s.url)}" target="_blank" rel="noopener">${ICONS.arrowUpRight} ${t('scheme_visit')}</a>
          <button class="btn btn-amber" type="button" data-ask-scheme="${i}">${ICONS.chat} ${t('scheme_ask')}</button>
        </div>
      </section>`).join('')}
    </div>
  </div>`;
}

export function wireSchemes() {
  document.querySelectorAll('[data-ask-scheme]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = SCHEMES[Number(btn.dataset.askScheme)];
      if (!s) return;
      const seed = `Tell me about the government scheme "${s.name}". Who is eligible, what is the benefit, and how do I apply? Here is the summary I have: ${s.description} Eligibility: ${s.eligibility} Benefit: ${s.benefit} Official website: ${s.url}. Explain it simply and list the steps I should take.`;
      try { sessionStorage.setItem('ks_chat_seed', seed); } catch {}
      location.hash = '#/chat';
    });
  });
}

/* ══════════ MY FARM ══════════ */
export function renderFarm() {
  const farm = store.getFarm();
  const p = farm.profile;
  const crops = farm.crops || [];
  const stateOptions = STATES.map((s) => `<option value="${esc(s)}" ${p.state === s ? 'selected' : ''}>${esc(s)}</option>`).join('');
  const commodityField = renderCombobox({
    id: 'cf-commodity',
    items: CROPS,
    common: COMMON_CROPS,
    placeholder: t('crop_search_ph'),
    noMatch: t('crop_no_match'),
    moreHint: t('crop_more_hint'),
  });
  return `
  <div class="page">
    <header class="page-header"><h1>${ICONS.sprout} ${t('farm_title')}</h1><p>${t('farm_desc')}</p></header>

    <section class="card">
      <h2>${ICONS.user} ${t('farm_profile')}</h2>
      <form class="stack" id="farm-profile-form">
        <div class="form-row">
          <label>${t('profile_name')}<input id="fp-name" value="${esc(p.name || '')}" placeholder="e.g. Ramesh Kumar" /></label>
          <label>${t('mandi_state')}<select id="fp-state"><option value="">—</option>${stateOptions}</select></label>
        </div>
        <div class="form-row">
          <label>${t('mandi_district')}<input id="fp-district" value="${esc(p.district || '')}" placeholder="e.g. Kolkata" /></label>
          <div style="align-self:end"><button class="btn btn-primary" type="submit">${ICONS.check} ${t('profile_save')}</button></div>
        </div>
      </form>
    </section>

    <section class="card farm-summary">
      <div class="summary-stats">
        <div><strong>${crops.length}</strong><span>${t('farm_total_crops')}</span></div>
        <div><strong>${store.totalArea()}</strong><span>${t('farm_total_area')}</span></div>
        <div><strong>${inr(store.totalFarmCost())}</strong><span>${t('farm_total_cost')}</span></div>
      </div>
    </section>

    <div class="section-head">
      <h2 class="section-title">${t('farm_crops')}</h2>
      <button class="btn btn-primary btn-sm" id="add-crop" type="button">${ICONS.plus} ${t('farm_add_crop')}</button>
    </div>

    ${crops.length ? crops.map(cropManageCardHtml).join('') : emptyCropCardHtml(true)}

    <datalist id="exp-cats">${EXPENSE_CATEGORIES.map((c) => `<option value="${t(c.key)}"></option>`).join('')}</datalist>

    <div class="modal-backdrop hidden" id="crop-modal">
      <div class="modal" role="dialog" aria-modal="true">
        <button class="icon-btn modal-close" id="crop-modal-close" type="button" aria-label="Close">${ICONS.close}</button>
        <h2 id="crop-modal-title">${t('farm_add_crop')}</h2>
        <form class="stack" id="crop-form">
          <input type="hidden" id="cf-id" />
          <div class="form-row">
            <label>${t('crop_commodity')}*${commodityField}</label>
            <label>${t('crop_variety')}<input id="cf-variety" placeholder="e.g. N-53" /></label>
          </div>
          <div class="form-row">
            <label>${t('crop_area')}<input type="number" id="cf-area" min="0" step="0.1" placeholder="e.g. 2.5" /></label>
            <label>${t('crop_sowing')}${dateFieldHtml('cf-sowing', '')}</label>
          </div>
          <div class="form-row">
            <label>${t('crop_harvest')}${dateFieldHtml('cf-harvest', '')}
              <span class="field-hint">${t('crop_harvest_hint')}</span></label>
            <label>${t('crop_yield')}<input type="number" id="cf-yield" min="0" placeholder="e.g. 120" /></label>
          </div>
          <label>${t('crop_notes')}<input id="cf-notes" placeholder="…" /></label>
          <div class="btn-row">
            <button class="btn btn-primary" type="submit">${ICONS.check} ${t('crop_save')}</button>
            <button class="btn btn-ghost" type="button" id="crop-cancel">${t('crop_cancel')}</button>
          </div>
        </form>
      </div>
    </div>
  </div>`;
}

export function wireFarm(user) {
  const modal = document.getElementById('crop-modal');
  const form = document.getElementById('crop-form');
  const title = document.getElementById('crop-modal-title');

  document.getElementById('farm-profile-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('fp-name').value.trim();
    store.setProfile({
      name,
      state: document.getElementById('fp-state').value,
      district: document.getElementById('fp-district').value.trim(),
    });
    // Keep the account's display name in step with the profile name, so the
    // avatar, the account menu and the greeting all agree — farmer or buyer.
    updateDisplayName(name).catch(() => {});
    toast(t('profile_saved'));
  });

  const cfCommodity = document.getElementById('cf-commodity');
  wireCombobox('cf-commodity');
  const cfSowing = document.getElementById('cf-sowing');
  const cfHarvest = document.getElementById('cf-harvest');
  initDateField('cf-sowing');
  initDateField('cf-harvest');


  function openCrop(id) {
    const crop = id ? store.getCrop(id) : null;
    title.textContent = crop ? t('farm_edit_crop') : t('farm_add_crop');
    document.getElementById('cf-id').value = crop ? crop.id : '';
    cfCommodity.value = crop ? crop.commodity : '';
    document.getElementById('cf-variety').value = crop ? crop.variety || '' : '';
    document.getElementById('cf-area').value = crop ? crop.area || '' : '';
    cfSowing.value = toDmyDate(crop ? crop.sowingDate : '') || toDmyDate(new Date().toISOString().slice(0, 10));
    cfHarvest.value = toDmyDate(crop ? crop.expectedHarvestDate : '');
    document.getElementById('cf-yield').value = crop ? crop.expectedYield || '' : '';
    document.getElementById('cf-notes').value = crop ? crop.notes || '' : '';
    modal.classList.remove('hidden');
    document.body.classList.add('no-scroll');
  }
  const closeCrop = () => { modal.classList.add('hidden'); document.body.classList.remove('no-scroll'); };

  document.getElementById('add-crop').addEventListener('click', () => openCrop(null));
  const emptyAdd = document.getElementById('add-crop-empty');
  if (emptyAdd) emptyAdd.addEventListener('click', () => openCrop(null));
  document.getElementById('crop-modal-close').addEventListener('click', closeCrop);
  document.getElementById('crop-cancel').addEventListener('click', closeCrop);
  modal.addEventListener('click', (e) => e.target === modal && closeCrop());

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('cf-id').value;
    const sowingIso = toIsoDate(cfSowing.value);
    const harvestIso = toIsoDate(cfHarvest.value);
    if (cfSowing.value && !sowingIso) { toast(t('crop_bad_date')); cfSowing.focus(); return; }
    if (cfHarvest.value && !harvestIso) { toast(t('crop_bad_date')); cfHarvest.focus(); return; }
    const data = {
      commodity: document.getElementById('cf-commodity').value,
      variety: document.getElementById('cf-variety').value.trim(),
      area: document.getElementById('cf-area').value,
      sowingDate: sowingIso,
      expectedHarvestDate: harvestIso,
      expectedYield: document.getElementById('cf-yield').value,
      notes: document.getElementById('cf-notes').value.trim(),
    };
    if (!data.commodity) { toast(t('crop_choose_required')); return; }
    // Left blank? Estimate it from the sowing date + the crop's duration only now,
    // when the farmer saves.
    if (!data.expectedHarvestDate) {
      const est = estimateHarvest(data.commodity, data.sowingDate);
      if (est) { data.expectedHarvestDate = est; cfHarvest.value = toDmyDate(est); }
    }
    if (id) store.updateCrop(id, data);
    else store.addCrop(data);
    closeCrop();
    toast(t('profile_saved'));
  });

  document.querySelectorAll('[data-edit-crop]').forEach((b) => b.addEventListener('click', () => openCrop(b.dataset.editCrop)));
  document.querySelectorAll('[data-del-crop]').forEach((b) =>
    b.addEventListener('click', () => {
      if (confirm(t('farm_delete_confirm'))) store.removeCrop(b.dataset.delCrop);
    })
  );
  document.querySelectorAll('[data-del-exp]').forEach((b) =>
    b.addEventListener('click', () => store.removeExpense(b.dataset.crop, b.dataset.delExp))
  );
  document.querySelectorAll('.cost-add').forEach((f) =>
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const label = f.querySelector('.cost-item-in').value.trim();
      const amount = f.querySelector('.cost-amt-in').value;
      if (!label || !amount) return;
      store.addExpense(f.dataset.crop, { label, amount });
    })
  );
}

/* ══════════ SETTINGS ══════════ */
export function renderSettings(user) {
  const p = store.getFarm().profile;
  const pref = (window.ksTheme && window.ksTheme.pref()) || 'system';
  const langName = (LANGS.find((l) => l.code === getLang()) || {}).name || 'English';
  const place = [p.district, p.state].filter(Boolean).join(', ');
  const options = [
    ['light', t('settings_light'), ICONS.sun],
    ['system', t('settings_system'), ICONS.monitor],
    ['dark', t('settings_dark'), ICONS.moon],
  ];
  return `
  <div class="page">
    <header class="page-header"><h1>${ICONS.settings} ${t('nav_settings')}</h1><p>${t('settings_desc')}</p></header>

    <section class="card">
      <h2>${ICONS.user} ${user ? esc(user.email || '') : t('auth_guest')}</h2>
      <p class="muted small">${user ? t('settings_signed_in') : t('settings_guest')}</p>
      <div class="btn-row" style="margin-top:.8rem">
        <a class="btn btn-outline" href="#/farm">${ICONS.sprout} ${t('nav_farm')}</a>
        ${user
          ? `<button class="btn btn-ghost" id="settings-logout" type="button">${ICONS.logout} ${t('common_logout')}</button>`
          : `<button class="btn btn-primary" id="settings-login" type="button">${t('common_login')}</button>`}
      </div>
    </section>

    <section class="card">
      <h2>${ICONS.handshake} ${t('settings_role')}</h2>
      <p class="muted small">${t('settings_role_desc')}</p>
      <div class="btn-row" style="margin-top:.8rem">
        <button class="btn ${store.getRole() === 'farmer' ? 'btn-primary' : 'btn-outline'}" id="settings-role-farmer" type="button">${ICONS.sprout} ${t('mk_role_seller')}</button>
        <button class="btn ${store.getRole() === 'buyer' ? 'btn-primary' : 'btn-outline'}" id="settings-role-buyer" type="button">${ICONS.store} ${t('mk_role_buyer')}</button>
      </div>
    </section>

    <section class="card">
      <h2>${ICONS.sliders} ${t('settings_prefs')}</h2>
      <ul class="settings-list">
        <li class="settings-row">
          <span class="settings-ic">${ICONS.globe}</span>
          <span class="settings-txt"><strong>${t('lang_title')}</strong><span class="muted small">${esc(langName)}</span></span>
          <button class="btn btn-outline btn-sm" id="settings-lang" type="button">${t('settings_change_lang')}</button>
        </li>
        <li class="settings-row settings-row-col">
          <div class="settings-row-head">
            <span class="settings-ic">${pref === 'dark' ? ICONS.moon : pref === 'light' ? ICONS.sun : ICONS.monitor}</span>
            <span class="settings-txt"><strong>${t('settings_appearance')}</strong></span>
          </div>
          <div class="seg" role="group" aria-label="${esc(t('settings_appearance'))}">
            ${options
              .map(([v, label, icon]) =>
                `<button class="seg-btn${pref === v ? ' active' : ''}" type="button" data-theme-pref="${v}" aria-pressed="${pref === v}">${icon}<span>${esc(label)}</span></button>`)
              .join('')}
          </div>
        </li>
      </ul>
      <p class="muted small" style="margin-top:.7rem">${t('settings_saved_hint')}</p>
    </section>

    <section class="card">
      <h2>${ICONS.shieldAlert} ${t('settings_data')}</h2>
      <p class="muted small">${t('settings_data_desc')}</p>
      <div class="btn-row" style="margin-top:.7rem">
        <button class="btn btn-outline" id="settings-reset" type="button">${ICONS.refresh} ${t('settings_reset')}</button>
      </div>
      ${place ? `<p class="muted small" style="margin-top:.6rem">${ICONS.pin} ${esc(place)}</p>` : ''}
    </section>
  </div>`;
}

export function wireSettings(user) {
  const rerender = () => window.dispatchEvent(new Event('hashchange'));

  const lg = document.getElementById('settings-login');
  if (lg) lg.addEventListener('click', () => document.getElementById('open-login')?.click());

  const lo = document.getElementById('settings-logout');
  if (lo) lo.addEventListener('click', async () => {
    try { const { logout } = await import('./auth.js'); await logout(); } catch {}
    store.clearLocalData();
  });

  document.getElementById('settings-lang').addEventListener('click', () => document.getElementById('lang-btn').click());

  // The role is the account's, so it can be corrected here if it was ever set
  // wrongly — nothing else is allowed to change it behind your back.
  const pickRole = (role) => {
    store.setRole(role);
    toast(t(role === 'buyer' ? 'settings_role_buyer' : 'settings_role_farmer'));
    renderSettings(user);
  };
  document.getElementById('settings-role-farmer')?.addEventListener('click', () => pickRole('farmer'));
  document.getElementById('settings-role-buyer')?.addEventListener('click', () => pickRole('buyer'));

  // Light / System / Dark
  document.querySelectorAll('[data-theme-pref]').forEach((b) =>
    b.addEventListener('click', () => {
      if (window.ksTheme) window.ksTheme.set(b.dataset.themePref);
      rerender();
    })
  );

  document.getElementById('settings-reset').addEventListener('click', () => {
    if (!confirm(t('settings_reset_confirm'))) return;
    try {
      localStorage.removeItem('ks_theme');
      localStorage.removeItem('ks_lang');
      localStorage.removeItem('ks_guest');
    } catch {}
    store.clearLocalData();
    location.reload();
  });
}

/* ══════════ CHAT ══════════ */
export function renderChat() {
  return `
  <div class="page page-chat">
    <section class="chat-shell">
      <header class="chat-top">
        <span class="chat-avatar">${ICONS.logo}</span>
        <div class="chat-top-txt">
          <strong>KrishiSathi AI</strong>
          <span class="muted small">${t('chat_desc')}</span>
        </div>
        <button class="icon-btn" id="chat-new" type="button" title="${esc(t('new_chat'))}" aria-label="${esc(t('new_chat'))}">${ICONS.refresh}</button>
      </header>
      <div class="chat-log" id="chat-log"></div>
      <div class="chat-chips" id="chat-chips">
        <button class="chat-chip" type="button">${esc(t('chat_sugg1'))}</button>
        <button class="chat-chip" type="button">${esc(t('chat_sugg2'))}</button>
        <button class="chat-chip" type="button">${esc(t('chat_sugg3'))}</button>
        <button class="chat-chip" type="button">${esc(t('chat_sugg4'))}</button>
      </div>
      <form class="chat-form" id="chat-form">
        <button class="chat-mic" id="chat-mic" type="button" title="${esc(t('tap_mic'))}" aria-label="${esc(t('tap_mic'))}">${ICONS.mic}</button>
        <input type="text" id="chat-input" placeholder="${esc(t('chat_placeholder'))}" autocomplete="off" />
        <button class="btn btn-primary chat-send" type="submit" aria-label="${esc(t('chat_send'))}">${ICONS.send}</button>
      </form>
    </section>
  </div>`;
}

export function wireChat(user) {
  if ('speechSynthesis' in window) {
    try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => {}; } catch {}
  }
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const log = document.getElementById('chat-log');
  const chips = document.getElementById('chat-chips');

  const HISTORY_KEY = 'ks_chat_log_' + (user && user.uid ? user.uid : 'local');
  let history = [];
  try { history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch {}
  const persist = () => { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch {} };
  const scrollDown = () => { log.scrollTop = log.scrollHeight; };

  const addUser = (text) => {
    const div = document.createElement('div');
    div.className = 'chat-msg user';
    div.innerHTML = `<div class="chat-bubble">${esc(text)}</div>`;
    log.appendChild(div);
    scrollDown();
  };
  const addAssistant = (text) => {
    const div = document.createElement('div');
    div.className = 'chat-msg assistant';
    div.innerHTML = `<div class="chat-col">
        <div class="chat-bubble">${mdToHtml(text)}</div>
        <div class="chat-actions"><button class="chat-speak" type="button" title="${esc(t('speak'))}" aria-label="${esc(t('speak'))}">${ICONS.speaker}</button></div>
      </div>`;
    div.querySelector('.chat-speak').addEventListener('click', (e) => toggleSpeak(e.currentTarget, text));
    log.appendChild(div);
    scrollDown();
  };
  const addTyping = () => {
    const div = document.createElement('div');
    div.className = 'chat-msg assistant';
    div.id = 'chat-typing';
    div.innerHTML = `<div class="chat-bubble typing"><span></span><span></span><span></span></div>`;
    log.appendChild(div);
    scrollDown();
  };
  const removeTyping = () => document.getElementById('chat-typing')?.remove();
  const refreshChips = () => chips.classList.toggle('hidden', history.length > 0);

  let speakingBtn = null;
  function pickVoice(lang) {
    try {
      const voices = speechSynthesis.getVoices() || [];
      const norm = (v) => (v.lang || '').toLowerCase().replace('_', '-');
      const target = lang.toLowerCase();
      return voices.find((v) => norm(v) === target) || voices.find((v) => norm(v).startsWith(target.slice(0, 2))) || null;
    } catch { return null; }
  }
  function stopSpeaking() {
    try { speechSynthesis.cancel(); } catch {}
    if (speakingBtn) { speakingBtn.classList.remove('active'); speakingBtn = null; }
  }
  function toggleSpeak(btn, rawText) {
    if (!('speechSynthesis' in window)) { toast(t('speak') + ' — not supported by this browser'); return; }
    if (speakingBtn === btn) { stopSpeaking(); return; }
    stopSpeaking();
    const clean = rawText.replace(/```[\s\S]*?```/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\|/g, ', ').replace(/[#*_>`~]+/g, '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const parts = clean.match(/[^.!?\u0964]+[.!?\u0964]*/g) || [clean];
    const chunks = [];
    let buf = '';
    for (const part of parts) {
      if ((buf + part).length > 160) { if (buf.trim()) chunks.push(buf.trim()); buf = part; } else buf += part;
    }
    if (buf.trim()) chunks.push(buf.trim());
    const lang = getSpeechLang();
    const voice = pickVoice(lang);
    btn.classList.add('active');
    speakingBtn = btn;
    const utterances = chunks.map((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      u.lang = lang;
      if (voice) u.voice = voice;
      if (i === chunks.length - 1) u.onend = () => { btn.classList.remove('active'); if (speakingBtn === btn) speakingBtn = null; };
      u.onerror = () => { btn.classList.remove('active'); if (speakingBtn === btn) speakingBtn = null; };
      return u;
    });
    setTimeout(() => utterances.forEach((u) => speechSynthesis.speak(u)), 80);
  }

  function farmContext() {
    const farm = store.getFarm();
    return {
      name: farm.profile.name,
      state: farm.profile.state,
      district: farm.profile.district,
      crops: farm.crops.map((c) => ({
        commodity: c.commodity, area: c.area, areaUnit: c.areaUnit,
        sowingDate: c.sowingDate, stage: t(cropStage(c).stage.key),
        expectedYield: c.expectedYield, cost: store.totalCost(c),
      })),
    };
  }

  async function ask(text) {
    if (!text.trim()) return;
    addUser(text);
    history.push({ role: 'user', content: text });
    persist();
    refreshChips();
    addTyping();
    try {
      const { reply } = await sendChat(history, getLangName(), farmContext());
      removeTyping();
      addAssistant(reply);
      history.push({ role: 'assistant', content: reply });
      persist();
    } catch (err) {
      removeTyping();
      addAssistant('**' + (err.message || 'Something went wrong — please try again.') + '**');
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    ask(text);
  });
  chips.querySelectorAll('.chat-chip').forEach((chip) => chip.addEventListener('click', () => ask(chip.textContent)));

  const welcomeHtml = `<div class="chat-welcome"><div class="chat-welcome-icon">${ICONS.logo}</div><p>${esc(t('hero_welcome_new'))}</p></div>`;

  document.getElementById('chat-new').addEventListener('click', () => {
    history = [];
    persist();
    try { sessionStorage.removeItem('ks_chat_seed'); } catch {}
    if (window.speechSynthesis) speechSynthesis.cancel();
    log.innerHTML = welcomeHtml;
    refreshChips();
    input.focus();
  });

  const micBtn = document.getElementById('chat-mic');
  const voice = createVoiceCapture({
    onText: (text) => { input.value = ''; ask(text); },
    onInterim: (text) => { input.value = text; },
    onState: (on) => {
      micBtn.classList.toggle('listening', on);
      input.placeholder = on ? t('listening') : t('chat_placeholder');
    },
  });
  wireMic(micBtn, voice, () => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    voice.start({ baseText: input.value });
  });

  if (history.length) {
    history.forEach((m) => (m.role === 'user' ? addUser(m.content) : addAssistant(m.content)));
    refreshChips();
  } else {
    log.innerHTML = welcomeHtml;
  }

  let seed = null;
  try { seed = sessionStorage.getItem('ks_chat_seed'); if (seed) sessionStorage.removeItem('ks_chat_seed'); } catch {}
  if (seed) ask(seed);
  input.focus();
}

/* ══════════ VOICE ASK — home mic → full-width pop-up → Ask AI ══════════
   One overlay for the whole app, wired once at boot. It listens exactly the
   way the Ask AI mic does; once a question has been heard it is handed to
   Ask AI as the chat seed, the Ask AI page opens, and the answer appears
   there as usual. */
let voiceAskReady = false;
export function initVoiceAsk() {
  if (voiceAskReady) return;
  voiceAskReady = true;
  const overlay = document.getElementById('voice-overlay');
  if (!overlay) return;
  const micBtn = document.getElementById('voice-mic');
  const statusEl = document.getElementById('voice-status');
  const textEl = document.getElementById('voice-text');
  const sendBtn = document.getElementById('voice-send');
  let manualStop = false; // the user tapped the mic to stop — let them review

  // The "Ask AI" button only means something once there is a question to send.
  const syncSend = () => { sendBtn.disabled = !textEl.textContent.trim(); };
  const setText = (text) => { textEl.textContent = text || ''; syncSend(); };

  const voice = createVoiceCapture({
    onText: (text) => {
      setText(text);
      // A silence auto-stop sends straight away (that is the point). A manual
      // stop leaves the words in the box so they can be corrected first.
      if (manualStop) { manualStop = false; return; }
      goToChat(text);
    },
    onInterim: (text) => setText(text),
    onState: (on) => {
      micBtn.classList.toggle('listening', on);
      overlay.classList.toggle('is-listening', on);
      statusEl.textContent = on ? t('listening') : t('tap_mic');
      if (on) manualStop = false;
    },
  });

  function open() {
    manualStop = false;
    textEl.setAttribute('data-placeholder', t('voice_placeholder'));
    setText('');
    statusEl.textContent = t('listening');
    showAnimated(overlay);
    document.body.classList.add('no-scroll');
    // let the pop-up finish its entrance before the mic opens
    setTimeout(() => voice.start({}), 280);
  }
  function close() {
    voice.stop();
    document.body.classList.remove('no-scroll');
    hideAnimated(overlay, 320);
  }
  function goToChat(text) {
    const q = (text || '').trim();
    voice.stop();
    // Nothing said (or only the placeholder showing) → send nothing at all.
    if (!q) return;
    document.body.classList.remove('no-scroll');
    hideAnimated(overlay, 200);
    try { sessionStorage.setItem('ks_chat_seed', q); } catch {}
    if (location.hash === '#/chat') window.dispatchEvent(new Event('hashchange'));
    else location.hash = '#/chat';
  }

  micBtn.addEventListener('click', () => {
    // Tapping the mic while it listens stops it and keeps the words for review;
    // tapping again continues listening from whatever is already in the box.
    if (voice.isListening()) { manualStop = true; voice.stop(); }
    else voice.start({ baseText: textEl.textContent.trim() });
  });
  document.getElementById('voice-close').addEventListener('click', close);
  document.getElementById('voice-cancel').addEventListener('click', close);
  sendBtn.addEventListener('click', () => goToChat(textEl.textContent));
  textEl.addEventListener('input', syncSend);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) close();
  });

  // The home card opens it — delegated, so it survives every home re-render.
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-voice-open]');
    if (trigger) { e.preventDefault(); open(); }
  });

  syncSend();
}

/* ════════════════════════════════════════════════════════════════
   MARKETPLACE — a two-sided board.
   A farmer posts "Want to Sell", a buyer posts "Want to Buy". Both are
   public; only the author can manage their own. One account = one role,
   and the role decides which kind of listing you can create.
   ════════════════════════════════════════════════════════════════ */
const telHref = (phone) => `tel:${String(phone).replace(/[^\d+]/g, '')}`;
const waHref = (phone, text) =>
  `https://wa.me/${String(phone).replace(/[^\d]/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

const typeLabel = (type) => (type === 'sell' ? t('mk_want_sell') : t('mk_want_buy'));
const typeIcon = (type) => (type === 'sell' ? ICONS.sprout : ICONS.store);
/** The action a viewer takes on someone else's listing. */
const actLabel = (type) => (type === 'sell' ? t('mk_buy') : t('mk_sell'));
const actIcon = (type) => (type === 'sell' ? ICONS.handshake : ICONS.scale);

const marketView = { tab: 'all', q: '' };
const MARKET_TABS = ['all', 'sell', 'buy', 'mine', 'interests'];

function daysLabel(post) {
  if (market.isExpired(post)) return { text: t('mk_expired'), soon: true };
  const d = market.daysLeft(post);
  return { text: `${d} ${d === 1 ? t('mk_day') : t('mk_days')}`, soon: d <= 3 };
}

/** Is this listing mine? True on every tab, so I never get Buy/Sell on my own. */
function isMyPost(post, user) {
  if (!post) return false;
  const uid = user && user.uid;
  return uid ? post.authorId === uid : !post.authorId;
}

function marketCard(post, { user } = {}) {
  const mine = isMyPost(post, user);
  const dl = daysLabel(post);
  const contact = `
    <a class="btn btn-primary" href="${esc(telHref(post.phone))}">${ICONS.phone} ${esc(t('mk_call'))}</a>
    <a class="btn btn-outline" href="${esc(waHref(post.phone))}" target="_blank" rel="noopener">${ICONS.chat} ${esc(t('mk_whatsapp'))}</a>`;
  const actions = mine
    ? `<button class="btn mk-act mk-act-edit" data-mk-edit="${esc(post.id)}">${ICONS.pencil} ${esc(t('mk_edit'))}</button>
       <button class="btn mk-act mk-act-extend" data-mk-extend="${esc(post.id)}">${ICONS.refresh} ${esc(t('mk_extend'))}</button>
       <button class="btn mk-act mk-act-close" data-mk-close="${esc(post.id)}">${esc(t('mk_close'))}</button>
       <button class="btn mk-act mk-act-delete" data-mk-delete="${esc(post.id)}">${ICONS.trash} ${esc(t('mk_delete'))}</button>`
    : (market.hasResponded(post.id, user && user.uid)
        ? `<button class="btn act-sent" data-mk-sent="${esc(post.id)}">${ICONS.check} ${esc(t('mk_sent'))}</button>${contact}`
        : `<button class="btn btn-amber" data-mk-respond="${esc(post.id)}">${actIcon(post.type)} ${esc(actLabel(post.type))}</button>${contact}`);
  return `
  <section class="card mk-card mk-card-tap" data-mk-card="${esc(post.id)}" data-mk-open="${esc(post.id)}" role="button" tabindex="0">
    ${post.image ? `<img class="mk-photo" src="${esc(post.image)}" alt="${esc(post.commodity)}" loading="lazy" />` : ''}
    <div class="mk-top">
      <span class="mk-type ${post.type === 'sell' ? 'mk-type-sell' : 'mk-type-buy'}">${typeIcon(post.type)} ${esc(typeLabel(post.type))}</span>
      <span class="mk-topright">
        ${post.createdAt ? `<span class="mk-date">${esc(postDateLabel(post.createdAt))}</span>` : ''}
        <span class="mk-expiry ${dl.soon ? 'is-soon' : ''}">${esc(dl.text)}</span>
      </span>
    </div>
    <div class="mk-crop">${esc(post.commodity)}</div>
    <div class="mk-facts">
      <span><b>${esc(post.quantity)}</b> ${esc(post.unit)}</span>
      ${post.price ? `<span><b>${esc(post.price)}</b></span>` : ''}
    </div>
    ${post.place ? `<div class="mk-where">${ICONS.pin} ${esc(post.place)}</div>` : ''}
    <div class="mk-actions">${actions}</div>
  </section>`;
}

function marketBody(user) {
  const isSeller = Boolean(user && user.uid) && store.getRole() !== 'buyer';
  const feedType = isSeller ? 'buy' : 'sell'; // a farmer watches buyer posts
  const tab = MARKET_TABS.includes(marketView.tab) ? marketView.tab : 'all';
  const chip = (id, label) =>
    `<button class="mk-chip ${tab === id ? 'is-on' : ''}" data-mk-tab="${id}">${esc(label)}</button>`;
  return `
    <div class="mk-filters">
      ${chip('all', t('mk_filter_all'))}${chip('sell', t('mk_filter_sale'))}${chip('buy', t('mk_filter_wanted'))}${chip('mine', t('mk_my_listings'))}
    </div>
    <div class="mk-search">${ICONS.search}<input type="search" id="mk-q" value="${esc(marketView.q || '')}" placeholder="${esc(t('mk_search_ph'))}" /></div>
    ${marketList(user)}
    `;
}

/** One interest, seen from my side: the listing I responded to. */
function interestCard(it) {
  const accepted = it.status === 'accepted';
  return `
  <section class="card mk-card">
    <div class="mk-top">
      <span class="mk-type ${it.postType === 'sell' ? 'mk-type-sell' : 'mk-type-buy'}">${it.postType === 'sell' ? ICONS.sprout : ICONS.store} ${esc(it.postType === 'sell' ? t('mk_want_sell') : t('mk_want_buy'))}</span>
      <span class="mk-expiry ${accepted ? '' : 'is-soon'}">${esc(accepted ? t('mk_accepted') : t('mk_awaiting'))}</span>
    </div>
    <div class="mk-crop">${esc(it.postCommodity)}</div>
    ${it.postPlace ? `<div class="mk-where">${ICONS.pin} ${esc(it.postPlace)}</div>` : ''}
    <div class="mk-actions">
      <button class="btn mk-act mk-act-edit" data-mk-open="${esc(it.postId)}">${esc(t('mk_view_listing'))}</button>
    </div>
  </section>`;
}

/** Just the listings — the piece the search replaces as you type. */
function marketList(user) {
  const isSeller = Boolean(user && user.uid) && store.getRole() !== 'buyer';
  const q = (marketView.q || '').trim().toLowerCase();
  const tab = MARKET_TABS.includes(marketView.tab) ? marketView.tab : 'all';
  if (tab === 'interests') {
    const mine = market.myInterests(user && user.uid);
    return `<div class="mk-list" id="mk-list">
      ${mine.length ? mine.map(interestCard).join('') : `<div class="card mk-empty">${esc(t('mk_none_interests'))}</div>`}
    </div>`;
  }
  const all = market.getPosts();
  let list;
  if (tab === 'mine') list = market.myPosts(user && user.uid);
  else if (tab === 'sell') list = all.filter((p) => p.type === 'sell' && !market.isExpired(p));
  else if (tab === 'buy') list = all.filter((p) => p.type === 'buy' && !market.isExpired(p));
  else list = all.filter((p) => !market.isExpired(p));
  if (q) list = list.filter((p) => (p.commodity || '').toLowerCase().includes(q));
  const emptyMsg = tab === 'mine' ? t('mk_none_mine') : q ? t('mk_none_search') : t('mk_none_feed');
  return `<div class="mk-list" id="mk-list">
      ${list.length ? list.map((p) => marketCard(p, { user })).join('') : `<div class="card mk-empty">${esc(emptyMsg)}</div>`}
    </div>`;
}

/** A standing notice for the author: people have responded to your listings. */
function notificationCard(user) {
  const list = market.interestsForOwner(user && user.uid);
  if (!list.length) return '';
  const unseen = list.filter((i) => !i.seen).length;
  return `
    <button class="card mk-notif" id="mk-notif" type="button">
      <span class="mk-notif-ic">${ICONS.bell || ICONS.chat}</span>
      <span class="mk-notif-txt">
        <b>${esc(t('mk_notif_title'))}</b>
        <span>${esc(t('mk_notif_sub'))}</span>
      </span>
      ${unseen ? `<span class="mk-notif-count">${unseen}</span>` : ''}
      <span class="mk-notif-arrow">${ICONS.chevronRight}</span>
    </button>`;
}

/** The bell for the top bar — only there when something has happened. */
export function bellButton(user) {
  if (!(user && user.uid)) return '';
  const incoming = market.interestsForOwner(user.uid);
  const outgoing = market.myInterests(user.uid);
  if (!incoming.length && !outgoing.length) return '';
  // responses waiting for me + the outcomes of the ones I sent
  const unseen = incoming.filter((i) => !i.seen).length
    + market.unseenForResponder(user.uid).length;
  return `<button class="icon-btn notif-bell" id="notif-bell" type="button" aria-label="${esc(t('mk_notif_title'))}">
    ${ICONS.bell}${unseen ? `<span class="notif-dot">${unseen > 9 ? '9+' : unseen}</span>` : ''}
  </button>`;
}

/** Today / Yesterday / 21 Oct, 2026 — the short form a feed uses. */
function postDateLabel(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const today = new Date();
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yest = new Date(today.getTime() - 86400000);
  if (sameDay(d, today)) return t('today');
  if (sameDay(d, yest)) return t('common_yesterday');
  try {
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return d.toDateString();
  }
}

/** Accepted / Rejected / Awaiting reply, in one place. */
function statusText(st) {
  if (st === 'accepted') return t('mk_accepted');
  if (st === 'rejected') return t('mk_rejected');
  return t('mk_awaiting');
}

/** The listings I have responded to. */
function myResponses(user) {
  return market.myInterests(user && user.uid);
}

export function renderMarket(user) {
  const signedIn = Boolean(user && user.uid);
  const isSeller = signedIn && store.getRole() !== 'buyer';
  const who = signedIn ? (isSeller ? t('mk_role_seller') : t('mk_role_buyer')) : t('mk_role_visitor');
  const heading = isSeller ? t('mk_title_seller') : t('mk_title_buyer');
  const desc = isSeller ? t('mk_desc_seller') : t('mk_desc_buyer');
  const title = !signedIn
    ? (isSeller ? t('mk_login_title_sell') : t('mk_login_title'))
    : isSeller ? t('mk_have_sell') : t('mk_have_buy');
  const hint = !signedIn
    ? (isSeller ? t('mk_login_hint_sell') : t('mk_login_hint'))
    : isSeller ? t('mk_post_hint_seller') : t('mk_post_hint_buyer');
  const action = !signedIn
    ? `<button class="mk-post-btn" id="mk-new" data-role="login">${esc(isSeller ? t('mk_login_seller') : t('mk_login_buyer'))}</button>`
    : `<button class="mk-post-btn" id="mk-new">${ICONS.plus} ${esc(t('mk_post'))}</button>`;
  return `
  <div class="page page-market ${isSeller ? 'mk-seller' : 'mk-buyer'}">
    <div class="mk-toprow">
      <span class="mk-role ${isSeller ? 'mk-role-seller' : 'mk-role-buyer'}">${isSeller ? ICONS.sprout : ICONS.store} ${esc(who)}</span>
      ${signedIn ? `<button class="icon-btn mk-histbtn" id="mk-history" type="button" title="${esc(t('mk_history'))}" aria-label="${esc(t('mk_history'))}">${ICONS.historyClock}</button>` : ''}
    </div>
    <header class="page-header">
      <div class="mk-headrow">
        <h1>${esc(heading)}</h1>
        ${signedIn ? `<button class="btn btn-outline btn-sm mk-myreq" id="mk-my-requests" type="button" title="${esc(t('mk_my_requests'))}">${esc(t('mk_my_requests'))}${myResponses(user).length ? ` <b>${myResponses(user).length}</b>` : ''}</button>` : ''}
      </div>
      <p>${esc(desc)}</p>
    </header>
    <section class="card mk-post${signedIn ? '' : ' mk-post--login'}">
      <span class="mk-post-ic">${isSeller ? ICONS.sprout : ICONS.store}</span>
      <div class="mk-post-txt"><b>${esc(title)}</b><span>${esc(hint)}</span></div>
      ${action}
    </section>
    ${signedIn ? notificationCard(user) : ''}
    <div id="mk-body">${marketBody(user)}</div>
    ${isSeller ? '' : `<a class="mk-home" href="#/" aria-label="${esc(t('nav_home'))}">${ICONS.home}</a>`}
  </div>`;
}

export function wireMarket(user) {
  const signedIn = Boolean(user && user.uid);
  const isSeller = signedIn && store.getRole() !== 'buyer';
  const rerender = () => {
    const body = document.getElementById('mk-body');
    if (body) body.innerHTML = marketBody(user);
    // the bell and the in-page notice live outside this element, so tell the
    // app to repaint the top bar too — otherwise the count goes stale
    window.dispatchEvent(new CustomEvent('ks:refresh-chrome'));
  };
  /**
   * Typing in the search must NOT rebuild the whole body: that recreates the
   * input, which drops the caret back to position 0 — so every new letter gets
   * inserted at the front and "ABCDEFGH" arrives as "HGFEDCBA". Only the list
   * is replaced; the field itself is left alone.
   */
  const rerenderList = () => {
    const list = document.getElementById('mk-list');
    if (list) list.outerHTML = marketList(user);
  };
  document.getElementById('mk-notif')?.addEventListener('click', () => openInterestsSheet(user));
  // "My Requests" lives in the page header, outside the list, so it gets its
  // own listener rather than the delegated one
  document.getElementById('mk-history')?.addEventListener('click', () => {
    if (!(user && user.uid)) {
      document.dispatchEvent(new CustomEvent('ks:login', { detail: { role: 'buyer' } }));
      return;
    }
    openHistorySheet(user);
  });
  document.getElementById('mk-my-requests')?.addEventListener('click', () => {
    if (!(user && user.uid)) {
      document.dispatchEvent(new CustomEvent('ks:login', { detail: { role: 'buyer' } }));
      return;
    }
    openMyRequestsSheet(user);
  });
  document.getElementById('mk-new')?.addEventListener('click', () => {
    // A listing needs an account behind it — the other side has to be able to
    // reach you. From here the visitor is a buyer, so record that role before
    // handing over to the login modal.
    if (!signedIn) {
      // Signed out, this page IS the buyer's page, so the button says "Login as
      // buyer" — the modal must say the same. It used to read the stored farm's
      // role (a farmer by default), so the buyer button opened the FARMER
      // login. That was the switch.
      document.dispatchEvent(new CustomEvent('ks:login', { detail: { role: 'buyer' } }));
      return;
    }
    openPostSheet(user, null);
  });
  const body = document.getElementById('mk-body');
  body?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-mk-tab]');
    if (chip) { marketView.tab = chip.dataset.mkTab; rerender(); return; }
    const ex = e.target.closest('[data-mk-extend]');
    if (ex) { market.extendPost(ex.dataset.mkExtend, 3); toast(t('mk_extended')); return; }
    const cl = e.target.closest('[data-mk-close]');
    if (cl) { market.closePost(cl.dataset.mkClose); toast(t('mk_closed')); return; }
    const del = e.target.closest('[data-mk-delete]');
    if (del) { market.removePost(del.dataset.mkDelete); toast(t('mk_deleted')); return; }
    const ed = e.target.closest('[data-mk-edit]');
    if (ed) { openPostForm(user, market.getPost(ed.dataset.mkEdit)); return; }
    const sent = e.target.closest('[data-mk-sent]');
    if (sent) { toast(t('mk_already_sent')); return; }
    const resp = e.target.closest('[data-mk-respond]');
    if (resp) { respondToPost(user, market.getPost(resp.dataset.mkRespond)); return; }
    // the whole card opens the listing — but a tap on one of its buttons or
    // links must do only what that button says
    const openEl = e.target.closest('[data-mk-open]');
    if (!openEl) return;
    if (e.target.closest('.mk-actions') || e.target.closest('a') || e.target.closest('button')) return;
    openPostSheet(user, market.getPost(openEl.dataset.mkOpen));
  });
  body?.addEventListener('input', (e) => {
    if (e.target.id === 'mk-q') { marketView.q = e.target.value; rerenderList(); }
  });
  market.subscribe(rerender);
}

/**
 * Tell the author of a listing that I want to deal. The author is the one who
 * gets the notification; I get a toast confirming it went out.
 */
async function respondToPost(user, post) {
  if (!post) return;
  if (!(user && user.uid)) {
    document.dispatchEvent(new CustomEvent('ks:login', { detail: { role: 'buyer' } }));
    return;
  }
  const prof = (store.getFarm().profile) || {};
  await market.addInterest(post, {
    id: user.uid,
    role: store.getRole(),
    name: prof.name || (user.email ? String(user.email).split('@')[0] : ''),
    phone: '',
  });
  toast(post.type === 'sell' ? t('mk_notified_seller') : t('mk_notified_buyer'));
  const body = document.getElementById('mk-body');
  if (body) body.innerHTML = marketBody(user);
}

/** The author's list of everyone who has responded. */
export function openInterestsSheet(user) {
  const uid = user && user.uid;
  const incoming = market.interestsForOwner(uid);
  const outgoing = market.myInterests(uid);
  market.markInterestsSeen(uid);
  // the bell lives in the top bar, so it has to be told to repaint
  window.dispatchEvent(new CustomEvent('ks:refresh-chrome'));

  const status = (i) => `<span class="mk-expiry ${i.status === 'new' ? 'is-soon' : i.status === 'rejected' ? 'is-no' : ''}">${esc(statusText(i.status))}</span>`;
  const cropPill = (i) =>
    `<span class="mk-type ${i.postType === 'sell' ? 'mk-type-sell' : 'mk-type-buy'}">${typeIcon(i.postType)} ${esc(i.postCommodity)}</span>`;
  const facts = (i) => [`${i.postQuantity || ''} ${i.postUnit || ''}`.trim(), i.postPrice].filter(Boolean).join('  ·  ');

  // Someone responded to a listing of mine — a PERSON first, and their name is
  // the headline. Tapping it opens the listing they responded to.
  // On a response that is still waiting, the cross is a decision — it means
  // "no", and the person who responded is told. On anything else it only
  // clears the card from the list.
  const cross = (i) => (i.status === 'new'
    ? `<button type="button" class="resp-x resp-x-reject" data-reject="${esc(i.id)}" data-stop aria-label="${esc(t('mk_reject'))}" title="${esc(t('mk_reject'))}">${ICONS.close}</button>`
    : `<button type="button" class="resp-x" data-dismiss="${esc(i.id)}" data-stop aria-label="${esc(t('common_remove'))}">${ICONS.close}</button>`);
  const inCard = (i) => `
    <section class="card mk-card resp-card resp-in" data-mk-open="${esc(i.postId)}" role="button" tabindex="0">
      ${cross(i)}
      <div class="mk-top">${cropPill(i)}${status(i)}</div>
      <div class="mk-crop">${esc(i.fromName || t('mk_someone'))}</div>
      <div class="mk-where">${ICONS.user} ${esc(i.fromRole === 'buyer' ? t('mk_role_buyer') : t('mk_role_seller'))}</div>
      <div class="mk-actions">
        ${i.fromPhone ? `<a class="btn btn-primary" href="${esc(telHref(i.fromPhone))}" data-stop>${ICONS.phone} ${esc(t('mk_call'))}</a>
        <a class="btn btn-outline" href="${esc(waHref(i.fromPhone))}" target="_blank" rel="noopener" data-stop>${ICONS.chat} ${esc(t('mk_whatsapp'))}</a>` : ''}
        ${i.status === 'accepted' ? '' : `<button class="btn mk-act mk-act-extend" data-mk-accept="${esc(i.id)}" data-stop>${ICONS.check} ${esc(t('mk_accept'))}</button>`}
      </div>
    </section>`;

  // A listing I responded to — the LISTING first, so the two sections cannot be
  // mistaken for each other.
  const outCard = (i) => `
    <section class="card mk-card resp-card resp-out" data-mk-open="${esc(i.postId)}" role="button" tabindex="0">
      ${cross(i)}
      <div class="mk-top">${cropPill(i)}${status(i)}</div>
      <div class="mk-crop">${esc(i.postCommodity)}</div>
      ${facts(i) ? `<div class="mk-facts"><span><b>${esc(facts(i))}</b></span></div>` : ''}
      ${i.postPlace ? `<div class="mk-where">${ICONS.pin} ${esc(i.postPlace)}</div>` : ''}
      <div class="mk-actions">
        <span class="btn btn-outline">${esc(t('mk_view_listing'))}</span>
      </div>
    </section>`;

  const host = openSheet(`
    <div class="mk-sheet-head sheet-roomy sheet-wide">
      <h2 class="sheet-title" style="margin:0">${esc(t('mk_responses'))}</h2>
      ${(incoming.length || outgoing.length) ? `<button type="button" class="btn btn-outline btn-sm" id="resp-clear">${ICONS.trash} ${esc(t('mk_clear_notifications'))}</button>` : ''}
      <button type="button" class="icon-btn" data-sheet-close aria-label="${esc(t('mk_cancel'))}">${ICONS.close}</button>
    </div>
    <div class="resp-wrap">
      <div class="resp-section resp-section-in">${esc(t('mk_notif_title'))}${incoming.length ? ` <b>${incoming.length}</b>` : ''}</div>
      <div class="mk-list">
        ${incoming.length ? incoming.map(inCard).join('') : `<div class="card mk-empty">${esc(t('mk_no_notifs'))}</div>`}
      </div>
      <div class="resp-section resp-section-out">${esc(t('mk_your_responses'))}${outgoing.length ? ` <b>${outgoing.length}</b>` : ''}</div>
      <div class="mk-list">
        ${outgoing.length ? outgoing.map(outCard).join('') : `<div class="card mk-empty">${esc(t('mk_none_responses'))}</div>`}
      </div>
    </div>
  `);
  if (!host) return;
  document.getElementById('resp-clear')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    market.clearInterests(uid);
    toast(t('mk_notifications_cleared'));
    closeSheet();
  });
  host.querySelectorAll('[data-reject]').forEach((b) =>
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      market.rejectInterest(b.dataset.reject);
      toast(t('mk_rejected'));
      openInterestsSheet(user);
    }));
  host.querySelectorAll('[data-dismiss]').forEach((b) =>
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      market.dismissInterest(b.dataset.dismiss);
      openInterestsSheet(user);   // redraw without it
    }));

  // Accepting must not also open the listing underneath it.
  host.querySelectorAll('[data-mk-accept]').forEach((b) =>
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      market.acceptInterest(b.dataset.mkAccept);
      toast(t('mk_interest_accepted'));
      openInterestsSheet(user);
    }));
  // …and a tap anywhere else on a card opens the listing it is about.
  host.querySelectorAll('.resp-card[data-mk-open]').forEach((card) =>
    card.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-stop]')) return;
      const post = market.getPost(card.dataset.mkOpen);
      if (!post) return;
      closeSheet();
      setTimeout(() => openPostSheet(user, post), 220);
    }));
}

/** Just my own responses — the half of the notification sheet that belongs on
 *  the market page, behind the "My Requests" button. */
export function openMyRequestsSheet(user) {
  const uid = user && user.uid;
  const mine = market.myInterests(uid);
  market.markInterestsSeen(uid);
  window.dispatchEvent(new CustomEvent('ks:refresh-chrome'));
  const status = (i) => `<span class="mk-expiry ${i.status === 'new' ? 'is-soon' : i.status === 'rejected' ? 'is-no' : ''}">${esc(statusText(i.status))}</span>`;
  const facts = (i) => [`${i.postQuantity || ''} ${i.postUnit || ''}`.trim(), i.postPrice].filter(Boolean).join('  ·  ');
  const host = openSheet(`
    <div class="mk-sheet-head sheet-roomy sheet-wide">
      <h2 class="sheet-title" style="margin:0">${esc(t('mk_my_requests'))}</h2>
      <button type="button" class="icon-btn" data-sheet-close aria-label="${esc(t('mk_cancel'))}">${ICONS.close}</button>
    </div>
    <div class="resp-wrap">
      <div class="mk-list">
        ${mine.length ? mine.map((i) => `
          <section class="card mk-card resp-card resp-out" data-mk-open="${esc(i.postId)}" role="button" tabindex="0">
            <button type="button" class="resp-x" data-dismiss="${esc(i.id)}" data-stop aria-label="${esc(t('common_remove'))}">${ICONS.close}</button>
            <div class="mk-top">
              <span class="mk-type ${i.postType === 'sell' ? 'mk-type-sell' : 'mk-type-buy'}">${typeIcon(i.postType)} ${esc(i.postCommodity)}</span>
              ${status(i)}
            </div>
            <div class="mk-crop">${esc(i.postCommodity)}</div>
            ${facts(i) ? `<div class="mk-facts"><span><b>${esc(facts(i))}</b></span></div>` : ''}
            ${i.postPlace ? `<div class="mk-where">${ICONS.pin} ${esc(i.postPlace)}</div>` : ''}
            <div class="mk-actions"><span class="btn btn-outline">${esc(t('mk_view_listing'))}</span></div>
          </section>`).join('') : `<div class="card mk-empty">${esc(t('mk_none_responses'))}</div>`}
      </div>
    </div>
  `);
  if (!host) return;
  host.querySelectorAll('[data-dismiss]').forEach((b) =>
    b.addEventListener('click', (ev) => { ev.stopPropagation(); market.dismissInterest(b.dataset.dismiss); openMyRequestsSheet(user); }));
  host.querySelectorAll('.resp-card[data-mk-open]').forEach((card) =>
    card.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-stop]')) return;
      const post = market.getPost(card.dataset.mkOpen);
      if (!post) return;
      closeSheet();
      setTimeout(() => openPostSheet(user, post), 220);
    }));
}

/**
 * The history — every response I was part of, accepted, rejected or still
 * waiting, whether or not I cleared it from the notifications. Kept for 30
 * days, with the countdown shown on each one.
 */
export function openHistorySheet(user) {
  const uid = user && user.uid;
  const rows = market.historyFor(uid);
  const dateOf = (ms) => {
    try { return new Date(ms || 0).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return ''; }
  };
  const host = openSheet(`
    <div class="mk-sheet-head sheet-roomy sheet-wide">
      <h2 class="sheet-title" style="margin:0">${esc(t('mk_history'))}</h2>
      <button type="button" class="icon-btn" data-sheet-close aria-label="${esc(t('mk_cancel'))}">${ICONS.close}</button>
    </div>
    <div class="resp-wrap">
      <div class="mk-list">
        ${rows.length ? rows.map((i) => {
          const mine = i.toId === uid;                       // I owned the listing
          const other = mine ? (i.fromName || t('mk_someone')) : (i.postCommodity || '');
          const otherRole = mine ? (i.fromRole === 'buyer' ? t('mk_role_buyer') : t('mk_role_seller')) : '';
          return `
          <section class="card mk-card resp-card ${mine ? 'resp-in' : 'resp-out'}" data-mk-open="${esc(i.postId)}" role="button" tabindex="0">
            <div class="mk-top">
              <span class="mk-type ${i.postType === 'sell' ? 'mk-type-sell' : 'mk-type-buy'}">${typeIcon(i.postType)} ${esc(i.postCommodity)}</span>
              <span class="mk-expiry ${i.status === 'new' ? 'is-soon' : i.status === 'rejected' ? 'is-no' : ''}">${esc(statusText(i.status))}</span>
            </div>
            <div class="mk-crop">${esc(other)}</div>
            ${otherRole ? `<div class="mk-where">${ICONS.user} ${esc(otherRole)}</div>` : ''}
            <div class="mk-facts">
              <span>${ICONS.clock} ${esc(dateOf(i.createdAt))}</span>
              <span class="mk-countdown">${esc(String(market.daysLeftInHistory(i)))} ${esc(t('mk_days_left'))}</span>
            </div>
            <div class="mk-actions"><span class="btn btn-outline">${esc(t('mk_view_listing'))}</span></div>
          </section>`;
        }).join('') : `<div class="card mk-empty">${esc(t('mk_none_responses'))}</div>`}
      </div>
    </div>
  `);
  if (!host) return;
  host.querySelectorAll('.resp-card[data-mk-open]').forEach((card) =>
    card.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-stop]')) return;
      const post = market.getPost(card.dataset.mkOpen);
      if (!post) return;
      closeSheet();
      setTimeout(() => openPostSheet(user, post), 220);
    }));
}

/** The listing detail and the create form, both as bottom sheets. */
function openPostSheet(user, post) {
  const isSeller = store.getRole() !== 'buyer';
  if (post && post.id) {
    const dl = daysLabel(post);
    const mine = user && post.authorId === user.uid;
    openSheet(`
      <div class="mk-top" style="margin-bottom:.6rem">
        <span class="mk-type ${post.type === 'sell' ? 'mk-type-sell' : 'mk-type-buy'}">${typeIcon(post.type)} ${esc(typeLabel(post.type))}</span>
        <span class="mk-expiry ${dl.soon ? 'is-soon' : ''}">${esc(dl.text)}</span>
      </div>
      <div class="mk-crop" style="font-size:1.35rem">${esc(post.commodity)}</div>
      ${post.image ? `<img class="mk-img" src="${esc(post.image)}" alt="${esc(post.commodity)}" />` : ''}
      <div class="mk-rows">
        <div class="mk-row"><em>${esc(t('mk_quantity'))}</em><b>${esc(post.quantity)} ${esc(post.unit)}</b></div>
        ${post.price ? `<div class="mk-row"><em>${esc(post.type === 'sell' ? t('mk_price_want') : t('mk_price_pay'))}</em><b>${esc(post.price)}</b></div>` : ''}
        ${post.place ? `<div class="mk-row"><em>${esc(t('mk_place'))}</em><b>${esc(post.place)}</b></div>` : ''}
        ${post.createdAt ? `<div class="mk-row"><em>${esc(t('mk_posted_on'))}</em><b>${esc(postDateLabel(post.createdAt))}</b></div>` : ''}
        ${user && user.uid ? `<div class="mk-row"><em>${esc(t('mk_posted_by'))}</em><b>${esc(post.authorName || (mine ? store.myName() : '') || t('mk_someone'))}</b></div>` : ''}
      </div>
      ${post.notes ? `<p class="mk-note" style="margin-top:.6rem">${esc(post.notes)}</p>` : ''}
      <div class="mk-actions" style="margin-top:.7rem">
        <a class="btn btn-primary" href="${esc(telHref(post.phone))}">${ICONS.phone} ${esc(t('mk_call'))}</a>
        <a class="btn btn-outline" href="${esc(waHref(post.phone, `${t('mk_wa_hi')} ${post.commodity}`))}" target="_blank" rel="noopener">${ICONS.chat} ${esc(t('mk_whatsapp'))}</a>
      </div>
      ${mine ? `<div class="mk-actions" style="margin-top:.5rem">
        <button class="btn mk-act mk-act-edit" id="mk-edit-sheet" data-id="${esc(post.id)}">${ICONS.pencil} ${esc(t('mk_edit'))}</button>
        <button class="btn mk-act mk-act-delete" id="mk-del-sheet" data-id="${esc(post.id)}">${ICONS.trash} ${esc(t('mk_delete'))}</button>
      </div>` : ''}
    `);
    document.getElementById('mk-del-sheet')?.addEventListener('click', (e) => {
      market.removePost(e.currentTarget.dataset.id); closeSheet(); toast(t('mk_deleted'));
    });
    document.getElementById('mk-edit-sheet')?.addEventListener('click', (e) => {
      closeSheet(); setTimeout(() => openPostForm(user, market.getPost(e.currentTarget.dataset.id)), 220);
    });
    return;
  }
  openPostForm(user, null);
}

/** Create a listing — or edit an existing one. Same form, prefilled. */
export function openPostForm(user, post) {
  const isSeller = store.getRole() !== 'buyer';
  const editing = Boolean(post && post.id);
  const farm = store.getFarm();
  const p = farm.profile || {};
  const myCrop = (farm.crops || [])[0];
  const place = post ? post.place : [p.district, p.state].filter(Boolean).join(', ');
  const UNITS = ['quintal', 'tonne', 'kg', 'bag'];
  const unit = editing && UNITS.includes(post.unit) ? post.unit : 'quintal';
  // "₹ per quintal" must follow whatever unit is chosen
  const pricePlaceholder = (u) => `₹ / ${u}`;
  openSheet(`
    <div class="mk-sheet-head">
      <h2 class="sheet-title" style="margin:0">${esc(editing ? t('mk_edit_listing') : (isSeller ? t('mk_form_seller') : t('mk_form_buyer')))}</h2>
      <button type="button" class="icon-btn" data-sheet-close aria-label="${esc(t('mk_cancel'))}">${ICONS.close}</button>
    </div>
    ${editing ? '' : `<p class="mk-note" style="margin:0 0 .8rem">${esc(isSeller ? t('mk_form_desc_seller') : t('mk_form_desc_buyer'))}</p>`}
    <form class="mk-form" id="mk-form">
      <label>${esc(t('crop_commodity'))}*${renderCombobox({ id: 'mk-crop', items: CROPS, common: COMMON_CROPS, value: post ? post.commodity : (myCrop ? myCrop.commodity : ''), placeholder: t('crop_search_ph'), noMatch: t('crop_no_match'), moreHint: t('crop_more_hint') })}</label>
      <div class="mk-two">
        <label>${esc(t('mk_quantity'))}*<input id="mk-qty" inputmode="numeric" value="${esc(editing ? post.quantity : '')}" required /></label>
        <label>${esc(t('mk_unit'))}<select id="mk-unit">
          ${UNITS.map((u) => `<option value="${u}"${u === unit ? ' selected' : ''}>${u}</option>`).join('')}</select></label>
      </div>
      <label>${esc(isSeller ? t('mk_price_want') : t('mk_price_pay'))}<input id="mk-price" value="${esc(editing ? post.price : '')}" placeholder="${esc(pricePlaceholder(unit))}" /></label>
      <label>${esc(t('mk_place'))}*<input id="mk-place" value="${esc(place)}" required /></label>

      <div class="mk-photo-field">
        <input type="file" id="mk-photo" accept="image/*" hidden />
        <div class="mk-photo-box ${editing && post.image ? '' : 'hidden'}" id="mk-photo-box">
          <img class="mk-photo-preview" id="mk-photo-preview" src="${esc(editing && post.image ? post.image : '')}" alt="" />
          <button type="button" class="mk-photo-x" id="mk-photo-x" aria-label="${esc(t('mk_photo_remove'))}">${ICONS.close}</button>
        </div>
        <button type="button" class="mk-add" id="mk-photo-btn">${ICONS.image} <span id="mk-photo-label">${esc(editing && post.image ? t('mk_photo_change') : t('mk_add_photo'))}</span></button>
        <span class="mk-note">${esc(t('mk_photo_hint'))}</span>
      </div>

      <label>${esc(t('mk_phone'))}*<input id="mk-phone" inputmode="tel" value="${esc(editing ? post.phone : '')}" required /></label>
      <label>${esc(t('mk_email'))} <span class="mk-note">(${esc(t('mk_optional'))})</span><input id="mk-email" type="email" value="${esc(editing ? post.email : '')}" /></label>
      <label>${esc(t('mk_notes'))}<textarea id="mk-notes" rows="3">${esc(editing ? post.notes : '')}</textarea></label>
      <label>${esc(t('mk_valid'))}<input id="mk-valid" inputmode="numeric" value="${editing ? market.daysLeft(post) || 3 : 15}" />
        <span class="mk-note">${esc(t('mk_valid_hint'))}</span></label>
      <button class="mk-submit" type="submit">${ICONS.check} ${esc(editing ? t('mk_save_changes') : (isSeller ? t('mk_submit_seller') : t('mk_submit_buyer')))}</button>
    </form>
  `);
  wireCombobox('mk-crop');

  const unitSel = document.getElementById('mk-unit');
  const priceIn = document.getElementById('mk-price');
  unitSel?.addEventListener('change', () => {
    if (!priceIn.value.trim()) priceIn.placeholder = pricePlaceholder(unitSel.value);
  });

  // ── the photo: optional, shrunk in the browser, stored in Cloudinary ──
  let photoUrl = editing ? post.image || '' : '';
  const photoInput = document.getElementById('mk-photo');
  const photoBox = document.getElementById('mk-photo-box');
  const photoPreview = document.getElementById('mk-photo-preview');
  const photoLabel = document.getElementById('mk-photo-label');
  const showPhoto = (url) => {
    photoUrl = url || '';
    if (photoUrl) {
      photoPreview.src = photoUrl;
      photoBox.classList.remove('hidden');
      photoLabel.textContent = t('mk_photo_change');
    } else {
      photoPreview.removeAttribute('src');
      photoBox.classList.add('hidden');
      photoLabel.textContent = t('mk_add_photo');
    }
  };
  document.getElementById('mk-photo-btn')?.addEventListener('click', () => photoInput?.click());
  document.getElementById('mk-photo-x')?.addEventListener('click', () => {
    showPhoto('');
    if (photoInput) photoInput.value = '';
    toast(t('mk_photo_removed'));
  });
  photoInput?.addEventListener('change', async () => {
    const file = photoInput.files && photoInput.files[0];
    if (!file) return;
    photoLabel.textContent = t('mk_photo_uploading');
    try {
      // 700 KB — small enough to upload fast, large enough to look sharp
      const dataUrl = await shrinkImage(await readAsDataUrl(file), 700 * 1024);
      const url = await uploadMarketPhoto(dataUrl);
      if (url) {
        showPhoto(url);
        toast(t('mk_photo_added'));
      } else {
        photoLabel.textContent = t('mk_photo_failed');
      }
    } catch {
      photoLabel.textContent = t('mk_photo_failed');
    }
  });

  document.getElementById('mk-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const crop = document.getElementById('mk-crop').value.trim();
    const qty = document.getElementById('mk-qty').value.trim();
    const phone = document.getElementById('mk-phone').value.trim();
    if (!crop || !qty || !phone) return;
    const fields = {
      commodity: crop, quantity: qty,
      unit: unitSel.value,
      price: priceIn.value.trim(),
      place: document.getElementById('mk-place').value.trim(),
      phone, email: document.getElementById('mk-email').value.trim(),
      notes: document.getElementById('mk-notes').value.trim(),
      image: photoUrl,
      validDays: Number(document.getElementById('mk-valid').value) || 15,
    };
    if (editing) {
      market.editPost(post.id, {
        ...fields,
        expiresAt: Date.now() + fields.validDays * 86400000,
        status: 'open',
      });
      closeSheet();
      marketView.tab = 'mine';
      const body = document.getElementById('mk-body');
      if (body) body.innerHTML = marketBody(user);
      toast(t('mk_updated'));
      return;
    }
    const created = await market.addPost({
      ...fields,
      type: isSeller ? 'sell' : 'buy',
      authorRole: isSeller ? 'farmer' : 'buyer',
      authorName: store.myName(),
    });
    closeSheet();
    marketView.tab = 'mine';
    const body = document.getElementById('mk-body');
    if (body) body.innerHTML = marketBody(user);
    toast(created && created.syncError ? t('mk_post_local_only') : t('mk_posted'));
  });
}
