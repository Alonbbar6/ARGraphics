import type { PlanTier } from '@workspace/api-client-react';

/** Wording for plans and billing, kept pure so it can be tested without React. */

export function planLabel(tier: PlanTier | null | undefined): string {
  if (tier === 'business') return 'Business';
  if (tier === 'founding') return 'Founding partner';
  return 'Free';
}

export function liveSummary(count: number, limit: number | null): string {
  if (limit === null) return `${count} live · unlimited`;
  return `${count} of ${limit} live`;
}

export function creditsLabel(count: number): string {
  return count === 1 ? '1 build credit' : `${count} build credits`;
}

export function dollars(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

const VENUE_TYPE_LABEL: Record<string, string> = { truck: 'food truck', stand: 'stand', restaurant: 'restaurant' };

/** "Only tacos business promoted in Little Havana": what the Business plan buys, in one line. */
export function exclusivitySentence(category: string, venueType: string | null | undefined, neighborhood: string): string {
  const what = category.trim() || VENUE_TYPE_LABEL[venueType ?? ''] || 'restaurant';
  const where = neighborhood.trim() || 'your neighborhood';
  return `Only ${what} business promoted in ${where}`;
}

type ErrorLike = { status?: number; data?: { error?: string; code?: string } | null; message?: string };

/**
 * Turns an API error into something to show. `upgrade` is true when the fix is on the
 * Plan page (a live-display limit or an empty credit balance).
 */
export function billingErrorMessage(error: unknown, fallback = 'Check your connection and try again.'): { message: string; upgrade: boolean; status: number } {
  const value = (typeof error === 'object' && error ? error : {}) as ErrorLike;
  const status = Number(value.status) || 0;
  const code = value.data?.code;
  const serverText = value.data?.error;
  const upgrade = status === 402 || code === 'plan_limit' || code === 'no_credits';
  return { message: serverText || fallback, upgrade, status };
}
