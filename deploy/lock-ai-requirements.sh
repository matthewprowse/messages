#!/usr/bin/env bash
# Writes the AI image's hash-locked requirements (apps/ai/requirements*.lock.txt) from the pins in requirements*.txt, on
# a laptop with Docker, so the image installs with pip --require-hashes (apps/ai/Dockerfile). Each lock holds the whole
# tree: requirements.lock.txt for the AI worker, and one per connector that also includes requirements.txt.
# Run it after moving any pin, review the diff (new packages, not only new hashes), and commit the locks with the pin.
# Extra arguments go to pip-compile, for example --upgrade to move unpinned dependencies to their latest release.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

# Without Docker, uv resolves a universal lock (every platform's wheels and hashes, with markers), which pip installs
# from with --require-hashes just the same. Docker stays the first choice, as it resolves exactly what the image sees.
if ! docker info >/dev/null 2>&1 && command -v uv >/dev/null; then
  echo "Docker is not running: locking with uv (universal resolution)." >&2
  cd "$root/apps/ai"
  lock() { out="$1"; shift; uv pip compile --quiet --generate-hashes --universal --python-version 3.13 --no-header --custom-compile-command deploy/lock-ai-requirements.sh "$@" -o "$out"; }
  lock requirements.lock.txt requirements.txt
  lock requirements-instagram.lock.txt requirements.txt requirements-instagram.txt
  lock requirements-icloud-reminders.lock.txt requirements.txt requirements-icloud-reminders.txt
  echo "Wrote apps/ai/requirements*.lock.txt. Review the diff, then commit them."
  exit 0
fi
# Resolved inside the image the AI worker runs on, so platform markers resolve as they will in production.
image="$(sed -n 's/^FROM \(python:[^ ]*\) AS build$/\1/p' "$root/apps/ai/Dockerfile")"
[ -n "$image" ] || { echo "No python build stage found in apps/ai/Dockerfile." >&2; exit 1; }

docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e CUSTOM_COMPILE_COMMAND=deploy/lock-ai-requirements.sh \
  -v "$root/apps/ai:/src" -w /src "$image" sh -euc '
    python -m venv /tmp/tools
    /tmp/tools/bin/pip install --quiet --disable-pip-version-check "pip-tools>=7.5,<8"
    lock() { out="$1"; shift; /tmp/tools/bin/pip-compile --quiet --generate-hashes --allow-unsafe --strip-extras --no-emit-index-url "$@" -o "$out"; }
    lock requirements.lock.txt requirements.txt "$@"
    lock requirements-instagram.lock.txt requirements.txt requirements-instagram.txt "$@"
    lock requirements-icloud-reminders.lock.txt requirements.txt requirements-icloud-reminders.txt "$@"
  ' lock "$@"
echo "Wrote apps/ai/requirements*.lock.txt. Review the diff, then commit them."
