# Table-card and iOS regression tests

Run all regressions from the workspace root:

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

The test configuration supplies public synthetic iOS/session keys and blanks
the production database URL and Meshy key. No real credential is needed. Global
fetch is blocked so accidental Meshy or storage-sidecar calls fail explicitly.
Never load workspace secrets into test fixtures.

The print suite calls the same PDF builder as the owner's download button. It
checks actual PDF MediaBox dimensions (points converted back to millimeters),
page count, image embedding, and aspect ratio for portrait, landscape, square,
fractional, minimum, and maximum width examples. It does not mock jsPDF.

These suites test API and PDF behavior, not browser file-picker/canvas rendering
or the full multi-bar authentication journey.
