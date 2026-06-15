const PROJECT_UID = "com.gmail.ben.ak.sheng:r2ak_data";
const BASE_URL = `https://api.notefile.net/v1/projects/${PROJECT_UID}/events`;
const PAGE_SIZE = 250; // max per page Notehub supports

exports.handler = async (event) => {
  const token = process.env.NOTEHUB_TOKEN;
  if (!token) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "NOTEHUB_TOKEN environment variable is not set." }),
    };
  }

  const startDate = event.queryStringParameters?.startDate || "";

  try {
    let allEvents = [];
    let pageNum = 1;
    let hasMore = true;

    // Fetch all pages until Notehub returns fewer events than PAGE_SIZE
    while (hasMore) {
      let url = `${BASE_URL}?pageSize=${PAGE_SIZE}&pageNum=${pageNum}&sortBy=captured&sortOrder=desc`;
      if (startDate) url += `&startDate=${startDate}`; // Unix timestamp (seconds)

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

      console.log(`Page ${pageNum}: fetched ${events.length} events (total so far: ${allEvents.length})`);

      // If we got fewer than PAGE_SIZE, we've reached the last page
      hasMore = events.length === PAGE_SIZE;
      pageNum++;

      // Safety cap — 8 pages × 250 = 2,000 events (~7 days at 5-min intervals)
      if (pageNum > 8) {
        console.warn("Hit page cap (8 pages)");
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