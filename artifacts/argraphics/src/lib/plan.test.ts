import { describe, expect, it } from 'vitest';
import { billingErrorMessage, creditsLabel, dollars, exclusivitySentence, liveSummary, planLabel } from './plan';

describe('plan wording', () => {
  it('names tiers and limits', () => {
    expect(planLabel('free')).toBe('Free');
    expect(planLabel('founding')).toBe('Founding partner');
    expect(planLabel(null)).toBe('Free');
    expect(liveSummary(2, 3)).toBe('2 of 3 live');
    expect(liveSummary(7, null)).toBe('7 live · unlimited');
    expect(creditsLabel(1)).toBe('1 build credit');
    expect(creditsLabel(4)).toBe('4 build credits');
    expect(dollars(15000)).toBe('$150');
    expect(dollars(1250)).toBe('$12.50');
  });

  it('describes exclusivity from the category, the venue type, and the neighborhood', () => {
    expect(exclusivitySentence('tacos', 'truck', 'Little Havana')).toBe('Only tacos business promoted in Little Havana');
    expect(exclusivitySentence('', 'truck', 'Little Havana')).toBe('Only food truck business promoted in Little Havana');
    expect(exclusivitySentence('  ', null, '')).toBe('Only restaurant business promoted in your neighborhood');
  });
});

describe('billingErrorMessage', () => {
  it('surfaces the server text and flags plan problems', () => {
    expect(billingErrorMessage({ status: 402, data: { error: 'Out of credits.', code: 'no_credits' } }))
      .toEqual({ message: 'Out of credits.', upgrade: true, status: 402 });
    expect(billingErrorMessage({ status: 400, data: { error: 'Enter a title.' } }))
      .toEqual({ message: 'Enter a title.', upgrade: false, status: 400 });
  });

  it('falls back when there is no server text', () => {
    expect(billingErrorMessage(new TypeError('Failed to fetch'), 'Offline?')).toEqual({ message: 'Offline?', upgrade: false, status: 0 });
    expect(billingErrorMessage(null).message).toBe('Check your connection and try again.');
  });
});
