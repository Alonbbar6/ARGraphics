import { useEffect, useState } from 'react';

/**
 * Wording for the guest pages (/s/:code and /b/:slug) in English and Spanish. The phone's
 * language picks the default; a toggle on the page overrides it and is remembered.
 * Keep keys short and the two columns in step.
 */

export type GuestLang = 'en' | 'es';

const STRINGS = {
  loading: ['Loading', 'Cargando'],
  notCode: ['This isn’t an ARGraphics code.', 'Este no es un código de ARGraphics.'],
  codeInactive: ['This code isn’t active anymore.', 'Este código ya no está activo.'],
  couldNotLoadSpot: ['We couldn’t load this spot. Check your connection and try again.', 'No pudimos cargar este lugar. Revisa tu conexión e inténtalo de nuevo.'],
  scanAgain: ['Scan the code again, or ask at the counter.', 'Escanea el código otra vez o pregunta en el mostrador.'],
  nothingHere: ['Nothing is showing at this spot right now.', 'No hay nada en este lugar por ahora.'],
  alsoHere: ['Also here', 'También aquí'],
  venueNotFound: ['We couldn’t find that spot.', 'No encontramos ese lugar.'],
  couldNotLoadMenu: ['We couldn’t load this menu. Check your connection and try again.', 'No pudimos cargar este menú. Revisa tu conexión e inténtalo de nuevo.'],
  askForLink: ['Ask at the counter for the right link, or scan the code.', 'Pide el enlace correcto en el mostrador o escanea el código.'],
  tapAnything: ['Tap anything to see it in 3D, right in front of you.', 'Toca cualquier cosa para verla en 3D, justo frente a ti.'],
  nothingOnMenu: ['Nothing is on the menu right now.', 'No hay nada en el menú por ahora.'],
  everythingHere: ['Everything here', 'Todo lo que hay aquí'],
  typeMenu: ['On the menu', 'En el menú'],
  typeOffer: ['Offer', 'Oferta'],
  typeArt: ['Art', 'Arte'],
  typeEvent: ['Coming up', 'Próximamente'],
  typeTonight: ['Tonight', 'Hoy'],
  by: ['By', 'De'],
  seeInFront: ['See it in front of you', 'Míralo frente a ti'],
  dragToTurn: ['Drag to turn it. On an iPhone or Android phone you can set it down in front of you at its real size.', 'Arrástralo para girarlo. En un iPhone o Android puedes ponerlo frente a ti a su tamaño real.'],
  shownAbout: ['Shown about {cm} cm tall, its real size.', 'Se muestra de unos {cm} cm de alto, su tamaño real.'],
  shadeTip: ['Works best out of direct sun. Step into the shade if it looks faint.', 'Funciona mejor sin sol directo. Ponte a la sombra si se ve tenue.'],
  arFailed: ['AR couldn’t start here. Try again in better light, or open this page in Safari or Chrome.', 'La realidad aumentada no pudo iniciar. Inténtalo con mejor luz o abre esta página en Safari o Chrome.'],
  loading3d: ['Loading 3D model', 'Cargando modelo 3D'],
  model3dOf: ['3D model of {title}', 'Modelo 3D de {title}'],
  claimOffer: ['Claim offer', 'Reclamar oferta'],
  offerEnded: ['This offer has ended.', 'Esta oferta ya terminó.'],
  offerUnavailable: ['This offer isn’t available right now.', 'Esta oferta no está disponible ahora.'],
  claimFailed: ['Couldn’t claim it. Try again.', 'No se pudo reclamar. Inténtalo de nuevo.'],
  showAtCounter: ['Show this at the counter', 'Muestra esto en el mostrador'],
  validFor: ['Valid for {time}', 'Válido por {time}'],
  expired: ['Expired', 'Expirado'],
  tapToEnlarge: ['Tap to show it big', 'Toca para verlo en grande'],
  tapToClose: ['Tap to close', 'Toca para cerrar'],
  getApp: ['Get the ARGraphics iPhone app for table-card AR', 'Descarga la app de ARGraphics para iPhone'],
  langToggle: ['Español', 'English'],
} as const;

export type GuestKey = keyof typeof STRINGS;

const STORAGE_KEY = 'argraphics-guest-lang';

function detect(): GuestLang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'es') return saved;
  } catch { /* storage blocked */ }
  const tags = typeof navigator !== 'undefined' ? [navigator.language, ...(navigator.languages ?? [])] : [];
  return tags.some((tag) => tag?.toLowerCase().startsWith('es')) ? 'es' : 'en';
}

let current: GuestLang = typeof window !== 'undefined' ? detect() : 'en';
const listeners = new Set<() => void>();

export function setGuestLang(lang: GuestLang) {
  current = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
  document.documentElement.lang = lang;
  for (const fn of listeners) fn();
}

/** The current guest language, re-rendering the caller when the toggle changes. */
export function useGuestLang(): [GuestLang, (lang: GuestLang) => void] {
  const [lang, setLang] = useState<GuestLang>(current);
  useEffect(() => {
    document.documentElement.lang = current;
    const fn = () => setLang(current);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return [lang, setGuestLang];
}

/** Looks a string up in the current language, filling `{name}` placeholders. */
export function t(key: GuestKey, vars?: Record<string, string | number>): string {
  const [en, es] = STRINGS[key];
  let text: string = current === 'es' ? es : en;
  if (vars) for (const name in vars) text = text.split(`{${name}}`).join(String(vars[name]));
  return text;
}
