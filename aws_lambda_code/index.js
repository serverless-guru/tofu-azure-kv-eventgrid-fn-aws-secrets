const token = process.env.AWS_SESSION_TOKEN;
const secretName = process.env.SECRET_NAME || "demo-secret";

async function fetchSecret({ refreshNow = false } = {}) {
  if (!token) throw new Error("Missing AWS_SESSION_TOKEN for extension auth");

  const url = new URL("http://localhost:2773/secretsmanager/get");
  url.searchParams.set("secretId", secretName);
  url.searchParams.set("versionStage", "AWSCURRENT");
  if (refreshNow) {
    console.log("Refreshing secret now");
    url.searchParams.set("refreshNow", "true");
  } else {
    console.log("Using cached secret if available");
  }

  const response = await fetch(url, {
    headers: { "X-Aws-Parameters-Secrets-Token": token },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Extension error ${response.status}: ${body}`);
  }
  return response.json();
}


exports.handler = async (event) => {
  const records = Array.isArray(event?.Records) ? event.Records : [];
  if (records.length) {
    for (const record of records) {
      if (record?.eventSource !== "aws:sqs") continue;
      let payload;
      try {
        payload = JSON.parse(record.body || "{}");
      } catch {
        payload = {};
      }
      if (payload?.refreshNow === false) {
        await fetchSecret({ refreshNow: false });
        console.log(`Refreshed cache for ${secretName}`);
      } else {
        await fetchSecret({ refreshNow: true });
        console.log(`Forced refresh for ${secretName}`);
      }
    }

    return { statusCode: 202 };
  }

  const secret = await fetchSecret();
  const value = secret.SecretString || "<binary>";
  console.log(`Fetched secret ${secretName}`);

  return {
    statusCode: 200,
    body: JSON.stringify({
      secretName,
      value,
    }),
  };
};
