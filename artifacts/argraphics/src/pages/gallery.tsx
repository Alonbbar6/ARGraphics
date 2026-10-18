import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListGalleryQueryKey, getListLicensesQueryKey, useGetSession, useListGallery, useListLicenses, useRequestArtworkLicense,
  useUpdateLicense, type GalleryArtwork,
} from '@workspace/api-client-react';
import { ArrowLeft, Box, Check, Clock, Palette, Search, Send, ShieldCheck, X } from 'lucide-react';
import { Badge, Button, buttonClass, EmptyState, ErrorPanel, Field, inputClass, PageHeader, Skeleton } from '@/components/partner-ui';
import { formatCents, LICENSE_LABEL, MEDIUM_LABEL } from '@/lib/artworks';
import { toast } from '@/hooks/use-toast';

/**
 * Where a venue finds local artists' work. Every piece here was uploaded by the artist who
 * made it; a licence request goes to them, and an accepted one lands as a draft display.
 */
export function GalleryPage() {
  const session = useGetSession();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const timer = setTimeout(() => setDebounced(query.trim()), 250); return () => clearTimeout(timer); }, [query]);
  const params = debounced ? { q: debounced } : undefined;
  const gallery = useListGallery(params, { query: { queryKey: getListGalleryQueryKey(params) } });
  const licenses = useListLicenses();
  const [requesting, setRequesting] = useState<GalleryArtwork | null>(null);
  const isArtist = session.data?.partnerKind === 'artist';
  const mine = (licenses.data ?? []).filter((license) => license.status !== 'declined');

  return (
    <div className="rise">
      <Link href="/displays" className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={15} aria-hidden="true" /> Displays</Link>
      <PageHeader title="Local artists" lede="Original work by artists on ARGraphics. Ask to show a piece; when they say yes it appears in your displays, ready to place on a wall or table." />

      <label className="owner-search mb-5 flex min-h-12 items-center gap-3 rounded-2xl border border-border bg-card px-4">
        <Search size={17} className="text-muted-foreground" aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" placeholder="Search by piece or artist" aria-label="Search artworks" data-testid="input-gallery-search" />
      </label>

      {gallery.isLoading ? <Skeleton className="h-72" /> : gallery.isError ? <ErrorPanel onRetry={() => void gallery.refetch()} /> : (gallery.data ?? []).length === 0 ? (
        <EmptyState icon={Palette} title={debounced ? 'Nothing matches that yet.' : 'No pieces listed yet.'}>
          {debounced ? 'Try another word, or clear the search.' : 'Artists in your neighborhood can sign up and list work in minutes. Know one? Send them to ARGraphics.'}
        </EmptyState>
      ) : (
        <ul className="pa-masonry">
          {(gallery.data ?? []).map((artwork, index) => (
            <li key={artwork.id} className="pa-card pa-card-in overflow-hidden" style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }} data-testid={`gallery-${artwork.id}`}>
              <div className={`relative bg-muted ${index % 3 === 0 ? 'h-60' : 'h-44'}`}>
                <img src={artwork.imageUrl} alt={artwork.title} className="h-full w-full object-cover" />
                <span className="absolute left-2 top-2 flex gap-1.5">
                  <Badge tone="violet">{artwork.medium === 'model' ? <><Box size={11} aria-hidden="true" /> 3D</> : '2D'}</Badge>
                  <Badge tone="live"><ShieldCheck size={11} aria-hidden="true" /> Original</Badge>
                </span>
              </div>
              <div className="p-3">
                <p className="truncate text-base font-semibold">{artwork.title}</p>
                <p className="text-xs text-muted-foreground">by {artwork.artist.name}{artwork.artist.neighborhood ? ` · ${artwork.artist.neighborhood}` : ''}</p>
                {artwork.description && <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{artwork.description}</p>}
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{formatCents(artwork.priceCents)}</span>
                  {isArtist ? null : artwork.license?.status === 'accepted' ? (
                    <Link href={artwork.license.displayId ? `/displays/${artwork.license.displayId}` : '/displays'} className={buttonClass('ghost', 'sm')} data-testid={`link-licensed-${artwork.id}`}><Check size={14} aria-hidden="true" /> Licensed · place it</Link>
                  ) : artwork.license?.status === 'requested' ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock size={13} aria-hidden="true" /> {LICENSE_LABEL.requested}</span>
                  ) : (
                    <Button size="sm" icon={Send} onClick={() => setRequesting(artwork)} data-testid={`button-request-${artwork.id}`}>Ask to show it</Button>
                  )}
                </div>
                {artwork.licenseNote && <p className="mt-2 text-[11px] text-muted-foreground">{artwork.licenseNote}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {!isArtist && mine.length > 0 && <VenueLicenses />}
      {requesting && <RequestDialog artwork={requesting} onClose={() => setRequesting(null)} />}
    </div>
  );
}

function VenueLicenses() {
  const queryClient = useQueryClient();
  const licenses = useListLicenses();
  const update = useUpdateLicense();
  const list = (licenses.data ?? []).filter((license) => license.status !== 'declined');
  return (
    <section className="mt-8" aria-labelledby="my-licences">
      <h2 id="my-licences" className="mb-3 text-base font-semibold">Pieces you asked for</h2>
      <ul className="space-y-2">
        {list.map((license) => (
          <li key={license.id} className="pa-card flex flex-wrap items-center gap-3 p-3" data-testid={`venue-license-${license.id}`}>
            <img src={license.artworkImageUrl} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{license.artworkTitle} <span className="font-normal text-muted-foreground">by</span> {license.artist.name}</span>
              <span className="block text-xs text-muted-foreground">{LICENSE_LABEL[license.status]} · {formatCents(license.priceCents)}{license.paidAt ? ' · paid' : license.status === 'accepted' && license.priceCents > 0 ? ' · pay the artist directly' : ''}</span>
            </span>
            {license.status === 'accepted' && license.displayId && <Link href={`/displays/${license.displayId}`} className={buttonClass('primary', 'sm')}>Place it</Link>}
            {license.status === 'accepted' && <Button size="sm" variant="quiet" disabled={update.isPending} onClick={() => update.mutate({ id: license.id, data: { action: 'end' } }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getListLicensesQueryKey() }); void queryClient.invalidateQueries({ queryKey: getListGalleryQueryKey() }); toast({ title: 'Licence ended' }); } })}>End</Button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RequestDialog({ artwork, onClose }: { artwork: GalleryArtwork; onClose: () => void }) {
  const queryClient = useQueryClient();
  const request = useRequestArtworkLicense();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    request.mutate({ id: artwork.id, data: { message: message.trim() } }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListGalleryQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListLicensesQueryKey() });
        toast({ title: 'Sent to the artist', description: 'You’ll see their answer here and in your displays.' });
        onClose();
      },
      onError: (cause) => setError('status' in cause && cause.status === 409 ? 'You already asked for this piece.' : 'Could not send the request. Try again.'),
    });
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/55 p-0 backdrop-blur-sm sm:place-items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="request-title" className="w-full max-w-lg rounded-t-[2rem] border border-border bg-card p-5 shadow-2xl sm:rounded-[2rem] sm:p-7">
        <div className="mb-4 flex items-start justify-between">
          <div><p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Ask the artist</p><h2 id="request-title" className="mt-1 text-xl font-semibold">Show “{artwork.title}” in your room.</h2></div>
          <button onClick={onClose} className="grid h-11 w-11 place-items-center rounded-xl hover:bg-muted" aria-label="Close"><X size={19} /></button>
        </div>
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-border bg-background p-3">
          <img src={artwork.imageUrl} alt="" className="h-14 w-14 rounded-xl object-cover" />
          <div className="min-w-0 text-sm"><p className="font-semibold">{artwork.artist.name}</p><p className="text-xs text-muted-foreground">{MEDIUM_LABEL[artwork.medium]} · {formatCents(artwork.priceCents)}{artwork.licenseNote ? ` · ${artwork.licenseNote}` : ''}</p></div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="A note for the artist (optional)" hint={`${message.length}/600`}><textarea className={inputClass} rows={3} maxLength={600} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Where it would hang, and what nights you’re open." data-testid="input-request-message" /></Field>
          <p className="text-xs text-muted-foreground">{artwork.priceCents > 0 ? `If they accept, you pay ${formatCents(artwork.priceCents)} to the artist directly. The piece then appears in your displays as a draft.` : 'This piece is free to host. If they accept, it appears in your displays as a draft.'}</p>
          {error && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" loading={request.isPending} data-testid="button-send-request"><Send size={16} aria-hidden="true" /> Send the request</Button>
        </form>
      </section>
    </div>
  );
}
