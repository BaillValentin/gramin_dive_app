/**
 * Chart.js dive profile and ascent rate charts.
 * Interaction: swipe/pinch = pan/zoom, long-press = place cursor.
 * Synced tooltips between both charts.
 */

let depthChart = null;
let ascentChart = null;
let currentDive = null;

let allLabels = [];
let allDepths = [];
let allAscentMpm = [];
let allAscentColors = [];
let allAscentRates = [];

// Cursor state
let cursor1Idx = null;
let cursor2Idx = null;

// Long-press detection
const LONG_PRESS_MS = 400;
const MOVE_THRESHOLD = 10;
let longPressTimer = null;
let touchStartX = 0;
let touchStartY = 0;
let longPressActive = false; // true once long-press fires
let draggingCursor = false;  // dragging cursor after long-press

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
      const r = allAscentRates[ctx.p0DataIndex];
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

    if (cursor1Idx != null) drawCursorLine(chart, cursor1Idx, '#ff6b35');
    if (cursor2Idx != null) drawCursorLine(chart, cursor2Idx, '#00b4d8');
  }
};

function drawCursorLine(chart, globalIdx, color) {
  const meta = chart.getDatasetMeta(0);
  if (!meta.data.length) return;

  // Find pixel X for global index via scale
  const scale = chart.scales.x;
  const x = scale.getPixelForValue(globalIdx);
  const { left, right } = chart.chartArea;
  if (x < left || x > right) return;

  const { ctx, chartArea: { top, bottom } } = chart;
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
function getIndexFromX(chart, clientX) {
  const rect = chart.canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const { left, right } = chart.chartArea;
  if (x < left || x > right) return null;
  const idx = Math.round(chart.scales.x.getValueForPixel(x));
  if (idx < 0 || idx >= allLabels.length) return null;
  return idx;
}

// --- Zoom plugin options (synced between charts) ---
function zoomPluginOptions(otherChartGetter) {
  return {
    zoom: {
      wheel: { enabled: true },
      pinch: { enabled: true },
      mode: 'x',
      onZoom: ({ chart }) => syncZoom(chart, otherChartGetter()),
    },
    pan: {
      enabled: true,
      mode: 'x',
      onPan: ({ chart }) => syncZoom(chart, otherChartGetter()),
    },
  };
}

function syncZoom(source, target) {
  if (!target) return;
  target.options.scales.x.min = source.options.scales.x.min;
  target.options.scales.x.max = source.options.scales.x.max;
  target.update('none');
}

// --- Tooltip config ---
function depthTooltipConfig() {
  return {
    enabled: false, // We handle display via cursor info bar
  };
}

function ascentTooltipConfig() {
  return {
    enabled: false,
  };
}

// --- Setup reset zoom button ---
function setupResetZoom() {
  const btn = document.getElementById('btn-reset-zoom');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (depthChart) depthChart.resetZoom();
    if (ascentChart) ascentChart.resetZoom();
  });
}

// --- Main render ---
export function renderCharts(dive) {
  destroyCharts();
  currentDive = dive;
  cursor1Idx = null;
  cursor2Idx = null;
  showSingleCursor();
  clearCursorDisplay();

  allLabels = dive.samples.map((s, i) => i); // numeric indices for proper zoom
  const displayLabels = dive.samples.map(s => {
    const m = Math.floor(s.elapsed / 60);
    const sec = s.elapsed % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  });

  allDepths = dive.samples.map(s => s.depth ?? null);
  allAscentRates = dive.samples.map(s => s.ascentRate ?? null);
  allAscentMpm = allAscentRates.map(r => r != null ? r * 60 : null);
  allAscentColors = allAscentMpm.map(mpm => speedColor(mpm));

  // Depth chart
  const ctxDepth = document.getElementById('chart-depth').getContext('2d');
  const gradient = ctxDepth.createLinearGradient(0, 0, 0, 190);
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
        y: { reverse: true, beginAtZero: true, ticks: { color: '#8899aa' }, grid: { color: '#ffffff10' } },
        x: {
          type: 'linear',
          ticks: {
            color: '#8899aa',
            maxTicksLimit: 8,
            callback: (val) => {
              const i = Math.round(val);
              return i >= 0 && i < displayLabels.length ? displayLabels[i] : '';
            }
          },
          grid: { color: '#ffffff10' },
          min: 0,
          max: allLabels.length - 1,
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: depthTooltipConfig(),
        zoom: zoomPluginOptions(() => ascentChart),
      },
    },
  });

  // Ascent rate chart
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
        y: { ticks: { color: '#8899aa' }, grid: { color: '#ffffff10' } },
        x: {
          type: 'linear',
          ticks: {
            color: '#8899aa',
            maxTicksLimit: 8,
            callback: (val) => {
              const i = Math.round(val);
              return i >= 0 && i < displayLabels.length ? displayLabels[i] : '';
            }
          },
          grid: { display: false },
          min: 0,
          max: allLabels.length - 1,
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: ascentTooltipConfig(),
        zoom: zoomPluginOptions(() => depthChart),
      },
    },
  });

  setupTouchInteraction(dive);
  setupMouseInteraction(dive);
  setupToggleColorSpeed();
  setupResetZoom();
}

// --- Touch: long-press for cursor, otherwise pan/zoom ---
function setupTouchInteraction(dive) {
  [depthChart, ascentChart].forEach(chart => {
    const canvas = chart.canvas;

    canvas.addEventListener('touchstart', e => {
      // Multi-touch = pinch zoom, let plugin handle
      if (e.touches.length > 1) {
        cancelLongPress();
        return;
      }

      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      longPressActive = false;
      draggingCursor = false;

      longPressTimer = setTimeout(() => {
        longPressActive = true;
        draggingCursor = true;

        // Disable pan while dragging cursor
        setPanEnabled(false);

        // Place cursor
        const idx = getIndexFromX(chart, touch.clientX);
        if (idx != null) {
          placeCursor(idx, dive);
        }

        // Haptic feedback if available
        if (navigator.vibrate) navigator.vibrate(30);
      }, LONG_PRESS_MS);
    }, { passive: true });

    canvas.addEventListener('touchmove', e => {
      if (e.touches.length > 1) {
        cancelLongPress();
        return;
      }

      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - touchStartX);
      const dy = Math.abs(touch.clientY - touchStartY);

      if (!longPressActive && (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD)) {
        // User is panning — cancel long-press
        cancelLongPress();
        return;
      }

      if (draggingCursor) {
        e.preventDefault();
        const idx = getIndexFromX(chart, touch.clientX);
        if (idx != null) {
          // If we have 2 cursors, move the nearest one
          if (cursor1Idx != null && cursor2Idx != null) {
            const d1 = Math.abs(idx - cursor1Idx);
            const d2 = Math.abs(idx - cursor2Idx);
            if (d1 <= d2) cursor1Idx = idx;
            else cursor2Idx = idx;
            updateDualCursorUI(dive);
          } else {
            cursor1Idx = idx;
            updateCursorInfo(dive.samples[idx]);
          }
          syncActiveOnBoth(idx);
          updateCharts();
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchend', () => {
      if (longPressTimer && !longPressActive) {
        // Short tap — do nothing special (let zoom plugin handle tap if needed)
        cancelLongPress();
      }

      if (draggingCursor) {
        draggingCursor = false;
        // Re-enable pan
        setPanEnabled(true);
      }

      longPressTimer = null;
      longPressActive = false;
      clearActiveOnBoth();
    }, { passive: true });
  });

  // Tap on cursor info bar to clear cursors
  document.getElementById('cursor-info').addEventListener('click', () => {
    clearCursors();
  });
}

function cancelLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function setPanEnabled(enabled) {
  [depthChart, ascentChart].forEach(c => {
    if (!c) return;
    c.options.plugins.zoom.pan.enabled = enabled;
    c.update('none');
  });
}

function placeCursor(idx, dive) {
  if (cursor1Idx == null) {
    // First cursor
    cursor1Idx = idx;
    showSingleCursor();
    updateCursorInfo(dive.samples[idx]);
  } else if (cursor2Idx == null) {
    // Second cursor
    cursor2Idx = idx;
    updateDualCursorUI(dive);
  } else {
    // Reset to new first cursor
    cursor1Idx = idx;
    cursor2Idx = null;
    showSingleCursor();
    updateCursorInfo(dive.samples[idx]);
  }
  syncActiveOnBoth(idx);
  updateCharts();
}

// --- Mouse (desktop) ---
function setupMouseInteraction(dive) {
  [depthChart, ascentChart].forEach(source => {
    const canvas = source.canvas;

    canvas.addEventListener('mousemove', e => {
      const idx = getIndexFromX(source, e.clientX);
      if (idx != null) {
        syncActiveOnBoth(idx);
        if (cursor1Idx == null) updateCursorInfo(dive.samples[idx]);
      }
    });

    canvas.addEventListener('mouseleave', () => clearActiveOnBoth());

    canvas.addEventListener('click', e => {
      const idx = getIndexFromX(source, e.clientX);
      if (idx == null) return;
      placeCursor(idx, dive);
    });

    canvas.addEventListener('dblclick', () => clearCursors());
  });
}

// --- Helpers ---
function syncActiveOnBoth(idx) {
  const el = [{ datasetIndex: 0, index: idx }];
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

function clearCursors() {
  cursor1Idx = null;
  cursor2Idx = null;
  showSingleCursor();
  clearCursorDisplay();
  updateCharts();
}

function clearCursorDisplay() {
  document.getElementById('cursor-time').innerHTML = '<small>Temps</small>—';
  document.getElementById('cursor-depth').innerHTML = '<small>Prof.</small>—';
  document.getElementById('cursor-temp').innerHTML = '<small>Temp.</small>—';
  document.getElementById('cursor-ascent-rate').innerHTML = '<small>Vitesse</small>—';
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

  document.getElementById('dual-t1').textContent = fmt(s1);
  document.getElementById('dual-d1').textContent = `${s1.depth?.toFixed(1) ?? '—'} m`;
  document.getElementById('dual-t2').textContent = fmt(s2);
  document.getElementById('dual-d2').textContent = `${s2.depth?.toFixed(1) ?? '—'} m`;

  const dt = s2.elapsed - s1.elapsed;
  const dd = Math.abs((s2.depth ?? 0) - (s1.depth ?? 0));
  const avgSpeed = dt > 0 ? (dd / dt) * 60 : 0;
  const dtMin = Math.floor(dt / 60);
  const dtSec = dt % 60;

  document.getElementById('dual-dt').textContent = `ΔT ${dtMin}:${dtSec.toString().padStart(2, '0')}`;
  document.getElementById('dual-dd').textContent = `ΔD ${dd.toFixed(1)} m`;
  document.getElementById('dual-speed').textContent = `V ${avgSpeed.toFixed(1)} m/min`;
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
