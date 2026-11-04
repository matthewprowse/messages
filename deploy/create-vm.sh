#!/usr/bin/env bash
# Creates the production VM for the workers, once, from a laptop with gcloud signed in (docs/RUNBOOK.md, "Production VM").
# It lives in the messages-keys project next to the KMS key, so the VM's own service account unwraps keys through the
# metadata server and no key file is needed. The VM has no public address: it sits on its own network, reaches the
# internet through Cloud NAT and Google APIs through Private Google Access, and SSH is only open to IAP's range, so
# `gcloud compute ssh --tunnel-through-iap` is the one way in, behind OS Login with two-step verification.
# Safe to run again: each step skips what already exists.
set -euo pipefail

PROJECT="${PROJECT:-messages-keys}"
REGION="${REGION:-africa-south1}"
ZONE="${ZONE:-africa-south1-a}"
VM="${VM:-konva-workers}"
# e2-medium (2 vCPU, 4 GB): the images are built on the VM, and pnpm install needs more than e2-small's 2 GB.
MACHINE="${MACHINE:-e2-medium}"
NETWORK="${NETWORK:-konva}"
SUBNET="${SUBNET:-konva-workers}"
SUBNET_RANGE="${SUBNET_RANGE:-10.10.0.0/24}"
SA_NAME="konva-workers"
SA="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
KEY="projects/$PROJECT/locations/$REGION/keyRings/messages/cryptoKeys/user-data-keys"
here="$(cd "$(dirname "$0")" && pwd)"

gcloud services enable compute.googleapis.com logging.googleapis.com monitoring.googleapis.com iap.googleapis.com \
  --project "$PROJECT"

if ! gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT" --display-name "Konva workers"
fi
# Only the data key: encrypt and decrypt with it, nothing else in the project. Logs and the Ops Agent's host metrics
# (memory and disk, for the alerts in docs/RUNBOOK.md) are write only.
gcloud kms keys add-iam-policy-binding "$KEY" --member "serviceAccount:$SA" \
  --role roles/cloudkms.cryptoKeyEncrypterDecrypter --project "$PROJECT" >/dev/null
for role in roles/logging.logWriter roles/monitoring.metricWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA" --role "$role" --condition None >/dev/null
done

# A network of its own, so the default network's allow-ssh and allow-rdp rules (open to the world) never apply.
if ! gcloud compute networks describe "$NETWORK" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud compute networks create "$NETWORK" --project "$PROJECT" --subnet-mode custom
fi
if ! gcloud compute networks subnets describe "$SUBNET" --region "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud compute networks subnets create "$SUBNET" --project "$PROJECT" --region "$REGION" --network "$NETWORK" \
    --range "$SUBNET_RANGE" --enable-private-ip-google-access
fi
# Outgoing only: Gmail, WhatsApp, IMAP and the rest are reached through NAT; nothing can connect in.
if ! gcloud compute routers describe konva-router --region "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud compute routers create konva-router --project "$PROJECT" --region "$REGION" --network "$NETWORK"
fi
if ! gcloud compute routers nats describe konva-nat --router konva-router --region "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud compute routers nats create konva-nat --project "$PROJECT" --region "$REGION" --router konva-router \
    --auto-allocate-nat-external-ips --nat-all-subnet-ip-ranges
fi
# SSH from Identity-Aware Proxy only (its published range). No other ingress rule exists on this network.
if ! gcloud compute firewall-rules describe konva-allow-iap-ssh --project "$PROJECT" >/dev/null 2>&1; then
  gcloud compute firewall-rules create konva-allow-iap-ssh --project "$PROJECT" --network "$NETWORK" \
    --direction INGRESS --action allow --rules tcp:22 --source-ranges 35.235.240.0/20 --target-tags konva-workers
fi

if ! gcloud compute instances describe "$VM" --zone "$ZONE" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud compute instances create "$VM" --project "$PROJECT" --zone "$ZONE" --machine-type "$MACHINE" \
    --image-family debian-12 --image-project debian-cloud --boot-disk-size 30GB --boot-disk-type pd-balanced \
    --network "$NETWORK" --subnet "$SUBNET" --no-address --tags konva-workers \
    --service-account "$SA" --scopes cloud-platform \
    --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
    --metadata enable-oslogin=TRUE,enable-oslogin-2fa=TRUE --metadata-from-file startup-script="$here/vm-startup.sh"
else
  # An existing VM keeps its network (moving it means recreating it), but always gets the current sign-in rules and
  # startup script; the script runs again at the next boot.
  gcloud compute instances add-metadata "$VM" --zone "$ZONE" --project "$PROJECT" \
    --metadata enable-oslogin=TRUE,enable-oslogin-2fa=TRUE --metadata-from-file startup-script="$here/vm-startup.sh"
  if [ -n "$(gcloud compute instances describe "$VM" --zone "$ZONE" --project "$PROJECT" \
    --format 'value(networkInterfaces[0].accessConfigs[0].natIP)')" ]; then
    echo "Warning: $VM still has a public address. See docs/RUNBOOK.md, Production VM, to move it." >&2
  fi
fi

echo "VM $VM is up in $ZONE. Docker and the Ops Agent install on first boot (about three minutes)."
echo "Next: deploy/push-env.sh, then deploy/release.sh."
