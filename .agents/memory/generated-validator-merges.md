---
name: Generated validator merges
description: Why API code generation must be verified in a native ESM test runtime after concurrent API changes
---

After concurrent API-contract changes are merged, regenerate the API outputs from the OpenAPI source and verify them in a native ESM test runtime as well as checking types.

**Why:** A generated validator merge placed numeric-limit and regex constants after the schemas that used them. The bundled API still started because its build lowered declarations, while Vitest failed during module initialization. A healthy bundled server alone did not establish that the generated source was valid.

**How to apply:** When an API test fails before running with a “before initialization” error in generated validators, regenerate rather than manually rearranging generated code. Preserve all suites in the combined test command and run the generated-source consumer checks.
