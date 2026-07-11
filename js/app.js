// app.js — bootstrap dell'applicazione: shell, navigazione tra le viste,
// registrazione del service worker (PWA), seed del database, avvio promemoria.

import { ensureSeed } from './db.js';
import { el } from './util.js';
import { icon } from './icons.js';
import { nav } from './nav.js';
import { startTicker } from './reminders.js';
import { renderDay } from './views/day.js';
import { renderChart } from './views/chart.js';
import { renderDiary } from './views/diary.js';
import { renderStats } from './views/stats.js';
import { renderSettings } from './views/settings.js';

// Registro delle viste principali.
const VIEWS = {
  day: { label: 'Giorno', icon: 'home', render: renderDay },
  chart: { label: 'Confronto', icon: 'chart', render: renderChart },
  diary: { label: 'Diario', icon: 'diary', render: renderDiary },
  stats: { label: 'Statistiche', icon: 'stats', render: renderStats },
  settings: { label: 'Impostazioni', icon: 'settings', render: renderSettings },
};

let current = 'day';
const main = document.getElementById('app-main');
const navBar = document.getElementById('app-nav');
const titleEl = document.getElementById('app-title-text');

// Icone fisse dell'header.
document.getElementById('brand-mark').append(icon('pill', { size: 17, stroke: 2 }));
document.getElementById('settings-btn').append(icon('settings', { size: 22 }));

// --- Tema chiaro/scuro (bottone sole/luna) ---------------------------------
const themeBtn = document.getElementById('theme-btn');
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.getElementById('theme-color-meta');
  if (meta) meta.content = theme === 'dark' ? '#1c2230' : '#ffffff';
  // Mostra l'icona della modalità verso cui si passa al tocco.
  themeBtn.innerHTML = '';
  themeBtn.append(icon(theme === 'dark' ? 'sun' : 'moon', { size: 21 }));
}
applyTheme(document.documentElement.dataset.theme || 'light');
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('theme', next); } catch (e) { /* ignore */ }
  applyTheme(next);
  render({ animate: false, keepScroll: true }); // ridisegna i grafici con i nuovi colori
});
// Se l'utente non ha scelto, segui i cambi di tema del sistema.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  let saved = null;
  try { saved = localStorage.getItem('theme'); } catch (_) { /* ignore */ }
  if (saved !== 'light' && saved !== 'dark') { applyTheme(e.matches ? 'dark' : 'light'); render({ animate: false, keepScroll: true }); }
});

// animate: anima l'ingresso (solo al cambio vista). keepScroll: conserva lo
// scroll (per gli aggiornamenti, così la pagina non "salta" a ogni azione).
async function render({ animate = true, keepScroll = false } = {}) {
  const prevScroll = main.scrollTop;
  let node;
  try {
    node = await VIEWS[current].render();
  } catch (e) {
    console.error(e);
    node = el('div', { class: 'view' }, el('div', { class: 'error-box' }, 'Errore nel caricamento della vista: ' + e.message));
  }
  if (animate) node.classList.add('view-enter');
  main.innerHTML = '';
  main.append(node);
  main.scrollTop = keepScroll ? prevScroll : 0;
  titleEl.textContent = VIEWS[current].label;
  updateNav();
}

function updateNav() {
  [...navBar.children].forEach((btn) => {
    btn.classList.toggle('nav-on', btn.dataset.view === current);
  });
}

function buildNav() {
  for (const key of ['day', 'chart', 'diary', 'stats']) {
    const v = VIEWS[key];
    const btn = el('button', {
      class: 'nav-btn', 'data-view': key,
      onClick: () => nav.go(key),
    },
      el('span', { class: 'nav-ico' }, icon(v.icon, { size: 23 })),
      el('span', { class: 'nav-label' }, v.label),
    );
    navBar.append(btn);
  }
}

// Collega le funzioni del "ponte" di navigazione usate dalle viste.
nav.go = (name) => { if (VIEWS[name]) { current = name; render({ animate: true }); } };
nav.refresh = () => render({ animate: false, keepScroll: true });

// Pulsante impostazioni nell'header: apre Impostazioni o torna al Giorno.
document.getElementById('settings-btn').addEventListener('click', () => nav.go(current === 'settings' ? 'day' : 'settings'));
document.getElementById('app-title').addEventListener('click', () => nav.go('day'));

// Registrazione del service worker per la PWA (cache offline).
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('service-worker.js');
  } catch (e) {
    console.warn('Service worker non registrato:', e);
  }
}

// Quando si tocca una notifica di promemoria, apri la home per il check-in.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'open-checkin') nav.go('day');
  });
}

// Avvio.
(async function start() {
  buildNav();
  await ensureSeed();
  await registerSW();
  startTicker();
  await render();
})();
