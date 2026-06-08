exports.handler = async (event) => {
  const token = process.env.NOTEHUB_TOKEN;
  if (!token) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "NOTEHUB_TOKEN environment variable is not set." }),
    };
  }

  const pageSize  = event.queryStringParameters?.pageSize  || 250;
  const pageNum   = event.queryStringParameters?.pageNum   || 1;
  const startDate = event.queryStringParameters?.startDate || "";

  let url =
    `https://api.notefile.net/v1/projects/com.gmail.ben.ak.sheng:r2ak_data/events` +
    `?pageSize=${pageSize}&pageNum=${pageNum}&sortBy=captured&sortOrder=desc`;

  if (startDate) url += `&startDate=${startDate}`;

  try {
    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Notehub API error:", response.status, data);
      return {
        statusCode: response.status,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: data }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
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