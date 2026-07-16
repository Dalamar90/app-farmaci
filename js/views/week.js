// views/week.js — Vista "Settimana": le dosi assunte nella settimana, giorno per
// giorno, e di che farmaco. Deliberatamente minimale: niente curve, medie o
// statistiche (per quelle ci sono Confronto e Statistiche). Si apre
// dall'interruttore Giorno/Settimana in cima alla pagina Giorno.

import { getAll } from '../db.js';
import { el, dayStr, fmtTime, isSameDay } from '../util.js';
import { icon } from '../icons.js';

// Colori per distinguere i farmaci quando ce n'è più d'uno nella settimana.
const MED_COLORS = ['#4f46e5', '#0d9488', '#db2777', '#d97706', '#0891b2', '#7c3aed'];

// Interruttore Giorno/Settimana: sta in cima alla pagina Giorno (la barra di
// navigazione in basso ha già quattro voci ed è stretta su telefono).
export function viewSwitch(current, onPick) {
  const wrap = el('div', { class: 'view-switch' });
  for (const [key, label, ico] of [['day', 'Giorno', 'home'], ['week', 'Settimana', 'calendar']]) {
    wrap.append(el('button', {
      class: 'vs-btn' + (current === key ? ' vs-on' : ''),
      'aria-pressed': current === key ? 'true' : 'false',
      onClick: () => { if (current !== key) onPick(key); },
    }, icon(ico, { size: 17 }), el('span', {}, label)));
  }
  return wrap;
}

// Lunedì della settimana che contiene `day` ('YYYY-MM-DD').
export function mondayOf(day) {
  const d = new Date(day + 'T12:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // getDay(): 0 = domenica
  return dayStr(d);
}

export function addDays(day, n) {
  const d = new Date(day + 'T12:00');
  d.setDate(d.getDate() + n);
  return dayStr(d);
}

// "13 – 19 luglio" se la settimana sta in un mese solo, altrimenti "28 lug – 3 ago".
function rangeLabel(mon, sun) {
  const a = new Date(mon + 'T12:00');
  const b = new Date(sun + 'T12:00');
  if (a.getMonth() === b.getMonth()) {
    return `${a.getDate()} – ${b.getDate()} ${b.toLocaleDateString('it-IT', { month: 'long' })}`;
  }
  const short = (d) => d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  return `${short(a)} – ${short(b)}`;
}

// "Questa settimana" / "Settimana scorsa", altrimenti l'anno (utile andando indietro).
function relLabel(mon) {
  const thisMon = mondayOf(dayStr());
  if (mon === thisMon) return 'Questa settimana';
  if (mon === addDays(thisMon, -7)) return 'Settimana scorsa';
  if (mon === addDays(thisMon, 7)) return 'Settimana prossima';
  return new Date(mon + 'T12:00').getFullYear() + '';
}

// setDay: sposta la settimana restando qui. openDay: apre il Giorno su quella data.
export async function renderWeek({ day, setDay, openDay }) {
  const mon = mondayOf(day);
  const sun = addDays(mon, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));

  const all = (await getAll('doses')).sort((a, b) => new Date(a.takenAt) - new Date(b.takenAt));
  const byDay = days.map((d) => ({ day: d, doses: all.filter((x) => isSameDay(x.takenAt, d)) }));
  const weekDoses = byDay.flatMap((x) => x.doses);

  // Il colore serve solo a separare farmaci diversi: con uno solo sarebbe rumore.
  const medNames = [...new Set(weekDoses.map((d) => d.medName))];
  const showColors = medNames.length > 1;
  const colorOf = (name) => MED_COLORS[Math.max(0, medNames.indexOf(name)) % MED_COLORS.length];

  const wrap = el('div', { class: 'week-panel' });
  wrap.append(weekBar());

  if (!weekDoses.length) {
    wrap.append(el('div', { class: 'empty-hint' },
      el('div', { class: 'empty-ico' }, icon('calendar', { size: 40, stroke: 1.5 })),
      'Nessuna dose registrata in questa settimana.'));
    return wrap;
  }

  const list = el('div', { class: 'week-list' });
  for (const d of byDay) list.append(dayRow(d));
  wrap.append(list);
  wrap.append(el('p', { class: 'form-hint week-foot' }, 'Tocca un giorno per aprirlo e vedere il resto.'));
  return wrap;

  function weekBar() {
    const isCurrent = mon === mondayOf(dayStr());
    return el('div', { class: 'date-bar' },
      el('button', { class: 'icon-btn', 'aria-label': 'Settimana precedente', onClick: () => setDay(addDays(day, -7)) },
        icon('chevron-left', { size: 20 })),
      el('div', { class: 'date-center' },
        el('span', { class: 'date-label' }, rangeLabel(mon, sun)),
        el('span', { class: 'week-sub' }, relLabel(mon)),
      ),
      el('button', { class: 'icon-btn', 'aria-label': 'Settimana successiva', onClick: () => setDay(addDays(day, 7)) },
        icon('chevron-right', { size: 20 })),
      isCurrent ? null : el('button', { class: 'btn btn-secondary btn-sm', onClick: () => setDay(dayStr()) }, 'Oggi'),
    );
  }

  function dayRow({ day: d, doses }) {
    const date = new Date(d + 'T12:00');
    const isToday = d === dayStr();
    return el('button', {
      class: 'week-day' + (isToday ? ' week-today' : '') + (doses.length ? '' : ' week-empty'),
      'aria-label': `Apri ${date.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}`,
      onClick: () => openDay(d),
    },
      el('span', { class: 'week-day-label' },
        el('span', { class: 'week-dow' }, date.toLocaleDateString('it-IT', { weekday: 'short' })),
        el('span', { class: 'week-dnum tnum' }, String(date.getDate())),
      ),
      el('span', { class: 'week-doses' },
        doses.length
          ? doses.map((x) => el('span', { class: 'week-dose' },
            showColors ? el('span', { class: 'week-dot', style: `background:${colorOf(x.medName)}` }) : null,
            el('span', { class: 'week-dose-time tnum' }, fmtTime(x.takenAt)),
            el('span', { class: 'week-dose-med' }, `${x.medName} ${x.doseMg} mg`),
          ))
          : el('span', { class: 'week-none' }, 'nessuna dose'),
      ),
    );
  }
}
