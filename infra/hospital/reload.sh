#!/usr/bin/env bash
# Rebuild both hospital databases from data/hospital/out (re-runs the init scripts), and re-stage Lakeside's files.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"
docker compose --env-file infra/hospital/.env -f infra/hospital/docker-compose.yml down -v
docker compose --env-file infra/hospital/.env -f infra/hospital/docker-compose.yml up -d --wait
DEST="${UPSTREAM_FILES:-$HOME/upstream-files}"
cp data/hospital/out/lakeside/cabinet_export_*.csv "$DEST/corvale-lakeside-exports/cabinet/"
cp data/hospital/out/lakeside/usage_30d.csv "$DEST/corvale-lakeside-exports/usage/"
echo reloaded
