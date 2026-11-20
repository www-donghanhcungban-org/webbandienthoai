#!/usr/bin/env bash
# CI sạch cần một server cho Vitest; dự án đã cấp DATABASE_URL dùng nguyên server và pg tools của dự án.
set -euo pipefail
if [[ -n ${DATABASE_URL:-} || ${GITHUB_ACTIONS:-} != true ]]; then exec pnpm exec vitest run "$@"; fi

export POSTGRES_PASSWORD
POSTGRES_PASSWORD=$(node -p "require('node:crypto').randomBytes(24).toString('hex')")
echo "::add-mask::$POSTGRES_PASSWORD"
image='postgres:17.11-trixie@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3'
container=$(docker run --detach --rm --publish 127.0.0.1::5432 --env POSTGRES_PASSWORD "$image")
trap 'docker rm --force "$container" >/dev/null' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
endpoint=$(docker port "$container" 5432/tcp)
[[ $endpoint =~ ^127\.0\.0\.1:[0-9]+$ ]] || { echo "Cổng PostgreSQL chưa gắn vào loopback" >&2; exit 1; }
export DATABASE_URL="postgresql://postgres:$POSTGRES_PASSWORD@$endpoint/postgres" PG_TOOLS_CONTAINER="$container"
for ((attempt=0; attempt<60; attempt++)); do
  if docker exec "$container" pg_isready --quiet -h 127.0.0.1 -U postgres -d postgres; then
    pnpm exec vitest run "$@"
    exit 0
  fi
  sleep 1
done
echo 'PostgreSQL cho Vitest chưa sẵn sàng sau 60 giây.' >&2
exit 1
