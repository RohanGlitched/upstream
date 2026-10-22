#!/usr/bin/env bash
# Re-apply the reporting views and reader grants on running hospital databases.
set -euo pipefail
for c in corvale-general-db-1 corvale-east-db-1; do
  docker exec "$c" sh /docker-entrypoint-initdb.d/20-readonly.sh
  echo "$c views applied"
done
