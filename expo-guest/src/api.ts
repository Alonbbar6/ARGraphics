import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/**
 * The same public `/v1` API the Swift app uses (lib/api-spec/openapi.yaml, `ios` tag),
 * with the same x-api-key header and an anonymous visitor ID kept on the device.
 */

export type DisplayType = 'menu_item' | 'promo_offer' | 'art_piece' | 'event_teaser';
export type Placement = 'table' | 'wall' | 'window' | 'poster';

export type PublicDisplay = {
  id: string;
  type: DisplayType;
  placement: Placement;
  title: string;
  description: string;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  modelUsdzUrl: string | null;
  modelGlbUrl: string | null;
  modelHeightCm?: number | null;
  price: string | null;
  offer: { title: string; details: string; endsAt: string | null } | null;
  eventStartsAt: string | null;
  artist: { name: string; slug: string | null; bio: string | null } | null;
};

export type ScanResult = {
  venue: { slug: string; name: string; kind: string; neighborhood: string | null; bio: string | null };
  spot: { label: string; placement: Placement };
  display: PublicDisplay | null;
  displays: PublicDisplay[];
};

export type Claim = {
  confirmationCode: string;
  offerTitle: string;
  venueName: string;
  spotLabel: string | null;
  claimedAt: string;
  expiresAt: string;
};

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const extra = (Constants.expoConfig?.extra ?? {}) as { apiKey?: string; apiPort?: string; apiUrl?: string };

/** The Mac running Metro also runs the API, so reuse the host Expo Go connected to. */
export function defaultBaseUrl(): string {
  if (extra.apiUrl) return extra.apiUrl.replace(/\/$/, '');
  const host = Constants.expoConfig?.hostUri?.split(':')[0] ?? 'localhost';
  return `http://${host}:${extra.apiPort ?? '22674'}/api`;
}

export const config = {
  baseUrl: defaultBaseUrl(),
  apiKey: extra.apiKey ?? '',
};

const VISITOR_KEY = 'argraphics.visitorId';
let visitorId: string | null = null;

export async function getVisitorId(): Promise<string> {
  if (visitorId) return visitorId;
  try {
    visitorId = await SecureStore.getItemAsync(VISITOR_KEY);
  } catch {
    visitorId = null;
  }
  if (!visitorId) {
    visitorId = Crypto.randomUUID();
    try { await SecureStore.setItemAsync(VISITOR_KEY, visitorId); } catch { /* session-only ID */ }
  }
  return visitorId;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'x-api-key': config.apiKey, ...(init.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, `Can't reach ${config.baseUrl}. Is dev-local.sh running and the phone on the same wifi?`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, (body as { error?: string }).error ?? `HTTP ${response.status}`);
  return body as T;
}

export async function health(): Promise<boolean> {
  try {
    await call('/healthz');
    return true;
  } catch {
    return false;
  }
}

export async function scan(code: string): Promise<ScanResult> {
  return call<ScanResult>('/v1/scans', { method: 'POST', body: JSON.stringify({ code, visitorId: await getVisitorId() }) });
}

export async function claim(displayId: string, code: string | null): Promise<Claim> {
  return call<Claim>(`/v1/displays/${encodeURIComponent(displayId)}/claims`, {
    method: 'POST',
    body: JSON.stringify({ visitorId: await getVisitorId(), code }),
  });
}

/**
 * Accepts what printed codes encode (https://host/s/{code}), the app scheme
 * (argraphics://s/{code}) or a typed code. Upper case is folded, as in the Swift app.
 */
export function codeFromPayload(payload: string): string | null {
  const text = payload.trim().toLowerCase();
  const match = text.match(/\/s\/([a-z0-9]{6,16})(?:[/?#]|$)/) ?? text.match(/^([a-z0-9]{6,16})$/);
  return match ? match[1] : null;
}
