import { randomUUID } from "node:crypto";

export function smokeScope(privateDir: string, publicDirs: string, origin: string) {
  const base = privateDir.replace(/\/+$/, "");
  if (!/^\/[^/]+\/[^?#]+$/.test(base) || base.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("A valid PRIVATE_OBJECT_DIR is required for real storage smoke checks.");
  }
  // A private smoke namespace must never fall under a public search path.
  if (publicDirs.split(",").some((path) => {
    const publicPath = path.trim().replace(/\/+$/, "");
    return publicPath && (base === publicPath || base.startsWith(`${publicPath}/`));
  })) {
    throw new Error("PRIVATE_OBJECT_DIR overlaps public storage; refusing smoke uploads.");
  }
  let parsed: URL;
  try { parsed = new URL(origin); } catch {
    throw new Error("STORAGE_SMOKE_ORIGIN must be the development frontend origin.");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin) {
    throw new Error("STORAGE_SMOKE_ORIGIN must be an HTTP(S) origin without a path or credentials.");
  }
  return { directory: `${base}/storage-smoke/${randomUUID()}`, origin };
}

// An explicit manifest, never bucket listing, recursive delete, or prefix delete.
export class SmokeManifest {
  private readonly objects = new Set<string>();
  constructor(readonly directory: string) {}

  record(uploadURL: string, objectPath: string) {
    if (!/^\/objects\/uploads\/[a-f0-9-]{36}$/i.test(objectPath)) {
      throw new Error("Smoke upload returned an unexpected object path.");
    }
    const url = new URL(uploadURL);
    const expected = `${this.directory}/${objectPath.slice("/objects/".length)}`;
    if (url.origin !== "https://storage.googleapis.com" || decodeURIComponent(url.pathname) !== expected) {
      throw new Error("Smoke upload escaped its isolated storage namespace.");
    }
    this.objects.add(objectPath);
  }

  assertOwned(path: string) {
    if (!this.objects.has(path)) throw new Error("Refusing to touch an object not created by this smoke run.");
  }

  /** Register server-generated writes before the provider can create any bytes. */
  recordGenerated(objectPath: string) {
    if (!/^\/objects\/uploads\/[a-f0-9-]{36}$/i.test(objectPath)) {
      throw new Error("Smoke generated image returned an unexpected object path.");
    }
    this.objects.add(objectPath);
  }

  recordAccepted(uploadPath: string, acceptedPath: string) {
    this.assertOwned(uploadPath);
    if (!/^\/objects\/uploads\/[a-f0-9-]{36}$/i.test(uploadPath)
      || !/^\/objects\/accepted-artwork\/[a-f0-9-]{36}$/i.test(acceptedPath)) {
      throw new Error("Smoke acceptance returned an unexpected object path.");
    }
    this.objects.add(acceptedPath);
  }

  async cleanup(remove: (path: string) => Promise<void>) {
    const failures: Error[] = [];
    for (const path of this.objects) {
      try {
        this.assertOwned(path);
        await remove(path);
        this.objects.delete(path);
      } catch {
        // No signed URLs, credentials, bucket names, or provider errors in output.
        failures.push(new Error(`Cleanup failed for disposable object ${path}`));
      }
    }
    if (failures.length) throw new AggregateError(failures, "Disposable artwork cleanup failed; retry cleanup for the listed run-owned objects.");
  }
}
