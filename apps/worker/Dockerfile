# The sync worker image. Build from the repo root (the worker depends on packages/*):
#   docker build -f apps/worker/Dockerfile -t konva-worker .
# Nothing secret is baked in: SUPABASE_*, KEY_WRAPPING_KEY and the rest arrive as environment variables at run time
# (see apps/worker/.env.example and docs/RUNBOOK.md). The LinkedIn helper (apps/linkedin) is not in this image.

# Base images are pinned by digest so a rebuild gives the same bytes (Confidential Space attests the image digest).
# To move a pin: docker buildx imagetools inspect node:24-bookworm-slim, and record the date in docs/RUNBOOK.md.
FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS build
ENV CI=true
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo
COPY . .
# Production dependencies of the worker and the workspace packages it uses, laid out as a self-contained folder.
RUN pnpm install --frozen-lockfile --filter worker... \
 && pnpm --filter worker deploy --prod --legacy /out

FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
# ffmpeg converts voice notes recorded in the app to the Ogg Opus WhatsApp expects (src/whatsapp/voice-note.ts).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HEALTH_PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /out /app
USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
# Ready once the shard lease is held and the reconcile loop is ticking. A worker waits up to a lease lifetime (90 s) for a
# lease a killed worker left behind, hence the long start period.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/readyz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# tsx as a loader keeps the worker as the only process, so SIGTERM reaches its own shutdown handler (10 s to finish sends).
CMD ["node", "--import", "tsx", "src/index.ts"]
