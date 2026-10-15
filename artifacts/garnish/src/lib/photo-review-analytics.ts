import type { SavedPhotoCleanup } from '@workspace/api-client-react';
import { trackEvent } from './analytics';

export type CutoutSource = 'new' | 'resumed';

/**
 * One instance per studio opening. IDs are local bookkeeping only, never sent.
 * Observing processing before ready is polling progress, not a review resume.
 */
export function createPhotoReviewAnalytics() {
  const observed = new Set<string>();
  const newlyCleaned = new Set<string>();
  return {
    cleaned(draft: SavedPhotoCleanup) {
      newlyCleaned.add(draft.id);
      observed.add(draft.id);
    },
    restored(draft: SavedPhotoCleanup) {
      const firstObservation = !observed.has(draft.id);
      observed.add(draft.id);
      if (firstObservation && draft.status === 'ready') {
        trackEvent('photo_cutout_resumed', { cutout_source: 'resumed' });
      }
    },
    source(draft: SavedPhotoCleanup): CutoutSource {
      return newlyCleaned.has(draft.id) ? 'new' : 'resumed';
    },
    generated(source: CutoutSource) {
      trackEvent('photo_cutout_sent_to_generation', { cutout_source: source });
    },
    retake(draft: SavedPhotoCleanup | null) {
      trackEvent('photo_retake', {
        cutout_source: draft?.status === 'ready'
          ? (newlyCleaned.has(draft.id) ? 'new' : 'resumed')
          : 'not_ready',
      });
    },
  };
}
