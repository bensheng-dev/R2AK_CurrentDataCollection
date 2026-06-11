// ============================================================
//  app.js  –  R2AK Live Tracker
//  Data source: Blues Notehub REST API
// ============================================================

// ── State ────────────────────────────────────────────────────
let allPoints   = [];   // parsed data points, newest-first
let map         = null;
let trackLine   = null;
let markers     = [];
let boatMarker  = null;
let chart       = null;
let chartField  = 'tws';
let tsExpanded  = true;
let firstLoad   = true; // zoom to boat on first data fetch only

// ── Field map: chart select value → note body key + label ───
const FIELDS = {
  tws:         { key: 'True Wind Speed',      label: 'True Wind Speed (kts)' },
  aws:         { key: 'Apparent Wind Speed',  label: 'Apparent Wind Speed (kts)' },
  twd:         { key: 'True Wind Direction',  label: 'True Wind Direction (°)' },
  sog:         { key: 'Speed (Knots)',         label: 'Speed Over Ground (kts)' },
  stw:         { key: 'Speed Through Water',  label: 'Speed Through Water (kts)' },
  current_spd: { key: 'Current Speed',        label: 'Current Speed (kts)' },
};

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initChart();
  bindUI();
  fetchData();
  setInterval(fetchData, CONFIG.POLL_INTERVAL);
});

// ── Map ──────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', { zoomControl: true }).setView(CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 18,
  }).addTo(map);

  trackLine = L.polyline([], {
    color: '#00c8ff',
    weight: 2,
    opacity: 0.7,
  }).addTo(map);
}

// Boat icon — rotates to COG
function buildBoatIcon(cog) {
  const rotation = cog || 0;
  return L.divIcon({
    className: '',
    html: `<div style="transform: rotate(${rotation}deg); transform-origin: center center;">
      <svg width="24" height="32" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">
        <polygon points="12,0 24,28 12,22 0,28" fill="#1e3a5f" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>
    </div>`,
    iconSize: [24, 32],
    iconAnchor: [12, 16],
  });
}

function buildDotIcon(color) {
  return L.divIcon({
    className: '',
    html: `<svg width="10" height="10" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">
      <circle cx="5" cy="5" r="4" fill="${color}" stroke="#0a0e14" stroke-width="1"/>
    </svg>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
}

// Color dots by TWS
function twsColor(tws) {
  if (tws === null || tws === undefined) return '#4a6480';
  if (tws < 5)  return '#39d98a';
  if (tws < 12) return '#00c8ff';
  if (tws < 20) return '#f7c948';
  return '#ff4757';
}

function updateMap(points) {
  // Clear old markers
  markers.forEach(m => map.removeLayer(m));
  markers = [];
  if (boatMarker) { map.removeLayer(boatMarker); boatMarker = null; }

  if (!points.length) return;

  const latlngs = points.map(p => [p.lat, p.lon]).reverse(); // oldest first
  trackLine.setLatLngs(latlngs);

  // Add dot markers for history
  points.slice(1).forEach(p => {
    const m = L.marker([p.lat, p.lon], { icon: buildDotIcon(twsColor(p.tws)) })
      .bindPopup(buildPopup(p));
    m.addTo(map);
    markers.push(m);
  });

  // Latest point as boat icon (rotated to COG)
  const latest = points[0];
  boatMarker = L.marker([latest.lat, latest.lon], { icon: buildBoatIcon(latest.cog) })
    .bindPopup(buildPopup(latest))
    .addTo(map);

  // First load: zoom in tight; subsequent updates: just pan
  if (firstLoad) {
    map.setView([latest.lat, latest.lon], 13);
    firstLoad = false;
  } else {
    map.panTo([latest.lat, latest.lon]);
  }
}

function buildPopup(p) {
  const time = p.utc || '—';
  return `<div class="popup-content">
    <p class="popup-time">${time}</p>
    <p><strong>SOG</strong> ${fmt(p.sog, 1)} kts &nbsp; <strong>COG</strong> ${fmt(p.cog, 0)}°</p>
    <p><strong>TWS</strong> ${fmt(p.tws, 1)} kts &nbsp; <strong>TWD</strong> ${fmt(p.twd, 0)}°</p>
    <p><strong>AWS</strong> ${fmt(p.aws, 1)} kts &nbsp; <strong>AWA</strong> ${fmt(p.awa, 0)}°</p>
    <p><strong>STW</strong> ${fmt(p.stw, 1)} kts</p>
    <p><strong>Current</strong> ${fmt(p.current_spd, 2)} kts @ ${fmt(p.current_dir, 0)}°</p>
  </div>`;
}

// ── Chart ────────────────────────────────────────────────────
function initChart() {
  const ctx = document.getElementById('timeseries-chart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [{ data: [], borderColor: '#00c8ff', backgroundColor: 'rgba(0,200,255,0.08)', borderWidth: 2, pointRadius: 3, pointHoverRadius: 6, pointBackgroundColor: '#00c8ff', tension: 0.3, fill: true }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#18202d',
          borderColor: '#1e2d42',
          borderWidth: 1,
          titleColor: '#4a6480',
          bodyColor: '#d4e4f7',
          titleFont: { family: "'JetBrains Mono', monospace", size: 11 },
          bodyFont:  { family: "'JetBrains Mono', monospace", size: 12 },
          callbacks: {
            title: (items) => allPoints.slice().reverse()[items[0].dataIndex]?.utc || '',
          },
        },
      },
      scales: {
        x: { ticks: { color: '#4a6480', font: { family: "'JetBrains Mono', monospace", size: 10 }, maxTicksLimit: 8, maxRotation: 0 }, grid: { color: '#1e2d42' } },
        y: { ticks: { color: '#4a6480', font: { family: "'JetBrains Mono', monospace", size: 10 } }, grid: { color: '#1e2d42' } },
      },
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const idx = elements[0].index;
        const p = allPoints.slice().reverse()[idx];
        if (p && p.lat && p.lon) {
          map.setView([p.lat, p.lon], 10);
        }
      },
    },
  });
}

function updateChart(points) {
  const field = FIELDS[chartField];
  const ordered = [...points].reverse(); // oldest → newest
  chart.data.labels = ordered.map(p => p.utc ? p.utc.slice(0, 5) : '');
  chart.data.datasets[0].data = ordered.map(p => {
    const v = p[chartField];
    return (v !== null && v !== undefined) ? +v.toFixed(2) : null;
  });
  chart.update();
  // Title is now the select itself; keep the h2 in sync for when chart is minimized
  const titleEl = document.getElementById('chart-title');
  if (titleEl) titleEl.textContent = field.label;
}

// ── Sidebar data display ─────────────────────────────────────
function updateSidebar(p) {
  set('val-lat',         fmt(p.lat, 5));
  set('val-lon',         fmt(p.lon, 5));

  // Show stale position pill beside Position title
  const posNote = document.getElementById('val-pos-note');
  if (posNote) {
    if (p._positionStale && p._positionStaleSince) {
      posNote.textContent = `GPS lost · last fix ${p._positionStaleSince}`;
      posNote.style.display = 'inline-block';
    } else {
      posNote.style.display = 'none';
    }
  }
  set('val-sog',         fmt(p.sog, 1));
  set('val-cog',         fmt(p.cog, 0));
  set('val-aws',         fmt(p.aws, 1));
  set('val-awa',         fmt(p.awa, 0));
  set('val-tws',         fmt(p.tws, 1));
  set('val-twd',         fmt(p.twd, 0));
  set('val-stw',         fmt(p.stw, 1));
  set('val-heading',     fmt(p.heading, 0));
  set('val-current-spd', fmt(p.current_spd, 2));
  set('val-current-dir', fmt(p.current_dir, 0));
  set('last-updated', p.utc || '—');
  // Error string
  const errEl = document.getElementById('val-error');
  if (errEl) {
    const errText = p.error && p.error.trim().length > 0 ? p.error : 'None';
    errEl.textContent = errText;
    errEl.className = 'mono error-text' + (errText === 'None' ? ' no-errors' : '');
  }
  drawCompass(p.twd);
}

function drawCompass(twd) {
  const canvas = document.getElementById('wind-compass');
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2, cy = canvas.height / 2, r = 50;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Outer ring
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#1e2d42';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Cardinal labels
  const cardinals = ['N', 'E', 'S', 'W'];
  ctx.fillStyle = '#4a6480';
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  cardinals.forEach((c, i) => {
    const a = (i * 90 - 90) * Math.PI / 180;
    ctx.fillText(c, cx + Math.cos(a) * (r - 10), cy + Math.sin(a) * (r - 10));
  });

  if (twd === null || twd === undefined) return;

  // Arrow
  const angle = (twd - 90) * Math.PI / 180;
  const arrowLen = r - 18;
  const tailLen  = 14;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);

  ctx.beginPath();
  ctx.moveTo(-tailLen, 0);
  ctx.lineTo(arrowLen, 0);
  ctx.strokeStyle = '#00c8ff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(arrowLen, 0);
  ctx.lineTo(arrowLen - 8, -5);
  ctx.lineTo(arrowLen - 8,  5);
  ctx.closePath();
  ctx.fillStyle = '#00c8ff';
  ctx.fill();

  ctx.restore();

  // Centre dot
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#00c8ff';
  ctx.fill();
}

// ── Notehub fetch ─────────────────────────────────────────────
async function fetchData() {
  setStatus('loading');
  try {
    // Start from yesterday midnight UTC — Notehub expects Unix timestamp (seconds)
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0);
    const startDate = Math.floor(yesterday.getTime() / 1000);

    const res = await fetch(`/.netlify/functions/notehub?startDate=${startDate}`);

    if (!res.ok) throw new Error(`Notehub ${res.status}`);

    const json = await res.json();
    const events = json.events || [];

    const parsed = events
      .filter(e => e.body && e.body['Latitude'] !== undefined)
      .map(parseEvent);

    // Forward-fill lat/lon: if a point has 0/null, use the last known good position
    let lastGoodLat = null, lastGoodLon = null, lastGoodPosTime = null;
    for (let i = parsed.length - 1; i >= 0; i--) {
      const p = parsed[i];
      if (p.lat && p.lon) {
        lastGoodLat = p.lat;
        lastGoodLon = p.lon;
        lastGoodPosTime = p.utc;
      } else if (lastGoodLat !== null) {
        p.lat = lastGoodLat;
        p.lon = lastGoodLon;
        p._positionStale = true;
        p._positionStaleSince = lastGoodPosTime; // timestamp of last known good fix
      }
    }

    allPoints = parsed.filter(p => p.lat !== null && p.lon !== null);

    if (!allPoints.length) {
      setStatus('stale', 'No data');
      return;
    }

    const latest = allPoints[0];
    const ageMs  = Date.now() - (latest._ts || 0);
    const isLive = ageMs < 5 * 60 * 1000; // <5 min = live
    setStatus(isLive ? 'live' : 'stale', isLive ? 'Live' : 'Last seen ' + timeAgo(ageMs));

    updateSidebar(latest);
    updateMap(allPoints);
    updateChart(allPoints);

  } catch (err) {
    console.error(err);
    setStatus('error', 'Connection error');
  }
}

function parseEvent(e) {
  const b = e.body;

  // Use the Notehub Unix timestamp for accurate Pacific time display
  const tsDate = e.when ? new Date(e.when * 1000) : null;
  const timeStr = tsDate ? tsDate.toLocaleTimeString('en-US', {
    timeZone: 'America/Vancouver',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }) : '--';
  const tzLabel = tsDate
    ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Vancouver', timeZoneName: 'short' })
        .formatToParts(tsDate)
        .find(p => p.type === 'timeZoneName')?.value ?? ''
    : '';
  const utc = `${timeStr} ${tzLabel}`.trim();

  return {
    _ts:         e.when ? e.when * 1000 : 0,  // Notehub `when` is Unix seconds → convert to ms
    utc,
    lat:         b['Latitude']             ?? null,
    lon:         b['Longitude']            ?? null,
    sog:         b['Speed (Knots)']         ?? null,
    cog:         b['Heading (deg)']         ?? null,
    heading:     b['IMU Heading (avg)']     ?? null,
    aws:         b['Apparent Wind Speed']   ?? null,
    awa:         b['Apparent Wind Angle']   ?? null,
    tws:         b['True Wind Speed']       ?? null,
    twd:         b['True Wind Direction']   ?? null,
    stw:         b['Speed Through Water']   ?? null,
    current_spd: b['Current Speed']         ?? null,
    current_dir: b['Current Direction']     ?? null,
    error:       b['Error']                 ?? null,
  };
}

// ── UI bindings ───────────────────────────────────────────────
function bindUI() {
  document.getElementById('chart-select').addEventListener('change', e => {
    chartField = e.target.value;
    if (allPoints.length) updateChart(allPoints);
  });

  document.getElementById('timeseries-toggle').addEventListener('click', () => {
    tsExpanded = !tsExpanded;
    const panel = document.getElementById('timeseries-panel');
    const btn   = document.getElementById('timeseries-toggle');

    panel.classList.toggle('collapsed', !tsExpanded);
    btn.textContent = tsExpanded ? 'Minimize' : 'Expand';
    btn.setAttribute('aria-expanded', tsExpanded);

    // Resize both map and chart after transition
    setTimeout(() => {
      map.invalidateSize();
      if (tsExpanded) chart.resize();
    }, 50);
  });
}

// ── Helpers ──────────────────────────────────────────────────
function set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function fmt(val, decimals) {
  if (val === null || val === undefined) return '—';
  return Number(val).toFixed(decimals);
}

function pad(n) { return String(n).padStart(2, '0'); }

function setStatus(type, text) {
  const el = document.getElementById('status-pill');
  el.className = 'status-pill ' + type;
  el.textContent = text || type;
}

function timeAgo(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}