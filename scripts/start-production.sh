#!/bin/sh
# Production entrypoint: migrate the database, then serve. Fails fast if either cannot run.
set -e
cd "$(dirname "$0")/.."

if [ -n "$LOCAL_STORAGE_DIR" ]; then
  mkdir -p "$LOCAL_STORAGE_DIR"
fi

echo "Applying database migrations..."
pnpm --filter @workspace/db run migrate

echo "Starting ARGraphics API on port ${PORT:-3000}"
exec pnpm --filter @workspace/api-server run start
