---
name: Artwork acceptance
description: Why accepted artwork must be isolated from temporary signed upload capabilities
---

Treat a signed upload as staging, not as the durable artwork an owner or iOS
will read. Capture a particular object generation and fail closed if that
generation disappears; never retry acceptance against the latest revision.
Give each acceptance its own server-only copy before validating it.

**Why:** A signed PUT remains writable until expiry even after successful
validation. A read followed by a database save is not an atomic acceptance:
the upload can be overwritten during decoding or after saving. Independent
accepted copies also prevent deleting one card from breaking another card
created from the same upload.

**How to apply:** Preserve this isolation whenever changing artwork acceptance,
storage paths, or cleanup. Upload signing must never target the accepted
namespace. Rejected or rolled-back copies may be cleaned up, but committed
artwork must remain until its owning card is deleted.

Disposable storage checks must track server-created acceptance copies before
HTTP response delivery, not only staging uploads or successful save responses.

**Why:** A failed validation, lost browser response, or route cleanup failure can
leave an accepted copy behind even though the caller never receives its path.
Test teardown must still know which exact run-owned objects to remove.

**How to apply:** Observe real snapshot creation in opt-in storage checks and
retain both staging and accepted paths in the scoped cleanup manifest.
