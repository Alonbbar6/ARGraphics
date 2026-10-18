import { Router, raw, type IRouter, type Request, type Response } from "express";
import OpenAI from "openai";
import { cleanupDrinkPhoto, PhotoCleanupError } from "../lib/photo-cleanup";
import { acquireCleanupLease, cleanupRequestTimeoutMs, releaseCleanupLease } from "../lib/photo-cleanup-limits";
import { savePhotoCleanup } from "../lib/saved-photo-cleanup";
import savedPhotoCleanupRouter from "./saved-photo-cleanup";
import { SavePhotoCleanupResponse } from "@workspace/api-zod";

const router: IRouter = Router();
const parsePhoto = raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "15mb" });

function readPhoto(req: Request, res: Response, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    parsePhoto(req, res, error => {
      signal.removeEventListener("abort", aborted);
      if (error) reject(error);
      else resolve();
    });
  });
}

// Mounted after requireOwner. Admission happens before reading bytes or spending credits.
router.use(savedPhotoCleanupRouter);
router.post(["/drinks/photo-cleanup", "/drinks/:id/photo-cleanup"], async (req, res): Promise<void> => {
  const owner = req.owner;
  if (!owner) { res.status(401).json({ error: "Sign in to clean up a photo." }); return; }
  if (!["image/jpeg", "image/png", "image/webp"].includes(req.get("content-type")?.split(";")[0] ?? "")) {
    res.status(415).json({ error: "Choose a JPEG, PNG, or WebP photo." }); return;
  }
  // Start the deadline before database admission so lock waits cannot extend it.
  const controller = new AbortController();
  let savingDraft = false;
  const timeout = setTimeout(() => controller.abort(new Error("Cleanup deadline exceeded")), cleanupRequestTimeoutMs);
  timeout.unref();
  const disconnected = () => {
    // Saved cutouts must finish even if the studio/tab closes after upload.
    // The server deadline still applies, so no paid call can outlive its lease.
    if (!res.writableFinished && !savingDraft) controller.abort(new Error("Cleanup client disconnected"));
  };
  res.on("close", disconnected);
  let token: string | undefined;
  try {
    let admission;
    try {
      admission = await acquireCleanupLease(owner.id);
    } catch {
      // Fail closed: never call the paid provider without durable admission.
      req.log.warn("Photo cleanup admission unavailable");
      res.status(503).json({ error: "Photo cleanup is temporarily unavailable. Try again later." });
      return;
    }
    if (!admission.allowed) {
      res.set("Retry-After", String(admission.retryAfterSeconds)).status(429).json({
        error: "A cleanup is already running, or you've reached four attempts in ten minutes. Please wait before trying again.",
      });
      return;
    }
    token = admission.token;
    await readPhoto(req, res, controller.signal);
    controller.signal.throwIfAborted();
    if (req.params.id) {
      savingDraft = true;
      const draft = await savePhotoCleanup(owner.id, owner.barId, String(req.params.id),
        Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), controller.signal);
      if (!res.destroyed) res.set("Cache-Control", "no-store").json(SavePhotoCleanupResponse.parse({ draft }));
      return;
    }
    const output = await cleanupDrinkPhoto(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), controller.signal);
    controller.signal.throwIfAborted();
    res.set("Cache-Control", "no-store").type("png").send(output);
  } catch (error) {
    if (res.destroyed) return;
    if (controller.signal.aborted) {
      res.status(504).json({ error: "Photo cleanup did not finish in time. Try again in a moment." });
    } else if ((error as { type?: string })?.type === "entity.too.large") {
      res.status(413).json({ error: "Choose a photo no larger than 15 MB." });
    } else if (error instanceof PhotoCleanupError) {
      res.status(error.status).json({ error: error.message });
    } else if (error instanceof OpenAI.APIError) {
      // Deliberately do not log the SDK error: it can include request headers.
      req.log.warn({ providerStatus: error.status }, "OpenAI photo cleanup failed");
      const message = error.status === 401
        ? "OpenAI rejected the API key. Check OPENAI_API_KEY in Secrets."
        : error.status === 429
          ? "OpenAI's usage limit was reached. Check your OpenAI billing or try later."
          : error.status === 403
            ? "OpenAI could not authorize image editing. Check model access and organization verification."
            : "OpenAI could not clean up this photo. Try again or choose a clearer image.";
      res.status(502).json({ error: message });
    } else {
      req.log.warn("Photo cleanup failed or timed out");
      res.status(502).json({ error: "Photo cleanup did not finish. Try again in a moment." });
    }
  } finally {
    clearTimeout(timeout);
    res.off("close", disconnected);
    // Do not release on HTTP finish/close: the provider operation must settle first.
    if (token) {
      try { await releaseCleanupLease(owner.id, token); }
      catch { req.log.warn("Photo cleanup lease release unavailable; lease will expire"); }
    }
  }
});

export default router;
