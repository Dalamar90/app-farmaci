// defaults.js — dati di partenza usati al primo avvio (seed del database).
// Tutto è poi modificabile dall'utente nelle Impostazioni.

import { uid } from './util.js';

// Farmaco preimpostato: Ritalin IR.
// La dose in mg si sceglie al momento dell'assunzione (varia 10–15 mg),
// quindi qui memorizziamo solo nome e dosi "rapide" suggerite.
export function defaultMedications() {
  return [
    {
      id: uid(),
      name: 'Ritalin IR',
      quickDoses: [10, 15], // chip rapidi nel form dose
      active: true,
    },
  ];
}

// Effetti collaterali precaricati (modificabili).
export function defaultSideEffectTypes() {
  return [
    'Mal di testa',
    'Inappetenza',
    'Battito accelerato',
    'Ansia',
    'Bocca secca',
  ].map((name) => ({ id: uid(), name }));
}

// Promemoria EMA: minuti dopo la dose in cui ricordare un check-in.
// Basati sulla farmacocinetica del metilfenidato IR negli adulti:
// inizio ~20-30', picco 1-2h, durata ~3-4h, coda dopo.
export const DEFAULT_REMINDER_OFFSETS = [30, 90, 180, 270]; // 30m, 1h30, 3h, 4h30

// Finestra (in ore) entro cui una dose è considerata "attiva"
// e mostrata in home per il check-in rapido.
export const ACTIVE_DOSE_HOURS = 6;

// Marcatori dei momenti chiave (etichette e ordine).
export const MARKERS = [
  { key: 'start', label: 'Inizio effetto', icon: '▶' },
  { key: 'peak', label: 'Picco', icon: '▲' },
  { key: 'decline', label: 'Inizio calo', icon: '▼' },
  { key: 'end', label: 'Effetto finito', icon: '■' },
];

// Metriche degli slider del check-in (chiave -> etichetta).
export const CHECKIN_METRICS = [
  { key: 'intensity', label: 'Intensità effetto', color: '#2563eb' }, // blu
  { key: 'focus', label: 'Concentrazione / focus', color: '#16a34a' }, // verde
  { key: 'energy', label: 'Energia', color: '#ea580c' }, // arancione (3:1 su fondo chiaro)
  { key: 'mood', label: 'Umore', color: '#dc2626' }, // rosso
];

// Metriche della "coda" / crash.
export const CRASH_METRICS = [
  { key: 'tiredness', label: 'Stanchezza' },
  { key: 'irritability', label: 'Irritabilità' },
  { key: 'moodDrop', label: 'Calo di umore' },
];

// Opzioni rapide per il contesto della dose.
export const STOMACH_OPTIONS = ['A digiuno', 'Spuntino', 'Pasto leggero', 'Pasto completo'];
export const ACTIVITY_OPTIONS = ['Lavoro', 'Studio', 'Sport', 'Riposo', 'Faccende', 'Altro'];
