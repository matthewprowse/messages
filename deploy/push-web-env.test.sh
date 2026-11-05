#!/usr/bin/env bash
# Tests deploy/push-web-env.sh's allow-list: the web app's variables go up, the retired keys are refused whatever the
# file says, and anything else is skipped. Run: bash deploy/push-web-env.test.sh
set -euo pipefail
cd "$(dirname "$0")"
PUSH_WEB_ENV_FUNCTIONS_ONLY=1 source ./push-web-env.sh

fail=0
expect() {
  local got
  got="$(classify "$1")"
  if [ "$got" != "$2" ]; then echo "FAIL $1: expected $2, got $got"; fail=1; else echo "ok $1 -> $2"; fi
}
expect SUPABASE_SERVICE_ROLE_KEY push
expect NEXT_PUBLIC_SUPABASE_URL push
expect GOOGLE_APPLICATION_CREDENTIALS push
expect KEY_WRAPPING_KEY refuse
expect ENCRYPTION_KEY refuse
expect KMS_ACCESS_TOKEN refuse
expect GEMINI_API_KEY skip
expect SOME_LAPTOP_THING skip
exit $fail
