# ARGraphics QA checklist

Work through each section in order. Tick a box only when the expected result
happens exactly. If something differs, note the step number, what you saw, and
a screenshot.

## 0. Setup

- [ ] In Terminal: `cd ~/Desktop/Christian_app/argraphics && ./dev-local.sh`
- [ ] Wait for "Server listening" and the Vite "ready" line, then open http://localhost:22674
- [ ] Use Chrome or Safari, desktop width first, then repeat sections 2–6 at phone width
      (browser dev tools → device toolbar → iPhone 14)

Test accounts (development only):

| Who | Email | Password |
|---|---|---|
| Venue owner | `demo@argraphics.app` | `ARGraphics-demo-2026!` |
| Artist | `demo-artist@argraphics.app` | `ARGraphics-demo-2026!` |

Demo QR codes: `demotbl1`–`demotbl6` (tables), `demowall` (wall), `demobar1` (bar top).

## 1. Landing page and accounts

1. [ ] Landing page loads in the cream/ink/orange design with the orange "argraphics." logo.
2. [ ] No paragraph wraps one word per line; no horizontal scrolling at phone width.
3. [ ] "Sign in" → log in as the venue owner → you land on **Home**.
4. [ ] Sign out (account menu, bottom left) → you return to sign-in.
5. [ ] Wrong password shows an error and does not sign in.
6. [ ] Register a new venue with a fresh email → onboarding ("welcome") appears.
      Skip or finish it → you land in the dashboard. Sign back in as the demo owner after.

## 2. Home

1. [ ] Greeting shows the owner's name and today's date.
2. [ ] Four stat tiles: walk-ins, unique visitors, scans this week, came back again.
3. [ ] "Scans over time" chart, "Top performer" and "Coming up" (Mural night) show.
4. [ ] "Bringing people in" lists the live displays.
5. [ ] Theme toggle switches to dark (night background, ink cards) and back.

## 3. 3D library (photo → 3D)  ·  costs money

Each run uses one OpenAI image edit (~$0.05–0.25) and one Meshy job (~20–30 credits).
Do it once per QA pass.

1. [ ] Displays → **3D menu library** → **Add a drink**. Name "QA Spritz", price 12,
      style Signature, **Real size in AR: Highball · 15 cm**. Save.
2. [ ] Choose **Custom height…** on another item → a Height (cm) box appears;
      entering 900 shows "Enter a real height between 1 and 500 cm."
3. [ ] Open the new drink's menu → **Make 3D preview** → choose a real drink photo
      (opaque drink, plain background works best; clear spirits over ice do not).
4. [ ] The cutout appears next to the original within ~30 s. Tick the approval box.
5. [ ] **Build the 3D preview** → progress climbs to 100% in ~1–3 minutes.
6. [ ] The 3D preview spins and can be dragged. **Publish to menu** works.
7. [ ] Edit the drink → the size picker still shows Highball · 15 cm.
8. [ ] Category list includes Dish, Figure, Art and Object.

## 4. Displays

1. [ ] Displays page shows pastel tiles, filters (All / Live / Drafts / Paused).
2. [ ] **Create AR display** → 3D menu item → pick "QA Spritz" → title → publish.
3. [ ] Create a **Virtual art piece** → upload an image → in **Show it in 3D (optional)**
      pick "QA Spritz" (or any item with a model) → publish.
4. [ ] Create a **Promo offer** with an offer title → publish.
5. [ ] Create an **Event teaser** without a start time → it refuses to publish and says
      to add when the event starts.
6. [ ] Pause a display → it moves to Paused; publish it again.
7. [ ] Delete a test display → it disappears after confirming.

## 5. QR codes and table cards

1. [ ] QR Codes page lists the demo spots with scans and walk-ins.
2. [ ] **Add spots** → "QA Table" → a new code appears; point it at the QA art display.
3. [ ] Download a **PNG** → the file opens and scans with a phone camera.
4. [ ] Switch Table tent / Window sticker / Poster → **Download print-ready PDF** →
      the PDF opens with the codes laid out.
5. [ ] **AR table-card artwork**: upload a detailed image, width 12 cm → the
      **AR tracking quality** meter shows Excellent / Good / Needs work; save it;
      it appears under Saved cards; its PDF downloads.

## 6. Guest flow (without the iPhone app)

Simulates a guest's phone. Run in a second Terminal tab:

```sh
cd ~/Desktop/Christian_app/argraphics && set -a && . ./.env && set +a
curl -s -X POST localhost:22674/api/v1/scans -H "x-api-key: $IOS_API_KEY" \
  -H 'content-type: application/json' -d '{"code":"demotbl1","visitorId":"qa-guest-000000000001"}'
```

1. [ ] The response names the venue, spot "Table 1", and the display for that code.
2. [ ] Scan your **QA Table** code → the display has `modelUsdzUrl`, `modelHeightCm`
      and `"price":null` (art pieces never show a price).
3. [ ] Scan with a menu-item code → `modelHeightCm` is 15 and the price shows.
4. [ ] Claim the offer (replace the id with the promo display's id):
      `curl -s -X POST localhost:22674/api/v1/displays/demo-display-wednesday/claims -H "x-api-key: $IOS_API_KEY" -H 'content-type: application/json' -d '{"visitorId":"qa-guest-000000000001","code":"demotbl2"}'`
      → a confirmation code like `AB-1234`; claiming again returns the same code.
5. [ ] Without the `x-api-key` header the scan is refused (401).
6. [ ] Open http://localhost:22674/s/demotbl1 in a browser → the scan fallback page shows.
7. [ ] Back on **Home** and **Analytics**: scans, unique visitors and walk-ins went up.

## 7. Analytics

1. [ ] This week / Month / Season switch changes the numbers' range.
2. [ ] Funnel, "When scans happen" heatmap, By display and By spot tables all show
      the guest activity from section 6.
3. [ ] Recent walk-ins lists the claim and its confirmation code.

## 8. Artist account

1. [ ] Sign in as the artist → artist home shows their placements (Night Bloom).
2. [ ] Venue owners can credit this artist on an art display (search by name).

## 9. iPhone app (needs a Mac with Xcode 26 and a real iPhone)

Setup: `brew install xcodegen`, copy `ios/Config/Secrets.example.xcconfig` to
`Secrets.xcconfig`, set `ARGRAPHICS_API_BASE_URL` to this Mac's address on the same
wifi (e.g. `http://192.168.1.177:22674/api`) and `ARGRAPHICS_IOS_API_KEY` to
`IOS_API_KEY` from `.env`. Also set `LOCAL_STORAGE_PUBLIC_URL` in `.env` to the same
host (`http://192.168.1.177:22674`) and restart, or models won't download.
Then `cd ios && xcodegen generate`, open the project, run on the iPhone.

1. [ ] App opens to the scanner in the orange/night theme.
2. [ ] Scan a printed demo code → venue name appears, then the display.
3. [ ] **3D menu item**: the drink stands on the table at real size (a 15 cm highball
      looks highball-sized next to a real glass), sitting on its base, not floating.
4. [ ] Point at a printed **table card** → the drink locks onto the card.
      Covering the card leaves it in place on the table.
5. [ ] **Art display with a 3D model** on a wall code → the model stands on the
      table/floor, not stuck sideways on the wall.
6. [ ] **Art display without a model** → framed picture on the wall.
7. [ ] **Torch** button (top right, AR only) lights the scene; it turns off when you leave.
8. [ ] Pinch to resize, two-finger rotate, tap elsewhere to move.
9. [ ] Offer: **Claim** → confirmation code and countdown; staff see it in Analytics.
10. [ ] Deny camera permission → the app shows the flat 3D page and a "Turn on camera" button.
11. [ ] Run the app's tests: `xcodebuild … test` (see `ios/README.md`) → all pass.

## 10. Automated checks (developer)

```sh
pnpm --filter @workspace/argraphics run typecheck && pnpm --filter @workspace/argraphics run test
pnpm --filter @workspace/api-server run typecheck && pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/api-zod test
```

- [ ] All pass (last run: 60 web, 255 API, 66 validator tests).

## Known limitations (not bugs)

- Password-reset emails only send on Replit.
- Uploads live in `~/.local/argraphics-storage` on this Mac only.
- Models are ~3 MB (target ~1 MB); clear drinks over clear ice reconstruct poorly.
- No ordering, no platform admin page, no Android or web AR yet.
