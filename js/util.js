// util.js — piccole funzioni di supporto condivise da tutta l'app.
// Niente dipendenze esterne.

// Genera un id univoco (usa crypto.randomUUID se disponibile).
export function uid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// Data/ora "adesso" in formato adatto a <input type="datetime-local"> (ora locale).
export function nowForInput(date = new Date()) {
  const off = date.getTimezoneOffset();
  const local = new Date(date.getTime() - off * 60000);
  return local.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:mm"
}

// Converte il valore di <input datetime-local> in timestamp ISO (UTC).
export function inputToISO(value) {
  if (!value) return new Date().toISOString();
  return new Date(value).toISOString();
}

// ISO -> valore per <input datetime-local>.
export function isoToInput(iso) {
  return nowForInput(new Date(iso));
}

// --- Helper "giorno scelto una volta, poi solo l'ora" ----------------------

// 'YYYY-MM-DD' locale di una data (default oggi).
export function dayStr(date = new Date()) {
  const off = date.getTimezoneOffset();
  return new Date(date.getTime() - off * 60000).toISOString().slice(0, 10);
}

// 'HH:mm' locale (default adesso).
export function timeStr(date = new Date()) {
  const off = date.getTimezoneOffset();
  return new Date(date.getTime() - off * 60000).toISOString().slice(11, 16);
}

// Combina giorno ('YYYY-MM-DD') + ora ('HH:mm') in timestamp ISO (interpretato come ora locale).
export function combineDayTime(day, time) {
  return new Date(`${day}T${time || '00:00'}`).toISOString();
}

// ISO -> 'HH:mm' locale, per i campi ora.
export function isoToTime(iso) {
  return timeStr(new Date(iso));
}

// La data ISO cade nel giorno 'YYYY-MM-DD'?
export function isSameDay(iso, day) {
  return dayStr(new Date(iso)) === day;
}

// Etichetta giorno leggibile ("oggi", "ieri", o data estesa).
export function dayLabel(day) {
  const today = dayStr();
  if (day === today) return 'Oggi';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (day === dayStr(y)) return 'Ieri';
  return new Date(day + 'T12:00').toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: 'long' });
}

// Formattazione leggibile di una data/ora.
export function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

export function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('it-IT', {
    hour: '2-digit', minute: '2-digit',
  });
}

// Differenza in minuti tra due ISO (b - a).
export function minutesBetween(aIso, bIso) {
  return (new Date(bIso) - new Date(aIso)) / 60000;
}

// Formatta una durata in minuti come "2h 15m" / "45m".
export function fmtDuration(minutes) {
  if (minutes == null || isNaN(minutes)) return '—';
  const m = Math.round(minutes);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

// Media di un array di numeri (ignora null/undefined/NaN).
export function avg(arr) {
  const v = arr.filter((x) => typeof x === 'number' && !isNaN(x));
  if (!v.length) return null;
  return v.reduce((s, x) => s + x, 0) / v.length;
}

export function round1(x) {
  return x == null ? null : Math.round(x * 10) / 10;
}

// Tema effettivo corrente (legge l'attributo data-theme impostato all'avvio,
// con fallback alle preferenze di sistema). Usato dai grafici per i colori.
export function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

// Converte un colore esadecimale (#rrggbb) in rgba() con alpha dato.
// Usato per le aree sfumate sotto le curve dei grafici.
export function hexAlpha(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Escape minimale per inserire testo dell'utente nell'HTML.
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Crea un elemento DOM con attributi e figli (helper compatto).
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v !== null && v !== undefined && v !== false) {
      node.setAttribute(k, v);
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}
