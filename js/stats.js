// stats.js — calcoli descrittivi sui dati.
// IMPORTANTE: solo osservazioni descrittive sui dati dell'utente,
// nessuna interpretazione medica.

import { getAll, get, put, getByIndex } from './db.js';
import { minutesBetween, avg, round1 } from './util.js';
import { MARKERS } from './defaults.js';

// Carica una dose "arricchita" con tutti i suoi figli.
export async function loadDoseBundle(dose) {
  const [checkins, sideEffects, crashes] = await Promise.all([
    getByIndex('checkins', 'doseId', dose.id),
    getByIndex('sideEffectEntries', 'doseId', dose.id),
    getByIndex('crashEntries', 'doseId', dose.id),
  ]);
  checkins.sort((a, b) => new Date(a.at) - new Date(b.at));
  return { dose, checkins, sideEffects, crashes };
}

// Tutte le dosi (più recenti prima) con i relativi figli.
export async function loadAllBundles() {
  const doses = await getAll('doses');
  doses.sort((a, b) => new Date(b.takenAt) - new Date(a.takenAt));
  return Promise.all(doses.map(loadDoseBundle));
}

// Durata dell'effetto per una dose, dai marcatori (fine - inizio).
export function effectDuration(dose) {
  const m = dose.markers || {};
  if (m.start && m.end) return minutesBetween(m.start, m.end);
  return null;
}

// Minuti dalla dose all'inizio effetto.
export function timeToOnset(dose) {
  const m = dose.markers || {};
  if (m.start) return minutesBetween(dose.takenAt, m.start);
  return null;
}

// Minuti dalla dose al picco.
export function timeToPeak(dose) {
  const m = dose.markers || {};
  if (m.peak) return minutesBetween(dose.takenAt, m.peak);
  return null;
}

// Minuti dalla dose alla fine dell'effetto.
export function timeToEnd(dose) {
  const m = dose.markers || {};
  if (m.end) return minutesBetween(dose.takenAt, m.end);
  return null;
}

// Ricava i marcatori della dose (inizio/picco/calo/fine) dai suoi check-in:
// ogni check-in porta al più un `moment`, e la sua ora diventa quel marcatore.
// Da chiamare dopo ogni salvataggio/cancellazione di un check-in.
export async function recomputeDoseMarkers(doseId) {
  const dose = await get('doses', doseId);
  if (!dose) return;
  const checkins = await getByIndex('checkins', 'doseId', doseId);
  checkins.sort((a, b) => new Date(a.at) - new Date(b.at));
  const markers = {};
  for (const c of checkins) {
    if (c.moment && MARKERS.some((m) => m.key === c.moment)) markers[c.moment] = c.at;
  }
  dose.markers = markers;
  await put('doses', dose);
}

// Tempi medi reali dell'utente per ciascun momento (minuti dalla dose),
// calcolati sullo storico. Usati per proporre i tempi dei promemoria.
// Ritorna { peak: { avg, n }, end: { avg, n }, ... } solo per i momenti con dati.
export async function historyMomentOffsets() {
  const doses = await getAll('doses');
  const buckets = {}; // key -> [minuti]
  for (const d of doses) {
    const m = d.markers || {};
    for (const mk of MARKERS) {
      if (!m[mk.key]) continue;
      const mins = minutesBetween(d.takenAt, m[mk.key]);
      if (typeof mins === 'number' && mins > 0) (buckets[mk.key] ||= []).push(mins);
    }
  }
  const out = {};
  for (const key of Object.keys(buckets)) {
    out[key] = { avg: Math.round(avg(buckets[key])), n: buckets[key].length };
  }
  return out;
}

// Intensità massima registrata nei check-in (proxy del picco percepito).
export function peakIntensity(checkins) {
  const vals = checkins.map((c) => c.intensity).filter((x) => typeof x === 'number');
  return vals.length ? Math.max(...vals) : null;
}

// Durata della coda: dal primo all'ultimo crash entry collegato.
export function crashDuration(crashes) {
  if (crashes.length < 2) return null;
  const times = crashes.map((c) => new Date(c.at)).sort((a, b) => a - b);
  return (times[times.length - 1] - times[0]) / 60000;
}

// Statistiche aggregate per farmaco.
export async function statsByMedication() {
  const bundles = await loadAllBundles();
  const groups = new Map(); // medName -> array di bundle
  for (const b of bundles) {
    const key = b.dose.medName || 'Sconosciuto';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }

  const result = [];
  for (const [medName, list] of groups) {
    const durations = list.map((b) => effectDuration(b.dose)).filter((x) => x != null);
    const onsets = list.map((b) => timeToOnset(b.dose)).filter((x) => x != null);
    const peaks = list.map((b) => timeToPeak(b.dose)).filter((x) => x != null);
    const peakInts = list.map((b) => peakIntensity(b.checkins)).filter((x) => x != null);
    const crashDurs = list.map((b) => crashDuration(b.crashes)).filter((x) => x != null);

    result.push({
      medName,
      doseCount: list.length,
      avgDuration: round1(avg(durations)),
      avgOnset: round1(avg(onsets)),
      avgPeakTime: round1(avg(peaks)),
      avgPeakIntensity: round1(avg(peakInts)),
      avgCrashDuration: round1(avg(crashDurs)),
    });
  }
  return result.sort((a, b) => b.doseCount - a.doseCount);
}

// Conteggio e intensità media per ciascun effetto collaterale.
export async function sideEffectStats() {
  const [entries, types] = await Promise.all([
    getAll('sideEffectEntries'),
    getAll('sideEffectTypes'),
  ]);
  const nameById = new Map(types.map((t) => [t.id, t.name]));
  const map = new Map(); // name -> { count, intensities[] }
  for (const e of entries) {
    const name = nameById.get(e.sideEffectTypeId) || e.name || 'Sconosciuto';
    if (!map.has(name)) map.set(name, { count: 0, intensities: [] });
    const g = map.get(name);
    g.count += 1;
    if (typeof e.intensity === 'number') g.intensities.push(e.intensity);
  }
  return [...map.entries()]
    .map(([name, g]) => ({
      name, count: g.count, avgIntensity: round1(avg(g.intensities)),
    }))
    .sort((a, b) => b.count - a.count);
}

// Correlazioni semplici e descrittive: confronta la durata media dell'effetto
// tra dosi con "poco" vs "molto" sonno la notte prima.
// Presentata SOLO come osservazione, mai come verità medica.
export async function sleepVsDurationObservation() {
  const bundles = await loadAllBundles();
  const rows = bundles
    .map((b) => ({
      sleep: b.dose.context && typeof b.dose.context.sleepHours === 'number'
        ? b.dose.context.sleepHours : null,
      dur: effectDuration(b.dose),
    }))
    .filter((r) => r.sleep != null && r.dur != null);

  if (rows.length < 4) return null; // troppo pochi dati per dire qualcosa

  const median = [...rows].map((r) => r.sleep).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
  const low = rows.filter((r) => r.sleep < median).map((r) => r.dur);
  const high = rows.filter((r) => r.sleep >= median).map((r) => r.dur);
  if (!low.length || !high.length) return null;

  return {
    n: rows.length,
    median: round1(median),
    avgDurLowSleep: round1(avg(low)),
    avgDurHighSleep: round1(avg(high)),
  };
}
