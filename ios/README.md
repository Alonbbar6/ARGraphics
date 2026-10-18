# ARGraphics iOS (guest app)

A guest scans the ARGraphics QR code at their table, on a wall, in a window or on a poster,
and sees that spot's AR display in place: a 3D special on the table, an artist's piece on the
wall, an event poster or an offer floating over the table. Offers can be claimed and shown to
staff. Guests without the app get the web page at `/s/{code}` (3D viewer and AR Quick Look); this app adds table-card tracking, offer claiming with a live clock, and sharing.

Built with SwiftUI, ARKit and RealityKit. Requires iOS 18 or later and Xcode 26.

## Setup

1. Install XcodeGen (`brew install xcodegen`). The `.xcodeproj` is generated and git-ignored.
2. `cp Config/Secrets.example.xcconfig Config/Secrets.xcconfig` and fill in:
   - `ARGRAPHICS_API_BASE_URL`: the API server root including `/api`, for example `https://your-host/api`.
   - `ARGRAPHICS_IOS_API_KEY`: the same value as the server's `IOS_API_KEY`.
   - `ARGRAPHICS_ASSOCIATED_DOMAIN`: the web host printed in QR codes (see Universal Links).
   - `ARGRAPHICS_TEAM_ID`: your Apple Developer team ID (only needed for device and TestFlight builds).
3. `xcodegen generate && open ARGraphics.xcodeproj`, then run the **ARGraphics** scheme.

## Ship to TestFlight

Two ways. Both need an App Store Connect app record with bundle ID `app.argraphics.visitor`
and an App Store Connect API key (Users and Access > Integrations > App Store Connect API,
role App Manager; download the `.p8` once, note the Key ID and Issuer ID).

**From any Mac with Xcode 26** (a cloud Mac works):

```
brew install xcodegen
cp Config/Secrets.example.xcconfig Config/Secrets.xcconfig   # fill in all four values
export ASC_KEY_ID=ABC123DEF4 ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx ASC_KEY_PATH=~/AuthKey_ABC123DEF4.p8
./scripts/testflight.sh
```

The script runs the unit tests, archives a signed Release build (Xcode creates the
certificate and profile itself through the API key), uploads it, and prints the build number.
Builds appear under App Store Connect > TestFlight after processing; add testers there.
`BUILD_NUMBER=` and `MARKETING_VERSION=` override the defaults, `SKIP_TESTS=1` skips tests.

**From GitHub, no Mac at all:** `.github/workflows/ios-testflight.yml` does the same on a
hosted macOS runner. Add the secrets and variables listed at the top of that file, then run
it from the Actions tab or push a tag like `ios-v1.0.1`. The build number is the run number.

Before the first upload, in App Store Connect:
- Register the bundle ID with the **Associated Domains** capability.
- Fill in the app's privacy details: camera (app functionality), no tracking, no data collected
  beyond an anonymous visitor ID used for counting.
- Replace `TEAMID` in the web app's `public/.well-known/apple-app-site-association` with
  your team ID and deploy the web app, or printed codes keep opening Safari.

Tests use stubbed networking and never contact a server. Keep derived data outside `~/Desktop`
(codesign fails on Desktop file attributes):

```
xcodebuild -project ARGraphics.xcodeproj -scheme ARGraphics \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' -derivedDataPath /tmp/dd-ios test
```

## QR codes and links

| Payload | Resolves with |
|---|---|
| `https://<any-host>/s/{code}` (what printed codes encode) | `POST /v1/scans` |
| `argraphics://s/{code}` | `POST /v1/scans` |
| `argraphics://venue/{slug}`, `https://<any-host>/b/{slug}`, bare `casa-marisol` | `GET /v1/venues/{slug}` |
| Typed under the QR (manual entry) | `POST /v1/scans`, then `GET /v1/venues/{slug}` on 404 |

`{code}` is 6–16 of `a-z0-9` (upper case is folded, since QR generators often upper-case URLs).
Only the code or slug is used. The link's host is ignored and requests always go to the
configured API, so a QR code cannot point the app at another server.

Links arrive three ways: the in-app scanner, `onOpenURL` (the system Camera app opens
`argraphics://` codes directly), and Universal Links (`NSUserActivityTypeBrowsingWeb`).

### Universal Links

`ARGraphics/Resources/ARGraphics.entitlements` declares
`applinks:$(ARGRAPHICS_ASSOCIATED_DOMAIN)`. It doesn't affect unsigned or Simulator builds.
To make `https://<host>/s/{code}` open the app instead of Safari:

1. Set `ARGRAPHICS_ASSOCIATED_DOMAIN` in `Config/Secrets.xcconfig` to the QR host.
2. Sign with a team whose App ID `app.argraphics.visitor` has the Associated Domains capability.
3. Serve `https://<host>/.well-known/apple-app-site-association` (JSON, no redirect):
   ```json
   { "applinks": { "details": [ { "appIDs": ["<TEAMID>.app.argraphics.visitor"],
                                  "components": [ { "/": "/s/*" } ] } ] } }
   ```
4. The web page at `/s/{code}` should still work for guests without the app installed,
   pointing them to the App Store.

## API used

The `ios`-tagged contract in `lib/api-spec/openapi.yaml`, always with the `x-api-key` header:

- `POST /v1/scans {code, visitorId}` → venue, spot, the display for this code (or null),
  every live display, and table cards. The venue name shows as soon as this returns; models
  and artwork load after.
- `GET /v1/venues/{slug}` for venue links.
- `POST /v1/displays/{id}/claims {visitorId, code}`: 201 new claim, 200 the same claim again,
  404 not available, 410 offer ended.
- `GET /v1/venues/{slug}/nearby` for the artist card's map. `GET /v1/artists/{slug}` for
  "See more of their work".

`visitorId` is a random UUID made once and kept in the Keychain (UserDefaults if the Keychain
fails). It's anonymous and only lets the server count unique guests and limit claims.
The API key is compiled into the app, as the server's design requires. Treat it as a
rate-limiting and abuse-control token, not a secret.

## What guests see

- **Scan landing:** full-screen camera, pulsing violet reticle, one-line hint. The venue name
  lands in serif the moment the scan resolves. No code at the spot → the venue's live displays.
- **Menu item:** USDZ model on the recognised table card (from `tableCards`), or the table
  surface. Price chip, Coral ring under the model.
- **Art piece:** the artwork framed with a soft glow, flat on a wall/window/poster (or upright
  above the table for table placement). Artist card: title, "by", bio, more of their work,
  and a map of walkable ARGraphics spots.
- **Event teaser / promo offer:** the artwork floats in AR if there is one; otherwise the card
  opens as the page.
- **Offer card:** live countdown, Coral **Claim**, then a Success-green confirmation with the
  code, claim time, time left and a live clock whose seconds tick (so staff can tell it isn't a
  screenshot). The screen stays awake while it's showing.
- **Share:** photo of the AR view with an "ARGraphics · {venue}" watermark, or a 6-second clip
  (ReplayKit; controls hide while recording and only the watermark stays on screen).
  The system share sheet lists Instagram and TikTok when they're installed.

## Fallbacks

- **Camera denied:** the card as a normal page (3D turntable for menu items, artwork for the
  rest) with "Turn on camera". The scanner offers typed codes.
- **No ARKit (Simulator, older phones):** the same page without the camera prompt.
- **Simulator:** RealityKit there lacks ARKit anchoring, so all AR code is inside
  `#if !targetEnvironment(simulator)`.

## Debug hooks (Debug builds only)

- `-ARGraphicsOpenURL <url>`: act as if that link was scanned.
- `-ARGraphicsDemo YES`: built-in sample venue instead of the API. Codes `demooffer`,
  `demoart1`, `demomenu`, `demoevent`; anything else shows the venue list.
- `-ARGraphicsForceARLayout YES`: AR overlay (reticle, sheet) in the Simulator.
- `-ARGraphicsDemoAutoClaim YES`: claims the offer on open, for confirmation screenshots.

```
xcrun simctl launch booted app.argraphics.visitor -ARGraphicsDemo YES -ARGraphicsOpenURL https://x/s/demoart1
```

## Layout

```
ARGraphics/App          entry point, environment, navigation and link routing
ARGraphics/Config       Info.plist-backed build settings
ARGraphics/Design       brand tokens and shared components
ARGraphics/Networking   API client and contract models
ARGraphics/Services     link parsing, visit resolution, visitor ID, countdowns, caches
ARGraphics/Features     Scan, Venue (display list), Experience (AR + page), Cards
                        (offer, artist, info), Share, Viewer (3D turntable)
ARGraphics/Debug        demo data
```
