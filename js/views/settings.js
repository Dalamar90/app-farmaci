// views/settings.js — configurazione: farmaci, effetti collaterali, promemoria EMA,
// backup/export, e nota legale.

import { getAll, put, del, clearStore, setTombstones, getMeta } from '../db.js';
import { uid, el, fmtDateTime, swVersion } from '../util.js';
import { icon } from '../icons.js';
import { openSheet, closeSheet, toast, confirmDialog } from '../ui.js';
import { exportJSON, importJSON, importJSONMerge, exportCSV, canShareBackup, shareJSON } from '../exportImport.js';
import {
  calendarRemindersEnabled, setCalendarRemindersEnabled, getReminderMoments, setReminderMoments,
} from '../reminders.js';
import { historyMomentOffsets } from '../stats.js';
import { nav } from '../nav.js';

export async function renderSettings() {
  const [meds, sideTypes, calOn, moments, hist, lastBackup, version] = await Promise.all([
    getAll('meds'), getAll('sideEffectTypes'),
    calendarRemindersEnabled(), getReminderMoments(), historyMomentOffsets(),
    getMeta('lastBackupAt'), swVersion(),
  ]);

  const root = el('div', { class: 'view view-settings' });
  root.append(el('button', { class: 'btn btn-secondary btn-back', onClick: () => nav.go('day') },
    icon('arrow-left', { size: 18 }), 'Torna al Giorno'));
  root.append(el('p', { class: 'view-title' }, 'Impostazioni'));

  // --- Farmaci ---
  const medCard = el('div', { class: 'card' }, el('h3', { class: 'card-title' }, 'Farmaci'));
  for (const m of meds) {
    medCard.append(el('div', { class: 'list-row' },
      el('span', {}, `${m.name}${m.quickDoses?.length ? ' · dosi rapide: ' + m.quickDoses.join('/') + ' mg' : ''}`),
      el('div', {},
        smallBtn('edit', () => editMed(m)),
        smallBtn('trash', async () => {
          if (await confirmDialog(`Eliminare il farmaco "${m.name}"? (le dosi già registrate restano)`, { confirmLabel: 'Elimina', danger: true })) {
            await del('meds', m.id); toast('Farmaco eliminato'); nav.refresh();
          }
        }),
      ),
    ));
  }
  medCard.append(el('button', { class: 'btn btn-secondary btn-block', onClick: () => editMed(null) }, icon('plus', { size: 18 }), 'Aggiungi farmaco'));
  root.append(medCard);

  // --- Effetti collaterali ---
  const fxCard = el('div', { class: 'card' }, el('h3', { class: 'card-title' }, 'Effetti collaterali'));
  for (const t of sideTypes) {
    fxCard.append(el('div', { class: 'list-row' },
      el('span', {}, t.name),
      el('div', {},
        smallBtn('edit', () => editSideType(t)),
        smallBtn('trash', async () => {
          if (await confirmDialog(`Eliminare "${t.name}"?`, { confirmLabel: 'Elimina', danger: true })) {
            await del('sideEffectTypes', t.id); toast('Eliminato'); nav.refresh();
          }
        }),
      ),
    ));
  }
  fxCard.append(el('button', { class: 'btn btn-secondary btn-block', onClick: () => editSideType(null) }, icon('plus', { size: 18 }), 'Aggiungi effetto'));
  root.append(fxCard);

  // --- Promemoria effetto (Calendario) ---
  const remCard = el('div', { class: 'card' }, el('h3', { class: 'card-title' }, 'Promemoria effetto (Calendario)'));
  remCard.append(el('p', { class: 'form-hint' },
    "Aggiunge gli avvisi al Calendario del telefono: suonano all'ora giusta anche con l'app chiusa, su iPhone e Android. Quando registri una dose, un tocco li mette nel calendario."));
  const remToggle = el('button', {
    class: 'btn ' + (calOn ? 'btn-primary' : 'btn-secondary') + ' btn-block',
    onClick: async () => {
      await setCalendarRemindersEnabled(!calOn);
      toast(!calOn ? 'Promemoria attivati' : 'Promemoria disattivati');
      nav.refresh();
    },
  }, icon(calOn ? 'check' : 'calendar', { size: 18 }), calOn ? 'Promemoria attivi (tocca per disattivare)' : 'Attiva promemoria');
  remCard.append(remToggle);
  if (calOn) {
    remCard.append(el('p', { class: 'form-section' }, 'Quali momenti e a che ora dopo la dose'));
    const work = moments.map((m) => ({ ...m }));
    const persist = () => setReminderMoments(work);
    for (const m of work) remCard.append(momentRow(m, hist[m.key], persist));
    remCard.append(el('p', { class: 'form-hint' },
      'Tempi proposti di partenza: modificali a piacere. Quando avrai registrato abbastanza dosi coi momenti, tocca "storico" per usare i tuoi tempi medi reali.'));
  }
  root.append(remCard);

  // --- Backup / Export / Travaso tra dispositivi ---
  const dataCard = el('div', { class: 'card' },
    el('h3', { class: 'card-title' }, 'Dati e backup'),
    el('p', { class: 'form-hint' }, 'Tutti i dati restano sul tuo dispositivo. Per allineare PC e telefono: esporta il backup da uno, importalo sull\'altro con "Unisci" — non si perde nulla.'),
    el('p', { class: 'form-hint backup-when' }, lastBackup
      ? `Ultimo backup da questo dispositivo: ${fmtDateTime(lastBackup)}.`
      : 'Ultimo backup da questo dispositivo: mai. I dati vivono solo qui: un backup ogni tanto li protegge.'),
    canShareBackup()
      ? el('button', { class: 'btn btn-primary btn-block', onClick: async () => { const ok = await shareJSON(); if (ok) toast('Backup inviato'); } }, icon('upload', { size: 18 }), 'Invia backup…')
      : null,
    el('button', { class: 'btn ' + (canShareBackup() ? 'btn-secondary' : 'btn-primary') + ' btn-block', onClick: async () => { await exportJSON(); toast('Backup scaricato'); } }, icon('download', { size: 18 }), 'Scarica backup (JSON)'),
    importButton(),
    el('button', { class: 'btn btn-secondary btn-block', onClick: async () => { await exportCSV(); toast('CSV esportato'); } }, icon('download', { size: 18 }), 'Export per foglio di calcolo (CSV)'),
  );
  root.append(dataCard);

  // --- Zona pericolo ---
  root.append(el('div', { class: 'card card-danger' },
    el('h3', { class: 'card-title' }, 'Zona pericolo'),
    el('button', {
      class: 'btn btn-danger btn-block',
      onClick: async () => {
        if (await confirmDialog('Cancellare TUTTI i dati (dosi, "come mi sento", effetti, coda)? Fai prima un backup!', { confirmLabel: 'Cancella tutto', danger: true })) {
          // Reset del dispositivo: NIENTE lapidi. Cancellare voce per voce con
          // del() marcherebbe tutto come "cancellato adesso", e un backup
          // reimportato dopo verrebbe scartato in blocco dall'Unisci (successo
          // davvero: export → cancella tutto → Unisci → archivio vuoto).
          for (const s of ['doses', 'checkins', 'sideEffectEntries', 'crashEntries']) await clearStore(s);
          await setTombstones([]);
          toast('Dati cancellati');
          nav.refresh();
        }
      },
    }, 'Cancella tutti i dati registrati'),
  ));

  // --- Nota legale ---
  root.append(el('div', { class: 'card' },
    el('h3', { class: 'card-title' }, 'Nota importante'),
    el('p', { class: 'legal-note legal-note-block' },
      'Questa app serve solo a osservare e annotare l\'andamento personale. Non è uno strumento diagnostico, non fornisce consigli medici né indicazioni sul dosaggio o sugli orari. Ogni modifica alla terapia va sempre discussa con il medico.'),
  ));

  root.append(el('p', { class: 'app-version' }, 'Tracciamento effetto farmaci · dati 100% locali' + (version ? ` · ${version}` : '')));
  return root;
}

// --- Editor farmaco --------------------------------------------------------
function editMed(existing) {
  const name = el('input', { class: 'input', placeholder: 'Nome farmaco', value: existing?.name || '' });
  const doses = el('input', { class: 'input', placeholder: 'es. 10, 15', value: (existing?.quickDoses || []).join(', ') });
  const content = el('div', { class: 'form' },
    el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Nome'), name),
    el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Dosi rapide (mg, separate da virgola)'), doses),
  );
  openSheet(existing ? 'Modifica farmaco' : 'Nuovo farmaco', content, {
    actions: [
      { label: 'Annulla', kind: 'btn-secondary', onClick: () => closeSheet() },
      { label: 'Salva', kind: 'btn-primary', onClick: async () => {
        if (!name.value.trim()) { toast('Inserisci un nome'); return; }
        const quickDoses = doses.value.split(',').map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n));
        await put('meds', { id: existing?.id || uid(), name: name.value.trim(), quickDoses, active: true });
        closeSheet(); toast('Salvato'); nav.refresh();
      } },
    ],
  });
}

// --- Editor effetto collaterale --------------------------------------------
function editSideType(existing) {
  const name = el('input', { class: 'input', placeholder: 'Nome effetto', value: existing?.name || '' });
  openSheet(existing ? 'Modifica effetto' : 'Nuovo effetto', el('div', { class: 'form' },
    el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Nome'), name)), {
    actions: [
      { label: 'Annulla', kind: 'btn-secondary', onClick: () => closeSheet() },
      { label: 'Salva', kind: 'btn-primary', onClick: async () => {
        if (!name.value.trim()) { toast('Inserisci un nome'); return; }
        await put('sideEffectTypes', { id: existing?.id || uid(), name: name.value.trim() });
        closeSheet(); toast('Salvato'); nav.refresh();
      } },
    ],
  });
}

// --- Riga di un momento nei promemoria (checkbox + tempo dopo la dose) ------
function momentRow(m, histInfo, persist) {
  const cb = el('input', { type: 'checkbox', class: 'moment-check', ...(m.on ? { checked: 'checked' } : {}) });
  const hInput = el('input', { type: 'number', class: 'input input-sm', min: '0', max: '12', inputmode: 'numeric', value: String(Math.floor(m.min / 60)) });
  const mInput = el('input', { type: 'number', class: 'input input-sm', min: '0', max: '55', step: '5', inputmode: 'numeric', value: String(m.min % 60) });
  const syncDisabled = () => { hInput.disabled = mInput.disabled = !m.on; };
  cb.addEventListener('change', () => { m.on = cb.checked; syncDisabled(); persist(); });
  const updateMin = () => {
    const h = Math.max(0, parseInt(hInput.value || '0', 10) || 0);
    const mm = Math.max(0, parseInt(mInput.value || '0', 10) || 0);
    m.min = Math.max(5, h * 60 + mm);
    persist();
  };
  hInput.addEventListener('change', updateMin);
  mInput.addEventListener('change', updateMin);
  syncDisabled();

  const histBtn = (histInfo && histInfo.n >= 2)
    ? el('button', {
      type: 'button', class: 'btn btn-secondary btn-xs', title: 'Usa il tuo tempo medio reale',
      onClick: () => {
        m.min = Math.max(5, histInfo.avg);
        hInput.value = String(Math.floor(m.min / 60));
        mInput.value = String(m.min % 60);
        persist();
        toast(`Impostato dal tuo storico (${histInfo.n} dosi)`);
      },
    }, `storico: ${formatHours(histInfo.avg)}`)
    : null;

  return el('div', { class: 'moment-row' },
    el('label', { class: 'moment-main' }, cb, icon('m-' + m.key, { size: 16 }), el('span', {}, m.label)),
    el('div', { class: 'moment-time' }, hInput, el('span', { class: 'unit' }, 'h'), mInput, el('span', { class: 'unit' }, 'm')),
    histBtn,
  );
}

// Formatta i minuti come ore leggibili: 30 → "30 min", 90 → "1 h 30", 180 → "3 h".
function formatHours(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), r = min % 60;
  return r ? `${h} h ${r}` : `${h} h`;
}

// --- Pulsante import (con scelta Unisci / Sostituisci) ----------------------
function importButton() {
  const file = el('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' });
  file.addEventListener('change', () => {
    const f = file.files[0];
    if (!f) return;
    openSheet('Come importare questo backup?', el('div', { class: 'form' },
      el('p', { class: 'form-hint' }, `File: ${f.name}`),
      el('button', {
        class: 'btn btn-primary btn-block',
        onClick: async () => {
          closeSheet();
          try {
            const res = await importJSONMerge(f);
            const n = Math.abs(res.added);
            toast(res.added > 0 ? `Dati uniti: ${n} ${n === 1 ? 'voce aggiunta' : 'voci aggiunte'}`
              : res.added < 0 ? `Dati uniti: ${n} ${n === 1 ? 'voce rimossa' : 'voci rimosse'} (cancellate altrove)`
                : 'Unione finita: niente di nuovo da aggiungere');
            nav.refresh();
          } catch (e) { toast('File non valido'); }
          file.value = '';
        },
      }, 'Unisci (consigliato)'),
      el('p', { class: 'form-hint' }, 'Aggiunge e aggiorna le voci del backup; le cancellazioni fatte restano cancellate. Per ogni voce vince la versione più recente.'),
      el('button', {
        class: 'btn btn-danger btn-block',
        onClick: async () => {
          closeSheet();
          if (!(await confirmDialog('Sostituire TUTTI i dati attuali con quelli del backup?', { confirmLabel: 'Sostituisci', danger: true }))) { file.value = ''; return; }
          try { await importJSON(f); toast('Dati sostituiti'); nav.refresh(); }
          catch (e) { toast('File non valido'); }
          file.value = '';
        },
      }, 'Sostituisci tutto'),
      el('p', { class: 'form-hint' }, 'Cancella i dati di questo dispositivo e mette solo quelli del backup.'),
    ), { onClose: () => { file.value = ''; } });
  });
  const btn = el('button', { class: 'btn btn-secondary btn-block', onClick: () => file.click() }, icon('download', { size: 18 }), 'Importa backup (JSON)');
  return el('div', {}, btn, file);
}

function smallBtn(name, onClick) {
  const label = name === 'trash' ? 'Elimina' : 'Modifica';
  return el('button', {
    class: 'icon-btn' + (name === 'trash' ? ' danger' : ''), onClick,
    title: label, 'aria-label': label,
  }, icon(name, { size: 18 }));
}
