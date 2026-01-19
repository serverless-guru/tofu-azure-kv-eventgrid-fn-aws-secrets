import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { readFile } from "node:fs/promises";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") args.input = argv[++i];
  }
  return args;
}

async function loadInput(path) {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
}

function mapSecretNameToAws(name) {
  const prefix = process.env.AWS_SECRET_PREFIX || "";
  return prefix ? `${prefix}${name}` : name;
}

async function main() {
  const kvUri = process.env.KEY_VAULT_URI;
  if (!kvUri) throw new Error("Missing KEY_VAULT_URI");

  const { input } = parseArgs(process.argv);
  if (!input) throw new Error("Missing --input path to seed output JSON");

  const seed = await loadInput(input);
  const secrets = seed.secrets || [];
  if (!secrets.length) throw new Error("No secrets in input payload");

  const credential = new DefaultAzureCredential();
  const kv = new SecretClient(kvUri, credential);
  const sm = new SecretsManagerClient({
    region: process.env.AWS_REGION || "us-east-1",
  });

  const failures = [];
  for (const { name } of secrets) {
    let kvValue;
    try {
      kvValue = (await kv.getSecret(name)).value;
    } catch (err) {
      failures.push({ name, error: `Key Vault read failed: ${err?.name || err}` });
      continue;
    }

    const awsName = mapSecretNameToAws(name);
    let awsValue;
    try {
      const resp = await sm.send(new GetSecretValueCommand({ SecretId: awsName }));
      awsValue = resp.SecretString;
    } catch (err) {
      failures.push({ name, error: `AWS read failed: ${err?.name || err}` });
      continue;
    }

    if (kvValue !== awsValue) {
      failures.push({ name, error: "Value mismatch between Key Vault and AWS" });
    }
  }

  if (failures.length) {
    console.error(JSON.stringify({ status: "failed", failures }, null, 2));
    process.exit(1);
  }

  console.log(
    JSON.stringify({ status: "ok", checked: secrets.length }, null, 2)
  );
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
