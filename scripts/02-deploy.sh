#!/usr/bin/env bash
# Deploy the app to Cloud Run, passing app env vars from .env.
# Requires: gcloud CLI authenticated, project set up via 01-setup-gcp.sh.
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
LINE_CHANNEL_ACCESS_TOKEN: "${LINE_CHANNEL_ACCESS_TOKEN:?Set LINE_CHANNEL_ACCESS_TOKEN in .env}"
LINE_CHANNEL_SECRET: "${LINE_CHANNEL_SECRET:?Set LINE_CHANNEL_SECRET in .env}"
ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY:?Set ANTHROPIC_API_KEY in .env}"
TARGET_GROUP_ID: "${TARGET_GROUP_ID:-}"
MESSAGE_RETENTION_DAYS: "${MESSAGE_RETENTION_DAYS:-7}"
TIMEZONE: "${TIMEZONE:-Asia/Taipei}"
GOOGLE_CLOUD_PROJECT: "${PROJECT_ID}"
CRON_SECRET: "${CRON_SECRET:?Set CRON_SECRET in .env}"
EOF

echo "==> Deploying ${SERVICE_NAME} to Cloud Run (${REGION})"
gcloud run deploy "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --env-vars-file="$ENV_VARS_FILE"

SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')

echo
echo "Deployed: ${SERVICE_URL}"
echo "Set this as the LINE webhook URL: ${SERVICE_URL}/webhook"
