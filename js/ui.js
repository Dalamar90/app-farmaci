// ui.js — componenti dell'interfaccia riutilizzabili: slider 0–10, bottom-sheet
// (pannello a comparsa dal basso, comodo con una mano), toast, conferme, chip.

import { el } from './util.js';
import { icon } from './icons.js';

// --- Slider 0–10 (visual analog scale) -------------------------------------
// Ritorna { node, get } dove get() restituisce il valore corrente (numero).
// Il colore tematizza badge, riempimento del track e pollice.
export function slider(label, { value = 0, color = 'var(--primary)', min = 0, max = 10, step = 1 } = {}) {
  const valBadge = el('span', { class: 'slider-val', style: `background:${color}` }, String(value));
  const input = el('input', {
    type: 'range', min, max, step, value,
    class: 'slider-input',
    style: `--accent:${color}`,
  });
  const paint = () => {
    const pct = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty('--fill', pct + '%');
    valBadge.textContent = input.value;
  };
  input.addEventListener('input', paint);
  paint();
  const node = el('div', { class: 'slider-row' },
    el('div', { class: 'slider-head' },
      el('label', { class: 'slider-label' }, label),
      valBadge,
    ),
    input,
  );
  return { node, get: () => Number(input.value), set: (v) => { input.value = v; paint(); } };
}

// --- Gruppo di chip selezionabili (singola scelta) -------------------------
export function chips(options, { selected = null, allowEmpty = true } = {}) {
  let current = selected;
  const buttons = [];
  const wrap = el('div', { class: 'chips' });
  options.forEach((opt) => {
    const label = typeof opt === 'object' ? opt.label : String(opt);
    const value = typeof opt === 'object' ? opt.value : opt;
    const b = el('button', {
      type: 'button',
      class: 'chip' + (value === current ? ' chip-on' : ''),
    }, label);
    b.addEventListener('click', () => {
      if (current === value && allowEmpty) current = null;
      else current = value;
      buttons.forEach((bb) => bb.el.classList.toggle('chip-on', bb.value === current));
    });
    buttons.push({ el: b, value });
    wrap.append(b);
  });
  return { node: wrap, get: () => current, set: (v) => { current = v; buttons.forEach((bb) => bb.el.classList.toggle('chip-on', bb.value === current)); } };
}

// --- Bottom sheet (pannello modale) ----------------------------------------
let _sheetEl = null;
export function openSheet(title, contentNode, { actions = [], onClose } = {}) {
  closeSheet();
  const body = el('div', { class: 'sheet-body' }, contentNode);
  const footer = el('div', { class: 'sheet-footer' });
  for (const a of actions) {
    footer.append(el('button', {
      type: 'button',
      class: 'btn ' + (a.kind || 'btn-secondary'),
      onClick: () => a.onClick && a.onClick(),
    }, a.label));
  }
  const sheet = el('div', { class: 'sheet' },
    el('div', { class: 'sheet-handle' }),
    el('div', { class: 'sheet-header' },
      el('h2', {}, title),
      el('button', { class: 'sheet-close', 'aria-label': 'Chiudi', onClick: () => closeSheet() }, icon('close', { size: 20 })),
    ),
    body,
    footer.children.length ? footer : null,
  );
  const overlay = el('div', { class: 'overlay' }, sheet);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSheet(); });
  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('overlay-on'));
  _sheetEl = { overlay, onClose, onKey };
  return { close: closeSheet };
}

export function closeSheet() {
  if (!_sheetEl) return;
  const { overlay, onClose, onKey } = _sheetEl;
  _sheetEl = null;
  document.removeEventListener('keydown', onKey);
  overlay.classList.remove('overlay-on');
  setTimeout(() => overlay.remove(), 200);
  if (onClose) onClose();
}

// --- Drawer laterale (pannello che entra di lato) --------------------------
// Diverso dal bottom-sheet: entra da destra ed è alto tutto lo schermo, adatto a
// testo lungo da scorrere (la Guida). Si chiude con la X, col fondo o con Esc.
let _drawerEl = null;
export function openDrawer(title, contentNode, { onClose } = {}) {
  closeDrawer();
  const closeBtn = el('button', { class: 'sheet-close', 'aria-label': 'Chiudi', onClick: () => closeDrawer() }, icon('close', { size: 20 }));
  const panel = el('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el('div', { class: 'drawer-header' }, el('h2', {}, title), closeBtn),
    el('div', { class: 'drawer-body' }, contentNode),
  );
  const overlay = el('div', { class: 'overlay overlay-drawer' }, panel);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDrawer(); });
  const onKey = (e) => { if (e.key === 'Escape') closeDrawer(); };
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  requestAnimationFrame(() => { overlay.classList.add('overlay-on'); closeBtn.focus(); });
  _drawerEl = { overlay, onClose, onKey };
  return { close: closeDrawer };
}

export function closeDrawer() {
  if (!_drawerEl) return;
  const { overlay, onClose, onKey } = _drawerEl;
  _drawerEl = null;
  document.removeEventListener('keydown', onKey);
  overlay.classList.remove('overlay-on');
  setTimeout(() => overlay.remove(), 300);
  if (onClose) onClose();
}

// --- Toast (messaggio breve) -----------------------------------------------
export function toast(msg) {
  const t = el('div', { class: 'toast' }, msg);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('toast-on'));
  setTimeout(() => {
    t.classList.remove('toast-on');
    setTimeout(() => t.remove(), 300);
  }, 2200);
}

// --- Toast con azione (es. "Annulla") --------------------------------------
export function toastAction(msg, actionLabel, onAction, { ms = 5000 } = {}) {
  const btn = el('button', { class: 'toast-action' }, actionLabel);
  const t = el('div', { class: 'toast' }, msg, btn);
  let done = false;
  const finish = () => { if (done) return; done = true; t.classList.remove('toast-on'); setTimeout(() => t.remove(), 300); };
  btn.addEventListener('click', () => { onAction(); finish(); });
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('toast-on'));
  setTimeout(finish, ms);
}

// --- Conferma sì/no --------------------------------------------------------
export function confirmDialog(message, { confirmLabel = 'Conferma', danger = false } = {}) {
  return new Promise((resolve) => {
    openSheet('Conferma', el('p', { class: 'confirm-msg' }, message), {
      actions: [
        { label: 'Annulla', kind: 'btn-secondary', onClick: () => { closeSheet(); resolve(false); } },
        { label: confirmLabel, kind: danger ? 'btn-danger' : 'btn-primary', onClick: () => { closeSheet(); resolve(true); } },
      ],
      // Chiusa in qualsiasi altro modo (tocco fuori, X, Esc) = risposta "no".
      // Senza questo la promessa restava appesa e il chiamante fermo per sempre.
      onClose: () => resolve(false),
    });
  });
}
