# Azure Key Vault -> Event Grid -> Azure Function (Managed Identity) - OpenTofu

Creates:
- Key Vault (RBAC enabled)
- Event Grid System Topic for the Key Vault
- Event subscription for SecretNewVersionCreated and SecretUpdated
- Linux Azure Function App (System Assigned Managed Identity)
- Role assignment: Key Vault Secrets User

## Prereqs
- [Azure CLI installed](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli?view=azure-cli-latest)
- Azure CLI authenticated (`az login`)
- [OpenTofu installed](https://opentofu.org/docs/intro/install/)
- Permissions to create resources and role assignments in the target subscription

## Deploy
```bash
tofu init
tofu apply
```

## Important: deploy your Function code
This project creates the Function App but does not publish function code.
Your function must exist with the name set by variable `function_name` (default: OnSecretChanged).

Event Grid subscription endpoint uses:
  <function_app_id>/functions/<function_name>

If you change the function entrypoint name, set:
```bash
tofu apply -var='function_name=YourFunctionName'
```

## Test

After deployment and publishing your function code, test the integration:

1) Create a secret or update it in Key Vault.

```bash
az keyvault secret set \
  --vault-name KV_NAME \
  --name "my-secret" \
  --value "super-secret-value"
```

Create a new version by running the command again with a different value.

```bash
az keyvault secret set \
  --vault-name KV_NAME \
  --name "my-secret" \
  --value "another-secret-value"
```

2) Event Grid emits SecretNewVersionCreated / SecretUpdated.
3) Function triggers and can read the secret using Managed Identity.