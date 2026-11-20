# https://github.com/docker-library/repo-info/blob/master/repos/node/remote/24.22.3-bookworm-slim.md
FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS base
WORKDIR /app

# These three files are read out of the verified archive. Docker reuses this layer on code-only changes.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global --ignore-scripts pnpm@12.16.1 && \
    pnpm install --prod --frozen-lockfile --ignore-scripts --config.enable-global-virtual-store=false

FROM base AS build
ARG XT_SUBJECT
COPY app.tgz /tmp/app.tgz
RUN set -eu; raw="$(sha256sum /tmp/app.tgz | cut -d' ' -f1)"; \
    printf 'dist/app.tgz\000%s\n' "$raw" | sha256sum | cut -d' ' -f1 > .build-digest; \
    test "$(cat .build-digest)" = "$XT_SUBJECT"; \
    tar xzf /tmp/app.tgz --no-same-owner

FROM base
COPY --from=build /app /app
COPY --from=deps /app/node_modules /app/node_modules
ENV XT_PREVIEW_BUILD=1
USER node
HEALTHCHECK --interval=3s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.ts"]
