// exportImport.js — backup/ripristino in JSON (con unione), condivisione
// del backup e export in CSV.

import { dumpAll, restoreAll, dumpStores, applyStores, getTombstones, setTombstones } from './db.js';
import { mergeData } from './sync.js';
import { fmtDateTime } from './util.js';

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp() {
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
}

// --- JSON (backup completo) ------------------------------------------------

async function buildBackup() {
  const data = await dumpAll();
  return {
    app: 'farmaco-tracker',
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
  };
}

export async function exportJSON() {
  const payload = await buildBackup();
  download(`backup-farmaci-${stamp()}.json`, JSON.stringify(payload, null, 2), 'application/json');
}

// La condivisione (menù "Invia a…" del telefono) è disponibile su questo dispositivo?
export function canShareBackup() {
  try {
    const f = new File(['{}'], 'test.json', { type: 'application/json' });
    return !!(navigator.canShare && navigator.canShare({ files: [f] }));
  } catch (e) { return false; }
}

// Apre il menù di condivisione con il file di backup (telefono ↔ PC via
// WhatsApp/email/quello che preferisci). Ritorna false se annullato.
export async function shareJSON() {
  const payload = await buildBackup();
  const file = new File([JSON.stringify(payload, null, 2)], `backup-farmaci-${stamp()}.json`, { type: 'application/json' });
  try {
    await navigator.share({ files: [file], title: 'Backup farmaci' });
    return true;
  } catch (e) {
    return false; // annullato dall'utente o non supportato
  }
}

// Import "sostituisci tutto": cancella i dati attuali e mette quelli del file.
export async function importJSON(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const data = parsed.data || parsed; // tollera sia il wrapper sia il dump nudo
  await restoreAll(data);
}

// Import "unisci": combina il backup con i dati attuali senza perdere nulla.
// Per ogni voce vince la versione più recente; le cancellazioni si rispettano.
export async function importJSONMerge(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const data = parsed.data || parsed;

  // Lapidi del backup: dentro meta (riga syncTombstones), se presenti.
  const backupTombs = (() => {
    const row = (data.meta || []).find((r) => r.key === 'syncTombstones');
    return (row && Array.isArray(row.value)) ? row.value : [];
  })();

  const localStores = await dumpStores();
  const localTombs = await getTombstones();
  const merged = mergeData(localStores, localTombs, data, backupTombs, Date.now());
  await applyStores(merged.stores);
  await setTombstones(merged.tombstones);
}

// --- CSV --------------------------------------------------------------------

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCSV(rows) {
  return rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
}

// Un CSV "lungo" e leggibile: una riga per evento (dose, check-in, effetto, crash),
// così è apribile nel foglio di calcolo e portabile dal medico.
export async function exportCSV() {
  const data = await dumpAll();
  const sideTypeName = new Map((data.sideEffectTypes || []).map((t) => [t.id, t.name]));

  const rows = [[
    'tipo_evento', 'dose_id', 'farmaco', 'dose_mg', 'data_ora',
    'min_dalla_dose', 'metrica', 'valore', 'note',
  ]];

  const doseById = new Map((data.doses || []).map((d) => [d.id, d]));
  const minsFromDose = (doseId, iso) => {
    const d = doseById.get(doseId);
    if (!d) return '';
    return Math.round((new Date(iso) - new Date(d.takenAt)) / 60000);
  };

  // Dosi (+ contesto + marcatori)
  for (const d of data.doses || []) {
    const ctx = d.context || {};
    const ctxStr = [
      ctx.stomach && `stomaco: ${ctx.stomach}`,
      ctx.sleepHours != null && `sonno: ${ctx.sleepHours}h`,
      ctx.activity && `attività: ${ctx.activity}`,
    ].filter(Boolean).join(' | ');
    rows.push(['dose', d.id, d.medName, d.doseMg, fmtDateTime(d.takenAt), 0, 'assunzione', d.doseMg + ' mg', ctxStr]);

    const m = d.markers || {};
    for (const [key, label] of [['start', 'inizio effetto'], ['peak', 'picco'], ['decline', 'inizio calo'], ['end', 'effetto finito']]) {
      if (m[key]) rows.push(['marcatore', d.id, d.medName, d.doseMg, fmtDateTime(m[key]), minsFromDose(d.id, m[key]), label, '', '']);
    }
  }

  // Check-in
  for (const c of data.checkins || []) {
    for (const metric of ['intensity', 'focus', 'energy', 'mood']) {
      if (typeof c[metric] === 'number') {
        rows.push(['checkin', c.doseId, '', '', fmtDateTime(c.at), minsFromDose(c.doseId, c.at), metric, c[metric], '']);
      }
    }
  }

  // Effetti collaterali
  for (const e of data.sideEffectEntries || []) {
    rows.push(['effetto_collaterale', e.doseId, '', '', fmtDateTime(e.at), minsFromDose(e.doseId, e.at), sideTypeName.get(e.sideEffectTypeId) || e.name || '', e.intensity, '']);
  }

  // Coda / crash
  for (const c of data.crashEntries || []) {
    for (const metric of ['tiredness', 'irritability', 'moodDrop']) {
      if (typeof c[metric] === 'number') {
        rows.push(['coda', c.doseId, '', '', fmtDateTime(c.at), minsFromDose(c.doseId, c.at), metric, c[metric], c.notes || '']);
      }
    }
    if (c.notes && c.tiredness == null && c.irritability == null && c.moodDrop == null) {
      rows.push(['coda', c.doseId, '', '', fmtDateTime(c.at), minsFromDose(c.doseId, c.at), 'note', '', c.notes]);
    }
  }

  // BOM per Excel (caratteri accentati corretti)
  download(`dati-farmaci-${stamp()}.csv`, '﻿' + toCSV(rows), 'text/csv;charset=utf-8');
}
