---
name: Design and iOS scope
description: User decisions about the dashboard redesign and replacement iOS app.
---

Apply the uploaded BRAND Desktop Screens visual direction to the owner dashboard only, leaving the marketing homepage unchanged.

**Why:** The user explicitly selected “Owner dashboard only.”

**How to apply:** Scope this redesign to owner-facing screens rather than restyling the public homepage.

The user said to forget the old iOS feature because they lost the code and are building a new iOS app.

**Why:** The old client source is unavailable.

**How to apply:** Do not continue work for the old iOS client. Treat connecting the replacement app as separate work when requested; this is not permission to delete existing APIs.

Use the user's own OpenAI connection for drink photo cleanup rather than retrying Replit AI integration setup.

**Why:** Built-in setup required phone verification; the user explicitly chose their own API key instead.

**How to apply:** Keep credentials server-side in Secrets. Do not retry built-in provider provisioning unless the user requests that change. AI cleanup and Meshy generation are separately billed steps, with cutout review before generation.

Saving a paid cutout for later review must not change the currently published drink.

**Why:** Owners can review a replacement photo while their existing menu stays live; saving AI output is not approval to rebuild or publish.

**How to apply:** Keep review drafts separate from menu-visible drink state until the owner explicitly starts generation.
