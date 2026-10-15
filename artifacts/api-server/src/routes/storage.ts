import { Router, type IRouter, type Request, type Response } from "express";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { db, tableCardsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { currentUser } from "./garnish";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

router.post(
  "/storage/uploads/request-url",
  async (req: Request, res: Response): Promise<void> => {
    const user = await currentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to upload table-card artwork." });
      return;
    }
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success || !allowedTypes.has(parsed.data?.contentType ?? "")) {
      res.status(400).json({ error: "Use a PNG, JPEG, or WebP image up to 10 MB." });
      return;
    }
    try {
      const uploadURL = await storage.getObjectEntityUploadURL();
      const objectPath = storage.normalizeObjectEntityPath(uploadURL);
      res.json(RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: parsed.data,
      }));
    } catch (error) {
      req.log.error({ err: error }, "Could not create table-card upload URL");
      res.status(500).json({ error: "Could not start the artwork upload." });
    }
  },
);

router.get(
  "/storage/objects/*objectPath",
  async (req: Request, res: Response): Promise<void> => {
    const user = await currentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to view this artwork." });
      return;
    }
    const rawPath = req.params.objectPath;
    const path = Array.isArray(rawPath) ? rawPath.join("/") : rawPath;
    // Retain reads for legacy cards while serving new server-owned snapshots.
    // The database ownership check below still rejects unregistered objects.
    if (!/^(?:uploads|accepted-artwork)\/[a-f0-9-]{36}$/i.test(path)) {
      res.status(404).json({ error: "Artwork not found." });
      return;
    }
    const objectPath = `/objects/${path}`;
    const cards = await db.select({ referenceImageUrl: tableCardsTable.referenceImageUrl })
      .from(tableCardsTable)
      .where(eq(tableCardsTable.barId, user.barId));
    if (!cards.some((item) => item.referenceImageUrl === objectPath)) {
      res.status(404).json({ error: "Artwork not found." });
      return;
    }
    try {
      const file = await storage.getObjectEntityFile(objectPath);
      const [metadata] = await file.getMetadata();
      res.setHeader("Content-Type", metadata.contentType ?? "application/octet-stream");
      res.setHeader("Cache-Control", "private, max-age=300");
      file.createReadStream().on("error", (error: unknown) => {
        req.log.error({ err: error }, "Could not stream table-card artwork");
        if (!res.headersSent) res.status(500);
        res.end();
      }).pipe(res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Artwork not found." });
        return;
      }
      req.log.error({ err: error }, "Could not load table-card artwork");
      res.status(500).json({ error: "Could not load the artwork." });
    }
  },
);

export default router;
