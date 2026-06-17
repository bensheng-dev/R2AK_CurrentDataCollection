const PROJECT_UID = "com.gmail.ben.ak.sheng:r2ak_data";
const BASE_URL = `https://api.notefile.net/v1/projects/${PROJECT_UID}/events`;
const PAGE_SIZE = 1000; // Notehub max per page

exports.handler = async (event) => {
  const token = process.env.NOTEHUB_TOKEN;
  if (!token) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "NOTEHUB_TOKEN environment variable is not set." }),
    };
  }

  try {
    let allEvents = [];
    let pageNum = 1;
    let hasMore = true;

    // Loop through pages, filtering to only data.qo events (no session/system noise)
    // This keeps each page fetch fast since we're not wasting bandwidth on irrelevant events
    while (hasMore) {
      const url = `${BASE_URL}?pageSize=${PAGE_SIZE}&pageNum=${pageNum}&sortBy=captured&sortOrder=desc&files=data.qo`;

      const response = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const data = await response.json();
        console.error("Notehub API error:", response.status, data);
        return {
          statusCode: response.status,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: data }),
        };
      }

      const data = await response.json();
      const events = data.events || [];
      allEvents = allEvents.concat(events);

      hasMore = events.length === PAGE_SIZE;
      pageNum++;

      // Safety cap to stay within Netlify free-tier 10s timeout.
      // Since files=data.qo strips out session noise, each page is all useful data —
      // 6 pages × 1000 = 6,000 events (~20 days at 5-min intervals).
      if (pageNum > 6) {
        console.warn("Hit page cap (6 pages)");
        hasMore = false;
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: allEvents }),
    };

  } catch (err) {
    console.error("Fetch failed:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};