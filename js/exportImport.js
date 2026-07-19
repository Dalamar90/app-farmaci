// exportImport.js — backup/ripristino in JSON (con unione), condivisione
// del backup e export in CSV.

import { dumpAll, restoreAll, dumpStores, applyStores, getTombstones, setTombstones, setMeta, SYNC_STORES } from './db.js';
import { fmtDateTime } from './util.js';

// --- Fusione tra archivi (usata dall'import "Unisci") -----------------------
// Per ogni voce vince la versione più recente (timestamp _m); le cancellazioni
// sono rappresentate da "lapidi" e vengono rispettate su entrambi i lati.
function mergeData(localStores, localTombs, remoteStores, remoteTombs, localDefault) {
  const tomb = new Map();
  for (const t of [...(localTombs || []), ...(remoteTombs || [])]) {
    const k = t.s + '|' + t.id;
    if (t.m > (tomb.get(k) || 0)) tomb.set(k, t.m);
  }
  const stores = {};
  for (const s of SYNC_STORES) {
    const byId = new Map();
    const consider = (arr, def) => {
      for (const rec of (arr || [])) {
        const m = rec._m || def;
        const ex = byId.get(rec.id);
        if (!ex || m > (ex._m || 0)) byId.set(rec.id, { ...rec, _m: m });
      }
    };
    consider(localStores[s], localDefault); // record locali senza _m: trattati come "adesso"
    consider(remoteStores[s], 0);
    const out = [];
    for (const rec of byId.values()) {
      // Scarta solo se esiste davvero una lapide non più vecchia dell'ultima
      // modifica (record senza _m non devono sparire in assenza di lapidi).
      const tm = tomb.get(s + '|' + rec.id);
      if (tm !== undefined && tm >= (rec._m || 0)) continue;
      out.push(rec);
    }
    stores[s] = out;
  }
  // Farmaci e tipi di effetto con lo stesso nome diventano UNA voce sola.
  // Ogni dispositivo li crea con id casuali propri: senza questo passaggio il
  // primo Unisci telefono+PC raddoppierebbe "Mal di testa", il farmaco, ecc.
  const localIds = (s) => new Set((localStores[s] || []).map((r) => r.id));
  dedupeByName(stores, localIds('meds'), 'meds', [{ store: 'doses', field: 'medicationId' }]);
  dedupeByName(stores, localIds('sideEffectTypes'), 'sideEffectTypes', [{ store: 'sideEffectEntries', field: 'sideEffectTypeId' }]);

  const cutoff = Date.now() - 180 * 24 * 3600 * 1000;
  const tombstones = [...tomb.entries()]
    .map(([k, m]) => { const i = k.indexOf('|'); return { s: k.slice(0, i), id: k.slice(i + 1), m }; })
    .filter((t) => t.m >= cutoff);
  return { stores, tombstones };
}

// Tiene un solo record per nome (maiuscole/spazi ignorati), preferendo l'id già
// presente in locale (così i riferimenti di questo dispositivo non cambiano), e
// ricuce i riferimenti delle voci figlie verso l'id tenuto. Per i farmaci unisce
// anche le dosi rapide dei due profili. NIENTE lapidi per gli id scartati:
// sull'altro dispositivo quell'id è quello tenuto, una lapide lo ucciderebbe.
function dedupeByName(stores, localIdSet, storeName, refs) {
  const byName = new Map(); // nome normalizzato -> record tenuto
  const dropped = new Map(); // id scartato -> id tenuto
  const score = (r) => (localIdSet.has(r.id) ? 1 : 0);
  for (const rec of stores[storeName] || []) {
    const key = String(rec.name || '').trim().toLowerCase();
    if (!key) continue; // senza nome: lascialo stare
    const ex = byName.get(key);
    if (!ex) { byName.set(key, rec); continue; }
    let keep = ex, drop = rec;
    if (score(rec) > score(ex)) { keep = rec; drop = ex; byName.set(key, keep); }
    dropped.set(drop.id, keep.id);
    if (Array.isArray(keep.quickDoses) || Array.isArray(drop.quickDoses)) {
      keep.quickDoses = [...new Set([...(keep.quickDoses || []), ...(drop.quickDoses || [])])].sort((a, b) => a - b);
    }
  }
  if (!dropped.size) return;
  // Risolvi le catene (A→B poi B→C ⇒ A→C): capitano se c'erano già doppioni.
  for (const [d, k0] of dropped) { let k = k0; while (dropped.has(k)) k = dropped.get(k); dropped.set(d, k); }
  stores[storeName] = stores[storeName].filter((r) => !dropped.has(r.id));
  for (const { store, field } of refs) {
    for (const rec of stores[store] || []) {
      if (dropped.has(rec[field])) rec[field] = dropped.get(rec[field]);
    }
  }
}

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
  await setMeta('lastBackupAt', Date.now()); // per la riga "ultimo backup" in Impostazioni
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
    await setMeta('lastBackupAt', Date.now());
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

  // Bilancio per l'utente: quante voci in più (o in meno) rispetto a prima.
  // "Dati uniti" senza numeri nascondeva il caso in cui non entrava NULLA.
  const count = (stores) => SYNC_STORES.reduce((n, s) => n + ((stores[s] || []).length), 0);
  return { added: count(merged.stores) - count(localStores) };
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
