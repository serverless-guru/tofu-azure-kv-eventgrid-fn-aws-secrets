data "azurerm_client_config" "current" {}

data "archive_file" "func_zip" {
  type        = "zip"
  source_dir  = "${path.module}/function_code"
  output_path = "${path.module}/build/functionapp.zip"
}

resource "random_string" "suffix" {
  length  = 6
  upper   = false
  numeric = true
  special = false
}

locals {
  suffix = random_string.suffix.result
  storage_account_name = lower(replace("${var.name_prefix}${local.suffix}", "/[^a-z0-9]/", ""))

  key_vault_name = lower("${var.name_prefix}-kv-${local.suffix}")

  function_app_name = lower("${var.name_prefix}-func-${local.suffix}")
  plan_name         = "${var.name_prefix}-plan-${local.suffix}"
  ai_name           = "${var.name_prefix}-ai-${local.suffix}"
  system_topic_name = "${var.name_prefix}-kvt-${local.suffix}"
  eg_sub_name       = "${var.name_prefix}-sub-${local.suffix}"
}

resource "azurerm_resource_group" "rg" {
  name     = var.resource_group_name
  location = var.location
  tags     = var.tags
}
resource "azurerm_storage_account" "sa" {
  name                     = local.storage_account_name
  resource_group_name      = azurerm_resource_group.rg.name
  location                 = azurerm_resource_group.rg.location
  account_tier             = "Standard"
  account_replication_type = "LRS"

  allow_nested_items_to_be_public = false
  min_tls_version                 = "TLS1_2"

  tags = var.tags
}

resource "azurerm_application_insights" "ai" {
  name                = local.ai_name
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  application_type    = "web"
  tags                = var.tags
}

resource "azurerm_service_plan" "plan" {
  name                = local.plan_name
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  os_type             = "Linux"
  sku_name            = "Y1"
  tags                = var.tags
}

resource "azurerm_key_vault" "kv" {
  name                = local.key_vault_name
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

  tenant_id = data.azurerm_client_config.current.tenant_id
  sku_name  = "standard"

  rbac_authorization_enabled = true

  purge_protection_enabled   = true
  soft_delete_retention_days = 7

  tags = var.tags
}

resource "azurerm_linux_function_app" "func" {
  name                = local.function_app_name
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

  service_plan_id            = azurerm_service_plan.plan.id
  storage_account_name       = azurerm_storage_account.sa.name
  storage_account_access_key = azurerm_storage_account.sa.primary_access_key

  https_only = true

  identity {
    type = "SystemAssigned"
  }

  zip_deploy_file = data.archive_file.func_zip.output_path

  site_config {
    application_insights_key               = azurerm_application_insights.ai.instrumentation_key
    application_insights_connection_string = azurerm_application_insights.ai.connection_string

    application_stack {
      node_version = "22"
    }
  }

  app_settings = {
    "FUNCTIONS_WORKER_RUNTIME" = "node"
    "AzureWebJobsStorage"      = azurerm_storage_account.sa.primary_connection_string
    "WEBSITE_RUN_FROM_PACKAGE" = "1"
    "KEY_VAULT_URI" = azurerm_key_vault.kv.vault_uri
    "AzureWebJobsFeatureFlags" = "EnableWorkerIndexing"
  }

  tags = var.tags
}

resource "azurerm_role_assignment" "kv_secrets_user" {
  scope                = azurerm_key_vault.kv.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_linux_function_app.func.identity[0].principal_id
}

resource "azurerm_role_assignment" "kv_secrets_officer_deployer" {
  scope                = azurerm_key_vault.kv.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}


resource "azurerm_eventgrid_system_topic" "kv_topic" {
  name                = local.system_topic_name
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

  source_resource_id = azurerm_key_vault.kv.id
  topic_type         = "Microsoft.KeyVault.vaults"

  tags = var.tags
}

resource "azurerm_eventgrid_system_topic_event_subscription" "kv_to_func" {
  name                = local.eg_sub_name
  system_topic        = azurerm_eventgrid_system_topic.kv_topic.name
  resource_group_name = azurerm_resource_group.rg.name

  included_event_types = [
    "Microsoft.KeyVault.SecretNewVersionCreated",
    "Microsoft.KeyVault.SecretUpdated"
  ]

  azure_function_endpoint {
    function_id = "${azurerm_linux_function_app.func.id}/functions/${var.function_name}"
  }

  retry_policy {
    max_delivery_attempts = 30
    event_time_to_live    = 1440
  }

  depends_on = [
    azurerm_role_assignment.kv_secrets_user
  ]
}

resource "aws_secretsmanager_secret" "kv_replica" {
  name = var.aws_secret_name
  tags = var.tags
}

resource "aws_secretsmanager_secret_version" "kv_replica" {
  count         = var.aws_secret_string == null ? 0 : 1
  secret_id     = aws_secretsmanager_secret.kv_replica.id
  secret_string = var.aws_secret_string
}
