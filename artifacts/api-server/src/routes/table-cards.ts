import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  CreateTableCardBody,
  CreateTableCardResponse,
  DeleteTableCardParams,
  DeleteTableCardResponse,
  ListTableCardsResponse,
  UpdateTableCardBody,
  UpdateTableCardParams,
  UpdateTableCardResponse,
} from "@workspace/api-zod";
import { db, menuVersionTable, tableCardsTable } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { currentUser } from "./garnish";

const router: IRouter = Router();
const storage = new ObjectStorageService();

async function bumpMenuVersion(barId: string): Promise<void> {
  // The public API reports version 1 even before a row exists.
  // A first mutation must therefore advance that observable version to 2.
  await db.insert(menuVersionTable).values({ barId, version: 2 })
    .onConflictDoUpdate({
      target: menuVersionTable.barId,
      set: { version: sql`${menuVersionTable.version} + 1` },
    });
}

function imageUrl(objectPath: string): string {
  return `/api/storage/objects/${objectPath.replace(/^\/objects\//, "")}`;
}

async function owner(req: Request, res: Response) {
  const user = await currentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage table cards." });
    return null;
  }
  return user;
}

router.get("/table-cards", async (req, res): Promise<void> => {
  const user = await owner(req, res);
  if (!user) return;
  const cards = await db.select().from(tableCardsTable)
    .where(eq(tableCardsTable.barId, user.barId))
    .orderBy(asc(tableCardsTable.createdAt));
  res.json(ListTableCardsResponse.parse(cards.map((card) => ({
    id: card.id,
    name: card.name,
    referenceImageUrl: imageUrl(card.referenceImageUrl),
    physicalWidthCm: Number(card.physicalWidthMeters) * 100,
    isActive: card.isActive,
    createdAt: card.createdAt,
  }))));
});

router.post("/table-cards", async (req: Request, res: Response): Promise<void> => {
  const user = await owner(req, res);
  if (!user) return;
  const parsed = CreateTableCardBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a card name, uploaded artwork, and width from 0 to 100 cm." });
    return;
  }
  try {
    const file = await storage.getObjectEntityFile(parsed.data.objectPath);
    const [metadata] = await file.getMetadata();
    if (!["image/jpeg", "image/png", "image/webp"].includes(metadata.contentType ?? "") ||
        Number(metadata.size ?? 0) > 10 * 1024 * 1024) {
      res.status(400).json({ error: "The uploaded file is not a supported image under 10 MB." });
      return;
    }
    const [card] = await db.insert(tableCardsTable).values({
      id: randomUUID(),
      barId: user.barId,
      name: parsed.data.name.trim(),
      referenceImageUrl: parsed.data.objectPath,
      physicalWidthMeters: (parsed.data.physicalWidthCm / 100).toFixed(5),
      isActive: true,
    }).returning();
    await bumpMenuVersion(user.barId);
    res.status(201).json(CreateTableCardResponse.parse({
      id: card.id,
      name: card.name,
      referenceImageUrl: imageUrl(card.referenceImageUrl),
      physicalWidthCm: Number(card.physicalWidthMeters) * 100,
      isActive: card.isActive,
      createdAt: card.createdAt,
    }));
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(400).json({ error: "Upload the artwork before saving the table card." });
      return;
    }
    req.log.error({ err: error }, "Could not save table card");
    res.status(500).json({ error: "Could not save the table card." });
  }
});

router.patch("/table-cards/:id", async (req: Request, res: Response): Promise<void> => {
  const user = await owner(req, res);
  if (!user) return;
  const params = UpdateTableCardParams.safeParse(req.params);
  const parsed = UpdateTableCardBody.strict()
    .refine((data) => Object.keys(data).length > 0, "Enter card details to update.")
    .safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Enter valid table-card details." });
    return;
  }
  try {
    const card = await db.transaction(async (tx) => {
      const [updated] = await tx.update(tableCardsTable).set({
        ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
        ...(parsed.data.physicalWidthCm !== undefined
          ? { physicalWidthMeters: (parsed.data.physicalWidthCm / 100).toFixed(5) } : {}),
        ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
      }).where(and(eq(tableCardsTable.id, params.data.id), eq(tableCardsTable.barId, user.barId)))
        .returning();
      if (!updated) return null;
      await tx.insert(menuVersionTable).values({ barId: user.barId, version: 2 })
        .onConflictDoUpdate({
          target: menuVersionTable.barId,
          set: { version: sql`${menuVersionTable.version} + 1` },
        });
      return updated;
    });
    if (!card) {
      res.status(404).json({ error: "Table card not found." });
      return;
    }
    res.json(UpdateTableCardResponse.parse({
      id: card.id,
      name: card.name,
      referenceImageUrl: imageUrl(card.referenceImageUrl),
      physicalWidthCm: Number(card.physicalWidthMeters) * 100,
      isActive: card.isActive,
      createdAt: card.createdAt,
    }));
  } catch (error) {
    req.log.error({ err: error }, "Could not update table card");
    res.status(500).json({ error: "Could not update the table card." });
  }
});

router.delete("/table-cards/:id", async (req: Request, res: Response): Promise<void> => {
  const user = await owner(req, res);
  if (!user) return;
  const params = DeleteTableCardParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid table card." });
    return;
  }
  const [card] = await db.delete(tableCardsTable)
    .where(and(eq(tableCardsTable.id, params.data.id), eq(tableCardsTable.barId, user.barId)))
    .returning();
  if (!card) {
    res.status(404).json({ error: "Table card not found." });
    return;
  }
  await bumpMenuVersion(user.barId);
  try {
    await storage.deleteObjectEntity(card.referenceImageUrl);
  } catch (error) {
    req.log.warn({ err: error }, "Could not remove deleted card artwork from storage");
  }
  res.json(DeleteTableCardResponse.parse({ message: "Table card deleted." }));
});

export default router;
