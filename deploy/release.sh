#!/usr/bin/env bash
# Releases the workers to the VM (docs/RUNBOOK.md, "Production VM"): copies the repo at a commit (default origin/main, so
# only pushed code ships, never the working tree), gets the images, and rolls the sync worker, then the AI worker, then
# any optional connectors, waiting for each to report ready. Usage: deploy/release.sh [git ref]
#
# The commit must have passed CI on GitHub (checked with `gh api`; no answer means no release). With REGISTRY set (the
# Artifact Registry path CI pushes to, docs/RUNBOOK.md, "Images Built In CI") the ref must be a release tag, and the VM
# pulls the images CI built for it by digest instead of building them. With REQUIRE_SIGNED_TAG=1 the ref must also be a
# tag whose signature `git verify-tag` accepts. RELEASE_WITHOUT_CI=1 skips the CI check, for when GitHub is down and a
# release cannot wait; say so in the changelog.
set -euo pipefail

PROJECT="${PROJECT:-messages-keys}"
ZONE="${ZONE:-africa-south1-a}"
VM="${VM:-konva-workers}"
REGISTRY="${REGISTRY:-}"
# The CI jobs (.github/workflows/ci.yml) that must have passed on the commit.
REQUIRED_CHECKS="typescript python go docker"
cd "$(dirname "$0")/.."

git fetch --quiet --tags origin
ref="${1:-origin/main}"
commit="$(git rev-parse --verify "$ref^{commit}")"
echo "Releasing $(git log --oneline -1 "$commit") to $VM"

if [ "${REQUIRE_SIGNED_TAG:-}" = 1 ] && ! git verify-tag "$ref" >/dev/null 2>&1; then
  echo "$ref is not a tag with a signature git trusts (REQUIRE_SIGNED_TAG=1)." >&2
  exit 1
fi

if [ "${RELEASE_WITHOUT_CI:-}" = 1 ]; then
  echo "Warning: RELEASE_WITHOUT_CI=1, releasing without checking CI." >&2
else
  if ! command -v gh >/dev/null; then
    echo "The GitHub CLI (gh) is needed to check CI for $commit. Install it and run gh auth login." >&2
    exit 1
  fi
  repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
  # Only GitHub Actions' own runs count: any installed app with checks:write could post a run with the right name.
  if ! passed="$(gh api "repos/$repo/commits/$commit/check-runs?per_page=100" \
    --jq '[.check_runs[] | select(.status == "completed" and .conclusion == "success" and .app.slug == "github-actions") | .name] | join(",")')"; then
    echo "Could not read CI results for $commit from GitHub; not releasing." >&2
    exit 1
  fi
  for check in $REQUIRED_CHECKS; do
    case ",$passed," in
      *",$check,"*) ;;
      *) echo "CI job \"$check\" has not passed on $commit; not releasing. Push it and wait for CI." >&2; exit 1 ;;
    esac
  done
  # And main holds it: a green run on a branch nobody merged is not a release.
  if ! git merge-base --is-ancestor "$commit" origin/main; then
    echo "$commit is not on origin/main; not releasing. Merge it first." >&2
    exit 1
  fi
fi

# Images CI built, pinned by digest. Every image is resolved, so a connector turned on later on the VM is covered too.
images=""
if [ -n "$REGISTRY" ]; then
  if ! tag="$(git describe --exact-match --tags "$commit" 2>/dev/null)"; then
    echo "$commit has no tag. With REGISTRY set, release a tag CI built images for (vX.Y.Z)." >&2
    exit 1
  fi
  for pair in KONVA_WORKER_IMAGE=konva-worker KONVA_AI_IMAGE=konva-ai KONVA_INSTAGRAM_IMAGE=konva-ai-instagram \
    KONVA_ICLOUD_REMINDERS_IMAGE=konva-ai-icloud-reminders; do
    name="${pair#*=}"
    digest="$(gcloud artifacts docker images describe "$REGISTRY/$name:$tag" --format 'value(image_summary.digest)')"
    [[ "$digest" == sha256:* ]] || { echo "No image $REGISTRY/$name:$tag. Did the release-images workflow finish?" >&2; exit 1; }
    images="$images ${pair%%=*}=$REGISTRY/$name@$digest"
    echo "  $name@$digest"
  done
fi

git archive --format=tar.gz "$commit" | gcloud compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" --tunnel-through-iap --command "
  set -euo pipefail
  sudo rm -rf /opt/konva/src.new && sudo mkdir -p /opt/konva/src.new
  sudo tar xzf - -C /opt/konva/src.new
  echo $commit | sudo tee /opt/konva/src.new/RELEASE >/dev/null
  sudo rm -rf /opt/konva/src.old
  if [ -d /opt/konva/src ]; then sudo mv /opt/konva/src /opt/konva/src.old; fi
  sudo mv /opt/konva/src.new /opt/konva/src
  cd /opt/konva/src
  export COMPOSE_PROFILES=\"\$(cat /opt/konva/profiles 2>/dev/null || true)\"
  build=''
  if [ -n '$images' ]; then
    export $images
    sudo -E docker compose -f deploy/compose.yaml pull
    build=--no-build
  else
    # Built here, where deploy/vm-startup.sh keeps the build steps off the metadata server.
    sudo -E docker compose -f deploy/compose.yaml build
  fi
  # One at a time: a new container waits up to 90 s for the lease the old one held, and readiness waits for the lease.
  sudo -E docker compose -f deploy/compose.yaml up -d \$build --wait --wait-timeout 300 worker
  sudo -E docker compose -f deploy/compose.yaml up -d \$build --wait --wait-timeout 300 ai
  sudo -E docker compose -f deploy/compose.yaml up -d \$build --remove-orphans
  sudo docker image prune -f >/dev/null
  sudo -E docker compose -f deploy/compose.yaml ps
"
echo "Released $commit."
