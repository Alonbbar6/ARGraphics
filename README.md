# Garnish

Garnish is a mobile-first menu dashboard for independent cocktail bars. The current first release includes a public marketing page, bar-owner sign-in, persistent drink and price management, availability controls, menu versioning, an insights page, and table-card artwork management with print-size PDF export.

## Run the app

- Start the web app with `pnpm --filter @workspace/garnish run dev`.
- Start the API with `pnpm --filter @workspace/api-server run dev`.
- Run workspace checks with `pnpm run typecheck`.
- Apply development schema changes with `pnpm --filter @workspace/db run push`.

## Demo sign-in

- Email: `demo@garnish.app`
- Password: `Garnish-demo-2026!`

## Secrets

Set secrets in Replit Secrets. Never put secret values in source files.

- `SESSION_SECRET` signs the HTTP-only owner session cookie.
- `MESHY_API_KEY` is stored for the planned photo-to-3D flow. The generation route and storage flow are not implemented in this first release yet.
- `IOS_API_KEY` must be set before the iOS menu API will respond. Requests without it receive HTTP 503; requests with an invalid key receive HTTP 401.

## Current API endpoints

All routes below are served under `/api`.

- `GET /healthz` returns `{"status":"ok"}`.
- `GET /auth/session` returns `{"authenticated":false,"userName":null,"barName":null,"barSlug":null}` when signed out.
- `POST /auth/login` accepts `{"email":"demo@garnish.app","password":"Garnish-demo-2026!"}` and sets an HTTP-only session cookie.
- `POST /auth/logout` clears the session cookie.
- `GET /drinks` lists the signed-in bar's drinks.
- `POST /drinks` accepts `{"name":"Garden Gimlet","description":"Cucumber, basil, lime","priceCents":1500,"category":"signature"}`.
- `PATCH /drinks/{id}` accepts any subset of the drink fields, such as `{"priceCents":1600,"isAvailable":false}`.
- `DELETE /drinks/{id}` removes a drink.
- `GET /insights` returns view totals and per-drink counts.
- `GET /v1/bars/{slug}/menu-version` returns the current menu version number. Requires the `x-api-key` header.
- `GET /v1/bars/{slug}/menu` returns the published and available menu. Requires the `x-api-key` header.
- `GET /v1/bars/{slug}/table-cards` returns active artwork and its physical width in centimeters. Requires the `x-api-key` header.
- `POST /v1/bars/{slug}/events` records a `view`, `ar_open`, or `ar_close` event for a drink. Requires the `x-api-key` header and is rate limited to 120 requests per IP per minute.
- `GET /table-cards`, `POST /table-cards`, and `DELETE /table-cards/{id}` manage a signed-in bar's table cards.
- `POST /storage/uploads/request-url` creates a short-lived upload URL for authenticated owners. Upload the image bytes directly to that URL.

Example iOS request:

```sh
curl -H "x-api-key: $IOS_API_KEY" \
  http://localhost:80/api/v1/bars/demo-bar/menu
```

Fetch table cards and record an AR opening:

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

## Next implementation stages

The photo cleanup and Meshy task polling flow, interactive 3D review and publishing, and owner self-service registration still need their UI and API work before those parts of the original product brief are complete.
