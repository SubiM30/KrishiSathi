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
let lastFocus = null;

export function initSheet() {
  backdrop = document.getElementById('sheet-backdrop');
  sheet = document.getElementById('more-sheet');
  if (!sheet) return;
  backdrop.addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });
}

export function openSheet(html) {
  if (!sheet) return;
  lastFocus = document.activeElement;
  sheet.innerHTML = html;
  showAnimated(sheet);
  showAnimated(backdrop);
  document.body.classList.add('no-scroll');
  sheet.querySelectorAll('[data-sheet-close]').forEach((el) =>
    el.addEventListener('click', closeSheet)
  );
  const first = sheet.querySelector('[autofocus], .more-tile, button, a[href]');
  if (first) first.focus({ preventScroll: true });
}

export function closeSheet() {
  if (!sheet || sheet.classList.contains('hidden')) return;
  document.body.classList.remove('no-scroll');
  if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  // slide it back down, and fade the backdrop out with it
  hideAnimated(sheet);
  hideAnimated(backdrop);
}

export function isSheetOpen() {
  return sheet && !sheet.classList.contains('hidden');
}
