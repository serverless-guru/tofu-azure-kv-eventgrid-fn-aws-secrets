### Performance and Latency

### Objective

Measure end-to-end latency from Key Vault secret version creation to AWS Secrets Manager availability.

### Prereqs

- Function code deployed and running.
- Azure CLI authenticated.
- Function logs accessible (Azure Portal or Log Analytics).

### Steps

1) Capture timestamps for:
   - Secret creation/update time in Azure Key Vault
   - Function invocation start time (from function logs)
   - AWS Secrets Manager write completion time (log after successful `CreateSecret` / `PutSecretValue`)

2) Compute latency:
   - KV update → Function start
   - Function start → AWS write complete
   - KV update → AWS write complete

### Expected outcome

- End-to-end latency is within acceptable bounds for near real-time replication.
