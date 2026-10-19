import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetLiveBoardQueryKey, getListDisplaysQueryKey, useGetLiveBoard, type LiveEvent } from '@workspace/api-client-react';

export type Pulse = { id: string; displayId: string | null; kind: LiveEvent['kind']; at: string };

const POLL_MS = 5000;

/**
 * The room's heartbeat: polls `/live` every few seconds while the tab is visible and
 * hands back each new scan or claim exactly once as a pulse, so the floor can ripple.
 * The first load never pulses (those events already happened).
 */
export function useLiveBoard(enabled = true) {
  const queryClient = useQueryClient();
  const seen = useRef<Set<string> | null>(null);
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const query = useGetLiveBoard(undefined, {
    query: {
      queryKey: getGetLiveBoardQueryKey(),
      enabled,
      refetchInterval: () => (typeof document !== 'undefined' && document.visibilityState === 'visible' ? POLL_MS : false),
      refetchIntervalInBackground: false,
      staleTime: 2000,
    },
  });

  useEffect(() => {
    const events = query.data?.events;
    if (!events) return;
    if (!seen.current) {
      seen.current = new Set(events.map((event) => event.id));
      return;
    }
    const fresh = events.filter((event) => !seen.current!.has(event.id));
    if (fresh.length === 0) return;
    fresh.forEach((event) => seen.current!.add(event.id));
    setPulses((current) => [...current.slice(-30), ...fresh.map((event) => ({ id: event.id, displayId: event.displayId, kind: event.kind, at: event.at }))]);
    // Week counts on the cards move too.
    void queryClient.invalidateQueries({ queryKey: getListDisplaysQueryKey() });
  }, [query.data, queryClient]);

  return { board: query.data ?? null, isLoading: query.isLoading, isError: query.isError, pulses };
}
