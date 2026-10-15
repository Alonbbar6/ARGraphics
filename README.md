# Garnish

Garnish is a mobile-first menu dashboard for independent cocktail bars. Owners can create a private bar account, manage drinks and prices, view menu insights, manage table-card artwork with print-size PDF export, and turn drink photos into reviewed 3D models for their iOS menu.
## Run the app

- Start the web app with `pnpm --filter @workspace/garnish run dev`.
- Start the API with `pnpm --filter @workspace/api-server run dev`.
- Run workspace checks with `pnpm run typecheck`.
- Apply development schema changes with `pnpm --filter @workspace/db run push`.


## Development demo sign-in

- Email: `demo@garnish.app`
- Password: `Garnish-demo-2026!`
- This seeded account is created only when the API runs with `NODE_ENV=development`. It is not created in production.

## Opt-in development browser artwork smoke

The offline `pnpm test` suite never launches a browser or calls real storage.
To check actual Chromium file selection, browser-enforced storage CORS, private
saved-artwork reload and card-sized print PDF downloads for PNG/JPEG/WebP:

```sh
pnpm --filter @workspace/api-server exec playwright install chromium
NODE_ENV=development STORAGE_SMOKE=1 BROWSER_STORAGE_SMOKE=1 \
  pnpm --filter @workspace/api-server test:browser-storage-smoke
```

Run only in the development workspace with App Storage configured. This command
starts the existing Garnish UI at `http://127.0.0.1:4179` (the port must be free)
and a separate loopback API, not the running dashboard/API or any deployed URL.
It reuses the in-memory PostgreSQL fixtures, logs in with synthetic sessions,
clears the database connection and Meshy settings, and substitutes a fake iOS
key and session secret. It never reads production data or invokes Meshy/iOS.
The browser blocks external traffic except this run's private cloud objects.
Optional `BROWSER_SMOKE_CHROMIUM_PATH` selects an installed Chromium executable.
On Replit, use the bundled system browser to avoid missing Linux libraries:

```sh
NODE_ENV=development STORAGE_SMOKE=1 BROWSER_STORAGE_SMOKE=1 \
  BROWSER_SMOKE_CHROMIUM_PATH=/repl/tools/bin/chromium \
  pnpm --filter @workspace/api-server test:browser-storage-smoke
```

Storage uploads use a unique private namespace and are recorded before PUT.
Cleanup runs on success or failure, deletes only manifest-owned objects, and
verifies absence. Never use bucket-wide/prefix deletes. Keep the process alive
until cleanup completes: a forced kill cannot run cleanup. Errors name the
failed phase without printing signed URLs or session cookies; no traces/HAR or
owner artwork are saved. The PDF checks verify embedded artwork and a 100 × 50 mm
page; they do not control an OS print dialog or send jobs to a printer.

## Secrets

Set secrets in Replit Secrets. Never put secret values in source files.

- `SESSION_SECRET` signs the HTTP-only owner session cookie.
- `MESHY_API_KEY` is used by the server to create and poll image-to-3D tasks. Keep it in Replit Secrets.
- App Storage holds uploaded drink photos and generated model and thumbnail files.
- `IOS_API_KEY` must be set before the iOS menu API will respond. Requests without it receive HTTP 503; requests with an invalid key receive HTTP 401.

## Current API endpoints

All routes below are served under `/api`.

- `GET /healthz` returns `{"status":"ok"}`.
- `GET /auth/session` returns `{"authenticated":false,"userName":null,"barName":null,"barSlug":null}` when signed out.
- `POST /auth/register` accepts `name`, `barName`, `email`, and a password of at least 12 characters; it creates a private bar account and starts a session.
- `POST /auth/login` accepts an email and password and sets an HTTP-only session cookie.
- `POST /auth/logout` clears the session cookie.
- `GET /drinks` lists the signed-in owner's drinks.
- `POST /storage/drink-photos/request-url` creates a short-lived upload URL for a validated drink photo; the browser uploads directly to App Storage.
- `GET /drinks/{id}/generation` returns photo-to-3D progress and review links.
- `POST /drinks/{id}/generation` starts Meshy image-to-3D generation from the approved photos.
- `GET /drinks/{id}/photos/{source|cleaned}` serves the owner's private before-and-after photos.
- `POST /drinks` accepts `{"name":"Garden Gimlet","description":"Cucumber, basil, lime","priceCents":1500,"category":"signature"}`.
- `PATCH /drinks/{id}` accepts any subset of the drink fields, such as `{"priceCents":1600,"isAvailable":false}`.
- `DELETE /drinks/{id}` removes a drink.
- `GET /insights` returns view totals and per-drink counts.
- `GET /table-cards`, `POST /table-cards`, and `DELETE /table-cards/{id}` manage the signed-in owner's table cards.
- `POST /storage/uploads/request-url` creates a short-lived upload URL for table-card artwork. Upload image bytes directly to that URL.
- Drink, table-card, and storage operations are scoped to the signed-in owner's bar.
- `GET /v1/bars/{slug}/menu-version` returns that bar's menu version. Requires the `x-api-key` header.
- `GET /v1/bars/{slug}/menu` returns that bar's published and available drinks. Requires the `x-api-key` header.
- `GET /v1/bars/{slug}/table-cards` returns active artwork and physical widths in centimeters. Requires the `x-api-key` header.
- `POST /v1/bars/{slug}/events` records a `view`, `ar_open`, or `ar_close` event for a drink. Requires the `x-api-key` header and is rate limited to 120 requests per IP per minute.

Example iOS request:

```sh
curl -H "x-api-key: $IOS_API_KEY" \
  http://localhost:80/api/v1/bars/demo-bar/menu
```

Fetch a bar's table cards and record an AR opening:

```sh
curl -H "x-api-key: $IOS_API_KEY" \
  http://localhost:80/api/v1/bars/demo-bar/table-cards

curl -X POST \
  -H "x-api-key: $IOS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"drinkId":"demo-cocktail-1","eventType":"ar_open"}' \
  http://localhost:80/api/v1/bars/demo-bar/events
```

The iOS API accepts browser preflight requests and the `x-api-key` header. Keep `IOS_API_KEY` in Replit Secrets; do not embed it in a public client build or commit it to source control. iOS API traffic is limited to 120 requests per IP per minute.

Table-card owner uploads accept PNG, JPEG, and WebP images up to 10 MB. The owner dashboard estimates print DPI and contrast before saving. The PDF export sets the requested physical width in centimeters and preserves the uploaded artwork's aspect ratio.

The current menu response shape is:

```json
{
  "barName": "Demo Bar",
  "logoUrl": null,
  "drinks": [
    {
      "id": "demo-cocktail-1",
      "name": "Blood Orange Spritz",
      "description": "Blood orange, prosecco, rosemary",
      "price": "$16.00",
      "priceCents": 1600,
      "category": "signature",
      "thumbnailUrl": null,
      "modelUsdzUrl": null,
      "modelGlbUrl": null,
      "updatedAt": "2026-10-14T19:11:46.351Z"
    }
  ]
}
```

## Remaining implementation stages

Password recovery remains future work. The iOS menu exposes published model asset URLs and table-card artwork, with a menu version that updates when menu content changes.
