---
name: Validation and merged setup timing
description: Completion checks can see concurrent changes before dependencies or the development database are updated.
---

Completion validation can include concurrently merged changes whose dependency installation or development database updates have not run yet. Distinguish an unapplied setup change from a regression in the assigned work before changing unrelated application or test code.

**Why:** Concurrent merges and their environment setup are not atomic. Validation can see newer source code before its dependencies or development schema are ready.

**How to apply:** After a concurrent merge, distinguish incomplete environment setup from an implementation regression before editing unrelated code. Use the current manifests and schema as the source of truth. Do not change production or weaken tests to compensate for missing development setup.
