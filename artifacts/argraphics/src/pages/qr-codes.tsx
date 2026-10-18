import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListQrCodesQueryKey, useCreateQrCodes, useDeleteQrCode, useGetPartnerProfile, useGetSession, useListDisplays,
  useListQrCodes, useListTableCards, useUpdateQrCode, type Display, type Placement, type QrCode as QrCodeRecord,
} from '@workspace/api-client-react';
import { ArrowRight, Download, FileDown, ImageIcon, Pencil, Plus, QrCode, Trash2, X } from 'lucide-react';
import { Button, buttonClass, ConfirmDialog, EmptyState, ErrorPanel, Field, inputClass, PageHeader, SegmentedControl, Skeleton } from '@/components/partner-ui';
import { PLACEMENT_ICONS } from '@/components/display-parts';
import { PLACEMENTS, placementLabel } from '@/lib/display-draft';
import { createQrPrintPdf, fileSafe, numberedLabels, parseLabelList, PRINT_TEMPLATES, qrPngDataUrl, scanUrl, type PrintTemplate } from '@/lib/table-qr';
import { countLabel, formatCount, plural, share } from '@/lib/traffic';
import { toast } from '@/hooks/use-toast';

/**
 * Printed codes must point at an address guests' phones can reach. Prefer the configured
 * public address; fall back to wherever the dashboard was opened.
 */
export function publicOrigin() {
  const configured = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim();
  return configured ? configured.replace(/\/+$/, '') : window.location.origin;
}

/** True when codes would point at this computer only (localhost or a private LAN address). */
export function originIsPrivate(origin: string) {
  return /^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/i.test(origin);
}

/** The code-free guest page: every live item, each placeable in AR. For bios, listings, tents. */
function MenuLinkCard({ slug }: { slug: string }) {
  const url = `${publicOrigin()}/b/${encodeURIComponent(slug)}`;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({ title: 'Copy failed', description: url });
    }
  };
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4" data-testid="card-menu-link">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Your guest page, no code needed</p>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          <a href={url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">{url}</a>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Guests open it from your Instagram bio, Google listing or a table tent and place any item on their table in AR. Printed codes still point to a specific spot.</p>
      </div>
      <Button onClick={() => void copy()} variant="ghost" data-testid="button-copy-menu-link">{copied ? 'Copied' : 'Copy link'}</Button>
    </div>
  );
}

function codeUrl(qr: Pick<QrCodeRecord, 'path'>) {
  return scanUrl(publicOrigin(), qr.path);
}

export function QrCodesPage() {
  const queryClient = useQueryClient();
  const session = useGetSession();
  const profile = useGetPartnerProfile();
  const codes = useListQrCodes();
  const displays = useListDisplays();
  const deleteCode = useDeleteQrCode();
  const [adding, setAdding] = useState(() => new URLSearchParams(window.location.search).has('display'));
  const [template, setTemplate] = useState<PrintTemplate>('tent');
  const [printing, setPrinting] = useState(false);
  const [retiring, setRetiring] = useState<QrCodeRecord | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const list = codes.data ?? [];
  const venueName = profile.data?.name || session.data?.barName || 'ARGraphics';
  const scans = list.reduce((sum, qr) => sum + qr.scansThisWeek, 0);
  const walkIns = list.reduce((sum, qr) => sum + qr.redemptionsThisWeek, 0);
  const busiest = [...list].sort((a, b) => b.scansThisWeek - a.scansThisWeek)[0];

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListQrCodesQueryKey() });

  const downloadPdf = async () => {
    if (!list.length) return;
    setPrinting(true);
    try {
      const pdf = await createQrPrintPdf(template, venueName, list.map((qr) => ({ label: qr.label, url: codeUrl(qr), displayTitle: qr.displayTitle })));
      pdf.save(`${fileSafe(venueName)}-${template}-codes.pdf`);
      toast({ title: 'Your print file is ready', description: `${countLabel(list.length, PRINT_TEMPLATES.find((t) => t.value === template)?.label.toLowerCase() ?? 'code')}. Print at 100% scale.` });
    } catch (error) {
      toast({ title: 'Couldn’t make the PDF', description: error instanceof Error ? error.message : 'Try again.', variant: 'destructive' });
    } finally {
      setPrinting(false);
    }
  };

  const retire = () => {
    if (!retiring) return;
    const target = retiring;
    deleteCode.mutate({ id: target.id }, {
      onSuccess: () => { setRetiring(null); void refresh(); toast({ title: `${target.label} retired`, description: 'Take the printed code off the table; it no longer opens anything.' }); },
      onError: () => toast({ title: 'Couldn’t retire that code', description: 'Try again in a moment.', variant: 'destructive' }),
    });
  };

  return (
    <div className="rise">
      {originIsPrivate(publicOrigin()) ? (
        <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm" role="status" data-testid="warning-private-origin">
          <p className="font-semibold">These codes point at {publicOrigin()}, which only works on this network.</p>
          <p className="mt-1 text-muted-foreground">Before printing, open the dashboard from your public address (for example the tunnel URL) so guests' phones can reach it.</p>
        </div>
      ) : null}
      {session.data?.barSlug ? <MenuLinkCard slug={session.data.barSlug} /> : null}
      <PageHeader
        title="Codes on every table"
        lede={list.length ? <>Every code counts its own scans and walk-ins. This week: <strong className="font-semibold text-foreground">{countLabel(scans, 'scan')}</strong>, <strong className="font-semibold text-foreground">{countLabel(walkIns, 'walk-in')}</strong>{busiest && busiest.scansThisWeek > 0 ? <>, and {busiest.label} is your busiest spot ({share(busiest.scansThisWeek, scans)}% of scans).</> : '.'}</> : 'One code per table, window or poster. Guests scan it with their phone camera and see what you put there.'}
        actions={<Button variant="primary" icon={Plus} onClick={() => setAdding(true)} data-testid="button-add-spots">Add spots</Button>}
      />

      <CardArtMarkers />

      {adding && <AddSpots displays={displays.data ?? []} onClose={() => setAdding(false)} onCreated={() => { setAdding(false); void refresh(); }} />}

      {list.length > 0 && (
        <section className="pa-card mb-6 p-4 sm:p-5" aria-labelledby="print-heading">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <h2 id="print-heading" className="text-base font-semibold">Print-ready PDF</h2>
              <p className="mb-3 text-xs text-muted-foreground">{PRINT_TEMPLATES.find((t) => t.value === template)?.size}. {PRINT_TEMPLATES.find((t) => t.value === template)?.note}</p>
              <SegmentedControl label="Print template" value={template} onChange={setTemplate} options={PRINT_TEMPLATES.map((t) => ({ value: t.value, label: t.label }))} />
            </div>
            <Button variant="primary" icon={FileDown} loading={printing} loadingText="Making your PDF…" onClick={() => void downloadPdf()} className="w-full lg:w-auto" data-testid="button-download-pdf">
              Download print-ready PDF
            </Button>
          </div>
        </section>
      )}

      {codes.isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{[0, 1, 2, 3].map((key) => <Skeleton key={key} className="h-72" />)}</div>
      ) : codes.isError ? (
        <ErrorPanel title="Your codes didn’t load." onRetry={() => void codes.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState icon={QrCode} title="No codes out yet." action={<Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add your tables</Button>}>
          Add a code for each table, plus one for the front window. Print them, set them out before the dinner rush, and the scans start counting.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {list.map((qr) => (
            <QrTile key={qr.id} qr={qr} venueName={venueName} displays={displays.data ?? []} editing={editing === qr.id} onEdit={() => setEditing(qr.id)} onDone={() => { setEditing(null); void refresh(); }} onRetire={() => setRetiring(qr)} />
          ))}
        </ul>
      )}

      <ConfirmDialog open={retiring !== null} onOpenChange={(open) => { if (!open) setRetiring(null); }} title={`Retire ${retiring?.label ?? 'this code'}?`} confirmLabel="Retire code" busy={deleteCode.isPending} onConfirm={retire}>
        The printed code stops working and its scan count is no longer tracked. Moving a table? Rename or relink it instead.
      </ConfirmDialog>
    </div>
  );
}

/** Printed artwork the app recognizes in place of a code. Lives at the top of QR Codes. */
function CardArtMarkers() {
  const cards = useListTableCards();
  const list = cards.data ?? [];
  const active = list.filter((card) => card.isActive).length;
  return (
    <section className="pa-card mb-6 p-4 sm:p-5" aria-labelledby="card-art-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h2 id="card-art-heading" className="text-base font-semibold">Card art markers</h2>
          <p className="text-xs text-muted-foreground">Upload printed art the app can anchor content to, for tables without a code.</p>
          {list.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{countLabel(list.length, 'card')} saved · {active} active in the app</p>}
        </div>
        {list.length > 0 && (
          <ul className="flex shrink-0 gap-2" aria-label="Saved card art">
            {list.slice(0, 4).map((card) => (
              <li key={card.id}><img src={card.referenceImageUrl} alt={card.name} className="h-12 w-12 rounded-lg border border-border bg-muted object-cover" loading="lazy" /></li>
            ))}
          </ul>
        )}
        <Link href="/table-cards" className={buttonClass('ghost', 'sm', 'shrink-0')}>
          {list.length ? <>Manage card art <ArrowRight size={14} aria-hidden="true" /></> : <><ImageIcon size={15} aria-hidden="true" /> Add card art</>}
        </Link>
      </div>
    </section>
  );
}

function QrTile({ qr, venueName, displays, editing, onEdit, onDone, onRetire }: {
  qr: QrCodeRecord;
  venueName: string;
  displays: Display[];
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onRetire: () => void;
}) {
  const [image, setImage] = useState<string | null>(null);
  const PlacementIcon = PLACEMENT_ICONS[qr.placement];
  let url = '';
  try { url = codeUrl(qr); } catch { url = ''; }

  useEffect(() => {
    let alive = true;
    if (url) void qrPngDataUrl(url, 480).then((data) => { if (alive) setImage(data); });
    return () => { alive = false; };
  }, [url]);

  const downloadPng = async () => {
    if (!url) return;
    const link = document.createElement('a');
    link.href = await qrPngDataUrl(url, 1200);
    link.download = `${fileSafe(venueName)}-${fileSafe(qr.label, 'spot')}.png`;
    link.click();
  };

  return (
    <li className="pa-card flex flex-col overflow-hidden" data-testid={`tile-qr-${qr.id}`}>
      <div className="bg-white p-3">
        {image ? <img src={image} alt={`QR code for ${qr.label}`} className="mx-auto aspect-square w-full max-w-[200px]" /> : <div className="mx-auto aspect-square w-full max-w-[200px] animate-pulse rounded bg-slate-100" aria-hidden="true" />}
      </div>
      <div className="flex flex-1 flex-col p-3.5">
        {editing ? <EditCode qr={qr} displays={displays} onDone={onDone} /> : (
          <>
            <p className="flex items-center gap-1.5 text-sm font-semibold"><PlacementIcon size={14} aria-hidden="true" /><span className="truncate">{qr.label}</span></p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{qr.displayTitle ? `Shows ${qr.displayTitle}` : 'Shows everything live'}</p>
            <p className="mt-2 text-xs tabular-nums"><span className="font-semibold">{formatCount(qr.scansThisWeek)}</span> <span className="text-muted-foreground">{plural(qr.scansThisWeek, 'scan')} ·</span> <span className="font-semibold">{formatCount(qr.redemptionsThisWeek)}</span> <span className="text-muted-foreground">{plural(qr.redemptionsThisWeek, 'walk-in')}</span></p>
            <div className="mt-auto flex items-center gap-1 pt-3">
              <Button variant="ghost" size="sm" icon={Download} onClick={() => void downloadPng()} className="flex-1" aria-label={`Download PNG for ${qr.label}`}>PNG</Button>
              <Button variant="quiet" size="icon" icon={Pencil} onClick={onEdit} aria-label={`Rename or relink ${qr.label}`} />
              <Button variant="quiet" size="icon" icon={Trash2} onClick={onRetire} aria-label={`Retire ${qr.label}`} />
            </div>
          </>
        )}
      </div>
    </li>
  );
}

function DisplaySelect({ displays, value, onChange }: { displays: Display[]; value: string; onChange: (value: string) => void }) {
  return (
    <select className={inputClass} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Everything live at your spot</option>
      {displays.filter((display) => display.status !== 'paused').map((display) => <option key={display.id} value={display.id}>{display.title}{display.status === 'draft' ? ' (draft)' : ''}</option>)}
    </select>
  );
}

function EditCode({ qr, displays, onDone }: { qr: QrCodeRecord; displays: Display[]; onDone: () => void }) {
  const updateCode = useUpdateQrCode();
  const [label, setLabel] = useState(qr.label);
  const [placement, setPlacement] = useState<Placement>(qr.placement);
  const [displayId, setDisplayId] = useState(qr.displayId ?? '');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!label.trim()) return;
    updateCode.mutate({ id: qr.id, data: { label: label.trim().slice(0, 40), placement, displayId: displayId || null } }, {
      onSuccess: () => { toast({ title: 'Code updated', description: 'The printed code stays the same. No need to reprint.' }); onDone(); },
      onError: () => toast({ title: 'That didn’t save', description: 'Try again.', variant: 'destructive' }),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-2.5">
      <Field label="Label"><input className={inputClass} value={label} maxLength={40} onChange={(event) => setLabel(event.target.value)} required /></Field>
      <Field label="Where"><select className={inputClass} value={placement} onChange={(event) => setPlacement(event.target.value as Placement)}>{PLACEMENTS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></Field>
      <Field label="Shows"><DisplaySelect displays={displays} value={displayId} onChange={setDisplayId} /></Field>
      <div className="flex gap-2 pt-1">
        <Button type="submit" size="sm" loading={updateCode.isPending} className="flex-1">Save</Button>
        <Button variant="quiet" size="sm" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function AddSpots({ displays, onClose, onCreated }: { displays: Display[]; onClose: () => void; onCreated: () => void }) {
  const createCodes = useCreateQrCodes();
  const [mode, setMode] = useState<'numbered' | 'custom'>('numbered');
  const [prefix, setPrefix] = useState('Table');
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('12');
  const [custom, setCustom] = useState('');
  const [placement, setPlacement] = useState<Placement>('table');
  const [displayId, setDisplayId] = useState(() => new URLSearchParams(window.location.search).get('display') ?? '');
  const [error, setError] = useState('');

  const labels = useMemo(() => mode === 'numbered' ? numberedLabels(prefix, Number(from), Number(to)) : parseLabelList(custom), [mode, prefix, from, to, custom]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!labels.length) { setError('Add at least one spot.'); return; }
    createCodes.mutate({ data: { labels, placement, displayId: displayId || null } }, {
      onSuccess: (created) => {
        toast({ title: `${countLabel(created.length, 'code')} ready to print`, description: 'Download the PDF below and set them out before service.' });
        onCreated();
      },
      onError: () => setError('Those codes didn’t save. Check your connection and try again.'),
    });
  };

  return (
    <section className="pa-card pa-card-in mb-6 p-4 sm:p-6" aria-labelledby="add-spots-heading">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div><h2 id="add-spots-heading" className="text-lg font-semibold">Add spots</h2><p className="text-xs text-muted-foreground">Up to 60 at a time. Each spot gets its own code and its own count.</p></div>
        <Button variant="quiet" size="icon" icon={X} onClick={onClose} aria-label="Close add spots" />
      </div>
      <form onSubmit={submit} className="space-y-4">
        <SegmentedControl label="How to name them" className="max-w-sm" value={mode} onChange={setMode} options={[{ value: 'numbered', label: 'Numbered' }, { value: 'custom', label: 'Custom names' }]} />
        {mode === 'numbered' ? (
          <div className="grid grid-cols-[1fr_80px_80px] gap-3">
            <Field label="Name"><input className={inputClass} value={prefix} maxLength={30} onChange={(event) => setPrefix(event.target.value)} /></Field>
            <Field label="From"><input className={inputClass} type="number" min={1} value={from} onChange={(event) => setFrom(event.target.value)} inputMode="numeric" /></Field>
            <Field label="To"><input className={inputClass} type="number" min={1} value={to} onChange={(event) => setTo(event.target.value)} inputMode="numeric" /></Field>
          </div>
        ) : (
          <Field label="One per line" hint="Like Front window, Patio 2, Host stand.">
            <textarea className={inputClass} rows={4} value={custom} onChange={(event) => setCustom(event.target.value)} placeholder={'Front window\nPatio 1\nHost stand'} />
          </Field>
        )}
        <div>
          <p className="mb-1.5 text-sm font-medium">Where they go</p>
          <SegmentedControl label="Where they go" value={placement} onChange={setPlacement} options={PLACEMENTS.map((p) => ({ value: p.value, label: p.label, icon: PLACEMENT_ICONS[p.value] }))} />
        </div>
        <Field label="What they show" hint="Pick one display, or let the code show everything live."><DisplaySelect displays={displays} value={displayId} onChange={setDisplayId} /></Field>
        <p className="text-xs text-muted-foreground" aria-live="polite">{labels.length ? `${countLabel(labels.length, 'spot')}: ${labels.slice(0, 4).join(', ')}${labels.length > 4 ? ` … ${labels[labels.length - 1]}` : ''}` : 'No spots yet.'} · {placementLabel(placement)}</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={createCodes.isPending} disabled={!labels.length}>{labels.length ? `Create ${countLabel(labels.length, 'code')}` : 'Create codes'}</Button>
        </div>
      </form>
    </section>
  );
}

