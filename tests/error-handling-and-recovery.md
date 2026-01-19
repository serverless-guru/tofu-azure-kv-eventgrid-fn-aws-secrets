### Error Handling and Recovery

### Objective

Validate system behavior under common failure modes and confirm automatic recovery.

### Prereqs

- Function code deployed and running.
- Azure CLI authenticated.
- AWS credentials available for Secrets Manager operations.
- Access to Key Vault secrets for the Roles Anywhere cert/key.

### Steps

1) **AWS secret missing**
   - Delete a replicated secret in AWS Secrets Manager.
   - Create a new version in Key Vault.
   - Verify the Function recreates the AWS secret (`CreateSecret`) and continues replication.

2) **Roles Anywhere / cert issues**
   - Temporarily break access to the Key Vault cert/key secrets.
   - Trigger a Key Vault update and confirm the function fails.
   - Restore permission and re-trigger.
   - Confirm replication succeeds.

3) **Transient AWS failures**
   - Simulate throttling by triggering many updates quickly.
   - Confirm retries occur, and idempotency prevents duplicate processing for the same version.

### Expected outcome

- Deleted AWS secrets are recreated on next event.
- Certificate/permission issues cause visible failures and succeed after remediation.
- Transient failures recover without creating duplicate writes for the same Key Vault version.
