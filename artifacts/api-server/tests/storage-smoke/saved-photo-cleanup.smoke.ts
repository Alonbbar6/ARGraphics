import { createServer } from "node:http";
import request from "supertest";
import sharp from "sharp";
import { File, type FileMetadata, type SaveData, type SaveOptions } from "@google-cloud/storage";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { db, resetDatabase, schema } from "../support/database";
import { ObjectStorageService } from "../../src/lib/objectStorage";
import { getObjectAclPolicy } from "../../src/lib/objectAcl";
import { prepareCleanupPhoto } from "../../src/lib/photo-cleanup";
import { app, manifest } from "./setup";
import { SmokeManifest } from "./safety";

const mocks = vi.hoisted(() => ({ edit: vi.fn() }));
vi.mock("openai", () => {
  class APIError extends Error {}
  class OpenAI {
    static APIError = APIError;
    images = { edit: mocks.edit };
  }
  return { default: OpenAI, toFile: vi.fn(async (bytes) => bytes) };
});

const endpoint = "/api/drinks/fixture-drink/photo-cleanup";
type Draft = { id: string; sourcePhotoPath: string; cleanedPhotoPath: string; status: string };

it.each(["owner", "other-owner"] as const)(
  "rejects different retry bytes from %s without replacing a real saved cutout or its private owner",
  async (retryOwner) => {
    const storage = new ObjectStorageService();
    const original = await sharp({ create: { width: 12, height: 10, channels: 4, background: { r: 120, g: 30, b: 10, alpha: 0.5 } } })
      .png().toBuffer();
    const conflicting = await sharp({ create: { width: 12, height: 10, channels: 4, background: { r: 10, g: 30, b: 120, alpha: 0.5 } } })
      .png().toBuffer();
    expect(conflicting.equals(original)).toBe(false);
    // Setup records this generated path before the real write, even on failure.
    const path = await storage.savePrivateImage(original, "owner");
    manifest.assertOwned(path);
    let target: File | undefined;
    async function snapshot(file: File) {
      try {
        const [metadata] = await file.getMetadata();
        const [bytes] = await file.download();
        return { generation: metadata.generation, bytes, acl: await getObjectAclPolicy(file) };
      } catch {
        throw new Error("Disposable fault-injection image could not be inspected.");
      }
    }
    const before = await snapshot();
    expect(before.generation).toBeDefined();
    expect(before.metageneration).toBeDefined();
    expect(before.bytes).toEqual(original);
    expect(before.contentType).toBe("image/png");
    expect(before.cacheControl).toBe("private, no-store");
    expect(Number(before.size)).toBe(original.length);
    expect(before.acl).toEqual({ owner: "owner", visibility: "private" });

    const realSave: (this: File, data: SaveData, options?: SaveOptions) => Promise<void> = File.prototype.save;
    const realSetMetadata: (this: File, metadata: FileMetadata) => Promise<unknown> = File.prototype.setMetadata;
    let writeAttempts = 0;
    let rejectedOverwrites = 0;
    let metadataAttempts = 0;
    const isTarget = (file: File) => file.name === target.name && file.bucket.name === target.bucket.name;
    const save = vi.spyOn(File.prototype, "save").mockImplementation(async function(this: File, bytes, options) {
      if (!Buffer.isBuffer(bytes) || !bytes.equals(cleaned)) {
        return realSave.call(this, bytes, options);
      }
      const path = `/objects/${this.name.slice(`${manifest.directory.split("/").slice(2).join("/")}/`.length)}`;
      manifest.assertOwned(path); // Registered before this provider write by setup.
      if (!target) target = this;
      expect(this.name).toBe(target.name);
      expect(this.bucket.name).toBe(target.bucket.name);
      expect(options?.preconditionOpts?.ifGenerationMatch).toBe(0);
      writeAttempts++;
      try {
        await realSave.call(this, bytes, options);
        completedWrites++;
      } catch (error) {
        // A real provider precondition rejection is expected on ACL retries.
        // Never print a provider error, which may contain credentials/paths.
        expect((error as { code?: number }).code).toBe(412);
        rejectedOverwrites++;
        const existing = await snapshot(this);
        expect(existing.bytes).toEqual(cleaned);
        expect(existing.generation).toBe(generation);
        throw new Error("Disposable create-only retry rejected by provider.");
      }
      const stored = await snapshot(this);
      expect(stored.bytes).toEqual(cleaned);
      expect(stored.generation).toBeDefined();
      generation = String(stored.generation);
      if (stage === "write-acknowledgement" && injected === 0) {
        boundaryAcl = stored.acl;
        injected++;
        // Provider bytes really exist, but the caller did not receive success.
        throw new Error("Synthetic lost private-image write acknowledgement.");
      }
    });
    const metadata = vi.spyOn(File.prototype, "setMetadata").mockImplementation(async function(this: File, value) {
      if (!target || this.name !== target.name || this.bucket.name !== target.bucket.name) {
        return realSetMetadata.call(this, value);
      }
      aclAttempts++;
      expect(value.metadata?.["custom:aclPolicy"]).toBe(JSON.stringify({ owner: "owner", visibility: "private" }));
      if (aclUnavailable || (stage === "acl-before-write" && injected === 0)) {
        boundaryAcl = (await snapshot(this)).acl;
        injected++;
        throw new Error("Synthetic private-owner metadata write interruption.");
      }
      const result = await realSetMetadata.call(this, value);
      completedAclWrites++;
      if (stage === "acl-acknowledgement" && injected === 0) {
        boundaryAcl = (await snapshot(this)).acl;
        injected++;
        throw new Error("Synthetic lost private-owner metadata acknowledgement.");
      }
      return result;
    });
    try {
      await expect(storage.savePrivateImage(conflicting, retryOwner, path))
        .rejects.toThrow("Disposable private-image storage write failed (provider details redacted).");
      expect(writeAttempts).toBe(1);
      expect(rejectedOverwrites).toBe(1);
      expect(metadataAttempts).toBe(0);
      // Includes generation, exact bytes, raw owner metadata and metageneration.
      // A different owner must not be accepted after the failed provider write.
      expect(await snapshot()).toEqual(before);
    } finally {
      metadata.mockRestore();
      save.mockRestore();
      // The setup manifest performs exact-object cleanup, including failures.
    }
  },
);

async function signIn(email = "demo@argraphics.app") {
  const response = await request(app).post("/api/auth/login")
    .send({ email, password: "fixture-password" }).expect(200);
  return (response.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
}

async function checkImages(draft: Draft, source: Buffer, cleaned: Buffer, owner: string, other: string) {
  const storage = new ObjectStorageService();
  for (const [kind, path, bytes] of [
    ["source", draft.sourcePhotoPath, source],
    ["cleaned", draft.cleanedPhotoPath, cleaned],
  ] as const) {
    manifest.assertOwned(path);
    // Keep provider failures from printing bucket paths or credential details.
    const file = await storage.getObjectEntityFile(path).catch(() => {
      throw new Error("Disposable private image could not be resolved.");
    });
    const details = await (async () => {
      try {
        const [metadata] = await file.getMetadata();
        const [stored] = await file.download();
        return { metadata, stored, acl: await getObjectAclPolicy(file) };
      } catch {
        throw new Error("Disposable private image metadata/download failed.");
      }
    })();
    expect(details.stored).toEqual(bytes);
    expect(details.metadata.contentType).toBe("image/png");
    expect(details.metadata.cacheControl).toBe("private, no-store");
    expect(Number(details.metadata.size)).toBe(bytes.length);
    expect(details.acl).toEqual({ owner: "owner", visibility: "private" });

    const imageURL = `${endpoint}/${draft.id}/${kind}`;
    await request(app).get(imageURL).expect(401);
    await request(app).get(imageURL).set("Cookie", other).expect(404);
    const response = await request(app).get(imageURL).set("Cookie", owner).expect(200);
    expect(response.body).toEqual(bytes);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    // The generic artwork route must not expose cleanup images to other owners.
    await request(app).get(`/api/storage${path}`).expect(401);
    await request(app).get(`/api/storage${path}`).set("Cookie", other).expect(404);
    // Private at the cloud provider too, not just behind the Express route.
    const unsigned = `https://storage.googleapis.com${manifest.directory}/${path.slice("/objects/".length)}`;
    const denied = await fetch(unsigned, { redirect: "error" });
    expect([401, 403]).toContain(denied.status);
    await denied.body?.cancel();
  }
}

it("stores real private cutouts, recovers interrupted metadata, and finishes disconnected saves without another paid call", async () => {
    const owner = await signIn();
    const other = await signIn("other@example.test");
    const input = await sharp({ create: { width: 12, height: 10, channels: 3, background: "#b54020" } })
      .jpeg().toBuffer();
    const source = await prepareCleanupPhoto(input);
    const cleaned = await sharp({ create: { width: 12, height: 10, channels: 4, background: { r: 140, g: 40, b: 20, alpha: 0.5 } } })
      .png().toBuffer();
    mocks.edit.mockResolvedValue({ data: [{ b64_json: cleaned.toString("base64") }] });
    const [drinkBefore] = await db.select().from(schema.drinksTable).where(eq(schema.drinksTable.id, "fixture-drink"));
    const [menuBefore] = await db.select().from(schema.menuVersionTable).where(eq(schema.menuVersionTable.barId, "argraphics-demo-bar"));
  await request(app).post(endpoint).type("jpeg").send(input).expect(401);
  await request(app).get(endpoint).expect(401);
  await request(app).get(endpoint).set("Cookie", other).expect(404);
  await request(app).post(endpoint).set("Cookie", other).type("jpeg").send(input).expect(404);
  expect(mocks.edit).not.toHaveBeenCalled();

  const saved = await request(app).post(endpoint).set("Cookie", owner).type("jpeg").send(input).expect(200);
    let draft: Draft;
  expect(draft.status).toBe("ready");
  await checkImages(draft, source, cleaned, owner, other);
    for (let reopen = 0; reopen < 2; reopen++) {

          const [stillPending] = await db.select().from(schema.photoCleanupsTable)
            .where(eq(schema.photoCleanupsTable.id, pending.id));
      const resumed = await request(app).get(endpoint).set("Cookie", await signIn()).expect(200);
    expect(resumed.body.draft).toEqual(draft);
    expect(resumed.headers["cache-control"]).toBe("private, no-store");
  }
  expect(mocks.edit).toHaveBeenCalledTimes(1);

  // Fail only the final metadata updates, not reservation or real storage.
  // All three retries fail after the paid output has been durably written.
  const realUpdate = db.update.bind(db);
  let interruptedUpdates = 0;
  const update = vi.spyOn(db, "update").mockImplementation((table) => {
    if (table !== schema.photoCleanupsTable) return realUpdate(table);
    interruptedUpdates++;
    throw new Error("Synthetic final metadata interruption");
  });
  try {
    await request(app).post(endpoint).set("Cookie", owner).type("jpeg").send(input).expect(503);
    expect(interruptedUpdates).toBe(3);
  } finally {
    update.mockRestore();
  }
  const [interrupted] = await db.select().from(schema.photoCleanupsTable)
    .where(eq(schema.photoCleanupsTable.status, "processing"));
  expect(interrupted).toBeDefined();
  expect(interrupted.cleanedSize).toBeNull();
  manifest.assertOwned(interrupted.sourcePhotoPath);
  manifest.assertOwned(interrupted.cleanedPhotoPath!);
  // Other owners cannot trigger metadata recovery or read the pending result.
  await request(app).get(endpoint).set("Cookie", other).expect(404);
  await request(app).get(`${endpoint}/${interrupted.id}/cleaned`).set("Cookie", owner).expect(404);
  const recovered = await request(app).get(endpoint).set("Cookie", await signIn()).expect(200);
  expect(recovered.body.draft.id).toBe(interrupted.id);
  expect(recovered.body.draft.status).toBe("ready");
    const [persisted] = await db.select().from(schema.photoCleanupsTable)
      .where(eq(schema.photoCleanupsTable.id, draft.id));
  expect(persisted.status).toBe("ready");
  expect(persisted.cleanedSize).toBe(cleaned.length);
  expect(persisted.ownerId).toBe("owner");
  expect(persisted.sourceSize).toBe(source.length);
  await checkImages(recovered.body.draft, source, cleaned, owner, other);
  const reopened = await request(app).get(endpoint).set("Cookie", await signIn()).expect(200);
  expect(reopened.body.draft).toEqual(recovered.body.draft);
  expect(mocks.edit).toHaveBeenCalledTimes(2); // One per explicit POST, none on recovery.

  // Use a real HTTP socket and observe the server-side close before allowing
  // OpenAI to finish. A client-side abort alone can race with the provider reply.
  let releaseCutout!: (value: { data: { b64_json: string }[] }) => void;
  const cutout = new Promise<{ data: { b64_json: string }[] }>(resolve => { releaseCutout = resolve; });
  mocks.edit.mockImplementationOnce(() => cutout);
  let serverDisconnected = false;
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === endpoint) {
      res.once("close", () => {
        if (!res.writableFinished) serverDisconnected = true;
      });
    }
    app(req, res);
  });
  await new Promise<void>(resolve => { server.listen(0, "127.0.0.1", resolve); });
  const pending = request(server).post(endpoint).set("Cookie", owner).type("jpeg").send(input);
  // Attach the rejection handler before aborting so it cannot go unhandled.
  const completed = pending.then(
    () => "response",
    (error: { code?: string }) => error.code,
  );
  try {
    await vi.waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(3), { timeout: 60_000 });
    const processing = await request(app).get(endpoint).set("Cookie", owner).expect(200);
    expect(processing.body.draft.status).toBe("processing");
    expect(processing.body.draft.id).not.toBe(recovered.body.draft.id);
    manifest.assertOwned(processing.body.draft.sourcePhotoPath);
    pending.abort();
    await vi.waitFor(() => expect(serverDisconnected).toBe(true), { timeout: 10_000 });
    expect(await completed).toBe("ABORTED");
    // No owner GET/recovery is allowed to repair metadata after this point:
    // the disconnected POST itself must finish the real write and ready update.
    releaseCutout({ data: [{ b64_json: cleaned.toString("base64") }] });
    await vi.waitFor(async () => {
      const [savedAfterClose] = await db.select().from(schema.photoCleanupsTable)
        .where(eq(schema.photoCleanupsTable.id, processing.body.draft.id));
      expect(savedAfterClose.status).toBe("ready");
      expect(savedAfterClose.ownerId).toBe("owner");
      expect(savedAfterClose.sourceSize).toBe(source.length);
      expect(savedAfterClose.cleanedSize).toBe(cleaned.length);
      expect(savedAfterClose.error).toBeNull();
      const [lease] = await db.select().from(schema.photoCleanupLimitsTable)
        .where(eq(schema.photoCleanupLimitsTable.ownerId, "owner"));
      expect(lease.leaseToken).toBeNull();
    }, { timeout: 90_000, interval: 250 });
    const freshOwner = await signIn();
      const resumed = await request(app).get(endpoint).set("Cookie", await signIn()).expect(200);
    expect(resumed.body.draft).toEqual({ ...processing.body.draft, status: "ready" });
    expect(resumed.headers["cache-control"]).toBe("private, no-store");
    await checkImages(resumed.body.draft, source, cleaned, freshOwner, other);
    expect(mocks.edit).toHaveBeenCalledTimes(3);
  } finally {
    // Drain any in-flight handler even when an assertion fails; manifest cleanup
    // must not race a late provider result writing another disposable object.
    pending.abort();
    releaseCutout({ data: [{ b64_json: cleaned.toString("base64") }] });
    await completed;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await vi.waitFor(async () => {
      const [lease] = await db.select().from(schema.photoCleanupLimitsTable)
        .where(eq(schema.photoCleanupLimitsTable.ownerId, "owner"));
      expect(lease.leaseToken).toBeNull();
    }, { timeout: 90_000, interval: 250 });
  }
  // Private drafts must not publish anything or start a 3D generation.
    const [drinkAfter] = await db.select().from(schema.drinksTable).where(eq(schema.drinksTable.id, "fixture-drink"));
    const [menuAfter] = await db.select().from(schema.menuVersionTable).where(eq(schema.menuVersionTable.barId, "argraphics-demo-bar"));
  expect(drinkAfter).toEqual(drinkBefore);
  expect(menuAfter).toEqual(menuBefore);
});

it.each(["write-acknowledgement", "acl-before-write", "acl-acknowledgement", "acl-prolonged", "acl-prolonged-legacy"] as const)(
  "retries real private cutout storage after a transient %s failure without replacing bytes or paying again",
  async (stage) => {
    // Isolate admission limits and draft rows; never reset a workspace database.
    await resetDatabase();
    mocks.edit.mockReset();
    const owner = await signIn();
    const other = await signIn("other@example.test");
    const input = await sharp({ create: { width: 12, height: 10, channels: 3, background: "#b54020" } })
      .jpeg().toBuffer();
    const source = await prepareCleanupPhoto(input);
    const cleaned = await sharp({ create: { width: 12, height: 10, channels: 4, background: { r: 140, g: 40, b: 20, alpha: 0.5 } } })
      .png().toBuffer();
    mocks.edit.mockResolvedValue({ data: [{ b64_json: cleaned.toString("base64") }] });
    const [drinkBefore] = await db.select().from(schema.drinksTable).where(eq(schema.drinksTable.id, "fixture-drink"));
    const [menuBefore] = await db.select().from(schema.menuVersionTable).where(eq(schema.menuVersionTable.barId, "argraphics-demo-bar"));

    // Wrap the provider methods called by the real savePrivateImage, not a
    // replacement storage implementation. The source write is never faulted.
    const realSave: (this: File, data: SaveData, options?: SaveOptions) => Promise<void> = File.prototype.save;
    const realSetMetadata: (this: File, metadata: FileMetadata) => Promise<unknown> = File.prototype.setMetadata;
    let target: File | undefined;
    let generation: string | undefined;
    let writeAttempts = 0;
    let completedWrites = 0;
    let rejectedOverwrites = 0;
    let aclAttempts = 0;
    let completedAclWrites = 0;
    let injected = 0;

    const prolonged = stage === "acl-prolonged" || stage === "acl-prolonged-legacy";
    let boundaryAcl: Awaited<ReturnType<typeof getObjectAclPolicy>> | undefined;

    async function snapshot(file: File) {
      try {
        const [metadata] = await file.getMetadata();
        const [bytes] = await file.download();
        return { generation: metadata.generation, bytes, acl: await getObjectAclPolicy(file) };
      } catch {
        throw new Error("Disposable fault-injection image could not be inspected.");
      }
    }

    const save = vi.spyOn(File.prototype, "save").mockImplementation(async function(this: File, bytes, options) {
      if (!Buffer.isBuffer(bytes) || !bytes.equals(cleaned)) {
        return realSave.call(this, bytes, options);
      }
      const path = `/objects/${this.name.slice(`${manifest.directory.split("/").slice(2).join("/")}/`.length)}`;
      manifest.assertOwned(path); // Registered before this provider write by setup.
      if (!target) target = this;
      expect(this.name).toBe(target.name);
      expect(this.bucket.name).toBe(target.bucket.name);
      expect(options?.preconditionOpts?.ifGenerationMatch).toBe(0);
      writeAttempts++;
      try {
        await realSave.call(this, bytes, options);
        completedWrites++;
      } catch (error) {
        // A real provider precondition rejection is expected on ACL retries.
        // Never print a provider error, which may contain credentials/paths.
        expect((error as { code?: number }).code).toBe(412);
        rejectedOverwrites++;
        const existing = await snapshot(this);
        expect(existing.bytes).toEqual(cleaned);
        expect(existing.generation).toBe(generation);
        throw new Error("Disposable create-only retry rejected by provider.");
      }
      const stored = await snapshot(this);
      expect(stored.bytes).toEqual(cleaned);
      expect(stored.generation).toBeDefined();
      generation = String(stored.generation);
      if (stage === "write-acknowledgement" && injected === 0) {
        boundaryAcl = stored.acl;
        injected++;
        // Provider bytes really exist, but the caller did not receive success.
        throw new Error("Synthetic lost private-image write acknowledgement.");
      }
    });
    const metadata = vi.spyOn(File.prototype, "setMetadata").mockImplementation(async function(this: File, value) {
      if (!target || this.name !== target.name || this.bucket.name !== target.bucket.name) {
        return realSetMetadata.call(this, value);
      }
      aclAttempts++;
      expect(value.metadata?.["custom:aclPolicy"]).toBe(JSON.stringify({ owner: "owner", visibility: "private" }));
      if (aclUnavailable || (stage === "acl-before-write" && injected === 0)) {
        boundaryAcl = (await snapshot(this)).acl;
        injected++;
        throw new Error("Synthetic private-owner metadata write interruption.");
      }
      const result = await realSetMetadata.call(this, value);
      completedAclWrites++;
      if (stage === "acl-acknowledgement" && injected === 0) {
        boundaryAcl = (await snapshot(this)).acl;
        injected++;
        throw new Error("Synthetic lost private-owner metadata acknowledgement.");
      }
      return result;
    });

    let draft: Draft;
    try {
      let response = await request(app).post(endpoint).set("Cookie", owner).type("jpeg").send(input).expect(prolonged ? 503 : 200);

        const [pending] = await db.select().from(schema.photoCleanupsTable);
      const final = await snapshot(target!);
      expect(final.bytes).toEqual(cleaned);
      expect(final.generation).toBe(generation);
      expect(final.acl).toEqual({ owner: "owner", visibility: "private" });
    } finally {
      // Restore only these faults; keep setup's real-write manifest observer.
      metadata.mockRestore();
      save.mockRestore();
    }

    const [persisted] = await db.select().from(schema.photoCleanupsTable)
      .where(eq(schema.photoCleanupsTable.id, draft.id));
    expect(persisted.status).toBe("ready");
    expect(persisted.ownerId).toBe("owner");
    expect(persisted.sourceSize).toBe(source.length);
    expect(persisted.cleanedSize).toBe(cleaned.length);
    await checkImages(draft, source, cleaned, owner, other);
    for (let reopen = 0; reopen < 2; reopen++) {

          const [stillPending] = await db.select().from(schema.photoCleanupsTable)
            .where(eq(schema.photoCleanupsTable.id, pending.id));
      const resumed = await request(app).get(endpoint).set("Cookie", await signIn()).expect(200);
      expect(resumed.body.draft).toEqual(draft);
    }
    expect(mocks.edit).toHaveBeenCalledTimes(1);
    const [drinkAfter] = await db.select().from(schema.drinksTable).where(eq(schema.drinksTable.id, "fixture-drink"));
    const [menuAfter] = await db.select().from(schema.menuVersionTable).where(eq(schema.menuVersionTable.barId, "argraphics-demo-bar"));
    expect(drinkAfter).toEqual(drinkBefore);
    expect(menuAfter).toEqual(menuBefore);

    // Prove exact-object cleanup leaves an unrelated run-owned object alone.
    // The global manifest still owns all three, including on assertion failure.
    const storage = new ObjectStorageService();
    const retained = await storage.savePrivateImage(source, "owner");
    const retainedFile = await storage.getObjectEntityFile(retained);
    const scoped = new SmokeManifest(manifest.directory);
    const files = [];
    for (const path of [draft.sourcePhotoPath, draft.cleanedPhotoPath]) {
      manifest.assertOwned(path);
      scoped.recordGenerated(path);
      files.push(await storage.getObjectEntityFile(path));
    }
    expect(() => scoped.assertOwned(retained)).toThrow("Refusing to touch an object");
    const removed: string[] = [];
    await scoped.cleanup(async (path) => {
      manifest.assertOwned(path);
      removed.push(path);
      await storage.deleteObjectEntity(path);
    });
    expect(removed).toEqual([draft.sourcePhotoPath, draft.cleanedPhotoPath]);
    for (const file of files) {
      const [exists] = await file.exists();
      expect(exists).toBe(false);
    }
    const survivor = await snapshot(retainedFile);
    expect(survivor.bytes).toEqual(source);
    expect(survivor.acl).toEqual({ owner: "owner", visibility: "private" });
  },
);

        const unsigned = `https://storage.googleapis.com${manifest.directory}/${pending.cleanedPhotoPath!.slice("/objects/".length)}`;

        const denied = await fetch(unsigned, { redirect: "error" });

    let aclUnavailable = prolonged;

        const pendingStatus = stage === "acl-prolonged-legacy" ? "failed" : "processing";
