---
name: Sync test isolation
description: Keep test infrastructure differences from masking menu-sync regressions.
---

Keep request origins stable when comparing menu responses across independent test requests.

**Why:** Supertest allocates a different ephemeral port per request; generated asset URLs include the request origin, so unchanged menus otherwise compare unequal.

**How to apply:** Control the request origin rather than weakening assertions about drink content.
