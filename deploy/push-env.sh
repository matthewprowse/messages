#!/usr/bin/env bash
# Copies the workers' env files to the VM (docs/RUNBOOK.md, "Production VM"): apps/worker/.env and apps/ai/.env by
# default, or the files named in WORKER_ENV and AI_ENV. They land in /opt/konva/env, readable by root only, and are never
# in the repo or an image. Run deploy/release.sh afterwards so the containers pick them up.
set -euo pipefail

PROJECT="${PROJECT:-messages-keys}"
ZONE="${ZONE:-africa-south1-a}"
VM="${VM:-konva-workers}"
root="$(cd "$(dirname "$0")/.." && pwd)"
WORKER_ENV="${WORKER_ENV:-$root/apps/worker/.env}"
AI_ENV="${AI_ENV:-$root/apps/ai/.env}"

# Production must run encrypted: the workers refuse to start otherwise, so catch it here rather than in a crash loop.
for f in "$WORKER_ENV" "$AI_ENV"; do
  if grep -Eq '^ENCRYPT_(CONTENT|ADDRESSES)=false' "$f"; then
    echo "$f turns encryption off; the workers will not start in production." >&2
    exit 1
  fi
done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# The VM unwraps keys as its own service account (metadata server), so a laptop's key file path is dropped.
grep -Ev '^GOOGLE_APPLICATION_CREDENTIALS(_JSON)?=' "$WORKER_ENV" > "$tmp/worker.env" || true
grep -Ev '^GOOGLE_APPLICATION_CREDENTIALS(_JSON)?=' "$AI_ENV" > "$tmp/ai.env" || true
gcloud compute scp "$tmp/worker.env" "$tmp/ai.env" "$VM:/tmp/" --zone "$ZONE" --project "$PROJECT"
gcloud compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" --command \
  "sudo install -m 0600 -o root -g root /tmp/worker.env /tmp/ai.env /opt/konva/env/ && rm -f /tmp/worker.env /tmp/ai.env"
echo "Env files are on $VM. Run deploy/release.sh to restart the workers with them."
