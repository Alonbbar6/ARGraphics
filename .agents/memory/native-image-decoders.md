---
name: Native image decoder test builds
description: Native image packages need runtime loading preserved in test bundles as well as application builds.
---

Keep native image decoders external in every bundle that imports API routes, including standalone regression-test runners.

**Why:** Image libraries use module-relative paths to load their native runtime. Bundling ESM decoder internals into CommonJS can erase the module URL and fail during initialization even though the application bundle and ordinary unit tests pass.

**How to apply:** When adding or upgrading an image decoder, check both the application build and independent test bundlers. Verify each distinct test runtime rather than treating a passing unit suite as proof that a standalone runner can import the routes.
