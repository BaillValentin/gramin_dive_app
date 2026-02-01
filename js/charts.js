/**
 * Chart.js dive profile and ascent rate charts.
 * Touch: long-press for cursors, pinch to zoom, normal swipe scrolls page.
 */

let depthChart = null;
let ascentChart = null;
let currentDive = null;

// Cursor state
let cursor1Idx = null;
let cursor2Idx = null;
let dualMode = false;

// Long-press state (per canvas)
const LONG_PRESS_MS = 400;
let longPressTimer = null;
let longPressActive = false;  // true once long press triggered
let longPressCanvas = null;

function speedColor(mpm) {
  if (mpm == null) return '#8899aa';
  const abs = Math.abs(mpm);
  if (abs > 12) return '#ef476f';
  if (abs > 9) return '#ff6b35';
  if (abs > 6) return '#ffd166';
  return '#06d6a0';
}

function buildSegmentColors(ascentRates) {
  return {
    borderColor: ctx => {
      const idx = ctx.p0DataIndex;
      const r = ascentRates[idx];
      return speedColor(r != null ? r * 60 : null);
    },
  };
}

// --- Crosshair + dual cursor lines plugin ---
const crosshairPlugin = {
  id: 'crosshairLine',
  afterDraw(chart) {
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    const { top, bottom } = chartArea;

    // Active element crosshair
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

    // Dual cursor lines
    if (cursor1Idx != null) drawCursorLine(chart, cursor1Idx, '#ff6b35');
    if (cursor2Idx != null) drawCursorLine(chart, cursor2Idx, '#00b4d8');
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

// --- Zoom options (synced) ---
function zoomOptions(otherChartGetter) {
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

// --- Main render ---
export function renderCharts(dive) {
  destroyCharts();
  currentDive = dive;
  cursor1Idx = null;
  cursor2Idx = null;
  dualMode = false;
  showSingleCursor();

  const labels = dive.samples.map(s => {
    const m = Math.floor(s.elapsed / 60);
    const sec = s.elapsed % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  });

  const depths = dive.samples.map(s => s.depth ?? null);
  const ascentRates = dive.samples.map(s => s.ascentRate ?? null);

  // --- Depth chart ---
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
        segment: {},
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
        tooltip: { enabled: false },
        zoom: zoomOptions(() => ascentChart),
      },
      // Disable default chart.js touch handling for events — we manage it
      events: ['mousemove', 'mouseout', 'click'],
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
        tooltip: { enabled: false },
        zoom: zoomOptions(() => depthChart),
      },
      events: ['mousemove', 'mouseout', 'click'],
    },
  });

  setupMouseSync(dive);
  setupTouchInteraction(dive);
  setupToggleColorSpeed(ascentRates);
  setupResetZoom();
}

// --- Mouse sync (desktop) ---
function setupMouseSync(dive) {
  [depthChart, ascentChart].forEach((source, i) => {
    const target = [depthChart, ascentChart][1 - i];
    const canvas = source.canvas;

    canvas.addEventListener('mousemove', e => {
      const items = source.getElementsAtEventForMode(e, 'index', { intersect: false }, false);
      if (items.length) {
        const idx = items[0].index;
        source.setActiveElements([{ datasetIndex: 0, index: idx }]);
        source.update('none');
        target.setActiveElements([{ datasetIndex: 0, index: idx }]);
        target.update('none');
        if (!dualMode) updateCursorInfo(dive.samples[idx]);
      }
    });

    canvas.addEventListener('mouseleave', () => {
      source.setActiveElements([]);
      source.update('none');
      target.setActiveElements([]);
      target.update('none');
    });

    // Desktop click for dual cursors
    canvas.addEventListener('click', e => {
      const items = source.getElementsAtEventForMode(e, 'index', { intersect: false }, false);
      if (!items.length) return;
      const idx = items[0].index;
      placeCursor(idx, dive);
    });

    // Double-click to clear
    canvas.addEventListener('dblclick', () => clearCursors());
  });
}

// --- Touch interaction (mobile) ---
function setupTouchInteraction(dive) {
  [depthChart, ascentChart].forEach(chart => {
    const canvas = chart.canvas;
    let startTouch = null;
    let moved = false;

    canvas.addEventListener('touchstart', e => {
      moved = false;
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        startTouch = { x: touch.clientX, y: touch.clientY };

        // Start long-press timer
        cancelLongPress();
        longPressTimer = setTimeout(() => {
          longPressActive = true;
          longPressCanvas = canvas;
          // Vibration feedback if available
          if (navigator.vibrate) navigator.vibrate(30);
          // Place/update cursor at current position
          const idx = getIndexFromTouch(chart, touch);
          if (idx != null) {
            if (cursor1Idx == null || (cursor1Idx != null && cursor2Idx != null)) {
              cursor1Idx = idx;
              cursor2Idx = null;
              dualMode = false;
            }
            updateSyncedActive(idx);
            updateCursorInfo(dive.samples[idx]);
            showSingleCursor();
          }
          // Prevent page scroll while in long-press mode
          canvas.style.touchAction = 'none';
        }, LONG_PRESS_MS);
      }

      if (e.touches.length === 2 && longPressActive) {
        // Second finger while in long-press = dual cursor
        e.preventDefault();
        dualMode = true;
        const idx1 = getIndexFromTouch(chart, e.touches[0]);
        const idx2 = getIndexFromTouch(chart, e.touches[1]);
        if (idx1 != null) cursor1Idx = idx1;
        if (idx2 != null) cursor2Idx = idx2;
        updateDualCursorUI(dive);
        updateCharts();
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', e => {
      const touch = e.touches[0];

      // If not yet long-pressed, check movement to cancel
      if (!longPressActive && startTouch) {
        const dx = Math.abs(touch.clientX - startTouch.x);
        const dy = Math.abs(touch.clientY - startTouch.y);
        if (dx > 10 || dy > 10) {
          cancelLongPress();
          moved = true;
        }
        return; // Let page scroll naturally
      }

      // Long press active: track finger(s) for cursor(s)
      if (longPressActive) {
        e.preventDefault();

        if (e.touches.length === 1 && !dualMode) {
          const idx = getIndexFromTouch(chart, touch);
          if (idx != null) {
            cursor1Idx = idx;
            updateSyncedActive(idx);
            updateCursorInfo(dive.samples[idx]);
          }
        } else if (e.touches.length === 2) {
          dualMode = true;
          const idx1 = getIndexFromTouch(chart, e.touches[0]);
          const idx2 = getIndexFromTouch(chart, e.touches[1]);
          if (idx1 != null) cursor1Idx = idx1;
          if (idx2 != null) cursor2Idx = idx2;
          updateDualCursorUI(dive);
          updateCharts();
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchend', e => {
      cancelLongPress();

      if (longPressActive && e.touches.length === 0) {
        // Finger lifted — keep cursors visible, exit long-press mode
        longPressActive = false;
        longPressCanvas = null;
        canvas.style.touchAction = '';

        // Clear active elements but keep cursor lines
        depthChart.setActiveElements([]);
        depthChart.update('none');
        ascentChart.setActiveElements([]);
        ascentChart.update('none');
      }

      if (e.touches.length === 0 && !longPressActive) {
        canvas.style.touchAction = '';
      }
    });

    canvas.addEventListener('touchcancel', () => {
      cancelLongPress();
      longPressActive = false;
      longPressCanvas = null;
      canvas.style.touchAction = '';
    });
  });

  // Tap anywhere on the cursor-info panel to clear
  document.getElementById('cursor-info').addEventListener('click', () => {
    clearCursors();
  });
}

function getIndexFromTouch(chart, touch) {
  const rect = chart.canvas.getBoundingClientRect();
  const x = touch.clientX - rect.left;
  const y = touch.clientY - rect.top;
  const fakeEvent = { clientX: touch.clientX, clientY: touch.clientY, x, y, native: {} };
  const items = chart.getElementsAtEventForMode(fakeEvent, 'index', { intersect: false }, false);
  return items.length ? items[0].index : null;
}

function cancelLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function placeCursor(idx, dive) {
  if (cursor1Idx == null || (cursor1Idx != null && cursor2Idx != null)) {
    cursor1Idx = idx;
    cursor2Idx = null;
    dualMode = false;
    showSingleCursor();
    updateCursorInfo(dive.samples[idx]);
  } else {
    cursor2Idx = idx;
    dualMode = true;
    updateDualCursorUI(dive);
  }
  updateCharts();
}

function clearCursors() {
  cursor1Idx = null;
  cursor2Idx = null;
  dualMode = false;
  longPressActive = false;
  showSingleCursor();
  // Clear info display
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

function updateSyncedActive(idx) {
  const el = [{ datasetIndex: 0, index: idx }];
  depthChart.setActiveElements(el);
  depthChart.update('none');
  ascentChart.setActiveElements(el);
  ascentChart.update('none');
}

function updateCharts() {
  if (depthChart) depthChart.update('none');
  if (ascentChart) ascentChart.update('none');
}

// --- Dual cursor UI ---
function updateDualCursorUI(dive) {
  const singleEl = document.getElementById('cursor-single');
  const dualEl = document.getElementById('cursor-dual');

  if (cursor1Idx != null && cursor2Idx == null) {
    singleEl.classList.remove('hidden');
    dualEl.classList.add('hidden');
    updateCursorInfo(dive.samples[cursor1Idx]);
    return;
  }

  if (cursor1Idx == null || cursor2Idx == null) return;

  singleEl.classList.add('hidden');
  dualEl.classList.remove('hidden');

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
function setupToggleColorSpeed(ascentRates) {
  const toggle = document.getElementById('toggle-color-speed');
  if (!toggle) return;
  toggle.addEventListener('change', () => {
    if (!depthChart) return;
    const ds = depthChart.data.datasets[0];
    if (toggle.checked) {
      ds.segment = buildSegmentColors(ascentRates);
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

export function destroyCharts() {
  cancelLongPress();
  longPressActive = false;
  longPressCanvas = null;
  if (depthChart) { depthChart.destroy(); depthChart = null; }
  if (ascentChart) { ascentChart.destroy(); ascentChart = null; }
  currentDive = null;
  cursor1Idx = null;
  cursor2Idx = null;
  dualMode = false;
}
