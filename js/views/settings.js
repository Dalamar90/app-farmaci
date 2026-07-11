// views/settings.js — configurazione: farmaci, effetti collaterali, promemoria EMA,
// backup/export, e nota legale.

import { getAll, put, del, getMeta, setMeta } from '../db.js';
import { uid, el, fmtDateTime } from '../util.js';
import { icon } from '../icons.js';
import { openSheet, closeSheet, toast, confirmDialog } from '../ui.js';
import { exportJSON, importJSON, exportCSV } from '../exportImport.js';
import { getStatus as getSyncStatus, setClientId, connect, disconnect, syncNow } from '../sync.js';
import {
  remindersEnabled, enableReminders, disableReminders, setOffsets, notificationsSupported,
} from '../reminders.js';
import { DEFAULT_REMINDER_OFFSETS } from '../defaults.js';
import { nav } from '../nav.js';

export async function renderSettings() {
  const [meds, sideTypes, offsets, remOn] = await Promise.all([
    getAll('meds'), getAll('sideEffectTypes'),
    getMeta('reminderOffsets', DEFAULT_REMINDER_OFFSETS),
    remindersEnabled(),
  ]);
  const syncStatus = await getSyncStatus();

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

  // --- Promemoria EMA ---
  const remCard = el('div', { class: 'card' }, el('h3', { class: 'card-title' }, 'Promemoria check-in (EMA)'));
  if (!notificationsSupported()) {
    remCard.append(el('p', { class: 'form-hint' }, 'Le notifiche non sono supportate da questo browser.'));
  } else {
    const toggle = el('button', {
      class: 'btn ' + (remOn ? 'btn-primary' : 'btn-secondary') + ' btn-block',
      onClick: async () => {
        if (remOn) { await disableReminders(); toast('Promemoria disattivati'); }
        else {
          const r = await enableReminders();
          toast(r.ok ? 'Promemoria attivati' : `Non attivati: ${r.reason}`);
        }
        nav.refresh();
      },
    }, icon(remOn ? 'check' : 'bell', { size: 18 }), remOn ? 'Promemoria attivi (tocca per disattivare)' : 'Attiva promemoria');
    remCard.append(toggle);
    remCard.append(el('p', { class: 'form-hint' }, `Promemoria a: ${offsets.map(formatHours).join(' · ')} dopo la dose. Funzionano meglio con l'app aperta o aperta di recente.`));
    remCard.append(el('button', { class: 'btn btn-secondary btn-block', onClick: () => editOffsets(offsets) }, 'Scegli quando ricordarti'));
  }
  root.append(remCard);

  // --- Sincronizzazione Google Drive ---
  root.append(syncCard(syncStatus));

  // --- Backup / Export ---
  const dataCard = el('div', { class: 'card' },
    el('h3', { class: 'card-title' }, 'Dati e backup'),
    el('p', { class: 'form-hint' }, 'Tutti i dati restano sul tuo dispositivo. Fai backup periodici.'),
    el('button', { class: 'btn btn-primary btn-block', onClick: async () => { await exportJSON(); toast('Backup JSON esportato'); } }, icon('download', { size: 18 }), 'Backup completo (JSON)'),
    el('button', { class: 'btn btn-secondary btn-block', onClick: async () => { await exportCSV(); toast('CSV esportato'); } }, icon('download', { size: 18 }), 'Export per foglio di calcolo (CSV)'),
    importButton(),
  );
  root.append(dataCard);

  // --- Zona pericolo ---
  root.append(el('div', { class: 'card card-danger' },
    el('h3', { class: 'card-title' }, 'Zona pericolo'),
    el('button', {
      class: 'btn btn-danger btn-block',
      onClick: async () => {
        if (await confirmDialog('Cancellare TUTTI i dati (dosi, check-in, effetti, coda)? Fai prima un backup!', { confirmLabel: 'Cancella tutto', danger: true })) {
          for (const s of ['doses', 'checkins', 'sideEffectEntries', 'crashEntries']) {
            const all = await getAll(s);
            for (const r of all) await del(s, r.id);
          }
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

  root.append(el('p', { class: 'app-version' }, 'Tracciamento effetto farmaci · dati 100% locali'));
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

// --- Editor orari promemoria (chip a passi di mezz'ora) --------------------
function editOffsets(offsets) {
  const selected = new Set(offsets);
  const grid = el('div', { class: 'chips offset-chips' });
  for (let m = 30; m <= 360; m += 30) {
    const min = m;
    const b = el('button', {
      type: 'button', class: 'chip chip-sm' + (selected.has(min) ? ' chip-on' : ''),
      onClick: () => { if (selected.has(min)) selected.delete(min); else selected.add(min); b.classList.toggle('chip-on', selected.has(min)); },
    }, formatHours(min));
    grid.append(b);
  }
  openSheet('Quando ricordarti il check-in', el('div', { class: 'form' },
    el('p', { class: 'form-hint' }, "Scegli a che distanza dalla dose vuoi i promemoria. Passi di mezz'ora." ),
    grid), {
    actions: [
      { label: 'Annulla', kind: 'btn-secondary', onClick: () => closeSheet() },
      { label: 'Salva', kind: 'btn-primary', onClick: async () => {
        const vals = [...selected].sort((a, b) => a - b);
        if (!vals.length) { toast('Scegli almeno un orario'); return; }
        await setOffsets(vals); closeSheet(); toast('Promemoria aggiornati'); nav.refresh();
      } },
    ],
  });
}

// Formatta i minuti come ore leggibili: 30 → "30 min", 90 → "1 h 30", 180 → "3 h".
function formatHours(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), r = min % 60;
  return r ? `${h} h ${r}` : `${h} h`;
}

// --- Pulsante import (con file picker) -------------------------------------
function importButton() {
  const file = el('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' });
  file.addEventListener('change', async () => {
    if (!file.files[0]) return;
    if (!(await confirmDialog('Importare sostituirà TUTTI i dati attuali. Continuare?', { confirmLabel: 'Importa', danger: true }))) {
      file.value = ''; return;
    }
    try {
      await importJSON(file.files[0]);
      toast('Import completato'); nav.refresh();
    } catch (e) {
      toast('File non valido');
    }
    file.value = '';
  });
  const btn = el('button', { class: 'btn btn-secondary btn-block', onClick: () => file.click() }, icon('upload', { size: 18 }), 'Importa backup (JSON)');
  return el('div', {}, btn, file);
}

function smallBtn(name, onClick) {
  return el('button', {
    class: 'icon-btn' + (name === 'trash' ? ' danger' : ''), onClick,
  }, icon(name, { size: 18 }));
}

// --- Card sincronizzazione Google Drive ------------------------------------
function syncCard(status) {
  const card = el('div', { class: 'card' }, el('h3', { class: 'card-title' }, 'Sincronizza con Google Drive'));
  card.append(el('p', { class: 'form-hint' }, 'Stessi dati su PC e telefono. Il file vive nel TUO Drive, in uno spazio privato visibile solo a questa app.'));

  const cid = el('input', { class: 'input', placeholder: '…apps.googleusercontent.com', value: status.clientId || '' });
  card.append(el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'ID client Google'), cid));
  card.append(el('button', {
    class: 'btn btn-secondary btn-block',
    onClick: async () => { await setClientId(cid.value); toast('ID client salvato'); nav.refresh(); },
  }, 'Salva ID client'));

  if (status.clientId && status.enabled) {
    card.append(el('div', { class: 'sync-status' }, icon('check', { size: 16 }),
      el('span', {}, status.lastSync ? `Connesso · ultima sincronizzazione ${fmtDateTime(status.lastSync)}` : 'Connesso')));
    card.append(el('button', {
      class: 'btn btn-primary btn-block',
      onClick: async () => { toast('Sincronizzo…'); const r = await syncNow(true); toast(r.ok ? 'Dati sincronizzati' : `Non riuscito: ${r.reason}`); nav.refresh(); },
    }, icon('reset', { size: 18 }), 'Sincronizza ora'));
    card.append(el('button', {
      class: 'btn btn-secondary btn-block',
      onClick: async () => { await disconnect(); toast('Disconnesso'); nav.refresh(); },
    }, 'Disconnetti'));
  } else if (status.clientId) {
    card.append(el('button', {
      class: 'btn btn-primary btn-block',
      onClick: async () => {
        try { await connect(); const r = await syncNow(true); toast(r.ok ? 'Connesso e sincronizzato' : `Connesso (sync: ${r.reason})`); nav.refresh(); }
        catch (e) { toast('Connessione annullata'); }
      },
    }, 'Connetti Google Drive'));
  }

  card.append(el('details', { class: 'sync-help' },
    el('summary', {}, "Come ottenere l'ID client (una volta sola)"),
    el('ol', { class: 'help-list' },
      el('li', {}, 'Apri ', el('a', { href: 'https://console.cloud.google.com/', target: '_blank', rel: 'noopener' }, 'console.cloud.google.com'), ' e crea un progetto.'),
      el('li', {}, 'In "API e servizi → Libreria" abilita la Google Drive API.'),
      el('li', {}, 'In "Schermata consenso OAuth": tipo Esterno, compila i campi minimi, e aggiungi la tua email come "Utente di test".'),
      el('li', {}, 'In "Credenziali → Crea credenziali → ID client OAuth", scegli "Applicazione web".'),
      el('li', {}, 'In "Origini JavaScript autorizzate" aggiungi: ', el('code', {}, location.origin), ' (e l\'URL https dove pubblicherai l\'app).'),
      el('li', {}, "Copia l'ID client e incollalo qui sopra."),
    ),
  ));
  return card;
}
