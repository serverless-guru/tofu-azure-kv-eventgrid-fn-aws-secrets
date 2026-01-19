import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";
import { randomBytes } from "node:crypto";

function parseArgs(argv) {
  const args = { intervalMs: 30000 };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--secret") args.secret = argv[++i];
    else if (arg === "--interval-ms") args.intervalMs = Number(argv[++i]);
    else if (arg === "--count") args.count = Number(argv[++i]);
    else if (arg === "--duration-ms") args.durationMs = Number(argv[++i]);
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

  const { secret, intervalMs, count, durationMs } = parseArgs(process.argv);
  if (!count && !durationMs) {
    throw new Error("Provide --count or --duration-ms");
  }

  const secretName = secret || `credential-loop-${randomBytes(4).toString("hex")}`;
  const credential = new DefaultAzureCredential();
  const kv = new SecretClient(kvUri, credential);

  let iterations = 0;
  const start = Date.now();
  while (true) {
    const value = randomValue();
    const response = await kv.setSecret(secretName, value);
    const version = response?.properties?.version;
    console.log(
      JSON.stringify(
        {
          at: new Date().toISOString(),
          secretName,
          version,
        },
        null,
        2
      )
    );

    iterations += 1;
    if (count && iterations >= count) break;
    if (durationMs && Date.now() - start >= durationMs) break;

    await sleep(intervalMs);
  }
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
