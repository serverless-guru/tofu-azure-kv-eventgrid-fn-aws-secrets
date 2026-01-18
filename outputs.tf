output "resource_group" {
  value = azurerm_resource_group.rg.name
}

output "key_vault_name" {
  value = azurerm_key_vault.kv.name
}

output "key_vault_uri" {
  value = azurerm_key_vault.kv.vault_uri
}

output "function_app_name" {
  value = azurerm_linux_function_app.func.name
}

output "function_app_id" {
  value = azurerm_linux_function_app.func.id
}

output "eventgrid_system_topic_name" {
  value = azurerm_eventgrid_system_topic.kv_topic.name
}

output "eventgrid_subscription_name" {
  value = azurerm_eventgrid_system_topic_event_subscription.kv_to_func.name
}
