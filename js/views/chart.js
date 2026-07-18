// views/chart.js — Vista 1: curva dell'effetto nel tempo.
// Asse X = ore dalla dose; sovrapponibili più dosi E più metriche; marcatori sulla curva.
// Usa Chart.js (globale window.Chart) + un piccolo plugin inline per le linee marcatore.

import { el, fmtDate, fmtTime, minutesBetween, hexAlpha, isDark } from '../util.js';
import { CHECKIN_METRICS, MARKERS } from '../defaults.js';
import { icon } from '../icons.js';
import { loadAllBundles } from '../stats.js';
import { nav } from '../nav.js';

// Colore per dose (serie), tratteggio per metrica.
const PALETTE = ['#4f46e5', '#0d9488', '#db2777', '#d97706', '#0891b2', '#7c3aed', '#dc2626', '#65a30d'];
const DASHES = [[], [7, 4], [2, 3], [9, 3, 2, 3]];

// Filtro per periodo della lista dosi: con mesi di dati la lista diventa
// chilometrica. Preset a un tocco (niente date da compilare a mano).
const PERIODS = [
  { key: '7', label: 'Ultima settimana', days: 7 },
  { key: '30', label: 'Ultimo mese', days: 30 },
  { key: '90', label: 'Ultimi 3 mesi', days: 90 },
  { key: 'all', label: 'Tutte', days: null },
];

// Stato locale della vista (persistente finché l'app è aperta).
const viewState = { metrics: null, selected: null, period: '30' };

let chartInstance = null;

export async function renderChart() {
  const bundles = await loadAllBundles();
  const withData = bundles.filter((b) => b.checkins.length > 0 || (b.dose.markers && Object.keys(b.dose.markers).length));

  const root = el('div', { class: 'view view-chart' });

  if (!withData.length) {
    root.append(el('div', { class: 'empty-hint' },
      el('div', { class: 'empty-ico' }, icon('curve', { size: 40, stroke: 1.5 })),
      'Ancora niente da confrontare. Registra una dose e qualche voce "come mi sento", poi torna qui.'));
    return root;
  }

  if (viewState.metrics === null) viewState.metrics = new Set(['intensity']);

  // Dosi nel periodo scelto (le liste arrivano già dalla più recente).
  const period = PERIODS.find((p) => p.key === viewState.period) || PERIODS[PERIODS.length - 1];
  const cutoff = period.days == null ? null : Date.now() - period.days * 24 * 3600 * 1000;
  const inPeriod = cutoff == null ? withData : withData.filter((b) => new Date(b.dose.takenAt).getTime() >= cutoff);

  if (viewState.selected === null) viewState.selected = new Set((inPeriod.length ? inPeriod : withData).slice(0, 2).map((b) => b.dose.id));

  // In lista: le dosi del periodo + quelle già selezionate anche se fuori
  // periodo (così si possono sempre togliere). Colore stabile per dose.
  const listed = withData.filter((b) => inPeriod.includes(b) || viewState.selected.has(b.dose.id));
  const colorIdx = new Map(withData.map((b, i) => [b.dose.id, i]));

  // Selettore metriche (multi-selezione)
  const metricBar = el('div', { class: 'chip-bar' });
  for (const m of CHECKIN_METRICS) {
    metricBar.append(el('button', {
      class: 'chip' + (viewState.metrics.has(m.key) ? ' chip-on' : ''),
      onClick: () => {
        if (viewState.metrics.has(m.key)) {
          if (viewState.metrics.size > 1) viewState.metrics.delete(m.key); // tieni sempre ≥1
        } else viewState.metrics.add(m.key);
        redraw();
      },
    }, m.label));
  }

  const canvasWrap = el('div', { class: 'chart-wrap' }, el('canvas', { id: 'effect-chart' }));

  // Filtro per periodo (chips, un tocco). Cambiarlo ricostruisce la lista.
  const periodBar = el('div', { class: 'chip-bar' });
  for (const p of PERIODS) {
    periodBar.append(el('button', {
      class: 'chip chip-sm' + (p.key === period.key ? ' chip-on' : ''),
      onClick: () => { if (viewState.period !== p.key) { viewState.period = p.key; nav.refresh(); } },
    }, p.label));
  }

  // Selettore dosi da sovrapporre
  const doseList = el('div', { class: 'dose-select' });
  for (const b of listed) {
    const id = b.dose.id;
    const color = PALETTE[colorIdx.get(id) % PALETTE.length];
    const checked = viewState.selected.has(id);
    doseList.append(el('label', { class: 'dose-select-item' },
      el('input', {
        type: 'checkbox', ...(checked ? { checked: 'checked' } : {}),
        onChange: (e) => {
          if (e.target.checked) viewState.selected.add(id); else viewState.selected.delete(id);
          redraw();
        },
      }),
      el('span', { class: 'dose-swatch', style: `background:${color}` }),
      el('span', {}, `${fmtDate(b.dose.takenAt)} ${fmtTime(b.dose.takenAt)} · ${b.dose.doseMg}mg`),
    ));
  }
  if (!listed.length) {
    doseList.append(el('p', { class: 'form-hint' }, 'Nessuna dose nel periodo scelto: allarga il periodo qui sopra.'));
  }

  root.append(
    el('p', { class: 'view-title' }, 'Curva dell\'effetto'),
    el('p', { class: 'form-hint' }, 'Scegli una o più metriche e una o più dosi da confrontare.'),
    metricBar,
    canvasWrap,
    el('p', { class: 'form-section' }, 'Dosi da confrontare'),
    periodBar,
    doseList,
  );

  setTimeout(() => buildChart(withData), 0);

  function redraw() {
    [...metricBar.children].forEach((c, idx) => c.classList.toggle('chip-on', viewState.metrics.has(CHECKIN_METRICS[idx].key)));
    buildChart(withData);
  }

  return root;
}

function buildChart(bundles) {
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  const canvas = document.getElementById('effect-chart');
  if (!canvas || !window.Chart) return;

  const dark = isDark();
  const tickColor = dark ? 'rgba(226,232,240,0.8)' : 'rgba(71,85,105,0.95)';
  const gridColor = dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.07)';

  const metricKeys = CHECKIN_METRICS.filter((m) => viewState.metrics.has(m.key));
  const selectedBundles = bundles.filter((b) => viewState.selected.has(b.dose.id));
  const multiDose = selectedBundles.length > 1;
  const multiMetric = metricKeys.length > 1;
  const single = selectedBundles.length === 1 && metricKeys.length === 1; // curva-eroe

  const datasets = [];
  const markerItems = [];

  bundles.forEach((b, i) => {
    if (!viewState.selected.has(b.dose.id)) return;
    const color = PALETTE[i % PALETTE.length];

    metricKeys.forEach((metric, mi) => {
      const points = b.checkins
        .map((c) => ({ x: minutesBetween(b.dose.takenAt, c.at) / 60, y: c[metric.key] }))
        .filter((p) => typeof p.y === 'number')
        .sort((a, b2) => a.x - b2.x);
      if (!points.length) return;

      let label;
      if (multiDose && multiMetric) label = `${metric.label} · ${fmtDate(b.dose.takenAt)}`;
      else if (multiMetric) label = metric.label;
      else label = `${fmtDate(b.dose.takenAt)} ${fmtTime(b.dose.takenAt)}`;

      datasets.push({
        label,
        data: points,
        borderColor: color,
        backgroundColor: single
          ? (cx) => { const { chart } = cx; const { ctx: c, chartArea } = chart; if (!chartArea) return hexAlpha(color, 0.15); const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom); g.addColorStop(0, hexAlpha(color, 0.32)); g.addColorStop(1, hexAlpha(color, 0)); return g; }
          : color,
        fill: single ? 'origin' : false,
        borderDash: DASHES[mi % DASHES.length],
        tension: 0.35,
        borderWidth: 2.5,
        pointRadius: 3,
        pointHoverRadius: 6,
        pointBackgroundColor: color,
        pointBorderColor: dark ? '#1e293b' : '#fff',
        pointBorderWidth: 1.5,
        spanGaps: true,
      });
    });

    // Marcatori della dose come linee verticali (una volta per dose).
    const mk = b.dose.markers || {};
    for (const def of MARKERS) {
      if (mk[def.key]) {
        markerItems.push({
          hours: minutesBetween(b.dose.takenAt, mk[def.key]) / 60,
          color, label: def.icon, title: def.label,
        });
      }
    }
  });

  const markerLinesPlugin = {
    id: 'markerLines',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const items = chart.options.plugins.markerLines.items || [];
      ctx.save();
      for (const it of items) {
        const x = scales.x.getPixelForValue(it.hours);
        if (x < chartArea.left || x > chartArea.right) continue;
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = it.color;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1.5;
        ctx.moveTo(x, chartArea.top + 6);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
        ctx.fillStyle = it.color;
        ctx.font = '600 11px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(it.label, x, chartArea.top);
      }
      ctx.restore();
    },
  };

  const yTitle = metricKeys.length === 1 ? `${metricKeys[0].label} (0–10)` : 'Valore (0–10)';

  chartInstance = new Chart(canvas, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 350 },
      interaction: { mode: 'nearest', intersect: false },
      layout: { padding: { top: 8 } },
      scales: {
        x: {
          type: 'linear', min: 0, suggestedMax: 6,
          title: { display: true, text: 'Ore dalla dose', color: tickColor },
          ticks: { stepSize: 1, color: tickColor },
          grid: { color: gridColor },
        },
        y: {
          min: 0, max: 10,
          title: { display: true, text: yTitle, color: tickColor },
          ticks: { color: tickColor, stepSize: 2 },
          grid: { color: gridColor },
        },
      },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: tickColor, usePointStyle: true, boxWidth: 8, padding: 14 } },
        markerLines: { items: markerItems },
        tooltip: {
          callbacks: {
            title: (items) => `${items[0].parsed.x.toFixed(1)} h dalla dose`,
            label: (item) => `${item.dataset.label}: ${item.parsed.y}`,
          },
        },
      },
    },
    plugins: [markerLinesPlugin],
  });
}
