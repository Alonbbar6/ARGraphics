import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { createReadStream, createWriteStream, promises as fsp } from 'fs';
import path from 'path';
import { PassThrough, Writable } from 'stream';

/**
 * Disk-backed stand-in for the subset of @google-cloud/storage this server
 * uses, for local development off Replit. Enabled by LOCAL_STORAGE_DIR.
 *
 * Layout: <root>/<bucket>/data/<object> holds bytes and
 * <root>/<bucket>/meta/<object>.json holds content type, custom metadata and
 * a generation, so generation preconditions and pinned copies behave like GCS.
 * Errors carry GCS-style `code` values (404, 412) for existing handlers.
 */

type Metadata = {
  name: string;
  bucket: string;
  generation: string;
  size: number;
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
  updated: string;
};

type SaveOptions = {
  contentType?: string;
  metadata?: { cacheControl?: string; contentType?: string; metadata?: Record<string, string> };
  preconditionOpts?: { ifGenerationMatch?: number };
  resumable?: boolean;
};

function storageError(code: number, message: string): Error {
  return Object.assign(new Error(message), { code });
}

let lastGeneration = 0;
function nextGeneration(): number {
  // Microsecond-scale and strictly increasing, well inside Number.MAX_SAFE_INTEGER.
  lastGeneration = Math.max(lastGeneration + 1, Date.now() * 1000);
  return lastGeneration;
}

export class LocalFile {
  constructor(readonly bucket: LocalBucket, readonly name: string, private readonly options: { generation?: number } = {}) {
    if (!name || name.split('/').some((part) => part === '..' || part === '')) {
      throw storageError(400, 'Invalid object name');
    }
  }

  private get dataPath() { return path.join(this.bucket.root, 'data', this.name); }
  private get metaPath() { return path.join(this.bucket.root, 'meta', `${this.name}.json`); }

  private async readMeta(): Promise<Metadata | null> {
    try {
      return JSON.parse(await fsp.readFile(this.metaPath, 'utf8')) as Metadata;
    } catch {
      return null;
    }
  }

  /** Current metadata, honouring a pinned generation like a GCS versioned read. */
  private async requireMeta(): Promise<Metadata> {
    const meta = await this.readMeta();
    if (!meta || (this.options.generation !== undefined && Number(meta.generation) !== this.options.generation)) {
      throw storageError(404, `No such object: ${this.bucket.name}/${this.name}`);
    }
    return meta;
  }

  async exists(): Promise<[boolean]> {
    return [(await this.readMeta().then((meta) => !!meta && (this.options.generation === undefined || Number(meta.generation) === this.options.generation)))];
  }

  async getMetadata(): Promise<[Metadata]> {
    return [await this.requireMeta()];
  }

  async setMetadata(update: { contentType?: string; cacheControl?: string; metadata?: Record<string, string | null> }): Promise<[Metadata]> {
    const meta = await this.requireMeta();
    const custom = { ...(meta.metadata ?? {}) };
    for (const [key, value] of Object.entries(update.metadata ?? {})) {
      if (value === null) delete custom[key];
      else custom[key] = value;
    }
    const next: Metadata = {
      ...meta,
      contentType: update.contentType ?? meta.contentType,
      cacheControl: update.cacheControl ?? meta.cacheControl,
      metadata: custom,
      updated: new Date().toISOString(),
    };
    await fsp.writeFile(this.metaPath, JSON.stringify(next));
    return [next];
  }

  private async checkPrecondition(options?: SaveOptions['preconditionOpts']) {
    if (options?.ifGenerationMatch === undefined) return;
    const meta = await this.readMeta();
    const current = meta ? Number(meta.generation) : 0;
    if (current !== options.ifGenerationMatch) throw storageError(412, 'Precondition failed');
  }

  /** Atomically moves finished bytes into place and records fresh metadata. */
  private async commit(tempPath: string, options: SaveOptions = {}, custom?: Record<string, string>) {
    await this.checkPrecondition(options.preconditionOpts);
    await fsp.mkdir(path.dirname(this.dataPath), { recursive: true });
    await fsp.mkdir(path.dirname(this.metaPath), { recursive: true });
    await fsp.rename(tempPath, this.dataPath);
    const { size } = await fsp.stat(this.dataPath);
    const meta: Metadata = {
      name: this.name,
      bucket: this.bucket.name,
      generation: String(nextGeneration()),
      size,
      contentType: options.contentType ?? options.metadata?.contentType,
      cacheControl: options.metadata?.cacheControl,
      metadata: custom ?? options.metadata?.metadata ?? {},
      updated: new Date().toISOString(),
    };
    await fsp.writeFile(this.metaPath, JSON.stringify(meta));
  }

  private async tempPath() {
    const dir = path.join(this.bucket.root, 'tmp');
    await fsp.mkdir(dir, { recursive: true });
    return path.join(dir, randomUUID());
  }

  async save(data: Buffer | string, options: SaveOptions = {}): Promise<void> {
    await this.checkPrecondition(options.preconditionOpts);
    const temp = await this.tempPath();
    await fsp.writeFile(temp, data);
    await this.commit(temp, options);
  }

  async download(): Promise<[Buffer]> {
    await this.requireMeta();
    return [await fsp.readFile(this.dataPath)];
  }

  createReadStream(options: { start?: number; end?: number } = {}) {
    const out = new PassThrough();
    this.requireMeta()
      .then(() => createReadStream(this.dataPath, options).on('error', (error) => out.destroy(error)).pipe(out))
      .catch((error: Error) => out.destroy(error));
    return out;
  }

  createWriteStream(options: SaveOptions = {}): Writable {
    let temp: string | null = null;
    let sink: ReturnType<typeof createWriteStream> | null = null;
    const ready = this.tempPath().then((file) => { temp = file; sink = createWriteStream(file); });
    return new Writable({
      write: (chunk, _encoding, callback) => {
        ready.then(() => sink!.write(chunk, callback), callback);
      },
      final: (callback) => {
        ready.then(() => sink!.end(() => this.commit(temp!, options).then(() => callback(), callback)), callback);
      },
      destroy: (error, callback) => {
        ready.then(() => { sink?.destroy(); if (temp) void fsp.rm(temp, { force: true }); }).finally(() => callback(error));
      },
    });
  }

  async delete(options: { ignoreNotFound?: boolean } = {}): Promise<void> {
    const meta = await this.readMeta();
    if (!meta) {
      if (options.ignoreNotFound) return;
      throw storageError(404, 'No such object');
    }
    await fsp.rm(this.dataPath, { force: true });
    await fsp.rm(this.metaPath, { force: true });
  }

  async copy(destination: LocalFile, options: { preconditionOpts?: { ifGenerationMatch?: number } } = {}): Promise<void> {
    const meta = await this.requireMeta();
    const temp = await destination.tempPath();
    await fsp.copyFile(this.dataPath, temp);
    await destination.commit(temp, {
      contentType: meta.contentType,
      metadata: { cacheControl: meta.cacheControl },
      preconditionOpts: options.preconditionOpts,
    }, meta.metadata);
  }

  async getSignedUrl({ action, expires }: { action: 'read' | 'write' | 'delete'; expires: number }): Promise<[string]> {
    const method = action === 'write' ? 'PUT' : action === 'delete' ? 'DELETE' : 'GET';
    return [signLocalUrl(this.bucket.name, this.name, method, expires)];
  }

  /** Inline copy for services that cannot reach this machine, such as Meshy. */
  async toDataUri(): Promise<string> {
    const meta = await this.requireMeta();
    const bytes = await fsp.readFile(this.dataPath);
    return `data:${meta.contentType ?? 'application/octet-stream'};base64,${bytes.toString('base64')}`;
  }
}

export class LocalBucket {
  readonly root: string;
  constructor(readonly storageRoot: string, readonly name: string) {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) throw storageError(400, 'Invalid bucket name');
    this.root = path.join(storageRoot, name);
  }
  file(name: string, options?: { generation?: number }) { return new LocalFile(this, name, options); }
}

export class LocalStorage {
  constructor(readonly root: string) {}
  bucket(name: string) { return new LocalBucket(this.root, name); }
}

/* ------------------------------------------------------------ signed URLs */

export const LOCAL_URL_PREFIX = '/api/local-storage/';

function publicBase() {
  return (process.env.LOCAL_STORAGE_PUBLIC_URL || 'http://localhost:22674').replace(/\/$/, '');
}

function signature(method: string, bucket: string, object: string, expires: number) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is required to sign local storage URLs.');
  return createHmac('sha256', secret).update(`${method}\n${bucket}\n${object}\n${expires}`).digest('base64url');
}

export function signLocalUrl(bucket: string, object: string, method: 'GET' | 'PUT' | 'DELETE', expires: number): string {
  const encoded = object.split('/').map(encodeURIComponent).join('/');
  const query = new URLSearchParams({ m: method, e: String(expires), s: signature(method, bucket, object, expires) });
  return `${publicBase()}${LOCAL_URL_PREFIX}${bucket}/${encoded}?${query}`;
}

export function verifyLocalUrl(method: string, bucket: string, object: string, query: Record<string, unknown>): boolean {
  const expires = Number(query.e);
  if (query.m !== method || !Number.isFinite(expires) || expires < Date.now() || typeof query.s !== 'string') return false;
  const expected = Buffer.from(signature(method, bucket, object, expires));
  const received = Buffer.from(query.s);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Maps a signed local URL back to its /<bucket>/<object> path, or null. */
export function localUrlObjectPath(rawUrl: string): string | null {
  if (!rawUrl.startsWith(`${publicBase()}${LOCAL_URL_PREFIX}`)) return null;
  const { pathname } = new URL(rawUrl);
  return `/${decodeURIComponent(pathname.slice(LOCAL_URL_PREFIX.length))}`;
}
