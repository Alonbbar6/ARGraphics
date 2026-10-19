import { useEffect, useState } from 'react';
import { Box, Loader2, Store } from 'lucide-react';
import { BrandMark } from '@/components/brand';
import { DisplayView, LangToggle, guestGet, typeLabel, type Display } from '@/pages/scan';
import { t, useGuestLang } from '@/lib/guest-i18n';
import '@/components/partner.css';

type PublicVenue = {
  venue: { slug: string; name: string; neighborhood: string | null };
  displays: Display[];
};

/**
 * Public page for /b/:slug: the venue's whole menu of live displays, no printed code
 * needed. A guest opens it from a link, taps an item, and places it on their own table in
 * AR. Printed codes (/s/:code) still tie a scan to a spot, which is what analytics count.
 */
export function VenuePage({ slug }: { slug: string }) {
  useGuestLang();
  const safeSlug = /^[a-z0-9-]{1,80}$/.test(slug.toLowerCase()) ? slug.toLowerCase() : '';
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; venue: PublicVenue }>({ kind: 'loading' });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const previous = document.title;
    document.title = 'ARGraphics';
    return () => { document.title = previous; };
  }, []);

  useEffect(() => {
    if (!safeSlug) {
      setState({ kind: 'error', message: t('venueNotFound') });
      return;
    }
    let alive = true;
    guestGet<PublicVenue>(`venues/${encodeURIComponent(safeSlug)}`)
      .then((venue) => {
        if (!alive) return;
        setState({ kind: 'ready', venue });
        document.title = `${venue.venue.name} · ARGraphics`;
      })
      .catch((error: Error & { status?: number }) => {
        if (alive) setState({ kind: 'error', message: error.status === 404 ? t('venueNotFound') : t('couldNotLoadMenu') });
      });
    return () => { alive = false; };
  }, [safeSlug]);

  const data = state.kind === 'ready' ? state.venue : null;
  const displays = data?.displays ?? [];
  // The first item with a 3D model leads, so the page opens on something you can place.
  const selected = displays.find((display) => display.id === selectedId) ?? displays.find((display) => display.modelGlbUrl) ?? displays[0] ?? null;

  return (
    <main className="min-h-[100dvh] bg-[#0A0A0A] px-4 pb-16 pt-5 text-white">
      <div className="mx-auto w-full max-w-md">
        <header className="mb-6 flex items-center gap-2.5">
          <BrandMark size={28} />
          <span className="text-sm font-semibold">ARGraphics</span>
          <LangToggle />
        </header>

        {state.kind === 'loading' && (
          <div className="grid min-h-[60dvh] place-items-center" role="status">
            <Loader2 className="animate-spin text-white/60" size={28} aria-label={t('loading')} />
          </div>
        )}

        {state.kind === 'error' && (
          <section className="rounded-2xl border border-white/10 bg-[#121212] p-6 text-center">
            <Store className="mx-auto mb-3 text-white/50" size={28} aria-hidden="true" />
            <h1 className="text-xl font-semibold">{state.message}</h1>
            <p className="mt-2 text-sm text-white/60">{t('askForLink')}</p>
          </section>
        )}

        {data && (
          <>
            <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight" data-testid="text-venue-name">{data.venue.name}</h1>
            <p className="mt-1 text-sm text-white/60">{data.venue.neighborhood ? `${data.venue.neighborhood} · ` : ''}{t('tapAnything')}</p>

            {selected ? <DisplayView key={selected.id} display={selected} code={null} /> : (
              <p className="mt-6 rounded-2xl border border-white/10 bg-[#121212] p-5 text-sm text-white/70">{t('nothingOnMenu')}</p>
            )}

            {displays.length > 1 && (
              <section className="mt-8">
                <h2 className="mb-3 text-sm font-medium text-white/60">{t('everythingHere')}</h2>
                <ul className="space-y-2">
                  {displays.filter((display) => display.id !== selected?.id).map((display) => (
                    <li key={display.id}>
                      <button onClick={() => { setSelectedId(display.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-white/10 bg-[#121212] px-4 text-left hover:border-white/25" data-testid={`button-venue-item-${display.id}`}>
                        {display.thumbnailUrl || display.mediaUrl ? (
                          <img src={display.thumbnailUrl ?? display.mediaUrl ?? ''} alt="" className="h-10 w-10 shrink-0 rounded-lg bg-black object-cover" />
                        ) : null}
                        <span className="min-w-0 flex-1"><span className="block text-xs text-white/50">{typeLabel(display)}</span><span className="block truncate text-sm font-medium">{display.title}</span></span>
                        {display.modelGlbUrl && <Box size={16} className="shrink-0 text-white/50" aria-label="3D" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
