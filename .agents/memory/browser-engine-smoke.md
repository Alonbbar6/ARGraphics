---
name: Cross-engine artwork smoke constraints
description: Avoid false failures from fixture encoding and successful upload response cancellation.
---
Test WebP decoding with fixtures encoded outside the browser, not with that
browser's canvas encoder.

**Why:** WebKit versions can decode WebP without supporting WebP canvas encoding;
requiring encoding would prevent the actual upload and PDF regression checks.

**How to apply:** Keep synthetic fixtures in memory and exercise browser decode,
canvas pixel access and PDF conversion separately.

A known browser cancellation after a PUT HTTP 200 can concern only its unused
response body, not a failed upload.

**Why:** Chromium emitted `net::ERR_ABORTED` for successful PUT responses during
reload even though the saved private artwork matched the uploaded bytes exactly.

**How to apply:** Accept this only after observing HTTP 200 and retaining exact
stored-byte checks. Never suppress failed PUTs, preflights or general CORS errors.
