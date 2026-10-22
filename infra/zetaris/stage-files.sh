#!/usr/bin/env bash
# Stage the FDA bundle and Corvale Lakeside's cabinet exports where the Zetaris query engine reads them,
# one folder per table, then mount them read-only into the driver container.
#   bash infra/zetaris/stage-files.sh   (run inside WSL, from the repo root)
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="${UPSTREAM_FILES:-$HOME/upstream-files}"
ZETARIS_DIR="${ZETARIS_DIR:-$HOME/zetaris/zetaris-platform}"

rm -rf "$DEST"
mkdir -p "$DEST/fda" "$DEST/corvale-lakeside-exports/cabinet" "$DEST/corvale-lakeside-exports/usage"
for f in "$REPO"/data/fda/bundle/*.csv; do
  t="$(basename "$f" .csv)"
  mkdir -p "$DEST/fda/$t"
  cp "$f" "$DEST/fda/$t/"
done
cp "$REPO"/data/hospital/out/lakeside/cabinet_export_*.csv "$DEST/corvale-lakeside-exports/cabinet/"
cp "$REPO"/data/hospital/out/lakeside/usage_30d.csv "$DEST/corvale-lakeside-exports/usage/"
chmod -R a+rX "$DEST"
du -sh "$DEST"

cat > "$ZETARIS_DIR/docker-compose.override.yml" <<EOF
# Upstream: Corvale Lakeside's exports, read in place, and the cleaned FDA bundle, mounted read-only for the query engine.
services:
  driver:
    volumes:
      - $DEST:/home/zetaris/customer-data/shared/upstream:ro
EOF
cd "$ZETARIS_DIR"
docker compose up -d driver
