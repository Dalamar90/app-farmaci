// db.js — wrapper minimale su IndexedDB.
// Tutti i dati restano sul dispositivo: nessun server, nessun invio esterno.

import {
  defaultSideEffectTypes, DEFAULT_REMINDER_MOMENTS, MARKERS,
} from './defaults.js';

const DB_NAME = 'farmaco-tracker';
const DB_VERSION = 1;

// Object store dell'applicazione.
//  - meds              : farmaci configurati
//  - sideEffectTypes   : tipi di effetto collaterale configurati
//  - doses             : assunzioni (con contesto + marcatori inclusi)
//  - checkins          : check-in EMA (index per doseId)
//  - sideEffectEntries : occorrenze di effetti collaterali (index per doseId)
//  - crashEntries      : voci di coda/crash (index per doseId)
//  - meta              : impostazioni chiave-valore
const STORES = {
  meds: { keyPath: 'id' },
  sideEffectTypes: { keyPath: 'id' },
  doses: { keyPath: 'id', indexes: [['takenAt', 'takenAt']] },
  checkins: { keyPath: 'id', indexes: [['doseId', 'doseId']] },
  sideEffectEntries: { keyPath: 'id', indexes: [['doseId', 'doseId']] },
  crashEntries: { keyPath: 'id', indexes: [['doseId', 'doseId']] },
  meta: { keyPath: 'key' },
};

// Store "di contenuto" (quelli inclusi nell'unione dei backup). Ogni record
// riceve un timestamp di modifica `_m`; le cancellazioni lasciano una lapide
// (tombstone) in meta, così l'unione tra PC e telefono è corretta.
const CONTENT_STORES = ['meds', 'sideEffectTypes', 'doses', 'checkins', 'sideEffectEntries', 'crashEntries'];
export const SYNC_STORES = CONTENT_STORES;

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, cfg] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: cfg.keyPath });
          for (const [idxName, idxKey] of cfg.indexes || []) {
            store.createIndex(idxName, idxKey, { unique: false });
          }
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(storeNames, mode) {
  return openDB().then((db) => {
    const t = db.transaction(storeNames, mode);
    return t;
  });
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// --- CRUD generico ---------------------------------------------------------

export async function getAll(store) {
  const t = await tx(store, 'readonly');
  return reqToPromise(t.objectStore(store).getAll());
}

export async function get(store, key) {
  const t = await tx(store, 'readonly');
  return reqToPromise(t.objectStore(store).get(key));
}

export async function put(store, value) {
  if (CONTENT_STORES.includes(store) && value && typeof value === 'object') value._m = Date.now();
  const t = await tx(store, 'readwrite');
  await reqToPromise(t.objectStore(store).put(value));
  return value;
}

export async function bulkPut(store, values) {
  const t = await tx(store, 'readwrite');
  const os = t.objectStore(store);
  for (const v of values) os.put(v);
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function del(store, key) {
  const t = await tx(store, 'readwrite');
  await reqToPromise(t.objectStore(store).delete(key));
  if (CONTENT_STORES.includes(store)) await addTombstone(store, key);
}

// Registra una lapide per una cancellazione (per propagarla in sincronizzazione).
async function addTombstone(store, id) {
  const list = (await getMeta('syncTombstones', [])) || [];
  list.push({ s: store, id, m: Date.now() });
  const cutoff = Date.now() - 180 * 24 * 3600 * 1000; // conserva 180 giorni
  await setMeta('syncTombstones', list.filter((t) => t.m >= cutoff));
}

export async function getByIndex(store, indexName, value) {
  const t = await tx(store, 'readonly');
  const idx = t.objectStore(store).index(indexName);
  return reqToPromise(idx.getAll(value));
}

export async function clearStore(store) {
  const t = await tx(store, 'readwrite');
  await reqToPromise(t.objectStore(store).clear());
}

// --- meta (impostazioni) ---------------------------------------------------

export async function getMeta(key, fallback = null) {
  const row = await get('meta', key);
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  return put('meta', { key, value });
}

// --- Cancellazione a cascata di una dose -----------------------------------

export async function deleteDoseCascade(doseId) {
  for (const store of ['checkins', 'sideEffectEntries', 'crashEntries']) {
    const children = await getByIndex(store, 'doseId', doseId);
    for (const c of children) await del(store, c.id);
  }
  await del('doses', doseId);
}

// --- Seed al primo avvio ---------------------------------------------------

export async function ensureSeed() {
  const seeded = await getMeta('seeded', false);
  if (seeded) return;
  // Nessun farmaco precaricato: lo crea l'utente con la prima dose.
  await bulkPut('sideEffectTypes', defaultSideEffectTypes());
  await setMeta('reminderMoments', DEFAULT_REMINDER_MOMENTS);
  await setMeta('calendarRemindersEnabled', false); // promemoria nel calendario, opt-in
  await setMeta('seeded', true);
}

// --- Migrazioni idempotenti (per dati già presenti da versioni precedenti) --

// Un tempo i marcatori (inizio/picco/calo/fine) si accendevano in blocco dentro
// il check-in. Ora ogni voce "come mi sento" porta al più UN momento (campo
// `moment`), e i marcatori della dose si ricavano da lì. Qui travasiamo i vecchi
// marcatori della dose sul check-in con la stessa ora, senza perdere nulla.
export async function migrateData() {
  if (await getMeta('checkinMomentsMigrated', false)) return;
  const doses = await getAll('doses');
  for (const dose of doses) {
    const markers = dose.markers || {};
    if (!Object.keys(markers).length) continue;
    const checkins = await getByIndex('checkins', 'doseId', dose.id);
    for (const mk of MARKERS) {
      const time = markers[mk.key];
      if (!time) continue;
      const c = checkins.find((x) => !x.moment && x.at === time);
      if (c) { c.moment = mk.key; await put('checkins', c); }
    }
  }
  await setMeta('checkinMomentsMigrated', true);
}

// Raccoglie tutti i dati per export/backup.
export async function dumpAll() {
  const out = {};
  for (const store of Object.keys(STORES)) {
    out[store] = await getAll(store);
  }
  return out;
}

// Reimporta un dump completo (sovrascrive tutto).
export async function restoreAll(data) {
  for (const store of Object.keys(STORES)) {
    if (!Array.isArray(data[store]) && store !== 'meta') continue;
    await clearStore(store);
    if (Array.isArray(data[store])) await bulkPut(store, data[store]);
  }
}

// --- Supporto sincronizzazione (Google Drive) ------------------------------

// Snapshot dei soli store di contenuto (per la fusione).
export async function dumpStores() {
  const out = {};
  for (const store of CONTENT_STORES) out[store] = await getAll(store);
  return out;
}

// Applica in locale gli store fusi (senza generare lapidi né notifiche).
export async function applyStores(stores) {
  for (const store of CONTENT_STORES) {
    await clearStore(store);
    if (Array.isArray(stores[store])) await bulkPut(store, stores[store]);
  }
}

export async function getTombstones() {
  return (await getMeta('syncTombstones', [])) || [];
}

export async function setTombstones(list) {
  await setMeta('syncTombstones', list);
}
