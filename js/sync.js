// sync.js — sincronizzazione con il TUO Google Drive.
//
// I dati vengono salvati in un file privato nella cartella "appDataFolder" del tuo
// Drive (uno spazio nascosto, accessibile solo da questa app: l'app NON può vedere
// il resto del tuo Drive). PC e telefono leggono/scrivono lo stesso file.
//
// La fusione è per-record con timestamp `_m` e lapidi per le cancellazioni:
// puoi modificare da entrambi i dispositivi senza perdere dati.

import {
  getMeta, setMeta, dumpStores, applyStores, getTombstones, setTombstones, onChange, SYNC_STORES,
} from './db.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FILENAME = 'farmaco-tracker.json';

// --- Caricamento libreria Google (solo quando serve) -----------------------
let _gis = null;
function loadGIS() {
  if (_gis) return _gis;
  _gis = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Impossibile caricare Google (sei offline?)'));
    document.head.appendChild(s);
  });
  return _gis;
}

// --- Token di accesso ------------------------------------------------------
let _tokenClient = null;
let _token = null;
let _tokenExp = 0;

async function getToken(interactive) {
  await loadGIS();
  const clientId = await getMeta('driveClientId', null);
  if (!clientId) throw new Error('Manca l\'ID client Google');
  if (_token && Date.now() < _tokenExp - 60000) return _token;
  if (!_tokenClient || _tokenClient._cid !== clientId) {
    _tokenClient = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: SCOPE, callback: () => {} });
    _tokenClient._cid = clientId;
  }
  return new Promise((resolve, reject) => {
    _tokenClient.callback = (resp) => {
      if (resp.error) { reject(new Error(resp.error)); return; }
      _token = resp.access_token;
      _tokenExp = Date.now() + (resp.expires_in ? resp.expires_in * 1000 : 3600000);
      resolve(_token);
    };
    _tokenClient.error_callback = (err) => reject(new Error(err.type || 'autenticazione annullata'));
    try { _tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' }); } catch (e) { reject(e); }
  });
}

// --- Chiamate Drive --------------------------------------------------------
async function driveFind(token) {
  const q = encodeURIComponent(`name='${FILENAME}'`);
  const r = await fetch(`${DRIVE}/files?spaces=appDataFolder&fields=files(id)&q=${q}`, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('ricerca file: ' + r.status);
  const j = await r.json();
  return j.files && j.files[0] ? j.files[0].id : null;
}

async function driveDownload(token, fileId) {
  const r = await fetch(`${DRIVE}/files/${fileId}?alt=media`, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('download: ' + r.status);
  return r.json();
}

async function driveCreate(token, dataObj) {
  const boundary = 'farmaco' + Math.random().toString(36).slice(2);
  const meta = { name: FILENAME, parents: ['appDataFolder'] };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`
    + `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(dataObj)}\r\n--${boundary}--`;
  const r = await fetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/related; boundary=' + boundary }, body,
  });
  if (!r.ok) throw new Error('creazione file: ' + r.status);
  return (await r.json()).id;
}

async function driveUpdate(token, fileId, dataObj) {
  const r = await fetch(`${UPLOAD}/files/${fileId}?uploadType=media`, {
    method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(dataObj),
  });
  if (!r.ok) throw new Error('salvataggio: ' + r.status);
  return fileId;
}

// --- Fusione (CRDT semplice: ultimo che scrive vince, per record) ----------
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
      const tm = tomb.get(s + '|' + rec.id) || 0;
      if (tm >= (rec._m || 0)) continue; // cancellato dopo l'ultima modifica
      out.push(rec);
    }
    stores[s] = out;
  }
  const cutoff = Date.now() - 180 * 24 * 3600 * 1000;
  const tombstones = [...tomb.entries()]
    .map(([k, m]) => { const i = k.indexOf('|'); return { s: k.slice(0, i), id: k.slice(i + 1), m }; })
    .filter((t) => t.m >= cutoff);
  return { stores, tombstones };
}

// Firma rapida per capire se la fusione ha portato cambiamenti (per decidere se ridisegnare).
function signature(stores) {
  return SYNC_STORES.map((s) => {
    const arr = stores[s] || [];
    let maxM = 0; for (const r of arr) if ((r._m || 0) > maxM) maxM = r._m;
    return s + ':' + arr.length + ':' + maxM;
  }).join('|');
}

// --- API pubblica ----------------------------------------------------------
export async function getStatus() {
  return {
    clientId: await getMeta('driveClientId', null),
    enabled: await getMeta('driveEnabled', false),
    lastSync: await getMeta('driveLastSync', null),
  };
}

export async function setClientId(id) {
  await setMeta('driveClientId', (id || '').trim() || null);
  _tokenClient = null; _token = null;
}

export async function isConfigured() {
  return !!(await getMeta('driveClientId', null)) && (await getMeta('driveEnabled', false));
}

export async function connect() {
  await getToken(true); // consenso interattivo
  await setMeta('driveEnabled', true);
}

export async function disconnect() {
  await setMeta('driveEnabled', false);
  _token = null; _tokenExp = 0;
}

let _syncing = false;
export async function syncNow(interactive = false) {
  if (!(await getMeta('driveClientId', null))) return { ok: false, reason: 'non configurato' };
  if (!interactive && !(await getMeta('driveEnabled', false))) return { ok: false, reason: 'non attivo' };
  if (_syncing) return { ok: false, reason: 'già in corso' };
  if (!navigator.onLine) return { ok: false, reason: 'offline' };
  _syncing = true;
  try {
    const token = await getToken(interactive);
    let fileId = await getMeta('driveFileId', null);
    if (!fileId) { fileId = await driveFind(token); if (fileId) await setMeta('driveFileId', fileId); }

    const remote = fileId ? await driveDownload(token, fileId) : null;
    const remoteStores = remote && remote.stores ? remote.stores : {};
    const remoteTombs = remote && remote.tombstones ? remote.tombstones : [];

    const localStores = await dumpStores();
    const localTombs = await getTombstones();
    const localSig = signature(localStores);

    const merged = mergeData(localStores, localTombs, remoteStores, remoteTombs, Date.now());
    const changed = signature(merged.stores) !== localSig;

    await applyStores(merged.stores);
    await setTombstones(merged.tombstones);

    const fileObj = { app: 'farmaco-tracker', v: 1, savedAt: new Date().toISOString(), stores: merged.stores, tombstones: merged.tombstones };
    if (fileId) await driveUpdate(token, fileId, fileObj);
    else { fileId = await driveCreate(token, fileObj); await setMeta('driveFileId', fileId); }

    await setMeta('driveLastSync', Date.now());
    return { ok: true, changed };
  } catch (e) {
    return { ok: false, reason: e.message };
  } finally {
    _syncing = false;
  }
}

// Avvia la sincronizzazione automatica: all'apertura, al ritorno in primo piano
// e (con ritardo) dopo le modifiche locali. `onApplied(changed)` per ridisegnare.
let _debounce = null;
export function initSync(onApplied) {
  const run = async () => {
    if (!(await isConfigured())) return;
    const r = await syncNow(false);
    if (r.ok && r.changed && onApplied) onApplied();
  };
  run();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(); });
  onChange(() => { clearTimeout(_debounce); _debounce = setTimeout(run, 4000); });
}
