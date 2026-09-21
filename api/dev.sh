#!/usr/bin/env bash
# Dev loop for the API without a local .NET SDK: everything runs inside the
# `sms-sdk` container (mcr.microsoft.com/dotnet/sdk:9.0) with the repo mounted
# at /src and the dev Postgres reachable as sms-db-dev on the sms-dev network.
#
#   api/dev.sh up        create network + postgres + sdk containers (idempotent)
#   api/dev.sh build     compile
#   api/dev.sh start     (re)start the API on http://localhost:8095
#   api/dev.sh restart   build + start
#   api/dev.sh logs      tail API log
#   api/dev.sh smoke     run api/smoke.mjs against the dev API
#   api/dev.sh psql      open psql on the dev database
#   api/dev.sh reset-db  drop and recreate the dev database (re-seeds on next start)
#   api/dev.sh fresh     reset-db + build + start (clean slate for the smoke test)
set -euo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WIN_ROOT="$(cd "$ROOT" && pwd -W 2>/dev/null || echo "$ROOT")"
PORT="${SMS_DEV_PORT:-8095}"

ENV_ARGS='SMS_DB_CONNECTION="Host=sms-db-dev;Database=sms;Username=sms;Password=sms" SMS_JWT_SIGNING_KEY="dev-only-signing-key-change-me-0123456789abcdef" SMS_SQL_DIR=/src/db/sql SMS_SEED_DIR=/src/db/seed SMS_SEED_DEV=true ASPNETCORE_ENVIRONMENT=Development'

up() {
  docker network create sms-dev >/dev/null 2>&1 || true
  docker ps -a --format '{{.Names}}' | grep -qx sms-db-dev || \
    docker run -d --name sms-db-dev --network sms-dev -p 5499:5432 -e POSTGRES_DB=sms -e POSTGRES_USER=sms -e POSTGRES_PASSWORD=sms -e TZ=Asia/Kolkata postgres:16-alpine >/dev/null
  docker ps -a --format '{{.Names}}' | grep -qx sms-sdk || \
    docker run -d --name sms-sdk --network sms-dev -p "$PORT:8080" -v "$WIN_ROOT:/src" -w /src/api -e DOTNET_CLI_TELEMETRY_OPTOUT=1 -e DOTNET_NOLOGO=1 -e NUGET_PACKAGES=/nuget mcr.microsoft.com/dotnet/sdk:9.0 sleep infinity >/dev/null
  docker start sms-db-dev sms-sdk >/dev/null
  echo "dev containers up (api on :$PORT, postgres on :5499)"
}

build() {
  docker exec sms-sdk dotnet build /src/api/src/Sms.Api/Sms.Api.csproj -c Debug --nologo -v q 2>&1 | grep -E "error|warning CS|Build succeeded" | sort -u
}

start() {
  # The slim image has no pkill; restarting the container is the reliable way to stop the API.
  docker restart sms-sdk >/dev/null
  docker exec -d sms-sdk sh -c "cd /src/api/src/Sms.Api && $ENV_ARGS dotnet run --no-build --urls http://0.0.0.0:8080 > /tmp/api.log 2>&1"
  for _ in $(seq 1 120); do
    if curl -s -m 2 "http://localhost:$PORT/health" 2>/dev/null | grep -q '"ok"'; then echo "api up on http://localhost:$PORT"; return 0; fi
    sleep 1
  done
  echo "api did not come up; log:"; docker exec sms-sdk tail -40 /tmp/api.log; return 1
}

case "${1:-}" in
  up) up ;;
  build) build ;;
  start) start ;;
  restart) build && start ;;
  logs) docker exec sms-sdk tail -n "${2:-80}" /tmp/api.log ;;
  errors) docker exec sms-sdk grep -a -B2 -A14 "fail:" /tmp/api.log | tail -n "${2:-80}" ;;
  smoke) node "$WIN_ROOT/api/smoke.mjs" "http://localhost:$PORT" ;;
  psql) docker exec -it sms-db-dev psql -U sms -d sms ;;
  reset-db) docker restart sms-sdk >/dev/null; docker exec sms-db-dev psql -U sms -d postgres -q -c "DROP DATABASE IF EXISTS sms" -c "CREATE DATABASE sms" ;;
  fresh) "$0" reset-db && "$0" build && "$0" start ;;
  *) sed -n 2,14p "$0" ;;
esac
