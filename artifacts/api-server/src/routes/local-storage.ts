import { Router, type IRouter, type Request, type Response } from "express";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { objectStorageClient } from "../lib/objectStorage";
import { verifyLocalUrl, type LocalFile } from "../lib/localObjectStorage";

/**
 * Serves the signed URLs issued by local storage (LOCAL_STORAGE_DIR), standing
 * in for Google Cloud's signed upload and download links. Not mounted otherwise.
 */
const router: IRouter = Router();
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function target(req: Request) {
  const raw = req.params.objectName;
  const object = Array.isArray(raw) ? raw.join("/") : String(raw ?? "");
  const bucket = String(req.params.bucket);
  return { bucket, object };
}

function file(bucket: string, object: string) {
  return objectStorageClient.bucket(bucket).file(object) as unknown as LocalFile;
}

// Read the env directly: test suites mock ../lib/objectStorage wholesale.
if (process.env.LOCAL_STORAGE_DIR) {
  router.put("/local-storage/:bucket/*objectName", async (req: Request, res: Response): Promise<void> => {
    const { bucket, object } = target(req);
    if (!verifyLocalUrl("PUT", bucket, object, req.query)) {
      res.status(403).json({ error: "This upload link is invalid or expired." });
      return;
    }
    let received = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        callback(received > MAX_UPLOAD_BYTES ? new Error("too large") : null, chunk);
      },
    });
    try {
      await pipeline(req, limit, file(bucket, object).createWriteStream({ contentType: req.get("content-type") ?? undefined }));
      res.status(200).end();
    } catch (error) {
      if (received > MAX_UPLOAD_BYTES) {
        res.status(413).json({ error: "That file is too large." });
        return;
      }
      req.log.error({ err: error }, "Local storage upload failed");
      res.status(500).json({ error: "The upload did not finish." });
    }
  });

  router.get("/local-storage/:bucket/*objectName", async (req: Request, res: Response): Promise<void> => {
    const { bucket, object } = target(req);
    if (!verifyLocalUrl("GET", bucket, object, req.query)) {
      res.status(403).json({ error: "This link is invalid or expired." });
      return;
    }
    try {
      const stored = file(bucket, object);
      const [metadata] = await stored.getMetadata();
      res.setHeader("Content-Type", metadata.contentType ?? "application/octet-stream");
      res.setHeader("Content-Length", String(metadata.size));
      res.setHeader("Cache-Control", "private, max-age=300");
      await pipeline(stored.createReadStream(), res);
    } catch (error) {
      if ((error as { code?: number }).code === 404) {
        res.status(404).json({ error: "Not found." });
        return;
      }
      req.log.error({ err: error }, "Local storage download failed");
      if (!res.headersSent) res.status(500).json({ error: "Could not load the file." });
    }
  });
}

export default router;
