---
name: Merge integrity
description: Unexpected changes in hand-authored files after automatic concurrent merges
---

Treat unexpected growth or rewriting of a handwritten file during an automatic
merge as a merge-integrity problem, even if it is not listed as a conflict.

**Why:** Concurrent changes were automatically combined into malformed
TypeScript while only a shared notes file was reported as conflicting. A small
test edit became a large structural rewrite and failed the completion checks.

**How to apply:** When a post-merge check fails, compare the affected file with
the incoming main version. Preserve incoming functionality and reapply only
the intended task changes, then run type checks before completion.
