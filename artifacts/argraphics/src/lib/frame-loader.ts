import { batchRanges, residentWindow } from './frame-sequence';

/** Something `drawImage` accepts. ImageBitmap where supported, else a decoded <img>. */
export type Drawable = ImageBitmap | HTMLImageElement;

type Slot = {
  blob?: Blob;
  image?: Drawable;
  decoding?: Promise<void>;
};

export type FrameLoaderOptions = {
  /** Most decoded frames held at once. Phones get a sliding window; desktops can hold all. */
  maxResident: number;
  /** Called after each batch lands, with how many frames (from 0) are now fetched. */
  onBatch?: (fetchedThrough: number, total: number) => void;
  /** Called whenever a frame finishes decoding, so the canvas can redraw. */
  onDecoded?: (index: number) => void;
};

const supportsImageBitmap = typeof createImageBitmap === 'function';

async function decode(blob: Blob): Promise<Drawable> {
  if (supportsImageBitmap) {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* fall through to the <img> path (older Safari rejects some WebP) */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function release(image: Drawable) {
  if ('close' in image && typeof image.close === 'function') image.close();
}

/**
 * Fetches a frame sequence in batches and hands decoded frames to a canvas.
 *
 * Every fetched frame stays in memory as a compressed Blob (cheap, ~50 KB). Decoded
 * images are expensive, so only a window around the frame being shown is kept decoded;
 * `want(index)` moves that window and decodes what is missing, nearest frames first.
 */
export class FrameLoader {
  private readonly slots: Slot[];
  private readonly abort = new AbortController();
  private readonly resident = new Set<number>();
  private center = 0;
  private disposed = false;
  private loading: Promise<void> | null = null;

  constructor(
    private readonly urls: string[],
    private readonly options: FrameLoaderOptions,
  ) {
    this.slots = urls.map(() => ({}));
  }

  get count() {
    return this.urls.length;
  }

  /** Fetches the priority batch first, then the rest. Resolves when everything is fetched. */
  load(): Promise<void> {
    if (!this.loading) this.loading = this.run();
    return this.loading;
  }

  private async run() {
    const { signal } = this.abort;
    for (const [start, end] of batchRanges(this.count)) {
      if (this.disposed) return;
      const jobs: Promise<void>[] = [];
      for (let i = start; i < end; i++) {
        jobs.push(
          fetch(this.urls[i], { signal })
            .then((res) => {
              if (!res.ok) throw new Error(`Frame ${i} failed: HTTP ${res.status}`);
              return res.blob();
            })
            .then((blob) => {
              this.slots[i].blob = blob;
            })
            .catch((err: unknown) => {
              if (signal.aborted) return;
              // One missing frame should not kill the sequence; nearest() skips the hole.
              if (import.meta.env.DEV) console.warn('[frame-loader]', err);
            }),
        );
      }
      await Promise.all(jobs);
      if (this.disposed) return;
      this.options.onBatch?.(end, this.count);
      // Decode what the current window wants from this batch.
      this.want(this.center);
    }
  }

  /** Marks `index` as the frame on screen and keeps the decoded window around it. */
  want(index: number) {
    if (this.disposed) return;
    this.center = index;
    const [start, end] = residentWindow(index, this.count, this.options.maxResident);

    // Evict decoded frames that left the window.
    for (const i of this.resident) {
      if (i < start || i >= end) {
        const slot = this.slots[i];
        if (slot.image) release(slot.image);
        slot.image = undefined;
        this.resident.delete(i);
      }
    }

    // Decode missing frames, nearest to the centre first so scrubbing catches up quickly.
    const order: number[] = [];
    for (let d = 0; d < end - start; d++) {
      const lo = index - d;
      const hi = index + d;
      if (lo >= start && lo < end) order.push(lo);
      if (d > 0 && hi >= start && hi < end) order.push(hi);
    }
    for (const i of order) this.decodeSlot(i);
  }

  private decodeSlot(i: number) {
    const slot = this.slots[i];
    if (!slot.blob || slot.image || slot.decoding) return;
    slot.decoding = decode(slot.blob)
      .then((image) => {
        slot.decoding = undefined;
        if (this.disposed) {
          release(image);
          return;
        }
        // The window may have moved while decoding; drop the result if it is now outside.
        const [start, end] = residentWindow(this.center, this.count, this.options.maxResident);
        if (i < start || i >= end) {
          release(image);
          return;
        }
        slot.image = image;
        this.resident.add(i);
        this.options.onDecoded?.(i);
      })
      .catch(() => {
        slot.decoding = undefined;
      });
  }

  /** True when the frame is fetched (not necessarily decoded). */
  fetched(i: number) {
    return !!this.slots[i]?.blob;
  }

  /** The decoded frame at `index`, or the nearest decoded one (lower preferred). */
  nearest(index: number): { index: number; image: Drawable } | null {
    const i = Math.min(this.count - 1, Math.max(0, index));
    if (this.slots[i]?.image) return { index: i, image: this.slots[i].image! };
    for (let d = 1; d < this.count; d++) {
      const lo = i - d;
      if (lo >= 0 && this.slots[lo].image) return { index: lo, image: this.slots[lo].image! };
      const hi = i + d;
      if (hi < this.count && this.slots[hi].image) return { index: hi, image: this.slots[hi].image! };
    }
    return null;
  }

  dispose() {
    this.disposed = true;
    this.abort.abort();
    for (const slot of this.slots) {
      if (slot.image) release(slot.image);
      slot.image = undefined;
      slot.blob = undefined;
    }
    this.resident.clear();
  }
}
