let map;
let trackLayer;
let plumeLayer;
let currentMarker;
let selectedHistoryMarker;
let timeseriesChart;
let selectedHistoryPointIndex = null;

let latestData = null;
let historyData = null;
let selectedPollutant = CONFIG.defaultPollutant;
let timeseriesPoints = [];

const els = {
  status: document.getElementById("status-pill"),
  location: document.getElementById("current-location"),
  updated: document.getElementById("last-updated"),
  pollutantSelect: document.getElementById("pollutant-select"),
  pollutantList: document.getElementById("pollutant-list"),
  legend: document.getElementById("legend"),
  timeseriesPanel: document.getElementById("timeseries-panel"),
  timeseriesToggle: document.getElementById("timeseries-toggle"),
  timeseriesSubtitle: document.getElementById("timeseries-subtitle"),
  timeseriesChart: document.getElementById("timeseries-chart")
};

document.addEventListener("DOMContentLoaded", init);

function init() {
  initMap();
  initPollutantSelect();
  initTimeseriesPanel();
  loadAllData();

  setInterval(loadAllData, CONFIG.refreshMs);
}

/* =========================================================
   Initialization
   ========================================================= */

function initMap() {
  map = L.map("map").setView(CONFIG.startView.center, CONFIG.startView.zoom);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  trackLayer = L.layerGroup().addTo(map);
  plumeLayer = L.layerGroup().addTo(map);
}

function initPollutantSelect() {
  Object.entries(CONFIG.pollutants).forEach(([key, meta]) => {
    const option = document.createElement("option");

    option.value = key;
    option.textContent = meta.label;
    option.selected = key === selectedPollutant;

    els.pollutantSelect.appendChild(option);
  });

  els.pollutantSelect.addEventListener("change", (event) => {
    selectedPollutant = event.target.value;

    renderPlume();
    renderLegend();
    renderTimeseriesChart();

    if (selectedHistoryMarker && selectedHistoryMarker._selectedPoint) {
      selectedHistoryMarker.bindPopup(
        makePopup(selectedHistoryMarker._selectedPoint, selectedPollutant)
      );
    }
  });

  renderLegend();
}

function initTimeseriesPanel() {
  if (!els.timeseriesPanel || !els.timeseriesToggle) return;

  els.timeseriesToggle.addEventListener("click", () => {
    const isCollapsed = els.timeseriesPanel.classList.toggle("collapsed");

    els.timeseriesToggle.textContent = isCollapsed ? "Show" : "Minimize";
    els.timeseriesToggle.setAttribute("aria-expanded", String(!isCollapsed));

    setTimeout(() => {
      if (timeseriesChart) {
        timeseriesChart.resize();
      }
    }, 0);
  });
}

/* =========================================================
   Data loading
   ========================================================= */

async function loadAllData() {
  try {
    const [history, latest] = await Promise.all([
      fetchJson(CONFIG.dataUrls.history),
      fetchJson(CONFIG.dataUrls.latest)
    ]);

    historyData = history;
    latestData = latest;
  } catch (error) {
    console.error("Data loading error:", error);

    els.status.textContent = "Data loading error";
    els.status.className = "status-pill error";
    return;
  }

  try {
    renderTrack();
    renderPlume();
    renderCurrentMarker();
    renderPanel();
    renderTimeseriesChart();

    setStatusFromTimestamp(latestData.timestamp);
  } catch (error) {
    console.error("Dashboard rendering error:", error);

    els.status.textContent = "Display error";
    els.status.className = "status-pill error";
  }
}

async function fetchJson(url) {
  const response = await fetch(`${url}?t=${Date.now()}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.json();
}

/* =========================================================
   Data helpers
   ========================================================= */

function getHistoryPoints() {
  if (!historyData || !Array.isArray(historyData.features)) {
    return [];
  }

  return historyData.features
    .filter((feature) => {
      const coords = feature.geometry?.coordinates;

      return (
        feature.geometry?.type === "Point" &&
        Array.isArray(coords) &&
        Number.isFinite(Number(coords[0])) &&
        Number.isFinite(Number(coords[1]))
      );
    })
    .map((feature, index) => {
      const [lon, lat] = feature.geometry.coordinates;

      return {
        index,
        lat: Number(lat),
        lon: Number(lon),
        properties: feature.properties || {}
      };
    });
}

function getSortedHistoryPointsAscending() {
  return getHistoryPoints()
    .map((point) => {
      return {
        ...point,
        time: Date.parse(point.properties.timestamp)
      };
    })
    .sort((a, b) => {
      const aHasTime = Number.isFinite(a.time);
      const bHasTime = Number.isFinite(b.time);

      if (aHasTime && bHasTime && a.time !== b.time) {
        return a.time - b.time;
      }

      return a.index - b.index;
    });
}

function getLatestBearing() {
  const points = getSortedHistoryPointsAscending().filter((point) => {
    return (
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lon)
    );
  });

  if (points.length < 2) {
    return null;
  }

  const from = points[points.length - 2];
  const to = points[points.length - 1];

  if (from.lat === to.lat && from.lon === to.lon) {
    return null;
  }

  return calculateBearing(from.lat, from.lon, to.lat, to.lon);
}

/* =========================================================
   Map rendering
   ========================================================= */

function renderTrack() {
  trackLayer.clearLayers();

  const points = getSortedHistoryPointsAscending();
  const latLngs = points.map((point) => [point.lat, point.lon]);

  if (latLngs.length === 0) return;

  L.polyline(latLngs, {
    color: "#0f172a",
    weight: 3,
    opacity: 0.7
  }).addTo(trackLayer);

  if (latLngs.length > 1 && !map._hasFitInitialBounds) {
    map.fitBounds(latLngs, {
      padding: [30, 30]
    });

    map._hasFitInitialBounds = true;
  }
}

function renderPlume() {
  plumeLayer.clearLayers();

  const points = getSortedHistoryPointsAscending();
  const pollutantMeta = CONFIG.pollutants[selectedPollutant];

  points.forEach((point) => {
    const value = Number(point.properties[selectedPollutant]);

    if (!Number.isFinite(value)) return;

    const color = getPollutantColor(value, pollutantMeta.range);

    const marker = L.circleMarker([point.lat, point.lon], {
      radius: point.index === selectedHistoryPointIndex ? 9 : 6,
      color: point.index === selectedHistoryPointIndex ? "#ffffff" : "#0f172a",
      fillColor: color,
      fillOpacity: point.index === selectedHistoryPointIndex ? 0.95 : 0.7,
      weight: point.index === selectedHistoryPointIndex ? 3 : 1.5,
      opacity: 1
    });

    marker.on("click", () => {
      selectHistoryPoint(point, {
        panMap: false,
        openPopup: true
      });
    });

    marker.addTo(plumeLayer);
  });
}

function renderCurrentMarker() {
  if (!latestData) return;

  const lat = Number(latestData.lat);
  const lon = Number(latestData.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

  const bearing = getLatestBearing();
  const arrowIcon = makeVesselArrowIcon(bearing);

  if (currentMarker) {
    currentMarker.setLatLng([lat, lon]);
    currentMarker.setIcon(arrowIcon);
  } else {
    currentMarker = L.marker([lat, lon], {
      icon: arrowIcon
    }).addTo(map);
  }

  const headingText = Number.isFinite(bearing)
    ? `${Math.round(bearing)}°`
    : "Unknown";

  currentMarker.bindPopup(`
    <strong>Current vessel location</strong><br>
    <strong>Heading</strong>: ${headingText}<br>
    <strong>Location</strong>: ${lat.toFixed(5)}, ${lon.toFixed(5)}
  `);
}

function focusHistoryPoint(point, options = {}) {
  if (!point) return;

  const shouldPanMap = options.panMap !== false;
  const shouldOpenPopup = options.openPopup !== false;

  if (shouldPanMap) {
    map.setView([point.lat, point.lon], Math.max(map.getZoom(), 11), {
      animate: true
    });
  }

  if (selectedHistoryMarker) {
    selectedHistoryMarker.setLatLng([point.lat, point.lon]);
  } else {
    selectedHistoryMarker = L.circleMarker([point.lat, point.lon], {
      radius: 11,
      color: "#ffffff",
      fillColor: "#0f172a",
      fillOpacity: 0.95,
      weight: 3,
      opacity: 1
    }).addTo(map);
  }

  selectedHistoryMarker._selectedPoint = point;
  selectedHistoryMarker.bindPopup(makePopup(point, selectedPollutant));

  if (shouldOpenPopup) {
    selectedHistoryMarker.openPopup();
  }
}

function selectHistoryPoint(point, options = {}) {
  if (!point) return;

  selectedHistoryPointIndex = point.index;

  focusHistoryPoint(point, options);
  renderPlume();
  updateTimeseriesHighlight();
}

/* =========================================================
   Panel rendering
   ========================================================= */

function renderPanel() {
  if (!latestData) return;

  const lat = Number(latestData.lat);
  const lon = Number(latestData.lon);

  if (els.location) {
    els.location.textContent =
      Number.isFinite(lat) && Number.isFinite(lon)
        ? `${lat.toFixed(5)}, ${lon.toFixed(5)}`
        : "Unknown";
  }

  els.updated.textContent = latestData.timestamp
    ? formatTimestamp(latestData.timestamp)
    : "Unknown";

  els.pollutantList.innerHTML = "";

  Object.entries(CONFIG.pollutants).forEach(([key, meta]) => {
    const value = latestData.pollutants?.[key];

    const row = document.createElement("div");
    row.className = "pollutant-row";

    const name = document.createElement("span");
    name.className = "pollutant-name";
    name.textContent = meta.label;

    const number = document.createElement("span");
    number.className = "pollutant-value";
    number.textContent = formatValue(value, meta.unit);

    row.appendChild(name);
    row.appendChild(number);

    els.pollutantList.appendChild(row);
  });
}

function renderLegend() {
  const meta = CONFIG.pollutants[selectedPollutant];
  const [min, max] = meta.range;

  const steps = [
    min,
    min + (max - min) * 0.25,
    min + (max - min) * 0.5,
    min + (max - min) * 0.75,
    max
  ];

  els.legend.innerHTML = "";

  steps.forEach((value) => {
    const row = document.createElement("div");
    row.className = "legend-row";

    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.backgroundColor = getPollutantColor(value, meta.range);

    const label = document.createElement("span");
    label.textContent = `${roundValue(value)} ${meta.unit}`.trim();

    row.appendChild(swatch);
    row.appendChild(label);

    els.legend.appendChild(row);
  });
}

/* =========================================================
   Time-series chart
   ========================================================= */

function renderTimeseriesChart() {
  if (!els.timeseriesChart || typeof Chart === "undefined") return;

  const pollutantMeta = CONFIG.pollutants[selectedPollutant];

  timeseriesPoints = getSortedHistoryPointsAscending();

  const labels = timeseriesPoints.map((point) => {
    return point.properties.timestamp
      ? formatTimestampShort(point.properties.timestamp)
      : "Unknown";
  });

  const values = timeseriesPoints.map((point) => {
    const value = Number(point.properties[selectedPollutant]);
    return Number.isFinite(value) ? value : null;
  });

  const pointColors = timeseriesPoints.map((point) => {
    const value = Number(point.properties[selectedPollutant]);

    if (!Number.isFinite(value)) {
      return "#94a3b8";
    }

    return getPollutantColor(value, pollutantMeta.range);
  });

  const pointRadii = timeseriesPoints.map((point) => {
    return point.index === selectedHistoryPointIndex ? 7 : 3;
  });

  const pointHoverRadii = timeseriesPoints.map((point) => {
    return point.index === selectedHistoryPointIndex ? 9 : 7;
  });

  const pointBorderColors = timeseriesPoints.map((point) => {
    return point.index === selectedHistoryPointIndex ? "#ffffff" : "#0f172a";
  });

  const pointBorderWidths = timeseriesPoints.map((point) => {
    return point.index === selectedHistoryPointIndex ? 3 : 1;
  });

  if (els.timeseriesSubtitle) {
    els.timeseriesSubtitle.textContent =
      `Showing ${pollutantMeta.label}. Click a point to jump to that location on the map.`;
  }

  if (timeseriesChart) {
    timeseriesChart.destroy();
  }

  timeseriesChart = new Chart(els.timeseriesChart, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: pollutantMeta.unit
            ? `${pollutantMeta.label} (${pollutantMeta.unit})`
            : pollutantMeta.label,
          data: values,
          borderColor: "#0f172a",
          backgroundColor: "rgba(15, 23, 42, 0.08)",
          borderWidth: 2,
          tension: 0.25,
          pointRadius: pointRadii,
          pointHoverRadius: pointHoverRadii,
          pointBackgroundColor: pointColors,
          pointBorderColor: pointBorderColors,
          pointBorderWidth: pointBorderWidths,
          spanGaps: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "nearest",
        intersect: true
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            title: (items) => {
              const index = items[0].dataIndex;
              const point = timeseriesPoints[index];

              return point?.properties?.timestamp
                ? formatTimestamp(point.properties.timestamp)
                : "Unknown time";
            },
            label: (item) => {
              return `${pollutantMeta.label}: ${formatValue(item.raw, pollutantMeta.unit)}`;
            },
            afterLabel: (item) => {
              const point = timeseriesPoints[item.dataIndex];

              if (!point) return "";

              return `Location: ${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 8
          },
          grid: {
            display: false
          }
        },
        y: {
          title: {
            display: true,
            text: pollutantMeta.unit
              ? `${pollutantMeta.label} (${pollutantMeta.unit})`
              : pollutantMeta.label
          },
          ticks: {
            precision: 0
          }
        }
      },
      onClick: (event) => {
        const chartPoints = timeseriesChart.getElementsAtEventForMode(
          event,
          "nearest",
          {
            intersect: true
          },
          true
        );

        if (chartPoints.length === 0) return;

        const index = chartPoints[0].index;
        const point = timeseriesPoints[index];

        selectHistoryPoint(point, {
          panMap: true,
          openPopup: true
        });
      }
    }
  });

  updateTimeseriesHighlight();
}

function updateTimeseriesHighlight() {
  if (!timeseriesChart || !Array.isArray(timeseriesPoints)) return;

  const dataset = timeseriesChart.data.datasets[0];

  dataset.pointRadius = timeseriesPoints.map((point) => {
    return point.index === selectedHistoryPointIndex ? 7 : 3;
  });

  dataset.pointHoverRadius = timeseriesPoints.map((point) => {
    return point.index === selectedHistoryPointIndex ? 9 : 7;
  });

  dataset.pointBorderColor = timeseriesPoints.map((point) => {
    return point.index === selectedHistoryPointIndex ? "#ffffff" : "#0f172a";
  });

  dataset.pointBorderWidth = timeseriesPoints.map((point) => {
    return point.index === selectedHistoryPointIndex ? 3 : 1;
  });

  const chartIndex = timeseriesPoints.findIndex((point) => {
    return point.index === selectedHistoryPointIndex;
  });

  if (chartIndex >= 0) {
    timeseriesChart.setActiveElements([
      {
        datasetIndex: 0,
        index: chartIndex
      }
    ]);
  } else {
    timeseriesChart.setActiveElements([]);
  }

  timeseriesChart.update("none");
}

/* =========================================================
   Popup and marker helpers
   ========================================================= */

function makePopup(point, pollutantKey) {
  const meta = CONFIG.pollutants[pollutantKey];
  const value = point.properties[pollutantKey];
  const timestamp = point.properties.timestamp;

  return `
    <strong>${meta.label}</strong>: ${formatValue(value, meta.unit)}<br>
    <strong>Time</strong>: ${timestamp ? formatTimestamp(timestamp) : "Unknown"}<br>
    <strong>Location</strong>: ${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}
  `;
}

function makeVesselArrowIcon(bearing) {
  const rotation = Number.isFinite(bearing) ? bearing : 0;
  const opacity = Number.isFinite(bearing) ? 1 : 0.55;

  return L.divIcon({
    className: "vessel-arrow-icon",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18],
    html: `
      <div
        class="vessel-arrow-wrap"
        style="transform: rotate(${rotation}deg); opacity: ${opacity};"
      >
        <div class="vessel-arrow"></div>
      </div>
    `
  });
}

/* =========================================================
   Visual encoding
   ========================================================= */

function getPollutantColor(value, range) {
  const [min, max] = range;
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));

  if (ratio < 0.25) return "#2c7bb6";
  if (ratio < 0.5) return "#abd9e9";
  if (ratio < 0.75) return "#fdae61";

  return "#d7191c";
}

/* =========================================================
   Status handling
   ========================================================= */

function setStatusFromTimestamp(timestamp) {
  if (!timestamp) {
    els.status.textContent = "No timestamp";
    els.status.className = "status-pill stale";
    return;
  }

  const updated = new Date(timestamp);
  const ageMinutes = (Date.now() - updated.getTime()) / 60000;

  if (!Number.isFinite(ageMinutes)) {
    els.status.textContent = "Invalid timestamp";
    els.status.className = "status-pill stale";
    return;
  }

  if (ageMinutes < -5) {
    els.status.textContent = "Sample route";
    els.status.className = "status-pill stale";
    return;
  }

  if (ageMinutes > CONFIG.staleAfterMinutes) {
    els.status.textContent = `Stale: ${Math.round(ageMinutes)} min old`;
    els.status.className = "status-pill stale";
  } else {
    els.status.textContent = "Live";
    els.status.className = "status-pill live";
  }
}

/* =========================================================
   Formatting helpers
   ========================================================= */

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function formatTimestampShort(timestamp) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatValue(value, unit) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return "—";
  }

  return `${roundValue(numeric)} ${unit}`.trim();
}

function roundValue(value) {
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);

  return value.toFixed(2);
}

/* =========================================================
   Geometry helpers
   ========================================================= */

function calculateBearing(lat1, lon1, lat2, lon2) {
  const phi1 = degreesToRadians(lat1);
  const phi2 = degreesToRadians(lat2);
  const deltaLambda = degreesToRadians(lon2 - lon1);

  const y = Math.sin(deltaLambda) * Math.cos(phi2);

  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  const bearing = radiansToDegrees(Math.atan2(y, x));

  return (bearing + 360) % 360;
}

function degreesToRadians(degrees) {
  return degrees * Math.PI / 180;
}

function radiansToDegrees(radians) {
  return radians * 180 / Math.PI;
}