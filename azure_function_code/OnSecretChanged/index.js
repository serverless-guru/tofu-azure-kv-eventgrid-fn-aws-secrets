import { SecretClient } from "@azure/keyvault-secrets";
import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import {
  SecretsManagerClient,
  DescribeSecretCommand,
  CreateSecretCommand,
  PutSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

import { copyFile, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const KV_URI = process.env.KEY_VAULT_URI;
const STORAGE_CONN = process.env.AzureWebJobsStorage;
const CONTAINER = process.env.DEDUPE_CONTAINER || "kvrep-dedupe";

const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const AWS_RA_TRUST_ANCHOR_ARN = process.env.AWS_RA_TRUST_ANCHOR_ARN;
const AWS_RA_PROFILE_ARN = process.env.AWS_RA_PROFILE_ARN;
const AWS_RA_ROLE_ARN = process.env.AWS_RA_ROLE_ARN;

const AWS_SECRET_PREFIX = process.env.AWS_SECRET_PREFIX || "";
const SIGNING_HELPER_PATH =
  process.env.AWS_SIGNING_HELPER_PATH || "/home/site/wwwroot/bin/aws_signing_helper";

const KV_CERT_NAME = process.env.AWS_RA_CERT_SECRET_NAME || "aws-ra-cert-pem";
const KV_KEY_NAME = process.env.AWS_RA_KEY_SECRET_NAME || "aws-ra-key-pem";
const KV_CHAIN_NAME = process.env.AWS_RA_CHAIN_SECRET_NAME || "aws-ra-chain-pem";

if (!KV_URI) throw new Error("Missing KEY_VAULT_URI");
if (!STORAGE_CONN) throw new Error("Missing AzureWebJobsStorage");

const kv = new SecretClient(KV_URI, new DefaultAzureCredential());
const blobService = BlobServiceClient.fromConnectionString(STORAGE_CONN);
const container = blobService.getContainerClient(CONTAINER);

let smClient;
let smClientExpiresAt = 0;

function normalizeSubjectToName(subject) {
  if (!subject) return undefined;
  const s = String(subject).trim();
  if (!s) return undefined;
  if (s.includes("/")) return s.split("/").filter(Boolean).pop();
  return s;
}

function parseNameVersionFromId(id) {
  if (!id) return {};
  try {
    const u = new URL(String(id));
    const parts = u.pathname.split("/").filter(Boolean);
    const i = parts.lastIndexOf("secrets");
    if (i >= 0 && parts.length >= i + 3) {
      return { name: parts[i + 1], version: parts[i + 2] };
    }
    return {};
  } catch {
    return {};
  }
}

async function tryMarkOnce(secretName, version, context) {
  context?.log(`tryMarkOnce: ensure container ${CONTAINER}`);
  await container.createIfNotExists();
  const key = `${encodeURIComponent(secretName)}/${version}`;
  const blob = container.getBlockBlobClient(key);
  try {
    context?.log(`tryMarkOnce: writing marker blob ${key}`);
    await blob.upload("", 0, { conditions: { ifNoneMatch: "*" } });
    return true;
  } catch (e) {
    if (e?.statusCode === 409 || e?.statusCode === 412) return false;
    throw e;
  }
}

async function getSecretsManagerClient(context) {
  const now = Date.now();
  if (smClient && now < smClientExpiresAt - 60_000) {
    context?.log("getSecretsManagerClient: using cached client");
    return smClient;
  }

  if (!AWS_RA_TRUST_ANCHOR_ARN || !AWS_RA_PROFILE_ARN || !AWS_RA_ROLE_ARN) {
    throw new Error(
      "Missing AWS Roles Anywhere env vars (AWS_RA_TRUST_ANCHOR_ARN, AWS_RA_PROFILE_ARN, AWS_RA_ROLE_ARN)"
    );
  }

  const helperTmpPath = join(tmpdir(), "aws_signing_helper");
  context?.log(`getSecretsManagerClient: copy signing helper to ${helperTmpPath}`);
  await copyFile(SIGNING_HELPER_PATH, helperTmpPath);
  context?.log("getSecretsManagerClient: chmod signing helper");
  await chmod(helperTmpPath, 0o755);

  context?.log("getSecretsManagerClient: fetch cert/key from Key Vault");
  const certPem = (await kv.getSecret(KV_CERT_NAME)).value;
  const keyPem = (await kv.getSecret(KV_KEY_NAME)).value;

  let chainPem;
  try {
    context?.log("getSecretsManagerClient: fetch chain from Key Vault");
    chainPem = (await kv.getSecret(KV_CHAIN_NAME)).value;
  } catch {
    context?.log("getSecretsManagerClient: chain not found, continuing");
    chainPem = undefined;
  }

  if (!certPem || !keyPem) throw new Error("Missing Roles Anywhere certificate/key in Key Vault");

  const certPath = join(tmpdir(), "aws-ra-cert.pem");
  const keyPath = join(tmpdir(), "aws-ra-key.pem");
  const chainPath = join(tmpdir(), "aws-ra-chain.pem");

  context?.log("getSecretsManagerClient: write cert/key temp files");
  await writeFile(certPath, certPem, { mode: 0o600 });
  await writeFile(keyPath, keyPem, { mode: 0o600 });
  context?.log("getSecretsManagerClient: write chain temp file (if present)");
  if (chainPem) await writeFile(chainPath, chainPem, { mode: 0o600 });

  const args = [
    "credential-process",
    "--region",
    AWS_REGION,
    "--trust-anchor-arn",
    AWS_RA_TRUST_ANCHOR_ARN,
    "--profile-arn",
    AWS_RA_PROFILE_ARN,
    "--role-arn",
    AWS_RA_ROLE_ARN,
    "--certificate",
    certPath,
    "--private-key",
    keyPath,
  ];
  if (chainPem) args.push("--intermediates", chainPath);

  context?.log("getSecretsManagerClient: exec aws_signing_helper");
  const { stdout, stderr } = await execFileAsync(helperTmpPath, args, {
    timeout: 20000,
    maxBuffer: 1024 * 1024,
  });
  if (stderr) context?.log(`getSecretsManagerClient: helper stderr ${stderr.trim()}`);

  context?.log("getSecretsManagerClient: parse credentials");
  const parsed = JSON.parse(stdout);

  if (!parsed?.AccessKeyId || !parsed?.SecretAccessKey || !parsed?.SessionToken) {
    throw new Error("Invalid credential-process output");
  }

  const expiration = parsed.Expiration ? new Date(parsed.Expiration) : undefined;
  smClientExpiresAt = expiration ? expiration.getTime() : now + 30 * 60_000;

  const credentials = {
    accessKeyId: parsed.AccessKeyId,
    secretAccessKey: parsed.SecretAccessKey,
    sessionToken: parsed.SessionToken,
    expiration,
  };

  context?.log("getSecretsManagerClient: create SecretsManagerClient");
  smClient = new SecretsManagerClient({ region: AWS_REGION, credentials });
  return smClient;
}

function mapSecretNameToAws(secretName) {
  return AWS_SECRET_PREFIX ? `${AWS_SECRET_PREFIX}${secretName}` : secretName;
}

async function upsertSecretAws(secretName, secretValue, context) {
  context?.log(`upsertSecretAws: init client for ${secretName}`);
  const sm = await getSecretsManagerClient(context);
  const awsName = mapSecretNameToAws(secretName);

  let exists = true;
  try {
    context?.log(`upsertSecretAws: describe ${awsName}`);
    await sm.send(new DescribeSecretCommand({ SecretId: awsName }));
  } catch (e) {
    if (e?.name === "ResourceNotFoundException") exists = false;
    else throw e;
  }

  if (!exists) {
    try {
      context?.log(`upsertSecretAws: create ${awsName}`);
      await sm.send(new CreateSecretCommand({ Name: awsName, SecretString: secretValue }));
      return;
    } catch (e) {
      if (e?.name !== "ResourceExistsException") throw e;
    }
  }

  context?.log(`upsertSecretAws: put value for ${awsName}`);
  await sm.send(new PutSecretValueCommand({ SecretId: awsName, SecretString: secretValue }));
}

export async function run(context, eventGridEvent) {
  try {
    context.log("run: start");
    const data = eventGridEvent?.data || {};
    const id = data.Id ?? data.id;
    const parsed = parseNameVersionFromId(id);

    const secretName =
      data.ObjectName ??
      data.objectName ??
      parsed.name ??
      normalizeSubjectToName(eventGridEvent?.subject);

    const version = data.Version ?? data.version ?? parsed.version;

    context.log(
      `run: parsed name=${secretName || "missing"} version=${version || "missing"} eventType=${
        eventGridEvent?.eventType || "unknown"
      }`
    );

    if (!secretName || !version) {
      context.log(`run: skip missing name/version subject=${eventGridEvent?.subject || "n/a"} id=${id || "n/a"}`);
      return;
    }

    const firstTime = await tryMarkOnce(secretName, version, context);
    context.log(`run: dedupe firstTime=${firstTime}`);
    if (!firstTime) return;

    context.log(`run: read secret ${secretName}@${version}`);
    const secret = await kv.getSecret(secretName, { version });
    const secretValue = secret.value;
    context.log(`run: secret value ${secretValue == null ? "missing" : "loaded"}`);
    if (secretValue == null) return;

    await upsertSecretAws(secretName, secretValue, context);

    context.log(`Replicated ${secretName}@${version} to AWS (${AWS_REGION})`);
  } catch (e) {
    context.log.error(e?.stack || e);
    throw e;
  }
}
