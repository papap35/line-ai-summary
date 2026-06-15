#!/usr/bin/env bash
# Deploy the app to Cloud Run: non-sensitive config from .env as plain env
# vars, sensitive credentials mounted from Secret Manager (see
# 02-setup-secrets.sh).
# Requires: gcloud CLI authenticated, project set up via 01-setup-gcp.sh
# and secrets created via 02-setup-secrets.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
source .env
set +a

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT in .env}"
REGION="${REGION:-asia-east1}"
SERVICE_NAME="${SERVICE_NAME:-line-ai-summary}"

ENV_VARS_FILE="$(mktemp)"
trap 'rm -f "$ENV_VARS_FILE"' EXIT

cat > "$ENV_VARS_FILE" <<EOF
TARGET_GROUP_ID: "${TARGET_GROUP_ID:-}"
MESSAGE_RETENTION_DAYS: "${MESSAGE_RETENTION_DAYS:-7}"
TIMEZONE: "${TIMEZONE:-Asia/Taipei}"
GOOGLE_CLOUD_PROJECT: "${PROJECT_ID}"
ADMIN_USER_ID: "${ADMIN_USER_ID:-}"
ADMIN_GROUP_ID: "${ADMIN_GROUP_ID:-}"
EOF

# LINE/Anthropic credentials and CRON_SECRET come from Secret Manager
# (created by ./scripts/02-setup-secrets.sh) rather than plain env vars.
SECRETS="LINE_CHANNEL_ACCESS_TOKEN=${SERVICE_NAME}-line-channel-access-token:latest"
SECRETS="${SECRETS},LINE_CHANNEL_SECRET=${SERVICE_NAME}-line-channel-secret:latest"
SECRETS="${SECRETS},ANTHROPIC_API_KEY=${SERVICE_NAME}-anthropic-api-key:latest"
SECRETS="${SECRETS},CRON_SECRET=${SERVICE_NAME}-cron-secret:latest"

echo "==> Deploying ${SERVICE_NAME} to Cloud Run (${REGION})"
gcloud run deploy "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --env-vars-file="$ENV_VARS_FILE" \
  --set-secrets="$SECRETS"

SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')

echo
echo "Deployed: ${SERVICE_URL}"
echo "Set this as the LINE webhook URL: ${SERVICE_URL}/webhook"
