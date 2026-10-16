import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { getListDisplaysQueryKey, useDeleteDisplay, useListDisplays, useUpdateDisplay, type Display } from '@workspace/api-client-react';
import { Box, Pause, Pencil, Play, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Badge, Button, buttonClass, ConfirmDialog, EmptyState, ErrorPanel, PageHeader, SegmentedControl, Skeleton, StatusBadge } from '@/components/partner-ui';
import { DisplayThumb, PLACEMENT_ICONS, TYPE_ICONS } from '@/components/display-parts';
import { placementLabel, typeLabel } from '@/lib/display-draft';
import { formatCount } from '@/lib/traffic';
import { toast } from '@/hooks/use-toast';

type Filter = 'all' | 'live' | 'draft' | 'paused';

export function DisplaysPage() {
  const queryClient = useQueryClient();
  const displays = useListDisplays();
  const updateDisplay = useUpdateDisplay();
  const deleteDisplay = useDeleteDisplay();
  const [filter, setFilter] = useState<Filter>('all');
  const [pendingDelete, setPendingDelete] = useState<Display | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const list = displays.data ?? [];
  const shown = useMemo(() => list.filter((display) => filter === 'all' || display.status === filter), [list, filter]);
  const scans = list.reduce((sum, display) => sum + display.scansThisWeek, 0);
  const walkIns = list.reduce((sum, display) => sum + display.redemptionsThisWeek, 0);
  const liveCount = list.filter((display) => display.status === 'live').length;

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
        eyebrow="Displays"
        title="What guests see in your room"
        lede={list.length ? <><strong className="font-semibold text-foreground">{formatCount(scans)} scans</strong> and <strong className="font-semibold text-foreground">{formatCount(walkIns)} walk-ins</strong> this week across {liveCount} live {liveCount === 1 ? 'display' : 'displays'}.</> : 'Each display is something people can only see when they’re in your room.'}
        actions={<>
          <Link href="/drinks" className={buttonClass('ghost')}><Box size={16} aria-hidden="true" /> 3D menu library</Link>
          <Link href="/displays/new" className={buttonClass('hero')} data-testid="button-new-display"><Plus size={17} aria-hidden="true" /> Create AR display</Link>
        </>}
      />

      {list.length > 0 && (
        <SegmentedControl
          label="Filter displays"
          className="mb-5 max-w-md"
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
      )}

      {displays.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((key) => <Skeleton key={key} className="h-72" />)}</div>
      ) : displays.isError ? (
        <ErrorPanel title="Your displays didn’t load." onRetry={() => void displays.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState icon={Sparkles} title="Your first display takes five minutes." action={<Link href="/displays/new" className={buttonClass('primary')}><Plus size={17} aria-hidden="true" /> Start with a slow night</Link>}>
          Snap a dish, add an offer or hang a local artist’s piece. Print a code, put it on the table, and watch the scans and walk-ins come in.
        </EmptyState>
      ) : shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nothing {filter === 'draft' ? 'in drafts' : filter} right now.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((display, index) => <DisplayCard key={display.id} display={display} index={index} busy={busyId === display.id} onToggle={() => toggle(display)} onDelete={() => setPendingDelete(display)} />)}
        </ul>
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

function DisplayCard({ display, index, busy, onToggle, onDelete }: { display: Display; index: number; busy: boolean; onToggle: () => void; onDelete: () => void }) {
  const TypeIcon = TYPE_ICONS[display.type];
  const PlacementIcon = PLACEMENT_ICONS[display.placement];
  return (
    <li className="pa-card pa-card-in flex flex-col overflow-hidden" style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }} data-testid={`card-display-${display.id}`}>
      <DisplayThumb type={display.type} src={display.mediaUrl || display.drink?.thumbnailUrl} className="h-36">
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5"><StatusBadge status={display.status} />{display.offer && <Badge tone="offer">Offer</Badge>}</div>
      </DisplayThumb>
      <div className="flex flex-1 flex-col p-4">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <TypeIcon size={13} aria-hidden="true" />{typeLabel(display.type)}
          <span aria-hidden="true">·</span>
          <PlacementIcon size={13} aria-hidden="true" />{placementLabel(display.placement)}
        </p>
        <h2 className="mt-1 truncate text-base font-semibold">{display.title}</h2>
        {display.offer && <p className="mt-0.5 truncate text-xs text-[#C2410C] dark:text-[#FDBA74]">{display.offer.title}</p>}
        <dl className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-3">
          <div><dt className="text-[11px] text-muted-foreground">Scans this week</dt><dd className="text-2xl font-light tabular-nums">{formatCount(display.scansThisWeek)}</dd></div>
          <div><dt className="text-[11px] text-muted-foreground">Walk-ins</dt><dd className="text-2xl font-light tabular-nums">{formatCount(display.redemptionsThisWeek)}</dd></div>
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
