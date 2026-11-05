#!/usr/bin/env bash
# Copies the web app's env file into the Vercel project "konva" for Production (docs/RUNBOOK.md, "Web App On Vercel"):
# apps/web/.env.local by default, or the file in WEB_ENV. Values go straight from the file to the Vercel CLI and are
# never printed. NEXT_PUBLIC_* are plain (they ship to the browser anyway); everything else is sensitive, which Vercel
# never shows again once set. Only the variables the web app reads in production go up (WEB_VARS below): the file also
# holds laptop-only values, and the retired static keys (KEY_WRAPPING_KEY, ENCRYPTION_KEY) and KMS_ACCESS_TOKEN are
# refused outright, so a run can never put them back after they were removed by hand (security audit 2026-11-04).
# GOOGLE_APPLICATION_CREDENTIALS is a local file path, so its file's contents go up as GOOGLE_APPLICATION_CREDENTIALS_JSON,
# unless the file sets GCP_WORKLOAD_IDENTITY_PROVIDER: then Vercel reaches KMS with its own OIDC token and no key file goes up
# (docs/RUNBOOK.md, KMS Without A Key File; remove the old GOOGLE_APPLICATION_CREDENTIALS_JSON from Vercel by hand).
# APP_URL is required in production (lib/server/request.ts refuses every browser request without it), and the local file
# leaves it empty or on localhost, so pass the live origin in: APP_URL=https://<domain> deploy/push-web-env.sh. A value in
# the environment wins over the file's; the script stops before pushing anything when neither is a live https origin.
# Push to main (or redeploy in Vercel) afterwards: env changes apply to the next build.
set -euo pipefail

# What apps/web reads in production (grep for process.env. in apps/web/app, lib, middleware.ts and next.config.ts), plus
# what the KMS token exchange needs. Anything else in the file is skipped and named.
WEB_VARS="SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY KMS_KEY_NAME GCP_WORKLOAD_IDENTITY_PROVIDER GCP_SERVICE_ACCOUNT_EMAIL
  GOOGLE_APPLICATION_CREDENTIALS GOOGLE_APPLICATION_CREDENTIALS_JSON
  GOOGLE_WEB_CLIENT_ID GOOGLE_WEB_CLIENT_SECRET MICROSOFT_CLIENT_ID MICROSOFT_TENANT ZOOM_CLIENT_ID ZOOM_CLIENT_SECRET
  INSTAGRAM_APP_ID INSTAGRAM_APP_SECRET META_WEBHOOK_VERIFY_TOKEN GRAPH_NOTIFY_SECRET
  NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY NEXT_PUBLIC_ENCRYPT_CONTENT NEXT_PUBLIC_ENCRYPT_ADDRESSES
  NEXT_PUBLIC_SEAL_BOUND_FIELDS NEXT_PUBLIC_SITE_URL NEXT_PUBLIC_APP_VERSION NEXT_PUBLIC_VAPID_PUBLIC_KEY
  NEXT_PUBLIC_GOOGLE_PICKER_CLIENT_ID NEXT_PUBLIC_GOOGLE_PICKER_API_KEY NEXT_PUBLIC_GOOGLE_PICKER_APP_ID
  NEXT_PUBLIC_MICROSOFT_CLIENT_ID NEXT_PUBLIC_INSTAGRAM_HUMAN_AGENT"
# Never pushed, whatever the file says: the static keys are retired (keys:readiness) and a KMS token is minutes old.
REFUSED_VARS="KEY_WRAPPING_KEY ENCRYPTION_KEY KMS_ACCESS_TOKEN"

# "push" for a name that goes up, "refuse" for one that must never, "skip" for anything else. Pure, so it can be tested
# (deploy/push-web-env.test.sh).
classify() {
  local name="$1" v
  for v in $REFUSED_VARS; do [ "$name" = "$v" ] && { echo refuse; return; }; done
  for v in $WEB_VARS; do [ "$name" = "$v" ] && { echo push; return; }; done
  echo skip
}

# Sourced by the test for classify alone.
[ "${PUSH_WEB_ENV_FUNCTIONS_ONLY:-}" = 1 ] && return 0

root="$(cd "$(dirname "$0")/.." && pwd)"
WEB_ENV="${WEB_ENV:-$root/apps/web/.env.local}"

app_url="${APP_URL:-}"
if [ -z "$app_url" ]; then
  app_url="$(sed -n 's/^APP_URL=//p' "$WEB_ENV" | tail -n 1)"
  app_url="${app_url%\"}" app_url="${app_url#\"}"
fi
app_url="${app_url%/}"
if [[ ! "$app_url" =~ ^https://[^/]+$ || "$app_url" == *localhost* || "$app_url" == *127.0.0.1* ]]; then
  echo "APP_URL must be the live origin, e.g. APP_URL=https://<domain> $0" >&2
  exit 1
fi

# Point the CLI at the project without writing a .vercel folder into the repo.
link="$(mktemp -d)"
trap 'rm -rf "$link"' EXIT
mkdir "$link/.vercel"
echo '{"orgId":"team_vU8rHMwHYbbKMvDV6708kh8O","projectId":"prj_6gkGUpp271N6D7ljB0tRNVrDvENU"}' > "$link/.vercel/project.json"

wif=""
grep -Eq '^GCP_WORKLOAD_IDENTITY_PROVIDER="?[^"[:space:]]' "$WEB_ENV" && wif=1

put() {
  local name="$1" value="$2" kind=(--sensitive)
  [[ "$name" == NEXT_PUBLIC_* ]] && kind=()
  # Production only: a preview deployment must never hold the service role key or the KMS credential.
  printf '%s' "$value" | vercel env add "$name" production ${kind[@]+"${kind[@]}"} --force --cwd "$link" >/dev/null
  echo "set $name"
}

while IFS= read -r line; do
  [[ "$line" =~ ^([A-Z_][A-Z0-9_]*)=(.*)$ ]] || continue
  name="${BASH_REMATCH[1]}" value="${BASH_REMATCH[2]}"
  value="${value%\"}" value="${value#\"}"
  [ -n "$value" ] || continue
  [ "$name" = APP_URL ] && continue # pushed once below, from the checked value
  case "$(classify "$name")" in
    refuse) echo "refuse $name (retired: never pushed; remove it from Vercel if it is still there)"; continue ;;
    skip) echo "skip $name (the web app does not read it)"; continue ;;
  esac
  if [ -n "$wif" ] && [[ "$name" == GOOGLE_APPLICATION_CREDENTIALS* ]]; then echo "skip $name (Workload Identity Federation is set)"; continue; fi
  if [ "$name" = GOOGLE_APPLICATION_CREDENTIALS ]; then
    if [ -f "$value" ]; then put GOOGLE_APPLICATION_CREDENTIALS_JSON "$(cat "$value")"; else echo "skip $name (no file)"; fi
    continue
  fi
  if [[ "$value" == *localhost* || "$value" == *127.0.0.1* ]]; then echo "skip $name (points at this laptop)"; continue; fi
  put "$name" "$value"
done < "$WEB_ENV"
put APP_URL "$app_url"
