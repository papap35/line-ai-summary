#!/usr/bin/env bash
# One-time setup for GitHub Actions CI/CD: creates a Workload Identity
# Federation pool/provider scoped to this GitHub repo (no long-lived key
# leaves GCP), and a deploy service account with the roles needed to run
# `gcloud run deploy --source` (see scripts/03-deploy.sh) from CI.
# Requires: gcloud CLI authenticated with IAM admin permissions on the project.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
[ -f .env ] && source .env
set +a

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT in .env}"
REGION="${REGION:-asia-east1}"
SERVICE_NAME="${SERVICE_NAME:-line-ai-summary}"
GITHUB_REPO="${GITHUB_REPO:?Set GITHUB_REPO=owner/repo in .env, e.g. papap35/line-ai-summary}"

POOL_ID="${SERVICE_NAME}-github-pool"
PROVIDER_ID="${SERVICE_NAME}-github-provider"
DEPLOY_SA_NAME="${SERVICE_NAME}-deployer"
DEPLOY_SA_EMAIL="${DEPLOY_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "==> Using project: ${PROJECT_ID}"
gcloud config set project "$PROJECT_ID" >/dev/null

echo "==> Enabling required APIs"
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

echo "==> Creating Workload Identity Pool (ignore error if it already exists)"
gcloud iam workload-identity-pools create "$POOL_ID" \
  --location=global \
  --display-name="GitHub Actions pool for ${SERVICE_NAME}" || true

echo "==> Creating Workload Identity Provider scoped to ${GITHUB_REPO}"
gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
  --location=global \
  --workload-identity-pool="$POOL_ID" \
  --display-name="GitHub Actions provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='${GITHUB_REPO}'" \
  --issuer-uri="https://token.actions.githubusercontent.com" || true

echo "==> Creating deploy service account (ignore error if it already exists)"
gcloud iam service-accounts create "$DEPLOY_SA_NAME" \
  --display-name="${SERVICE_NAME} CI/CD deployer" || true

# Roles required to run `gcloud run deploy --source` (builds via Cloud Build,
# pushes to Artifact Registry, deploys to Cloud Run, acts as the runtime SA).
# Project-level for simplicity; tighten to resource-level bindings later if desired.
for ROLE in roles/run.admin roles/iam.serviceAccountUser roles/cloudbuild.builds.editor roles/artifactregistry.writer roles/storage.admin; do
  echo "==> Granting ${ROLE} to ${DEPLOY_SA_EMAIL}"
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${DEPLOY_SA_EMAIL}" \
    --role="$ROLE" \
    --condition=None >/dev/null
done

echo "==> Allowing GitHub Actions (via OIDC) to impersonate the deploy service account"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${GITHUB_REPO}"

WIP="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"

echo
echo "Done. Add these in GitHub: repo Settings -> Secrets and variables -> Actions -> Variables tab:"
echo "  GCP_WORKLOAD_IDENTITY_PROVIDER = ${WIP}"
echo "  GCP_DEPLOY_SERVICE_ACCOUNT     = ${DEPLOY_SA_EMAIL}"
echo "  GCP_PROJECT_ID                 = ${PROJECT_ID}"
echo "  GCP_REGION                     = ${REGION}"
echo "  GCP_SERVICE_NAME               = ${SERVICE_NAME}"
echo
echo "Optional variables (mirror your .env non-secret config, used by the deploy workflow):"
echo "  TARGET_GROUP_ID, MESSAGE_RETENTION_DAYS, TIMEZONE, ADMIN_USER_ID, ADMIN_GROUP_ID"
