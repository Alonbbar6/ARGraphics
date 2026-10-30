import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListQrCodesQueryKey, useCreateQrCodes, useDeleteQrCode, useGetPartnerProfile, useGetSession, useListDisplays,
  useListQrCodes, useListTableCards, useUpdateQrCode, type Display, type Placement, type QrCode as QrCodeRecord, type TableCard,
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
function MenuLinkCard({ slug, venueName }: { slug: string; venueName: string }) {
  const url = `${publicOrigin()}/b/${encodeURIComponent(slug)}`;
  const [copied, setCopied] = useState(false);
  const [printing, setPrinting] = useState(false);
  const printWindowCard = async () => {
    setPrinting(true);
    try {
      const pdf = await createQrPrintPdf('window', venueName, [{ label: 'Scan for the menu in 3D', url, displayTitle: null }]);
      pdf.save(`${fileSafe(venueName)}-window-card.pdf`);
    } catch (error) {
      toast({ title: 'Could not make the card', description: error instanceof Error ? error.message : 'Try again.' });
    } finally {
      setPrinting(false);
    }
  };
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
    <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-border bg-card px-5 py-4 sm:flex-row sm:items-center" data-testid="card-menu-link">
      {/* On a phone the text takes the full width and the buttons drop underneath; side by side needs a wider screen. */}
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Your guest page, no code needed</p>
        <p className="mt-1 break-all text-sm text-muted-foreground sm:truncate">
          <a href={url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">{url}</a>
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Guests open it from your Instagram bio, Google listing or a table tent and place any item on their table in AR. Printed codes still point to a specific spot.</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
        <Button onClick={() => void copy()} variant="ghost" data-testid="button-copy-menu-link">{copied ? 'Copied' : 'Copy link'}</Button>
        <Button onClick={() => void printWindowCard()} loading={printing} icon={FileDown} data-testid="button-print-window-card">Window card</Button>
      </div>
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
  const cards = useListTableCards();
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
      const pdf = await createQrPrintPdf(template, venueName, list.map((qr) => ({ label: qr.label, url: codeUrl(qr), displayTitle: printTitle(qr.displayTitles) })));
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
      {session.data?.barSlug ? <MenuLinkCard slug={session.data.barSlug} venueName={venueName} /> : null}
      <PageHeader
        title="Codes on every table"
        lede={list.length ? <>Every code counts its own scans and redemptions. This week: <strong className="font-semibold text-foreground">{countLabel(scans, 'scan')}</strong>, <strong className="font-semibold text-foreground">{countLabel(walkIns, 'redemption')}</strong>{busiest && busiest.scansThisWeek > 0 ? <>, and {busiest.label} is your busiest spot ({share(busiest.scansThisWeek, scans)}% of scans).</> : '.'}</> : 'One code per window, counter, table or poster. Customers scan it with their phone camera and see what you put there.'}
        actions={<Button variant="primary" icon={Plus} onClick={() => setAdding(true)} data-testid="button-add-spots">Add spots</Button>}
      />

      <CardArtMarkers codes={list} cards={cards.data ?? []} onAssigned={() => void refresh()} />

      {adding && <AddSpots displays={displays.data ?? []} cards={cards.data ?? []} onClose={() => setAdding(false)} onCreated={() => { setAdding(false); void refresh(); }} />}

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
            <QrTile key={qr.id} qr={qr} venueName={venueName} displays={displays.data ?? []} cards={cards.data ?? []} editing={editing === qr.id} onEdit={() => setEditing(qr.id)} onDone={() => { setEditing(null); void refresh(); }} onRetire={() => setRetiring(qr)} />
          ))}
        </ul>
      )}

      <ConfirmDialog open={retiring !== null} onOpenChange={(open) => { if (!open) setRetiring(null); }} title={`Retire ${retiring?.label ?? 'this code'}?`} confirmLabel="Retire code" busy={deleteCode.isPending} onConfirm={retire}>
        The printed code stops working and its scan count is no longer tracked. Moving a table? Rename or relink it instead.
      </ConfirmDialog>
    </div>
  );
}

/**
 * The printed card designs the app can track. A code printed on a registered card makes
 * content stand on the card and follow it when a guest picks it up; codes on no card fall
 * back to the table surface. Lives at the top of QR Codes.
 */
function CardArtMarkers({ codes, cards, onAssigned }: { codes: QrCodeRecord[]; cards: TableCard[]; onAssigned: () => void }) {
  const updateCode = useUpdateQrCode();
  const [assigning, setAssigning] = useState(false);
  const active = cards.filter((card) => card.isActive);
  const unlinked = codes.filter((code) => code.anchor !== 'card');
  const [bulkCard, setBulkCard] = useState(active[0]?.id ?? '');
  const chosen = active.find((card) => card.id === bulkCard) ?? active[0];

  // Puts every code that isn't on a card yet onto the chosen design.
  const assignAll = async () => {
    if (!chosen || !unlinked.length) return;
    setAssigning(true);
    try {
      await Promise.all(unlinked.map((code) => updateCode.mutateAsync({ id: code.id, data: { anchor: 'card', tableCardId: chosen.id } })));
      toast({ title: `${countLabel(unlinked.length, 'code')} on “${chosen.name}”`, description: 'Scans now stand on the card and follow it when it moves.' });
      onAssigned();
    } catch {
      toast({ title: 'Some codes didn’t update', description: 'Try again.', variant: 'destructive' });
    } finally {
      setAssigning(false);
    }
  };

  return (
    <section className="pa-card mb-6 p-4 sm:p-5" aria-labelledby="card-art-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h2 id="card-art-heading" className="text-base font-semibold">Your printed cards</h2>
          <p className="text-xs text-muted-foreground">Upload a flat photo of each card design with its width. Codes printed on a registered card make the app stand things on the card itself, and follow it when guests pick it up.</p>
          {cards.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{countLabel(cards.length, 'card')} saved · {active.length} active in the app{codes.length ? ` · ${unlinked.length ? `${countLabel(unlinked.length, 'code')} not on a card yet` : 'every code is on a card'}` : ''}</p>}
        </div>
        {cards.length > 0 && (
          <ul className="flex shrink-0 gap-2" aria-label="Saved card art">
            {cards.slice(0, 4).map((card) => (
              <li key={card.id}><img src={card.referenceImageUrl} alt={card.name} className="h-12 w-12 rounded-lg border border-border bg-muted object-cover" loading="lazy" /></li>
            ))}
          </ul>
        )}
        <Link href="/table-cards" className={buttonClass('ghost', 'sm', 'shrink-0')}>
          {cards.length ? <>Manage cards <ArrowRight size={14} aria-hidden="true" /></> : <><ImageIcon size={15} aria-hidden="true" /> Add a card</>}
        </Link>
      </div>
      {active.length > 0 && unlinked.length > 0 && (
        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center" data-testid="panel-assign-cards">
          <p className="text-sm sm:flex-1">Make the {countLabel(unlinked.length, 'code')} not on a card stand on</p>
          {active.length > 1 ? (
            <select className={`${inputClass} sm:w-56`} value={chosen?.id ?? ''} onChange={(event) => setBulkCard(event.target.value)} aria-label="Card design">
              {active.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}
            </select>
          ) : <span className="text-sm font-semibold">“{chosen?.name}”</span>}
          <Button size="sm" loading={assigning} onClick={() => void assignAll()} data-testid="button-assign-cards">Put them on this card</Button>
        </div>
      )}
    </section>
  );
}

type Anchor = QrCodeRecord['anchor'];
type AnchorValue = { anchor: Anchor; qrWidthCm: string; tableCardId: string };

/** What a code's content stands on; the tile and PDF describe it the same way. */
export function anchorLabel(anchor: Anchor, cardName?: string | null) {
  switch (anchor) {
    case 'qr': return 'Stands on the QR code · follows it';
    case 'card': return cardName ? `Stands on “${cardName}” · follows the card` : 'Stands on the card';
    default: return 'Stands on the table';
  }
}

/**
 * What the app anchors to when this code is scanned. The QR code itself is the default: the
 * app tracks the printed code as an image, so content stands on it and follows it when the
 * card is moved. Needs the printed size of the QR to render at true scale.
 */
function AnchorPicker({ cards, value, onChange }: { cards: TableCard[]; value: AnchorValue; onChange: (value: AnchorValue) => void }) {
  const activeCards = cards.filter((card) => card.isActive || card.id === value.tableCardId);
  const options: { value: Anchor; label: string }[] = [
    { value: 'qr', label: 'The QR code' },
    ...(activeCards.length ? [{ value: 'card' as const, label: 'The card design' }] : []),
    { value: 'surface', label: 'The table' },
  ];
  return (
    <div className="space-y-2">
      <SegmentedControl label="What it stands on" size="sm" value={value.anchor} onChange={(anchor) => onChange({ ...value, anchor })} options={options} />
      {value.anchor === 'qr' && (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Printed QR width</span>
          <input type="number" min="1" max="100" step="0.1" value={value.qrWidthCm} onChange={(event) => onChange({ ...value, qrWidthCm: event.target.value })} className={`${inputClass} w-24`} aria-label="Printed QR width in centimetres" data-testid="input-qr-width" />
          <span className="text-muted-foreground">cm, white border included</span>
        </label>
      )}
      {value.anchor === 'card' && (
        <select className={inputClass} value={value.tableCardId} onChange={(event) => onChange({ ...value, tableCardId: event.target.value })} data-testid="select-table-card">
          <option value="">Choose a card design</option>
          {activeCards.map((card) => <option key={card.id} value={card.id}>{card.name}{card.isActive ? '' : ' (off)'}</option>)}
        </select>
      )}
      <p className="text-xs text-muted-foreground">
        {value.anchor === 'qr' ? 'The app tracks the printed code itself. Measure the QR on your card, white border included, so it renders at true size.'
          : value.anchor === 'card' ? 'The app tracks the whole card design you uploaded. Good when the QR is small or glossy.'
          : 'The app finds the nearest table or wall. Content won’t follow the card.'}
      </p>
    </div>
  );
}

/** Request fields for an anchor choice; an unchosen card design falls back to the QR code. */
function anchorPayload(value: AnchorValue) {
  const qrWidthCm = Math.min(100, Math.max(1, Number(value.qrWidthCm) || 4));
  if (value.anchor === 'card' && !value.tableCardId) return { anchor: 'qr' as const, qrWidthCm, tableCardId: null };
  return { anchor: value.anchor, qrWidthCm, tableCardId: value.anchor === 'card' ? value.tableCardId : null };
}

function QrTile({ qr, venueName, displays, cards, editing, onEdit, onDone, onRetire }: {
  qr: QrCodeRecord;
  venueName: string;
  displays: Display[];
  cards: TableCard[];
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
        {editing ? <EditCode qr={qr} displays={displays} cards={cards} onDone={onDone} /> : (
          <>
            <p className="flex items-center gap-1.5 text-sm font-semibold"><PlacementIcon size={14} aria-hidden="true" /><span className="truncate">{qr.label}</span></p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground" title={qr.displayTitles.join(', ')}>{showsLabel(qr.displayTitles)}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{anchorLabel(qr.anchor, qr.tableCardName)}</p>
            <p className="mt-2 text-xs tabular-nums"><span className="font-semibold">{formatCount(qr.scansThisWeek)}</span> <span className="text-muted-foreground">{plural(qr.scansThisWeek, 'scan')} ·</span> <span className="font-semibold">{formatCount(qr.redemptionsThisWeek)}</span> <span className="text-muted-foreground">{plural(qr.redemptionsThisWeek, 'redemption')}</span></p>
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

/** How the tile and print describe what a code shows. */
export function showsLabel(titles: string[]) {
  if (titles.length === 0) return 'Shows everything live';
  if (titles.length <= 2) return `Shows ${titles.join(' and ')}`;
  return `Shows ${titles[0]}, ${titles[1]} and ${titles.length - 2} more`;
}

/** The headline for a printed code: one display's name, or a short menu. */
export function printTitle(titles: string[]) {
  if (titles.length === 0) return null;
  if (titles.length === 1) return titles[0];
  return titles.length <= 3 ? titles.join(' · ') : `${titles.slice(0, 3).join(' · ')} + ${titles.length - 3} more`;
}

type ShowsMode = 'all' | 'one' | 'some';

/**
 * What a code shows: everything live, one display, or a hand-picked few. Picks keep the
 * order they were ticked in, which is the order guests see them.
 */
function DisplayPicker({ displays, value, onChange, compact = false }: { displays: Display[]; value: string[]; onChange: (value: string[]) => void; compact?: boolean }) {
  const [mode, setMode] = useState<ShowsMode>(() => value.length > 1 ? 'some' : value.length === 1 ? 'one' : 'all');
  const choices = displays.filter((display) => display.status !== 'paused');
  const switchMode = (next: ShowsMode) => {
    setMode(next);
    if (next === 'all') onChange([]);
    else if (next === 'one') onChange(value.slice(0, 1));
  };
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((entry) => entry !== id) : [...value, id]);
  return (
    <div className="space-y-2">
      <SegmentedControl label="What they show" size="sm" value={mode} onChange={switchMode} options={[{ value: 'all', label: 'Everything live' }, { value: 'one', label: 'One display' }, { value: 'some', label: 'Pick several' }]} />
      {mode === 'one' && (
        <select className={inputClass} value={value[0] ?? ''} onChange={(event) => onChange(event.target.value ? [event.target.value] : [])} data-testid="select-display">
          <option value="">Choose a display</option>
          {choices.map((display) => <option key={display.id} value={display.id}>{display.title}{display.status === 'draft' ? ' (draft)' : ''}</option>)}
        </select>
      )}
      {mode === 'some' && (
        choices.length === 0 ? <p className="text-xs text-muted-foreground">Add a display first.</p> : (
          <ul className={`space-y-1 overflow-y-auto rounded-xl border border-border bg-background p-1.5 ${compact ? 'max-h-40' : 'max-h-64'}`} aria-label="Displays this code shows" data-testid="list-display-picks">
            {choices.map((display) => {
              const position = value.indexOf(display.id);
              return (
                <li key={display.id}>
                  <label className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm hover:bg-muted">
                    <input type="checkbox" checked={position >= 0} onChange={() => toggle(display.id)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                    <span className="min-w-0 flex-1 truncate">{display.title}{display.status === 'draft' ? <span className="text-muted-foreground"> (draft)</span> : null}</span>
                    {position >= 0 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{position + 1}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        )
      )}
      {mode === 'some' && value.length === 1 && <p className="text-xs text-muted-foreground">Tick at least one more, or guests go straight to {displays.find((display) => display.id === value[0])?.title ?? 'that display'}.</p>}
    </div>
  );
}

function EditCode({ qr, displays, cards, onDone }: { qr: QrCodeRecord; displays: Display[]; cards: TableCard[]; onDone: () => void }) {
  const updateCode = useUpdateQrCode();
  const [label, setLabel] = useState(qr.label);
  const [placement, setPlacement] = useState<Placement>(qr.placement);
  const [displayIds, setDisplayIds] = useState<string[]>(qr.displayIds);
  const [anchor, setAnchor] = useState<AnchorValue>({ anchor: qr.anchor, qrWidthCm: String(qr.qrWidthCm), tableCardId: qr.tableCardId ?? '' });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!label.trim()) return;
    updateCode.mutate({ id: qr.id, data: { label: label.trim().slice(0, 40), placement, displayIds, ...anchorPayload(anchor) } }, {
      onSuccess: () => { toast({ title: 'Code updated', description: 'The printed code stays the same. No need to reprint.' }); onDone(); },
      onError: () => toast({ title: 'That didn’t save', description: 'Try again.', variant: 'destructive' }),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-2.5">
      <Field label="Label"><input className={inputClass} value={label} maxLength={40} onChange={(event) => setLabel(event.target.value)} required /></Field>
      <Field label="Where"><select className={inputClass} value={placement} onChange={(event) => setPlacement(event.target.value as Placement)}>{PLACEMENTS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></Field>
      <div><p className="mb-1.5 text-sm font-medium">Shows</p><DisplayPicker displays={displays} value={displayIds} onChange={setDisplayIds} compact /></div>
      <div><p className="mb-1.5 text-sm font-medium">Stands on</p><AnchorPicker cards={cards} value={anchor} onChange={setAnchor} /></div>
      <div className="flex gap-2 pt-1">
        <Button type="submit" size="sm" loading={updateCode.isPending} className="flex-1">Save</Button>
        <Button variant="quiet" size="sm" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function AddSpots({ displays, cards, onClose, onCreated }: { displays: Display[]; cards: TableCard[]; onClose: () => void; onCreated: () => void }) {
  const createCodes = useCreateQrCodes();
  const [mode, setMode] = useState<'numbered' | 'custom'>('numbered');
  const [prefix, setPrefix] = useState('Table');
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('12');
  const [custom, setCustom] = useState('');
  const [placement, setPlacement] = useState<Placement>('table');
  const [displayIds, setDisplayIds] = useState<string[]>(() => {
    const preset = new URLSearchParams(window.location.search).get('display');
    return preset ? [preset] : [];
  });
  const [anchor, setAnchor] = useState<AnchorValue>({ anchor: 'qr', qrWidthCm: '4', tableCardId: '' });
  const [error, setError] = useState('');

  const labels = useMemo(() => mode === 'numbered' ? numberedLabels(prefix, Number(from), Number(to)) : parseLabelList(custom), [mode, prefix, from, to, custom]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!labels.length) { setError('Add at least one spot.'); return; }
    createCodes.mutate({ data: { labels, placement, displayIds, ...anchorPayload(anchor) } }, {
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
        <div>
          <p className="mb-1.5 text-sm font-medium">What they show</p>
          <DisplayPicker displays={displays} value={displayIds} onChange={setDisplayIds} />
          <p className="mt-1 text-xs text-muted-foreground">One display opens straight away. Several give guests a short menu to pick from, in the order you tick them. Everything live lists whatever's on tonight.</p>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">What it stands on</p>
          <AnchorPicker cards={cards} value={anchor} onChange={setAnchor} />
        </div>
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

