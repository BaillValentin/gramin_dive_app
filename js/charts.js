/**
 * Chart.js dive profile and ascent rate charts.
 * Features: zoom, synced cursors, dual-cursor measurement, speed coloring.
 */

let depthChart = null;
let ascentChart = null;
let currentDive = null;

// Dual cursor state
let cursor1Idx = null;
let cursor2Idx = null;
let dualMode = false;

// --- Ascent rate color helper ---
function speedColor(mpm) {
  if (mpm == null) return '#8899aa';
  const abs = Math.abs(mpm);
  if (abs > 12) return '#ef476f';
  if (abs > 9) return '#ff6b35';
  if (abs > 6) return '#ffd166';
  return '#06d6a0';
}

// --- Segment color plugin for depth line ---
function buildSegmentColors(ascentRates) {
  return {
    borderColor: ctx => {
      const idx = ctx.p0DataIndex;
      const r = ascentRates[idx];
      return speedColor(r != null ? r * 60 : null);
    },
  };
}

// --- Vertical line plugin (crosshair) ---
const crosshairPlugin = {
  id: 'crosshairLine',
  afterDraw(chart) {
    const actives = chart.getActiveElements();
    if (!actives.length) return;
    const { ctx, chartArea: { top, bottom } } = chart;
    const x = actives[0].element.x;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#ffffff40';
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.restore();

    // Draw dual cursor lines
    if (dualMode && cursor1Idx != null) {
      drawCursorLine(chart, cursor1Idx, '#ff6b35');
    }
    if (dualMode && cursor2Idx != null) {
      drawCursorLine(chart, cursor2Idx, '#00b4d8');
    }
  }
};

function drawCursorLine(chart, idx, color) {
  const meta = chart.getDatasetMeta(0);
  if (!meta.data[idx]) return;
  const { ctx, chartArea: { top, bottom } } = chart;
  const x = meta.data[idx].x;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bottom);
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.restore();
}

Chart.register(crosshairPlugin);

// --- Shared zoom options ---
function zoomOptions(otherChartGetter) {
  return {
    zoom: {
      wheel: { enabled: true },
      pinch: { enabled: true },
      mode: 'x',
      onZoom: ({ chart }) => {
        const other = otherChartGetter();
        if (other) {
          other.options.scales.x.min = chart.options.scales.x.min;
          other.options.scales.x.max = chart.options.scales.x.max;
          other.update('none');
        }
      },
    },
    pan: {
      enabled: true,
      mode: 'x',
      onPan: ({ chart }) => {
        const other = otherChartGetter();
        if (other) {
          other.options.scales.x.min = chart.options.scales.x.min;
          other.options.scales.x.max = chart.options.scales.x.max;
          other.update('none');
        }
      },
    },
  };
}

// --- Main render ---
export function renderCharts(dive) {
  destroyCharts();
  currentDive = dive;
  cursor1Idx = null;
  cursor2Idx = null;
  dualMode = false;

  const labels = dive.samples.map(s => {
    const m = Math.floor(s.elapsed / 60);
    const sec = s.elapsed % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  });

  const depths = dive.samples.map(s => s.depth ?? null);
  const ascentRates = dive.samples.map(s => s.ascentRate ?? null);

  // --- Depth profile ---
  const ctxDepth = document.getElementById('chart-depth').getContext('2d');
  const gradient = ctxDepth.createLinearGradient(0, 0, 0, 250);
  gradient.addColorStop(0, 'rgba(0, 180, 216, 0.1)');
  gradient.addColorStop(1, 'rgba(0, 180, 216, 0.5)');

  depthChart = new Chart(ctxDepth, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Profondeur (m)',
        data: depths,
        borderColor: '#00b4d8',
        backgroundColor: gradient,
        borderWidth: 2,
        fill: true,
        tension: 0.2,
        pointRadius: 0,
        pointHitRadius: 8,
        segment: {},  // will be set when color-by-speed is toggled
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: {
          reverse: true,
          beginAtZero: true,
          ticks: { color: '#8899aa' },
          grid: { color: '#ffffff10' },
        },
        x: {
          ticks: { color: '#8899aa', maxTicksLimit: 8 },
          grid: { color: '#ffffff10' },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#16213e',
          titleColor: '#00b4d8',
          bodyColor: '#e0e0e0',
          borderColor: '#00b4d8',
          borderWidth: 1,
          callbacks: {
            label: ctx => `${ctx.parsed.y?.toFixed(1)} m`,
          },
        },
        zoom: zoomOptions(() => ascentChart),
      },
    },
  });

  // --- Ascent rate chart ---
  const ctxAscent = document.getElementById('chart-ascent').getContext('2d');
  const ascentMpm = ascentRates.map(r => r != null ? r * 60 : null);
  const ascentColors = ascentMpm.map(mpm => speedColor(mpm));

  ascentChart = new Chart(ctxAscent, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Vitesse (m/min)',
        data: ascentMpm,
        backgroundColor: ascentColors,
        borderWidth: 0,
        barPercentage: 1.0,
        categoryPercentage: 1.0,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: {
          ticks: { color: '#8899aa' },
          grid: { color: '#ffffff10' },
        },
        x: {
          ticks: { color: '#8899aa', maxTicksLimit: 8 },
          grid: { display: false },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#16213e',
          bodyColor: '#e0e0e0',
          callbacks: {
            label: ctx => {
              const v = ctx.parsed.y;
              if (v == null) return '';
              return `${v.toFixed(1)} m/min`;
            },
            labelColor: ctx => ({
              borderColor: ascentColors[ctx.dataIndex],
              backgroundColor: ascentColors[ctx.dataIndex],
            }),
          },
        },
        zoom: zoomOptions(() => depthChart),
      },
    },
  });

  setupSync(dive, ascentRates);
  setupToggleColorSpeed(ascentRates);
  setupResetZoom();
  setupDualCursor(dive);
}

// --- Sync cursors between charts ---
function setupSync(dive, ascentRates) {
  const charts = [depthChart, ascentChart];

  charts.forEach((source, i) => {
    const target = charts[1 - i];
    const canvas = source.canvas;

    canvas.addEventListener('mousemove', e => {
      const items = source.getElementsAtEventForMode(e, 'index', { intersect: false }, false);
      if (items.length) {
        const idx = items[0].index;
        target.setActiveElements([{ datasetIndex: 0, index: idx }]);
        target.tooltip.setActiveElements([{ datasetIndex: 0, index: idx }], { x: 0, y: 0 });
        target.update('none');
        if (!dualMode) updateCursorInfo(dive.samples[idx]);
      }
    });

    canvas.addEventListener('mouseleave', () => {
      target.setActiveElements([]);
      target.tooltip.setActiveElements([], {});
      target.update('none');
    });

    // Touch: single finger = cursor, two fingers = dual cursor or pinch zoom
    canvas.addEventListener('touchmove', e => {
      if (e.touches.length === 1 && !dualMode) {
        const touch = e.touches[0];
        const fakeEvent = { clientX: touch.clientX, clientY: touch.clientY, native: e };
        const items = source.getElementsAtEventForMode(fakeEvent, 'index', { intersect: false }, false);
        if (items.length) {
          const idx = items[0].index;
          source.setActiveElements([{ datasetIndex: 0, index: idx }]);
          source.update('none');
          target.setActiveElements([{ datasetIndex: 0, index: idx }]);
          target.update('none');
          updateCursorInfo(dive.samples[idx]);
        }
      }
    });
  });
}

// --- Toggle color-by-speed on depth chart ---
function setupToggleColorSpeed(ascentRates) {
  const toggle = document.getElementById('toggle-color-speed');
  if (!toggle) return;

  toggle.addEventListener('change', () => {
    if (!depthChart) return;
    const ds = depthChart.data.datasets[0];
    if (toggle.checked) {
      ds.segment = buildSegmentColors(ascentRates);
      ds.borderColor = '#00b4d8'; // fallback
      ds.borderWidth = 3;
    } else {
      ds.segment = {};
      ds.borderColor = '#00b4d8';
      ds.borderWidth = 2;
    }
    depthChart.update();
  });
}

// --- Reset zoom ---
function setupResetZoom() {
  const btn = document.getElementById('btn-reset-zoom');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (depthChart) depthChart.resetZoom();
    if (ascentChart) ascentChart.resetZoom();
  });
}

// --- Dual cursor (2 fingers or click-click) ---
function setupDualCursor(dive) {
  const charts = [depthChart, ascentChart];

  // Click to place cursors
  charts.forEach(chart => {
    chart.canvas.addEventListener('click', e => {
      const items = chart.getElementsAtEventForMode(e, 'index', { intersect: false }, false);
      if (!items.length) return;
      const idx = items[0].index;

      if (cursor1Idx == null || (cursor1Idx != null && cursor2Idx != null)) {
        // Place first cursor (or reset both)
        cursor1Idx = idx;
        cursor2Idx = null;
        dualMode = true;
        updateDualCursorUI(dive);
      } else {
        // Place second cursor
        cursor2Idx = idx;
        updateDualCursorUI(dive);
      }
      depthChart.update('none');
      ascentChart.update('none');
    });

    // Two-finger touch = dual cursors
    chart.canvas.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        e.preventDefault();
        dualMode = true;
        updateTwoFingerCursors(chart, e, dive);
      }
    }, { passive: false });

    chart.canvas.addEventListener('touchmove', e => {
      if (e.touches.length === 2) {
        e.preventDefault();
        updateTwoFingerCursors(chart, e, dive);
      }
    }, { passive: false });

    chart.canvas.addEventListener('touchend', e => {
      if (e.touches.length < 2 && dualMode && cursor1Idx != null && cursor2Idx != null) {
        // Keep dual display, user can tap to clear
      }
    });
  });

  // Double-click to clear dual mode
  charts.forEach(chart => {
    chart.canvas.addEventListener('dblclick', () => {
      cursor1Idx = null;
      cursor2Idx = null;
      dualMode = false;
      document.getElementById('cursor-single').classList.remove('hidden');
      document.getElementById('cursor-dual').classList.add('hidden');
      depthChart.update('none');
      ascentChart.update('none');
    });
  });
}

function updateTwoFingerCursors(chart, e, dive) {
  const t1 = e.touches[0], t2 = e.touches[1];
  const fake1 = { clientX: t1.clientX, clientY: t1.clientY, native: e };
  const fake2 = { clientX: t2.clientX, clientY: t2.clientY, native: e };
  const items1 = chart.getElementsAtEventForMode(fake1, 'index', { intersect: false }, false);
  const items2 = chart.getElementsAtEventForMode(fake2, 'index', { intersect: false }, false);
  if (items1.length) cursor1Idx = items1[0].index;
  if (items2.length) cursor2Idx = items2[0].index;
  updateDualCursorUI(dive);
  depthChart.update('none');
  ascentChart.update('none');
}

function updateDualCursorUI(dive) {
  const singleEl = document.getElementById('cursor-single');
  const dualEl = document.getElementById('cursor-dual');

  if (cursor1Idx != null && cursor2Idx == null) {
    // Only one cursor placed — show single info
    singleEl.classList.remove('hidden');
    dualEl.classList.add('hidden');
    updateCursorInfo(dive.samples[cursor1Idx]);
    return;
  }

  if (cursor1Idx == null || cursor2Idx == null) return;

  singleEl.classList.add('hidden');
  dualEl.classList.remove('hidden');

  const s1 = dive.samples[Math.min(cursor1Idx, cursor2Idx)];
  const s2 = dive.samples[Math.max(cursor1Idx, cursor2Idx)];

  const fmt = s => {
    const m = Math.floor(s.elapsed / 60);
    const sec = s.elapsed % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  document.getElementById('dual-t1').innerHTML = `<small>T1</small>${fmt(s1)}`;
  document.getElementById('dual-d1').innerHTML = `<small>D1</small>${s1.depth?.toFixed(1) ?? '—'} m`;
  document.getElementById('dual-t2').innerHTML = `<small>T2</small>${fmt(s2)}`;
  document.getElementById('dual-d2').innerHTML = `<small>D2</small>${s2.depth?.toFixed(1) ?? '—'} m`;

  const dt = Math.abs(s2.elapsed - s1.elapsed);
  const dd = Math.abs((s2.depth ?? 0) - (s1.depth ?? 0));
  const avgSpeed = dt > 0 ? (dd / dt) * 60 : 0;

  const dtMin = Math.floor(dt / 60);
  const dtSec = dt % 60;

  document.getElementById('dual-dt').innerHTML = `<small>&Delta;T</small>${dtMin}:${dtSec.toString().padStart(2, '0')}`;
  document.getElementById('dual-dd').innerHTML = `<small>&Delta;D</small>${dd.toFixed(1)} m`;
  document.getElementById('dual-speed').innerHTML = `<small>V moy</small>${avgSpeed.toFixed(1)} m/min`;
}

// --- Single cursor info ---
function updateCursorInfo(sample) {
  const m = Math.floor(sample.elapsed / 60);
  const s = sample.elapsed % 60;

  document.getElementById('cursor-time').innerHTML =
    `<small>Temps</small>${m}:${s.toString().padStart(2, '0')}`;
  document.getElementById('cursor-depth').innerHTML =
    `<small>Prof.</small>${sample.depth != null ? sample.depth.toFixed(1) + ' m' : '—'}`;
  document.getElementById('cursor-temp').innerHTML =
    `<small>Temp.</small>${sample.temperature != null ? sample.temperature + ' °C' : '—'}`;
  document.getElementById('cursor-ascent-rate').innerHTML =
    `<small>Vitesse</small>${sample.ascentRate != null ? (sample.ascentRate * 60).toFixed(1) + ' m/min' : '—'}`;
}

export function destroyCharts() {
  if (depthChart) { depthChart.destroy(); depthChart = null; }
  if (ascentChart) { ascentChart.destroy(); ascentChart = null; }
  currentDive = null;
  cursor1Idx = null;
  cursor2Idx = null;
  dualMode = false;
}
