---
name: Concurrent API merges
description: Preserve handler semantics and verify regenerated validators after concurrent API changes.
---

After concurrent API-contract changes are merged, regenerate the API outputs from the OpenAPI source and verify them in a native ESM test runtime as well as checking types.

**Why:** Bundling can change declaration and initialization behavior, hiding errors that appear when a native ESM consumer imports the generated source. A healthy bundled server alone does not establish that the generated source is valid.

**How to apply:** Validate regenerated API outputs in their native ESM consumers as well as the bundled server. Preserve all suites in the combined test command.

Check repeated route handlers by their own request and response contracts when resolving concurrent API merges; a marker-free merge is not proof that handler bodies were matched correctly.

**Why:** Similar-looking handlers are not interchangeable; an automatic merge can change behavior even when the result looks plausible.

**How to apply:** Preserve each incoming feature's intent, compare affected handlers against their operation contracts, and use the existing route regression tests after reconciliation.

Serialize freshness checks that regenerate API files with tests that import those files.

**Why:** Code generation temporarily removes its output directory. Concurrent completion checks can produce a missing generated-module failure even though the files exist before and after the run and both checks pass separately.

**How to apply:** Keep both configured checks intact and use a shared lock around their commands. Do not treat transiently missing generated files as a product regression or weaken the import tests.
