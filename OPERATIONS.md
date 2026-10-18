# Running ARGraphics for real partners

What has to be true before a venue, food stand or artist relies on this. Development on a
Mac is covered by `dev-local.sh`; this page is about a hosted deployment.

## Where it runs today: Railway

Project `argraphics` on Railway (owner alonbbar@gmail.com), one environment, `production`:

| Service | What it is |
|---|---|
| `argraphics` | The `Dockerfile` in this repo: builds the web app and the API, runs migrations on start, serves everything at **https://argraphics-production.up.railway.app** (health check `/api/healthz`). One replica. |
| `Postgres` | Managed Postgres on the private network (`postgres.railway.internal`), referenced as `${{Postgres.DATABASE_URL}}`. Private network has no TLS, so `DATABASE_SSL=disable` is set. Turn on point-in-time recovery in the Railway dashboard before real data. |
| volume `/data` | Uploaded photos, models and artwork, kept by `LOCAL_STORAGE_DIR=/data/storage` with signed links served by the API. This is pilot-grade storage: it works, it persists, but it pins the service to one replica and has no bucket versioning. Move to a GCS bucket (`GCS_SERVICE_ACCOUNT_JSON` and friends, then unset `LOCAL_STORAGE_*`) before scaling out. |

Deploy from this directory with `railway up -s argraphics --detach`; the CLI uploads the working
tree (respecting `.gitignore`), so commit first. Variables: `railway variable list -s argraphics`.
Logs: `railway logs -s argraphics`. The first deploy was 2026-10-18.

Custom domain: `railway domain yourdomain.com -s argraphics` prints the DNS record to add
(Cloudflare DNS is fine in front of it). Then set `LOCAL_STORAGE_PUBLIC_URL` and
`VITE_PUBLIC_APP_URL` to the new origin and redeploy, **before** printing QR codes.

Not yet configured there: password-reset email (`PASSWORD_RESET_FROM` / `PASSWORD_RESET_APP_URL`
need a non-Replit sender first) and an App Store link (`VITE_APP_STORE_URL`).

## The shape of a deployment

| Piece | What it needs |
|---|---|
| API (`artifacts/api-server`) | Node 24, `pnpm run build`, then `pnpm start` with the environment below. Stateless; run one or more instances behind HTTPS. |
| Dashboard and guest page (`artifacts/argraphics`) | Static files from `vite build` (`PORT` and `BASE_PATH=/` are required at build time). Serve them on the same origin as the API under `/api`, or list the dashboard origin in `APP_ORIGINS`. |
| PostgreSQL | A managed instance with TLS, automated backups and point-in-time recovery (Neon, Supabase, RDS, Cloud SQL, Render all qualify). |
| Object storage | A Google Cloud Storage bucket for photos, display media and 3D models, with a service account that has Storage Object Admin on that bucket only. |
| Domain | One stable HTTPS host. **Printed QR codes encode this host.** Changing it later means reprinting every card. |

### Environment

Required in production:

| Variable | Purpose |
|---|---|
| `NODE_ENV=production` | Turns on `Secure` cookies, HSTS, database TLS verification and the CORS allowlist. |
| `PORT` | Port the API listens on. |
| `DATABASE_URL` | Postgres connection string. TLS is required (see below). |
| `SESSION_SECRET` | Signs sign-in cookies and keys the hash that anonymises guest device IDs. 32+ random bytes. Rotating it signs everyone out and resets "unique visitor" continuity. |
| `IOS_API_KEY` | Shared token the iPhone app sends. Abuse control, not a secret; rotate with an app release. |
| `GCS_SERVICE_ACCOUNT_JSON` or `GCS_SERVICE_ACCOUNT_FILE` | Google service-account key. |
| `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS` | Bucket paths, e.g. `/argraphics-media/private` and `/argraphics-media/public`. |
| `APP_ORIGINS` | Comma-separated browser origins allowed to call the API cross-origin. Leave unset when the dashboard is served from the same origin. |
| `PASSWORD_RESET_FROM`, `PASSWORD_RESET_APP_URL` | Reset-email sender (on a verified sending domain **you** own) and the HTTPS URL of the dashboard. Without both, password reset answers 503. Email currently goes through the Replit Resend connector and so only works when hosted on Replit; wire a direct provider before hosting elsewhere. |

Optional: `OPENAI_API_KEY` and `MESHY_API_KEY` (photo cleanup and 3D generation; without them those features answer 503), `GENERATION_DAILY_LIMIT` (paid 3D generations one partner may start per day, default 10), `DATABASE_SSL` (`require`, `no-verify`, `disable`; see below), `LOG_LEVEL`.

Never set `LOCAL_STORAGE_DIR` or `LOCAL_STORAGE_PUBLIC_URL` in production: they keep uploads on the server's disk with no access control beyond the URL.

## Schema changes: migrations, not `push`

`drizzle-kit push` diffs a live database and alters it in place. That is fine for a throwaway
development database and dangerous for one holding partners' scans and claims: it can drop a
column to "fix" a rename, and it leaves no record of what ran.

Production uses versioned SQL files in `lib/db/migrations`:

1. Change the schema in `lib/db/src/schema`.
2. `pnpm --filter @workspace/db run generate` writes a new numbered `.sql` file and updates `migrations/meta`. Read it. Rename the file to say what it does (also update `tag` in `meta/_journal.json`).
3. Commit the schema change and the migration together.
4. On deploy, before the new API starts: `pnpm --filter @workspace/db run migrate`. It applies only files the database has not seen (tracked in `__drizzle_migrations`) and is a no-op when nothing is pending.

**Adopting an existing database** that was built with `push`: its tables already exist, so
the baseline `0000_initial_schema.sql` must be *recorded* rather than run. Once, against that
database:

```sh
# the hash drizzle records is the SHA-256 of the migration file's bytes
shasum -a 256 lib/db/migrations/0000_initial_schema.sql
```

```sql
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint
);
-- created_at is the "when" value of the 0000 entry in lib/db/migrations/meta/_journal.json
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('<sha256 from above>', 1792331785551);
```

Simpler and what we recommend: run `migrate` against a **fresh** database for the first
hosted deployment, then never `push` to it again.

Keep development in step by running `migrate` there too (`dev-local.sh` keeps using `push`
for convenience; both lead to the same schema).

## Protecting partner and guest data

What is stored, and how it is protected:

| Data | At rest | Notes |
|---|---|---|
| Owner passwords | bcrypt, cost 12 | Never stored or logged in clear. Reset tokens are stored as SHA-256 hashes and expire in 30 minutes. |
| Owner email, name, venue name, address, coordinates | Encrypted by the database provider (every provider above encrypts disks by default; confirm it is on) | Email is redacted from application logs. |
| Guest identity | Never stored. The app's random device ID is HMAC-hashed with `SESSION_SECRET` before it is written | A database dump cannot be joined back to a phone. |
| Photos, display media, 3D models | Google Cloud Storage server-side encryption (on by default) | Private objects are reached through short-lived signed URLs only. |
| Sign-in sessions | HMAC-signed, `HttpOnly`, `SameSite=Lax`, `Secure` in production, 7-day expiry, invalidated by a password change | |

In transit: HTTPS at the edge with HSTS (one year, subdomains) sent by the API in production.
The API refuses to start a production database connection without TLS and a verified
certificate. Set `DATABASE_SSL=no-verify` only for a provider that uses a self-signed
certificate, and `DATABASE_SSL=disable` only when the database is on a private network and
not reachable from the internet.

Abuse controls, all stored in the database so every instance enforces them:

- Sign-in: 100 attempts per hour per address; 10 failed attempts per hour per account.
- Password reset: 20 requests per hour per address, 5 per email, 40 confirmations per address.
- Guest API: 120 requests per minute per address (in memory, per instance).
- Paid 3D generation: `GENERATION_DAILY_LIMIT` per partner per day (default 10). Photo cleanup has its own quota.

Response headers: `helmet` defaults plus a deny-all Content-Security-Policy for the JSON API,
`Referrer-Policy: no-referrer`, `X-Powered-By` removed. Unhandled errors return a generic JSON
message and are logged with the request id; stack traces never reach a client.

Still to do before scale: a published privacy policy and terms (the footer links are
placeholders), a data-deletion path for a partner who leaves (today: delete the `bars` row,
which cascades, and remove their bucket prefix), and application-level encryption of the
address and coordinates if a provider's disk encryption is ever judged insufficient.

## Backups

- Database: turn on the provider's automated daily backups **and** point-in-time recovery.
  Test a restore into a scratch database once before the first paying partner.
- Object storage: enable bucket versioning (or a soft-delete policy) on the media bucket so a
  bad cleanup can be undone. Models cost real money to regenerate.
- Secrets: keep `SESSION_SECRET` and the service-account key in the host's secret store, not
  in the repository, and keep a copy in a password manager. Losing `SESSION_SECRET` is
  survivable (everyone signs in again); losing the database is not.

## Knowing when something breaks

- Health: `GET /api/healthz` returns `{"status":"ok"}`. Point the host's health check and an
  external uptime monitor at it.
- Logs: pino JSON on stdout. Ship them to the host's log drain. Cookies, API keys, emails,
  passwords and tokens are redacted before they are written.
- Errors: every 5xx is logged with `err` and `req.id`. For alerting, add an error-tracking
  SDK (Sentry or similar) in `artifacts/api-server/src/app.ts` after the router and before
  the JSON error handler, and the browser SDK in `artifacts/argraphics/src/main.tsx`.
  Scrub `email` and `cookie` in its `beforeSend`.

## Pre-launch checklist

- [ ] Stable HTTPS domain; QR codes printed with that host only.
- [ ] `NODE_ENV=production`, all required variables set, `LOCAL_STORAGE_*` unset.
- [ ] Database created fresh, `migrate` run, backups and PITR confirmed.
- [ ] Media bucket with versioning; service account scoped to that bucket.
- [ ] Password reset emails arrive from your own domain.
- [ ] `/api/healthz` monitored; logs shipping; error alerts going somewhere a person reads.
- [ ] Privacy policy and terms published and linked from the landing page footer.
- [ ] One full rehearsal: register a venue, create a display, print a code, scan it on a phone
      over mobile data, claim the offer, see it on the dashboard.
