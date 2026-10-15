---
name: Browser smoke runtime
description: Browser packages and executable availability are separate in Replit.
---
Opt-in browser checks must confirm an executable is available independently of the installed Playwright package. Prefer the environment's provisioned Chromium over downloading a browser during checks.

**Why:** Replit can provide system Chromium while Playwright's default managed browser is absent; package installation alone does not establish launch readiness.

**How to apply:** Verify the provisioned binary with a launch-only probe and use the smoke suite's executable override before starting browser journeys. Keep offline regressions independent of browser installation.
