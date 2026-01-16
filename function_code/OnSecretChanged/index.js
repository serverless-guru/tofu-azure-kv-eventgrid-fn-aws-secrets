const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");

module.exports = async function (context, eventGridEvent) {
  context.log("Event received:", JSON.stringify(eventGridEvent));

  const data = (eventGridEvent && eventGridEvent.data) || {};
  const secretId = data.Id || data.id;
  if (!secretId) {
    context.log.warn("Event data missing secret Id.");
    return;
  }

  let url;
  try {
    url = new URL(secretId);
  } catch (err) {
    context.log.warn("Invalid secret Id URL:", secretId);
    return;
  }

  const pathParts = url.pathname.split("/").filter(Boolean);
  if (pathParts.length < 2 || pathParts[0].toLowerCase() !== "secrets") {
    context.log.warn("Secret Id does not look like a secret URL:", secretId);
    return;
  }

  const vaultUrl = `${url.protocol}//${url.host}`;
  const secretName = pathParts[1];
  const secretVersion = pathParts[2];

  const credential = new DefaultAzureCredential();
  const client = new SecretClient(vaultUrl, credential);
  const secret = await client.getSecret(secretName, secretVersion);

  context.log(
    `Fetched secret ${secret.name} version ${secret.properties.version || "latest"}.`
  );
};
