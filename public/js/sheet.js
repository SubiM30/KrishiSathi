/**
 * sheet.js — one reusable bottom sheet (mobile) / centred panel (desktop).
 *
 * Used by the "More" menu, the language picker and the weather-day detail
 * view, so every overlay in the app behaves and animates the same way.
 *   openSheet('<h2>…</h2>…')  →  renders the HTML and slides it up.
 *   Any element inside with [data-sheet-close] closes it.
 */
import { showAnimated, hideAnimated } from './motion.js';

let backdrop = null;
let sheet = null;
let panel = null;
let panelBackdrop = null;
let lastFocus = null;

const isWide = () => window.matchMedia('(min-width: 1024px)').matches;

export function initSheet() {
  backdrop = document.getElementById('sheet-backdrop');
  sheet = document.getElementById('more-sheet');
  panel = document.getElementById('form-panel');
  panelBackdrop = document.getElementById('panel-backdrop');
  if (!sheet) return;
  backdrop.addEventListener('click', closeSheet);
  panelBackdrop?.addEventListener('click', (e) => e.target === panelBackdrop && closeSheet());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });
}

/**
 * Render an overlay. On a phone that is the bottom sheet; on a wide screen the
 * same content becomes a centred floating panel, which is what people expect
 * from a form on a desktop. Callers do not have to care which one they got —
 * the element the content landed in is RETURNED, so a caller can attach its
 * own handlers to the right place:
 *
 *     const host = openSheet(html);
 *     host.querySelectorAll('[data-x]').forEach(...)
 *
 * (Scoping to #more-sheet by id broke every button on a wide screen, because
 *  the content was rendered into #form-panel instead.)
 */
export function openSheet(html) {
  const wide = isWide() && panel && panelBackdrop;
  const host = wide ? panel : sheet;
  if (!host) return null;
  lastFocus = document.activeElement;
  host.innerHTML = html;
  showAnimated(host);
  showAnimated(wide ? panelBackdrop : backdrop);
  document.body.classList.add('no-scroll');
  host.querySelectorAll('[data-sheet-close]').forEach((el) =>
    el.addEventListener('click', closeSheet)
  );
  const first = host.querySelector('[autofocus], .more-tile, button, a[href]');
  if (first) first.focus({ preventScroll: true });
  return host;
}

export function closeSheet() {
  if (panel && panelBackdrop && !panel.classList.contains('hidden')) {
    document.body.classList.remove('no-scroll');
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    hideAnimated(panel);
    hideAnimated(panelBackdrop);
    return;
  }
  if (!sheet || sheet.classList.contains('hidden')) return;
  document.body.classList.remove('no-scroll');
  if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  // slide it back down, and fade the backdrop out with it
  hideAnimated(sheet);
  hideAnimated(backdrop);
}

export function isSheetOpen() {
  return Boolean(
    (sheet && !sheet.classList.contains('hidden')) ||
    (panel && !panel.classList.contains('hidden'))
  );
}
