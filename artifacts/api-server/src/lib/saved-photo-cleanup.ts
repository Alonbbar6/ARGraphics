import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, drinksTable, photoCleanupsTable, type PhotoCleanup } from "@workspace/db";
import { cleanupDrinkPhoto, prepareCleanupPhoto, PhotoCleanupError } from "./photo-cleanup";
import { ObjectStorageService } from "./objectStorage";

const storage = new ObjectStorageService();

export function cleanupDraftResponse(draft: PhotoCleanup) {
  return {
    id: draft.id, drinkId: draft.drinkId, status: draft.status,
    sourcePhotoPath: draft.sourcePhotoPath, cleanedPhotoPath: draft.cleanedPhotoPath,
    error: draft.error, createdAt: draft.createdAt.toISOString(),
  };
}

/** Reserve before the paid call; never tie its lifetime to the HTTP connection. */
export async function savePhotoCleanup(ownerId: string, barId: string, drinkId: string, input: Buffer) {
  const [ownedDrink] = await db.select().from(drinksTable)
    .where(and(eq(drinksTable.id, drinkId), eq(drinksTable.barId, barId))).limit(1);
  if (!ownedDrink) throw new PhotoCleanupError("Drink not found.", 404);
  const source = await prepareCleanupPhoto(input);
  const id = randomUUID();
  const cleanedPhotoPath = `/objects/uploads/${randomUUID()}`;
  const sourcePhotoPath = await storage.savePrivateImage(source, ownerId);
  let reserved = false;
  let outputStored = false;
  try {
    await db.transaction(async (tx) => {
      const [drink] = await tx.select().from(drinksTable)
        .where(and(eq(drinksTable.id, drinkId), eq(drinksTable.barId, barId))).for("update");
      if (!drink) throw new PhotoCleanupError("Drink not found.", 404);
      const pending = await tx.select().from(photoCleanupsTable)
        .where(and(eq(photoCleanupsTable.drinkId, drinkId), eq(photoCleanupsTable.status, "processing")));
      if (pending.length) throw new PhotoCleanupError("A saved cleanup is still running. Reopen the studio to check it.", 409);
      await tx.insert(photoCleanupsTable).values({ id, ownerId, drinkId, sourcePhotoPath, cleanedPhotoPath, sourceSize: source.length });
    });
    reserved = true;
    const output = await cleanupDrinkPhoto(source);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await storage.savePrivateImage(output, ownerId, cleanedPhotoPath);
        outputStored = true;
        break;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
    // Retry saving metadata, never the paid provider operation.
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const [draft] = await db.update(photoCleanupsTable).set({
          cleanedPhotoPath, cleanedSize: output.length, status: "ready", error: null, updatedAt: new Date(),
        }).where(eq(photoCleanupsTable.id, id)).returning();
        if (!draft) throw new Error("Cleanup draft was removed while saving.");
        return cleanupDraftResponse(draft);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  } catch (error) {
    if (reserved && !outputStored) {
      await db.update(photoCleanupsTable).set({
        status: "failed", error: "Cleanup could not be saved. Choose a photo to retry.", updatedAt: new Date(),
      }).where(eq(photoCleanupsTable.id, id));
    } else if (!reserved) {
      await storage.deleteObjectEntity(sourcePhotoPath).catch(() => {});
    }
    if (outputStored) throw new PhotoCleanupError("Your paid cutout is stored. Reopen the studio to recover it before choosing another photo.", 503);
    throw error;
  }
}
