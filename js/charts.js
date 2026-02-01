/**
 * Chart.js dive profile and ascent rate charts.
 * Manual zoom via buttons/slider. Touch: long-press for cursors.
 * No external plugins required (no Hammer.js, no chartjs-plugin-zoom).
 */

let depthChart = null;
let ascentChart = null;
let currentDive = null;

// Full data arrays (unsliced)
let allLabels = [];
let allDepths = [];
let allAscentMpm = [];
let allAscentColors = [];
let allAscentRates = []; // raw m/s for segment coloring

// Zoom state
let zoomStart = 0;
let zoomEnd = 0; // exclusive index into allLabels

// Cursor state (indices into the FULL data, not the sliced view)
let cursor1Idx = null;
let cursor2Idx = null;

// Long-press state
const LONG_PRESS_MS = 350;
let longPressTimer = null;
let longPressActive = false;

function speedColor(mpm) {
  if (mpm == null) return '#8899aa';
  const abs = Math.abs(mpm);
  if (abs > 12) return '#ef476f';
  if (abs > 9) return '#ff6b35';
  if (abs > 6) return '#ffd166';
  return '#06d6a0';
}

function buildSegmentColors() {
  return {
    borderColor: ctx => {
      const localIdx = ctx.p0DataIndex;
      const globalIdx = zoomStart + localIdx;
      const r = allAscentRates[globalIdx];
      return speedColor(r != null ? r * 60 : null);
    },
  };
}

// --- Crosshair + cursor lines plugin ---
const crosshairPlugin = {
  id: 'crosshairLine',
  afterDraw(chart) {
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    const { top, bottom } = chartArea;

    // Hover crosshair
    const actives = chart.getActiveElements();
    if (actives.length) {
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
    }

    // Cursor lines (convert global index to local)
    if (cursor1Idx != null) drawCursorLine(chart, cursor1Idx - zoomStart, '#ff6b35');
    if (cursor2Idx != null) drawCursorLine(chart, cursor2Idx - zoomStart, '#00b4d8');
  }
};

function drawCursorLine(chart, localIdx, color) {
  const meta = chart.getDatasetMeta(0);
  if (localIdx < 0 || localIdx >= meta.data.length) return;
  if (!meta.data[localIdx]) return;
  const { ctx, chartArea: { top, bottom } } = chart;
  const x = meta.data[localIdx].x;
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

// --- Get global data index from pixel X ---
function getGlobalIndexFromX(chart, clientX) {
  const rect = chart.canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const { left, right } = chart.chartArea;
  if (x < left || x > right) return null;

  const scale = chart.scales.x;
  const localIdx = Math.round(scale.getValueForPixel(x));
  const visibleLen = zoomEnd - zoomStart;
  if (localIdx < 0 || localIdx >= visibleLen) return null;
  return zoomStart + localIdx;
}

// --- Zoom logic (data slicing) ---
function applyZoom() {
  if (!depthChart || !ascentChart) return;
  const start = zoomStart;
  const end = zoomEnd;

  const slicedLabels = allLabels.slice(start, end);
  const slicedDepths = allDepths.slice(start, end);
  const slicedAscent = allAscentMpm.slice(start, end);
  const slicedAscentColors = allAscentColors.slice(start, end);

  depthChart.data.labels = slicedLabels;
  depthChart.data.datasets[0].data = slicedDepths;

  ascentChart.data.labels = slicedLabels;
  ascentChart.data.datasets[0].data = slicedAscent;
  ascentChart.data.datasets[0].backgroundColor = slicedAscentColors;

  depthChart.update('none');
  ascentChart.update('none');
}

function setupZoomControls() {
  const slider = document.getElementById('zoom-slider');
  const btnIn = document.getElementById('btn-zoom-in');
  const btnOut = document.getElementById('btn-zoom-out');
  const btnReset = document.getElementById('btn-zoom-reset');

  if (!slider) return;

  // Zoom level: 0 = full view, 100 = max zoom (show ~10% of data)
  let zoomLevel = 0;

  function applyFromSliderAndLevel() {
    const total = allLabels.length;
    if (total === 0) return;

    // Visible window size: from 100% down to 10%
    const fraction = 1 - (zoomLevel / 100) * 0.9;
    const windowSize = Math.max(10, Math.round(total * fraction));

    // Slider value determines the scroll position within the data
    const maxStart = total - windowSize;
    const start = Math.round((slider.value / 100) * maxStart);

    zoomStart = Math.max(0, start);
    zoomEnd = Math.min(total, zoomStart + windowSize);
    applyZoom();
  }

  slider.addEventListener('input', applyFromSliderAndLevel);

  btnIn.addEventListener('click', () => {
    zoomLevel = Math.min(100, zoomLevel + 15);
    applyFromSliderAndLevel();
  });

  btnOut.addEventListener('click', () => {
    zoomLevel = Math.max(0, zoomLevel - 15);
    applyFromSliderAndLevel();
  });

  btnReset.addEventListener('click', () => {
    zoomLevel = 0;
    slider.value = 0;
    zoomStart = 0;
    zoomEnd = allLabels.length;
    applyZoom();
  });

  // Store so we can access from pinch zoom
  slider._zoomLevel = () => zoomLevel;
  slider._setZoomLevel = v => { zoomLevel = v; };
  slider._applyFromSliderAndLevel = applyFromSliderAndLevel;
}

// --- Main render ---
export function renderCharts(dive) {
  destroyCharts();
  currentDive = dive;
  cursor1Idx = null;
  cursor2Idx = null;
  showSingleCursor();

  allLabels = dive.samples.map(s => {
    const m = Math.floor(s.elapsed / 60);
    const sec = s.elapsed % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  });

  allDepths = dive.samples.map(s => s.depth ?? null);
  allAscentRates = dive.samples.map(s => s.ascentRate ?? null);
  allAscentMpm = allAscentRates.map(r => r != null ? r * 60 : null);
  allAscentColors = allAscentMpm.map(mpm => speedColor(mpm));

  zoomStart = 0;
  zoomEnd = allLabels.length;

  // --- Depth chart ---
  const ctxDepth = document.getElementById('chart-depth').getContext('2d');
  const gradient = ctxDepth.createLinearGradient(0, 0, 0, 250);
  gradient.addColorStop(0, 'rgba(0, 180, 216, 0.1)');
  gradient.addColorStop(1, 'rgba(0, 180, 216, 0.5)');

  depthChart = new Chart(ctxDepth, {
    type: 'line',
    data: {
      labels: allLabels,
      datasets: [{
        label: 'Profondeur (m)',
        data: allDepths,
        borderColor: '#00b4d8',
        backgroundColor: gradient,
        borderWidth: 2,
        fill: true,
        tension: 0.2,
        pointRadius: 0,
        pointHitRadius: 8,
        segment: {},
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
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
        tooltip: { enabled: false },
      },
    },
  });

  // --- Ascent rate chart ---
  const ctxAscent = document.getElementById('chart-ascent').getContext('2d');

  ascentChart = new Chart(ctxAscent, {
    type: 'bar',
    data: {
      labels: allLabels,
      datasets: [{
        label: 'Vitesse (m/min)',
        data: allAscentMpm,
        backgroundColor: allAscentColors,
        borderWidth: 0,
        barPercentage: 1.0,
        categoryPercentage: 1.0,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
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
        tooltip: { enabled: false },
      },
    },
  });

  setupMouseSync(dive);
  setupTouchCursors(dive);
  setupToggleColorSpeed();
  setupZoomControls();
}

// --- Mouse (desktop) ---
function setupMouseSync(dive) {
  [depthChart, ascentChart].forEach((source, i) => {
    const canvas = source.canvas;

    canvas.addEventListener('mousemove', e => {
      const idx = getGlobalIndexFromX(source, e.clientX);
      if (idx != null) {
        setActiveOnBoth(idx);
        if (cursor2Idx == null) updateCursorInfo(dive.samples[idx]);
      }
    });

    canvas.addEventListener('mouseleave', () => {
      clearActiveOnBoth();
    });

    canvas.addEventListener('click', e => {
      const idx = getGlobalIndexFromX(source, e.clientX);
      if (idx != null) placeCursor(idx, dive);
    });

    canvas.addEventListener('dblclick', () => clearCursors());
  });
}

// --- Touch cursors via long press ---
function setupTouchCursors(dive) {
  [depthChart, ascentChart].forEach(chart => {
    const canvas = chart.canvas;
    let startX = 0, startY = 0;

    canvas.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) {
        cancelLongPress();
        return;
      }
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;

      cancelLongPress();
      longPressTimer = setTimeout(() => {
        longPressActive = true;
        if (navigator.vibrate) navigator.vibrate(30);

        const idx = getGlobalIndexFromX(chart, t.clientX);
        if (idx != null) {
          if (cursor1Idx != null && cursor2Idx != null) {
            cursor1Idx = idx;
            cursor2Idx = null;
          } else if (cursor1Idx == null) {
            cursor1Idx = idx;
          }
          setActiveOnBoth(idx);
          showSingleCursor();
          updateCursorInfo(dive.samples[idx]);
        }
      }, LONG_PRESS_MS);
    }, { passive: true });

    canvas.addEventListener('touchmove', e => {
      if (!longPressActive) {
        if (e.touches.length === 1) {
          const t = e.touches[0];
          if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) {
            cancelLongPress();
          }
        }
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (e.touches.length === 1) {
        const idx = getGlobalIndexFromX(chart, e.touches[0].clientX);
        if (idx != null) {
          cursor1Idx = idx;
          cursor2Idx = null;
          setActiveOnBoth(idx);
          showSingleCursor();
          updateCursorInfo(dive.samples[idx]);
        }
      } else if (e.touches.length === 2) {
        const idx1 = getGlobalIndexFromX(chart, e.touches[0].clientX);
        const idx2 = getGlobalIndexFromX(chart, e.touches[1].clientX);
        if (idx1 != null) cursor1Idx = idx1;
        if (idx2 != null) cursor2Idx = idx2;
        updateDualCursorUI(dive);
        updateCharts();
      }
    }, { passive: false });

    canvas.addEventListener('touchend', e => {
      cancelLongPress();
      if (longPressActive && e.touches.length === 0) {
        longPressActive = false;
        clearActiveOnBoth();
      }
    }, { passive: true });

    canvas.addEventListener('touchcancel', () => {
      cancelLongPress();
      longPressActive = false;
    });
  });

  document.getElementById('cursor-info').addEventListener('click', () => clearCursors());
}

// --- Helpers ---
function setActiveOnBoth(globalIdx) {
  const localIdx = globalIdx - zoomStart;
  if (localIdx < 0 || localIdx >= (zoomEnd - zoomStart)) return;
  const el = [{ datasetIndex: 0, index: localIdx }];
  if (depthChart) { depthChart.setActiveElements(el); depthChart.update('none'); }
  if (ascentChart) { ascentChart.setActiveElements(el); ascentChart.update('none'); }
}

function clearActiveOnBoth() {
  if (depthChart) { depthChart.setActiveElements([]); depthChart.update('none'); }
  if (ascentChart) { ascentChart.setActiveElements([]); ascentChart.update('none'); }
}

function updateCharts() {
  if (depthChart) depthChart.update('none');
  if (ascentChart) ascentChart.update('none');
}

function cancelLongPress() {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
}

function placeCursor(idx, dive) {
  if (cursor1Idx == null || (cursor1Idx != null && cursor2Idx != null)) {
    cursor1Idx = idx;
    cursor2Idx = null;
    showSingleCursor();
    updateCursorInfo(dive.samples[idx]);
  } else {
    cursor2Idx = idx;
    updateDualCursorUI(dive);
  }
  updateCharts();
}

function clearCursors() {
  cursor1Idx = null;
  cursor2Idx = null;
  longPressActive = false;
  showSingleCursor();
  document.getElementById('cursor-time').innerHTML = '<small>Temps</small>—';
  document.getElementById('cursor-depth').innerHTML = '<small>Prof.</small>—';
  document.getElementById('cursor-temp').innerHTML = '<small>Temp.</small>—';
  document.getElementById('cursor-ascent-rate').innerHTML = '<small>Vitesse</small>—';
  updateCharts();
}

function showSingleCursor() {
  document.getElementById('cursor-single').classList.remove('hidden');
  document.getElementById('cursor-dual').classList.add('hidden');
}

// --- Dual cursor UI ---
function updateDualCursorUI(dive) {
  if (cursor1Idx == null || cursor2Idx == null) return;

  document.getElementById('cursor-single').classList.add('hidden');
  document.getElementById('cursor-dual').classList.remove('hidden');

  const i1 = Math.min(cursor1Idx, cursor2Idx);
  const i2 = Math.max(cursor1Idx, cursor2Idx);
  const s1 = dive.samples[i1];
  const s2 = dive.samples[i2];

  const fmt = s => {
    const m = Math.floor(s.elapsed / 60);
    const sec = s.elapsed % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  document.getElementById('dual-t1').innerHTML = `<small>T1</small>${fmt(s1)}`;
  document.getElementById('dual-d1').innerHTML = `<small>D1</small>${s1.depth?.toFixed(1) ?? '—'} m`;
  document.getElementById('dual-t2').innerHTML = `<small>T2</small>${fmt(s2)}`;
  document.getElementById('dual-d2').innerHTML = `<small>D2</small>${s2.depth?.toFixed(1) ?? '—'} m`;

  const dt = s2.elapsed - s1.elapsed;
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

// --- Toggle color-by-speed ---
function setupToggleColorSpeed() {
  const toggle = document.getElementById('toggle-color-speed');
  if (!toggle) return;
  const legend = document.getElementById('speed-legend');
  toggle.addEventListener('change', () => {
    if (!depthChart) return;
    const ds = depthChart.data.datasets[0];
    if (toggle.checked) {
      ds.segment = buildSegmentColors();
      ds.borderWidth = 3;
      if (legend) legend.classList.remove('hidden');
    } else {
      ds.segment = {};
      ds.borderColor = '#00b4d8';
      ds.borderWidth = 2;
      if (legend) legend.classList.add('hidden');
    }
    depthChart.update();
  });
}

export function destroyCharts() {
  cancelLongPress();
  longPressActive = false;
  if (depthChart) { depthChart.destroy(); depthChart = null; }
  if (ascentChart) { ascentChart.destroy(); ascentChart = null; }
  currentDive = null;
  cursor1Idx = null;
  cursor2Idx = null;
  allLabels = [];
  allDepths = [];
  allAscentMpm = [];
  allAscentColors = [];
  allAscentRates = [];
}
