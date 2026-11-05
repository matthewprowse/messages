#!/usr/bin/env bash
# Copies the workers' env files to the VM (docs/RUNBOOK.md, "Production VM"), built from apps/worker/.env and apps/ai/.env
# by default, or the files named in WORKER_ENV and AI_ENV. Each service gets a file of its own holding only the variables
# on its allow-list below: worker.env, ai.env, instagram.env and icloud-reminders.env. A variable on no list is left on the
# laptop and named (never its value), so add it here when a service starts reading a new one. The files go over SSH's
# stdin into /opt/konva/env, readable by root only, and are never in /tmp, the repo or an image. Run deploy/release.sh
# afterwards so the containers pick them up.
set -euo pipefail

PROJECT="${PROJECT:-messages-keys}"
ZONE="${ZONE:-africa-south1-a}"
VM="${VM:-konva-workers}"
root="$(cd "$(dirname "$0")/.." && pwd)"
WORKER_ENV="${WORKER_ENV:-$root/apps/worker/.env}"
AI_ENV="${AI_ENV:-$root/apps/ai/.env}"

# Shared by every service. KEY_WRAPPING_KEY and ENCRYPTION_KEY are on no list: `keys:readiness` reported nothing left
# under either on 4 November 2026 (docs/RUNBOOK.md, Rotating And Releasing Keys), so every service runs on KMS alone.
# GOOGLE_APPLICATION_CREDENTIALS* and KMS_ACCESS_TOKEN are on no list: the VM unwraps keys as its own service account.
COMMON="SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY KMS_KEY_NAME ENCRYPT_CONTENT ENCRYPT_ADDRESSES SEAL_BOUND_FIELDS REQUIRE_BOUND_FIELDS"
# What apps/worker/src reads (grep for env. and ms("...") in it).
WORKER_VARS="$COMMON ERROR_TRACKER_DSN COMPANY_LOGOS CONTACT_AUTOMERGE HTTP_PROXY HTTPS_PROXY
  GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_WEB_CLIENT_ID GOOGLE_WEB_CLIENT_SECRET GMAIL_PUBSUB_TOPIC GMAIL_PUBSUB_SUBSCRIPTION
  MICROSOFT_CLIENT_ID MICROSOFT_CLIENT_SECRET MICROSOFT_TENANT GRAPH_NOTIFICATION_URL GRAPH_NOTIFY_SECRET
  ZOOM_CLIENT_ID ZOOM_CLIENT_SECRET VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT
  WORKER_SHARD_COUNT WORKER_SHARD_INDEX WORKER_LEASE INITIAL_SYNC_DAYS STORAGE_CAP_GB VIDEO_COPY_MAX_MB EAGER_COPY_MAX_DAYS EAGER_COPY_MAX_MB
  WHATSAPP_DAILY_CAP WHATSAPP_NEW_CHAT_CAP WHATSAPP_MIN_GAP_SECONDS WHATSAPP_GAP_JITTER_SECONDS WHATSAPP_PART_GAP_SECONDS WHATSAPP_TYPING_MAX_SECONDS
  MAIL_SLOW_POLL_MS IMAP_POLL_MS IMAP_NO_IDLE_POLL_MS ACCOUNT_HEARTBEAT_MS FILE_FETCH_BASE_MS FILE_FETCH_MAX_TRIES
  GMAIL_POLL_ACTIVE_MS GMAIL_POLL_IDLE_MS GMAIL_POLL_DEEP_IDLE_MS OUTLOOK_SIDE_ACTIVE_MS OUTLOOK_SIDE_IDLE_MS OUTLOOK_SIDE_DEEP_IDLE_MS
  TEAMS_POLL_ACTIVE_MS TEAMS_POLL_IDLE_MS TEAMS_POLL_DEEP_IDLE_MS QUEUE_POLL_ACTIVE_MS QUEUE_POLL_IDLE_MS QUEUE_POLL_DEEP_IDLE_MS
  POLL_ACTIVE_WINDOW_MS POLL_DEEP_IDLE_AFTER_MS"
# What `python -m ai` reads (apps/ai/ai, without connectors/). It never opens connector sign-ins, so no ENCRYPTION_KEY.
AI_VARS="$COMMON ERROR_TRACKER_DSN COMPANY_LOGOS AI_BATCH GEMINI_API_KEY GEMINI_MODEL GEMINI_FAST_MODEL GEMINI_EMBED_MODEL
  GEMINI_TRANSCRIBE_MODEL GEMINI_TTS_MODEL GEMINI_TTS_VOICE LEARN_MODEL BRIEF_MODEL PREDRAFT_MODEL TRIAGE_MODEL
  DRAFT_THINKING EDIT_THINKING DRAFT_HEDGE AUDIO_INPUT_USD_PER_M CACHE_STORAGE_USD_PER_M_HOUR
  LOGO_DAILY_CAP LOGO_DAILY_USD LOGO_MAX_TRIES LOGO_SEARCH_GATE MEETING_MAX_MINUTES VOICE_NOTE_MAX_SECONDS
  INITIAL_SYNC_DAYS STORAGE_CAP_GB VIDEO_COPY_MAX_MB"
# The connectors (apps/ai/ai/connectors/<name>/run.py and what it imports). No Gemini key: neither calls the model.
INSTAGRAM_VARS="$COMMON INSTAGRAM_PROXY INSTAGRAM_WEBHOOKS INSTAGRAM_HUMAN_AGENT INSTAGRAM_FIRST_MESSAGES_PER_DAY
  INITIAL_SYNC_DAYS STORAGE_CAP_GB VIDEO_COPY_MAX_MB"
ICLOUD_REMINDERS_VARS="$COMMON"

# Production must run encrypted: the workers refuse to start otherwise, so catch it here rather than in a crash loop.
for f in "$WORKER_ENV" "$AI_ENV"; do
  if grep -Eq '^ENCRYPT_(CONTENT|ADDRESSES)=false' "$f"; then
    echo "$f turns encryption off; the workers will not start in production." >&2
    exit 1
  fi
done

# Writes the lines of $1 whose name is in $3 to $2, and names (never values) what it leaves out.
pick() {
  local src="$1" dest="$2" allow=" $(echo $3) " line name dropped=""
  : > "$dest"
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)= ]] || continue
    name="${BASH_REMATCH[2]}"
    if [[ "$allow" == *" $name "* ]]; then printf '%s\n' "${line#export }" >> "$dest"; else dropped="$dropped $name"; fi
  done < "$src"
  if [ -n "$dropped" ]; then echo "$(basename "$dest"): left out$dropped"; fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
umask 077
pick "$WORKER_ENV" "$tmp/worker.env" "$WORKER_VARS"
pick "$AI_ENV" "$tmp/ai.env" "$AI_VARS"
pick "$AI_ENV" "$tmp/instagram.env" "$INSTAGRAM_VARS"
pick "$AI_ENV" "$tmp/icloud-reminders.env" "$ICLOUD_REMINDERS_VARS"
# A token pasted for a local test must never reach the VM, whatever the lists say.
if grep -lq '^KMS_ACCESS_TOKEN=' "$tmp"/*.env; then
  echo "KMS_ACCESS_TOKEN slipped onto an allow-list; refusing to copy it." >&2
  exit 1
fi

# One SSH session (one OS Login prompt): a tar of the four files on stdin, unpacked by root straight into the 0700
# folder and moved into place, so no copy ever sits anywhere readable by another user on the VM.
# COPYFILE_DISABLE: macOS tar would otherwise add its metadata files to the archive.
COPYFILE_DISABLE=1 tar -C "$tmp" -cf - worker.env ai.env instagram.env icloud-reminders.env |
  gcloud compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" --tunnel-through-iap --command "
    set -eu
    sudo sh -c 'umask 077
      d=\$(mktemp -d /opt/konva/env/.incoming.XXXXXX)
      tar -xf - -C \"\$d\" --no-same-owner --no-same-permissions
      chmod 0600 \"\$d\"/*.env
      mv -f \"\$d\"/*.env /opt/konva/env/
      rmdir \"\$d\"'
  "
echo "Env files are on $VM. Run deploy/release.sh to restart the workers with them."
