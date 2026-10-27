/**
 * combobox.js — a searchable picker for long lists.
 *
 * A plain <select> with 604 AGMARKNET commodities is unusable on a phone: you
 * cannot search it and scrolling to "Turmeric" takes forever. This renders a
 * text box with a suggestion list underneath.
 *
 * The important design choice: the element the rest of the app talks to keeps
 * the SAME id and the SAME `.value`, so every existing read/write such as
 * `document.getElementById('m-commodity').value = 'Onion'` keeps working
 * exactly as it did with a <select> — nothing downstream had to change.
 *
 *   renderCombobox({ id, items, value, placeholder, emptyLabel })  → HTML
 *   wireCombobox(id, { items, onChange })                          → behaviour
 *
 * `items` is an array of [name, group] pairs.
 */

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const MAX_SHOWN = 60;

/** The combobox markup. `value` is the current selection (may be empty). */
export function renderCombobox({ id, items, value = '', placeholder = '', noMatch = '', moreHint = '', common = [] }) {
  const commonSet = new Set(common);
  // common crops first (in their curated order), then everything else A-Z
  const ordered = [
    ...common.map((n) => items.find((it) => it[0] === n)).filter(Boolean),
    ...items.filter((it) => !commonSet.has(it[0])),
  ];
  const data = esc(JSON.stringify(ordered));
  return `<div class="combo" data-combo data-items="${data}" data-nomatch="${esc(noMatch)}" data-more="${esc(moreHint)}">
      <input type="text" class="combo-input" id="${id}" value="${esc(value)}"
             placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false"
             role="combobox" aria-expanded="false" aria-autocomplete="list" required />
      <div class="combo-list hidden" role="listbox" aria-label="${esc(placeholder)}"></div>
    </div>`;
}

/**
 * Wire one combobox. Safe to call more than once per id — it re-wires the
 * element it finds, so a re-render never leaves a dead picker behind.
 */
export function wireCombobox(id, { onChange } = {}) {
  const input = document.getElementById(id);
  if (!input) return;
  const wrap = input.closest('.combo');
  const list = wrap && wrap.querySelector('.combo-list');
  if (!wrap || !list) return;
  if (wrap.dataset.wired === '1') return;
  wrap.dataset.wired = '1';

  let items = [];
  try { items = JSON.parse(wrap.dataset.items || '[]'); } catch { items = []; }
  let active = -1;
  let shown = [];

  const isOpen = () => !list.classList.contains('hidden');

  function build(query) {
    const q = String(query || '').trim().toLowerCase();
    const matches = q
      ? items.filter((it) => it[0].toLowerCase().includes(q))
      : items;
    // a match at the start of the name is almost always the one you meant
    if (q) {
      matches.sort((a, b) => {
        const ai = a[0].toLowerCase().indexOf(q);
        const bi = b[0].toLowerCase().indexOf(q);
        if (ai !== bi) return ai - bi;
        return a[0].length - b[0].length;
      });
    }
    shown = matches.slice(0, MAX_SHOWN);
    active = -1;
    if (!shown.length) {
      list.innerHTML = `<div class="combo-empty">${esc(wrap.dataset.nomatch || 'No match')}</div>`;
      return;
    }
    list.innerHTML = shown
      .map((it, i) => `<button type="button" class="combo-item" role="option" data-i="${i}" aria-selected="false">
          <span class="combo-name">${esc(it[0])}</span>
          <span class="combo-group">${esc(it[1] || '')}</span>
        </button>`)
      .join('');
    if (matches.length > MAX_SHOWN) {
      list.insertAdjacentHTML('beforeend', `<div class="combo-more">+${matches.length - MAX_SHOWN} ${esc(wrap.dataset.more || '')}</div>`);
    }
  }

  /** Open on the FULL list, with the current value highlighted — clicking a
      filled field is how you change your mind, not a request to filter by
      what is already there. Typing is what filters. */
  function open({ filter = false } = {}) {
    build(filter ? input.value : '');
    list.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
    if (!filter && input.value) {
      const i = shown.findIndex((it) => it[0] === input.value);
      if (i >= 0) highlight(i);
    }
  }

  function close() {
    list.classList.add('hidden');
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  }

  function highlight(i) {
    const nodes = list.querySelectorAll('.combo-item');
    if (!nodes.length) return;
    active = Math.max(0, Math.min(i, nodes.length - 1));
    nodes.forEach((n, k) => {
      const on = k === active;
      n.classList.toggle('is-active', on);
      n.setAttribute('aria-selected', String(on));
    });
    const el = nodes[active];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  function pick(i) {
    const it = shown[i];
    if (!it) return;
    input.value = it[0];
    close();
    if (onChange) onChange(it[0]);
  }

  input.addEventListener('focus', () => open());
  input.addEventListener('click', () => { if (!isOpen()) open(); });
  input.addEventListener('input', () => open({ filter: true }));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen()) open();
      highlight(active + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter') {
      if (isOpen() && active >= 0) { e.preventDefault(); pick(active); }
      else close();
    } else if (e.key === 'Escape') {
      if (isOpen()) { e.stopPropagation(); close(); }
    } else if (e.key === 'Tab') {
      close();
    }
  });
  list.addEventListener('mousedown', (e) => {
    // mousedown, not click — the input's blur would close the list first
    const btn = e.target.closest('.combo-item');
    if (btn) { e.preventDefault(); pick(Number(btn.dataset.i)); }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
}

/** Wire every combobox on the page. */
export function wireComboboxes(ids = []) {
  ids.forEach((id) => wireCombobox(id));
}
