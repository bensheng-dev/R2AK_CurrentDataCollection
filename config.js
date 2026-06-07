const CONFIG = {
  dataUrls: {
    history: "data/history.geojson",
    latest: "data/latest.json"
  },

  refreshMs: 60_000,

  staleAfterMinutes: 30,

  startView: {
    center: [49.2827, -123.1207],
    zoom: 7
  },

  pollutants: {
    CO: {
      label: "CO",
      unit: "ppm",
      range: [0, 1]
    },
    NO: {
      label: "NO",
      unit: "ppb",
      range: [0, 100]
    },
    NO2: {
      label: "NO₂",
      unit: "ppb",
      range: [0, 100]
    },
    O3: {
      label: "O₃",
      unit: "ppb",
      range: [0, 100]
    },
    CO2: {
      label: "CO₂",
      unit: "ppm",
      range: [400, 1000]
    },
    PM2_5: {
      label: "PM₂.₅",
      unit: "µg/m³",
      range: [0, 100]
    },
    PM10: {
      label: "PM₁₀",
      unit: "µg/m³",
      range: [0, 200]
    },
    AQHI: {
      label: "AQHI",
      unit: "",
      range: [1, 10]
    }
  },

  defaultPollutant: "PM2_5"
};