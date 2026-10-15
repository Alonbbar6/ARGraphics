import { Router, raw, type IRouter } from "express";
import OpenAI from "openai";
import { cleanupDrinkPhoto, PhotoCleanupError } from "../lib/photo-cleanup";

const router: IRouter = Router();
const active = new Set<string>();
const attempts = new Map<string, { count: number; expires: number }>();

// Mounted after requireOwner. Limit before reading the image or spending credits.
router.post("/drinks/photo-cleanup", (req, res, next): void => {
  const owner = req.owner;
  if (!owner) { res.status(401).json({ error: "Sign in to clean up a drink photo." }); return; }
  if (!["image/jpeg", "image/png", "image/webp"].includes(req.get("content-type")?.split(";")[0] ?? "")) {
    res.status(415).json({ error: "Choose a JPEG, PNG, or WebP photo." }); return;
  }
  const now = Date.now();
  for (const [id, entry] of attempts) if (entry.expires <= now) attempts.delete(id);
  const entry = attempts.get(owner.id);
  if (active.has(owner.id) || (entry && entry.count >= 4)) {
    res.set("Retry-After", "60").status(429).json({ error: "A cleanup is already running, or you've reached four attempts in ten minutes. Please wait before trying again." });
    return;
  }
  active.add(owner.id);
  attempts.set(owner.id, { count: (entry?.count ?? 0) + 1, expires: entry?.expires ?? now + 600_000 });
  res.on("finish", () => active.delete(owner.id));
  next();
}, raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "15mb" }), async (req, res): Promise<void> => {
  const ownerId = req.owner!.id;
  try {
    const output = await cleanupDrinkPhoto(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
    res.set("Cache-Control", "no-store").type("png").send(output);
  } catch (error) {
    if (error instanceof PhotoCleanupError) {
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
    active.delete(ownerId);
  }
});

router.use((error: { type?: string }, req: import("express").Request, res: import("express").Response, next: import("express").NextFunction): void => {
  if (req.owner) active.delete(req.owner.id);
  if (error.type === "entity.too.large") {
    res.status(413).json({ error: "Choose a photo no larger than 15 MB." }); return;
  }
  next(error);
});

export default router;
