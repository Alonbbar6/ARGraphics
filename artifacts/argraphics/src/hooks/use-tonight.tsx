import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getGetLiveBoardQueryKey, useGetLiveBoard, useGetPartnerProfile, getGetPartnerProfileQueryKey } from '@workspace/api-client-react';
import { isServiceTime } from '@/lib/service-hours';

type Override = 'on' | 'off' | null;
const STORAGE_KEY = 'argraphics-tonight';

type Tonight = {
  /** Tonight mode is showing. */
  on: boolean;
  /** The clock says the room is open. */
  auto: boolean;
  override: Override;
  setOverride: (value: Override) => void;
  serviceOpen: string;
  serviceClose: string;
};

const TonightContext = createContext<Tonight>({ on: false, auto: false, override: null, setOverride: () => undefined, serviceOpen: '17:00', serviceClose: '03:00' });

function readOverride(): Override {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'on' || value === 'off' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Whether the dashboard is in Tonight mode: the venue's clock decides, the owner can
 * force it either way from the top bar, and that choice sticks on this device.
 */
export function TonightProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [override, setOverrideState] = useState<Override>(() => readOverride());
  const profile = useGetPartnerProfile({ query: { enabled, queryKey: getGetPartnerProfileQueryKey(), retry: false, staleTime: 60_000 } });
  const live = useGetLiveBoard(undefined, { query: { enabled, queryKey: getGetLiveBoardQueryKey(), refetchInterval: 60_000, staleTime: 2000, retry: false } });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  const serviceOpen = live.data?.serviceOpen ?? profile.data?.serviceOpen ?? '17:00';
  const serviceClose = live.data?.serviceClose ?? profile.data?.serviceClose ?? '03:00';
  const auto = useMemo(() => {
    if (live.data) return live.data.open;
    return isServiceTime(new Date(), profile.data?.serviceOpen, profile.data?.serviceClose, profile.data?.timezone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.data, profile.data, tick]);

  const setOverride = useCallback((value: Override) => {
    setOverrideState(value);
    try {
      if (value) localStorage.setItem(STORAGE_KEY, value);
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* storage may be blocked */ }
  }, []);

  const value = useMemo<Tonight>(() => ({ on: override ? override === 'on' : auto, auto, override, setOverride, serviceOpen, serviceClose }), [override, auto, setOverride, serviceOpen, serviceClose]);
  return <TonightContext.Provider value={value}>{children}</TonightContext.Provider>;
}

export function useTonight() {
  return useContext(TonightContext);
}
