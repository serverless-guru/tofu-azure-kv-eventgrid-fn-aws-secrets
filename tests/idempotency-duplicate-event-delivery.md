### Idempotency - Duplicate Event Delivery

### Objective

Verify that duplicate Event Grid deliveries do not cause duplicate replication for the same Key Vault secret version.

### Prereqs

- Function code deployed and running.
- Azure CLI authenticated.
- `KEY_VAULT_URI` and `AzureWebJobsStorage` known for identifying the dedupe container.
- Optional: `DEDUPE_CONTAINER` if you changed the default container name.
- Optional: `AWS_SECRET_PREFIX` if your function prefixes AWS secret names.

### Steps

1) Create a new version of a secret in Key Vault.

```bash
az keyvault secret set \
  --vault-name <kv-name> \
  --name "idempotency-test" \
  --value "value-$(date +%s)"
```

2) Observe the Azure Function writes a blob marker named `<secretName>/<version>` to the dedupe container.

- Use the Function logs to capture the secret name and version.
- Confirm the marker exists in the dedupe container in Storage.

3) Trigger the same event delivery again (or force retries) and observe:
   - the blob marker already exists
   - the function skips replication for that version

4) Confirm AWS Secrets Manager shows only one corresponding update for that version, with no extra writes attributable to duplicates.

### Expected outcome

- The first event processes successfully and creates the blob marker.
- Duplicate deliveries are skipped for the same `<secretName>/<version>`.
