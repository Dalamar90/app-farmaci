// views/day.js — Pagina principale "Giorno": tutto su un'unica schermata, senza
// pannelli a comparsa. Si sceglie il giorno una volta; ogni voce chiede solo l'ora.
// A sinistra (o sopra, su telefono) l'inserimento; a destra gli eventi del giorno;
// sotto il grafico degli effetti del giorno.

import { getAll, put, del, deleteDoseCascade } from '../db.js';
import {
  el, uid, dayStr, timeStr, combineDayTime, isoToTime, isSameDay, dayLabel,
  fmtTime, fmtDuration, minutesBetween, hexAlpha, isDark,
} from '../util.js';
import { slider, chips, toast, toastAction } from '../ui.js';
import { icon } from '../icons.js';
import {
  CHECKIN_METRICS, CRASH_METRICS, MARKERS, STOMACH_OPTIONS, ACTIVITY_OPTIONS,
} from '../defaults.js';
import { loadDoseBundle, recomputeDoseMarkers } from '../stats.js';
import { calendarRemindersEnabled, buildDoseCalendar } from '../reminders.js';
import { addToCalendar } from '../ics.js';
import { nav } from '../nav.js';

const PALETTE = ['#4f46e5', '#0d9488', '#db2777', '#d97706'];

// Stato della vista (persistente finché l'app è aperta).
const state = { day: null, mode: 'dose', editing: null, refDoseId: null, metrics: null };

let dayChart = null;

// Apre la pagina Giorno su una certa data, eventualmente in modifica di una voce.
// Usata dal Diario per modificare senza aprire pop-up.
export function openDayFor(iso, { mode, editing } = {}) {
  state.day = dayStr(new Date(iso));
  if (mode) state.mode = mode;
  state.editing = editing || null;
  state.refDoseId = null;
  nav.go('day');
}

export async function renderDay() {
  if (state.day === null) state.day = dayStr();
  if (state.metrics === null) state.metrics = new Set(['intensity']);

  const allDoses = (await getAll('doses')).sort((a, b) => new Date(a.takenAt) - new Date(b.takenAt));
  const dayDoses = allDoses.filter((d) => isSameDay(d.takenAt, state.day));
  const bundles = await Promise.all(dayDoses.map(loadDoseBundle));
  const calEnabled = await calendarRemindersEnabled();
  const meds = await getAll('meds');

  const root = el('div', { class: 'view view-day' });

  root.append(dateBar());

  const grid = el('div', { class: 'day-grid' },
    el('section', { class: 'entry-panel' }, entryPanel(dayDoses)),
    el('section', { class: 'events-panel' }, eventsPanel(bundles)),
  );
  root.append(grid);

  root.append(dayChartSection(bundles));

  root.append(el('p', { class: 'legal-note' },
    'Strumento personale di osservazione: non è uno strumento diagnostico e non dà consigli medici o sul dosaggio. Ogni modifica alla terapia va discussa col medico.'));

  setTimeout(() => buildDayChart(bundles), 0);
  return root;

  // ---------------------------------------------------------------- date bar
  function dateBar() {
    const input = el('input', { type: 'date', class: 'input date-input', 'aria-label': 'Scegli il giorno', value: state.day,
      onChange: (e) => { state.day = e.target.value || dayStr(); state.editing = null; state.refDoseId = null; nav.refresh(); } });
    const shift = (days) => { const d = new Date(state.day + 'T12:00'); d.setDate(d.getDate() + days); state.day = dayStr(d); state.editing = null; state.refDoseId = null; nav.refresh(); };
    return el('div', { class: 'date-bar' },
      el('button', { class: 'icon-btn', 'aria-label': 'Giorno precedente', onClick: () => shift(-1) }, icon('chevron-left', { size: 20 })),
      el('div', { class: 'date-center' },
        el('span', { class: 'date-label' }, dayLabel(state.day)),
        input,
      ),
      el('button', { class: 'icon-btn', 'aria-label': 'Giorno successivo', onClick: () => shift(1) }, icon('chevron-right', { size: 20 })),
      state.day !== dayStr() ? el('button', { class: 'btn btn-secondary btn-sm', onClick: () => { state.day = dayStr(); nav.refresh(); } }, 'Oggi') : null,
    );
  }

  // ------------------------------------------------------------- entry panel
  function entryPanel(doses) {
    const wrap = el('div', {});

    // Selettore di cosa inserire
    const modes = [
      { key: 'dose', label: 'Dose', icon: 'pill' },
      { key: 'checkin', label: 'Come mi sento', icon: 'clock' },
      { key: 'effetti', label: 'Effetti collaterali', icon: 'alert' },
      { key: 'coda', label: 'Coda', icon: 'crash' },
    ];
    const seg = el('div', { class: 'seg' });
    for (const m of modes) {
      seg.append(el('button', {
        class: 'seg-btn' + (state.mode === m.key ? ' seg-on' : ''),
        onClick: () => { if (state.mode !== m.key) { state.mode = m.key; state.editing = null; nav.refresh(); } },
      }, icon(m.icon, { size: 18 }), el('span', {}, m.label)));
    }
    wrap.append(seg);

    let form;
    if (state.mode === 'dose') form = doseForm();
    else if (doses.length === 0) form = needDose();
    else if (state.mode === 'checkin') form = checkinForm(doses);
    else if (state.mode === 'effetti') form = effettiForm(doses);
    else form = codaForm(doses);
    wrap.append(form);
    return wrap;
  }

  function needDose() {
    return el('div', { class: 'entry-card empty-entry' },
      el('p', {}, 'Per registrare come ti senti, gli effetti collaterali o la coda serve prima una dose in questo giorno.'),
      el('button', { class: 'btn btn-primary', onClick: () => { state.mode = 'dose'; nav.refresh(); } },
        icon('plus', { size: 18 }), 'Aggiungi una dose'),
    );
  }

  function timeField(labelText, value) {
    const input = el('input', { type: 'time', class: 'input', value: value || timeStr() });
    return { node: el('label', { class: 'field' }, el('span', { class: 'field-label' }, labelText), input), get: () => input.value };
  }

  function refDoseField(doses, onChange) {
    // Default: la dose più recente del giorno (a cui "appartiene" ciò che senti adesso).
    const def = state.refDoseId && doses.some((d) => d.id === state.refDoseId)
      ? state.refDoseId : doses[doses.length - 1].id;
    const sel = el('select', { class: 'input', onChange: (e) => { state.refDoseId = e.target.value; if (onChange) onChange(e.target.value); } },
      ...doses.map((d) => el('option', { value: d.id, ...(d.id === def ? { selected: 'selected' } : {}) },
        `Dose delle ${fmtTime(d.takenAt)} · ${d.doseMg} mg`)));
    state.refDoseId = def;
    return { node: el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Riferita alla dose'), sel), get: () => sel.value };
  }

  // ----- Form: Dose
  function doseForm() {
    const ed = state.editing && state.editing.type === 'dose' ? state.editing.data : null;
    const card = el('div', { class: 'entry-card' });

    // Farmaco: se non ne hai ancora, lo scrivi qui e l'app se lo ricorda (insieme
    // alla dose). Con più farmaci configurati scegli quale. Si modifica poi da
    // Impostazioni › Farmaci.
    const edMed = ed ? meds.find((m) => m.id === ed.medicationId) : null;
    let medNameInput = null;
    let medSelect = null;
    let medField;
    if (!meds.length) {
      medNameInput = el('input', { class: 'input', placeholder: 'es. nome farmaco', value: ed ? (ed.medName || '') : '' });
      medField = el('label', { class: 'field' },
        el('span', { class: 'field-label' }, 'Farmaco'),
        medNameInput,
        el('span', { class: 'form-hint' }, "Scrivilo una volta sola: l'app lo ricorda insieme alla dose. Poi si cambia da Impostazioni › Farmaci."));
    } else if (meds.length === 1) {
      medField = el('div', { class: 'field' },
        el('span', { class: 'field-label' }, 'Farmaco'),
        el('div', { class: 'med-name' }, meds[0].name));
    } else {
      const cur = (edMed || meds[0]).id;
      medSelect = el('select', { class: 'input', onChange: () => paintMgChips() },
        ...meds.map((m) => el('option', { value: m.id, ...(m.id === cur ? { selected: 'selected' } : {}) }, m.name)));
      medField = el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Farmaco'), medSelect);
    }
    const selectedMed = () => {
      if (!meds.length) return null;
      if (medSelect) return meds.find((m) => m.id === medSelect.value) || meds[0];
      return edMed || meds[0];
    };

    const mgInput = el('input', { type: 'number', class: 'input input-mg', min: '0', step: '0.5', inputmode: 'decimal', placeholder: 'mg', value: ed ? ed.doseMg : '' });
    // I chip rapidi nascono dalle "dosi rapide" del farmaco scelto: niente valori fissi.
    const mgChipsWrap = el('div', { class: 'mg-chips' });
    function paintMgChips() {
      mgChipsWrap.innerHTML = '';
      const quick = (selectedMed()?.quickDoses) || [];
      if (!quick.length) return;
      const c = chips(quick.map((d) => ({ label: d + ' mg', value: d })), { selected: ed && quick.includes(ed.doseMg) ? ed.doseMg : null });
      c.node.addEventListener('click', () => { const v = c.get(); if (v != null) mgInput.value = v; });
      mgChipsWrap.append(c.node);
    }
    paintMgChips();

    const t = timeField('Ora', ed ? isoToTime(ed.takenAt) : null);
    const ctx = ed && ed.context ? ed.context : {};
    const stomach = chips(STOMACH_OPTIONS, { selected: ctx.stomach || null });
    const sleep = el('input', { type: 'number', class: 'input', min: '0', max: '24', step: '0.5', inputmode: 'decimal', placeholder: 'es. 7', value: ctx.sleepHours != null ? ctx.sleepHours : '' });
    const activity = chips(ACTIVITY_OPTIONS, { selected: ctx.activity || null });

    card.append(
      medField,
      el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Dose'), el('div', { class: 'mg-row' }, mgChipsWrap, mgInput)),
      t.node,
      el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Stomaco / pasto'), stomach.node),
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Ore di sonno la notte prima'), sleep),
      el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Attività prevista'), activity.node),
      saveRow(async () => {
        const mg = parseFloat(mgInput.value);
        if (isNaN(mg)) { toast('Inserisci i mg della dose'); return; }
        let med = selectedMed();
        if (!med) {
          const name = (medNameInput.value || '').trim();
          if (!name) { toast('Scrivi il nome del farmaco'); return; }
          // Primo farmaco: memorizziamo nome E dose, così dalla prossima volta ci sono già.
          med = { id: uid(), name, quickDoses: [mg], active: true };
          await put('meds', med);
        }
        const dose = {
          id: ed ? ed.id : uid(),
          medicationId: med.id,
          medName: med.name,
          doseMg: mg,
          takenAt: combineDayTime(state.day, t.get()),
          context: { stomach: stomach.get(), sleepHours: sleep.value === '' ? null : parseFloat(sleep.value), activity: activity.get() },
          markers: ed ? (ed.markers || {}) : {},
        };
        await put('doses', dose);
        // Nuova dose + promemoria attivi: offri di metterli nel calendario (un tocco).
        if (!ed && calEnabled) {
          const cal = await buildDoseCalendar(dose);
          if (cal) {
            state.editing = null;
            nav.refresh();
            toastAction('Dose registrata · promemoria pronti', 'Aggiungi al calendario 📅',
              () => addToCalendar(cal.filename, cal.ics));
            return;
          }
        }
        finishEntry(ed ? 'Dose aggiornata' : 'Dose registrata');
      }, ed, 'Registra dose'),
    );
    return card;
  }

  // ----- Form: "Come mi sento" (slider + momento della curva, scelta singola)
  function checkinForm(doses) {
    const ed = state.editing && state.editing.type === 'checkin' ? state.editing.data : null;
    if (ed) state.refDoseId = ed.doseId;
    const card = el('div', { class: 'entry-card' });
    const sliders = CHECKIN_METRICS.map((m) => ({ key: m.key, ctrl: slider(m.label, { value: ed ? (ed[m.key] ?? 0) : 0, color: m.color }) }));
    const t = timeField('Ora', ed ? isoToTime(ed.at) : null);

    // Momento della curva: al più UNO (o nessuno). Tocca di nuovo per togliere.
    let moment = ed && ed.moment ? ed.moment : null;
    const mkWrap = el('div', { class: 'mk-row' });
    function paintMoments() {
      mkWrap.innerHTML = '';
      for (const mk of MARKERS) {
        const on = moment === mk.key;
        mkWrap.append(el('button', {
          type: 'button', class: 'mk-toggle' + (on ? ' mk-on' : ''), title: mk.label,
          onClick: () => { moment = (moment === mk.key) ? null : mk.key; paintMoments(); },
        }, icon('m-' + mk.key, { size: 15 }), el('small', {}, mk.label)));
      }
    }
    paintMoments();
    const ref = refDoseField(doses);

    card.append(
      ref.node,
      ...sliders.map((s) => s.ctrl.node),
      t.node,
      el('p', { class: 'form-section' }, 'Momento dell\'effetto (facoltativo)'),
      el('p', { class: 'form-hint' }, "Se questa è una tappa della curva, scegline una sola: viene registrata all'ora qui sopra. Tocca di nuovo per togliere." ),
      mkWrap,
      saveRow(async () => {
        const refId = ref.get();
        const entry = { id: ed ? ed.id : uid(), doseId: refId, at: combineDayTime(state.day, t.get()), moment: moment || null };
        for (const s of sliders) entry[s.key] = s.ctrl.get();
        await put('checkins', entry);
        // I marcatori della dose si ricavano dai check-in che portano un momento.
        await recomputeDoseMarkers(refId);
        if (ed && ed.doseId && ed.doseId !== refId) await recomputeDoseMarkers(ed.doseId);
        finishEntry(ed ? 'Aggiornato' : 'Salvato');
      }, ed, 'Salva'),
    );
    return card;
  }

  // ----- Form: Effetti collaterali
  function effettiForm(doses) {
    const card = el('div', { class: 'entry-card' });
    const ref = refDoseField(doses);
    const t = timeField('Ora', null);
    let rows = [];
    const list = el('div', {});
    getAll('sideEffectTypes').then((types) => {
      rows = types.map((ty) => ({ type: ty, ctrl: slider(ty.name, { value: 0, color: '#dc2626' }) }));
      list.append(...rows.map((r) => r.ctrl.node));
    });
    card.append(
      ref.node,
      el('p', { class: 'form-hint' }, 'Sposta solo gli slider degli effetti collaterali presenti. Quelli a 0 non vengono salvati.'),
      list,
      t.node,
      saveRow(async () => {
        const at = combineDayTime(state.day, t.get());
        let n = 0;
        for (const r of rows) { const v = r.ctrl.get(); if (v > 0) { await put('sideEffectEntries', { id: uid(), doseId: ref.get(), sideEffectTypeId: r.type.id, name: r.type.name, intensity: v, at }); n++; } }
        finishEntry(n ? `${n} effetto/i salvato/i` : 'Nessun effetto > 0');
      }, null, 'Salva effetti'),
    );
    return card;
  }

  // ----- Form: Coda / crash
  function codaForm(doses) {
    const ed = state.editing && state.editing.type === 'coda' ? state.editing.data : null;
    if (ed) state.refDoseId = ed.doseId;
    const card = el('div', { class: 'entry-card' });
    const ref = refDoseField(doses);
    const sliders = CRASH_METRICS.map((m) => ({ key: m.key, ctrl: slider(m.label, { value: ed ? (ed[m.key] ?? 0) : 0, color: '#7c3aed' }) }));
    const notes = el('textarea', { class: 'input textarea', rows: '2', placeholder: 'Note libere…' }, ed ? (ed.notes || '') : '');
    const t = timeField('Ora', ed ? isoToTime(ed.at) : null);
    card.append(
      ref.node,
      el('p', { class: 'form-hint' }, "La coda è l'esaurimento dell'effetto: registrala quando arriva." ),
      ...sliders.map((s) => s.ctrl.node),
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Note'), notes),
      t.node,
      saveRow(async () => {
        const entry = { id: ed ? ed.id : uid(), doseId: ref.get(), at: combineDayTime(state.day, t.get()), notes: notes.value.trim() };
        for (const s of sliders) entry[s.key] = s.ctrl.get();
        await put('crashEntries', entry);
        finishEntry(ed ? 'Coda aggiornata' : 'Coda salvata');
      }, ed, 'Salva coda'),
    );
    return card;
  }

  function saveRow(onSave, ed, label = 'Salva') {
    return el('div', { class: 'save-row' },
      ed ? el('button', { class: 'btn btn-secondary', onClick: () => { state.editing = null; nav.refresh(); } }, 'Annulla modifica') : null,
      el('button', { class: 'btn btn-primary btn-save', onClick: onSave }, icon('check', { size: 18 }), ed ? 'Salva modifica' : label),
    );
  }

  function finishEntry(msg) {
    state.editing = null;
    toast(msg);
    nav.refresh();
  }

  // ------------------------------------------------------------ events panel
  function eventsPanel(bundles) {
    const wrap = el('div', {});
    wrap.append(el('h3', { class: 'panel-title' }, `Eventi · ${dayLabel(state.day)}`));

    // Costruisci una lista cronologica unica.
    const events = [];
    for (const b of bundles) {
      events.push({ at: b.dose.takenAt, kind: 'dose', b, dose: b.dose });
      for (const c of b.checkins) events.push({ at: c.at, kind: 'checkin', data: c, dose: b.dose });
      for (const e of b.sideEffects) events.push({ at: e.at, kind: 'effetto', data: e, dose: b.dose });
      for (const c of b.crashes) events.push({ at: c.at, kind: 'coda', data: c, dose: b.dose });
    }
    events.sort((a, b) => new Date(a.at) - new Date(b.at));

    if (!events.length) {
      wrap.append(el('div', { class: 'empty-hint' },
        el('div', { class: 'empty-ico' }, icon('diary', { size: 36, stroke: 1.5 })),
        'Niente registrato per questo giorno. Inizia aggiungendo una dose.'));
      return wrap;
    }

    const list = el('div', { class: 'event-list' });
    for (const ev of events) list.append(eventRow(ev));
    wrap.append(list);
    return wrap;
  }

  function eventRow(ev) {
    if (ev.kind === 'dose') return doseRow(ev.b);
    const meta = {
      checkin: { ico: 'clock', color: 'var(--primary)', text: CHECKIN_METRICS.map((m) => `${m.label.split(' ')[0]} ${ev.data[m.key] ?? '–'}`).join(' · ') },
      effetto: { ico: 'alert', color: '#dc2626', text: `${ev.data.name || ''}: ${ev.data.intensity}/10` },
      coda: { ico: 'crash', color: '#7c3aed', text: CRASH_METRICS.map((m) => `${m.label.split(' ')[0]} ${ev.data[m.key] ?? '–'}`).join(' · ') + (ev.data.notes ? ` · ${ev.data.notes}` : '') },
    }[ev.kind];
    const editable = ev.kind === 'checkin' || ev.kind === 'coda';
    return el('div', { class: 'event-row' },
      el('span', { class: 'event-time tnum' }, fmtTime(ev.at)),
      el('span', { class: 'event-ico', style: `color:${meta.color}` }, icon(meta.ico, { size: 18 })),
      el('span', { class: 'event-text' }, meta.text),
      el('span', { class: 'event-actions' },
        editable ? actBtn('edit', 'Modifica', () => { state.mode = ev.kind === 'checkin' ? 'checkin' : 'coda'; state.editing = { type: ev.kind, data: ev.data }; nav.refresh(); }) : null,
        actBtn('trash', 'Elimina', () => deleteChild(ev.kind, ev.data), true),
      ),
    );
  }

  function doseRow(b) {
    const d = b.dose;
    const dur = (d.markers && d.markers.start && d.markers.end) ? fmtDuration(minutesBetween(d.markers.start, d.markers.end)) : null;
    const ctx = d.context || {};
    const ctxBits = [ctx.stomach, ctx.sleepHours != null ? `${ctx.sleepHours}h sonno` : null, ctx.activity].filter(Boolean);

    // Marcatori: sola lettura (si registrano dal check-in). Mostra solo quelli timbrati.
    const stamped = MARKERS.filter((mk) => d.markers && d.markers[mk.key]);
    const markerTags = stamped.length
      ? el('div', { class: 'diary-markers' },
        ...stamped.map((mk) => el('span', { class: 'mk-tag' }, icon('m-' + mk.key, { size: 13 }), `${mk.label} ${fmtTime(d.markers[mk.key])}`)))
      : null;

    return el('div', { class: 'event-row dose-row' },
      el('div', { class: 'dose-row-head' },
        el('span', { class: 'event-time tnum' }, fmtTime(d.takenAt)),
        el('span', { class: 'event-ico dose-ico' }, icon('pill', { size: 18 })),
        el('span', { class: 'event-text' }, el('strong', {}, `${d.medName} · ${d.doseMg} mg`), dur ? el('span', { class: 'dose-dur' }, ` · durata ${dur}`) : null),
        el('span', { class: 'event-actions' },
          calEnabled ? actBtn('calendar', 'Aggiungi promemoria al calendario', async () => {
            const cal = await buildDoseCalendar(d);
            if (!cal) { toast('Attiva almeno un momento in Impostazioni › Promemoria'); return; }
            await addToCalendar(cal.filename, cal.ics);
          }) : null,
          actBtn('edit', 'Modifica dose', () => { state.mode = 'dose'; state.editing = { type: 'dose', data: d }; nav.refresh(); }),
          actBtn('trash', 'Elimina dose', () => deleteDose(b), true),
        ),
      ),
      ctxBits.length ? el('div', { class: 'dose-ctx' }, ctxBits.join(' · ')) : null,
      markerTags,
    );
  }

  function actBtn(name, title, onClick, danger) {
    return el('button', { class: 'icon-btn' + (danger ? ' danger' : ''), title, 'aria-label': title, onClick }, icon(name, { size: 17 }));
  }

  async function deleteChild(kind, data) {
    const store = kind === 'checkin' ? 'checkins' : kind === 'effetto' ? 'sideEffectEntries' : 'crashEntries';
    await del(store, data.id);
    if (kind === 'checkin' && data.doseId) await recomputeDoseMarkers(data.doseId);
    if (state.editing && state.editing.data && state.editing.data.id === data.id) state.editing = null;
    nav.refresh();
    toastAction('Voce eliminata', 'Annulla', async () => {
      await put(store, data);
      if (kind === 'checkin' && data.doseId) await recomputeDoseMarkers(data.doseId);
      nav.refresh();
    });
  }

  async function deleteDose(b) {
    const snapshot = { dose: b.dose, checkins: b.checkins, sideEffects: b.sideEffects, crashes: b.crashes };
    await deleteDoseCascade(b.dose.id);
    if (state.editing && state.editing.type === 'dose' && state.editing.data.id === b.dose.id) state.editing = null;
    nav.refresh();
    toastAction('Dose eliminata', 'Annulla', async () => {
      await put('doses', snapshot.dose);
      for (const c of snapshot.checkins) await put('checkins', c);
      for (const e of snapshot.sideEffects) await put('sideEffectEntries', e);
      for (const c of snapshot.crashes) await put('crashEntries', c);
      nav.refresh();
    });
  }

  // -------------------------------------------------------------- day chart
  function dayChartSection(bundles) {
    const hasData = bundles.some((b) => b.checkins.length);
    const section = el('div', { class: 'day-chart-section' });
    section.append(el('h3', { class: 'panel-title panel-title-ico' }, icon('curve', { size: 18 }), 'Grafico degli effetti'));

    const bar = el('div', { class: 'chip-bar' });
    for (const m of CHECKIN_METRICS) {
      bar.append(el('button', {
        class: 'chip chip-sm' + (state.metrics.has(m.key) ? ' chip-on' : ''),
        onClick: () => {
          if (state.metrics.has(m.key)) { if (state.metrics.size > 1) state.metrics.delete(m.key); } else state.metrics.add(m.key);
          // Aggiorna solo i chip e ridisegna il grafico: la pagina non si ricostruisce.
          [...bar.children].forEach((c, i) => c.classList.toggle('chip-on', state.metrics.has(CHECKIN_METRICS[i].key)));
          if (hasData) buildDayChart(bundles);
        },
      }, m.label));
    }
    section.append(bar);

    if (!hasData) {
      section.append(el('div', { class: 'empty-hint' },
        el('div', { class: 'empty-ico' }, icon('curve', { size: 40, stroke: 1.5 })),
        'Segna qualche volta come ti senti: qui prende forma la curva del tuo effetto.'));
    } else {
      section.append(el('div', { class: 'chart-wrap' }, el('canvas', { id: 'day-chart' })));
    }
    return section;
  }
}

function buildDayChart(bundles) {
  if (dayChart) { dayChart.destroy(); dayChart = null; }
  const canvas = document.getElementById('day-chart');
  if (!canvas || !window.Chart) return;

  const dark = isDark();
  const tickColor = dark ? 'rgba(226,232,240,0.8)' : 'rgba(71,85,105,0.95)';
  const gridColor = dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.07)';

  const hourOf = (iso) => { const d = new Date(iso); return d.getHours() + d.getMinutes() / 60; };
  const metricKeys = CHECKIN_METRICS.filter((m) => state.metrics.has(m.key));

  // Tutti i check-in del giorno, ordinati per ora.
  const checkins = [];
  for (const b of bundles) for (const c of b.checkins) checkins.push(c);
  checkins.sort((a, b) => new Date(a.at) - new Date(b.at));

  // Firma: con una sola metrica la curva è l'eroe → area sfumata sotto la linea.
  const single = metricKeys.length === 1;
  const datasets = metricKeys.map((m) => ({
    label: m.label,
    data: checkins.map((c) => ({ x: hourOf(c.at), y: c[m.key] })).filter((p) => typeof p.y === 'number'),
    borderColor: m.color,
    backgroundColor: single
      ? (ctx) => { const { chart } = ctx; const { ctx: c, chartArea } = chart; if (!chartArea) return hexAlpha(m.color, 0.15); const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom); g.addColorStop(0, hexAlpha(m.color, 0.32)); g.addColorStop(1, hexAlpha(m.color, 0)); return g; }
      : m.color,
    fill: single ? 'origin' : false,
    tension: 0.35, borderWidth: 2.5,
    pointRadius: 3, pointHoverRadius: 6, pointBackgroundColor: m.color, pointBorderColor: dark ? '#1e293b' : '#fff', pointBorderWidth: 1.5, spanGaps: true,
  }));

  // Linee verticali: dosi (primario) e marcatori.
  const lines = [];
  bundles.forEach((b) => {
    lines.push({ hour: hourOf(b.dose.takenAt), color: PALETTE[0], label: '💊', text: `Dose ${b.dose.doseMg}mg`, strong: true });
    const mk = b.dose.markers || {};
    for (const def of MARKERS) if (mk[def.key]) lines.push({ hour: hourOf(mk[def.key]), color: '#94a3b8', label: def.icon, text: def.label });
  });

  const allHours = [...checkins.map((c) => hourOf(c.at)), ...lines.map((l) => l.hour)];
  const minH = allHours.length ? Math.max(0, Math.floor(Math.min(...allHours)) - 1) : 6;
  const maxH = allHours.length ? Math.min(24, Math.ceil(Math.max(...allHours)) + 1) : 22;

  const verticalLines = {
    id: 'dayLines',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      ctx.save();
      for (const l of chart.options.plugins.dayLines.items) {
        const x = scales.x.getPixelForValue(l.hour);
        if (x < chartArea.left || x > chartArea.right) continue;
        ctx.beginPath(); ctx.setLineDash(l.strong ? [] : [4, 4]); ctx.strokeStyle = l.color;
        ctx.globalAlpha = l.strong ? 0.6 : 0.45; ctx.lineWidth = l.strong ? 2 : 1.5;
        ctx.moveTo(x, chartArea.top + 8); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
        ctx.globalAlpha = 1; ctx.setLineDash([]);
        ctx.fillStyle = l.color; ctx.font = '600 11px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(l.label, x, chartArea.top);
      }
      ctx.restore();
    },
  };

  const fmtH = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

  dayChart = new Chart(canvas, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 350 },
      interaction: { mode: 'nearest', intersect: false },
      layout: { padding: { top: 8 } },
      scales: {
        x: { type: 'linear', min: minH, max: maxH, title: { display: true, text: 'Ora del giorno', color: tickColor },
          ticks: { stepSize: 1, color: tickColor, callback: (v) => fmtH(v) }, grid: { color: gridColor } },
        y: { min: 0, max: 10, title: { display: true, text: 'Valore (0–10)', color: tickColor }, ticks: { color: tickColor, stepSize: 2 }, grid: { color: gridColor } },
      },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: tickColor, usePointStyle: true, boxWidth: 8, padding: 14 } },
        dayLines: { items: lines },
        tooltip: { callbacks: { title: (items) => fmtH(items[0].parsed.x), label: (item) => `${item.dataset.label}: ${item.parsed.y}` } },
      },
    },
    plugins: [verticalLines],
  });
}
