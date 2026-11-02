#!/usr/bin/env bash
# Copies the web app's env file into the Vercel project "konva" for Production (docs/RUNBOOK.md, "Web App On Vercel"):
# apps/web/.env.local by default, or the file in WEB_ENV. Values go straight from the file to the Vercel CLI and are
# never printed. NEXT_PUBLIC_* are plain (they ship to the browser anyway); everything else is sensitive.
# GOOGLE_APPLICATION_CREDENTIALS is a local file path, so its file's contents go up as GOOGLE_APPLICATION_CREDENTIALS_JSON.
# Push to main (or redeploy in Vercel) afterwards: env changes apply to the next build.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
WEB_ENV="${WEB_ENV:-$root/apps/web/.env.local}"

# Point the CLI at the project without writing a .vercel folder into the repo.
link="$(mktemp -d)"
trap 'rm -rf "$link"' EXIT
mkdir "$link/.vercel"
echo '{"orgId":"team_vU8rHMwHYbbKMvDV6708kh8O","projectId":"prj_6gkGUpp271N6D7ljB0tRNVrDvENU"}' > "$link/.vercel/project.json"

put() {
  local name="$1" value="$2" kind=(--sensitive)
  [[ "$name" == NEXT_PUBLIC_* ]] && kind=()
  printf '%s' "$value" | vercel env add "$name" production ${kind[@]+"${kind[@]}"} --force --cwd "$link" >/dev/null
  echo "set $name"
}

while IFS= read -r line; do
  [[ "$line" =~ ^([A-Z_][A-Z0-9_]*)=(.*)$ ]] || continue
  name="${BASH_REMATCH[1]}" value="${BASH_REMATCH[2]}"
  value="${value%\"}" value="${value#\"}"
  [ -n "$value" ] || continue
  if [ "$name" = GOOGLE_APPLICATION_CREDENTIALS ]; then
    if [ -f "$value" ]; then put GOOGLE_APPLICATION_CREDENTIALS_JSON "$(cat "$value")"; else echo "skip $name (no file)"; fi
    continue
  fi
  if [[ "$value" == *localhost* || "$value" == *127.0.0.1* ]]; then echo "skip $name (points at this laptop)"; continue; fi
  put "$name" "$value"
done < "$WEB_ENV"
