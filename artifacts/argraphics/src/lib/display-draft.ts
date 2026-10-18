import type { Display, DisplayInput, DisplayType, DisplayUpdate, Placement } from '@workspace/api-client-react';
import { isoToLocalInput, localInputToIso } from './traffic';

export const DISPLAY_TYPES: { value: DisplayType; label: string; pitch: string }[] = [
  { value: 'menu_item', label: '3D menu item', pitch: 'Put a dish people walk past for. It floats over the table.' },
  { value: 'promo_offer', label: 'Promo offer', pitch: 'Fill a slow night. Guests claim it in the room.' },
  { value: 'art_piece', label: 'Virtual art piece', pitch: 'A local artist’s work that only exists on your wall.' },
  { value: 'event_teaser', label: 'Event teaser', pitch: 'Pack a show, a pop-up or a trivia night.' },
];

export const PLACEMENTS: { value: Placement; label: string; hint: string; guestHint: string }[] = [
  { value: 'table', label: 'Table', hint: 'Tent card or sticker. Best for specials.', guestHint: 'Point at the table' },
  { value: 'wall', label: 'Wall', hint: 'A blank wall becomes a mural.', guestHint: 'Point at the wall' },
  { value: 'window', label: 'Window', hint: 'Stops people walking by.', guestHint: 'Point at the window' },
  { value: 'poster', label: 'Poster', hint: 'Events and pop-ups.', guestHint: 'Point at the poster' },
];

export function typeLabel(type: DisplayType) {
  return DISPLAY_TYPES.find((option) => option.value === type)?.label ?? 'Display';
}

export function placementLabel(placement: Placement) {
  return PLACEMENTS.find((option) => option.value === placement)?.label ?? placement;
}

export function isDisplayType(value: string | null | undefined): value is DisplayType {
  return DISPLAY_TYPES.some((option) => option.value === value);
}

export type DisplayDraft = {
  type: DisplayType | null;
  placement: Placement;
  title: string;
  description: string;
  drinkId: string | null;
  /** Newly uploaded object path; undefined keeps the existing media on edit. */
  mediaObjectPath: string | null | undefined;
  offerTitle: string;
  offerDetails: string;
  offerEndsAt: string; // datetime-local
  eventStartsAt: string; // datetime-local
  artistName: string;
  artistSlug: string | null;
  /** A licensed artwork; media and credit come from it and cannot be edited here. */
  artworkId: string | null;
  artworkTitle: string;
};

export function emptyDraft(type: DisplayType | null = null): DisplayDraft {
  return {
    type,
    placement: type === 'art_piece' ? 'wall' : type === 'event_teaser' ? 'poster' : 'table',
    title: '',
    description: '',
    drinkId: null,
    mediaObjectPath: undefined,
    offerTitle: '',
    offerDetails: '',
    offerEndsAt: '',
    eventStartsAt: '',
    artistName: '',
    artistSlug: null,
    artworkId: null,
    artworkTitle: '',
  };
}

export function draftFromDisplay(display: Display): DisplayDraft {
  return {
    type: display.type,
    placement: display.placement,
    title: display.title,
    description: display.description,
    drinkId: display.drinkId,
    mediaObjectPath: undefined,
    offerTitle: display.offer?.title ?? '',
    offerDetails: display.offer?.details ?? '',
    offerEndsAt: isoToLocalInput(display.offer?.endsAt),
    eventStartsAt: isoToLocalInput(display.eventStartsAt),
    artistName: display.artist?.name ?? '',
    artistSlug: display.artist?.slug ?? null,
    artworkId: display.artworkId,
    artworkTitle: display.artwork?.title ?? '',
  };
}

export type DraftStep = 'type' | 'media' | 'placement';

/** Problems that block publishing, keyed to the step that fixes them. */
export function draftProblems(draft: DisplayDraft, now = new Date()) {
  const problems: { step: DraftStep; message: string }[] = [];
  if (!draft.type) problems.push({ step: 'type', message: 'Pick what kind of display this is.' });
  if (!draft.title.trim()) problems.push({ step: 'media', message: 'Give it a name guests will see.' });
  if (draft.title.trim().length > 80) problems.push({ step: 'media', message: 'Keep the name under 80 characters.' });
  if (draft.description.length > 600) problems.push({ step: 'media', message: 'Keep the description under 600 characters.' });
  if (draft.type === 'menu_item' && !draft.drinkId) problems.push({ step: 'media', message: 'Choose the item from your 3D menu library.' });
  if (draft.type === 'promo_offer' && !draft.offerTitle.trim()) problems.push({ step: 'media', message: 'Say what the offer is, like “2-for-1 tacos until 9”.' });
  if (draft.type === 'promo_offer' && draft.offerEndsAt) {
    const ends = localInputToIso(draft.offerEndsAt);
    if (!ends || new Date(ends).getTime() <= now.getTime()) problems.push({ step: 'media', message: 'The offer end time needs to be in the future.' });
  }
  if (draft.type === 'event_teaser') {
    const starts = localInputToIso(draft.eventStartsAt);
    if (!starts) problems.push({ step: 'media', message: 'Add the date and time of the event.' });
  }
  return problems;
}

function offerFromDraft(draft: DisplayDraft) {
  return draft.type === 'promo_offer'
    ? { title: draft.offerTitle.trim().slice(0, 80), details: draft.offerDetails.trim().slice(0, 240), endsAt: localInputToIso(draft.offerEndsAt) }
    : null;
}

function artistFromDraft(draft: DisplayDraft) {
  if (draft.artworkId) return { artworkId: draft.artworkId, artistName: null, artistSlug: null };
  const name = draft.artistName.trim().slice(0, 80);
  return draft.type === 'art_piece' && name
    ? { artworkId: null, artistName: name, artistSlug: draft.artistSlug }
    : { artworkId: null, artistName: null, artistSlug: null };
}

export function toDisplayInput(draft: DisplayDraft, status: 'draft' | 'live'): DisplayInput {
  if (!draft.type) throw new Error('Pick a display type first.');
  return {
    type: draft.type,
    placement: draft.placement,
    status,
    title: draft.title.trim(),
    description: draft.description.trim(),
    drinkId: draft.drinkId, // any type may show a 3D library model; switching type resets it
    mediaObjectPath: draft.artworkId ? null : draft.mediaObjectPath ?? null,
    offer: offerFromDraft(draft),
    eventStartsAt: draft.type === 'event_teaser' ? localInputToIso(draft.eventStartsAt) : null,
    ...artistFromDraft(draft),
  };
}

export function toDisplayUpdate(draft: DisplayDraft, status: 'draft' | 'live' | 'paused'): DisplayUpdate {
  const update: DisplayUpdate = {
    placement: draft.placement,
    status,
    title: draft.title.trim(),
    description: draft.description.trim(),
    drinkId: draft.drinkId, // any type may show a 3D library model; switching type resets it
    offer: offerFromDraft(draft),
    eventStartsAt: draft.type === 'event_teaser' ? localInputToIso(draft.eventStartsAt) : null,
    ...artistFromDraft(draft),
  };
  // Only send media when the owner replaced or removed it.
  if (draft.mediaObjectPath !== undefined) update.mediaObjectPath = draft.mediaObjectPath;
  return update;
}

export function formatEventDate(iso: string | null | undefined) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
