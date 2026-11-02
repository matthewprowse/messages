#!/usr/bin/env bash
# Releases the workers to the VM (docs/RUNBOOK.md, "Production VM"): copies the repo at a commit (default origin/main, so
# only pushed code ships, never the working tree), builds the images on the VM, and rolls the sync worker, then the AI
# worker, then any optional connectors, waiting for each to report ready. Usage: deploy/release.sh [git ref]
set -euo pipefail

PROJECT="${PROJECT:-messages-keys}"
ZONE="${ZONE:-africa-south1-a}"
VM="${VM:-konva-workers}"
cd "$(dirname "$0")/.."

git fetch --quiet origin
ref="${1:-origin/main}"
commit="$(git rev-parse --verify "$ref^{commit}")"
echo "Releasing $(git log --oneline -1 "$commit") to $VM"

git archive --format=tar.gz "$commit" | gcloud compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" --command "
  set -euo pipefail
  sudo rm -rf /opt/konva/src.new && sudo mkdir -p /opt/konva/src.new
  sudo tar xzf - -C /opt/konva/src.new
  echo $commit | sudo tee /opt/konva/src.new/RELEASE >/dev/null
  sudo rm -rf /opt/konva/src.old
  if [ -d /opt/konva/src ]; then sudo mv /opt/konva/src /opt/konva/src.old; fi
  sudo mv /opt/konva/src.new /opt/konva/src
  cd /opt/konva/src
  export COMPOSE_PROFILES=\"\$(cat /opt/konva/profiles 2>/dev/null || true)\"
  sudo -E docker compose -f deploy/compose.yaml build
  # One at a time: a new container waits up to 90 s for the lease the old one held, and readiness waits for the lease.
  sudo -E docker compose -f deploy/compose.yaml up -d --wait --wait-timeout 300 worker
  sudo -E docker compose -f deploy/compose.yaml up -d --wait --wait-timeout 300 ai
  sudo -E docker compose -f deploy/compose.yaml up -d --remove-orphans
  sudo docker image prune -f >/dev/null
  sudo -E docker compose -f deploy/compose.yaml ps
"
echo "Released $commit."
