/**
 * Main app — navigation, file import, IndexedDB storage.
 */
import { extractDiveFromBuffer, formatDuration, formatDate } from './dive-data.js';
import { renderCharts, destroyCharts } from './charts.js';

// --- IndexedDB ---
const DB_NAME = 'garmin-dive';
const DB_VERSION = 1;
const STORE = 'dives';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDive(dive) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    // Serialize date
    const toSave = { ...dive, startDate: dive.startDate?.toISOString() };
    const req = store.add(toSave);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllDives() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const dives = req.result.map(d => ({
        ...d,
        startDate: d.startDate ? new Date(d.startDate) : null,
      }));
      resolve(dives);
    };
    req.onerror = () => reject(req.error);
  });
}

async function deleteDive(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- State ---
let dives = [];
let currentDive = null;

// --- DOM refs ---
const viewList = document.getElementById('view-list');
const viewDetail = document.getElementById('view-detail');
const diveListEl = document.getElementById('dive-list');
const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const btnBack = document.getElementById('btn-back');
const btnDelete = document.getElementById('btn-delete');
const headerTitle = document.getElementById('header-title');

// --- Navigation ---
function showList() {
  viewList.classList.remove('hidden');
  viewDetail.classList.add('hidden');
  btnBack.classList.add('hidden');
  headerTitle.textContent = 'Garmin Dive';
  destroyCharts();
  currentDive = null;
  renderDiveList();
}

function showDetail(dive) {
  currentDive = dive;
  viewList.classList.add('hidden');
  viewDetail.classList.remove('hidden');
  btnBack.classList.remove('hidden');
  headerTitle.textContent = formatDate(dive.startDate);
  renderSummary(dive);
  renderCharts(dive);
}

btnBack.addEventListener('click', showList);

// --- Render dive list ---
function renderDiveList() {
  diveListEl.innerHTML = '';
  if (dives.length === 0) {
    diveListEl.innerHTML = '<p style="text-align:center;color:#8899aa;padding:20px">Aucune plongée importée</p>';
    return;
  }

  // Sort by date descending
  const sorted = [...dives].sort((a, b) => (b.startDate || 0) - (a.startDate || 0));

  sorted.forEach(dive => {
    const el = document.createElement('div');
    el.className = 'dive-item';
    el.innerHTML = `
      <div class="dive-item-left">
        <h3>${formatDate(dive.startDate)}</h3>
        <p>${dive.samples?.length || 0} points</p>
      </div>
      <div class="dive-item-right">
        <div class="depth">${dive.maxDepth?.toFixed(1) || '—'} m</div>
        <div class="duration">${formatDuration(dive.totalTime)}</div>
      </div>
    `;
    el.addEventListener('click', () => showDetail(dive));
    diveListEl.appendChild(el);
  });
}

// --- Render summary ---
function renderSummary(dive) {
  const el = document.getElementById('dive-summary');
  const stats = [
    { label: 'Prof. max', value: `${dive.maxDepth?.toFixed(1) || '—'} m` },
    { label: 'Durée', value: formatDuration(dive.totalTime) },
    { label: 'Prof. moy.', value: dive.avgDepth ? `${dive.avgDepth.toFixed(1)} m` : '—' },
    { label: 'Temp. min', value: dive.minTemp != null ? `${dive.minTemp} °C` : '—' },
  ];

  el.innerHTML = stats.map(s => `
    <div>
      <div class="stat-label">${s.label}</div>
      <div class="stat-value">${s.value}</div>
    </div>
  `).join('');
}

// --- File import ---
async function handleFile(file) {
  if (!file || !file.name.toLowerCase().endsWith('.fit')) {
    alert('Veuillez sélectionner un fichier .FIT');
    return;
  }

  try {
    const buffer = await file.arrayBuffer();
    const dive = extractDiveFromBuffer(buffer);
    const id = await saveDive(dive);
    dive.id = id;
    dives.push(dive);
    showDetail(dive);
  } catch (err) {
    console.error('Error parsing FIT:', err);
    alert(`Erreur lors du parsing: ${err.message}`);
  }
}

fileInput.addEventListener('change', e => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
  e.target.value = '';
});

// Drag & drop
dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

// --- Delete ---
btnDelete.addEventListener('click', async () => {
  if (!currentDive || !currentDive.id) return;
  if (!confirm('Supprimer cette plongée ?')) return;
  await deleteDive(currentDive.id);
  dives = dives.filter(d => d.id !== currentDive.id);
  showList();
});

// --- Init ---
async function init() {
  dives = await getAllDives();
  renderDiveList();
}

init();

// --- Service Worker ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// --- Version display ---
caches.keys().then(keys => {
  const current = keys.find(k => k.startsWith('garmin-dive-v'));
  if (current) {
    const ver = current.replace('garmin-dive-', '');
    const el = document.getElementById('app-version');
    if (el) el.textContent = `Dive + ${ver}`;
  }
}).catch(() => {});
