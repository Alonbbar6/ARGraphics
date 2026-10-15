# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas, run generated-validator runtime contracts and their typecheck, then check library types
- `pnpm --filter @workspace/api-zod test` — isolated generated table-card validator contracts; no database, storage, or credentials needed (also included in root `pnpm test`)
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server test -- tests/password-recovery.test.ts` — password-recovery regressions against isolated in-memory PostgreSQL; mocks email delivery and never opens the workspace database
- `pnpm --filter @workspace/api-server exec vitest run tests/photo-cleanup.test.ts` — shared cleanup admission, timeout, disconnect, and provider regressions; mocks OpenAI and never spends credits
- `pnpm --filter @workspace/api-server run test:isolation` — isolated real-PostgreSQL checks, including simultaneous cleanup admissions across connections and retained quotas after reconnects; no paid provider calls
- Required env: `DATABASE_URL` — Postgres connection string
- Password recovery uses the connected Resend integration. `PASSWORD_RESET_FROM` must be a sender on a verified Resend domain. Set `PASSWORD_RESET_APP_URL` to the trusted HTTPS Garnish URL (including a base path if mounted below `/`) before running in production. Development falls back to the workspace preview domain only. Missing configuration returns 503 for all recovery requests; links are never built from request headers.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
