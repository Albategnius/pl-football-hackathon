#!/usr/bin/env bash
# Deploy Producer Co-pilot to Azure Container Apps (image is built in Azure; no local Docker needed).
# Usage (Azure Cloud Shell):  bash infra/deploy-azure.sh
# Optional live model:        LLM_BASE_URL=... LLM_API_KEY=... LLM_MODEL=... bash infra/deploy-azure.sh
set -euo pipefail

APP_NAME="${APP_NAME:-producer-copilot}"
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-matchpulse}"
LOCATION="${LOCATION:-southeastasia}"
ENV_NAME="${ENV_NAME:-matchpulse-env}"

az account show >/dev/null 2>&1 || az login
az extension add --name containerapp --upgrade --only-show-errors
cd "$(dirname "$0")/.."

REG=$(az acr list -g "$RESOURCE_GROUP" --query "[0].loginServer" -o tsv 2>/dev/null || true)
az containerapp up --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --location "$LOCATION" \
  --environment "$ENV_NAME" --source . --ingress external --target-port 8000 \
  ${REG:+--registry-server "$REG"}

az containerapp update -n "$APP_NAME" -g "$RESOURCE_GROUP" --min-replicas 1 --max-replicas 1 --only-show-errors >/dev/null
# One replica on purpose: each visitor's console lives in memory, so all requests of a visitor must hit the same replica.

if [ -n "${LLM_API_KEY:-}" ]; then
  az containerapp secret set -n "$APP_NAME" -g "$RESOURCE_GROUP" --secrets llm-key="$LLM_API_KEY" --only-show-errors >/dev/null
  az containerapp update -n "$APP_NAME" -g "$RESOURCE_GROUP" --only-show-errors \
    --set-env-vars LLM_BASE_URL="${LLM_BASE_URL:-}" LLM_MODEL="${LLM_MODEL:-gpt-4.1-mini}" LLM_API_KEY=secretref:llm-key >/dev/null
fi

URL="https://$(az containerapp show -n "$APP_NAME" -g "$RESOURCE_GROUP" --query properties.configuration.ingress.fqdn -o tsv)"
for i in $(seq 1 20); do
  if BODY=$(curl -fsS "$URL/api/health" 2>/dev/null); then echo "HEALTHY: $BODY"; echo "URL: $URL"; exit 0; fi
  sleep 10
done
echo "Health check did not pass yet: az containerapp logs show -n $APP_NAME -g $RESOURCE_GROUP --follow"; exit 1
