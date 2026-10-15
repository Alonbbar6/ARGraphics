---
name: Validation and merged schema timing
description: Completion checks can see concurrent schema changes before the development database is updated.
---

Completion validation can include concurrently merged changes whose development database updates have not run yet. Distinguish an unapplied schema change from a regression in the assigned work before changing unrelated application or test code.

**Why:** A generator-only change passed its own checks, but completion's owner-isolation suite failed signup with an HTML HTTP 500 after password-recovery changes merged. The development database lacked the new user columns; applying the existing development schema update resolved that setup mismatch.

**How to apply:** When completion validation fails after a concurrent merge, compare the current schema definitions with development database metadata. Apply an existing, non-destructive development schema update when needed; do not change production or weaken the failing tests.
