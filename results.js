// ============================================================
//  results.js  –  Full race track & log page
//  Data source: data/race_track.csv (recovered SD-card log)
// ============================================================

const CSV_PATH = 'data/race_track.csv';
const PAGE_SIZE = 50;

let allRows = [];     // every parsed row, in file order (oldest → newest)
let validRows = [];   // rows with a real GPS fix (not 0,0)
let map = null;
let highlightMarker = null;
let currentPage = 0;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  initMap();
  try {
    const res = await fetch(CSV_PATH);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const text = await res.text();
    allRows = parseCSV(text);
    validRows = allRows.filter(r => hasGoodFix(r));

    renderStats();
    renderTrack();
    renderTable();
  } catch (err) {
    console.error(err);
    document.getElementById('stat-points').textContent = 'Error';
    const body = document.getElementById('log-table-body');
    body.innerHTML = `<tr><td colspan="12" class="mono">Could not load ${CSV_PATH} — ${err.message}</td></tr>`;
  }
}

// ── CSV parsing ──────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.length > 0);
  const header = lines[0].split(',');
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const row = {};
    header.forEach((h, idx) => { row[h] = cells[idx] !== undefined ? cells[idx] : ''; });

    rows.push({
      idx: i,
      utc: row['UTC'] || '',
      lat: toNum(row['Latitude']),
      lon: toNum(row['Longitude']),
      alt: toNum(row['Altitude']),
      sog: toNum(row['SOG (knots)']),
      cog: toNum(row['COG (deg)']),
      heading: toNum(row['IMU Heading (avg)']),
      aws: toNum(row['Apparent Wind Speed (knots)']),
      awa: toNum(row['Apparent Wind Angle (deg)']),
      tws: toNum(row['True Wind Speed (knots)']),
      twd: toNum(row['True Wind Direction (deg)']),
      stw: toNum(row['Speed Through Water (knots)']),
      current_spd: toNum(row['Current Speed (knots)']),
      current_dir: toNum(row['Current Direction (deg)']),
      errors: row['Errors'] || '',
    });
  }
  return rows;
}

function toNum(v) {
  if (v === undefined || v === '' || v === null) return null;
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

function hasGoodFix(r) {
  return r.lat !== null && r.lon !== null && (r.lat !== 0 || r.lon !== 0);
}

// ── Stats ────────────────────────────────────────────────────
function renderStats() {
  set('stat-points', allRows.length.toLocaleString());
  set('stat-fixes', validRows.length.toLocaleString());
  set('stat-distance', trackDistanceNm(validRows).toFixed(1));
  set('stat-max-sog', maxField(allRows, 'sog').toFixed(1));
  set('stat-max-tws', maxField(allRows, 'tws').toFixed(1));
  set('stat-max-current', maxField(allRows, 'current_spd').toFixed(1));
}

function maxField(rows, key) {
  return rows.reduce((m, r) => (r[key] !== null && r[key] > m ? r[key] : m), 0);
}

function trackDistanceNm(rows) {
  let total = 0;
  for (let i = 1; i < rows.length; i++) {
    total += haversineNm(rows[i - 1].lat, rows[i - 1].lon, rows[i].lat, rows[i].lon);
  }
  return total;
}

function haversineNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // nautical miles
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── Map ──────────────────────────────────────────────────────
function initMap() {
  map = L.map('results-map', { zoomControl: true }).setView([49.28, -123.14], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 18,
  }).addTo(map);
}

function sogColor(sog) {
  if (sog === null) return '#4a6480';
  if (sog < 3) return '#39d98a';
  if (sog < 6) return '#00c8ff';
  if (sog < 10) return '#f7c948';
  return '#ff4757';
}

function renderTrack() {
  if (!validRows.length) return;

  const canvasRenderer = L.canvas({ padding: 0.5 });
  const latlngs = validRows.map(r => [r.lat, r.lon]);

  // Full track line
  L.polyline(latlngs, {
    renderer: canvasRenderer,
    color: '#00c8ff',
    weight: 2,
    opacity: 0.55,
  }).addTo(map);

  // Every recorded fix, as a small colored dot — this is "where everything is"
  validRows.forEach(r => {
    L.circleMarker([r.lat, r.lon], {
      renderer: canvasRenderer,
      radius: 2.5,
      color: sogColor(r.sog),
      fillColor: sogColor(r.sog),
      fillOpacity: 0.85,
      weight: 0,
    })
      .bindPopup(buildPopup(r))
      .addTo(map);
  });

  // Start / finish markers
  const start = validRows[0];
  const finish = validRows[validRows.length - 1];
  L.marker([start.lat, start.lon], { icon: buildFlagIcon('#39d98a', 'S') })
    .bindPopup(`<div class="popup-content"><p class="popup-time">Start</p>${buildPopup(start)}</div>`)
    .addTo(map);
  L.marker([finish.lat, finish.lon], { icon: buildFlagIcon('#ff4757', 'F') })
    .bindPopup(`<div class="popup-content"><p class="popup-time">Finish</p>${buildPopup(finish)}</div>`)
    .addTo(map);

  map.fitBounds(L.latLngBounds(latlngs), { padding: [24, 24] });
}

function buildFlagIcon(color, letter) {
  return L.divIcon({
    className: '',
    html: `<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
      <circle cx="11" cy="11" r="9" fill="${color}" stroke="#0a0e14" stroke-width="2"/>
      <text x="11" y="15" font-size="10" font-family="JetBrains Mono, monospace" font-weight="700" text-anchor="middle" fill="#0a0e14">${letter}</text>
    </svg>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function buildPopup(r) {
  return `<div class="popup-content">
    <p class="popup-time">${r.utc ? r.utc : `Entry #${r.idx}`}</p>
    <p><strong>SOG</strong> ${fmt(r.sog, 1)} kts &nbsp; <strong>COG</strong> ${fmt(r.cog, 0)}°</p>
    <p><strong>TWS</strong> ${fmt(r.tws, 1)} kts &nbsp; <strong>TWD</strong> ${fmt(r.twd, 0)}°</p>
    <p><strong>STW</strong> ${fmt(r.stw, 1)} kts</p>
    <p><strong>Current</strong> ${fmt(r.current_spd, 2)} kts @ ${fmt(r.current_dir, 0)}°</p>
  </div>`;
}

function fmt(val, decimals) {
  if (val === null || val === undefined) return '—';
  return Number(val).toFixed(decimals);
}

function flyTo(r) {
  if (!hasGoodFix(r)) return;
  map.setView([r.lat, r.lon], 15);
  if (highlightMarker) map.removeLayer(highlightMarker);
  highlightMarker = L.circleMarker([r.lat, r.lon], {
    radius: 9,
    color: '#fff',
    weight: 2,
    fillColor: '#00c8ff',
    fillOpacity: 0.5,
    className: 'highlight-marker',
  }).addTo(map).bindPopup(buildPopup(r)).openPopup();
}

// ── Table ────────────────────────────────────────────────────
function renderTable() {
  const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages - 1);

  const start = currentPage * PAGE_SIZE;
  const pageRows = allRows.slice(start, start + PAGE_SIZE);
  const body = document.getElementById('log-table-body');

  body.innerHTML = pageRows.map(r => {
    const stale = !hasGoodFix(r);
    const hasError = r.errors && r.errors !== 'None' && r.errors.trim() !== '';
    return `<tr data-idx="${r.idx}" class="${stale ? 'row-stale-gps' : ''}">
      <td class="row-idx">${r.idx}</td>
      <td>${r.utc || '—'}</td>
      <td>${r.lat !== null ? r.lat.toFixed(5) : '—'}</td>
      <td>${r.lon !== null ? r.lon.toFixed(5) : '—'}</td>
      <td>${fmt(r.sog, 2)}</td>
      <td>${fmt(r.cog, 1)}</td>
      <td>${fmt(r.tws, 2)}</td>
      <td>${fmt(r.twd, 1)}</td>
      <td>${fmt(r.stw, 2)}</td>
      <td>${fmt(r.current_spd, 2)}</td>
      <td>${fmt(r.current_dir, 1)}</td>
      <td class="err-cell ${hasError ? 'has-error' : ''}">${r.errors || '—'}</td>
    </tr>`;
  }).join('');

  body.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const row = allRows.find(r => r.idx === Number(tr.dataset.idx));
      if (row) flyTo(row);
    });
  });

  set('table-range', `${start + 1}–${Math.min(start + PAGE_SIZE, allRows.length)} of ${allRows.length}`);

  const prevBtn = document.getElementById('prev-page');
  const nextBtn = document.getElementById('next-page');
  prevBtn.disabled = currentPage === 0;
  nextBtn.disabled = currentPage >= totalPages - 1;
  prevBtn.onclick = () => { currentPage--; renderTable(); document.getElementById('table-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
  nextBtn.onclick = () => { currentPage++; renderTable(); document.getElementById('table-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
}
