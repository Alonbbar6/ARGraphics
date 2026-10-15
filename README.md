# Garnish

Garnish is a mobile-first menu dashboard for independent cocktail bars. Owners can create a private bar account, manage drinks and prices, view menu insights, manage table-card artwork with print-size PDF export, and turn drink photos into reviewed 3D models for their iOS menu.
## Run the app

- Start the web app with `pnpm --filter @workspace/garnish run dev`.
- Start the API with `pnpm --filter @workspace/api-server run dev`.
- Run workspace checks with `pnpm run typecheck`.
- Check committed API output freshness with `pnpm run check:api-codegen`.
- Apply development schema changes with `pnpm --filter @workspace/db run push`.


## Generated API checks

`lib/api-spec/openapi.yaml` and `lib/api-spec/orval.config.ts` are the source of
truth for both generated API libraries. The **Generated API freshness** CI job
installs locked dependencies in a clean checkout, runs
`pnpm --filter @workspace/api-spec run codegen`, and fails if either
`lib/api-zod/src/generated` or `lib/api-client-react/src/generated` differs from
the committed output, including added and deleted files.

For local checks, `pnpm run check:api-codegen` regenerates files in the current
checkout and compares them against `HEAD`; it does not discard local changes.
After changing the API contract or generator configuration, run codegen and
commit both generated directories together with those changes. Type checking
alone cannot detect stale but compiling output. This check is separate from
service startup. Run `pnpm run test:api-codegen-check` for its regression tests.

## Public iOS backward compatibility

The **Public iOS compatibility** pull-request workflow compares
`lib/api-spec/openapi.yaml` in the proposed commit to the contract at
`git merge-base HEAD <target-branch-commit>`. Checkout uses full history and the
PR head, not GitHub's synthetic merge commit. A moving target branch does not
become the baseline until its changes are part of the shared history. Missing
history, missing baseline files, invalid YAML and unresolved refs fail the check;
there is no fallback to `HEAD`, a checked-in snapshot, or an empty baseline.

Run locally with an explicit, fetched target:

```sh
pnpm run test:ios-contract
git fetch origin main
pnpm run check:ios-contract --base-ref origin/main
```

The local command compares the working-tree spec (including staged and unstaged
edits); CI checks the committed proposed spec. Baseline operations under `/v1/`
or tagged `ios` are protected, including menu-version, menu, table-cards and
events, and their transitively referenced schemas. The existing public asset
endpoint `GET /storage/public-objects/{filePath}` is also protected: its
thumbnail and 3D-model URLs are returned to iOS clients, despite its `drinks`
tag and non-versioned path. Removing an operation's tag cannot remove it from
that PR's check. Owner-only changes are outside this gate.

The checker rejects removed paths/methods, existing response fields (even
optional fields), response status/media removals, weakened required response
guarantees, type/nullability/format changes, newly required request headers,
queries or body fields, tighter request limits/enums, broader response
limits/enums, and authentication/base-URL changes. It handles arrays, local refs,
recursive schemas and path-level parameters with operation overrides. New
endpoints, new response fields, optional request fields/parameters and relaxed
request limits are additive. It assumes clients ignore unknown response fields.
Unknown structural constructs (for example changed `allOf`, `oneOf`, patterns,
serialization, response headers or links) are conservatively rejected if their
resolved structure changes; extend the checker and its tests before treating
such a change as safe. External refs and structural `$ref` siblings are rejected.

This check concerns the **wire contract for existing iOS clients**, not whether
generated files are fresh, the implementation returns the documented response,
or an Orval upgrade preserves validator behavior. Those remain separate checks.

### Intentional breaking changes

Prefer a new versioned endpoint while preserving `/v1/` for installed clients.
Do not loosen the checker, retag an endpoint, or refresh a baseline to hide a
failure. A spec-only approval does not migrate installed apps or server code.

Before allowing any exception, repository administrators must:

1. Require the `ios-contract-gate` status in branch protection/rulesets and
   disallow direct pushes/bypasses on the target branch.
2. Create the `ios-contract-breaking-change` GitHub environment with required
   API/iOS reviewers and **prevent self-review**. Restrict who can modify that
   environment and these workflow/checker files through repository review rules.
   Environment configuration must be enforced administratively outside this PR
   workflow: the read-only workflow token cannot inspect repository environment
   settings. Do not add an administrator credential to PR-controlled code.
   An unprotected or automatically created environment will not enforce review,
   so administrators must verify protection before permitting approval records.
3. Require both the API owner and iOS owner to approve the PR's client rollout,
   version retirement and rollback plan. GitHub environment protection accepts
   one of its listed reviewers, so it is a final additional gate, **not** a
   substitute for both owners' documented PR sign-offs.

For an agreed break, commit
`lib/api-spec/ios-breaking-change-approval.json` with this shape:

```json
{
  "baseSha256": "<exact baseline hash printed by the checker>",
  "proposedSha256": "<exact proposed hash printed by the checker>",
  "issues": ["<exact reported issue, without the leading '- '>"],
  "reason": "<why a compatible or versioned change is not sufficient>",
  "migrationPlan": "<supported client versions, rollout, retirement and rollback>",
  "apiOwner": "<API owner's reviewer handle>",
  "iosOwner": "<iOS owner's reviewer handle>",
  "approvalUrl": "https://<link-to-both-owners-review>"
}
```

Include **every** reported issue, with no extra entries. Both hashes bind the
record to the exact raw YAML bytes, so another spec edit or a changed merge base
invalidates the approval. A valid record only sends CI to the protected
environment; `ios-contract-gate` cannot pass until that review succeeds.
Local checks print that review is still needed; they do not grant approval.
Remove the record in the next compatible PR; a retained stale record never
authorizes another break. Repository environment/ruleset configuration is an
administrator setup step, not something this source change applies remotely.


## Development demo sign-in

- Email: `demo@garnish.app`
- Password: `Garnish-demo-2026!`
- This seeded account is created only when the API runs with `NODE_ENV=development`. It is not created in production.

## Opt-in development browser artwork smoke

The offline `pnpm test` suite never launches a browser or calls real storage.
To check actual file selection, browser-enforced storage CORS, private
saved-artwork reload and card-sized print PDF downloads for PNG/JPEG/WebP:

```sh
pnpm --filter @workspace/api-server exec playwright install chromium
NODE_ENV=development STORAGE_SMOKE=1 BROWSER_STORAGE_SMOKE=1 \
  pnpm --filter @workspace/api-server test:browser-storage-smoke
```

Chromium remains the default. Select any supported engines explicitly; the same
PNG/JPEG/WebP upload, private-access and PDF assertions run sequentially for each:

```sh
pnpm --filter @workspace/api-server exec playwright install chromium firefox webkit
NODE_ENV=development STORAGE_SMOKE=1 BROWSER_STORAGE_SMOKE=1 \
  BROWSER_SMOKE_BROWSERS=chromium,firefox,webkit \
  pnpm --filter @workspace/api-server test:browser-storage-smoke
```

Use `BROWSER_SMOKE_BROWSERS=firefox` or `webkit` for a single-engine check.
Unknown, empty or duplicate selections fail immediately. A requested engine
that cannot launch fails with its name and prerequisite guidance, never a silent
skip or a fallback to Chromium.


### Browser platform prerequisites

Use the browser builds matching this workspace's Playwright version and a
Playwright-supported OS (macOS, Windows, or a supported Ubuntu/Debian release;
WebKit support varies by OS). On supported Linux hosts, provision the OS
libraries with Playwright's `install --with-deps chromium firefox webkit`
command, which requires system package installation privileges. Browser downloads
alone do not supply those libraries. On NixOS/Replit, do not run Debian package
installation commands: use compatible Nix-provisioned engine builds/libraries
or run the matrix on a supported development host with development App Storage
and its signing service configured. Ordinary system Firefox/Safari are not
substitutes for Playwright's patched Firefox/WebKit builds.

`webkit` tests Playwright's WebKit engine, not the installed Safari app or an iOS
device. It catches engine regressions but does not certify native Safari file
dialogs or device printing. Fixtures are encoded in memory by the test server,
so WebKit's lack of WebP canvas encoding on some platforms cannot prevent testing
its WebP decoding, canvas pixel access and PDF image conversion.

Run only in the development workspace with App Storage configured. This command
starts the existing Garnish UI at `http://127.0.0.1:4179` (the port must be free)
and a separate loopback API, not the running dashboard/API or any deployed URL.
It reuses the in-memory PostgreSQL fixtures, logs in with synthetic sessions,
clears the database connection and Meshy settings, and substitutes a fake iOS
key and session secret. It never reads production data or invokes Meshy/iOS.
The browser blocks external traffic except this run's private cloud objects.
Optional `BROWSER_SMOKE_CHROMIUM_PATH` selects an installed Chromium executable.
`BROWSER_SMOKE_FIREFOX_PATH` and `BROWSER_SMOKE_WEBKIT_PATH` can similarly select
compatible Playwright engine executables; prefer the default managed builds.
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
- `POST /drinks/photo-cleanup` accepts authenticated JPEG, PNG, or WebP bytes (up to 15 MB) and returns an AI-cleaned transparent PNG. Uses `OPENAI_API_KEY` server-side with OpenAI image editing, not the Replit AI proxy. Each selected photo incurs OpenAI usage; no automatic paid retries. Limited to one simultaneous cleanup and four attempts per owner per ten minutes per API process. Owners review the cutout before sending it to Meshy.
- `POST /drinks/{id}/generation` starts Meshy image-to-3D generation from the approved photos, using `MESHY_API_KEY`. Meshy charges are separate from OpenAI cleanup. Existing polling, persistent model storage, interactive preview, and manual publishing follow cleanup approval.
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
