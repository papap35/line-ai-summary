#!/usr/bin/env bash
# One-time GCP project setup: enable APIs, create Firestore DB + index,
# and a service account key for local development.
#
# Requires: gcloud CLI authenticated (gcloud auth login) with billing enabled
# on the target project. Reads GOOGLE_CLOUD_PROJECT and TIMEZONE-derived
# region from .env (falls back to asia-east1).
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
source .env
set +a

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT in .env}"
REGION="${REGION:-asia-east1}"
DEV_SA_NAME="${DEV_SA_NAME:-line-ai-summary-dev}"
DEV_SA_EMAIL="${DEV_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "==> Using project: ${PROJECT_ID} (region: ${REGION})"
gcloud config set project "$PROJECT_ID"

echo "==> Enabling required APIs"
gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com

echo "==> Creating Firestore database (Native mode), ignore error if it already exists"
gcloud firestore databases create --location="$REGION" || true

echo "==> Creating composite index for messages (groupId, timestamp)"
gcloud firestore indexes composite create \
  --collection-group=messages \
  --field-config=field-path=groupId,order=ascending \
  --field-config=field-path=timestamp,order=ascending || true

echo "==> Creating dev service account (if missing)"
gcloud iam service-accounts create "$DEV_SA_NAME" \
  --display-name="line-ai-summary local dev" || true

echo "==> Granting Firestore access to dev service account"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEV_SA_EMAIL}" \
  --role="roles/datastore.user" \
  --condition=None

echo "==> Creating local key file: service-account.json"
gcloud iam service-accounts keys create service-account.json \
  --iam-account="$DEV_SA_EMAIL"

echo
echo "Done. service-account.json created (gitignored) — set"
echo "  GOOGLE_APPLICATION_CREDENTIALS=./service-account.json"
echo "in .env for local development."
