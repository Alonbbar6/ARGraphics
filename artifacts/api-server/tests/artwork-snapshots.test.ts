import type { File } from "@google-cloud/storage";
import { Readable } from "node:stream";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "./support/setup";
import { db, schema } from "./support/database";
import { cardBody, createCard, iosGet, signIn } from "./support/requests";
import {
  acceptedArtworkPath, artworkBytes, artworkPath, objects, storage, uploadArtwork,
} from "./support/storage";

const savedUrl = `/api/storage${acceptedArtworkPath}`;
const replacement = Buffer.from("<svg>not accepted artwork</svg>");

async function expectSavedBytes(cookie: string) {
  const [card] = await db.select().from(schema.tableCardsTable);
  expect(card.referenceImageUrl).toBe(acceptedArtworkPath);
  const owner = await request(app).get("/api/table-cards").set("Cookie", cookie).expect(200);
  expect(owner.body[0].referenceImageUrl).toBe(savedUrl);
  const image = await request(app).get(savedUrl).set("Cookie", cookie).expect(200);
  expect(image.body).toEqual(artworkBytes);
  const ios = await iosGet("demo-bar/table-cards").expect(200);
  const signedPath = new URL(ios.body[0].referenceImageUrl).searchParams.get("object");
  expect(signedPath).toBe(acceptedArtworkPath);
  expect(objects.get(signedPath!)?.bytes).toEqual(artworkBytes);
}

describe("immutable accepted artwork (offline routes)", () => {
  it("keeps owner and iOS artwork unchanged after the old signed upload is overwritten", async () => {
    const cookie = await signIn();
    await createCard(cookie);
    objects.set(artworkPath, { bytes: replacement, size: replacement.length, contentType: "image/png" });
    await expectSavedBytes(cookie);
    await iosGet("demo-bar/menu-version").expect(200, { version: 2 });
    await request(app).get(`/api/storage${artworkPath}`).set("Cookie", cookie).expect(404);
  });

  it.each(["metadata", "bytes"])("keeps the accepted revision when the upload changes during validation's %s read", async (stage) => {
    const cookie = await signIn();
    uploadArtwork();
    storage.getObjectEntityFile.mockImplementationOnce(async (path: string) => {
      expect(path).toBe(acceptedArtworkPath);
      const replace = () => objects.set(artworkPath, {
        bytes: replacement, size: replacement.length, contentType: "image/png",
      });
      return {
        getMetadata: async () => {
          if (stage === "metadata") replace();
          return [{ contentType: "image/png", size: String(artworkBytes.length) }];
        },
        createReadStream: () => {
          if (stage === "bytes") replace();
          return Readable.from(artworkBytes);
        },
      };
    });
    await request(app).post("/api/table-cards").set("Cookie", cookie).send(cardBody).expect(201);
    expect(objects.get(artworkPath)?.bytes).toEqual(replacement);
    await expectSavedBytes(cookie);
  });

  it("does not accept invalid copied bytes even if the upload is replaced with a valid image during validation", async () => {
    const cookie = await signIn();
    objects.set(artworkPath, { bytes: replacement, size: replacement.length, contentType: "image/png" });
    storage.getObjectEntityFile.mockImplementationOnce(async () => ({
      getMetadata: async () => {
        uploadArtwork();
        return [{ contentType: "image/png", size: String(replacement.length) }];
      },
      createReadStream: () => Readable.from(replacement),
    }));
    await request(app).post("/api/table-cards").set("Cookie", cookie).send(cardBody).expect(400);
    expect(await db.select().from(schema.tableCardsTable)).toEqual([]);
    expect(objects.has(acceptedArtworkPath)).toBe(false);
    expect(objects.get(artworkPath)?.bytes).toEqual(artworkBytes);
    await iosGet("demo-bar/menu-version").expect(200, { version: 1 });
  });

  it("saves independent accepted copies when the same upload is reused", async () => {
    const cookie = await signIn();
    const first = await createCard(cookie);
    const second = await request(app).post("/api/table-cards").set("Cookie", cookie).send(cardBody).expect(201);
    expect(second.body.referenceImageUrl).not.toBe(first.body.referenceImageUrl);
    await request(app).delete(`/api/table-cards/${first.body.id}`).set("Cookie", cookie).expect(200);
    const image = await request(app).get(second.body.referenceImageUrl).set("Cookie", cookie).expect(200);
    expect(image.body).toEqual(artworkBytes);
  });

  it("does not save a card or advance the menu if snapshot copying fails", async () => {
    const cookie = await signIn();
    uploadArtwork();
    storage.createObjectEntitySnapshot.mockRejectedValueOnce(new Error("copy failed"));
    await request(app).post("/api/table-cards").set("Cookie", cookie).send(cardBody).expect(500);
    expect(await db.select().from(schema.tableCardsTable)).toEqual([]);
    expect(objects.has(acceptedArtworkPath)).toBe(false);
    await iosGet("demo-bar/menu-version").expect(200, { version: 1 });
  });
});

describe("generation-pinned snapshot copy (real service, offline provider double)", () => {
  async function fixture() {
    // Exercise the production service rather than the shared route storage mock.
    const actual = await vi.importActual<typeof import("../src/lib/objectStorage")>("../src/lib/objectStorage");
    vi.stubEnv("PRIVATE_OBJECT_DIR", "/fixture-bucket/private");
    const service = new actual.ObjectStorageService();
    let liveGeneration = 101;
    const revisions = new Map([[101, Buffer.from(artworkBytes)]]);
    const destination = {
      name: "",
      bytes: Buffer.alloc(0),
    };
    const copy = vi.fn(async (target: typeof destination) => {
      const bytes = revisions.get(101);
      if (!bytes) throw Object.assign(new Error("generation gone"), { code: 404 });
      target.bytes = Buffer.from(bytes);
    });
    const sourceBucket = {
      file: vi.fn((_name: string, options: { generation: number }) => {
        expect(options).toEqual({ generation: 101 });
        return { copy };
      }),
    };
    const source = {
      name: "private/uploads/source",
      bucket: sourceBucket,
      getMetadata: vi.fn(async () => [{ generation: String(liveGeneration) }]),
    };
    vi.spyOn(service, "getObjectEntityFile").mockResolvedValue(source as unknown as File);
    const destinationFile = vi.fn((name: string) => {
      destination.name = name;
      return destination as unknown as File;
    });
    vi.spyOn(actual.objectStorageClient, "bucket").mockReturnValue({
      file: destinationFile,
    } as unknown as ReturnType<typeof actual.objectStorageClient.bucket>);
    return {
      actual, service, source, sourceBucket, copy, destination, destinationFile,
      overwrite(retainOld: boolean) {
        liveGeneration = 102;
        if (!retainOld) revisions.delete(101);
        revisions.set(102, replacement);
      },
    };
  }

  it("copies the captured generation, not a replacement arriving after metadata is read", async () => {
    const f = await fixture();
    f.source.getMetadata.mockImplementationOnce(async () => {
      f.overwrite(true);
      return [{ generation: "101" }];
    });
    const result = await f.service.createObjectEntitySnapshot(artworkPath);
    expect(f.sourceBucket.file).toHaveBeenCalledWith(f.source.name, { generation: 101 });
    expect(f.destinationFile).toHaveBeenCalledWith(expect.stringMatching(/^private\/accepted-artwork\/[a-f0-9-]{36}$/));
    expect(f.copy).toHaveBeenCalledWith(f.destination, { preconditionOpts: { ifGenerationMatch: 0 } });
    expect(result.objectPath).toMatch(/^\/objects\/accepted-artwork\/[a-f0-9-]{36}$/);
    expect(result.file).toBe(f.destination);
    expect(f.destination.bytes).toEqual(artworkBytes);
    f.overwrite(false);
    expect(f.destination.bytes).toEqual(artworkBytes);
  });

  it("fails closed when overwriting removed the captured source generation", async () => {
    const f = await fixture();
    f.source.getMetadata.mockImplementationOnce(async () => {
      f.overwrite(false);
      return [{ generation: "101" }];
    });
    await expect(f.service.createObjectEntitySnapshot(artworkPath)).rejects.toBeInstanceOf(f.actual.ObjectNotFoundError);
    expect(f.copy).toHaveBeenCalledOnce();
    expect(f.destination.bytes.length).toBe(0);
  });

  it("never overwrites an existing accepted destination", async () => {
    const f = await fixture();
    f.copy.mockRejectedValueOnce(Object.assign(new Error("destination exists"), { code: 412 }));
    await expect(f.service.createObjectEntitySnapshot(artworkPath)).rejects.toBeInstanceOf(f.actual.ObjectNotFoundError);
    expect(f.copy).toHaveBeenCalledWith(f.destination, { preconditionOpts: { ifGenerationMatch: 0 } });
  });

  it.each(["", "0", "invalid", "9007199254740993"])("rejects unusable generation %j without copying the latest object", async (generation) => {
    const f = await fixture();
    f.source.getMetadata.mockResolvedValueOnce([{ generation }]);
    await expect(f.service.createObjectEntitySnapshot(artworkPath)).rejects.toThrow("usable generation");
    expect(f.copy).not.toHaveBeenCalled();
  });
});
