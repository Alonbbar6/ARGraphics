---
name: Route merge integrity
description: Similar Express handlers can be incorrectly matched while automatically reconciling concurrent edits.
---
After concurrent route changes are reconciled, compare the resulting diff with the latest main version before trusting earlier passing checks.

**Why:** Repeated Express handler shapes can be matched incorrectly during automatic reconciliation. Earlier passing checks do not verify the resulting merged code.

**How to apply:** Keep a narrow change narrow relative to current main. Preserve newer transactional behavior, restore unrelated handlers from current main when necessary, and verify the reconciled route code rather than relying on pre-sync checks.
