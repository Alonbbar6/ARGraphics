import { getGetPartnerProfileQueryKey, getListTableCardsQueryKey, useCreateTableCard, useDeleteTableCard, useGetAnalytics, useGetPartnerProfile, useGetSession, useListTableCards, useUpdatePartnerProfile } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Button, buttonClass, Field, inputClass, PageHeader } from '@/components/partner-ui';
import { useQueryClient } from '@tanstack/react-query';
import { createTableCardPdf } from '../lib/table-card-pdf';
import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowLeft, Check, Download, LayoutGrid, LoaderCircle, Pencil, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { TableCardEditor } from '@/components/table-card-editor';
import { countLabel } from '@/lib/traffic';

type ArtworkSelection = {
  file: File;
  previewUrl: string;
  widthPx: number;
  heightPx: number;
  contrast: number;
};

export function TableCardsPage() {
  const queryClient = useQueryClient();
  const cards = useListTableCards();
  const createCard = useCreateTableCard();
  const deleteCard = useDeleteTableCard();
  const [name, setName] = useState('');
  const [widthCm, setWidthCm] = useState('10');
  const [artwork, setArtwork] = useState<ArtworkSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const traffic = useGetAnalytics({ range: 'week' });

  useEffect(() => () => {
    if (artwork?.previewUrl) URL.revokeObjectURL(artwork.previewUrl);
  }, [artwork?.previewUrl]);

  const onChooseFile = async (file?: File) => {
    setArtwork(null);
    setError('');
    setMessage('');
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setError('Choose a PNG, JPEG, or WebP image under 10 MB.');
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      const sampleScale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * sampleScale));
      canvas.height = Math.max(1, Math.round(bitmap.height * sampleScale));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('This browser could not inspect the image.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const widthPx = bitmap.width;
      const heightPx = bitmap.height;
      bitmap.close();
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      let squares = 0;
      const count = pixels.length / 4;
      for (let i = 0; i < pixels.length; i += 4) {
        const luma = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
        sum += luma;
        squares += luma * luma;
      }
      setArtwork({
        file,
        previewUrl: URL.createObjectURL(file),
        widthPx,
        heightPx,
        contrast: Math.sqrt(Math.max(0, squares / count - (sum / count) ** 2)),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that image.');
    }
  };

  const saveCard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!artwork) {
      setError('Choose the artwork you want printed.');
      return;
    }
    const physicalWidth = Number(widthCm);
    if (!Number.isFinite(physicalWidth) || physicalWidth <= 0 || physicalWidth > 100) {
      setError('Enter a width greater than 0 and no more than 100 cm.');
      return;
    }
    setBusy(true);
    try {
      const request = await fetch('/api/storage/uploads/request-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: artwork.file.name,
          size: artwork.file.size,
          contentType: artwork.file.type,
        }),
      });
      const uploadInfo = await request.json() as { uploadURL?: string; objectPath?: string; error?: string };
      if (!request.ok || !uploadInfo.uploadURL || !uploadInfo.objectPath) {
        throw new Error(uploadInfo.error || 'Could not start the artwork upload.');
      }
      const uploaded = await fetch(uploadInfo.uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': artwork.file.type },
        body: artwork.file,
      });
      if (!uploaded.ok) throw new Error('The artwork upload did not finish. Please try again.');
      await createCard.mutateAsync({
        data: {
          name: name.trim() || artwork.file.name.replace(/\.[^.]+$/, ''),
          objectPath: uploadInfo.objectPath,
          physicalWidthCm: physicalWidth,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getListTableCardsQueryKey() });
      setName('');
      setWidthCm('10');
      setArtwork(null);
      setMessage('Table card saved. Its PDF is ready to download.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the table card.');
    } finally {
      setBusy(false);
    }
  };

  const downloadPdf = async (card: { id: string; name: string; referenceImageUrl: string; physicalWidthCm: number }) => {
    setError('');
    try {
      const response = await fetch(card.referenceImageUrl);
      if (!response.ok) throw new Error('Could not load the artwork to make the PDF.');
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not prepare the print file.');
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pdf = createTableCardPdf(
        canvas.toDataURL('image/png'), card.physicalWidthCm, canvas.width, canvas.height,
      );
      pdf.save(`${card.name.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'table-card'}.pdf`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the print PDF.');
    }
  };

  const removeCard = async (id: string) => {
    setError('');
    try {
      await deleteCard.mutateAsync({ id });
      await queryClient.invalidateQueries({ queryKey: getListTableCardsQueryKey() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove the table card.');
    }
  };

  const dpi = artwork ? artwork.widthPx / (Number(widthCm) / 2.54) : 0;
  const qualityWarnings = [
    artwork && dpi < 150 ? `At this width the image prints at about ${Math.round(dpi)} DPI. Use a higher-resolution image for sharper print.` : '',
    artwork && artwork.contrast < 28 ? 'The artwork has low contrast, so its details may be hard to see when printed.' : '',
  ].filter(Boolean);

  return (
    <div className="rise">
      <Link href="/qr-codes" className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={15} aria-hidden="true" /> QR Codes</Link>
      <PageHeader title="Art the app can see" lede={<>Printed artwork works like a code: guests point the ARGraphics app at the card and your display appears on it.{traffic.data ? <> Your spot had <strong className="font-semibold text-foreground">{countLabel(traffic.data.totals.scans, 'scan')}</strong> this week.</> : null}</>} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.8fr)]">
        <section className="rounded-3xl border border-border bg-card p-5 sm:p-7">
          <p className="text-xs font-bold uppercase tracking-[.18em] text-primary">New artwork</p>
          <h2 className="mt-1 text-xl font-semibold">Set up a card</h2>
          <form className="mt-6 space-y-5" onSubmit={saveCard}>
            <label className="block text-sm font-medium">Card name
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Front table card" className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-4 text-sm outline-none focus:border-primary" />
            </label>
            <label className="block text-sm font-medium">Artwork
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ''; void onChooseFile(file); }} className="sr-only" />
              <span className="mt-2 flex min-h-24 cursor-pointer items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-background px-4 text-sm text-muted-foreground hover:border-primary">
                {artwork ? <><Check size={17} className="text-primary" />{artwork.file.name}</> : <><Upload size={17} />Choose a PNG, JPEG, or WebP (up to 10 MB)</>}
              </span>
            </label>
            {artwork && <div className="grid gap-4 rounded-2xl bg-background p-4 sm:grid-cols-[120px_1fr]">
              <img src={artwork.previewUrl} alt="Artwork preview" className="max-h-36 w-full rounded-xl object-contain" />
              <div className="self-center text-xs leading-5 text-muted-foreground">
                <p className="font-semibold text-foreground">{artwork.widthPx} × {artwork.heightPx} px</p>
                <p>Estimated output: {Math.round(dpi)} DPI at the selected width</p>
                <p>Contrast estimate: {Math.round(artwork.contrast)} / 255</p>
              </div>
            </div>}
            <label className="block text-sm font-medium">Printed width
              <div className="mt-2 flex items-center gap-3">
                <input type="number" min="0.1" max="100" step="0.1" required value={widthCm} onChange={(event) => setWidthCm(event.target.value)} className="h-12 w-36 rounded-xl border border-border bg-background px-4 text-sm outline-none focus:border-primary" />
                <span className="text-sm text-muted-foreground">centimeters</span>
              </div>
            </label>
            {qualityWarnings.length > 0 && <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100">
              <p className="font-semibold">Print-quality check</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">{qualityWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </div>}
            {error && <p role="alert" className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"><AlertCircle size={16} className="mt-0.5 shrink-0" />{error}</p>}
            {message && <p role="status" className="flex items-start gap-2 rounded-xl bg-primary/10 p-3 text-sm text-primary"><Check size={16} className="mt-0.5 shrink-0" />{message}</p>}
            <button type="submit" disabled={busy || !artwork} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 rounded-full">
              {busy ? <><LoaderCircle size={17} className="animate-spin" />Uploading artwork…</> : 'Save table card'}
            </button>
          </form>
        </section>
        <section className="rounded-3xl border border-border bg-card p-5 sm:p-7">
          <div className="flex items-end justify-between gap-4">
            <div><p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Your artwork</p><h2 className="mt-1 text-xl font-semibold">Saved cards</h2></div>
            <span className="text-xs text-muted-foreground">{cards.data?.length ?? 0} total</span>
          </div>
          {cards.isLoading ? <div className="mt-5 h-28 animate-pulse rounded-2xl bg-muted" /> :
            cards.isError ? <p className="mt-5 rounded-xl bg-destructive/10 p-4 text-sm text-destructive">Couldn’t load your table cards. Refresh and try again.</p> :
            cards.data?.length ? <div className="mt-5 space-y-3">{cards.data.map((card) => (
              <article key={card.id} className="overflow-hidden rounded-2xl border border-border bg-background">
                <img src={card.referenceImageUrl} alt={`${card.name} reference artwork`} className="h-40 w-full bg-muted object-contain p-3" />
                <div className="flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{card.name}</p><p className="mt-1 text-xs text-muted-foreground">{card.physicalWidthCm} cm wide · PDF uses original aspect ratio</p><p className="mt-1 text-xs text-muted-foreground">{card.isActive ? 'Active in the ARGraphics app' : 'Hidden from the ARGraphics app'}</p></div>
                  <button type="button" onClick={() => setEditingId(card.id)} disabled={editingId !== null || deleteCard.isPending} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50" aria-label={`Edit ${card.name}`} title="Edit card details"><Pencil size={17} /></button>
                  <button type="button" onClick={() => void downloadPdf(card)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/80" aria-label={`Download print PDF for ${card.name}`} title="Download print-ready PDF"><Download size={17} /></button>
                  <button type="button" onClick={() => void removeCard(card.id)} disabled={deleteCard.isPending || editingId !== null} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50" aria-label={`Delete ${card.name}`} title="Delete card"><Trash2 size={17} /></button>
                </div>
                {editingId === card.id && <TableCardEditor card={card} onClose={() => setEditingId(null)} />}
              </article>
            ))}</div> : <div className="mt-5 rounded-2xl border border-dashed border-border p-7 text-center">
              <LayoutGrid size={24} className="mx-auto text-muted-foreground" />
              <p className="mt-3 text-sm font-semibold">No table cards yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Your saved artwork and print PDFs will appear here.</p>
            </div>}
        </section>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: session } = useGetSession();
  const profile = useGetPartnerProfile();
  const analytics = useGetAnalytics({ range: 'week' });
  const updateProfile = useUpdatePartnerProfile();
  const [form, setForm] = useState({ name: '', bio: '', neighborhood: '', address: '', serviceOpen: '', serviceClose: '' });
  const [saved, setSaved] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (profile.data) setForm({ name: profile.data.name, bio: profile.data.bio, neighborhood: profile.data.neighborhood, address: profile.data.address, serviceOpen: profile.data.serviceOpen ?? '', serviceClose: profile.data.serviceClose ?? '' });
  }, [profile.data]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaved('');
    setFormError('');
    updateProfile.mutate({ data: { name: form.name.trim(), bio: form.bio.trim(), neighborhood: form.neighborhood.trim(), address: form.address.trim(), serviceOpen: form.serviceOpen || null, serviceClose: form.serviceClose || null } }, {
      onSuccess: (result) => {
        queryClient.setQueryData(getGetPartnerProfileQueryKey(), result);
        setSaved('Saved. Guests see the new details on their next scan.');
      },
      onError: () => setFormError('That didn’t save. Names need at least 2 characters.'),
    });
  };

  const artist = (profile.data?.kind ?? session?.partnerKind) === 'artist';
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div className="rise">
      <PageHeader title="Your details" lede={analytics.data ? `${countLabel(analytics.data.totals.scans, 'scan')} and ${countLabel(analytics.data.totals.redemptions, 'redemption')} this week. Keep these details right so nearby guests can find you.` : 'What guests see about you after they scan.'} />
      <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
        <section className="pa-card p-5 sm:p-7">
          <h2 className="text-lg font-semibold">{artist ? 'Artist profile' : 'Venue profile'}</h2>
          {profile.isLoading ? <div className="pa-skeleton mt-5 h-64" /> : profile.isError ? (
            <p className="mt-4 text-sm text-muted-foreground">Your profile didn’t load. Refresh to try again.</p>
          ) : (
            <form className="mt-5 space-y-4" onSubmit={submit}>
              <Field label={artist ? 'Name' : 'Venue name'}><input className={inputClass} value={form.name} onChange={set('name')} minLength={2} maxLength={80} required /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Neighborhood"><input className={inputClass} value={form.neighborhood} onChange={set('neighborhood')} maxLength={80} /></Field>
                {!artist && <Field label="Street address"><input className={inputClass} value={form.address} onChange={set('address')} maxLength={200} autoComplete="street-address" /></Field>}
              </div>
              <Field label={artist ? 'Bio' : 'About your spot'} hint={`${form.bio.length}/600 · shown on the guest card`}><textarea className={inputClass} rows={4} value={form.bio} onChange={set('bio')} maxLength={600} /></Field>
              {!artist && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Opens" hint="Tonight mode switches on at opening. Blank means 5:00 pm."><input type="time" className={inputClass} value={form.serviceOpen} onChange={set('serviceOpen')} data-testid="input-service-open" /></Field>
                  <Field label="Last call" hint="And off at close. Blank means 3:00 am."><input type="time" className={inputClass} value={form.serviceClose} onChange={set('serviceClose')} data-testid="input-service-close" /></Field>
                </div>
              )}
              {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
              {saved && <p role="status" className="flex items-center gap-2 text-sm text-primary"><Check size={15} aria-hidden="true" />{saved}</p>}
              <Button type="submit" loading={updateProfile.isPending}>Save details</Button>
            </form>
          )}
        </section>
        <section className="pa-card p-5 sm:p-7">
          <h2 className="text-lg font-semibold">Account</h2>
          <dl className="mt-3 divide-y divide-border">
            <div className="flex min-h-14 items-center justify-between gap-5"><dt className="text-sm text-muted-foreground">Signed in as</dt><dd className="truncate text-right text-sm font-semibold">{session?.userName || '—'}</dd></div>
            <div className="flex min-h-14 items-center justify-between gap-5"><dt className="text-sm text-muted-foreground">Account type</dt><dd className="text-right text-sm font-semibold">{artist ? 'Artist' : 'Venue'}</dd></div>
            <div className="flex min-h-14 items-center justify-between gap-5"><dt className="text-sm text-muted-foreground">Times shown in</dt><dd className="text-right text-sm font-semibold">{profile.data?.timezone.replace(/_/g, ' ') || '—'}</dd></div>
            <div className="flex min-h-14 items-center justify-between gap-5"><dt className="text-sm text-muted-foreground">Location pin</dt><dd className="text-right text-sm font-semibold">{profile.data?.latitude != null ? 'Set' : 'Not set'}</dd></div>
          </dl>
          <p className="mt-5 flex items-start gap-2 text-sm text-muted-foreground"><ShieldCheck size={16} className="mt-0.5 shrink-0" aria-hidden="true" />Your numbers are private. Guests only see your name, neighborhood and what’s live.</p>
          <a href="mailto:hello@argraphics.app" className={buttonClass('ghost', 'md', 'mt-5 w-full')}>Talk to a real person</a>
        </section>
      </div>
    </div>
  );
}
