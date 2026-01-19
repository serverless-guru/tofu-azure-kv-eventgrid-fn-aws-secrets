import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  ListSecretVersionIdsCommand,
} from "@aws-sdk/client-secrets-manager";
import { randomBytes } from "node:crypto";

function parseArgs(argv) {
  const args = { updates: 3, waitMs: 60000, pollMs: 5000 };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--secret") args.secret = argv[++i];
    else if (arg === "--updates") args.updates = Number(argv[++i]);
    else if (arg === "--wait-ms") args.waitMs = Number(argv[++i]);
    else if (arg === "--poll-ms") args.pollMs = Number(argv[++i]);
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapSecretNameToAws(name) {
  const prefix = process.env.AWS_SECRET_PREFIX || "";
  return prefix ? `${prefix}${name}` : name;
}

function randomValue() {
  return randomBytes(12).toString("hex");
}

async function main() {
  const kvUri = process.env.KEY_VAULT_URI;
  if (!kvUri) throw new Error("Missing KEY_VAULT_URI");

  const { secret, updates, waitMs, pollMs } = parseArgs(process.argv);
  const secretName = secret || `version-prop-${randomBytes(4).toString("hex")}`;

  const credential = new DefaultAzureCredential();
  const kv = new SecretClient(kvUri, credential);

  let latestValue = randomValue();
  await kv.setSecret(secretName, latestValue);

  for (let i = 0; i < updates; i += 1) {
    latestValue = randomValue();
    await kv.setSecret(secretName, latestValue);
  }

  const sm = new SecretsManagerClient({
    region: process.env.AWS_REGION || "us-east-1",
  });
  const awsName = mapSecretNameToAws(secretName);
  const expectedVersions = updates + 1;

  const start = Date.now();
  let awsValue;
  let versions = [];
  let awscurrentOk = false;
  while (Date.now() - start < waitMs) {
    try {
      const list = await sm.send(
        new ListSecretVersionIdsCommand({ SecretId: awsName })
      );
      versions = list.Versions || [];

      const current = await sm.send(
        new GetSecretValueCommand({ SecretId: awsName })
      );
      awsValue = current.SecretString;
      awscurrentOk = awsValue === latestValue;
    } catch {
      awscurrentOk = false;
    }

    if (versions.length >= expectedVersions && awscurrentOk) break;
    await sleep(pollMs);
  }

  const output = {
    secretName,
    awsName,
    expectedVersions,
    observedVersions: versions.length,
    awscurrentMatches: awscurrentOk,
  };

  console.log(JSON.stringify(output, null, 2));
  if (!awscurrentOk || versions.length < expectedVersions) process.exit(2);
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
