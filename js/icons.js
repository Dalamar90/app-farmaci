// icons.js — set di icone SVG coerenti (stile lineare, 24px, currentColor).
// Sostituiscono le emoji: stesso tratto ovunque = aspetto più curato e leggibile.

const PATHS = {
  // Navigazione
  home: '<path d="M3 9.6 12 2.5l9 7.1"/><path d="M5 9v10.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M9.5 20.5V14h5v6.5"/>',
  chart: '<path d="M4 4v16h16"/><path d="m7 14 3.5-4 3 3L20 7"/>',
  diary: '<rect x="8" y="2.5" width="8" height="4" rx="1.2"/><path d="M16 4.5h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h2"/><path d="M8.5 11h7"/><path d="M8.5 15h5"/>',
  stats: '<path d="M4 20h16"/><rect x="6" y="11" width="3.2" height="6" rx="0.6"/><rect x="11.4" y="6" width="3.2" height="11" rx="0.6"/><rect x="16.8" y="14" width="3.2" height="3" rx="0.6"/>',
  settings: '<line x1="14" x2="21" y1="5" y2="5"/><line x1="3" x2="9" y1="5" y2="5"/><line x1="14" x2="21" y1="12" y2="12"/><line x1="3" x2="9" y1="12" y2="12"/><line x1="16" x2="21" y1="19" y2="19"/><line x1="3" x2="11" y1="19" y2="19"/><circle cx="11.5" cy="5" r="2"/><circle cx="11.5" cy="12" r="2"/><circle cx="13.5" cy="19" r="2"/>',

  // Azioni principali
  pill: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5l3.2 2"/>',
  alert: '<path d="m21.5 18-8-13.7a2 2 0 0 0-3.4 0l-8 13.7A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><line x1="12" x2="12" y1="9.5" y2="13.5"/><line x1="12" x2="12.01" y1="17" y2="17"/>',
  crash: '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',

  // Piccole azioni
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4.2a1.2 1.2 0 0 1 1.2-1.2h5.6A1.2 1.2 0 0 1 16 4.2V6"/><path d="M18.5 6 17.6 20a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9L5.5 6"/>',
  download: '<path d="M12 3.5v11.5"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 20.5h14"/>',
  upload: '<path d="M12 20.5V9"/><path d="m7.5 13.5 4.5-4.5 4.5 4.5"/><path d="M5 3.5h14"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  bell: '<path d="M6 8.5a6 6 0 0 1 12 0c0 6.5 2.5 8.5 2.5 8.5h-17S6 15 6 8.5"/><path d="M10.2 20.5a2 2 0 0 0 3.6 0"/>',
  check: '<path d="M20 6.5 9.2 17.5 4 12.3"/>',
  reset: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/>',
  'chevron-left': '<path d="m15 6-6 6 6 6"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  'arrow-left': '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  // Curva rise-peak-tail: la "firma" visiva dell'app.
  curve: '<path d="M3 19c3 0 4.5-12 8-12s4.5 9 7 9h3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6.5 6.5 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',

  // Marcatori dell'effetto
  'm-start': '<polygon points="7 4 20 12 7 20"/>',
  'm-peak': '<path d="m6 12 6-6 6 6"/><path d="m6 18 6-6 6 6"/>',
  'm-decline': '<path d="m6 6 6 6 6-6"/><path d="m6 12 6 6 6-6"/>',
  'm-end': '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
};

// Ritorna un nodo SVG. `cls` opzionale per styling.
export function icon(name, { size = 24, stroke = 1.9, cls = '' } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', stroke);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  svg.innerHTML = PATHS[name] || '';
  return svg;
}
