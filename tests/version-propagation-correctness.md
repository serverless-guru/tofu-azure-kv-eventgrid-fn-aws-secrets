### Version Propagation Correctness

### Objective

Ensure each Key Vault secret version maps to a new version in AWS Secrets Manager, and the latest becomes current.

### Prereqs

- Function code deployed and running.
- Azure CLI authenticated.
- AWS credentials available for Secrets Manager reads.
- Optional: `AWS_SECRET_PREFIX` if your function prefixes AWS secret names.

### Steps

1) Create a secret `my-secret` in Key Vault.

```bash
az keyvault secret set \
  --vault-name <kv-name> \
  --name "my-secret" \
  --value "value-1"
```

2) Update it N times to create N new versions.

```bash
for i in $(seq 2 5); do
  az keyvault secret set \
    --vault-name <kv-name> \
    --name "my-secret" \
    --value "value-${i}"
done
```

3) In AWS Secrets Manager:
   - verify multiple versions exist
   - verify the latest is `AWSCURRENT`

4) Fetch the latest value in Key Vault and compare to AWS `AWSCURRENT` value.

```bash
aws secretsmanager get-secret-value \
  --region us-east-1 \
  --secret-id <aws-secret-name>
```

### Expected outcome

- Each Key Vault version results in an AWS version.
- Latest Key Vault version value equals AWS `AWSCURRENT`.
