---
name: PGlite clock isolation
description: Local clock mocks can affect PGlite's SQL clock, unlike a separate PostgreSQL server.
---

Do not use PGlite to prove that database-backed limits are independent of application clock skew. Use isolated real PostgreSQL connections for that claim.

**Why:** Mocking JavaScript `Date.now()` also changed PGlite's `clock_timestamp()` in the in-process regression environment. That made a correct SQL-clock implementation appear to return years of retry delay.

**How to apply:** In PGlite tests, set expiry boundaries relative to SQL `clock_timestamp()` and assert admission behavior. Verify application-clock independence separately against real PostgreSQL.
