#!/usr/bin/env bash
# Create/update Secret Manager secrets for sensitive credentials, and grant
# the Cloud Run runtime service account permission to read them.
# Requires: gcloud CLI authenticated, project set up via 01-setup-gcp.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
source .env
set +a

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT in .env}"
SERVICE_NAME="${SERVICE_NAME:-line-ai-summary}"

echo "==> Using project: ${PROJECT_ID}"
gcloud config set project "$PROJECT_ID" >/dev/null

echo "==> Enabling Secret Manager API"
gcloud services enable secretmanager.googleapis.com

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# secret_id env_var pairs, one per line. secret_id is namespaced with
# SERVICE_NAME so multiple services can share a project without colliding.
SECRETS_SPEC="
${SERVICE_NAME}-line-channel-access-token LINE_CHANNEL_ACCESS_TOKEN
${SERVICE_NAME}-line-channel-secret LINE_CHANNEL_SECRET
${SERVICE_NAME}-anthropic-api-key ANTHROPIC_API_KEY
${SERVICE_NAME}-cron-secret CRON_SECRET
"

echo "$SECRETS_SPEC" | while read -r SECRET_ID ENV_VAR; do
  [ -z "$SECRET_ID" ] && continue
  VALUE="${!ENV_VAR:?Set ${ENV_VAR} in .env}"

  if gcloud secrets describe "$SECRET_ID" >/dev/null 2>&1; then
    echo "==> Adding new version to existing secret ${SECRET_ID}"
  else
    echo "==> Creating secret ${SECRET_ID}"
    gcloud secrets create "$SECRET_ID" --replication-policy=automatic
  fi

  printf '%s' "$VALUE" | gcloud secrets versions add "$SECRET_ID" --data-file=-

  echo "==> Granting roles/secretmanager.secretAccessor on ${SECRET_ID} to ${RUNTIME_SA}"
  gcloud secrets add-iam-policy-binding "$SECRET_ID" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor" \
    --condition=None >/dev/null
done

echo
echo "Done. Run ./scripts/03-deploy.sh to deploy with these secrets mounted as env vars."
