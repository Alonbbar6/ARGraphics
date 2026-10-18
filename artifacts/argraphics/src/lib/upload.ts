export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function imageProblem(file: File) {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return 'Use a JPEG, PNG or WebP photo.';
  if (file.size > MAX_IMAGE_BYTES) return 'That photo is over 10 MB. Try a smaller one.';
  return null;
}

/** Private upload: request a signed URL, PUT the bytes, return the object path the API stores. */
export async function uploadImage(file: File) {
  const problem = imageProblem(file);
  if (problem) throw new Error(problem);
  const request = await fetch('/api/storage/uploads/request-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name.slice(0, 160) || 'image', size: file.size, contentType: file.type }),
  });
  const info = await request.json().catch(() => ({})) as { uploadURL?: string; objectPath?: string; error?: string };
  if (!request.ok || !info.uploadURL || !info.objectPath) throw new Error(info.error || 'Could not start the upload.');
  const put = await fetch(info.uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  if (!put.ok) throw new Error('The upload didn’t finish. Please try again.');
  return info.objectPath;
}

export const MODEL_TYPES: Record<string, string> = { glb: 'model/gltf-binary', usdz: 'model/vnd.usdz+zip' };
export const MAX_MODEL_BYTES = 30 * 1024 * 1024;

/** Browsers rarely know a model's MIME type; the extension decides. */
export function modelContentType(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return MODEL_TYPES[extension] ?? null;
}

export function modelProblem(file: File) {
  if (!modelContentType(file)) return 'Use a .glb (any device) or .usdz (iPhone) model file.';
  if (file.size > MAX_MODEL_BYTES) return 'That model is over 30 MB. Reduce textures or polygons and try again.';
  return null;
}

/** Private upload of an artist's own 3D file: signed URL, PUT, object path. */
export async function uploadModel(file: File) {
  const problem = modelProblem(file);
  if (problem) throw new Error(problem);
  const contentType = modelContentType(file) as string;
  const request = await fetch('/api/storage/model-uploads/request-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name.slice(0, 160) || 'model', size: file.size, contentType }),
  });
  const info = await request.json().catch(() => ({})) as { uploadURL?: string; objectPath?: string; error?: string };
  if (!request.ok || !info.uploadURL || !info.objectPath) throw new Error(info.error || 'Could not start the upload.');
  const put = await fetch(info.uploadURL, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
  if (!put.ok) throw new Error('The upload didn’t finish. Please try again.');
  return info.objectPath;
}
