# Table-card and iOS regression tests

Run the offline regressions from the workspace root:

```sh
pnpm test
```

Or run each suite separately:

```sh
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/garnish test
pnpm --filter @workspace/api-server typecheck:tests
```

The API suite sends HTTP requests through the production Express app, including
login/session signing, generated request/response validators, authorization,
CORS, rate limiting, and real Drizzle queries. PGlite executes those queries in
an in-memory PostgreSQL instance. Its DDL is generated from the current production
Drizzle schema, so schema changes are exercised without duplicating migrations
or opening the workspace database. Each test resets its data and clock; each
test file owns and closes its database.

Object storage alone is replaced by a deterministic in-memory service. Tests
simulate delivery of bytes by the external signed PUT, verify metadata checks,
stream those bytes through the private API, and check cleanup calls. They do not
verify cloud upload signatures, URL expiry, or the storage provider's CORS.

The artwork snapshot regressions overwrite the staging upload both after saving
and during validation, then check owner streams and iOS download paths. They also
exercise the real storage service with an offline provider double to require a
specific source generation and a create-only accepted destination. A missing
source generation must fail closed, never fall back to the latest upload.
Accepted copies are independent per card and are removed on validation failure
or database rollback; the signed upload path is never saved for new cards.

The test configuration supplies public synthetic iOS/session keys and blanks
the production database URL and Meshy key. No real credential is needed. Global
fetch is blocked so accidental Meshy or storage-sidecar calls fail explicitly.
Never load workspace secrets into test fixtures.

Public-menu/version and public/owner table-card responses are checked against
both the JSON response schema selected by operation/status in
`lib/api-spec/openapi.yaml` and the generated `@workspace/api-zod` validators.
The OpenAPI check uses JSON Schema 2020-12 without coercion and validates formats,
so serialized dates must be strings and public download URLs must be absolute.
Existing HTTP fixtures cover populated and empty responses; assertion-sensitivity
tests deliberately remove required fields and change types/formats to confirm
these checks fail when wire contracts regress.

The print suite calls the same PDF builder as the owner's download button. It
checks actual PDF MediaBox dimensions (points converted back to millimeters),
page count, image embedding, and aspect ratio for portrait, landscape, square,
fractional, minimum, and maximum width examples. It does not mock jsPDF.

These suites test API and PDF behavior, not browser file-picker/canvas rendering
or the full multi-bar authentication journey.

Password recovery runs in the same isolated database harness and uses a mocked
Resend connector. It covers generic acknowledgements, token expiry/replacement,
single-use races, bcrypt limits, session revocation, delivery errors, and persisted
rate limiting. Response-padding sleeps are mocked; no inbox or live credentials
are used.
# API regression tests

Run the offline API and print regressions from the workspace root with `pnpm test`.
The API package's `test` runs the in-memory suites only. The real-PostgreSQL
owner-isolation and real-storage browser/provider checks remain separate opt-in
commands.

## Opt-in real private-storage smoke check (development only)

The browser suite also includes isolated failure/retry checks in
`browser-smoke/artwork-failures.smoke.ts`: a rejected upload-URL request, rejected
signed PUT, rejected card save, and failed private artwork fetch for PDF export.
Each case uses a fresh browser context and resets only the in-memory database.
One browser request receives a test-only HTTP 503; the retry uses the unchanged
API/provider. Checks cover the error text, busy/re-enabled save controls,
preserved artwork/name/width, no false success, unchanged saved-card API data,
no failed-export download, and successful retry. Uploads are tracked before
response delivery, including failed PUTs and orphaned uploads after failed saves;
the shared manifest cleanup runs even if an assertion fails. These checks stay
opt-in and are not part of the offline `pnpm test` command.

This is a separate command, **never included in `pnpm test`**. Run it inside a
Replit development workspace with App Storage already provisioned, the local
storage sidecar reachable on port 1106, and permission to create, read, sign,
and delete objects. `PRIVATE_OBJECT_DIR` must be configured and must not be
under any `PUBLIC_OBJECT_SEARCH_PATHS` entry. Do not copy keys into the command.
The normal workspace App Storage configuration supplies provider access.

Set `STORAGE_SMOKE_ORIGIN` to the **exact origin** of the development frontend
(for example `https://your-development-host.replit.dev`, no path or trailing
slash). It is used to check the provider's CORS headers, not as an API target.
The bucket must permit this origin (or `*`), PUT and GET, and Content-Type.

```sh
NODE_ENV=development STORAGE_SMOKE=1 \
  STORAGE_SMOKE_ORIGIN="https://${REPLIT_DEV_DOMAIN}" \
  pnpm --filter @workspace/api-server test:storage-smoke
```

Both development mode and explicit opt-in are required; production mode and a
missing flag fail before test collection. The separate configuration blanks
`DATABASE_URL` and `MESHY_API_KEY`, replaces session/iOS keys with public synthetic
fixtures, and mocks only the database module with the existing in-memory PGlite
PostgreSQL fixtures. No workspace or production database connection is opened.
The Express app is exercised in-process; no running API or browser login is
needed. Meshy and all unrelated fetch destinations are explicitly blocked.

The smoke check uploads tiny disposable PNG, JPEG, and WebP images through the
real sidecar-signed PUT URLs; checks stored MIME type/size and exact download
bytes; checks PUT preflight and PUT/GET CORS; checks anonymous, unregistered, and
cross-bar private API reads; and checks that unsigned cloud reads are denied.
Only the synthetic iOS key can request the private download URLs. The iOS URL
must advertise the configured one-hour lifetime and deliver the right bytes.
An additional eight-second URL using the same real signer/provider must work
before expiry and be denied after expiry. This verifies actual provider expiry
without waiting an hour or changing the production download lifetime.

Each run overrides its process-local private directory with a fresh
`storage-smoke/<random UUID>` subdirectory. No existing artwork is touched.
Every upload is validated and recorded **before PUT** in an explicit manifest.
The real snapshot operation is also observed: every accepted copy is recorded
before validation, database writes, or HTTP response delivery. Owner reads use
the saved response's accepted-artwork URL; staging paths remain unregistered.
Cleanup runs even after assertion/PUT/save failures, deletes only those exact
manifest entries (including partial uploads and accepted snapshots), and checks
that each is absent.
It never lists a bucket or recursively deletes a prefix. A retained disposable
image also confirms deleting one card does not delete another object.
Cleanup failures fail the command and name only normalized disposable object
paths; signed URLs and credentials are not printed.

Allow up to a few minutes for provider calls. The command fails rather than
skipping when storage, signing, permissions, expiry, or CORS is unavailable.
Do not forcibly kill it during cleanup. If the process is killed or cleanup
permissions fail, manually remove **only** that run's disposable objects in the
App Storage pane under its `storage-smoke/<UUID>` directory; never delete the
shared uploads directory. Offline regressions cover the namespace/manifest
safety rules without any provider calls.

## Table-card and iOS regressions

Run `pnpm --filter @workspace/api-server test:unit` for the API unit suite,
`pnpm --filter @workspace/garnish test` for the PDF print suite, and
`pnpm --filter @workspace/api-server typecheck:tests` to check all API tests.

The table-card/iOS suite sends HTTP requests through the production Express app,
including login/session signing, generated request/response validators,
authorization, CORS, rate limiting, and real Drizzle queries. PGlite executes
those queries in an in-memory PostgreSQL instance. Its DDL is generated from the
current production Drizzle schema, so schema changes are exercised without
duplicating migrations or opening the workspace database. Each test resets its
data and clock; each test file owns and closes its database.

Object storage alone is replaced by a deterministic in-memory service. Tests
simulate delivery of bytes by the external signed PUT, verify metadata checks,
stream those bytes through the private API, and check cleanup calls. They do not
verify cloud upload signatures, URL expiry, or the storage provider's CORS.

The Vitest configuration supplies public synthetic iOS/session keys and blanks
the production database URL and Meshy key. No real credential is needed. Global
fetch is blocked so accidental Meshy or storage-sidecar calls fail explicitly.
Never load workspace secrets into test fixtures.

The print suite calls the same PDF builder as the owner's download button. It
checks actual PDF MediaBox dimensions (points converted back to millimeters),
page count, image embedding, and aspect ratio for portrait, landscape, square,
fractional, minimum, and maximum width examples. It does not mock jsPDF.

These suites test API and PDF behavior, not browser file-picker/canvas rendering.


## Owner isolation regressions

Run `pnpm --filter @workspace/api-server test:isolation` explicitly. This
database-connected suite is never included in the offline `pnpm test` command.

The suite uses Node's built-in test runner, the real Express application,
registration/session cookies, and real PostgreSQL queries. It requires
`DATABASE_URL` and the normal development database schema, provisioned with
`pnpm --filter @workspace/db push`. Missing setup fails rather than skipping tests.

Each run creates a uniquely named `isolation_test_*` schema, clones table
definitions (not data), restores foreign keys within that schema, and sets the
application pool's search path to **only** that schema. Existing owner/bar data is
never changed. The database role needs permission to create schemas and read the
public table definitions. The schema and temporary test bundle are removed on
normal completion, including test failures. A forcibly killed process can leave
an empty/test-only `isolation_test_*` schema; it can be removed separately.

Session and iOS API keys are synthetic process-local fixtures, not workspace
credentials. Tests do not call App Storage or Meshy: cross-owner requests must
be rejected before reaching those services. Model/photo paths are fixture
metadata only.

Coverage includes two-way drink and insights isolation, hostile barId input,
cross-owner writes/deletes and generation/photo access, signed-out/forged-cookie
requests, public menu publication/availability filtering and API key checks,
cross-bar event rejection, and successful owner CRUD as a positive control.
