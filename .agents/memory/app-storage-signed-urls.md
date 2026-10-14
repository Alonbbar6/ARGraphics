---
name: App Storage signed URLs
description: Replit App Storage signed URL generation with sidecar-authenticated GCS.
---

Use Replit's object-storage sidecar signing endpoint for both upload and read URLs. The App Storage GCS client is authenticated through the Replit sidecar, not a service-account private key, so standard GCS `File.getSignedUrl()` can fail even when ordinary bucket reads and writes work.

**Why:** The workspace's App Storage service uses sidecar credentials; a signed GET URL must use the same sidecar flow as the provided upload URL helper.

**How to apply:** When Meshy or another external service needs temporary access to a private object, sign a short-lived GET URL through the sidecar helper, then keep only the object path in the database.
