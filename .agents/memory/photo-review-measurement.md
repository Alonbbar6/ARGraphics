---
name: Photo review measurement
description: Privacy and interpretation boundaries for paid-cutout outcome analytics.
---

Treat photo-review analytics as aggregate interaction counts, not per-owner billing attribution or proof of exact dollars saved. Do not add owner/drink identifiers, photo paths, images, or drink names to event properties.

**Why:** The requested measurement must preserve photo and owner privacy. Browser events also cannot establish server-side paid completion when the browser closes or tracking is unavailable.

**How to apply:** Compare new versus resumed generation outcomes and deliberate retakes, but describe results as observed activity. A studio reopening can legitimately count another resume; polling progress and re-renders are not resumes. Do not divide browser cleanup-save counts into billing totals or claim an exact owner-level conversion rate without a separate, approved measurement design.

Replit-hosted analytics is injected by the publishing proxy only for analytics-enabled published websites. An absent tracker script in the repository is intentional, not evidence of a disconnected collector.

**Why:** Completion checks may mistake this platform injection for missing app configuration. The analytics skill explicitly prohibits adding an app-owned script, collector URL, website ID, or analytics environment variables.

**How to apply:** Check analytics access before instrumentation and use the injected tracker safely. Verify real delivery only after the main app is merged and published with analytics enabled; never publish a task fork just to satisfy an integration check.
