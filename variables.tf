variable "location" {
  type        = string
  description = "Azure region"
  default     = "westeurope"
}

variable "resource_group_name" {
  type        = string
  description = "Resource group name"
  default     = "rg-kv-eg-func"
}

variable "name_prefix" {
  type        = string
  description = "Prefix used for resource names (keep it short)."
  default     = "kvrep"
}

variable "function_name" {
  type        = string
  description = "Azure Function name inside the Function App that receives Event Grid events (the actual function entrypoint name)."
  default     = "OnSecretChanged"
}

variable "tags" {
  type        = map(string)
  description = "Common tags"
  default     = {}
}

variable "subscription_id" {
  type        = string
  description = "Azure subscription ID (GUID)"
}

variable "aws_region" {
  type        = string
  description = "AWS region for Secrets Manager."
  default     = "us-east-1"
}

variable "aws_secrets_extension_layer_arn" {
  type        = string
  description = "ARN for AWS Parameters and Secrets Lambda Extension layer."
  default     = "arn:aws:lambda:us-east-1:177933569100:layer:AWS-Parameters-and-Secrets-Lambda-Extension:24"
}
