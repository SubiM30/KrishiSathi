/**
 * app.js — KrishiSathi boot loader, app shell and mini router.
 *
 * ── How the shell is organised ──────────────────────────────────────
 *   • NAV / MORE below are the single source of truth for navigation.
 *     On phones the bottom bar shows NAV (5 tabs); on desktop the left
 *     rail shows every feature (NAV + MORE) with the "More" tab gone.
 *   • Overlays (the More menu, the language picker, weather-day detail)
 *     all use the one reusable sheet in sheet.js.
 *   • Pages read their data from store.js, so nothing is hard-coded.
 */
import {
  initFirebase, isGuest, setGuest,
  loginEmail, signUpEmail, loginGoogle, logout, onAuthChange,
} from './auth.js';
import { hydrate, subscribe as subscribeFarm, clearLocalData } from './store.js';
import { initSheet, openSheet, closeSheet, isSheetOpen } from './sheet.js';
import { showAnimated, hideAnimated } from './motion.js';
import {
  renderHome, wireHome,
  renderCropDoctor, wireCropDoctor,
  renderMandi, wireMandi,
  renderSell, wireSell,
  renderWeather, wireWeather,
  renderSchemes, wireSchemes,
  renderChat, wireChat,
  renderFarm, wireFarm,
  renderSettings, wireSettings,
} from './views.js';
import { ICONS } from './icons.js';
import { t, LANGS, LANG_NAMES_EN, getLang, setLang } from './i18n.js';

/* ════════════════════════════════════════════════════════════════
   NAVIGATION CONFIG — edit here, the UI follows.
   icon  : any key from icons.js        i18n : a key from i18n.js
   center: true → the raised primary action (phones only)
   action:'more' → opens the More sheet instead of navigating
   ════════════════════════════════════════════════════════════════ */
const NAV = [
  { id: 'home',        href: '#/',            icon: 'home',  i18n: 'nav_home'   },
  { id: 'mandi',       href: '#/mandi',       icon: 'store', i18n: 'nav_mandi'  },
  { id: 'crop-doctor', href: '#/crop-doctor', icon: 'scan',  i18n: 'nav_doctor', center: true },
  { id: 'chat',        href: '#/chat',        icon: 'chat',  i18n: 'nav_chat'   },
  { id: 'more',        href: '#',             icon: 'grid',  i18n: 'nav_more', action: 'more' },
];

/* Features that live one level down on phones (and inline on desktop). */
const MORE = [
  { id: 'weather',  href: '#/weather',  icon: 'cloudSun', i18n: 'nav_weather'  },
  { id: 'sell',     href: '#/sell',     icon: 'scale',    i18n: 'nav_sell'     },
  { id: 'farm',     href: '#/farm',     icon: 'sprout',   i18n: 'nav_farm'     },
  { id: 'schemes',  href: '#/schemes',  icon: 'scroll',   i18n: 'nav_schemes'  },
  { id: 'settings', href: '#/settings', icon: 'settings', i18n: 'nav_settings' },
];

/* ════════════════════════════════════════════════════════════════ */
const app = document.getElementById('app');
const authArea = document.getElementById('auth-area');
const tabbar = document.getElementById('tabbar');

let currentUser = null;
let firebaseReady = false;

const isDesktop = () => window.matchMedia('(min-width: 1024px)').matches;

/* ── Router ─────────────────────────────────────── */
const routes = {
  home: { render: () => renderHome(currentUser, isGuest()), wire: () => wireHome(currentUser) },
  'crop-doctor': { render: renderCropDoctor, wire: () => wireCropDoctor(currentUser) },
  mandi: { render: renderMandi, wire: wireMandi },
  sell: { render: renderSell, wire: () => wireSell(currentUser) },
  weather: { render: renderWeather, wire: wireWeather },
  schemes: { render: renderSchemes, wire: wireSchemes },
  chat: { render: renderChat, wire: () => wireChat(currentUser) },
  farm: { render: renderFarm, wire: () => wireFarm(currentUser) },
  settings: { render: () => renderSettings(currentUser), wire: () => wireSettings(currentUser) },
};

const currentId = () => location.hash.replace('#/', '') || 'home';

function navigate() {
  const id = currentId();
  const route = routes[id] || routes.home;

  app.innerHTML = route.render();
  if (route.wire) route.wire();

  setActiveTab(id);
  closeSheet();
  window.scrollTo({ top: 0, behavior: 'auto' });
}
window.addEventListener('hashchange', navigate);

/* Re-render the current page whenever the farm data changes. */
subscribeFarm(() => {
  const id = currentId();
  if (['home', 'farm', 'sell', 'settings'].includes(id)) {
    const route = routes[id];
    app.innerHTML = route.render();
    if (route.wire) route.wire();
  }
});

/* ── Navigation: build the bar/rail from the config ── */
function tabHtml(item) {
  const inner = `<span class="tab-ic">${ICONS[item.icon]}</span><span class="tab-label">${t(item.i18n)}</span>`;
  const cls = `tab${item.center && !isDesktop() ? ' tab-center' : ''}`;
  if (item.action === 'more') {
    return `<button class="${cls}" type="button" data-nav="${item.id}" aria-label="${t(item.i18n)}">${inner}</button>`;
  }
  return `<a class="${cls}" href="${item.href}" data-nav="${item.id}" aria-label="${t(item.i18n)}">${inner}</a>`;
}

function buildTabbar() {
  const desktop = isDesktop();
  if (desktop) {
    // desktop: list every feature, no "More" indirection
    tabbar.innerHTML =
      NAV.filter((i) => i.action !== 'more').map(tabHtml).join('') +
      '<div class="rail-sep" role="presentation"><span>' + t('nav_more') + '</span></div>' +
      MORE.map((m) => tabHtml({ ...m, action: undefined })).join('');
  } else {
    tabbar.innerHTML = NAV.map(tabHtml).join('');
  }
  tabbar.querySelectorAll('[data-nav="more"]').forEach((el) =>
    el.addEventListener('click', openMoreSheet)
  );
}

function setActiveTab(id) {
  const inMore = MORE.some((m) => m.id === id);
  tabbar.querySelectorAll('[data-nav]').forEach((el) => {
    const n = el.dataset.nav;
    const active = n === id || (n === 'more' && inMore);
    el.classList.toggle('active', active);
    if (active) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
}

let wasDesktop = isDesktop();
window.addEventListener('resize', () => {
  if (isDesktop() !== wasDesktop) {
    wasDesktop = isDesktop();
    buildTabbar();
    setActiveTab(currentId());
  }
});

/* ── Overlays (shared sheet) ───────────────────── */
function openMoreSheet() {
  openSheet(`
    <div class="sheet-grabber" aria-hidden="true"></div>
    <div class="sheet-head">
      <h2>${t('nav_more')}</h2>
      <button class="icon-btn" type="button" data-sheet-close aria-label="Close">${ICONS.close}</button>
    </div>
    <div class="more-grid">
      ${MORE.map((m) => `
        <a class="more-tile" href="${m.href}">
          <span class="more-tile-ic">${ICONS[m.icon]}</span>
          <span class="more-tile-label">${t(m.i18n)}</span>
          <span class="more-tile-arrow">${ICONS.chevronRight}</span>
        </a>`).join('')}
    </div>
    <p class="sheet-foot small muted">${t('sources')}: AGMARKNET · Open-Meteo · Groq</p>`);
}

function openLanguageSheet() {
  openSheet(`
    <div class="sheet-grabber" aria-hidden="true"></div>
    <div class="sheet-head">
      <h2>${t('lang_title')}</h2>
      <button class="icon-btn" type="button" data-sheet-close aria-label="Close">${ICONS.close}</button>
    </div>
    <div class="lang-grid">
      ${LANGS.map((l) => `
        <button class="lang-item${l.code === getLang() ? ' active' : ''}" type="button" data-lang="${l.code}">
          <span class="lang-name">${l.name}</span>
          <span class="lang-en">${LANG_NAMES_EN[l.code] || ''}</span>
          <span class="lang-tick">${l.code === getLang() ? ICONS.check : ''}</span>
        </button>`).join('')}
    </div>`);

  document.getElementById('more-sheet').querySelectorAll('[data-lang]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setLang(btn.dataset.lang);
      closeSheet();
      applyLanguage();
    });
  });
}

/* ── Language ──────────────────────────────────── */
function applyLanguage() {
  document.documentElement.lang = getLang();
  const cur = document.getElementById('lang-current');
  if (cur) {
    const l = LANGS.find((x) => x.code === getLang());
    cur.textContent = l ? l.name : 'English';
  }
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  setMode(mode);
  renderAuthArea();
  buildTabbar();
  navigate();
}

document.getElementById('lang-btn').addEventListener('click', openLanguageSheet);

/* ── Appearance: light / dark / system ─────────── */
const themeToggle = document.getElementById('theme-toggle');
const THEME_KEY = 'ks_theme';

/** The stored preference: 'light' | 'dark' | 'system' (default). */
function themePref() {
  try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; }
}
/** 'system' resolves to whatever the device is set to. */
function resolveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme(pref) {
  const theme = resolveTheme(pref);
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b120e' : '#0f9d58');
  themeToggle.innerHTML = theme === 'dark' ? ICONS.sun : ICONS.moon;
  themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
}
function setThemePref(pref) {
  try { localStorage.setItem(THEME_KEY, pref); } catch {}
  applyTheme(pref);
}
applyTheme(themePref());

// While the preference is "system", follow the device if it changes.
try {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  if (mq.addEventListener) mq.addEventListener('change', () => { if (themePref() === 'system') applyTheme('system'); });
} catch {}

// The app-bar button flips between light and dark (an explicit choice).
themeToggle.addEventListener('click', () => {
  const now = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  setThemePref(now === 'dark' ? 'light' : 'dark');
});

// The Settings page uses these.
window.ksTheme = { pref: themePref, set: setThemePref, apply: applyTheme };

/* ── Account area ──────────────────────────────── */
function initials(name) {
  const clean = (name || '').trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/);
  return ((parts[0][0] || '') + (parts[1] ? parts[1][0] : '')).toUpperCase() || '?';
}

function renderAuthArea() {
  if (currentUser) {
    const name = currentUser.displayName || currentUser.email || 'Farmer';
    authArea.innerHTML = `
      <button class="avatar" id="btn-account" title="${name.replace(/"/g, '')}" aria-label="${name.replace(/"/g, '')}">
        ${initials(name)}
      </button>
      <div class="account-menu hidden" id="account-menu">
        <div class="account-menu-head">
          <span class="account-menu-name">${name.split(' ')[0].split('@')[0]}</span>
          <span class="account-menu-sub">${currentUser.email || ''}</span>
        </div>
        <a class="account-menu-item" href="#/farm">${ICONS.sprout} ${t('nav_farm')}</a>
        <a class="account-menu-item" href="#/settings">${ICONS.settings} ${t('nav_settings')}</a>
        <button class="account-menu-item" id="btn-logout">${ICONS.logout} ${t('common_logout')}</button>
      </div>`;
    const menu = document.getElementById('account-menu');
    document.getElementById('btn-account').addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu.classList.contains('hidden')) showAnimated(menu);
      else hideAnimated(menu, 200);
    });
    document.addEventListener('click', () => hideAnimated(menu, 200), { once: true });
    document.getElementById('btn-logout').addEventListener('click', async () => {
      try {
        await logout();
      } catch (e) {}
      // wipe this device — the farm is re-fetched from Firestore on next login
      clearLocalData();
    });
  } else if (isGuest()) {
    authArea.innerHTML = `
      <button class="avatar avatar-guest" id="btn-exit-guest" title="${t('auth_guest')}" aria-label="${t('auth_guest')}">
        ${ICONS.user.replace('<svg ', '<svg width="18" height="18" ')}
      </button>`;
    document.getElementById('btn-exit-guest').addEventListener('click', () => {
      setGuest(false);
      renderAuthArea();
      navigate();
      openModal('login');
    });
  } else {
    authArea.innerHTML = `<button class="btn btn-primary btn-sm auth-login" id="open-login">${t('common_login')}</button>`;
    document.getElementById('open-login').addEventListener('click', () => openModal('login'));
  }
}

/* ── Login / Signup modal ──────────────────────── */
const modal = document.getElementById('login-modal');
const loginError = document.getElementById('login-error');
const tabs = {
  login: document.getElementById('tab-login'),
  signup: document.getElementById('tab-signup'),
};
const form = document.getElementById('login-form');
const nameWrap = document.getElementById('name-wrap');
const submitBtn = document.getElementById('login-submit');
const modalTitle = document.getElementById('modal-title');
const modalHint = document.getElementById('modal-hint');
let mode = 'login';

function openModal(preferred = 'login') {
  setMode(preferred);
  if (!firebaseReady) {
    loginError.textContent =
      'Firebase is not configured yet. Press F12 and check the browser console — it lists exactly which fields in firebase-config.js are still placeholders.';
    loginError.classList.remove('hidden');
  } else {
    loginError.classList.add('hidden');
  }
  showAnimated(modal);
  document.body.classList.add('no-scroll');
  document.getElementById('login-email').focus();
}

function setMode(next) {
  mode = next;
  tabs.login.querySelector('[data-i18n]')?.setAttribute('data-i18n', 'common_login');
  tabs.signup.querySelector('[data-i18n]')?.setAttribute('data-i18n', 'common_signup');
  tabs.login.querySelector('[data-i18n]').textContent = t('common_login');
  tabs.signup.querySelector('[data-i18n]').textContent = t('common_signup');
  tabs.login.classList.toggle('active', next === 'login');
  tabs.signup.classList.toggle('active', next === 'signup');
  tabs.login.setAttribute('aria-selected', String(next === 'login'));
  tabs.signup.setAttribute('aria-selected', String(next === 'signup'));
  nameWrap.classList.toggle('hidden', next === 'login');
  const pw = document.getElementById('login-password');
  pw.autocomplete = next === 'login' ? 'current-password' : 'new-password';
  modalTitle.textContent = next === 'login' ? t('hero_welcome_back') : t('auth_create');
  submitBtn.textContent = next === 'login' ? t('common_login') : t('common_signup');
  modalHint.textContent =
    next === 'login'
      ? 'Guests can explore everything — log in to save your farm and history.'
      : 'An account keeps your crops, costs and diagnoses saved privately.';
  loginError.classList.add('hidden');
}

tabs.login.addEventListener('click', () => setMode('login'));
tabs.signup.addEventListener('click', () => setMode('signup'));

const closeLogin = () => {
  document.body.classList.remove('no-scroll');
  hideAnimated(modal, 260); // the backdrop fades and the panel scales away
};
document.getElementById('login-close').addEventListener('click', closeLogin);
modal.addEventListener('click', (e) => e.target === modal && closeLogin());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !isSheetOpen()) closeLogin();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!firebaseReady) return openModal(mode);
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const name = document.getElementById('login-name').value.trim();
  submitBtn.disabled = true;
  const original = submitBtn.textContent;
  submitBtn.textContent = '…';
  try {
    if (mode === 'signup') await signUpEmail(email, password, name);
    else await loginEmail(email, password);
    setGuest(false);
    closeLogin();
    form.reset();
  } catch (err) {
    loginError.textContent = friendlyAuthError(err.code || err.message);
    loginError.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = original;
  }
});

document.getElementById('google-login').addEventListener('click', async () => {
  if (!firebaseReady) return openModal(mode);
  try {
    await loginGoogle();
    setGuest(false);
    closeLogin();
  } catch (err) {
    loginError.textContent = friendlyAuthError(err.code || err.message);
    loginError.classList.remove('hidden');
  }
});

document.getElementById('guest-login').addEventListener('click', () => {
  setGuest(true);
  closeLogin();
  renderAuthArea();
  navigate();
});

function friendlyAuthError(code) {
  const map = {
    'auth/invalid-email': 'That email address looks wrong.',
    'auth/missing-password': 'Please enter a password.',
    'auth/wrong-password': 'Wrong password. Try again, or use the Sign up tab.',
    'auth/user-not-found': 'No account with that email. Use the Sign up tab to create one.',
    'auth/email-already-in-use': 'This email already has an account — switch to the Log in tab.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
    'auth/popup-closed-by-user': 'Google login window was closed. Try again.',
    'auth/operation-not-allowed': 'This login method is disabled in Firebase Console.',
    'auth/invalid-credential': 'Wrong email or password — or create an account on the Sign up tab.',
  };
  return map[code] || 'Something went wrong. Please try again.';
}

/* ── Static chrome icons ───────────────────────── */
function paintChrome() {
  const mark = ICONS.logo;
  const bm = document.getElementById('brand-mark');
  const fm = document.getElementById('footer-mark');
  const gp = document.getElementById('lang-pill-ic');
  if (bm) bm.innerHTML = mark;
  if (fm) fm.innerHTML = mark;
  if (gp) gp.innerHTML = ICONS.globe;
}

/* ── PWA ───────────────────────────────────────── */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/* ── Boot ──────────────────────────────────────── */
(async function boot() {
  initSheet();
  paintChrome();
  buildTabbar();
  applyLanguage();

  firebaseReady = await initFirebase();

  if (firebaseReady) {
    onAuthChange(async (user) => {
      currentUser = user;
      if (user) await hydrate(user); // pull the farmer's farm from Firestore
      renderAuthArea();
      navigate();
    });
  } else {
    renderAuthArea();
    navigate();
  }
  setMode('login');
})();
