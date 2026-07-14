// reminders.js — promemoria dell'effetto tramite il CALENDARIO del telefono.
//
// Perché il calendario e non le notifiche web: una PWA senza server non può far
// suonare una notifica a un orario futuro con l'app chiusa (su iPhone è proprio
// impossibile). Il calendario nativo invece avvisa in modo affidabile, gratis e
// senza server. Quando registri una dose, l'app prepara gli avvisi ai momenti
// scelti (picco, fine, …) e li aggiunge al calendario con un tocco.
//
// Sono solo solleciti a registrare "come mi sento": NON sono consigli medici.

import { getMeta, setMeta } from './db.js';
import { DEFAULT_REMINDER_MOMENTS, MARKERS } from './defaults.js';
import { buildIcs } from './ics.js';

export async function calendarRemindersEnabled() {
  return !!(await getMeta('calendarRemindersEnabled', false));
}

export async function setCalendarRemindersEnabled(on) {
  await setMeta('calendarRemindersEnabled', !!on);
}

// Config dei momenti unita a etichette/icone dei MARKERS, nell'ordine giusto.
// Ritorna [{ key, label, icon, min, on }].
export async function getReminderMoments() {
  const saved = (await getMeta('reminderMoments', DEFAULT_REMINDER_MOMENTS)) || DEFAULT_REMINDER_MOMENTS;
  return MARKERS.map((mk) => {
    const cfg = saved[mk.key] || DEFAULT_REMINDER_MOMENTS[mk.key] || { min: 90, on: false };
    return { key: mk.key, label: mk.label, icon: mk.icon, min: cfg.min, on: !!cfg.on };
  });
}

export async function setReminderMoments(list) {
  const obj = {};
  for (const m of list) obj[m.key] = { min: m.min, on: !!m.on };
  await setMeta('reminderMoments', obj);
}

// Testo dell'avviso per ciascun momento.
function summaryFor(key, dose) {
  const what = {
    start: 'Inizio effetto — come va?',
    peak: 'Picco effetto — come ti senti?',
    decline: 'Inizio calo — come va?',
    end: 'Fine effetto — com\'è andata?',
  }[key] || 'Promemoria effetto';
  return `💊 ${what} (${dose.medName} ${dose.doseMg}mg)`;
}

// Prepara il file calendario per una dose (solo i momenti attivi).
// Ritorna { filename, ics, moments } oppure null se nessun momento è attivo.
export async function buildDoseCalendar(dose) {
  const moments = (await getReminderMoments()).filter((m) => m.on);
  if (!moments.length) return null;
  const base = new Date(dose.takenAt).getTime();
  const events = moments.map((m) => ({
    uid: `${dose.id}-${m.key}@app-farmaci`,
    at: new Date(base + m.min * 60000).toISOString(),
    summary: summaryFor(m.key, dose),
    description: "Promemoria dall'app Tracciamento farmaci: apri e segna come ti senti. Non è un consiglio medico.",
  }));
  return { filename: 'promemoria-effetto.ics', ics: buildIcs(events), moments };
}
