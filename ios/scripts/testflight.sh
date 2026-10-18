#!/usr/bin/env bash
# Builds a signed Release archive of the ARGraphics guest app and uploads it to TestFlight.
#
# Run on any Mac with Xcode 26 (a cloud Mac is fine):
#   cd ios && ./scripts/testflight.sh
#
# Needs, once per machine:
#   - Config/Secrets.xcconfig with ARGRAPHICS_API_BASE_URL, ARGRAPHICS_IOS_API_KEY,
#     ARGRAPHICS_ASSOCIATED_DOMAIN and ARGRAPHICS_TEAM_ID (see Secrets.example.xcconfig)
#   - An App Store Connect API key (Users and Access > Integrations > App Store Connect API,
#     role App Manager), exported as:
#       ASC_KEY_ID=ABC123DEF4  ASC_ISSUER_ID=xxxxxxxx-xxxx-...  ASC_KEY_PATH=~/AuthKey_ABC123DEF4.p8
#     The key lets xcodebuild create the signing certificate and profile itself
#     (-allowProvisioningUpdates), so nothing has to be set up in Xcode's UI.
#   - The app record in App Store Connect with bundle ID app.argraphics.visitor.
#
# Optional:
#   BUILD_NUMBER=42   Build number to upload. Default: minutes since 2026-01-01, so every run,
#                     local or CI, gets a higher number than the last.
#   MARKETING_VERSION=1.1   Version shown to testers (default: from project.yml).
#   SKIP_TESTS=1      Skip the Simulator unit tests before archiving.
set -euo pipefail
cd "$(dirname "$0")/.."

for tool in xcodebuild xcodegen; do
  command -v "$tool" >/dev/null || { echo "Missing $tool. Install Xcode 26 and 'brew install xcodegen'." >&2; exit 1; }
done
[ -f Config/Secrets.xcconfig ] || { echo "Config/Secrets.xcconfig is missing. Copy Secrets.example.xcconfig and fill it in." >&2; exit 1; }
grep -q '^ARGRAPHICS_TEAM_ID *= *[A-Z0-9]\{10\}' Config/Secrets.xcconfig \
  || { echo "Set ARGRAPHICS_TEAM_ID (10 characters) in Config/Secrets.xcconfig." >&2; exit 1; }
# A Release build has no demo fallback: without a reachable https API every scan fails.
grep -q '^ARGRAPHICS_API_BASE_URL *= *https:/' Config/Secrets.xcconfig \
  || { echo "ARGRAPHICS_API_BASE_URL in Config/Secrets.xcconfig must be an https:// URL ending in /api." >&2; exit 1; }
grep -q '^ARGRAPHICS_IOS_API_KEY *= *[^ ]' Config/Secrets.xcconfig \
  || { echo "ARGRAPHICS_IOS_API_KEY in Config/Secrets.xcconfig is empty; use the server's IOS_API_KEY." >&2; exit 1; }
: "${ASC_KEY_ID:?Set ASC_KEY_ID (App Store Connect API key ID)}"
: "${ASC_ISSUER_ID:?Set ASC_ISSUER_ID (App Store Connect issuer ID)}"
: "${ASC_KEY_PATH:?Set ASC_KEY_PATH (path to the AuthKey_*.p8 file)}"
KEY_PATH="${ASC_KEY_PATH/#\~/$HOME}"
[ -f "$KEY_PATH" ] || { echo "API key file not found: $KEY_PATH" >&2; exit 1; }

BUILD_NUMBER="${BUILD_NUMBER:-$(( ( $(date +%s) - 1767225600 ) / 60 ))}"
OUT="${OUT_DIR:-/tmp/argraphics-ios}"
ARCHIVE="$OUT/ARGraphics.xcarchive"
rm -rf "$OUT" && mkdir -p "$OUT"

echo "==> Generating the Xcode project"
xcodegen generate >/dev/null

if [ "${SKIP_TESTS:-0}" != "1" ]; then
  echo "==> Unit tests (Simulator)"
  SIM=$(xcrun simctl list devices available -j | python3 -c '
import json, sys
devices = json.load(sys.stdin)["devices"]
for runtime in sorted((r for r in devices if "iOS" in r), reverse=True):
    for d in devices[runtime]:
        if d["name"].startswith("iPhone"):
            print(d["udid"]); sys.exit()
')
  xcodebuild test -project ARGraphics.xcodeproj -scheme ARGraphics -destination "id=$SIM" \
    -derivedDataPath "$OUT/dd-test" CODE_SIGNING_ALLOWED=NO -quiet
fi

echo "==> Archiving build $BUILD_NUMBER"
xcodebuild archive -project ARGraphics.xcodeproj -scheme ARGraphics -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" -derivedDataPath "$OUT/dd" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" ${MARKETING_VERSION:+MARKETING_VERSION="$MARKETING_VERSION"} -quiet

echo "==> Uploading to App Store Connect"
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist ExportOptions.plist \
  -exportPath "$OUT/export" -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID"

echo "==> Uploaded build $BUILD_NUMBER. It appears in App Store Connect > TestFlight after processing (5–30 min)."
