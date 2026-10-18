import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListArtworksQueryKey, getListLicensesQueryKey, useCreateArtwork, useDeleteArtwork, useListArtworks, useListLicenses,
  useUpdateArtwork, useUpdateLicense, type Artwork, type ArtworkLicense, type ArtworkMedium,
} from '@workspace/api-client-react';
import { Box, Check, CircleDollarSign, Eye, EyeOff, ImagePlus, LoaderCircle, Palette, Plus, ShieldCheck, Trash2, Upload, X } from 'lucide-react';
import { Badge, Button, buttonClass, ConfirmDialog, EmptyState, ErrorPanel, Field, inputClass, Skeleton, StatTile } from '@/components/partner-ui';
import { earnings, formatCents, LICENSE_LABEL, MEDIUM_LABEL } from '@/lib/artworks';
import { imageProblem, modelProblem, uploadImage, uploadModel } from '@/lib/upload';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ works */

export function WorksSection() {
  const artworks = useListArtworks();
  const [adding, setAdding] = useState(false);
  const list = artworks.data ?? [];

  return (
    <section aria-labelledby="works-heading">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 id="works-heading" className="text-base font-semibold">Your works</h2>
          <p className="text-xs text-muted-foreground">Paintings, prints, photos, digital art, or your own 3D models. Venues find them in the gallery and ask to show them.</p>
        </div>
        <Button icon={Plus} onClick={() => setAdding(true)} data-testid="button-add-artwork">Upload a work</Button>
      </div>
      {artworks.isLoading ? <Skeleton className="h-64" /> : artworks.isError ? <ErrorPanel onRetry={() => void artworks.refetch()} /> : list.length === 0 ? (
        <EmptyState icon={Palette} title="Put your work where people already are." action={<Button icon={Upload} onClick={() => setAdding(true)}>Upload your first work</Button>}>
          Upload a photo of a piece, a digital file, or a 3D model you made. Set a fee. Venues license it and credit you on the wall.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((artwork) => <ArtworkCard key={artwork.id} artwork={artwork} />)}
        </ul>
      )}
      {adding && <ArtworkDialog onClose={() => setAdding(false)} />}
    </section>
  );
}

function ArtworkCard({ artwork }: { artwork: Artwork }) {
  const queryClient = useQueryClient();
  const update = useUpdateArtwork();
  const remove = useDeleteArtwork();
  const [confirming, setConfirming] = useState(false);
  const [pricing, setPricing] = useState(false);
  const [price, setPrice] = useState((artwork.priceCents / 100).toFixed(2));
  const refresh = () => void queryClient.invalidateQueries({ queryKey: getListArtworksQueryKey() });

  const toggleVisibility = () => update.mutate({ id: artwork.id, data: { status: artwork.status === 'listed' ? 'hidden' : 'listed' } }, {
    onSuccess: refresh,
    onError: () => toast({ title: 'That didn’t save', variant: 'destructive' }),
  });
  const savePrice = (event: FormEvent) => {
    event.preventDefault();
    const dollars = Number(price);
    if (!Number.isFinite(dollars) || dollars < 0) { toast({ title: 'Enter a price of 0 or more', variant: 'destructive' }); return; }
    update.mutate({ id: artwork.id, data: { priceCents: Math.round(dollars * 100) } }, {
      onSuccess: () => { refresh(); setPricing(false); },
      onError: () => toast({ title: 'That didn’t save', variant: 'destructive' }),
    });
  };

  return (
    <li className="pa-card overflow-hidden" data-testid={`card-artwork-${artwork.id}`}>
      <div className="relative h-44 bg-muted">
        <img src={artwork.imageUrl} alt={artwork.title} className="h-full w-full object-cover" />
        <span className="absolute left-2 top-2 flex gap-1.5">
          <Badge tone="violet">{artwork.medium === 'model' ? <><Box size={11} aria-hidden="true" /> 3D</> : '2D'}</Badge>
          {artwork.status === 'hidden' && <Badge tone="draft">Hidden</Badge>}
        </span>
        <span className="absolute right-2 top-2"><Badge tone="live"><ShieldCheck size={11} aria-hidden="true" /> Original</Badge></span>
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-base font-semibold">{artwork.title}</p>
          <button type="button" onClick={() => setPricing(true)} className="shrink-0 text-sm font-semibold text-primary underline-offset-4 hover:underline" data-testid={`button-price-${artwork.id}`}>{formatCents(artwork.priceCents)}</button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {artwork.licensedVenues > 0 ? `${artwork.licensedVenues} venue${artwork.licensedVenues === 1 ? '' : 's'} showing it` : 'Not placed yet'}
          {artwork.pendingRequests > 0 && <> · <span className="font-semibold text-primary">{artwork.pendingRequests} waiting on you</span></>}
        </p>
        {pricing && (
          <form onSubmit={savePrice} className="mt-3 flex items-end gap-2">
            <Field label="Licence fee per venue (USD)"><input className={inputClass} type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} /></Field>
            <Button type="submit" size="sm" loading={update.isPending}>Save</Button>
            <Button variant="quiet" size="sm" onClick={() => setPricing(false)}>Cancel</Button>
          </form>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" icon={artwork.status === 'listed' ? EyeOff : Eye} onClick={toggleVisibility} loading={update.isPending}>{artwork.status === 'listed' ? 'Hide from gallery' : 'List in gallery'}</Button>
          <Button variant="quiet" size="sm" icon={Trash2} onClick={() => setConfirming(true)} disabled={artwork.licensedVenues > 0} title={artwork.licensedVenues > 0 ? 'End the venues’ licences first.' : undefined}>Remove</Button>
        </div>
      </div>
      <ConfirmDialog open={confirming} onOpenChange={setConfirming} title={`Remove “${artwork.title}”?`} confirmLabel="Remove the work" busy={remove.isPending}
        onConfirm={() => remove.mutate({ id: artwork.id }, { onSuccess: () => { refresh(); setConfirming(false); }, onError: () => toast({ title: 'Could not remove it', description: 'A venue may still hold a licence.', variant: 'destructive' }) })}>
        The files are deleted. Venues that asked for it will no longer see it.
      </ConfirmDialog>
    </li>
  );
}

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';

/** Upload a work: a preview image always, plus the artist's own GLB (and optional USDZ) for 3D. */
function ArtworkDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const create = useCreateArtwork();
  const [medium, setMedium] = useState<ArtworkMedium>('image');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('0');
  const [licenseNote, setLicenseNote] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [original, setOriginal] = useState(false);
  const [image, setImage] = useState<{ path: string; preview: string; name: string } | null>(null);
  const [glb, setGlb] = useState<{ path: string; name: string } | null>(null);
  const [usdz, setUsdz] = useState<{ path: string; name: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => () => { if (image) URL.revokeObjectURL(image.preview); }, [image]);

  const pickImage = async (file?: File) => {
    if (!file) return;
    const problem = imageProblem(file);
    if (problem) { setError(problem); return; }
    setError('');
    setBusy('Uploading the image…');
    try {
      const path = await uploadImage(file);
      setImage({ path, preview: URL.createObjectURL(file), name: file.name });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The upload failed.');
    } finally { setBusy(''); }
  };
  const pickModel = async (kind: 'glb' | 'usdz', file?: File) => {
    if (!file) return;
    const problem = modelProblem(file);
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (problem || extension !== kind) { setError(problem ?? `Choose a .${kind} file here.`); return; }
    setError('');
    setBusy(`Uploading ${file.name}…`);
    try {
      const path = await uploadModel(file);
      (kind === 'glb' ? setGlb : setUsdz)({ path, name: file.name });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The upload failed.');
    } finally { setBusy(''); }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const dollars = Number(price);
    if (!title.trim()) { setError('Give the work a title.'); return; }
    if (!image) { setError(medium === 'model' ? 'Add a preview image of the model.' : 'Upload the image of your work.'); return; }
    if (medium === 'model' && !glb) { setError('Upload your model as a .glb file.'); return; }
    if (!Number.isFinite(dollars) || dollars < 0) { setError('Enter a licence fee of 0 or more.'); return; }
    if (!original) { setError('Confirm this is your own work. ARGraphics does not list AI-generated pieces.'); return; }
    const height = heightCm ? Number(heightCm) : null;
    if (medium === 'model' && height !== null && !(height >= 1 && height <= 500)) { setError('Enter a real height between 1 and 500 cm.'); return; }
    create.mutate({ data: {
      title: title.trim(), description: description.trim(), medium, imageObjectPath: image.path,
      modelGlbObjectPath: medium === 'model' ? glb?.path ?? null : null,
      modelUsdzObjectPath: medium === 'model' ? usdz?.path ?? null : null,
      realHeightCm: medium === 'model' ? height : null,
      priceCents: Math.round(dollars * 100), licenseNote: licenseNote.trim(), status: 'listed', originalWork: true,
    } }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListArtworksQueryKey() });
        toast({ title: 'Work listed', description: 'Venues can now find it in the gallery.' });
        onClose();
      },
      onError: (cause) => {
        const status = 'status' in cause ? cause.status : undefined;
        setError(status === 400 ? 'The server rejected the files or details. Check the image and model and try again.' : 'Could not save the work. Try again.');
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/55 p-0 backdrop-blur-sm sm:place-items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="artwork-form-title" className="max-h-[94dvh] w-full max-w-xl overflow-y-auto rounded-t-[2rem] border border-border bg-card p-5 shadow-2xl sm:rounded-[2rem] sm:p-7">
        <div className="mb-5 flex items-start justify-between">
          <div><p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Your work</p><h2 id="artwork-form-title" className="mt-1 text-xl font-semibold">Upload a piece.</h2></div>
          <button onClick={onClose} className="grid h-11 w-11 place-items-center rounded-xl hover:bg-muted" aria-label="Close"><X size={19} /></button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="What kind of work">
            {(['image', 'model'] as ArtworkMedium[]).map((option) => (
              <button key={option} type="button" aria-pressed={medium === option} onClick={() => setMedium(option)} className={cn('pa-card flex min-h-14 items-center gap-3 p-3 text-left', medium === option && '!border-primary ring-2 ring-primary/30')} data-testid={`button-medium-${option}`}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground">{option === 'image' ? <ImagePlus size={17} /> : <Box size={17} />}</span>
                <span><span className="block text-sm font-semibold">{MEDIUM_LABEL[option]}</span><span className="block text-[11px] text-muted-foreground">{option === 'image' ? 'Painting, print, photo, digital art' : 'A .glb you modelled or scanned'}</span></span>
              </button>
            ))}
          </div>
          <Field label="Title"><input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} required data-testid="input-artwork-title" /></Field>
          <Field label="About it" hint={`${description.length}/600`}><textarea className={inputClass} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={600} placeholder="Where it came from, what it is made of, how big it hangs." /></Field>

          <FilePick label={medium === 'model' ? 'Preview image of the model' : 'The work (PNG, JPEG or WebP, up to 10 MB)'} accept={IMAGE_ACCEPT} chosen={image?.name ?? null} preview={image?.preview} onFile={(file) => void pickImage(file)} testId="input-artwork-image" />
          {medium === 'model' && (
            <>
              <FilePick label="3D model (.glb, up to 30 MB)" accept=".glb" chosen={glb?.name ?? null} onFile={(file) => void pickModel('glb', file)} testId="input-artwork-glb" />
              <FilePick label="iPhone version (.usdz, optional)" accept=".usdz" chosen={usdz?.name ?? null} onFile={(file) => void pickModel('usdz', file)} testId="input-artwork-usdz" />
              <Field label="Real height in the room (cm, optional)" hint="How tall it stands when a guest places it. Leave blank for the app default."><input className={inputClass} type="number" min="1" max="500" step="0.5" value={heightCm} onChange={(event) => setHeightCm(event.target.value)} /></Field>
            </>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Licence fee per venue (USD)" hint="What a venue pays you to show it. 0 means free to host."><input className={inputClass} type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} data-testid="input-artwork-price" /></Field>
            <Field label="Terms (optional)" hint="One line, e.g. “Credit on the wall. 6 months.”"><input className={inputClass} value={licenseNote} onChange={(event) => setLicenseNote(event.target.value)} maxLength={400} /></Field>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-background px-3 py-3 text-sm">
            <input type="checkbox" checked={original} onChange={(event) => setOriginal(event.target.checked)} className="mt-0.5 h-5 w-5 accent-[hsl(var(--primary))]" data-testid="checkbox-original-work" />
            <span><span className="font-semibold">This is my own work.</span> <span className="text-muted-foreground">I made it, or own the rights to it, and it was not generated by AI. ARGraphics does not list AI-generated pieces, and removes work that turns out to be.</span></span>
          </label>
          {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle size={16} className="animate-spin" /> {busy}</p>}
          {error && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-artwork-error">{error}</p>}
          <Button type="submit" className="w-full" loading={create.isPending} disabled={!!busy} data-testid="button-save-artwork"><Check size={17} aria-hidden="true" /> List this work</Button>
        </form>
      </section>
    </div>
  );
}

function FilePick({ label, accept, chosen, preview, onFile, testId }: { label: string; accept: string; chosen: string | null; preview?: string; onFile: (file?: File) => void; testId: string }) {
  return (
    <label className="block text-sm font-medium">{label}
      <span className="mt-1.5 flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border bg-background px-3 py-2 hover:bg-muted">
        {preview ? <img src={preview} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <Upload size={18} className="text-muted-foreground" aria-hidden="true" />}
        <span className={cn('text-sm', chosen ? 'font-semibold' : 'text-muted-foreground')}>{chosen ?? 'Choose a file'}</span>
        <input className="sr-only" type="file" accept={accept} onChange={(event) => { onFile(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} data-testid={testId} />
      </span>
    </label>
  );
}

/* --------------------------------------------------- requests and earnings */

export function LicensesSection() {
  const queryClient = useQueryClient();
  const licenses = useListLicenses();
  const update = useUpdateLicense();
  const list = licenses.data ?? [];
  const requests = list.filter((license) => license.status === 'requested');
  const active = list.filter((license) => license.status === 'accepted' || license.status === 'ended');
  const money = earnings(list);
  const act = (license: ArtworkLicense, action: 'accept' | 'decline' | 'mark_paid' | 'end') => update.mutate({ id: license.id, data: { action } }, {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getListLicensesQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getListArtworksQueryKey() });
      toast({ title: action === 'accept' ? 'Licensed. They can place it now.' : action === 'decline' ? 'Declined' : action === 'mark_paid' ? 'Marked as paid' : 'Licence ended' });
    },
    onError: () => toast({ title: 'That didn’t go through', variant: 'destructive' }),
  });

  return (
    <section aria-labelledby="earnings-heading" className="space-y-5">
      <div>
        <h2 id="earnings-heading" className="mb-3 text-base font-semibold">Earnings</h2>
        <div className="grid grid-cols-3 gap-3">
          <StatTile index={0} icon={CircleDollarSign} label="Paid" value={money.paidCents / 100} emphasis />
          <StatTile index={1} icon={CircleDollarSign} label="Owed to you" value={money.owedCents / 100} />
          <StatTile index={2} icon={Palette} label="Licences" value={money.count} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Amounts in USD. Venues pay you directly for now; mark a licence paid when the money lands.</p>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Requests</h3>
        {licenses.isLoading ? <Skeleton className="h-24" /> : licenses.isError ? <ErrorPanel onRetry={() => void licenses.refetch()} /> : requests.length === 0 ? (
          <p className="pa-card p-4 text-sm text-muted-foreground">No new requests. When a venue asks to show a piece, you answer here.</p>
        ) : (
          <ul className="space-y-2">
            {requests.map((license) => (
              <li key={license.id} className="pa-card p-3" data-testid={`request-${license.id}`}>
                <div className="flex items-start gap-3">
                  <img src={license.artworkImageUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{license.venue.name} <span className="font-normal text-muted-foreground">wants to show</span> {license.artworkTitle}</p>
                    <p className="text-xs text-muted-foreground">{license.venue.neighborhood || 'Nearby'} · {formatCents(license.priceCents)}</p>
                    {license.message && <p className="mt-1.5 rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs">“{license.message}”</p>}
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" icon={Check} onClick={() => act(license, 'accept')} loading={update.isPending} data-testid={`button-accept-${license.id}`}>Accept</Button>
                  <Button size="sm" variant="quiet" onClick={() => act(license, 'decline')} disabled={update.isPending}>Decline</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Licences</h3>
        {active.length === 0 ? <p className="pa-card p-4 text-sm text-muted-foreground">Accepted licences and what each one pays show up here.</p> : (
          <ul className="space-y-2">
            {active.map((license) => (
              <li key={license.id} className="pa-card flex flex-wrap items-center gap-3 p-3" data-testid={`license-${license.id}`}>
                <img src={license.artworkImageUrl} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{license.artworkTitle} <span className="font-normal text-muted-foreground">at</span> {license.venue.name}</span>
                  <span className="block text-xs text-muted-foreground">{LICENSE_LABEL[license.status]}{license.displayStatus ? ` · display ${license.displayStatus}` : ''} · {license.paidAt ? 'Paid' : 'Not paid yet'}</span>
                </span>
                <span className="text-sm font-semibold tabular-nums">{formatCents(license.priceCents)}</span>
                {!license.paidAt && license.priceCents > 0 && <Button size="sm" variant="ghost" onClick={() => act(license, 'mark_paid')} disabled={update.isPending} data-testid={`button-paid-${license.id}`}>Mark paid</Button>}
                {license.status === 'accepted' && <Button size="sm" variant="quiet" onClick={() => act(license, 'end')} disabled={update.isPending}>End</Button>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Looking for venues? <Link href="/displays" className="font-semibold text-primary underline underline-offset-4">Your showcase placements</Link> still work the same way.</p>
    </section>
  );
}

export const galleryLinkClass = buttonClass('ghost', 'sm');
