import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { vi } from "vitest";

export const artworkPath = "/objects/uploads/11111111-1111-4111-8111-111111111111";

export const acceptedArtworkPath = "/objects/accepted-artwork/11111111-1111-4111-8111-111111111111";
export const artworkBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC",
  "base64",
);
type StoredArtwork = { bytes: Buffer; contentType: string; size: number };
export const objects = new Map<string, StoredArtwork>();

export class ObjectNotFoundError extends Error {}

export const storage = {
  getObjectEntityUploadURL: vi.fn(async () => "https://storage.example.test/signed-upload"),
  normalizeObjectEntityPath: vi.fn(() => artworkPath),
  getObjectEntityFile: vi.fn(async (path: string) => {
    const object = objects.get(path);
    if (!object) throw new ObjectNotFoundError();
    return {
      getMetadata: async () => [{ contentType: object.contentType, size: String(object.size) }],
      createReadStream: () => Readable.from(object.bytes),
    };
  }),
  createObjectEntitySnapshot: vi.fn(async (path: string) => {
    const object = objects.get(path);
    if (!object) throw new ObjectNotFoundError();
    const acceptedPath = objects.has(acceptedArtworkPath)
      ? `/objects/accepted-artwork/${randomUUID()}` : acceptedArtworkPath;
    objects.set(acceptedPath, { ...object, bytes: Buffer.from(object.bytes) });
    return { objectPath: acceptedPath, file: await storage.getObjectEntityFile(acceptedPath) };
  }),
  getObjectEntityDownloadURL: vi.fn(async (path: string) => {
    if (!objects.has(path)) throw new ObjectNotFoundError();
    return `https://storage.example.test/signed-download?object=${encodeURIComponent(path)}`;
  }),
  getObjectEntityReadURL: vi.fn(async (path: string) => {
    if (!objects.has(path)) throw new ObjectNotFoundError();
    return `https://storage.example.test/signed-read?object=${encodeURIComponent(path)}`;
  }),
  deleteObjectEntity: vi.fn(async (path: string) => { objects.delete(path); }),
};

export class ObjectStorageService {
  getObjectEntityUploadURL = storage.getObjectEntityUploadURL;
  normalizeObjectEntityPath = storage.normalizeObjectEntityPath;
  getObjectEntityFile = storage.getObjectEntityFile;
  createObjectEntitySnapshot = storage.createObjectEntitySnapshot;
  getObjectEntityDownloadURL = storage.getObjectEntityDownloadURL;
  getObjectEntityReadURL = storage.getObjectEntityReadURL;
  deleteObjectEntity = storage.deleteObjectEntity;
}

// Simulates the external signed PUT; routes verify both metadata and contents.
export function uploadArtwork(
  path = artworkPath,
  contentType = "image/png",
  size = artworkBytes.length,
) {
  objects.set(path, { bytes: artworkBytes, contentType, size });
}
