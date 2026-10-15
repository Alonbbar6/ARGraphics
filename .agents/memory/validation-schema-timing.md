---
name: Validation and merged setup timing
description: Completion checks can see concurrent changes before dependencies or the development database are updated.
---

Completion validation can include concurrently merged changes whose dependency installation or development database updates have not run yet. Distinguish an unapplied setup change from a regression in the assigned work before changing unrelated application or test code.

**Why:** A generator-only change passed its own checks, but completion's owner-isolation suite failed signup with an HTML HTTP 500 after password-recovery changes merged. The development database lacked the new user columns; applying the existing development schema update resolved that setup mismatch.

Missing-package import failures also occurred when merged native-image validation reached completion before its locked dependencies were installed.

**How to apply:** When completion validation fails after a concurrent merge, check the failing dependency against the current manifest and lockfile; install declared dependencies with pnpm install --frozen-lockfile when needed. For database failures, compare current schema definitions with development database metadata and apply an existing, non-destructive development schema update when needed. Do not change production or weaken the failing tests.
