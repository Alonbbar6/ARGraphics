---
name: Generated request validation
description: Generated validators do not always enforce the complete OpenAPI wire contract.
---

Do not assume generated request validators enforce every OpenAPI constraint. In particular, inspect object-level restrictions such as `additionalProperties: false` and `minProperties` and explicitly enforce any missing restrictions at the server boundary.

**Why:** The installed generator emitted an ordinary optional-field object for a strict, nonempty update contract. Without additional runtime validation, unknown-only or empty updates would be accepted.

**How to apply:** After generating a new partial-update contract, inspect the generated validator and test empty bodies and unknown fields as well as each field's bounds.

Use independent, non-coercing OpenAPI checks alongside generated validators when testing serialized response contracts.

**Why:** Generated date validators coerce values into dates, and some documented URL formats are represented as plain strings. Passing generated validation alone does not prove a response has the documented JSON types and formats.

**How to apply:** Check the actual HTTP JSON against the documented response schema, including date-time and URI formats, rather than checking only the parsed or pre-serialization handler value.
