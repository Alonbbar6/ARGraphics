#!/bin/sh
# Start the Expo Go companion. Run ../dev-local.sh first (API + web on :22674).
# Scan the QR code Expo prints with the iPhone Camera app; phone and Mac share wifi.
cd "$(dirname "$0")"
export PATH="$HOME/.local/node/bin:$PATH"
set -a; . ../.env; set +a
exec npx expo start "$@"
