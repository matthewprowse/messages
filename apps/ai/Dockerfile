# The AI worker image. Build from the repo root:
#   docker build -f apps/ai/Dockerfile -t konva-ai .
# The same image runs the optional connector processes: build with
#   --build-arg EXTRA_REQUIREMENTS=requirements-instagram.txt   (or requirements-icloud-reminders.txt)
# and start it with `python -m ai instagram` (or `icloud-reminders`). Those processes have no health endpoint: run them
# with the health check turned off (docker run --no-healthcheck).
# Nothing secret is baked in: keys arrive as environment variables at run time (apps/ai/.env.example, docs/RUNBOOK.md).

# Pinned by digest, as for the worker. To move the pin: docker buildx imagetools inspect python:3.13-slim-bookworm.
FROM python:3.13-slim-bookworm@sha256:281d39ff02e3b389401586134ff9e6572954687822a58055ec07a60ded4e0b7f AS build
ARG EXTRA_REQUIREMENTS=
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /src
COPY apps/ai/requirements*.txt ./
# Every download is checked against a hash once deploy/lock-ai-requirements.sh has written the *.lock.txt files: a lock
# holds the whole tree (an extra one includes requirements.txt), so it installs alone with --no-deps. Until a lock exists
# the image installs from the pins as before, so the build never breaks while the locks are being made.
RUN python -m venv /opt/venv \
 && if [ -n "$EXTRA_REQUIREMENTS" ]; then lock="${EXTRA_REQUIREMENTS%.txt}.lock.txt"; else lock=requirements.lock.txt; fi \
 && if [ -f "$lock" ]; then \
      /opt/venv/bin/pip install --require-hashes --no-deps -r "$lock"; \
    else \
      /opt/venv/bin/pip install -r requirements.txt \
      && if [ -n "$EXTRA_REQUIREMENTS" ]; then /opt/venv/bin/pip install -r "$EXTRA_REQUIREMENTS"; fi; \
    fi

FROM python:3.13-slim-bookworm@sha256:281d39ff02e3b389401586134ff9e6572954687822a58055ec07a60ded4e0b7f
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin konva
ENV PATH=/opt/venv/bin:$PATH PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 APP_ENV=production HEALTH_PORT=8080
COPY --from=build /opt/venv /opt/venv
WORKDIR /app
COPY --chown=konva:konva apps/ai/ai /app/ai
USER konva
EXPOSE 8080
STOPSIGNAL SIGTERM
# Ready once the lease is held and the draft loop is turning.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/readyz', timeout=4).status == 200 else 1)"]
CMD ["python", "-m", "ai"]
