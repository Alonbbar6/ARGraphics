import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetDisplayQueryKey, getListDisplaysQueryKey, getSearchArtistsQueryKey, useCreateDisplay, useGetDisplay,
  useGetPartnerProfile, useGetSession, useListDrinks, useSearchArtists, useUpdateDisplay, type Display, type Drink,
} from '@workspace/api-client-react';
import { ArrowLeft, ArrowRight, Box, Camera, Check, CircleCheck, ExternalLink, QrCode, Search, X } from 'lucide-react';
import { CameraCapture } from '@/components/camera-capture';
import { cameraSupported } from '@/lib/camera';
import { Button, buttonClass, Dropzone, ErrorPanel, Field, inputClass, PageHeader, PhoneFrame, SegmentedControl, Skeleton, StepIndicator } from '@/components/partner-ui';
import { GuestPreview, PLACEMENT_ICONS, TYPE_ICONS } from '@/components/display-parts';
import {
  DISPLAY_TYPES, draftFromDisplay, draftProblems, emptyDraft, formatPrice, isDisplayType, PLACEMENTS, toDisplayInput,
  toDisplayUpdate, typeLabel, type DisplayDraft,
} from '@/lib/display-draft';
import { localInputToIso } from '@/lib/traffic';
import { imageProblem, uploadImage } from '@/lib/upload';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const STEPS = ['Type', 'Media', 'Placement', 'Preview', 'Publish'];

function hasModel(drink: Pick<Drink, 'modelGlbUrl' | 'modelUsdzUrl'>) {
  return Boolean(drink.modelGlbUrl || drink.modelUsdzUrl);
}

export function NewDisplayPage() {
  const params = new URLSearchParams(window.location.search);
  const type = params.get('type');
  const session = useGetSession();
  const initialType = isDisplayType(type) ? type : session.data?.partnerKind === 'artist' ? 'art_piece' : null;
  return <DisplayEditor key={initialType ?? 'new'} initial={emptyDraft(initialType)} startStep={initialType ? 1 : 0} />;
}

export function EditDisplayPage({ id }: { id: string }) {
  const display = useGetDisplay(id, { query: { queryKey: getGetDisplayQueryKey(id), retry: 1 } });
  if (display.isLoading) return <div className="space-y-4"><Skeleton className="h-12 w-64" /><Skeleton className="h-96" /></div>;
  if (display.isError || !display.data) {
    return <ErrorPanel title="We couldn’t find that display." onRetry={() => void display.refetch()}><Link href="/displays" className="font-semibold text-primary underline">Back to your displays</Link></ErrorPanel>;
  }
  return <DisplayEditor key={display.data.id} existing={display.data} initial={draftFromDisplay(display.data)} startStep={1} />;
}

function DisplayEditor({ initial, existing, startStep }: { initial: DisplayDraft; existing?: Display; startStep: number }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const session = useGetSession();
  const profile = useGetPartnerProfile();
  const drinks = useListDrinks();
  const createDisplay = useCreateDisplay();
  const updateDisplay = useUpdateDisplay();
  const [draft, setDraft] = useState<DisplayDraft>(initial);
  const [step, setStep] = useState(startStep);
  const [reached, setReached] = useState(Math.max(startStep, existing ? STEPS.length - 1 : 0));
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [showProblems, setShowProblems] = useState(false);
  const [published, setPublished] = useState<Display | null>(null);

  useEffect(() => () => { if (localPreview) URL.revokeObjectURL(localPreview); }, [localPreview]);

  const update = (patch: Partial<DisplayDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const venueName = profile.data?.name || session.data?.barName || 'Your spot';
  const drinkList = drinks.data ?? [];
  const selectedDrink = drinkList.find((drink) => drink.id === draft.drinkId) ?? (existing?.drink && existing.drink.id === draft.drinkId ? existing.drink : undefined);
  const imageUrl = localPreview ?? (draft.mediaObjectPath === null ? null : existing?.mediaUrl ?? null) ?? selectedDrink?.thumbnailUrl ?? null;
  const problems = draftProblems(draft);
  const stepProblems = (index: number) => problems.filter((problem) => (index === 0 ? problem.step === 'type' : index === 1 ? problem.step === 'media' : index === 2 ? problem.step === 'placement' : false));

  const goTo = (index: number) => {
    setShowProblems(false);
    setStep(index);
    setReached((current) => Math.max(current, index));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const next = () => {
    if (stepProblems(step).length) { setShowProblems(true); return; }
    goTo(Math.min(STEPS.length - 1, step + 1));
  };

  const chooseFile = async (file: File) => {
    setUploadError('');
    const problem = imageProblem(file);
    if (problem) { setUploadError(problem); return; }
    const preview = URL.createObjectURL(file);
    setLocalPreview(preview);
    setUploading(true);
    try {
      update({ mediaObjectPath: await uploadImage(file) });
    } catch (error) {
      setLocalPreview(null);
      setUploadError(error instanceof Error ? error.message : 'The upload didn’t finish.');
    } finally {
      setUploading(false);
    }
  };

  const save = (status: 'draft' | 'live') => {
    if (problems.length) {
      setShowProblems(true);
      const first = problems[0];
      goTo(first.step === 'type' ? 0 : first.step === 'media' ? 1 : 2);
      setShowProblems(true);
      return;
    }
    const done = (display: Display) => {
      void queryClient.invalidateQueries({ queryKey: getListDisplaysQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetDisplayQueryKey(display.id) });
      if (status === 'live') setPublished(display);
      else {
        toast({ title: 'Saved as a draft', description: 'Guests won’t see it until you publish.' });
        setLocation('/displays');
      }
    };
    const failed = (error: unknown) => {
      const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status: number }).status) : 0;
      toast({ title: 'That didn’t save', description: status === 400 ? 'Something in the form needs a second look.' : 'Check your connection and try again.', variant: 'destructive' });
    };
    if (existing) {
      const nextStatus = status === 'draft' && existing.status !== 'draft' ? existing.status : status;
      updateDisplay.mutate({ id: existing.id, data: toDisplayUpdate(draft, nextStatus) }, { onSuccess: done, onError: failed });
    } else {
      createDisplay.mutate({ data: toDisplayInput(draft, status) }, { onSuccess: done, onError: failed });
    }
  };

  const saving = createDisplay.isPending || updateDisplay.isPending;

  if (published) return <Published display={published} />;

  const preview = (
    <PhoneFrame caption={`Live preview · ${PLACEMENTS.find((p) => p.value === draft.placement)?.label ?? ''}, dim lighting`}>
      <GuestPreview
        venueName={venueName}
        type={draft.type}
        placement={draft.placement}
        title={draft.title || selectedDrink?.name || ''}
        description={draft.description}
        imageUrl={imageUrl}
        price={selectedDrink && 'priceCents' in selectedDrink ? formatPrice(selectedDrink.priceCents) : null}
        offerTitle={draft.offerTitle}
        offerDetails={draft.offerDetails}
        offerEndsAt={localInputToIso(draft.offerEndsAt)}
        eventStartsAt={localInputToIso(draft.eventStartsAt)}
        artistName={draft.artistName}
      />
    </PhoneFrame>
  );

  const visibleProblems = showProblems ? stepProblems(step) : [];

  return (
    <div className="rise">
      <Link href="/displays" className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={15} aria-hidden="true" /> Displays</Link>
      <PageHeader
        title={stepTitle(step, draft)}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] xl:gap-12">
        <div className="min-w-0">
          <StepIndicator steps={STEPS} current={step} onStep={(index) => (existing && index === 0 ? undefined : goTo(index))} maxReachable={reached} />

          {visibleProblems.length > 0 && (
            <div role="alert" className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">
              {visibleProblems.map((problem) => <p key={problem.message}>{problem.message}</p>)}
            </div>
          )}

          {step === 0 && (
            existing ? (
              <p className="pa-card p-4 text-sm text-muted-foreground">This is a {typeLabel(existing.type).toLowerCase()}. To make a different kind, start a new display.</p>
            ) : (
              <fieldset>
                <legend className="mb-3 text-sm text-muted-foreground">Pick one. You can add more later.</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {DISPLAY_TYPES.map((option) => {
                    const Icon = TYPE_ICONS[option.value];
                    const checked = draft.type === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={checked}
                        onClick={() => { setDraft((current) => ({ ...emptyDraft(option.value), title: current.title, description: current.description, mediaObjectPath: current.mediaObjectPath })); }}
                        className={cn('pa-card relative flex min-h-28 flex-col items-start gap-2 p-4 text-left transition-colors hover:border-primary/60', checked && '!border-[#6D28D9] ring-2 ring-[#6D28D9]/40')}
                        data-testid={`type-${option.value}`}
                      >
                        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground" aria-hidden="true"><Icon size={19} /></span>
                        <span className="text-base font-semibold">{option.label}</span>
                        <span className="text-xs leading-5 text-muted-foreground">{option.pitch}</span>
                        {checked && <CircleCheck size={20} className="absolute right-3 top-3 text-primary" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )
          )}

          {step === 1 && (
            <div className="space-y-5">
              {draft.type === 'menu_item' ? (
                <section aria-labelledby="library-heading">
                  <div className="mb-2 flex items-end justify-between gap-3">
                    <h2 id="library-heading" className="text-sm font-medium">Choose from your 3D menu library</h2>
                    <Link href="/drinks" className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-primary"><Box size={13} aria-hidden="true" /> Make a new 3D item</Link>
                  </div>
                  {drinks.isLoading ? <Skeleton className="h-32" /> : drinkList.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
                      Your library is empty. Snap a photo of the dish in the <Link href="/drinks" className="font-semibold text-primary underline">3D menu library</Link> and we’ll turn it into 3D in about a day.
                    </div>
                  ) : (
                    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {drinkList.map((drink) => {
                        const checked = draft.drinkId === drink.id;
                        return (
                          <li key={drink.id}>
                            <button
                              type="button"
                              aria-pressed={checked}
                              onClick={() => update({ drinkId: drink.id, title: draft.title || drink.name, description: draft.description || drink.description })}
                              className={cn('pa-card flex w-full flex-col overflow-hidden text-left', checked && '!border-[#6D28D9] ring-2 ring-[#6D28D9]/40')}
                            >
                              <span className="pa-thumb relative block aspect-square w-full">
                                {drink.thumbnailUrl && <img src={drink.thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />}
                                {checked && <Check size={18} className="absolute right-2 top-2 rounded-full bg-[#6D28D9] p-0.5 text-white" aria-hidden="true" />}
                              </span>
                              <span className="p-2.5">
                                <span className="block truncate text-sm font-semibold">{drink.name}</span>
                                <span className="block text-[11px] text-muted-foreground">{hasModel(drink) ? 'In 3D' : drink.generationStatus === 'processing' ? '3D on the way' : 'Photo only, no 3D yet'}</span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {selectedDrink && !hasModel(selectedDrink) && <p className="mt-2 text-xs text-muted-foreground">This one doesn’t have a 3D model yet. Guests will see the photo until it’s ready.</p>}
                </section>
              ) : (
                <section>
                  <h2 className="mb-2 text-sm font-medium">{draft.type === 'art_piece' ? 'The piece' : draft.type === 'event_teaser' ? 'Poster or photo for the night' : 'A photo that sells it'}</h2>
                  {cameraOpen ? (
                    <CameraCapture subject={draft.title || 'display'} accept="image/png,image/jpeg,image/webp" onCancel={() => setCameraOpen(false)} onCapture={(file) => { setCameraOpen(false); void chooseFile(file); }} onPickFile={(file) => { setCameraOpen(false); void chooseFile(file); }} />
                  ) : (
                    <>
                      <Dropzone
                        title={draft.type === 'art_piece' ? 'Drop the artwork or a photo of it' : 'Snap the dish or drop a photo'}
                        hint="A phone photo works. JPEG, PNG or WebP, up to 10 MB."
                        busy={uploading}
                        previewUrl={imageUrl}
                        onFile={(file) => void chooseFile(file)}
                        onClear={() => { setLocalPreview(null); update({ mediaObjectPath: null }); }}
                      />
                      {cameraSupported() && !imageUrl && !uploading && (
                        <button type="button" onClick={() => setCameraOpen(true)} className={cn(buttonClass('ghost', 'sm'), 'mt-2')} data-testid="button-display-camera"><Camera size={15} aria-hidden="true" /> Take a photo now</button>
                      )}
                    </>
                  )}
                  {uploadError && <p role="alert" className="mt-2 text-sm text-destructive">{uploadError}</p>}
                  <label className="mt-4 block text-sm font-medium">Show it in 3D (optional)
                    <select className={`${inputClass} mt-2`} value={draft.drinkId ?? ''} onChange={(event) => update({ drinkId: event.target.value || null })} data-testid="select-display-model">
                      <option value="">No, show the image</option>
                      {drinkList.filter(hasModel).map((drink) => <option key={drink.id} value={drink.id}>{drink.name}</option>)}
                    </select>
                    <span className="mt-1.5 block text-xs font-normal text-muted-foreground">
                      Pick a model from your <Link href="/drinks" className="font-semibold text-primary underline">3D library</Link>: a sculpture, a mascot, a prop. Guests see it standing in the room instead of a flat picture.
                    </span>
                  </label>
                </section>
              )}

              <Field label="What guests will call it" hint="Short and specific, like “Tuesday Birria Tower”.">
                <input className={inputClass} value={draft.title} maxLength={80} onChange={(event) => update({ title: event.target.value })} placeholder={placeholderTitle(draft.type)} data-testid="input-display-title" />
              </Field>
              <Field label="A line about it (optional)">
                <textarea className={inputClass} value={draft.description} maxLength={600} rows={3} onChange={(event) => update({ description: event.target.value })} placeholder="What makes it worth the trip?" />
              </Field>

              {draft.type === 'promo_offer' && (
                <fieldset className="space-y-4 rounded-2xl border border-[#FB923C]/40 bg-[#FB923C]/5 p-4">
                  <legend className="px-1 text-sm font-semibold">The offer</legend>
                  <Field label="Offer" hint="Guests claim it in the room. Staff see a confirmation code.">
                    <input className={inputClass} value={draft.offerTitle} maxLength={80} onChange={(event) => update({ offerTitle: event.target.value })} placeholder="Free agua fresca with a tower" data-testid="input-offer-title" />
                  </Field>
                  <Field label="Fine print (optional)">
                    <input className={inputClass} value={draft.offerDetails} maxLength={240} onChange={(event) => update({ offerDetails: event.target.value })} placeholder="Tuesdays 5–10pm, one per table" />
                  </Field>
                  <Field label="Ends (optional)" hint="Leave blank to keep it running.">
                    <input type="datetime-local" className={inputClass} value={draft.offerEndsAt} onChange={(event) => update({ offerEndsAt: event.target.value })} />
                  </Field>
                </fieldset>
              )}

              {draft.type === 'event_teaser' && (
                <Field label="When it starts">
                  <input type="datetime-local" className={inputClass} value={draft.eventStartsAt} onChange={(event) => update({ eventStartsAt: event.target.value })} data-testid="input-event-starts" />
                </Field>
              )}

              {draft.type === 'art_piece' && <ArtistCredit draft={draft} onChange={update} />}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <SegmentedControl
                label="Where it appears"
                value={draft.placement}
                onChange={(placement) => update({ placement })}
                options={PLACEMENTS.map((placement) => ({ value: placement.value, label: placement.label, icon: PLACEMENT_ICONS[placement.value] }))}
              />
              <div className="pa-card p-4">
                <p className="text-sm font-semibold">{PLACEMENTS.find((p) => p.value === draft.placement)?.label}</p>
                <p className="mt-1 text-sm text-muted-foreground">{PLACEMENTS.find((p) => p.value === draft.placement)?.hint}</p>
                <p className="mt-3 text-xs text-muted-foreground">After you publish, print a code for each {draft.placement === 'table' ? 'table' : 'spot'} from <span className="font-semibold text-foreground">QR Codes</span>. Each code counts its own scans and walk-ins.</p>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <p className="mb-4 text-sm text-muted-foreground">This is what a guest sees after scanning, holding their phone up in a dim room.</p>
              <div className="lg:hidden">{preview}</div>
              <p className="hidden rounded-2xl border border-border p-4 text-sm text-muted-foreground lg:block">The preview on the right is live. Go back to any step to change it.</p>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <dl className="pa-card divide-y divide-border">
                <Summary label="Display" value={draft.type ? typeLabel(draft.type) : 'Not picked'} />
                <Summary label="Name" value={draft.title || '—'} />
                <Summary label="Where" value={PLACEMENTS.find((p) => p.value === draft.placement)?.label ?? ''} />
                {draft.type === 'promo_offer' && <Summary label="Offer" value={draft.offerTitle || '—'} />}
                {draft.type === 'event_teaser' && <Summary label="Starts" value={draft.eventStartsAt ? new Date(draft.eventStartsAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'} />}
                {draft.type === 'art_piece' && <Summary label="Artist" value={draft.artistName || 'Not credited'} />}
                {draft.type === 'menu_item' && <Summary label="Dish" value={selectedDrink?.name ?? '—'} />}
              </dl>
              {problems.length > 0 && (
                <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">
                  <p className="font-semibold">Before it goes live:</p>
                  <ul className="mt-1 list-disc pl-5">{problems.map((problem) => <li key={problem.message}>{problem.message}</li>)}</ul>
                </div>
              )}
              <p className="text-sm text-muted-foreground">Most spots see their first scans within two hours of putting codes out.</p>
            </div>
          )}

          <div className="mt-8 flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            {step > (existing ? 1 : 0) && <Button variant="ghost" icon={ArrowLeft} onClick={() => goTo(step - 1)}>Back</Button>}
            <div className="flex flex-col gap-2 sm:ml-auto sm:flex-row">
              {(step === STEPS.length - 1 || existing) && (
                <Button variant="ghost" loading={saving} onClick={() => save('draft')} data-testid="button-save-draft">{existing && existing.status !== 'draft' ? 'Save changes' : 'Save draft'}</Button>
              )}
              {step < STEPS.length - 1 ? (
                <Button variant="primary" onClick={next} disabled={step === 1 && uploading} data-testid="button-next-step">Continue to {STEPS[step + 1].toLowerCase()} <ArrowRight size={16} aria-hidden="true" /></Button>
              ) : (
                <Button variant="hero" loading={saving} loadingText="Publishing…" onClick={() => save('live')} data-testid="button-publish">{existing?.status === 'live' ? 'Update live display' : 'Publish display'}</Button>
              )}
            </div>
          </div>
        </div>

        <aside className="hidden lg:block" aria-label="Live phone preview">
          <div className="sticky top-24">{preview}</div>
        </aside>
      </div>
    </div>
  );
}

function stepTitle(step: number, draft: DisplayDraft) {
  if (step === 0) return 'What should bring them in?';
  if (step === 1) return draft.type === 'menu_item' ? 'Show us the dish' : draft.type === 'art_piece' ? 'Show us the piece' : draft.type === 'event_teaser' ? 'Tell them about the night' : 'Make the offer';
  if (step === 2) return 'Where will guests see it?';
  if (step === 3) return 'Here’s what they’ll see';
  return draft.title ? `Ready for ${draft.title}` : 'Ready to go live';
}

function placeholderTitle(type: DisplayDraft['type']) {
  if (type === 'promo_offer') return 'Empty Wednesday 2-for-1';
  if (type === 'art_piece') return 'Night Bloom mural';
  if (type === 'event_teaser') return 'Thursday trivia';
  return 'Tuesday Birria Tower';
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-2"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="truncate text-right text-sm font-semibold">{value}</dd></div>;
}

function ArtistCredit({ draft, onChange }: { draft: DisplayDraft; onChange: (patch: Partial<DisplayDraft>) => void }) {
  const [query, setQuery] = useState(draft.artistName);
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  const params = useMemo(() => ({ q: debounced }), [debounced]);
  const search = useSearchArtists(params, { query: { queryKey: getSearchArtistsQueryKey(params), enabled: debounced.length >= 2 && debounced !== draft.artistName, retry: false } });
  const results = debounced.length >= 2 && debounced !== draft.artistName ? search.data ?? [] : [];

  return (
    <div>
      <Field label="Credit the artist (optional)" hint={draft.artistSlug ? 'Linked to their ARGraphics profile, so guests can see more of their work.' : 'Search ARGraphics artists, or just type a name.'}>
        <span className="relative block">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            className={cn(inputClass, '!pl-10')}
            value={query}
            maxLength={80}
            onChange={(event) => { setQuery(event.target.value); onChange({ artistName: event.target.value, artistSlug: null }); }}
            placeholder="Ana Ruiz"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="artist-results"
            aria-autocomplete="list"
          />
          {draft.artistName && <button type="button" onClick={() => { setQuery(''); onChange({ artistName: '', artistSlug: null }); }} className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted" aria-label="Clear artist"><X size={15} /></button>}
        </span>
      </Field>
      {results.length > 0 && (
        <ul id="artist-results" role="listbox" className="mt-1 overflow-hidden rounded-xl border border-border bg-card">
          {results.slice(0, 6).map((artist) => (
            <li key={artist.slug} role="option" aria-selected={draft.artistSlug === artist.slug}>
              <button type="button" className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left text-sm hover:bg-muted" onClick={() => { setQuery(artist.name); setDebounced(artist.name); onChange({ artistName: artist.name, artistSlug: artist.slug }); }}>
                <span className="font-semibold">{artist.name}</span>
                <span className="text-xs text-muted-foreground">{artist.neighborhood}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Published({ display }: { display: Display }) {
  return (
    <div className="rise mx-auto max-w-lg py-8 text-center">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#22C55E] text-white" aria-hidden="true"><Check size={30} strokeWidth={3} /></span>
      <h1 className="pa-title mt-6">{display.title} is live.</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">Print a code for each {display.placement === 'table' ? 'table' : 'spot'} and put it out tonight. Most spots see their first scans within two hours. We’ll count every scan and every walk-in.</p>
      <div className="mt-8 flex flex-col gap-2">
        <Link href={`/qr-codes?display=${encodeURIComponent(display.id)}`} className={buttonClass('primary', 'md', 'w-full')}><QrCode size={17} aria-hidden="true" /> Print QR codes for it</Link>
        <Link href="/displays" className={buttonClass('ghost', 'md', 'w-full')}>Back to displays</Link>
        <Link href={`/displays/${display.id}`} className="inline-flex min-h-11 items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ExternalLink size={14} aria-hidden="true" /> Edit it</Link>
      </div>
    </div>
  );
}
