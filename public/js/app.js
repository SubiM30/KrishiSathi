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
import { hydrate, subscribe as subscribeFarm, clearLocalData, setRole, getRole, myName } from './store.js';
import { hydrate as hydrateMarket, hydrateInterests, clearLocal as clearMarketLocal } from './market.js';
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
  renderMarket, wireMarket, bellButton, openInterestsSheet,
  renderSettings, wireSettings, initVoiceAsk,
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
  { id: 'market',   href: '#/market',   icon: 'handshake', i18n: 'nav_market', roleName: true },
  { id: 'settings', href: '#/settings', icon: 'settings',  i18n: 'nav_settings' },
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
  market: { render: () => renderMarket(currentUser), wire: () => wireMarket(currentUser) },
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
  const inner = `<span class="tab-ic">${ICONS[item.icon]}</span><span class="tab-label">${navLabel(item)}</span>`;
  const cls = `tab${item.center && !isDesktop() ? ' tab-center' : ''}`;
  if (item.action === 'more') {
    return `<button class="${cls}" type="button" data-nav="${item.id}" aria-label="${navLabel(item)}">${inner}</button>`;
  }
  return `<a class="${cls}" href="${item.href}" data-nav="${item.id}" aria-label="${navLabel(item)}">${inner}</a>`;
}

/**
 * A nav item's label. Most are fixed; the market one names the job the
 * signed-in person actually has — a farmer goes there to SELL, a buyer (or a
 * visitor) to BUY.
 */
function navLabel(item) {
  if (item.roleName) {
    const isSeller = getRole() !== 'buyer' && Boolean(currentUser && currentUser.uid);
    return t(isSeller ? 'nav_direct_selling' : 'nav_direct_buying');
  }
  return t(item.i18n);
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
          <span class="more-tile-label">${navLabel(m)}</span>
          <span class="more-tile-arrow">${ICONS.chevronRight}</span>
        </a>`).join('')}
    </div>
    <p class="sheet-foot small muted">${t('sources')}: AGMARKNET · Open-Meteo · Groq</p>`);
}

function openLanguageSheet() {
  const host = openSheet(`
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
  if (!host) return;

  // Scope to the element openSheet actually rendered into — on a wide screen
  // that is the centred #form-panel, not the #more-sheet bottom sheet. Looking
  // the buttons up by the sheet's id made every language unclickable on desktop.
  host.querySelectorAll('[data-lang]').forEach((btn) => {
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

/** The bell lives in the app bar, left of the language selector. */
function renderBell() {
  const slot = document.getElementById('notif-slot');
  if (!slot) return;
  slot.innerHTML = currentUser ? bellButton(currentUser) : '';
  document.getElementById('notif-bell')?.addEventListener('click', () => openInterestsSheet(currentUser));
}

// The market repaints the top bar whenever its state changes, so the bell's
// count is never stale after accepting, deleting or responding.
window.addEventListener('ks:refresh-chrome', () => renderAuthArea());

/** Close the profile menu when the click lands anywhere outside it. */
function closeAccountMenuOnOutside(ev) {
  const menu = document.getElementById('account-menu');
  if (!menu || menu.classList.contains('hidden')) return;
  if (ev.target.closest('#account-menu') || ev.target.closest('#btn-account')) return;
  hideAnimated(menu, 200);
}

function renderAuthArea() {
  renderBell();
  if (currentUser) {
    // One name everywhere: the farm profile's name wins (it is the one the
    // person can edit in My Farm), then the account's own display name.
    const name = myName() || currentUser.displayName || currentUser.email || 'Farmer';
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
    // Close when clicking anywhere else. This used to pass { once: true }, so
    // the outside-click handler fired once and removed itself — after that the
    // menu only closed by tapping the avatar again.
    // one listener for the whole page, registered ONCE — the previous version
    // removed itself after the first outside click, so it only worked once per
    // page load. It looks the menu up by id each time, because the account area
    // is re-rendered.
    document.addEventListener('click', closeAccountMenuOnOutside);
    document.getElementById('btn-logout').addEventListener('click', async () => {
      try {
        await logout();
      } catch (e) {}
      // wipe this device — the farm is re-fetched from Firestore on next login
      clearLocalData();
      clearMarketLocal();
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
// Which role the person is signing in AS. The market's "Login as buyer"
// button sets this, so the modal can say so and so the role survives the
// sign-up instead of the account defaulting to farmer.
// The way you sign in decides the role: the Login button in the top bar is the
// farmer's way in (the default), and the market's "Login as buyer" is the
// buyer's. Whichever one you use is the role you get — so nobody is stuck and
// nobody has to go into Settings to correct a mistake.
let pendingRole = null;

function openModal(preferred = 'login', role = 'farmer') {
  pendingRole = role === 'buyer' ? 'buyer' : 'farmer';
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
  const asBuyer = pendingRole === 'buyer';
  const roleLabel = next === 'login' ? t('mk_login_buyer') : t('mk_signup_buyer');
  modalTitle.textContent = asBuyer
    ? roleLabel
    : next === 'login' ? t('hero_welcome_back') : t('auth_create');
  submitBtn.textContent = asBuyer
    ? roleLabel
    : next === 'login' ? t('common_login') : t('common_signup');
  modalHint.textContent = asBuyer
    ? t('mk_desc_buyer')
    : next === 'login'
      ? 'Guests can explore everything — log in to save your farm and history.'
      : 'An account keeps your crops, costs and diagnoses saved privately.';
  loginError.classList.add('hidden');
}

tabs.login.addEventListener('click', () => setMode('login'));
tabs.signup.addEventListener('click', () => setMode('signup'));

// The market asks for the login modal in a role's name (views.js cannot import
// this module, so the request travels as an event).
document.addEventListener('ks:login', (e) => openModal('login', (e.detail || {}).role));

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

/* ── Start screen (splash) ───────────────────────
   The splash is plain markup in index.html, so it is on screen from the
   very first paint. It is faded out here once the first screen is ready,
   with a safety timer so a slow boot can never leave it stuck on screen. */
const splashEl = document.getElementById('splash');
let splashGone = false;
function hideSplash() {
  if (splashGone || !splashEl) return;
  splashGone = true;
  splashEl.classList.add('is-hidden');
  setTimeout(() => splashEl.remove(), 700);
}
setTimeout(hideSplash, 2500);

/* ── Boot ──────────────────────────────────────── */
(async function boot() {
  initSheet();
  paintChrome();
  buildTabbar();
  applyLanguage();
  initVoiceAsk(); // the home voice pop-up (listens, then hands off to Ask AI)

  firebaseReady = await initFirebase();

  if (firebaseReady) {
    onAuthChange(async (user) => {
      currentUser = user;
      if (user) {
        await hydrate(user); // pull the farmer's farm from Firestore
        // The way in is the role you get. `pendingRole` is set by whichever
        // login was used, and is null on a plain page load — so a returning
        // session keeps the role it already has.
        if (pendingRole) {
          setRole(pendingRole);
          pendingRole = null;
        }
      }
      // The market is a PUBLIC board, so it loads whether or not anyone is
      // signed in — a visitor must be able to see the listings.
      await hydrateMarket(user);
      await hydrateInterests(user); // …and who has responded to what
      renderAuthArea();
      navigate();
      hideSplash(); // the first real screen is up — reveal it
    });
  } else {
    renderAuthArea();
    await hydrateMarket(null); // no Firebase: still try the board, and keep the local copy
    await hydrateInterests(null);
    navigate();
    hideSplash();
  }
  setMode('login');
})();
