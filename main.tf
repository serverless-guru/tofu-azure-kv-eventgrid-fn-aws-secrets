data "azurerm_client_config" "current" {}

data "archive_file" "func_zip" {
  type        = "zip"
  source_dir  = "${path.module}/azure_function_code"
  output_path = "${path.module}/build/functionapp.zip"
}

data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/aws_lambda_code"
  output_path = "${path.module}/build/demo_lambda.zip"
}

data "archive_file" "app_lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/aws_lambda_code"
  output_path = "${path.module}/build/function.zip"
}

data "archive_file" "sma_layer_zip" {
  type        = "zip"
  source_dir  = "${path.module}/layers/secrets-manager-agent"
  output_path = "${path.module}/build/secrets-manager-agent-layer.zip"
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
  lambda_name       = "${var.name_prefix}-demo-lambda-${local.suffix}"
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

resource "azurerm_storage_container" "dedupe" {
  name                  = "kvrep-dedupe"
  storage_account_id    = azurerm_storage_account.sa.id
  container_access_type = "private"
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
    FUNCTIONS_WORKER_RUNTIME = "node"
    AzureWebJobsStorage      = azurerm_storage_account.sa.primary_connection_string
    WEBSITE_RUN_FROM_PACKAGE = "1"
    KEY_VAULT_URI            = azurerm_key_vault.kv.vault_uri
    AzureWebJobsFeatureFlags = "EnableWorkerIndexing"
    DEDUPE_CONTAINER         = "kvrep-dedupe"
    AWS_REGION               = "${var.aws_region}"
    AWS_SQS_QUEUE_URL        = aws_sqs_queue.secret_refresh.url
    AWS_RA_TRUST_ANCHOR_ARN  = "arn:aws:rolesanywhere:${var.aws_region}:ACCOUNT_ID:trust-anchor/UUID"
    AWS_RA_PROFILE_ARN       = "arn:aws:rolesanywhere:${var.aws_region}:ACCOUNT_ID:profile/UUID"
    AWS_RA_ROLE_ARN          = "arn:aws:iam::ACCOUNT_ID:role/cross-account-demo"

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

resource "aws_iam_role" "demo_lambda" {
  name = "${var.name_prefix}-demo-lambda-role-${local.suffix}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action = "sts:AssumeRole"
      }
    ]
  })
  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "demo_lambda_basic" {
  role       = aws_iam_role.demo_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "demo_lambda_secrets" {
  name = "${var.name_prefix}-demo-lambda-secrets-${local.suffix}"
  role = aws_iam_role.demo_lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role_policy" "demo_lambda_sqs" {
  name = "${var.name_prefix}-demo-lambda-sqs-${local.suffix}"
  role = aws_iam_role.demo_lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ChangeMessageVisibility",
          "sqs:GetQueueUrl"
        ]
        Resource = aws_sqs_queue.secret_refresh.arn
      }
    ]
  })
}


resource "aws_lambda_function" "demo" {
  function_name = local.lambda_name
  role          = aws_iam_role.demo_lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs24.x"
  timeout       = 10

  architectures = ["arm64"]

  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  layers = [
    aws_lambda_layer_version.secrets_manager_agent.arn,
  ]

  environment {
    variables = {
      SECRET_NAME = "demo-secret"
    }
  }

  tags = var.tags
}

resource "aws_sqs_queue" "secret_refresh" {
  name                        = "${var.name_prefix}-secret-refresh-${local.suffix}.fifo"
  fifo_queue                  = true
  content_based_deduplication = true
  tags = var.tags
}

resource "aws_lambda_event_source_mapping" "demo_sqs" {
  event_source_arn = aws_sqs_queue.secret_refresh.arn
  function_name    = aws_lambda_function.demo.arn
  batch_size       = 10
  enabled          = true
}

data "aws_iam_policy_document" "lambda_exec_assume" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "lambda_exec" {
  name               = "${var.name_prefix}-lambda-exec-${local.suffix}"
  assume_role_policy = data.aws_iam_policy_document.lambda_exec_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "lambda_exec_basic" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "lambda_secrets" {
  statement {
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "lambda_secrets" {
  name   = "lambda-secrets-access"
  role   = aws_iam_role.lambda_exec.id
  policy = data.aws_iam_policy_document.lambda_secrets.json
}

resource "aws_lambda_layer_version" "secrets_manager_agent" {
  layer_name               = "secrets-manager-agent-extension"
  filename                 = data.archive_file.sma_layer_zip.output_path
  source_code_hash         = data.archive_file.sma_layer_zip.output_base64sha256

  compatible_runtimes      = ["nodejs24.x"]
  compatible_architectures = ["arm64"]
}
