# Garnish

Garnish is a mobile-first menu dashboard for independent cocktail bars. The current first release includes a public marketing page, a demo bar sign-in, persistent drink and price management, availability controls, menu versioning, and an insights page.

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
- `GET /v1/bars/{slug}/menu-version` returns `{"version":1}`. Requires the `x-api-key` header.
- `GET /v1/bars/{slug}/menu` returns the published and available menu. Requires the `x-api-key` header.

Example iOS request:

```sh
curl -H "x-api-key: $IOS_API_KEY" \
  http://localhost:80/api/v1/bars/demo-bar/menu
```

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

The image cleanup and Meshy task polling flow, interactive 3D review and publishing, table card uploads and print-ready PDFs, event logging, and owner self-service registration are not part of this first release yet. Those features need their UI and API work completed before the iOS client can use the full contract described in the original product brief.
