---
name: Generated request validation
description: Object-level OpenAPI constraints can be omitted from generated Zod validators.
---

Do not assume generated request validators enforce every OpenAPI constraint. In particular, inspect object-level restrictions such as `additionalProperties: false` and `minProperties` and explicitly enforce any missing restrictions at the server boundary.

**Why:** The installed generator emitted an ordinary optional-field object for a strict, nonempty update contract. Without additional runtime validation, unknown-only or empty updates would be accepted.

**How to apply:** After generating a new partial-update contract, inspect the generated validator and test empty bodies and unknown fields as well as each field's bounds.
