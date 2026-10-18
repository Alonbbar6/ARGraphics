import {
  Box,
  CalendarDays,
  Footprints,
  Image as ImageIcon,
  QrCode,
  ScanLine,
  Sparkles,
  Tag,
  Users,
  type LucideIcon,
} from 'lucide-react';

/** Where the hero image sequence lives. Baked by /dev/bake into public/sequences/hero. */
export const HERO_SEQUENCE = `${import.meta.env.BASE_URL}sequences/hero/manifest.json`;
/** Photo behind the hero (the venue or food truck). Optional; see public/hero/README.md. */
export const HERO_PLATE = `${import.meta.env.BASE_URL}hero/plate.jpg`;
/** Smaller sequence shown inside the phone in the "how it works" chapter. */
export const PHONE_SEQUENCE = `${import.meta.env.BASE_URL}sequences/phone/manifest.json`;

export const HERO = {
  special: 'Tuesday birria tower',
  offer: 'Free agua fresca with any birria tower',
  price: '$18',
};

export const PAINS = [
  {
    title: 'Wednesday is quiet. Again.',
    body: 'The kitchen is ready. The bar is stocked. Half the room is empty by eight.',
    stat: { label: 'Seats filled by 8pm', from: 48, to: 11 },
  },
  {
    title: 'You paid for ads. Who came?',
    body: 'Yelp ads, boosted posts, a loyalty app. Not one of them can name a single guest they brought in.',
    stat: { label: 'Guests your ads can name', from: 1200, to: 0 },
  },
  {
    title: 'The chain down the street has a budget.',
    body: 'You have a great room and regulars who love you. You need a reason for new people to walk in.',
    stat: { label: 'Reasons a new guest needs to walk in', from: 100, to: 1 },
  },
];

export type Step = { icon: LucideIcon; title: string; body: string };

export const STEPS: Step[] = [
  {
    icon: Sparkles,
    title: 'We build the AR display',
    body: 'Tell us your special, your offer, or your art. We turn it into something guests can see in your room.',
  },
  {
    icon: QrCode,
    title: 'You place the codes',
    body: 'Print-ready QR codes for tables, windows, menus and posters. Stick them up. That is the setup.',
  },
  {
    icon: ScanLine,
    title: 'Guests scan. You count walk-ins.',
    body: 'One scan with the ARGraphics app and the room comes alive. Every scan and claimed offer shows up on your dashboard.',
  },
];

/** Venue photos behind the display cards and the problem chapter. See public/venues/README.md. */
const VENUE = (name: string) => `${import.meta.env.BASE_URL}venues/${name}.jpg`;
export const EMPTY_BAR_PHOTO = VENUE('empty-bar');

export type DisplayType = {
  icon: LucideIcon;
  title: string;
  body: string;
  where: string;
  photo: string;
  /** What the photo shows, for assistive tech. */
  photoAlt: string;
  offer?: boolean;
  art?: boolean;
};

export const DISPLAY_TYPES: DisplayType[] = [
  {
    icon: Box,
    title: '3D menu item',
    body: 'Your signature dish floats over the table, big enough to make the next table order one.',
    where: 'Table',
    photo: VENUE('table'),
    photoAlt: 'A table lamp glowing on a wooden restaurant table at night.',
  },
  {
    icon: Tag,
    title: 'Promo offer',
    body: 'A deal guests claim right at the table. Your server confirms it with a code.',
    where: 'Table · Menu',
    photo: VENUE('offer'),
    photoAlt: 'A bartender pouring a cocktail under purple light.',
    offer: true,
  },
  {
    icon: ImageIcon,
    title: 'Virtual art piece',
    body: 'A mural on the blank wall by the bathrooms. A local artist’s piece that only lives in your room.',
    where: 'Wall',
    photo: VENUE('wall'),
    photoAlt: 'Guests at a bar beneath a large painted mural.',
    art: true,
  },
  {
    icon: CalendarDays,
    title: 'Event teaser',
    body: 'Trivia night, a DJ set, a tasting. Guests scan your window and see what is coming.',
    where: 'Window · Poster',
    photo: VENUE('event'),
    photoAlt: 'A crowd with raised hands under blue stage light.',
  },
];

/** Example pieces for the artists strip. Photos live in public/venues/art-*.jpg. */
export const PIECES = [
  { title: 'Low Tide Neon', place: 'Back wall · taqueria', tall: true, hue: 'a', photo: VENUE('art-a'), alt: 'Thick strokes of coral, teal and violet paint on canvas.' },
  { title: 'Second Shift', place: 'Bar mirror · cocktail bar', tall: false, hue: 'b', photo: VENUE('art-b'), alt: 'A painted face with wide blue eyes framed by flowers.' },
  { title: 'Abuela’s Garden', place: 'Patio fence · café', tall: false, hue: 'c', photo: VENUE('art-c'), alt: 'A mural of a sunrise over mountains in flat yellow, blue and green.' },
  { title: 'Last Call Bloom', place: 'Hallway · wine bar', tall: true, hue: 'd', photo: VENUE('art-d'), alt: 'Black branches over pink, orange and sky-blue shapes across a building.' },
];

export const FUNNEL = [
  {
    icon: ScanLine,
    label: 'Scans',
    body: 'Every time a phone opens one of your codes in the ARGraphics app.',
    value: 412,
  },
  {
    icon: Users,
    label: 'Unique visitors',
    body: 'Scans rolled up to people, so one guest scanning five times counts once.',
    value: 268,
  },
  {
    icon: Footprints,
    label: 'Walk-ins',
    body: 'Offers claimed at the table and confirmed by your staff with a code. A claimed offer is a guest in a seat.',
    value: 57,
    accent: true,
  },
];

export const FAQS = [
  {
    q: 'What do my guests need?',
    a: 'An iPhone and the free ARGraphics app. They scan your code with it and the display opens right where they are sitting. One scan, and they are in.',
  },
  {
    q: 'Do my staff need training?',
    a: 'No. If a guest claims an offer, they show your server a confirmation screen with a code and a live clock. Your server looks at it and says yes. That is the whole job.',
  },
  {
    q: 'Does this touch my POS?',
    a: 'No. Nothing connects to your register, your reservations or your menu system. ARGraphics runs alongside what you already use.',
  },
  {
    q: 'How do you count walk-ins?',
    a: 'We count claimed offers. A guest claims an offer at the table, staff confirm it with a code, and it lands on your dashboard. We do not guess, and we do not count ad impressions as guests.',
  },
  {
    q: 'I’m an artist. Who owns my work?',
    a: 'You do. Your piece stays yours. Venues host it in AR for as long as you both agree, and your name stays on it every time someone sees it.',
  },
];

/* Illustrative heatmap values (0..1), deterministic so it renders the same every time. */
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const HOURS = ['5p', '6p', '7p', '8p', '9p', '10p', '11p'];
export function heat(d: number, h: number) {
  const weekend = d >= 4 ? 0.35 : d === 2 ? 0.2 : 0.05;
  const peak = 1 - Math.abs(h - 3) / 4;
  const wobble = ((d * 7 + h * 3) % 5) / 20;
  return Math.max(0.05, Math.min(1, weekend + peak * 0.55 + wobble));
}
