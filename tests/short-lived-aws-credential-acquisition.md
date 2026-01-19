### Short-Lived AWS Credential Acquisition

### Objective

Confirm the Azure Function uses temporary AWS credentials obtained with IAM Roles Anywhere (no long-lived AWS keys).

### Prereqs

- Function code deployed and running.
- Azure CLI authenticated.
- `AWS_RA_TRUST_ANCHOR_ARN`, `AWS_RA_PROFILE_ARN`, `AWS_RA_ROLE_ARN`, `AWS_REGION=us-east-1` configured in the Function App.
- Ensure no `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` are configured in the Function App settings.

### Steps

1) Confirm that Function App has environment variables set:
   - `AWS_RA_TRUST_ANCHOR_ARN`, `AWS_RA_PROFILE_ARN`, `AWS_RA_ROLE_ARN`, `AWS_REGION=us-east-1`

2) Trigger secret creation/update in Key Vault.

3) Confirm replication succeeds.

4) Trigger additional updates over a period exceeding the credential lifetime and confirm replication continues to work without manual credential refresh.

### Expected outcome

- Replication succeeds repeatedly.
- No static AWS access keys are used.
- Temporary credentials refresh transparently as needed.
