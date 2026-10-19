import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { getGetPartnerProfileQueryKey, useGetPartnerProfile, useGetSession, useUpdatePartnerProfile, type PartnerKind } from '@workspace/api-client-react';
import { ArrowLeft, ArrowRight, CircleCheck, LocateFixed, MapPin, Palette, Store } from 'lucide-react';
import { Button, Field, inputClass, Skeleton, StepIndicator } from '@/components/partner-ui';
import { markOnboardingSkipped, Wordmark } from '@/components/shell';
import { TYPE_ICONS } from '@/components/display-parts';
import { DISPLAY_TYPES } from '@/lib/display-draft';
import { cn } from '@/lib/utils';
import '@/components/owner.css';

const STEPS = ['You', 'Location', 'First display'];

function browserTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'; } catch { return 'America/New_York'; }
}

export function OnboardingPage() {
  const session = useGetSession();
  const authenticated = Boolean(session.data?.authenticated);
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<PartnerKind>('venue');

  useEffect(() => {
    if (!authenticated) return;
    setStep((current) => Math.max(1, current));
    if (session.data?.partnerKind) setKind(session.data.partnerKind);
  }, [authenticated, session.data?.partnerKind]);

  return (
    <div className="argraphics-owner-root min-h-[100dvh]">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col px-4 py-5 sm:py-8">
        <div className="mb-8 flex items-center justify-between">
          <Wordmark />
          {authenticated && <SkipLink />}
        </div>
        {session.isLoading ? <Skeleton className="h-96" /> : (
          <>
            <StepIndicator steps={STEPS} current={step} />
            {step === 0 && <KindStep kind={kind} onKind={setKind} authenticated={authenticated} />}
            {step === 1 && <LocationStep kind={kind} onDone={() => setStep(2)} />}
            {step === 2 && <TemplateStep kind={kind} onBack={() => setStep(1)} />}
          </>
        )}
      </div>
    </div>
  );
}

function SkipLink() {
  const [, setLocation] = useLocation();
  return (
    <button type="button" className="min-h-11 rounded-full px-3 text-sm text-muted-foreground hover:text-foreground" onClick={() => { markOnboardingSkipped(); setLocation('/home'); }}>
      Skip for now
    </button>
  );
}

function KindStep({ kind, onKind, authenticated }: { kind: PartnerKind; onKind: (kind: PartnerKind) => void; authenticated: boolean }) {
  const [, setLocation] = useLocation();
  const options: { value: PartnerKind; title: string; body: string; icon: typeof Store }[] = [
    { value: 'venue', title: 'I run a venue', body: 'Bar, restaurant, café, taquería. You want more people through the door.', icon: Store },
    { value: 'artist', title: 'I’m an artist', body: 'Put your work on the walls of places people already go.', icon: Palette },
  ];
  return (
    <div className="rise">
      <h1 className="serif text-[2.25rem] leading-[1.1] sm:text-5xl">Empty Wednesday? Give people a reason to walk in.</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">Guests scan a code on your table and see something that only exists in your room. You see exactly who came in because of it.</p>
      <fieldset className="mt-7 space-y-3">
        <legend className="sr-only">Which one are you?</legend>
        {options.map((option) => {
          const checked = kind === option.value;
          return (
            <button key={option.value} type="button" aria-pressed={checked} onClick={() => onKind(option.value)} className={cn('pa-card flex w-full items-center gap-4 p-4 text-left', checked && '!border-[#6D28D9] ring-2 ring-[#6D28D9]/40')}>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground" aria-hidden="true"><option.icon size={20} /></span>
              <span className="min-w-0 flex-1"><span className="block text-base font-semibold">{option.title}</span><span className="block text-xs leading-5 text-muted-foreground">{option.body}</span></span>
              {checked && <CircleCheck size={20} className="shrink-0 text-primary" aria-hidden="true" />}
            </button>
          );
        })}
      </fieldset>
      <p className="mt-6 rounded-2xl bg-muted/60 p-4 text-xs leading-5 text-muted-foreground">From the first day you’ll see scans, redemptions and regulars who come back. Numbers you can check against the line.</p>
      <Button variant="primary" className="mt-8 w-full" onClick={() => setLocation(authenticated ? '/welcome' : `/register?kind=${kind}`)}>
        Continue <ArrowRight size={16} aria-hidden="true" />
      </Button>
      {!authenticated && <p className="mt-4 text-center text-sm text-muted-foreground">Already with us? <Link href="/login" className="font-semibold text-primary underline underline-offset-4">Sign in</Link></p>}
    </div>
  );
}

function LocationStep({ kind, onDone }: { kind: PartnerKind; onDone: () => void }) {
  const queryClient = useQueryClient();
  const profile = useGetPartnerProfile({ query: { queryKey: getGetPartnerProfileQueryKey(), retry: false } });
  const updateProfile = useUpdatePartnerProfile();
  const [name, setName] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [address, setAddress] = useState('');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!profile.data) return;
    setName((current) => current || profile.data.name);
    setNeighborhood((current) => current || profile.data.neighborhood);
    setAddress((current) => current || profile.data.address);
    if (profile.data.latitude !== null && profile.data.longitude !== null) setCoords({ latitude: profile.data.latitude, longitude: profile.data.longitude });
  }, [profile.data]);

  const locate = () => {
    setMessage('');
    if (!('geolocation' in navigator)) { setMessage('This browser can’t share a location. The address is enough.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({ latitude: Number(position.coords.latitude.toFixed(6)), longitude: Number(position.coords.longitude.toFixed(6)) });
        setMessage('Got it. We’ll use this spot for the nearby map guests see.');
        setLocating(false);
      },
      () => { setMessage('No problem. The address is enough.'); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!neighborhood.trim()) { setError('Add your neighborhood so nearby guests can find you.'); return; }
    updateProfile.mutate({
      data: {
        ...(name.trim().length >= 2 ? { name: name.trim() } : {}),
        neighborhood: neighborhood.trim(),
        address: address.trim(),
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
        timezone: browserTimezone(),
      },
    }, {
      onSuccess: (saved) => { queryClient.setQueryData(getGetPartnerProfileQueryKey(), saved); onDone(); },
      onError: () => setError('That didn’t save. Check your connection and try again.'),
    });
  };

  const artist = kind === 'artist';
  return (
    <form onSubmit={submit} className="rise space-y-5">
      <div>
        <h1 className="serif text-[2.25rem] leading-[1.1] sm:text-5xl">{artist ? 'Where do you make your work?' : 'Where’s your door?'}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{artist ? 'Venues near you see your work first. Walkable beats famous.' : 'We show your display to people already out nearby. Walkable matters more than famous.'}</p>
      </div>
      {profile.isLoading ? <Skeleton className="h-48" /> : (
        <>
          <Field label={artist ? 'Your name or studio' : 'Venue name'}><input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} placeholder={artist ? 'Ana Ruiz' : 'Casa Marisol'} /></Field>
          <Field label="Neighborhood"><input className={inputClass} value={neighborhood} onChange={(event) => setNeighborhood(event.target.value)} maxLength={80} placeholder="Little Havana" required data-testid="input-neighborhood" /></Field>
          {!artist && <Field label="Street address" hint="Guests see it on the map of nearby ARGraphics spots."><input className={inputClass} value={address} onChange={(event) => setAddress(event.target.value)} maxLength={200} autoComplete="street-address" placeholder="1200 SW 8th St" /></Field>}
          <div className="pa-card flex items-center gap-3 p-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground" aria-hidden="true"><MapPin size={18} /></span>
            <span className="min-w-0 flex-1 text-sm">{coords ? <>Pinned at {coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)}</> : <span className="text-muted-foreground">Optional: pin your exact spot</span>}</span>
            <Button variant="ghost" size="sm" icon={LocateFixed} loading={locating} onClick={locate}>{coords ? 'Update' : 'Use my current location'}</Button>
          </div>
          {message && <p className="text-xs text-muted-foreground" role="status">{message}</p>}
          <p className="text-xs text-muted-foreground">Times in your numbers use {browserTimezone().replace(/_/g, ' ')}.</p>
        </>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" variant="primary" className="w-full" loading={updateProfile.isPending}>Continue <ArrowRight size={16} aria-hidden="true" /></Button>
    </form>
  );
}

function TemplateStep({ kind, onBack }: { kind: PartnerKind; onBack: () => void }) {
  const [, setLocation] = useLocation();
  const ordered = kind === 'artist' ? [...DISPLAY_TYPES.filter((t) => t.value === 'art_piece'), ...DISPLAY_TYPES.filter((t) => t.value !== 'art_piece')] : DISPLAY_TYPES;
  const [choice, setChoice] = useState(ordered[0].value);
  return (
    <div className="rise">
      <h1 className="serif text-[2.25rem] leading-[1.1] sm:text-5xl">{kind === 'artist' ? 'Which piece goes up first?' : 'What would make people come in for?'}</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">Pick one to start. You can add more later.</p>
      <div className="mt-6 grid grid-cols-2 gap-3">
        {ordered.map((option) => {
          const Icon = TYPE_ICONS[option.value];
          const checked = choice === option.value;
          return (
            <button key={option.value} type="button" aria-pressed={checked} onClick={() => setChoice(option.value)} className={cn('pa-card flex min-h-40 flex-col overflow-hidden text-left', checked && '!border-[#6D28D9] ring-2 ring-[#6D28D9]/40')}>
              <span className={cn('pa-thumb grid h-20 w-full place-items-center', option.value === 'art_piece' && 'is-art', option.value === 'event_teaser' && 'is-event', option.value === 'promo_offer' && 'is-offer')} aria-hidden="true"><Icon size={26} className="text-white/90" /></span>
              <span className="p-3"><span className="block text-sm font-semibold">{option.label}</span><span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{option.pitch}</span></span>
            </button>
          );
        })}
      </div>
      <Button variant="hero" className="mt-8 w-full" onClick={() => setLocation(`/displays/new?type=${choice}`)}>Build my first display</Button>
      <Button variant="quiet" className="mt-2 w-full" icon={ArrowLeft} onClick={onBack}>Back</Button>
    </div>
  );
}
