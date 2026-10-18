/**
 * In-browser camera for the 3D studio: a venue owner points their phone (or laptop) at the
 * dish, taps the shutter, and the frame goes straight into the photo-to-3D pipeline as a
 * JPEG file, exactly as if it had been picked from the library.
 */

export type Facing = 'environment' | 'user';

/** Longest side of a captured frame. Meshy wants detail, not a 12-megapixel upload over bar wifi. */
export const MAX_CAPTURE_SIDE = 2048;
const JPEG_QUALITY = 0.92;

export function cameraSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
    && (typeof window === 'undefined' || window.isSecureContext);
}

/** Scales a frame to fit within `max` on its longest side, never upscaling. */
export function fitWithin(width: number, height: number, max = MAX_CAPTURE_SIDE) {
  const longest = Math.max(width, height);
  if (longest <= max || longest === 0) return { width, height };
  const scale = max / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** A file name the pipeline, storage and analytics can all read: who it was, and when. */
export function captureFileName(subject: string, at = new Date()) {
  const slug = subject.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'dish';
  const stamp = at.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');
  return `${slug}-${stamp}.jpg`;
}

/** Why the camera could not open, in words a venue owner can act on. */
export function cameraProblem(error: unknown): string {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was blocked. Allow the camera for this site in your browser settings, or choose a photo from your library.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device. Choose a photo from your library instead.';
    case 'NotReadableError':
    case 'AbortError':
      return 'Another app is using the camera. Close it and try again, or choose a photo from your library.';
    default:
      return 'The camera could not start here. Choose a photo from your library instead.';
  }
}

export async function openCamera(facing: Facing): Promise<MediaStream> {
  const video: MediaTrackConstraints = {
    facingMode: facing === 'environment' ? { ideal: 'environment' } : 'user',
    width: { ideal: 2048 },
    height: { ideal: 1536 },
  };
  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

export function stopCamera(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((track) => track.stop());
}

/** True when the device has more than one camera, so a flip button is worth showing. */
export async function hasMultipleCameras(): Promise<boolean> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'videoinput').length > 1;
  } catch {
    return false;
  }
}

/** Grabs the current frame as a JPEG File. The front camera is un-mirrored so text reads right. */
export async function captureFrame(video: HTMLVideoElement, subject: string, facing: Facing): Promise<File> {
  const { width, height } = fitWithin(video.videoWidth, video.videoHeight);
  if (!width || !height) throw new Error('The camera has not started yet. Give it a second and try again.');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not read the camera frame.');
  if (facing === 'user') {
    context.translate(width, 0);
    context.scale(-1, 1);
  }
  context.drawImage(video, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('The photo could not be saved. Try again.');
  return new File([blob], captureFileName(subject), { type: 'image/jpeg', lastModified: Date.now() });
}
