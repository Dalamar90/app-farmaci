// db.js — wrapper minimale su IndexedDB.
// Tutti i dati restano sul dispositivo: nessun server, nessun invio esterno.

import {
  defaultMedications, defaultSideEffectTypes, DEFAULT_REMINDER_OFFSETS,
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

// Store "di contenuto" (quelli sincronizzati). Ogni record riceve un timestamp
// di modifica `_m`; le cancellazioni lasciano una lapide (tombstone) in meta,
// così la fusione tra dispositivi (PC/telefono) è corretta.
const CONTENT_STORES = ['meds', 'sideEffectTypes', 'doses', 'checkins', 'sideEffectEntries', 'crashEntries'];
export const SYNC_STORES = CONTENT_STORES;

const _changeListeners = [];
export function onChange(fn) { _changeListeners.push(fn); }
function notifyChange(store) {
  if (!CONTENT_STORES.includes(store)) return;
  for (const fn of _changeListeners) { try { fn(); } catch (e) { /* ignore */ } }
}

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
  notifyChange(store);
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
  if (CONTENT_STORES.includes(store)) { await addTombstone(store, key); notifyChange(store); }
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
  await bulkPut('meds', defaultMedications());
  await bulkPut('sideEffectTypes', defaultSideEffectTypes());
  await setMeta('reminderOffsets', DEFAULT_REMINDER_OFFSETS);
  await setMeta('remindersEnabled', false); // si attiva su richiesta col permesso notifiche
  await setMeta('seeded', true);
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
