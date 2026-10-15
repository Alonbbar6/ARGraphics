import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedPhotoCleanup } from '@workspace/api-client-react';
import { trackEvent } from './analytics';
import { removePhotoBackground } from './photo-cleanup';
import { createPhotoReviewAnalytics } from './photo-review-analytics';

const draft: SavedPhotoCleanup = {
  id: 'private-draft-id',
  drinkId: 'private-drink-id',
  status: 'ready',
  sourcePhotoPath: '/private/source.png',
  cleanedPhotoPath: '/private/cleaned.png',
  error: null,
  createdAt: '2026-10-15T00:00:00Z',
};

describe('privacy-safe photo review analytics', () => {
  const track = vi.fn();
  beforeEach(() => {
    track.mockReset();
    vi.stubGlobal('window', { umami: { track } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is safe without a browser or injected tracker', () => {
    vi.stubGlobal('window', undefined);
    expect(() => trackEvent('test')).not.toThrow();
    vi.stubGlobal('window', {});
    expect(() => trackEvent('test')).not.toThrow();
  });

  it('swallows synchronous throws and rejected tracker promises', async () => {
    track.mockImplementationOnce(() => { throw new Error('tracker broken'); });
    expect(() => trackEvent('test')).not.toThrow();
    track.mockRejectedValueOnce(new Error('tracker offline'));
    expect(() => trackEvent('test')).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('counts a restored ready cutout once per studio opening, not per refresh', () => {
    const review = createPhotoReviewAnalytics();
    review.restored(draft);
    review.restored({ ...draft });
    review.restored({ ...draft });
    expect(track).toHaveBeenCalledExactlyOnceWith('photo_cutout_resumed', { cutout_source: 'resumed' });
    createPhotoReviewAnalytics().restored(draft);
    expect(track).toHaveBeenCalledTimes(2);
  });

  it('does not count processing polls, failed drafts, or locally cleaned images as resumes', () => {
    const review = createPhotoReviewAnalytics();
    review.restored({ ...draft, status: 'processing' });
    review.restored(draft);
    review.restored({ ...draft, id: 'failed', status: 'failed' });
    const fresh = { ...draft, id: 'fresh' };
    review.cleaned(fresh);
    review.restored(fresh);
    expect(track).not.toHaveBeenCalled();
    expect(review.source(fresh)).toBe('new');
    expect(review.source(draft)).toBe('resumed');
  });

  it('can resume the earlier ready cutout after a replacement fails', () => {
    const review = createPhotoReviewAnalytics();
    review.restored({ ...draft, id: 'replacement', status: 'failed' });
    review.restored(draft);
    review.restored(draft);
    expect(track).toHaveBeenCalledExactlyOnceWith('photo_cutout_resumed', { cutout_source: 'resumed' });
  });

  it('uses only fixed source labels for generation and deliberate retakes', () => {
    const review = createPhotoReviewAnalytics();
    review.cleaned(draft);
    review.generated(review.source(draft));
    review.retake(draft);
    const restored = { ...draft, id: 'older' };
    review.generated(review.source(restored));
    review.retake(restored);
    review.retake(null);
    expect(track.mock.calls).toEqual([
      ['photo_cutout_sent_to_generation', { cutout_source: 'new' }],
      ['photo_retake', { cutout_source: 'new' }],
      ['photo_cutout_sent_to_generation', { cutout_source: 'resumed' }],
      ['photo_retake', { cutout_source: 'resumed' }],
      ['photo_retake', { cutout_source: 'not_ready' }],
    ]);
    expect(JSON.stringify(track.mock.calls)).not.toContain('private');
  });

  it.each(['absent', 'throws', 'rejects', 'works'])('preserves cleanup results with a tracker that %s', async (mode) => {
    if (mode === 'absent') vi.stubGlobal('window', {});
    if (mode === 'throws') track.mockImplementation(() => { throw new Error('broken'); });
    if (mode === 'rejects') track.mockRejectedValue(new Error('offline'));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ draft })));
    vi.stubGlobal('fetch', fetchMock);
    const photo = new Blob(['photo'], { type: 'image/png' });
    const progress = vi.fn();
    expect(await removePhotoBackground(draft.drinkId, photo, progress)).toEqual(draft);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'image/png' }, body: photo,
    });
    expect(progress).toHaveBeenCalledTimes(2);
    if (mode !== 'absent') expect(track).toHaveBeenCalledExactlyOnceWith('photo_cleanup_saved', { cutout_source: 'new' });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it.each([
    [500, { error: 'cleanup failed' }],
    [200, { draft: { ...draft, status: 'processing' } }],
    [200, { draft: { ...draft, cleanedPhotoPath: null } }],
  ])('does not count an unsuccessful cleanup (%s)', async (status, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
    await expect(removePhotoBackground(draft.drinkId, new Blob(['photo']))).rejects.toThrow();
    expect(track).not.toHaveBeenCalled();
  });
});
