#!/usr/bin/env bash
# Creates the production VM for the workers, once, from a laptop with gcloud signed in (docs/RUNBOOK.md, "Production VM").
# It lives in the messages-keys project next to the KMS key, so the VM's own service account unwraps keys through the
# metadata server and no key file is needed. No ports are opened: the workers only make outgoing connections.
# Safe to run again: each step skips what already exists.
set -euo pipefail

PROJECT="${PROJECT:-messages-keys}"
REGION="${REGION:-africa-south1}"
ZONE="${ZONE:-africa-south1-a}"
VM="${VM:-konva-workers}"
# e2-medium (2 vCPU, 4 GB): the images are built on the VM, and pnpm install needs more than e2-small's 2 GB.
MACHINE="${MACHINE:-e2-medium}"
SA_NAME="konva-workers"
SA="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
KEY="projects/$PROJECT/locations/$REGION/keyRings/messages/cryptoKeys/user-data-keys"
here="$(cd "$(dirname "$0")" && pwd)"

gcloud services enable compute.googleapis.com logging.googleapis.com --project "$PROJECT"

if ! gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT" --display-name "Konva workers"
fi
# Only the data key: encrypt and decrypt with it, nothing else in the project.
gcloud kms keys add-iam-policy-binding "$KEY" --member "serviceAccount:$SA" \
  --role roles/cloudkms.cryptoKeyEncrypterDecrypter --project "$PROJECT" >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA" --role roles/logging.logWriter \
  --condition None >/dev/null

if ! gcloud compute instances describe "$VM" --zone "$ZONE" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud compute instances create "$VM" --project "$PROJECT" --zone "$ZONE" --machine-type "$MACHINE" \
    --image-family debian-12 --image-project debian-cloud --boot-disk-size 30GB --boot-disk-type pd-balanced \
    --service-account "$SA" --scopes cloud-platform \
    --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
    --metadata enable-oslogin=TRUE --metadata-from-file startup-script="$here/vm-startup.sh"
fi

echo "VM $VM is up in $ZONE. Docker installs on first boot (about two minutes)."
echo "Next: deploy/push-env.sh, then deploy/release.sh."
