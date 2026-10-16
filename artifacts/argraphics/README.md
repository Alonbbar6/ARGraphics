# ARGraphics partner web app (`@workspace/argraphics`)

The venue and artist dashboard for ARGraphics, plus the public `/s/:code` scan fallback page.
The package keeps its historical internal name; everything user-visible says ARGraphics.

## Universal links (`/s/*`)

Printed spot QR codes encode `https://<site>/s/<code>`. With the ARGraphics iOS app installed, iOS
opens the app directly; otherwise the guest lands on `/s/:code`, which offers "Open in the
ARGraphics app" (`argraphics://s/<code>`) and the App Store.

`public/.well-known/apple-app-site-association` declares that link. Before shipping:

- **Replace `TEAMID`** in that file with the Apple Developer Team ID that signs the visitor app
  (`TEAMID.app.argraphics.visitor`). Universal links silently fail with the placeholder.
- Serve the file at `https://<site>/.well-known/apple-app-site-association` over HTTPS with
  `Content-Type: application/json` and no redirects.
- Add `applinks:<site>` to the iOS app's Associated Domains entitlement.
- Replace `APP_STORE_URL` in `src/pages/scan.tsx` with the real App Store listing.

## Scripts

From the repo root: `pnpm --filter @workspace/argraphics run typecheck`, `... run build`;
from this folder: `npx vitest run --config vitest.config.ts`.
