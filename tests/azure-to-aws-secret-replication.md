### Azure to AWS Secret Replication

### Objective

Validate real-time replication of secrets from Azure Key Vault to AWS Secrets Manager (us-east-1) with Azure Function and IAM Roles Anywhere.

### Prereqs

- Function code deployed and running.
- Azure CLI authenticated.
- AWS credentials available in environment for verification (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` if needed).
- `KEY_VAULT_URI` set for scripts.
- Optional: `AWS_SECRET_PREFIX` if your function prefixes AWS secret names.

### Steps

1) Run the seed script to create/update secrets.

```bash
export KEY_VAULT_URI="https://<kv-name>.vault.azure.net"
node azure_function_code/scripts/seed-kv-secrets.js --count 5 --updates 2 --prefix replication-test- --out /tmp/kv-seed.json
```

2) Confirm Event Grid emits `SecretNewVersionCreated` and `SecretUpdated`.

- Check Event Grid metrics or diagnostic logs for the system topic/subscription.
- Confirm Azure Function logs show processing for each secret/version.

3) Confirm the Azure Function:
   - reads the secret by `ObjectName` and `Version`
   - obtains short-lived AWS credentials with Roles Anywhere
   - writes to AWS Secrets Manager using `CreateSecret` first time then `PutSecretValue` for subsequent versions.

4) Verify secrets in both systems and compare values.

```bash
export KEY_VAULT_URI="https://<kv-name>.vault.azure.net"
export AWS_REGION="us-east-1"
node azure_function_code/scripts/verify-replication.js --input /tmp/kv-seed.json
```

### Expected outcome

- Secrets are created/updated in Azure Key Vault.
- Matching secrets exist in AWS Secrets Manager in us-east-1.
- AWS secret current value matches the latest Key Vault version value.
