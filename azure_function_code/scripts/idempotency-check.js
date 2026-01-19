import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";
import { BlobServiceClient } from "@azure/storage-blob";
import { randomBytes } from "node:crypto";

function parseArgs(argv) {
  const args = { waitMs: 30000, pollMs: 2000 };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--secret") args.secret = argv[++i];
    else if (arg === "--value") args.value = argv[++i];
    else if (arg === "--wait-ms") args.waitMs = Number(argv[++i]);
    else if (arg === "--poll-ms") args.pollMs = Number(argv[++i]);
    else if (arg === "--container") args.container = argv[++i];
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const kvUri = process.env.KEY_VAULT_URI;
  const storageConn = process.env.AzureWebJobsStorage;
  if (!kvUri) throw new Error("Missing KEY_VAULT_URI");
  if (!storageConn) throw new Error("Missing AzureWebJobsStorage");

  const { secret, value, waitMs, pollMs, container } = parseArgs(process.argv);
  const secretName = secret || `idempotency-test-${randomBytes(4).toString("hex")}`;
  const secretValue = value || randomBytes(12).toString("hex");
  const dedupeContainer = container || process.env.DEDUPE_CONTAINER || "kvrep-dedupe";

  const credential = new DefaultAzureCredential();
  const kv = new SecretClient(kvUri, credential);

  const response = await kv.setSecret(secretName, secretValue);
  const version = response?.properties?.version;
  if (!version) throw new Error("Missing secret version from Key Vault response");

  const blobService = BlobServiceClient.fromConnectionString(storageConn);
  const containerClient = blobService.getContainerClient(dedupeContainer);
  const blobName = `${encodeURIComponent(secretName)}/${version}`;
  const blobClient = containerClient.getBlockBlobClient(blobName);

  const start = Date.now();
  let exists = false;
  while (Date.now() - start < waitMs) {
    exists = await blobClient.exists();
    if (exists) break;
    await sleep(pollMs);
  }

  const output = {
    secretName,
    version,
    dedupeContainer,
    markerBlob: blobName,
    markerExists: exists,
    waitedMs: Date.now() - start,
  };

  console.log(JSON.stringify(output, null, 2));
  if (!exists) process.exit(2);
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
