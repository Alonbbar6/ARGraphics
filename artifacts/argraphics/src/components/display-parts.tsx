import { createElement, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import type { Display, DisplayType, Placement } from '@workspace/api-client-react';
import { Box, CalendarDays, Frame, ImagePlus, LayoutPanelTop, Palette, PanelsTopLeft, RectangleVertical, Store, Tag, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ensureModelViewer } from '@/lib/model-viewer';
import { formatEventDate, PLACEMENTS } from '@/lib/display-draft';

export const TYPE_ICONS: Record<DisplayType, LucideIcon> = {
  menu_item: Box,
  promo_offer: Tag,
  art_piece: Palette,
  event_teaser: CalendarDays,
};

export const PLACEMENT_ICONS: Record<Placement, LucideIcon> = {
  table: LayoutPanelTop,
  wall: Frame,
  window: PanelsTopLeft,
  poster: RectangleVertical,
};

type ThumbSource = Pick<Display, 'mediaUrl' | 'drink'>;

/**
 * What a display actually looks like: the uploaded photo, else the dish's render
 * (its thumbnail, or the 3D model itself), else a neutral "Add image" state.
 * Pass `addImageHref` to make that empty state a link to the editor; leave it
 * off where the thumbnail already sits inside a link.
 */
export function DisplayThumb({ display, className, children, addImageHref, compact = false }: {
  display: ThumbSource;
  className?: string;
  children?: ReactNode;
  addImageHref?: string;
  compact?: boolean;
}) {
  const photo = display.mediaUrl || display.drink?.thumbnailUrl;
  const model = photo ? null : display.drink?.modelGlbUrl;
  const [modelReady, setModelReady] = useState(false);
  useEffect(() => {
    if (!model) return;
    let alive = true;
    void ensureModelViewer().then(() => { if (alive) setModelReady(true); }).catch(() => undefined);
    return () => { alive = false; };
  }, [model]);

  const empty = (
    <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground">
      <ImagePlus size={compact ? 16 : 20} aria-hidden="true" />
      {!compact && <span className="text-xs font-medium">Add image</span>}
      {compact && <span className="sr-only">Add image</span>}
    </span>
  );

  return (
    <div className={cn('pa-thumb relative overflow-hidden', className)}>
      {photo ? <img src={photo} alt="" className="absolute inset-0 h-full w-full object-contain object-center p-3" loading="lazy" />
        : model ? (modelReady ? createElement('model-viewer', { src: model, alt: '', 'environment-image': 'neutral', 'shadow-intensity': '0.6', 'interaction-prompt': 'none', loading: 'lazy', reveal: 'auto', 'aria-hidden': 'true' }) : null)
        : addImageHref ? <Link href={addImageHref} className="absolute inset-0 hover:bg-foreground/5">{empty}</Link>
        : empty}
      {children}
    </div>
  );
}

export type GuestPreviewProps = {
  venueName: string;
  type: DisplayType | null;
  placement: Placement;
  title: string;
  description: string;
  imageUrl: string | null;
  price?: string | null;
  offerTitle?: string;
  offerDetails?: string;
  offerEndsAt?: string | null;
  eventStartsAt?: string | null;
  artistName?: string;
};

function countdown(iso: string | null | undefined) {
  if (!iso) return 'Tonight only';
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'Ended';
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 48) return `Ends in ${Math.floor(hours / 24)} days`;
  if (hours >= 1) return `Ends in ${hours}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
  return `Ends in ${Math.max(1, Math.floor(ms / 60_000))}m`;
}

/** What a guest sees in the ARGraphics app after scanning: camera view, the piece, one sheet. */
export function GuestPreview(props: GuestPreviewProps) {
  const hint = PLACEMENTS.find((placement) => placement.value === props.placement)?.guestHint ?? 'Point at the table';
  const Icon = props.type ? TYPE_ICONS[props.type] : Store;
  return (
    <div className="absolute inset-0 text-white">
      <div className="pa-guest-camera" />
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="absolute inset-x-0 top-11 px-5 text-center">
        <p className="serif truncate text-[22px] leading-tight">{props.venueName || 'Your spot'}</p>
        <p className="mt-0.5 text-[11px] text-white/75">{hint}</p>
      </div>

      <div className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2">
        <div className="pa-guest-float relative">
          {props.imageUrl ? (
            <img src={props.imageUrl} alt="" className={cn('object-cover shadow-[0_20px_50px_rgba(168,85,247,.45)]', props.type === 'art_piece' || props.type === 'event_teaser' ? 'h-36 w-28 rounded-md' : 'h-32 w-32 rounded-full')} />
          ) : (
            <div className="pa-thumb grid h-32 w-32 place-items-center rounded-full shadow-[0_20px_50px_rgba(244,63,94,.35)]"><Icon size={32} className="text-white/85" aria-hidden="true" /></div>
          )}
        </div>
        <span className="pa-anchor mx-auto mt-4 block h-2.5 w-2.5 rounded-full bg-[#F43F5E]" aria-hidden="true" />
      </div>

      <div className="pa-sheet">
        <span className="mx-auto mb-2 block h-1 w-9 rounded-full bg-white/30" aria-hidden="true" />
        {props.type === 'promo_offer' ? (
          <>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#FB923C]">Offer · {countdown(props.offerEndsAt)}</p>
            <p className="mt-0.5 text-[17px] font-semibold leading-snug">{props.offerTitle || 'Your offer goes here'}</p>
            {props.offerDetails && <p className="mt-0.5 line-clamp-2 text-[11px] text-white/75">{props.offerDetails}</p>}
            <span className="mt-2.5 flex h-9 items-center justify-center rounded-full bg-[#F43F5E] text-[13px] font-semibold">Claim</span>
          </>
        ) : props.type === 'art_piece' ? (
          <>
            <p className="serif text-[19px] leading-tight">{props.title || 'Name the piece'}</p>
            <p className="mt-0.5 text-[11px] text-white/75">{props.artistName ? `by ${props.artistName}` : 'Credit the artist'}</p>
            <span className="mt-2.5 flex h-9 items-center justify-center rounded-full border border-white/20 text-[12px] font-semibold">See more of their work</span>
          </>
        ) : props.type === 'event_teaser' ? (
          <>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#FDE68A]">{formatEventDate(props.eventStartsAt) || 'Pick a date'}</p>
            <p className="mt-0.5 text-[17px] font-semibold leading-snug">{props.title || 'Name the night'}</p>
            {props.description && <p className="mt-0.5 line-clamp-2 text-[11px] text-white/75">{props.description}</p>}
          </>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-[17px] font-semibold">{props.title || 'Pick a dish'}</p>
              {props.price && <p className="shrink-0 text-[13px] text-white/85">{props.price}</p>}
            </div>
            <p className="mt-0.5 line-clamp-2 text-[11px] text-white/75">{props.description || 'Floating over the table, right where it’ll land.'}</p>
          </>
        )}
      </div>
    </div>
  );
}
