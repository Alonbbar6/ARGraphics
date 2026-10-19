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
    title: 'The lunch line is gone by 1:30. Again.',
    body: 'The grill is hot. The prep is done. The sidewalk in front of you is empty.',
    stat: { label: 'People in line at 1:30', from: 48, to: 3 },
  },
  {
    title: 'You paid for ads. Who came?',
    body: 'Yelp ads, boosted posts, a loyalty app. Not one of them can name a single guest they brought in.',
    stat: { label: 'Guests your ads can name', from: 1200, to: 0 },
  },
  {
    title: 'The chain down the street has a budget.',
    body: 'You have great food and regulars who love you. You need a reason for new people to walk up.',
    stat: { label: 'Reasons a new customer needs to walk up', from: 100, to: 1 },
  },
];

export type Step = { icon: LucideIcon; title: string; body: string };

export const STEPS: Step[] = [
  {
    icon: Sparkles,
    title: 'We build the AR display',
    body: 'Snap a photo of your special, write an offer, or hang local art. We turn it into something customers can see right at your spot.',
  },
  {
    icon: QrCode,
    title: 'You place the codes',
    body: 'Print-ready QR codes for the window, the menu board, tables and posters. Stick them up. That is the setup.',
  },
  {
    icon: ScanLine,
    title: 'Customers scan. You count redemptions.',
    body: 'One scan with the phone camera and the dish is right there in 3D. Every scan and claimed offer shows up on your dashboard.',
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
    body: 'Your signature dish floats right in front of them, big enough to make the next person in line order one.',
    where: 'Counter · Table',
    photo: VENUE('table'),
    photoAlt: 'A table lamp glowing on a wooden restaurant table at night.',
  },
  {
    icon: Tag,
    title: 'Promo offer',
    body: 'A deal customers claim on their phone. You confirm it at the window with a code.',
    where: 'Window · Menu',
    photo: VENUE('offer'),
    photoAlt: 'A bartender pouring a cocktail under purple light.',
    offer: true,
  },
  {
    icon: ImageIcon,
    title: 'Virtual art piece',
    body: 'A mural on the blank wall, or on the side of the truck. A local artist’s piece that only lives at your spot.',
    where: 'Wall',
    photo: VENUE('wall'),
    photoAlt: 'Guests at a bar beneath a large painted mural.',
    art: true,
  },
  {
    icon: CalendarDays,
    title: 'Event teaser',
    body: 'A pop-up, a new location, a tasting. Customers scan your window and see what is coming.',
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
    label: 'Redemptions',
    body: 'Offers claimed on a phone and confirmed at the counter with a code. A claimed offer is a customer who showed up.',
    value: 57,
    accent: true,
  },
];

export const FAQS = [
  {
    q: 'What do my customers need?',
    a: 'Any phone. They scan your code with the camera and the display opens in the browser, no app to install. The free iPhone app adds extras like table-card tracking.',
  },
  {
    q: 'Do my staff need training?',
    a: 'No. If a customer claims an offer, they show whoever is at the window a confirmation screen with a code and a live clock. You look at it and say yes. That is the whole job.',
  },
  {
    q: 'Does this touch my POS?',
    a: 'No. Nothing connects to your register, your reservations or your menu system. ARGraphics runs alongside what you already use.',
  },
  {
    q: 'How do you count redemptions?',
    a: 'We count claimed offers. A customer claims an offer on their phone, you confirm it with a code, and it lands on your dashboard. We do not guess, and we do not count ad impressions as customers.',
  },
  {
    q: 'I’m an artist. Who owns my work?',
    a: 'You do. Your piece stays yours. Venues and trucks host it in AR for as long as you both agree, and your name stays on it every time someone sees it.',
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
