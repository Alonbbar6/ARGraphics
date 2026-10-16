import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { getGetPartnerProfileQueryKey, useGetPartnerProfile, useListArtistPlacements, useListDisplays, useUpdatePartnerProfile } from '@workspace/api-client-react';
import { MapPin, Palette, Pencil, Plus, ScanLine, Send, Store } from 'lucide-react';
import { Badge, Button, buttonClass, EmptyState, ErrorPanel, Field, inputClass, Skeleton, StatTile, StatusBadge } from '@/components/partner-ui';
import { DisplayThumb, PLACEMENT_ICONS } from '@/components/display-parts';
import { placementLabel } from '@/lib/display-draft';
import { countLabel, formatCount, initials, inviteVenueMailto, plural } from '@/lib/traffic';
import { toast } from '@/hooks/use-toast';

export function ArtistPage() {
  const profile = useGetPartnerProfile();
  const displays = useListDisplays();
  const placements = useListArtistPlacements();
  const [editing, setEditing] = useState(false);

  const pieces = (displays.data ?? []).filter((display) => display.type === 'art_piece');
  const hosting = placements.data ?? [];
  const venues = new Set(hosting.map((placement) => placement.venueSlug)).size;
  const scans = hosting.reduce((sum, placement) => sum + placement.scansThisWeek, 0) + pieces.reduce((sum, piece) => sum + piece.scansThisWeek, 0);
  const name = profile.data?.name ?? '';
  const invite = profile.data ? inviteVenueMailto(name, profile.data.slug, window.location.origin) : undefined;

  return (
    <div className="rise">
      <section className="pa-card relative mb-5 overflow-hidden p-5 sm:p-7">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(ellipse_at_80%_0%,rgba(168,85,247,.35),transparent_60%)]" aria-hidden="true" />
        {profile.isLoading ? <Skeleton className="h-28" /> : profile.isError || !profile.data ? (
          <ErrorPanel title="Your profile didn’t load." onRetry={() => void profile.refetch()} />
        ) : editing ? (
          <ProfileForm onDone={() => setEditing(false)} />
        ) : (
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start">
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#6D28D9] to-[#F43F5E] text-lg font-bold text-white" aria-hidden="true">{initials(name)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="serif text-[2.25rem] leading-tight md:text-5xl">{name}</h1>
                {hosting.length > 0 && <Badge tone="featured">Spotlight</Badge>}
              </div>
              <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground"><MapPin size={14} aria-hidden="true" />Artist · {profile.data.neighborhood || 'Add your neighborhood'}</p>
              <p className="mt-3 max-w-2xl text-sm leading-6">{profile.data.bio || 'Tell venues what you make and why their guests will stop and look. Two or three sentences is plenty.'}</p>
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEditing(true)}>Edit profile</Button>
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <StatTile index={0} icon={Palette} label="Pieces" value={pieces.length} />
        <StatTile index={1} icon={Store} label="Venues hosting" value={venues} />
        <StatTile index={2} icon={ScanLine} label="Scans this week" value={scans} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
        <section aria-labelledby="pieces-heading">
          <div className="mb-3 flex items-end justify-between">
            <h2 id="pieces-heading" className="text-base font-semibold">Pieces</h2>
            <Link href="/displays/new?type=art_piece" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary"><Plus size={15} aria-hidden="true" /> Add a piece</Link>
          </div>
          {displays.isLoading ? <Skeleton className="h-64" /> : displays.isError ? <ErrorPanel onRetry={() => void displays.refetch()} /> : pieces.length === 0 ? (
            <EmptyState icon={Palette} title="Your first piece, in the room." action={<Link href="/displays/new?type=art_piece" className={buttonClass('primary')}><Plus size={17} aria-hidden="true" /> Add a piece</Link>}>
              Upload a photo of your work. Venues that host it put a code on the wall, and guests see the piece hanging there through the ARGraphics app.
            </EmptyState>
          ) : (
            <ul className="pa-masonry">
              {pieces.map((piece, index) => (
                <li key={piece.id}>
                  <Link href={`/displays/${piece.id}`} className="pa-card pa-card-in block overflow-hidden hover:border-primary/50" style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}>
                    <DisplayThumb display={piece} className={index % 3 === 0 ? 'h-56' : index % 3 === 1 ? 'h-40' : 'h-48'}>
                      {index === 0 && piece.scansThisWeek > 0 && <span className="absolute left-2 top-2"><Badge tone="featured">Featured</Badge></span>}
                    </DisplayThumb>
                    <div className="p-3">
                      <p className="truncate text-base font-semibold">{piece.title}</p>
                      <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><StatusBadge status={piece.status} /> {countLabel(piece.scansThisWeek, 'scan')}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="venues-heading">
          <h2 id="venues-heading" className="mb-3 text-base font-semibold">Where your work hangs</h2>
          {placements.isLoading ? <Skeleton className="h-40" /> : placements.isError ? <ErrorPanel onRetry={() => void placements.refetch()} /> : hosting.length === 0 ? (
            <p className="pa-card p-4 text-sm text-muted-foreground">No venues are hosting your pieces yet. Invite a spot you love; they set up in minutes and credit you on the wall.</p>
          ) : (
            <ul className="space-y-2">
              {hosting.map((placement) => {
                const Icon = PLACEMENT_ICONS[placement.placement];
                return (
                  <li key={placement.displayId} className="pa-card flex min-h-16 items-center gap-3 p-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground" aria-hidden="true"><Icon size={17} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{placement.venueName}</span>
                      <span className="block truncate text-xs text-muted-foreground">{placement.title} · {placementLabel(placement.placement)}{placement.neighborhood ? ` · ${placement.neighborhood}` : ''}</span>
                    </span>
                    <span className="text-right"><span className="block text-lg font-light tabular-nums">{formatCount(placement.scansThisWeek)}</span><span className="block text-[11px] text-muted-foreground">{plural(placement.scansThisWeek, 'scan')}</span></span>
                  </li>
                );
              })}
            </ul>
          )}
          <a href={invite} className={buttonClass('hero', 'md', 'mt-4 w-full')} aria-disabled={!invite} data-testid="button-invite-venue">
            <Send size={16} aria-hidden="true" /> Invite a venue
          </a>
          <p className="mt-2 text-center text-xs text-muted-foreground">Opens an email with your sign-up link, ready to send.</p>
        </section>
      </div>
    </div>
  );
}

function ProfileForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const profile = useGetPartnerProfile();
  const updateProfile = useUpdatePartnerProfile();
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  useEffect(() => {
    if (!profile.data) return;
    setName(profile.data.name);
    setBio(profile.data.bio);
    setNeighborhood(profile.data.neighborhood);
  }, [profile.data]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    updateProfile.mutate({ data: { name: name.trim(), bio: bio.trim(), neighborhood: neighborhood.trim() } }, {
      onSuccess: (saved) => {
        queryClient.setQueryData(getGetPartnerProfileQueryKey(), saved);
        toast({ title: 'Profile saved', description: 'Venues and guests see the new version right away.' });
        onDone();
      },
      onError: () => toast({ title: 'That didn’t save', description: 'Check the name is at least 2 characters and try again.', variant: 'destructive' }),
    });
  };
  return (
    <form onSubmit={submit} className="relative space-y-4">
      <h1 className="pa-title">Your artist profile</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name"><input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} required /></Field>
        <Field label="Neighborhood"><input className={inputClass} value={neighborhood} onChange={(event) => setNeighborhood(event.target.value)} maxLength={80} placeholder="Little Havana" /></Field>
      </div>
      <Field label="Bio" hint={`${bio.length}/600`}><textarea className={inputClass} rows={4} value={bio} onChange={(event) => setBio(event.target.value)} maxLength={600} placeholder="Paints big, loud florals on the walls of the places she eats." /></Field>
      <div className="flex gap-2">
        <Button type="submit" loading={updateProfile.isPending}>Save profile</Button>
        <Button variant="quiet" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
