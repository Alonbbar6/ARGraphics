---
name: Paid cutout recovery
description: Why durable paid output must survive private-metadata interruptions.
---

Treat a confirmed immutable paid-output write separately from successful access-metadata persistence. Keep it recoverable during extended metadata outages, and repair private owner metadata before declaring it ready. Include failed drafts from older servers in recovery.

**Why:** An access-metadata failure can occur after the paid bytes are already durable. Treating the combined save as entirely failed would invite another charge and lose the saved result; a stale-job deadline does not mean that existing paid bytes are unusable.

**How to apply:** Preserve this distinction across storage wrappers and fault-injection helpers. Recovery uses authenticated draft ownership, never another image cleanup, and must not rewrite output bytes. A metadata outage must not trigger the missing-output timeout behavior.
