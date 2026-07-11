// views/diary.js — Vista 2: diario cronologico di dosi e check-in.
// Filtrabile per farmaco e data; ogni voce è modificabile o cancellabile.

import { getAll, put, del, deleteDoseCascade } from '../db.js';
import { el, fmtDate, fmtTime, fmtDuration, minutesBetween } from '../util.js';
import { MARKERS, CHECKIN_METRICS, CRASH_METRICS } from '../defaults.js';
import { toastAction } from '../ui.js';
import { icon } from '../icons.js';
import { loadAllBundles } from '../stats.js';
import { openDayFor } from './day.js';
import { cancelForDose } from '../reminders.js';
import { nav } from '../nav.js';

const filter = { med: '', date: '' };

export async function renderDiary() {
  const [bundles, meds] = await Promise.all([loadAllBundles(), getAll('meds')]);
  const root = el('div', { class: 'view view-diary' });

  // Filtri
  const medSel = el('select', { class: 'input',
    onChange: (e) => { filter.med = e.target.value; nav.refresh(); } },
    el('option', { value: '' }, 'Tutti i farmaci'),
    ...meds.map((m) => el('option', { value: m.name, ...(filter.med === m.name ? { selected: 'selected' } : {}) }, m.name)),
  );
  const dateSel = el('input', { type: 'date', class: 'input', 'aria-label': 'Filtra per data', value: filter.date,
    onChange: (e) => { filter.date = e.target.value; nav.refresh(); } });
  const clearBtn = el('button', { class: 'btn btn-secondary btn-sm',
    onClick: () => { filter.med = ''; filter.date = ''; nav.refresh(); } }, 'Azzera');

  root.append(el('div', { class: 'filter-bar' }, medSel, dateSel, clearBtn));

  let list = bundles;
  if (filter.med) list = list.filter((b) => b.dose.medName === filter.med);
  if (filter.date) list = list.filter((b) => new Date(b.dose.takenAt).toDateString() === new Date(filter.date).toDateString());

  if (!list.length) {
    root.append(el('div', { class: 'empty-hint' },
      el('div', { class: 'empty-ico' }, icon('diary', { size: 40, stroke: 1.5 })),
      'Nessuna voce con questi filtri.'));
    return root;
  }

  for (const b of list) root.append(doseCard(b));
  return root;
}

function doseCard(b) {
  const { dose, checkins, sideEffects, crashes } = b;
  const dur = (dose.markers && dose.markers.start && dose.markers.end)
    ? fmtDuration(minutesBetween(dose.markers.start, dose.markers.end)) : null;

  const card = el('div', { class: 'card diary-card' });

  card.append(el('div', { class: 'diary-head' },
    el('div', {},
      el('div', { class: 'diary-title' }, `${dose.medName} · ${dose.doseMg} mg`),
      el('div', { class: 'diary-sub' }, `${fmtDate(dose.takenAt)} · ${fmtTime(dose.takenAt)}` + (dur ? ` · durata ${dur}` : '')),
    ),
    el('div', { class: 'diary-actions' },
      iconBtn('edit', 'Modifica dose', () => openDayFor(dose.takenAt, { mode: 'dose', editing: { type: 'dose', data: dose } })),
      iconBtn('trash', 'Elimina dose', async () => {
        const snap = { dose, checkins, sideEffects, crashes };
        await deleteDoseCascade(dose.id);
        await cancelForDose(dose.id);
        nav.refresh();
        toastAction('Dose eliminata', 'Annulla', async () => {
          await put('doses', snap.dose);
          for (const c of snap.checkins) await put('checkins', c);
          for (const e of snap.sideEffects) await put('sideEffectEntries', e);
          for (const c of snap.crashes) await put('crashEntries', c);
          nav.refresh();
        });
      }),
    ),
  ));

  // Contesto
  const ctx = dose.context || {};
  const ctxBits = [
    ctx.stomach, ctx.sleepHours != null ? `${ctx.sleepHours}h sonno` : null, ctx.activity,
  ].filter(Boolean);
  if (ctxBits.length) card.append(el('div', { class: 'diary-context' }, ctxBits.join(' · ')));

  // Marcatori
  const mk = dose.markers || {};
  if (Object.keys(mk).length) {
    card.append(el('div', { class: 'diary-markers' },
      ...MARKERS.filter((d) => mk[d.key]).map((d) =>
        el('span', { class: 'mk-tag' }, icon('m-' + d.key, { size: 13 }), `${d.label} ${fmtTime(mk[d.key])}`)),
    ));
  }

  // Check-in
  if (checkins.length) {
    const block = el('div', { class: 'sub-block' }, el('div', { class: 'sub-title' }, `Check-in (${checkins.length})`));
    for (const c of checkins) {
      const mins = minutesBetween(dose.takenAt, c.at);
      block.append(el('div', { class: 'sub-row' },
        el('span', { class: 'sub-time' }, `+${fmtDuration(mins)}`),
        el('span', { class: 'sub-vals' }, CHECKIN_METRICS.map((m) => `${shortLabel(m.key)} ${c[m.key] ?? '–'}`).join('  ')),
        iconBtn('edit', 'Modifica', () => openDayFor(dose.takenAt, { mode: 'checkin', editing: { type: 'checkin', data: c } })),
        iconBtn('trash', 'Elimina', () => undoDelete('checkins', c, 'Check-in eliminato')),
      ));
    }
    card.append(block);
  }

  // Effetti collaterali
  if (sideEffects.length) {
    const block = el('div', { class: 'sub-block' }, el('div', { class: 'sub-title' }, `Effetti collaterali (${sideEffects.length})`));
    for (const e of sideEffects.sort((a, b2) => new Date(a.at) - new Date(b2.at))) {
      block.append(el('div', { class: 'sub-row' },
        el('span', { class: 'sub-time' }, `+${fmtDuration(minutesBetween(dose.takenAt, e.at))}`),
        el('span', { class: 'sub-vals' }, `${e.name || ''}: ${e.intensity}/10`),
        iconBtn('trash', 'Elimina', () => undoDelete('sideEffectEntries', e, 'Effetto eliminato')),
      ));
    }
    card.append(block);
  }

  // Coda / crash
  if (crashes.length) {
    const block = el('div', { class: 'sub-block' }, el('div', { class: 'sub-title' }, `Coda / crash (${crashes.length})`));
    for (const c of crashes.sort((a, b2) => new Date(a.at) - new Date(b2.at))) {
      const vals = CRASH_METRICS.map((m) => `${shortLabel(m.key)} ${c[m.key] ?? '–'}`).join('  ');
      block.append(el('div', { class: 'sub-row' },
        el('span', { class: 'sub-time' }, `+${fmtDuration(minutesBetween(dose.takenAt, c.at))}`),
        el('span', { class: 'sub-vals' }, vals + (c.notes ? ` · ${c.notes}` : '')),
        iconBtn('edit', 'Modifica', () => openDayFor(dose.takenAt, { mode: 'coda', editing: { type: 'coda', data: c } })),
        iconBtn('trash', 'Elimina', () => undoDelete('crashEntries', c, 'Coda eliminata')),
      ));
    }
    card.append(block);
  }

  return card;
}

async function undoDelete(store, item, msg) {
  await del(store, item.id);
  nav.refresh();
  toastAction(msg, 'Annulla', async () => { await put(store, item); nav.refresh(); });
}

function shortLabel(key) {
  return ({
    intensity: 'Int', focus: 'Foc', energy: 'Ene', mood: 'Umo',
    tiredness: 'Stanc', irritability: 'Irrit', moodDrop: 'CaloU',
  })[key] || key;
}

function iconBtn(name, title, onClick) {
  return el('button', {
    class: 'icon-btn' + (name === 'trash' ? ' danger' : ''),
    title, 'aria-label': title, onClick,
  }, icon(name, { size: 18 }));
}
