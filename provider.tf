provider "azurerm" {
  subscription_id = var.subscription_id
  features {}
}

provider "aws" {
  region = var.aws_region
}
