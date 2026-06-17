const PROJECT_UID = "com.gmail.ben.ak.sheng:r2ak_data";
const BASE_URL = `https://api.notefile.net/v1/projects/${PROJECT_UID}/events`;

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
    // Single request with max page size — avoids multiple round trips and timeout
    const url = `${BASE_URL}?pageSize=1000&pageNum=1&sortBy=captured&sortOrder=desc&files=data.qo`;

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

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: data.events || [] }),
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