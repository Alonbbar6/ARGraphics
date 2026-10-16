import { describe, expect, it } from 'vitest';
import type { Display } from '@workspace/api-client-react';
import { draftFromDisplay, draftProblems, emptyDraft, isDisplayType, toDisplayInput, toDisplayUpdate } from './display-draft';

const now = new Date('2026-10-15T12:00:00Z');

describe('draftProblems', () => {
  it('needs a type and a title', () => {
    const steps = draftProblems(emptyDraft(), now).map((problem) => problem.step);
    expect(steps).toContain('type');
    expect(steps).toContain('media');
  });

  it('enforces the per-type requirement', () => {
    expect(draftProblems({ ...emptyDraft('menu_item'), title: 'Birria' }, now)[0].message).toMatch(/3D menu library/);
    expect(draftProblems({ ...emptyDraft('menu_item'), title: 'Birria', drinkId: 'd1' }, now)).toEqual([]);
    expect(draftProblems({ ...emptyDraft('promo_offer'), title: 'Tuesday' }, now)[0].message).toMatch(/offer/);
    expect(draftProblems({ ...emptyDraft('event_teaser'), title: 'Trivia' }, now)[0].message).toMatch(/date and time/);
    expect(draftProblems({ ...emptyDraft('art_piece'), title: 'Night Bloom' }, now)).toEqual([]);
  });

  it('rejects an offer that already ended', () => {
    const draft = { ...emptyDraft('promo_offer'), title: 'Tuesday', offerTitle: '2-for-1', offerEndsAt: '2020-01-01T09:00' };
    expect(draftProblems(draft, now).some((problem) => /future/.test(problem.message))).toBe(true);
  });
});

describe('toDisplayInput', () => {
  it('only sends the fields the type uses, plus an optional 3D model', () => {
    const input = toDisplayInput({ ...emptyDraft('promo_offer'), title: ' Agua fresca ', offerTitle: '2-for-1', drinkId: 'd1', artistName: 'Ana' }, 'live');
    expect(input).toMatchObject({ type: 'promo_offer', status: 'live', title: 'Agua fresca', drinkId: 'd1', artistName: null, eventStartsAt: null });
    expect(input.offer).toEqual({ title: '2-for-1', details: '', endsAt: null });
  });

  it('credits an artist on art pieces', () => {
    const input = toDisplayInput({ ...emptyDraft('art_piece'), title: 'Night Bloom', artistName: 'Ana Ruiz', artistSlug: 'ana-ruiz' }, 'draft');
    expect(input).toMatchObject({ placement: 'wall', status: 'draft', artistName: 'Ana Ruiz', artistSlug: 'ana-ruiz', offer: null });
  });

  it('refuses a draft with no type', () => {
    expect(() => toDisplayInput(emptyDraft(), 'live')).toThrow();
  });
});

describe('edits', () => {
  const display: Display = {
    id: 'x', type: 'event_teaser', placement: 'poster', status: 'live', title: 'Mural night', description: '',
    drinkId: null, drink: null, mediaUrl: '/objects/a', offer: null, eventStartsAt: '2026-10-20T01:00:00.000Z',
    artist: null, scansThisWeek: 3, redemptionsThisWeek: 0, createdAt: '', updatedAt: '',
  };

  it('keeps existing media unless it changed', () => {
    const draft = draftFromDisplay(display);
    expect(toDisplayUpdate(draft, 'live')).not.toHaveProperty('mediaObjectPath');
    expect(toDisplayUpdate({ ...draft, mediaObjectPath: null }, 'live').mediaObjectPath).toBeNull();
    expect(toDisplayUpdate(draft, 'live').eventStartsAt).toBe('2026-10-20T01:00:00.000Z');
  });

  it('recognises display types from the URL', () => {
    expect(isDisplayType('art_piece')).toBe(true);
    expect(isDisplayType('coupon')).toBe(false);
    expect(isDisplayType(null)).toBe(false);
  });
});
