import { lazy, Suspense, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { getListDisplaysQueryKey, useDeleteDisplay, useListDisplays, useUpdateDisplay, type Display } from '@workspace/api-client-react';
import { Box, LayoutGrid, Palette, Pause, Pencil, Play, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Badge, Button, buttonClass, ConfirmDialog, EmptyState, ErrorPanel, PageHeader, SegmentedControl, Skeleton, StatusBadge } from '@/components/partner-ui';
import { DisplayThumb, PLACEMENT_ICONS, TYPE_ICONS } from '@/components/display-parts';
import { formatPrice, placementLabel, typeLabel } from '@/lib/display-draft';
import type { ShelfItem } from '@/components/shelf/ModelShelf';

// Three.js and the shelf load only when the 3D view is on screen.
const ModelShelf = lazy(() => import('@/components/shelf/ModelShelf').then((m) => ({ default: m.ModelShelf })));

type View = 'shelf' | 'grid';
const VIEW_KEY = 'argraphics-displays-view';

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'shelf';
  } catch {
    return 'shelf';
  }
}

const STATUS_LABEL: Record<Display['status'], string> = { live: 'Live', draft: 'Draft', paused: 'Paused' };

/** What each display puts on the shelf: its AR model, or its image standing in for one. */
function shelfItem(display: Display): ShelfItem {
  const stats = `${countLabel(display.scansThisWeek, 'scan')} · ${countLabel(display.redemptionsThisWeek, 'redemption')} this week`;
  return {
    id: display.id,
    name: display.title,
    subtitle: `${STATUS_LABEL[display.status]} · ${typeLabel(display.type)} · ${placementLabel(display.placement)}`,
    priceLabel: display.drink ? formatPrice(display.drink.priceCents) : null,
    glbUrl: display.drink?.modelGlbUrl ?? display.artwork?.modelGlbUrl ?? null,
    posterUrl: display.mediaUrl ?? display.drink?.thumbnailUrl ?? null,
    statLabel: stats,
  };
}
import { countLabel, formatCount, plural } from '@/lib/traffic';
import { toast } from '@/hooks/use-toast';
import { EASE_OUT, Flip, gsap, prefersReducedMotion, registerFlip } from '@/lib/motion';

type Filter = 'all' | 'live' | 'draft' | 'paused';

export function DisplaysPage() {
  const queryClient = useQueryClient();
  const displays = useListDisplays();
  const updateDisplay = useUpdateDisplay();
  const deleteDisplay = useDeleteDisplay();
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<View>(readView);
  const [pendingDelete, setPendingDelete] = useState<Display | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, setLocation] = useLocation();

  const list = displays.data ?? [];
  const shown = useMemo(() => list.filter((display) => filter === 'all' || display.status === filter), [list, filter]);
  const shelfItems = useMemo(() => shown.map(shelfItem), [shown]);
  const changeView = (next: View) => {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* private mode */ }
  };
  const scans = list.reduce((sum, display) => sum + display.scansThisWeek, 0);
  const walkIns = list.reduce((sum, display) => sum + display.redemptionsThisWeek, 0);
  const liveCount = list.filter((display) => display.status === 'live').length;
  const gridRef = useRef<HTMLUListElement>(null);
  useFilteredGrid(gridRef, filter, `${view}|${list.map((display) => `${display.id}:${display.status}`).join(',')}`);

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListDisplaysQueryKey() });

  const toggle = (display: Display) => {
    const status = display.status === 'live' ? 'paused' : 'live';
    setBusyId(display.id);
    updateDisplay.mutate({ id: display.id, data: { status } }, {
      onSuccess: () => {
        void refresh();
        toast({ title: status === 'live' ? `${display.title} is live` : `${display.title} is paused`, description: status === 'live' ? 'Guests who scan will see it right away.' : 'Guests won’t see it until you resume.' });
      },
      onError: () => toast({ title: 'That didn’t save', description: 'Check your connection and try again.', variant: 'destructive' }),
      onSettled: () => setBusyId(null),
    });
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    deleteDisplay.mutate({ id: target.id }, {
      onSuccess: () => {
        setPendingDelete(null);
        void refresh();
        toast({ title: `${target.title} deleted`, description: 'Codes that pointed to it now show your other live displays.' });
      },
      onError: () => toast({ title: 'Couldn’t delete that display', description: 'Try again in a moment.', variant: 'destructive' }),
    });
  };

  return (
    <div className="rise">
      <PageHeader
        title="What guests see in your room"
        lede={list.length ? <><strong className="font-semibold text-foreground">{countLabel(scans, 'scan')}</strong> and <strong className="font-semibold text-foreground">{countLabel(walkIns, 'redemption')}</strong> this week across {liveCount} live {plural(liveCount, 'display')}.</> : 'Each display is something people can only see when they’re in your room.'}
        actions={<>
          <Link href="/gallery" className={buttonClass('ghost')} data-testid="link-gallery"><Palette size={16} aria-hidden="true" /> Local artists</Link>
          <Link href="/drinks" className={buttonClass('ghost')}><Box size={16} aria-hidden="true" /> 3D menu library</Link>
          <Link href="/displays/new" className={buttonClass('hero')} data-testid="button-new-display"><Plus size={17} aria-hidden="true" /> Create AR display</Link>
        </>}
      />

      {list.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            label="Filter displays"
            className="max-w-md"
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `All ${list.length}` },
              { value: 'live', label: 'Live' },
              { value: 'draft', label: 'Drafts' },
              { value: 'paused', label: 'Paused' },
            ]}
          />
          <SegmentedControl
            label="View"
            size="sm"
            value={view}
            onChange={changeView}
            options={[
              { value: 'shelf', label: '3D', icon: Box },
              { value: 'grid', label: 'List', icon: LayoutGrid },
            ]}
          />
        </div>
      )}

      {displays.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((key) => <Skeleton key={key} className="h-72" />)}</div>
      ) : displays.isError ? (
        <ErrorPanel title="Your displays didn’t load." onRetry={() => void displays.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState icon={Sparkles} title="Your first display takes five minutes." action={<Link href="/displays/new" className={buttonClass('primary')}><Plus size={17} aria-hidden="true" /> Start with a slow night</Link>}>
          Snap a dish, add an offer or hang a local artist’s piece. Print a code, put it where people look, and watch the scans and redemptions come in.
        </EmptyState>
      ) : view === 'shelf' ? (
        shelfItems.length === 0 ? (
          <p className="rise rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nothing {filter === 'draft' ? 'in drafts' : filter} right now.</p>
        ) : (
          <section aria-label="Your displays in 3D" className="rise">
            <Suspense fallback={<Skeleton className="aspect-[16/8.5] w-full rounded-2xl" />}>
              <ModelShelf
                key={filter}
                items={shelfItems}
                label="Your displays in 3D"
                size="tall"
                selectLabel="Edit display"
                onSelect={(item) => setLocation(`/displays/${item.id}`)}
              />
            </Suspense>
            <p className="mt-2 hidden text-xs text-muted-foreground sm:block">Swipe, drag or use the arrow keys to browse. Drag the front one to turn it. Choose it to edit.</p>
          </section>
        )
      ) : (
        <>
          {/* Every card stays mounted; useFilteredGrid hides the ones outside the filter so leavers can animate out. */}
          <ul ref={gridRef} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((display) => <DisplayCard key={display.id} display={display} busy={busyId === display.id} onToggle={() => toggle(display)} onDelete={() => setPendingDelete(display)} />)}
          </ul>
          {shown.length === 0 && (
            <p className="rise rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nothing {filter === 'draft' ? 'in drafts' : filter} right now.</p>
          )}
        </>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title={`Delete ${pendingDelete?.title ?? 'this display'}?`}
        confirmLabel="Delete display"
        busy={deleteDisplay.isPending}
        onConfirm={confirmDelete}
      >
        Guests won’t see it anymore and its scan history stops growing. Printed codes keep working and show your other live displays. If you just want a break, pause it instead.
      </ConfirmDialog>
    </div>
  );
}

/**
 * Cards settle into place when the filter (or a card's status) changes: the ones that stay
 * slide to their new spot, leavers fade out, newcomers rise in. The effect owns each card's
 * `hidden` flag so the old layout can be measured before anything moves. First paint and
 * reduced motion just set visibility.
 */
function useFilteredGrid(gridRef: RefObject<HTMLUListElement | null>, filter: Filter, signature: string) {
  const first = useRef(true);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    registerFlip();
    const cards = Array.from(grid.querySelectorAll<HTMLLIElement>('[data-flip-id]'));
    const show = (card: HTMLLIElement) => filter === 'all' || card.dataset.status === filter;
    const instant = first.current || prefersReducedMotion();
    const wasFirst = first.current;
    first.current = false;
    if (instant) {
      cards.forEach((card) => { card.hidden = !show(card); });
      if (wasFirst && !prefersReducedMotion()) {
        const ctx = gsap.context(() => {
          gsap.from(cards.filter(show), { opacity: 0, y: 8, duration: 0.35, stagger: 0.04, ease: EASE_OUT, clearProps: 'all' });
        }, grid);
        return () => ctx.revert();
      }
      return;
    }
    const ctx = gsap.context(() => {
      const state = Flip.getState(cards);
      cards.forEach((card) => { card.hidden = !show(card); });
      Flip.from(state, {
        duration: 0.4,
        ease: EASE_OUT,
        stagger: 0.02,
        absolute: true,
        onEnter: (entering) => gsap.fromTo(entering, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.3, ease: EASE_OUT, stagger: 0.03, clearProps: 'opacity,transform' }),
        onLeave: (leaving) => gsap.to(leaving, { opacity: 0, y: -6, duration: 0.2, ease: 'power2.in' }),
      });
    }, grid);
    return () => ctx.revert();
  }, [gridRef, filter, signature]);
}

function DisplayCard({ display, busy, onToggle, onDelete }: { display: Display; busy: boolean; onToggle: () => void; onDelete: () => void }) {
  const TypeIcon = TYPE_ICONS[display.type];
  const PlacementIcon = PLACEMENT_ICONS[display.placement];
  return (
    <li className="pa-card flex flex-col overflow-hidden" data-flip-id={display.id} data-status={display.status} data-testid={`card-display-${display.id}`}>
      <DisplayThumb display={display} addImageHref={`/displays/${display.id}`} className="h-36">
        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5"><StatusBadge status={display.status} />{display.offer && <Badge tone="offer">Offer</Badge>}</div>
      </DisplayThumb>
      <div className="flex flex-1 flex-col p-4">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <TypeIcon size={13} aria-hidden="true" />{typeLabel(display.type)}
          <span aria-hidden="true">·</span>
          <PlacementIcon size={13} aria-hidden="true" />{placementLabel(display.placement)}
        </p>
        <h2 className="mt-1 truncate text-base font-semibold">{display.title}</h2>
        {display.offer && <p className="mt-0.5 truncate text-xs text-muted-foreground">{display.offer.title}</p>}
        <dl className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-border p-3">
          <div><dt className="text-[11px] text-muted-foreground">{plural(display.scansThisWeek, 'Scan')} this week</dt><dd className="text-2xl font-light tabular-nums">{formatCount(display.scansThisWeek)}</dd></div>
          <div><dt className="text-[11px] text-muted-foreground">{plural(display.redemptionsThisWeek, 'Redemption')}</dt><dd className="pa-accent-text text-2xl font-light tabular-nums">{formatCount(display.redemptionsThisWeek)}</dd></div>
        </dl>
        <div className="mt-auto flex items-center gap-1 pt-3">
          <Link href={`/displays/${display.id}`} className={buttonClass('ghost', 'sm', 'flex-1')}><Pencil size={14} aria-hidden="true" /> Edit</Link>
          {display.status !== 'draft' && (
            <Button variant="quiet" size="sm" loading={busy} icon={display.status === 'live' ? Pause : Play} onClick={onToggle} aria-label={`${display.status === 'live' ? 'Pause' : 'Resume'} ${display.title}`}>
              {display.status === 'live' ? 'Pause' : 'Resume'}
            </Button>
          )}
          {display.status === 'draft' && (
            <Button variant="quiet" size="sm" loading={busy} icon={Play} onClick={onToggle} aria-label={`Publish ${display.title}`}>Publish</Button>
          )}
          <Button variant="quiet" size="icon" icon={Trash2} onClick={onDelete} aria-label={`Delete ${display.title}`} />
        </div>
      </div>
    </li>
  );
}
