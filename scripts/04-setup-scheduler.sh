#!/usr/bin/env bash
# Create (or update) the Cloud Scheduler job that triggers the daily summary.
# Requires: service already deployed via 03-deploy.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
[ -f .env ] && source .env
set +a

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT in .env}"
REGION="${REGION:-asia-east1}"
SERVICE_NAME="${SERVICE_NAME:-line-ai-summary}"
JOB_NAME="${JOB_NAME:-daily-summary}"
SCHEDULE="${SUMMARY_SCHEDULE:-0 20 * * *}"
TZ="${TIMEZONE:-Asia/Taipei}"
CRON_SECRET="${CRON_SECRET:?Set CRON_SECRET in .env}"

SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')

echo "==> Service URL: ${SERVICE_URL}"
echo "==> Schedule: '${SCHEDULE}' (${TZ})"

if gcloud scheduler jobs describe "$JOB_NAME" --project "$PROJECT_ID" --location "$REGION" >/dev/null 2>&1; then
  echo "==> Updating existing job ${JOB_NAME}"
  gcloud scheduler jobs update http "$JOB_NAME" \
    --project "$PROJECT_ID" \
    --location "$REGION" \
    --schedule "$SCHEDULE" \
    --time-zone "$TZ" \
    --uri "${SERVICE_URL}/api/run-summary" \
    --http-method POST \
    --headers "X-Cron-Secret=${CRON_SECRET}"
else
  echo "==> Creating job ${JOB_NAME}"
  gcloud scheduler jobs create http "$JOB_NAME" \
    --project "$PROJECT_ID" \
    --location "$REGION" \
    --schedule "$SCHEDULE" \
    --time-zone "$TZ" \
    --uri "${SERVICE_URL}/api/run-summary" \
    --http-method POST \
    --headers "X-Cron-Secret=${CRON_SECRET}"
fi

echo
echo "Done. Daily summary will run at ${SCHEDULE} (${TZ})."
