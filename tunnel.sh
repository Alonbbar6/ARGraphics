#!/bin/sh
# Run ARGraphics and the Expo Go test app over the internet, for phones that can't reach
# this Mac on wifi (router isolation, mobile data). Uses free Cloudflare quick tunnels:
# new random addresses each run, no account. Ctrl+C stops everything.
cd "$(dirname "$0")"
CF="$HOME/.local/bin/cloudflared"
LOGS=$(mktemp -d)
trap 'kill 0' INT TERM EXIT

tunnel() { "$CF" tunnel --no-autoupdate --url "http://localhost:$1" > "$LOGS/$1.log" 2>&1 & }
public_url() {
  until grep -qo 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOGS/$1.log" 2>/dev/null; do sleep 1; done
  grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOGS/$1.log" | head -1
}

tunnel 22674
tunnel 8081
API_URL=$(public_url 22674)
METRO_URL=$(public_url 8081)

ARGRAPHICS_PUBLIC_URL="$API_URL" ./dev-local.sh &
EXPO_GUEST_API_URL="$API_URL/api" EXPO_PACKAGER_PROXY_URL="$METRO_URL" ./expo-guest/start.sh &

echo
echo "  ARGraphics (dashboard + API):  $API_URL"
echo "  Open in Expo Go:               exps://${METRO_URL#https://}"
echo
wait
