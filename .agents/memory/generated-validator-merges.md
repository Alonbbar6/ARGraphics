---
name: Generated validator merges
description: Why API code generation must be verified in a native ESM test runtime after concurrent API changes
---

After concurrent API-contract changes are merged, regenerate the API outputs from the OpenAPI source and verify them in a native ESM test runtime as well as checking types.

**Why:** Bundling can change declaration and initialization behavior, hiding errors that appear when a native ESM consumer imports the generated source. A healthy bundled server alone does not establish that the generated source is valid.

**How to apply:** Validate regenerated API outputs in their native ESM consumers as well as the bundled server. Preserve all suites in the combined test command.
