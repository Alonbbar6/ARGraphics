---
name: Browser smoke type boundaries
description: Keep browser-only DOM typing out of shared Node API test compilation.
---
Browser smoke checks should not add global DOM libraries to the API test compiler; keep browser-only code in a separate type boundary or explicitly invoked JavaScript expressions.

**Why:** API tests compile the server sources too. Adding DOM globals changes the meaning of the global ReadableStream type and breaks Node stream conversions even when no server code changed.

**How to apply:** When extending browser checks, retain the Node compiler environment. Browser expressions are JavaScript, not TypeScript, and string expressions must be explicitly invoked.
