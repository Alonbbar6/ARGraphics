---
name: Menu version consistency
description: The iOS menu polling contract requires atomic menu changes and version updates.
---

Any mutation that changes what an iOS menu returns must advance the owning bar's version in the same database transaction, including card edits and drink publication changes. External file cleanup happens only after commit.

**Why:** A successful menu mutation followed by a failed version write is invisible to clients that poll the version; reversing the order can advertise data that never committed.

**How to apply:** When adding or modifying menu-visible writes, couple the version update to the write and test failure on either side of the transaction. Keep external cleanup outside the transaction and do not run it after rollback.
