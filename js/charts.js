/**
 * Chart.js dive profile and ascent rate charts.
 * Interaction: swipe/pinch = pan/zoom, long-press = temporary cursor.
 * 1-finger long-press = single cursor (disappears on release).
 * 2-finger long-press = dual cursor (disappears on release).
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
const LONG_PRESS_MS = 350;
const MOVE_THRESHOLD = 10;
let longPressTimer = null;
let touchStartX = 0;
let touchStartY = 0;
let longPressActive = false;
let activeTouchChart = null; // which chart canvas triggered the long-press

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

    // Hover crosshair (from active elements)
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

// --- Get data index from pixel X ---
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
    enabled: true,
    backgroundColor: '#16213e',
    titleColor: '#00b4d8',
    bodyColor: '#e0e0e0',
    borderColor: '#00b4d8',
    borderWidth: 1,
    callbacks: {
      label: ctx => `${ctx.parsed.y?.toFixed(1)} m`,
    },
  };
}

function ascentTooltipConfig() {
  return {
    enabled: true,
    backgroundColor: '#16213e',
    bodyColor: '#e0e0e0',
    borderColor: '#ff6b35',
    borderWidth: 1,
    callbacks: {
      label: ctx => {
        const v = ctx.parsed.y;
        if (v == null) return '';
        return `${v.toFixed(1)} m/min`;
      },
    },
  };
}

// --- Show synced tooltips on both charts at given index ---
function showSyncedTooltips(idx) {
  [depthChart, ascentChart].forEach(chart => {
    if (!chart) return;
    const el = [{ datasetIndex: 0, index: idx }];
    chart.setActiveElements(el);
    chart.tooltip.setActiveElements(el, { x: 0, y: 0 });
    chart.update('none');
  });
}

function hideSyncedTooltips() {
  [depthChart, ascentChart].forEach(chart => {
    if (!chart) return;
    chart.setActiveElements([]);
    chart.tooltip.setActiveElements([], { x: 0, y: 0 });
    chart.update('none');
  });
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

  allLabels = dive.samples.map((s, i) => i);
  const displayLabels = dive.samples.map(s => {
    const m = Math.floor(s.elapsed / 60);
    const sec = s.elapsed % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  });

  allDepths = dive.samples.map(s => s.depth ?? null);
  allAscentRates = dive.samples.map(s => s.ascentRate ?? null);
  allAscentMpm = allAscentRates.map(r => r != null ? r * 60 : null);
  allAscentColors = allAscentMpm.map(mpm => speedColor(mpm));

  const xScaleConfig = (gridVisible) => ({
    type: 'linear',
    ticks: {
      color: '#8899aa',
      maxTicksLimit: 8,
      callback: (val) => {
        const i = Math.round(val);
        return i >= 0 && i < displayLabels.length ? displayLabels[i] : '';
      }
    },
    grid: gridVisible ? { color: '#ffffff10' } : { display: false },
    min: 0,
    max: allLabels.length - 1,
  });

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
        x: xScaleConfig(true),
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
        x: xScaleConfig(false),
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

// --- Touch interaction ---
function setupTouchInteraction(dive) {
  [depthChart, ascentChart].forEach(chart => {
    const canvas = chart.canvas;

    canvas.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        // Two fingers down — check if it could be a dual-cursor long press
        // Cancel any single-finger long press
        cancelLongPress();

        const t0 = e.touches[0];
        const t1 = e.touches[1];
        touchStartX = (t0.clientX + t1.clientX) / 2;
        touchStartY = (t0.clientY + t1.clientY) / 2;
        longPressActive = false;
        activeTouchChart = chart;

        longPressTimer = setTimeout(() => {
          longPressActive = true;
          activeTouchChart = chart;

          // Disable pan/zoom while in cursor mode
          setPanEnabled(false);
          setZoomEnabled(false);

          const idx1 = getIndexFromX(chart, t0.clientX);
          const idx2 = getIndexFromX(chart, t1.clientX);

          if (idx1 != null && idx2 != null) {
            cursor1Idx = Math.min(idx1, idx2);
            cursor2Idx = Math.max(idx1, idx2);
            updateDualCursorUI(dive);
            updateCharts();
          }

          if (navigator.vibrate) navigator.vibrate(30);
        }, LONG_PRESS_MS);

        return;
      }

      // Single touch
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        longPressActive = false;
        activeTouchChart = chart;

        longPressTimer = setTimeout(() => {
          longPressActive = true;
          activeTouchChart = chart;

          setPanEnabled(false);

          const idx = getIndexFromX(chart, touch.clientX);
          if (idx != null) {
            cursor1Idx = idx;
            cursor2Idx = null;
            showSingleCursor();
            updateCursorInfo(dive.samples[idx]);
            showSyncedTooltips(idx);
            updateCharts();
          }

          if (navigator.vibrate) navigator.vibrate(30);
        }, LONG_PRESS_MS);
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', e => {
      if (!longPressActive) {
        // Check if moved too much — cancel long press
        if (e.touches.length >= 1) {
          const touch = e.touches[0];
          const dx = Math.abs(touch.clientX - touchStartX);
          const dy = Math.abs(touch.clientY - touchStartY);
          if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
            cancelLongPress();
          }
        }
        return;
      }

      // Long press active — drag cursor(s)
      e.preventDefault();

      if (cursor1Idx != null && cursor2Idx != null && e.touches.length === 2) {
        // Dual cursor drag
        const idx1 = getIndexFromX(activeTouchChart, e.touches[0].clientX);
        const idx2 = getIndexFromX(activeTouchChart, e.touches[1].clientX);
        if (idx1 != null) cursor1Idx = Math.min(idx1, idx2 ?? idx1);
        if (idx2 != null) cursor2Idx = Math.max(idx1 ?? idx2, idx2);
        updateDualCursorUI(dive);
        updateCharts();
      } else if (cursor1Idx != null && cursor2Idx == null && e.touches.length >= 1) {
        // Single cursor drag
        const idx = getIndexFromX(activeTouchChart, e.touches[0].clientX);
        if (idx != null) {
          cursor1Idx = idx;
          updateCursorInfo(dive.samples[idx]);
          showSyncedTooltips(idx);
          updateCharts();
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchend', e => {
      // If long press was never triggered, just cancel timer
      if (!longPressActive) {
        cancelLongPress();
        return;
      }

      // If all fingers lifted, clear everything
      if (e.touches.length === 0) {
        cursor1Idx = null;
        cursor2Idx = null;
        showSingleCursor();
        clearCursorDisplay();
        hideSyncedTooltips();
        updateCharts();

        longPressActive = false;
        activeTouchChart = null;
        setPanEnabled(true);
        setZoomEnabled(true);
      }
    }, { passive: true });
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

function setZoomEnabled(enabled) {
  [depthChart, ascentChart].forEach(c => {
    if (!c) return;
    c.options.plugins.zoom.zoom.pinch.enabled = enabled;
    c.options.plugins.zoom.zoom.wheel.enabled = enabled;
    c.update('none');
  });
}

// --- Mouse (desktop): synced tooltips on hover ---
function setupMouseInteraction(dive) {
  [depthChart, ascentChart].forEach(source => {
    const canvas = source.canvas;

    canvas.addEventListener('mousemove', e => {
      const idx = getIndexFromX(source, e.clientX);
      if (idx != null) {
        showSyncedTooltips(idx);
        updateCursorInfo(dive.samples[idx]);
      }
    });

    canvas.addEventListener('mouseleave', () => {
      hideSyncedTooltips();
      clearCursorDisplay();
    });
  });
}

// --- Helpers ---
function updateCharts() {
  if (depthChart) depthChart.update('none');
  if (ascentChart) ascentChart.update('none');
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
