import { Readable } from "node:stream";
import { vi } from "vitest";

export const artworkPath = "/objects/uploads/11111111-1111-4111-8111-111111111111";
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
  getObjectEntityDownloadURL: vi.fn(async (path: string) => {
    if (!objects.has(path)) throw new ObjectNotFoundError();
    return `https://storage.example.test/signed-download?object=${encodeURIComponent(path)}`;
  }),
  deleteObjectEntity: vi.fn(async (path: string) => { objects.delete(path); }),
};

export class ObjectStorageService {
  getObjectEntityUploadURL = storage.getObjectEntityUploadURL;
  normalizeObjectEntityPath = storage.normalizeObjectEntityPath;
  getObjectEntityFile = storage.getObjectEntityFile;
  getObjectEntityDownloadURL = storage.getObjectEntityDownloadURL;
  deleteObjectEntity = storage.deleteObjectEntity;
}

// Simulates the external signed PUT; the API routes still verify stored metadata.
export function uploadArtwork(
  path = artworkPath,
  contentType = "image/png",
  size = artworkBytes.length,
) {
  objects.set(path, { bytes: artworkBytes, contentType, size });
}
