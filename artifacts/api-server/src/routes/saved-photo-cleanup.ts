import { Router, type IRouter } from "express";
import { and, desc, eq, ne } from "drizzle-orm";
import { db, drinksTable, photoCleanupsTable } from "@workspace/db";
import { GetSavedPhotoCleanupResponse } from "@workspace/api-zod";
import { cleanupDraftResponse } from "../lib/saved-photo-cleanup";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";

const router: IRouter = Router();
const storage = new ObjectStorageService();

router.get("/drinks/:id/photo-cleanup", async (req, res): Promise<void> => {
  if (!req.owner) { res.status(401).json({ error: "Sign in to review your photo." }); return; }
  const [drink] = await db.select().from(drinksTable)
    .where(and(eq(drinksTable.id, String(req.params.id)), eq(drinksTable.barId, req.owner.barId)));
  if (!drink) { res.status(404).json({ error: "Drink not found." }); return; }
  const [draft] = await db.select().from(photoCleanupsTable)
    .where(and(eq(photoCleanupsTable.drinkId, drink.id), eq(photoCleanupsTable.ownerId, req.owner.id),
      ne(photoCleanupsTable.status, "discarded")))
    .orderBy(desc(photoCleanupsTable.createdAt)).limit(1);
  // The object path is reserved before OpenAI. Recover a completed storage write
  // even if the HTTP response or final database update was interrupted.
  if (draft?.status === "processing" && draft.cleanedPhotoPath) {
    try {
      const file = await storage.getObjectEntityFile(draft.cleanedPhotoPath);
      const [metadata] = await file.getMetadata();
      await db.update(photoCleanupsTable).set({ status: "ready", cleanedSize: Number(metadata.size), error: null, updatedAt: new Date() })
        .where(and(eq(photoCleanupsTable.id, draft.id), eq(photoCleanupsTable.status, "processing")));
      draft.status = "ready";
      draft.error = null;
    } catch (error) {
      if (!(error instanceof ObjectNotFoundError)) throw error;
    }
  }
  // A process interrupted by a server restart must not leave the studio locked forever.
  if (draft?.status === "processing" && Date.now() - draft.updatedAt.getTime() > 300_000) {
    await db.update(photoCleanupsTable).set({ status: "failed", error: "The cleanup was interrupted. Choose a photo to retry." })
      .where(and(eq(photoCleanupsTable.id, draft.id), eq(photoCleanupsTable.status, "processing")));
    draft.status = "failed";
    draft.error = "The cleanup was interrupted. Choose a photo to retry.";
  }
  const [previousReadyDraft] = draft?.status === "failed"
    ? await db.select().from(photoCleanupsTable).where(and(
      eq(photoCleanupsTable.drinkId, drink.id), eq(photoCleanupsTable.ownerId, req.owner.id),
      eq(photoCleanupsTable.status, "ready"),
    )).orderBy(desc(photoCleanupsTable.createdAt)).limit(1)
    : [];
  res.set("Cache-Control", "private, no-store").json(GetSavedPhotoCleanupResponse.parse({
    draft: draft ? cleanupDraftResponse(draft) : null,
    previousReadyDraft: previousReadyDraft ? cleanupDraftResponse(previousReadyDraft) : null,
  }));
});

router.get("/drinks/:id/photo-cleanup/:draftId/:kind", async (req, res): Promise<void> => {
  if (!req.owner) { res.status(401).json({ error: "Sign in to review your photo." }); return; }
  const [row] = await db.select({ draft: photoCleanupsTable }).from(photoCleanupsTable)
    .innerJoin(drinksTable, eq(drinksTable.id, photoCleanupsTable.drinkId))
    .where(and(eq(photoCleanupsTable.id, String(req.params.draftId)), eq(photoCleanupsTable.drinkId, String(req.params.id)),
      eq(photoCleanupsTable.ownerId, req.owner.id), eq(drinksTable.barId, req.owner.barId), ne(photoCleanupsTable.status, "discarded")));
  const draft = row?.draft;
  const path = req.params.kind === "source" ? draft?.sourcePhotoPath : req.params.kind === "cleaned" && draft?.status === "ready" ? draft.cleanedPhotoPath : null;
  if (!path) { res.status(404).json({ error: "Saved photo not found." }); return; }
  try {
    const file = await storage.getObjectEntityFile(path);
    res.set("Cache-Control", "private, no-store").type("png");
    file.createReadStream().on("error", () => {
      if (!res.headersSent) res.status(503).json({ error: "Your saved photo is temporarily unavailable. Reopen the studio to try again." });
      else res.end();
    }).pipe(res);
  } catch {
    res.status(503).json({ error: "Your saved photo is temporarily unavailable. Reopen the studio to try again." });
  }
});

export default router;
