#!/usr/bin/env bash
# The VM's startup script (set by deploy/create-vm.sh), run as root on every boot: installs Docker with the compose
# plugin and a swap file once, and makes the folders deploy/release.sh and deploy/push-env.sh write to.
# The containers restart themselves after a reboot (restart: unless-stopped), so nothing else happens here.
set -euo pipefail

if ! command -v docker >/dev/null; then
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi

# Headroom for image builds, which peak above the running workers.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi
swapon -a

install -d -m 0755 /opt/konva
install -d -m 0700 /opt/konva/env
