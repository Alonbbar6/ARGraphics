#!/bin/sh
# Run ARGraphics locally on a Mac: Postgres, API (8080) and web app (22674).
# Open http://localhost:22674 once it's up. Ctrl+C stops everything.
set -e
cd "$(dirname "$0")"
export PATH="$HOME/.local/node/bin:$PATH"
set -a; . ./.env; set +a

# Phones (Expo Go, the iOS app) need storage links that point at this Mac, not localhost.
# tunnel.sh passes a public address; otherwise use the wifi address unless .env pins one.
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
if [ -n "${ARGRAPHICS_PUBLIC_URL:-}" ]; then
  export LOCAL_STORAGE_PUBLIC_URL="$ARGRAPHICS_PUBLIC_URL"
else
  case "${LOCAL_STORAGE_PUBLIC_URL:-}" in
    ""|http://localhost*) [ -n "$LAN_IP" ] && export LOCAL_STORAGE_PUBLIC_URL="http://$LAN_IP:22674" ;;
  esac
fi
echo "Dashboard: http://localhost:22674   Phones on this wifi: http://${LAN_IP:-<no wifi>}:22674"

if ! nc -z localhost 5432 2>/dev/null; then
  (cd "$HOME/.local/argraphics-db" && node start.mjs > postgres.log 2>&1) &
  until nc -z localhost 5432 2>/dev/null; do sleep 1; done
fi

trap 'kill 0' INT TERM EXIT
NODE_ENV=development PORT=8080 pnpm --filter @workspace/api-server run dev &
# Printed QR codes point at the same address phones use for uploads (LAN IP or tunnel).
export VITE_PUBLIC_APP_URL="$LOCAL_STORAGE_PUBLIC_URL"
PORT=22674 BASE_PATH=/ API_PROXY_TARGET=http://localhost:8080 pnpm --filter @workspace/argraphics run dev &
wait
