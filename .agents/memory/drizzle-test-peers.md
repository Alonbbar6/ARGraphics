---
name: Drizzle test driver peers
description: Why the in-memory PostgreSQL test driver needs matching pnpm peer resolution across database consumers.
---

Keep Drizzle's optional test-driver peers aligned across packages sharing schema types.

**Why:** Adding PGlite only to a consumer made pnpm resolve a second Drizzle instance. Its private SQL type identity differed from the schema package's instance, producing widespread TypeScript errors even though runtime queries worked.

**How to apply:** When changing PostgreSQL test-driver dependencies, ensure the shared schema package and its consumers resolve the same Drizzle peer set. Rebuild shared TypeScript declarations before interpreting missing generated-schema exports as source errors.
