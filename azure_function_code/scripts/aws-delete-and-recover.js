import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";
import {
  SecretsManagerClient,
  DeleteSecretCommand,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { randomBytes } from "node:crypto";

function parseArgs(argv) {
  const args = { waitMs: 60000, pollMs: 3000 };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--secret") args.secret = argv[++i];
    else if (arg === "--value") args.value = argv[++i];
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

async function main() {
  const kvUri = process.env.KEY_VAULT_URI;
  if (!kvUri) throw new Error("Missing KEY_VAULT_URI");

  const { secret, value, waitMs, pollMs } = parseArgs(process.argv);
  const secretName = secret || `recovery-test-${randomBytes(4).toString("hex")}`;
  const secretValue = value || randomBytes(12).toString("hex");

  const credential = new DefaultAzureCredential();
  const kv = new SecretClient(kvUri, credential);
  const sm = new SecretsManagerClient({
    region: process.env.AWS_REGION || "us-east-1",
  });

  const awsName = mapSecretNameToAws(secretName);
  try {
    await sm.send(
      new DeleteSecretCommand({
        SecretId: awsName,
        ForceDeleteWithoutRecovery: true,
      })
    );
  } catch {
    // ignore if missing
  }

  await kv.setSecret(secretName, secretValue);

  const start = Date.now();
  let replicated = false;
  while (Date.now() - start < waitMs) {
    try {
      const resp = await sm.send(new GetSecretValueCommand({ SecretId: awsName }));
      if (resp.SecretString === secretValue) {
        replicated = true;
        break;
      }
    } catch {
      // ignore until recreated
    }
    await sleep(pollMs);
  }

  const output = {
    secretName,
    awsName,
    recovered: replicated,
    waitedMs: Date.now() - start,
  };

  console.log(JSON.stringify(output, null, 2));
  if (!replicated) process.exit(2);
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
