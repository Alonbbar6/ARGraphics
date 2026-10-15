/** AI cleanup runs on the authenticated server. Keys never leave the server. */
export async function removePhotoBackground(file: Blob, onProgress?: (message: string) => void): Promise<Blob> {
  onProgress?.('OpenAI is removing the background… This can take a minute or two.');
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const response = await fetch(`${base}/api/drinks/photo-cleanup`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': file.type },
    body: file,
    signal: AbortSignal.timeout(210_000),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(result?.error || `Photo cleanup failed (HTTP ${response.status}). Try again.`);
  }
  if (!response.headers.get('content-type')?.includes('image/png')) {
    throw new Error('The cleanup did not return a photo. Try again.');
  }
  onProgress?.('Cutout ready. Check the glass and garnish before generating your model.');
  return response.blob();
}
