// ============================================================
//  config.js  –  fill in your Notehub details here
// ============================================================

const CONFIG = {
  // Your Blues Notehub project UID (same as productUID in your Arduino sketch)
  NOTEHUB_PROJECT_UID: "com.gmail.ben.ak.sheng:r2ak_data",

  // Notehub API token – generate one at notehub.io → Account → API Tokens
  // IMPORTANT: for a public site, route your data through a Netlify serverless
  // function instead of exposing this token here.
  NOTEHUB_TOKEN: "api_key_9QYBZiv1EqrFgfg3ydGVUsaMcty+etR0PAHWRr98rAI=",

  // How many notes to fetch per refresh (max 250)
  PAGE_SIZE: 250,

  // How often to poll for new data (ms). 5 min = 300000
  POLL_INTERVAL: 300000,

  // Map starting view [lat, lon, zoom]
  MAP_CENTER: [50.5, -127.0],
  MAP_ZOOM: 6,
};