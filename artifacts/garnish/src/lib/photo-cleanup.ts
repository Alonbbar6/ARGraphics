const MAX_EDGE = 1600;

function readImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This photo could not be opened. Choose another image.'));
    };
    image.src = url;
  });
}

function estimateBackdrop(data: Uint8ClampedArray, width: number, height: number) {
  const samples: [number, number, number][] = [];
  const stride = Math.max(1, Math.floor(Math.max(width, height) / 80));
  for (let x = 0; x < width; x += stride) {
    for (const y of [0, height - 1]) {
      const offset = (y * width + x) * 4;
      samples.push([data[offset], data[offset + 1], data[offset + 2]]);
    }
  }
  for (let y = stride; y < height - 1; y += stride) {
    for (const x of [0, width - 1]) {
      const offset = (y * width + x) * 4;
      samples.push([data[offset], data[offset + 1], data[offset + 2]]);
    }
  }

  const clusters: { color: [number, number, number]; count: number }[] = [];
  for (const sample of samples) {
    const match = clusters.find((cluster) => {
      const [r, g, b] = cluster.color;
      return Math.hypot(sample[0] - r, sample[1] - g, sample[2] - b) < 42;
    });
    if (match) {
      match.count += 1;
      const [r, g, b] = match.color;
      match.color = [
        r + (sample[0] - r) / match.count,
        g + (sample[1] - g) / match.count,
        b + (sample[2] - b) / match.count,
      ];
    } else {
      clusters.push({ color: sample, count: 1 });
    }
  }
  return clusters.sort((a, b) => b.count - a.count)[0]?.color ?? [255, 255, 255];
}

/**
 * Removes a connected, mostly even-colored backdrop locally in the browser.
 * Owners review the cutout before it is sent to model generation.
 */
export async function removePhotoBackground(file: Blob, onProgress?: (message: string) => void): Promise<Blob> {
  onProgress?.('Preparing the photo…');
  const image = await readImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Photo cleanup is not available in this browser.');
  context.drawImage(image, 0, 0, width, height);
  const frame = context.getImageData(0, 0, width, height);
  const pixels = frame.data;
  const background = estimateBackdrop(pixels, width, height);
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const threshold = 64;
  const nearBackground = (index: number) => {
    const offset = index * 4;
    return Math.hypot(
      pixels[offset] - background[0],
      pixels[offset + 1] - background[1],
      pixels[offset + 2] - background[2],
    ) < threshold;
  };
  const enqueue = (index: number) => {
    if (index < 0 || index >= visited.length || visited[index] || !nearBackground(index)) return;
    visited[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  onProgress?.('Separating the drink from its backdrop…');
  while (head < tail) {
    const index = queue[head++];
    pixels[index * 4 + 3] = 0;
    const x = index % width;
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (index >= width) enqueue(index - width);
    if (index + width < visited.length) enqueue(index + width);
  }
  context.putImageData(frame, 0, 0);
  onProgress?.('Cutout ready for your review.');
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not prepare the cleaned photo.')), 'image/png');
  });
}
