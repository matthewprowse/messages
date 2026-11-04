#!/usr/bin/env bash
# The VM's startup script (set by deploy/create-vm.sh), run as root on every boot: installs Docker with the compose
# plugin, the Google Cloud Ops Agent and a swap file once, keeps containers off the metadata server, ships container
# logs to Cloud Logging, and makes the folders deploy/release.sh and deploy/push-env.sh write to.
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

# The metadata server hands out tokens for the VM's service account, which may decrypt every user's data key with KMS.
# The workers need that (packages/crypto/src/wrap.ts and apps/ai/ai/keys.py fetch their token from it), so only the two
# compose bridges (deploy/compose.yaml, networks) may reach it. Everything else in a container is refused: image builds,
# where pnpm and pip run install scripts from the internet, and any ad hoc `docker run`. DNS stays open, because
# containers on docker0 resolve names through the same address. A systemd unit puts the rules back each time Docker
# starts, as iptables is empty after a reboot.
cat > /usr/local/sbin/konva-metadata-guard <<'EOF'
#!/bin/sh
# Keeps containers off the metadata server except the Konva workers' bridges (deploy/vm-startup.sh).
set -eu
chain=KONVA-METADATA
iptables -N "$chain" 2>/dev/null || iptables -F "$chain"
iptables -A "$chain" -p udp --dport 53 -j RETURN
iptables -A "$chain" -p tcp --dport 53 -j RETURN
iptables -A "$chain" -i konva-core -j RETURN
iptables -A "$chain" -i konva-conn -j RETURN
# Refused rather than dropped, so a build step that probes for credentials fails at once instead of hanging.
iptables -A "$chain" -p tcp -j REJECT --reject-with tcp-reset
iptables -A "$chain" -j REJECT
iptables -C DOCKER-USER -d 169.254.169.254/32 -j "$chain" 2>/dev/null || iptables -I DOCKER-USER -d 169.254.169.254/32 -j "$chain"
EOF
chmod 0755 /usr/local/sbin/konva-metadata-guard
cat > /etc/systemd/system/konva-metadata-guard.service <<'EOF'
[Unit]
Description=Keep containers off the metadata server (Konva)
After=docker.service
BindsTo=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/konva-metadata-guard

[Install]
WantedBy=docker.service
EOF
systemctl daemon-reload
systemctl enable konva-metadata-guard.service
systemctl restart konva-metadata-guard.service

# Container logs to Cloud Logging. The Ops Agent tails Docker's json-file logs (so `docker compose logs` keeps working
# on the VM) rather than the gcplogs driver, which stops a container from starting while Cloud Logging is unreachable.
# Installed from Google's signed apt repository, the same one its install script adds.
if ! dpkg -s google-cloud-ops-agent >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor --yes -o /etc/apt/keyrings/google-cloud.gpg
  echo "deb [signed-by=/etc/apt/keyrings/google-cloud.gpg] https://packages.cloud.google.com/apt google-cloud-ops-agent-bookworm-all main" \
    > /etc/apt/sources.list.d/google-cloud-ops-agent.list
  apt-get update
  apt-get install -y google-cloud-ops-agent
fi
# Each Docker line is {"log": "<the worker's JSON line>", "stream", "time", "attrs": {"tag": "<container name>"}}: parse
# it twice so the worker's own fields (level, msg, code, metrics counters) become searchable, and map level to severity
# for the alert policies in docs/RUNBOOK.md (Alerts). The lines are content free by design (docs/CONVENTIONS.md).
ops_config="$(cat <<'EOF'
logging:
  receivers:
    konva_containers:
      type: files
      include_paths: [/var/lib/docker/containers/*/*-json.log]
  processors:
    docker_line:
      type: parse_json
    worker_line:
      type: parse_json
      field: log
    severity:
      type: modify_fields
      fields:
        severity:
          copy_from: jsonPayload.level
          map_values: { error: ERROR, warn: WARNING, warning: WARNING, info: INFO, debug: DEBUG }
  service:
    pipelines:
      konva:
        receivers: [konva_containers]
        processors: [docker_line, worker_line, severity]
EOF
)"
if [ "$(cat /etc/google-cloud-ops-agent/config.yaml 2>/dev/null)" != "$ops_config" ]; then
  printf '%s\n' "$ops_config" > /etc/google-cloud-ops-agent/config.yaml
  systemctl restart google-cloud-ops-agent
fi

# Headroom for image builds, which peak above the running workers.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi
swapon -a

install -d -m 0755 /opt/konva
install -d -m 0700 /opt/konva/env
