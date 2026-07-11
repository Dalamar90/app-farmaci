// views/stats.js — Vista 3: statistiche riassuntive descrittive.
// Nessuna interpretazione medica: solo medie e osservazioni sui dati dell'utente.

import { el, fmtDuration } from '../util.js';
import { icon } from '../icons.js';
import { statsByMedication, sideEffectStats, sleepVsDurationObservation } from '../stats.js';

export async function renderStats() {
  const [byMed, sideFx, sleepObs] = await Promise.all([
    statsByMedication(), sideEffectStats(), sleepVsDurationObservation(),
  ]);

  const root = el('div', { class: 'view view-stats' });
  root.append(el('p', { class: 'view-title' }, 'Statistiche'));

  if (!byMed.length) {
    root.append(el('div', { class: 'empty-hint' },
      el('div', { class: 'empty-ico' }, icon('stats', { size: 40, stroke: 1.5 })),
      'Servono alcune dosi con marcatori e check-in per calcolare le statistiche.'));
    return root;
  }

  // Per farmaco
  for (const s of byMed) {
    root.append(el('div', { class: 'card' },
      el('h3', { class: 'card-title' }, `${s.medName} · ${s.doseCount} dose/i`),
      el('div', { class: 'stat-grid' },
        statBox('Durata media effetto', s.avgDuration != null ? fmtDuration(s.avgDuration) : '—'),
        statBox('Tempo medio all\'inizio', s.avgOnset != null ? fmtDuration(s.avgOnset) : '—'),
        statBox('Tempo medio al picco', s.avgPeakTime != null ? fmtDuration(s.avgPeakTime) : '—'),
        statBox('Intensità media di picco', s.avgPeakIntensity != null ? `${s.avgPeakIntensity}/10` : '—'),
        statBox('Durata media coda', s.avgCrashDuration != null ? fmtDuration(s.avgCrashDuration) : '—'),
      ),
    ));
  }

  // Effetti collaterali
  if (sideFx.length) {
    root.append(el('div', { class: 'card' },
      el('h3', { class: 'card-title' }, 'Effetti collaterali'),
      el('table', { class: 'stat-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Effetto'), el('th', {}, 'Volte'), el('th', {}, 'Intensità media'))),
        el('tbody', {}, ...sideFx.map((f) => el('tr', {},
          el('td', {}, f.name),
          el('td', {}, String(f.count)),
          el('td', {}, f.avgIntensity != null ? `${f.avgIntensity}/10` : '—'),
        ))),
      ),
    ));
  }

  // Osservazione descrittiva sonno vs durata
  if (sleepObs) {
    const diff = sleepObs.avgDurLowSleep != null && sleepObs.avgDurHighSleep != null;
    root.append(el('div', { class: 'card card-observation' },
      el('h3', { class: 'card-title' }, 'Osservazione (descrittiva)'),
      el('p', {}, `Su ${sleepObs.n} dosi con sonno e durata registrati (mediana ${sleepObs.median}h di sonno):`),
      el('ul', { class: 'obs-list' },
        el('li', {}, `Con meno sonno della mediana, durata media effetto: ${diff ? fmtDuration(sleepObs.avgDurLowSleep) : '—'}`),
        el('li', {}, `Con più sonno della mediana, durata media effetto: ${diff ? fmtDuration(sleepObs.avgDurHighSleep) : '—'}`),
      ),
      el('p', { class: 'obs-disclaimer' }, 'È solo una descrizione dei tuoi dati, non una relazione causale né un parere medico.'),
    ));
  }

  root.append(el('p', { class: 'legal-note' },
    'Le statistiche descrivono solo i dati che hai inserito. Non sono diagnosi né indicazioni terapeutiche.'));

  return root;
}

function statBox(label, value) {
  return el('div', { class: 'stat-box' },
    el('div', { class: 'stat-value' }, value),
    el('div', { class: 'stat-label' }, label),
  );
}
