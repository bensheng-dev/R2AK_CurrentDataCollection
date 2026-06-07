const PROJECT_UID = "com.gmail.ben.ak.sheng:r2ak_data";

exports.handler = async (event) => {
  const pageSize = event.queryStringParameters?.pageSize || 250;

  const response = await fetch(
    `https://api.notefile.net/v1/projects/${PROJECT_UID}/events?pageSize=${pageSize}`,
    {
      headers: {
        "X-Session-Token": process.env.NOTEHUB_TOKEN,
      },
    }
  );

  const data = await response.json();

  return {
    statusCode: response.status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
};