// reminders.js — promemoria EMA (notifiche per ricordare di registrare un check-in).
//
// Sono SOLO solleciti a registrare un dato nel momento giusto, NON consigli medici.
//
// Limite tecnico di una PWA senza server: le notifiche pianificate sono affidabili
// soprattutto mentre l'app è aperta o usata di recente. Implementazione "best effort":
//  - alla registrazione di una dose calcoliamo gli orari dei promemoria e li salviamo;
//  - un timer controlla periodicamente quelli scaduti e mostra la notifica;
//  - se il browser supporta i Notification Triggers, li usiamo come bonus (background).

import { getMeta, setMeta } from './db.js';
import { uid } from './util.js';
import { DEFAULT_REMINDER_OFFSETS } from './defaults.js';

const PENDING_KEY = 'pendingReminders';

export function notificationsSupported() {
  return 'Notification' in window;
}

export async function remindersEnabled() {
  return (await getMeta('remindersEnabled', false)) && Notification.permission === 'granted';
}

export async function enableReminders() {
  if (!notificationsSupported()) return { ok: false, reason: 'non supportate' };
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: 'permesso negato' };
  await setMeta('remindersEnabled', true);
  return { ok: true };
}

export async function disableReminders() {
  await setMeta('remindersEnabled', false);
}

async function getOffsets() {
  return (await getMeta('reminderOffsets', DEFAULT_REMINDER_OFFSETS)) || DEFAULT_REMINDER_OFFSETS;
}

export async function setOffsets(offsets) {
  await setMeta('reminderOffsets', offsets);
}

async function getPending() {
  return (await getMeta(PENDING_KEY, [])) || [];
}

async function savePending(list) {
  await setMeta(PENDING_KEY, list);
}

// Pianifica i promemoria per una nuova dose.
export async function scheduleForDose(dose) {
  if (!(await remindersEnabled())) return;
  const offsets = await getOffsets();
  const base = new Date(dose.takenAt).getTime();
  const pending = await getPending();
  for (const min of offsets) {
    const at = base + min * 60000;
    if (at <= Date.now()) continue; // saltiamo gli orari già passati
    const id = uid();
    pending.push({
      id, doseId: dose.id, at, min,
      label: `Check-in: sono passati ~${labelForMin(min)} dalla dose. Come va l'effetto?`,
      fired: false,
    });
    // Bonus: Notification Trigger (se supportato dal browser/SW).
    tryTrigger(id, at, dose);
  }
  await savePending(pending);
}

function labelForMin(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), r = min % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

// Rimuove i promemoria ancora pendenti di una dose (es. dose cancellata o "effetto finito").
export async function cancelForDose(doseId) {
  const pending = await getPending();
  await savePending(pending.filter((p) => p.doseId !== doseId));
}

// Mostra una notifica (via service worker se possibile, altrimenti Notification diretta).
async function showNotification(title, body, data) {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg && reg.showNotification) {
      await reg.showNotification(title, {
        body, tag: data?.id, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
        data, requireInteraction: false,
      });
      return;
    }
  } catch (_) { /* fallback sotto */ }
  if (Notification.permission === 'granted') new Notification(title, { body });
}

async function tryTrigger(id, at, dose) {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg && 'showTrigger' in Notification.prototype && window.TimestampTrigger) {
      await reg.showNotification('Promemoria check-in', {
        tag: id,
        body: "È il momento di un check-in sull'effetto.",
        icon: 'icons/icon-192.png',
        showTrigger: new TimestampTrigger(at),
        data: { id, doseId: dose.id },
      });
    }
  } catch (_) { /* non supportato: ci pensa il timer in foreground */ }
}

// Controlla i promemoria scaduti e li mostra. Chiamato dal ticker.
export async function checkDue() {
  if (!(await remindersEnabled())) return;
  const pending = await getPending();
  let changed = false;
  const now = Date.now();
  for (const p of pending) {
    if (!p.fired && p.at <= now && now - p.at < 30 * 60000) {
      await showNotification('Promemoria check-in', p.label, { id: p.id, doseId: p.doseId });
      p.fired = true;
      changed = true;
    } else if (!p.fired && now - p.at >= 30 * 60000) {
      p.fired = true; // troppo vecchio: lo marchiamo per non mostrarlo in ritardo
      changed = true;
    }
  }
  // Pulizia: togli quelli vecchi già gestiti (oltre 8 ore).
  const cleaned = pending.filter((p) => now - p.at < 8 * 3600 * 1000);
  if (cleaned.length !== pending.length) changed = true;
  if (changed) await savePending(cleaned);
}

let _ticker = null;
export function startTicker() {
  if (_ticker) return;
  checkDue();
  _ticker = setInterval(checkDue, 30000);
  // Controlla anche quando l'app torna in primo piano.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkDue();
  });
}
