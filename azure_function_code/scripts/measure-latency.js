import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { randomBytes } from "node:crypto";

function parseArgs(argv) {
  const args = { pollMs: 2000, timeoutMs: 60000 };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--secret") args.secret = argv[++i];
    else if (arg === "--value") args.value = argv[++i];
    else if (arg === "--poll-ms") args.pollMs = Number(argv[++i]);
    else if (arg === "--timeout-ms") args.timeoutMs = Number(argv[++i]);
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

  const { secret, value, pollMs, timeoutMs } = parseArgs(process.argv);
  const secretName = secret || `latency-test-${randomBytes(4).toString("hex")}`;
  const secretValue = value || randomBytes(12).toString("hex");

  const credential = new DefaultAzureCredential();
  const kv = new SecretClient(kvUri, credential);
  const sm = new SecretsManagerClient({
    region: process.env.AWS_REGION || "us-east-1",
  });

  const kvUpdateAt = new Date();
  await kv.setSecret(secretName, secretValue);

  const awsName = mapSecretNameToAws(secretName);
  const start = Date.now();
  let awsAvailableAt;
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await sm.send(new GetSecretValueCommand({ SecretId: awsName }));
      if (resp.SecretString === secretValue) {
        awsAvailableAt = new Date();
        break;
      }
    } catch {
      // ignore until replicated
    }
    await sleep(pollMs);
  }

  const output = {
    secretName,
    awsName,
    kvUpdateAt: kvUpdateAt.toISOString(),
    awsAvailableAt: awsAvailableAt ? awsAvailableAt.toISOString() : null,
    kvToAwsLatencyMs: awsAvailableAt ? awsAvailableAt - kvUpdateAt : null,
  };

  console.log(JSON.stringify(output, null, 2));
  if (!awsAvailableAt) process.exit(2);
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
