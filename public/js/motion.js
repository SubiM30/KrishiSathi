/**
 * motion.js — show/hide helpers so overlays animate OUT the way they animate IN.
 *
 * Every overlay (bottom sheet, login modal, account menu) animates in via CSS.
 * Hiding it used to be an instant `classList.add('hidden')`, so it vanished with
 * a pop. These helpers play a matching exit animation first, then hide the
 * element once that animation has actually finished.
 *
 * `prefers-reduced-motion` skips straight to hidden, and a re-open during the
 * exit animation cancels the pending hide (see the generation guard below).
 */

/** generation counter per element — a stale exit must not hide a re-opened overlay */
const gen = new WeakMap();
const bump = (el) => {
  const n = (gen.get(el) || 0) + 1;
  gen.set(el, n);
  return n;
};

const prefersReduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Show an overlay: clear both the hidden state and any exit animation mid-flight. */
export function showAnimated(el) {
  if (!el) return;
  bump(el);
  el.classList.remove('is-closing');
  el.classList.remove('hidden');
}

/**
 * Hide an overlay with its exit animation.
 * @param {Element} el        the element carrying the `is-closing` animation
 * @param {number}  fallbackMs safety net in case `animationend` never fires
 */
export function hideAnimated(el, fallbackMs = 340) {
  if (!el || el.classList.contains('hidden')) return;
  const mine = bump(el);

  const finish = () => {
    if ((gen.get(el) || 0) !== mine) return; // re-opened meanwhile — leave it alone
    el.classList.remove('is-closing');
    el.classList.add('hidden');
  };

  if (prefersReduced()) {
    finish();
    return;
  }

  el.classList.add('is-closing');
  const onEnd = (e) => {
    if (e.target !== el) return; // ignore animations bubbling from children
    el.removeEventListener('animationend', onEnd);
    finish();
  };
  el.addEventListener('animationend', onEnd);
  setTimeout(() => {
    el.removeEventListener('animationend', onEnd);
    finish();
  }, fallbackMs);
}
