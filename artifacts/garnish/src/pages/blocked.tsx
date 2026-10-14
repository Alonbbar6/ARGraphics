import { getListTableCardsQueryKey, useCreateTableCard, useDeleteTableCard, useListTableCards, useGetSession } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { createTableCardPdf } from '../lib/table-card-pdf';
import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, Check, Copy, Download, ExternalLink, KeyRound, LayoutGrid, Link2, LoaderCircle, Pencil, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { TableCardEditor } from '@/components/table-card-editor';

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
      <div className="mb-8"><p className="mb-2 text-xs font-bold uppercase tracking-[.22em] text-primary">At every seat</p><h1 className="serif text-4xl sm:text-5xl">Table cards.</h1><p className="mt-2 text-sm text-muted-foreground">Upload your artwork, set the printed width, and export a card-sized PDF.</p></div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.8fr)]">
        <section className="rounded-3xl border border-border bg-card p-5 sm:p-7">
          <p className="text-xs font-bold uppercase tracking-[.18em] text-primary">New artwork</p>
          <h2 className="serif mt-1 text-3xl">Set up a card</h2>
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
            <button type="submit" disabled={busy || !artwork} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? <><LoaderCircle size={17} className="animate-spin" />Uploading artwork…</> : 'Save table card'}
            </button>
          </form>
        </section>
        <section className="rounded-3xl border border-border bg-card p-5 sm:p-7">
          <div className="flex items-end justify-between gap-4">
            <div><p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Your artwork</p><h2 className="serif mt-1 text-3xl">Saved cards</h2></div>
            <span className="text-xs text-muted-foreground">{cards.data?.length ?? 0} total</span>
          </div>
          {cards.isLoading ? <div className="mt-5 h-28 animate-pulse rounded-2xl bg-muted" /> :
            cards.isError ? <p className="mt-5 rounded-xl bg-destructive/10 p-4 text-sm text-destructive">Couldn’t load your table cards. Refresh and try again.</p> :
            cards.data?.length ? <div className="mt-5 space-y-3">{cards.data.map((card) => (
              <article key={card.id} className="overflow-hidden rounded-2xl border border-border bg-background">
                <img src={card.referenceImageUrl} alt={`${card.name} reference artwork`} className="h-40 w-full bg-muted object-contain p-3" />
                <div className="flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{card.name}</p><p className="mt-1 text-xs text-muted-foreground">{card.physicalWidthCm} cm wide · PDF uses original aspect ratio</p><p className="mt-1 text-xs text-muted-foreground">{card.isActive ? 'Active in iOS menu' : 'Inactive in iOS menu'}</p></div>
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
  const { data: session, isLoading } = useGetSession();
  const slug = session?.barSlug || '';
  const [copied, setCopied] = useState(false);
  const url = slug ? `${window.location.origin}/menu/${slug}` : '';
  const copyUrl = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  if (isLoading) {
    return <div className="space-y-5"><div className="h-10 w-56 animate-pulse rounded-lg bg-muted" /><div className="h-48 animate-pulse rounded-3xl bg-muted" /><div className="h-48 animate-pulse rounded-3xl bg-muted" /></div>;
  }

  return (
    <div className="rise">
      <div className="mb-8"><p className="mb-2 text-xs font-bold uppercase tracking-[.22em] text-primary">The back bar</p><h1 className="serif text-4xl sm:text-5xl">Settings & details.</h1><p className="mt-2 text-sm text-muted-foreground">Your bar’s name, your menu’s address, and the bits behind the scenes.</p></div>
      <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
        <section className="rounded-3xl border border-border bg-card p-5 sm:p-7">
          <div className="mb-6 flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Your bar</p><h2 className="serif mt-1 text-3xl">The basics</h2></div><span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-secondary-foreground"><ShieldCheck size={19} /></span></div>
          <dl className="divide-y divide-border">
            <div className="flex min-h-16 items-center justify-between gap-5"><dt className="text-sm text-muted-foreground">Bar name</dt><dd className="text-right text-sm font-semibold" data-testid="text-settings-bar-name">{session?.barName || 'Not set'}</dd></div>
            <div className="flex min-h-16 items-center justify-between gap-5"><dt className="text-sm text-muted-foreground">Menu address</dt><dd className="text-right text-sm font-semibold">{slug ? `/${slug}` : 'Not set'}</dd></div>
            <div className="flex min-h-16 items-center justify-between gap-5"><dt className="text-sm text-muted-foreground">iOS connection</dt><dd className="text-right text-sm font-semibold">Key-protected API</dd></div>
          </dl>
          {slug && <div className="mt-5 flex flex-col gap-2 rounded-2xl bg-background p-3 sm:flex-row"><div className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-2 text-sm text-muted-foreground"><Link2 size={15} className="shrink-0" /><span className="truncate">{url}</span></div><button onClick={copyUrl} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-secondary px-4 text-sm font-semibold text-secondary-foreground" data-testid="button-copy-menu-url">{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy link'}</button><a href={url} target="_blank" rel="noreferrer" className="grid min-h-11 place-items-center rounded-xl px-3 text-muted-foreground hover:bg-muted" aria-label="Open public menu"><ExternalLink size={16} /></a></div>}
        </section>
        <section className="rounded-3xl border border-border bg-card p-5 sm:p-7">
          <div className="mb-5 flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Connection</p><h2 className="serif mt-1 text-3xl">API access</h2></div><span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary"><KeyRound size={19} /></span></div>
          <p className="text-sm leading-6 text-muted-foreground">The iOS menu API uses the <code className="rounded bg-muted px-1.5 py-0.5">IOS_API_KEY</code> secret. Keep it in the iOS app’s secure configuration; never include it in a public client or check it into source control.</p>
          <div className="mt-5 rounded-2xl border border-border bg-background p-4">
            <p className="text-xs font-bold uppercase tracking-[.15em] text-muted-foreground">Request examples</p>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all text-xs leading-6 text-foreground">{`GET /api/v1/bars/${slug || '{slug}'}/menu-version
GET /api/v1/bars/${slug || '{slug}'}/menu
GET /api/v1/bars/${slug || '{slug}'}/table-cards
POST /api/v1/bars/${slug || '{slug}'}/events
Header: x-api-key: $IOS_API_KEY
Body: { "drinkId": "drink-id", "eventType": "ar_open" }`}</pre>
          </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">Rotate the secret through Replit Secrets to revoke existing clients. Browser CORS preflight is enabled for the API key header; requests are limited to 120 per IP per minute.</p>
        </section>
      </div>
      <section className="mt-5 rounded-3xl border border-border bg-card p-5 sm:p-7">
        <p className="text-xs font-bold uppercase tracking-[.18em] text-primary">A note on changes</p>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Bar profile editing and billing aren’t connected yet. Your bar details above are read-only for now, so nothing here can accidentally change the live menu.</p>
      </section>
    </div>
  );
}
