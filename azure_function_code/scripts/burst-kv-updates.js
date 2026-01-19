import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";
import { randomBytes } from "node:crypto";

function parseArgs(argv) {
  const args = { count: 20, intervalMs: 250 };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--secret") args.secret = argv[++i];
    else if (arg === "--count") args.count = Number(argv[++i]);
    else if (arg === "--interval-ms") args.intervalMs = Number(argv[++i]);
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomValue() {
  return randomBytes(12).toString("hex");
}

async function main() {
  const kvUri = process.env.KEY_VAULT_URI;
  if (!kvUri) throw new Error("Missing KEY_VAULT_URI");

  const { secret, count, intervalMs } = parseArgs(process.argv);
  const secretName = secret || `burst-test-${randomBytes(4).toString("hex")}`;

  const credential = new DefaultAzureCredential();
  const kv = new SecretClient(kvUri, credential);

  for (let i = 0; i < count; i += 1) {
    const value = randomValue();
    const response = await kv.setSecret(secretName, value);
    console.log(
      JSON.stringify(
        {
          at: new Date().toISOString(),
          secretName,
          version: response?.properties?.version,
        },
        null,
        2
      )
    );
    if (i < count - 1) await sleep(intervalMs);
  }
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
