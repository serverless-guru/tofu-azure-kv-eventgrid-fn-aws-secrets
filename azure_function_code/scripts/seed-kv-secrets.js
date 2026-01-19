import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

function parseArgs(argv) {
  const args = { count: 3, updates: 2, prefix: "replication-test-" };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--count") args.count = Number(argv[++i]);
    else if (arg === "--updates") args.updates = Number(argv[++i]);
    else if (arg === "--prefix") args.prefix = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
  }
  return args;
}

function randomValue() {
  return randomBytes(12).toString("hex");
}

async function main() {
  const kvUri = process.env.KEY_VAULT_URI;
  if (!kvUri) throw new Error("Missing KEY_VAULT_URI");

  const { count, updates, prefix, out } = parseArgs(process.argv);
  const credential = new DefaultAzureCredential();
  const kv = new SecretClient(kvUri, credential);

  const secrets = [];
  for (let i = 0; i < count; i += 1) {
    const name = `${prefix}${i + 1}-${randomBytes(4).toString("hex")}`;
    let latestValue = randomValue();
    await kv.setSecret(name, latestValue);

    for (let u = 0; u < updates; u += 1) {
      latestValue = randomValue();
      await kv.setSecret(name, latestValue);
    }

    secrets.push({ name, latestValue });
  }

  const payload = {
    keyVaultUri: kvUri,
    createdAt: new Date().toISOString(),
    secrets,
  };

  const output = JSON.stringify(payload, null, 2);
  if (out) {
    await writeFile(out, output, "utf8");
  } else {
    process.stdout.write(`${output}\n`);
  }
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
