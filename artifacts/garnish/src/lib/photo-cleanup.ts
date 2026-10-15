import type { SavedPhotoCleanup } from '@workspace/api-client-react';
import { trackEvent } from './analytics';

const base = import.meta.env.BASE_URL.replace(/\/$/, '');
export function savedCleanupImageUrl(draft: SavedPhotoCleanup, kind: 'source' | 'cleaned') {
  return `${base}/api/drinks/${encodeURIComponent(draft.drinkId)}/photo-cleanup/${encodeURIComponent(draft.id)}/${kind}`;
}

/** AI cleanup runs on the authenticated server and saves before responding. */
export async function removePhotoBackground(drinkId: string, file: Blob, onProgress?: (message: string) => void): Promise<SavedPhotoCleanup> {
  onProgress?.('OpenAI is removing the background… This can take a minute or two. You can close the studio; the result will be saved here.');
  const response = await fetch(`${base}/api/drinks/${encodeURIComponent(drinkId)}/photo-cleanup`, {
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
  const result = await response.json() as { draft: SavedPhotoCleanup };
  if (result.draft?.status !== 'ready' || !result.draft.cleanedPhotoPath) throw new Error('The cutout is not ready yet. Reopen the studio to check its saved status.');
  trackEvent('photo_cleanup_saved', { cutout_source: 'new' });
  onProgress?.('Cutout saved. Check the glass and garnish before generating your model.');
  return result.draft;
}
