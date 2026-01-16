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

variable "aws_secret_name" {
  type        = string
  description = "Name for the AWS Secrets Manager secret."
  default     = "kv-eventgrid-secret"
}

variable "aws_secret_string" {
  type        = string
  description = "Optional initial secret value for AWS Secrets Manager."
  sensitive   = true
  default     = null
  nullable    = true
}
