import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, GlassWater } from 'lucide-react';
import { ShelfController } from './shelf-controller';
import './shelf.css';

export type ShelfItem = {
  id: string;
  name: string;
  subtitle?: string | null;
  priceLabel?: string | null;
  /** Without a model the poster image stands on the shelf instead. */
  glbUrl: string | null;
  posterUrl: string | null;
  /** A line such as "12 scans this week"; null hides it. */
  statLabel?: string | null;
};

type Props = {
  items: ShelfItem[];
  /** Called after the flight-out animation when the front model is chosen. */
  onSelect: (item: ShelfItem) => void;
  selectLabel?: string;
  /** Accessible name of the carousel. */
  label?: string;
  /** `tall` gives the models a full-height stage. */
  size?: 'default' | 'tall';
  className?: string;
};

/**
 * A fan of 3D models on one canvas, in the spirit of the A24 disc gallery: click, drag,
 * swipe sideways or use the arrow keys to bring a model to the front, drag the front one to
 * spin it, and choose it to leave for its page.
 */
export function ModelShelf({ items, onSelect, selectLabel = 'Open', label = 'Your menu in 3D', size = 'default', className }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ShelfController | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const [active, setActive] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const liveId = useId();
  const count = items.length;
  const item = items[Math.min(active, Math.max(0, count - 1))];

  // Stable key for the items so the scene only rebuilds when the set actually changes.
  const itemsKey = items.map((entry) => `${entry.id}:${entry.glbUrl ?? ''}:${entry.posterUrl ?? ''}`).join('|');

  useEffect(() => {
    const host = hostRef.current;
    if (!host || count === 0) return;
    let controller: ShelfController;
    try {
      controller = new ShelfController(host, items.map((entry) => ({ id: entry.id, glbUrl: entry.glbUrl, posterUrl: entry.posterUrl })), {
        onIndexChange: setActive,
        onSelect: (index) => {
          const chosen = items[index];
          if (!chosen) return;
          setLeaving(true);
          void controller.flightOut().then(() => selectRef.current(chosen));
        },
      });
    } catch {
      // No WebGL: the thumbnails below still work as plain links.
      return;
    }
    controllerRef.current = controller;
    if (import.meta.env.DEV) (window as unknown as { __shelf?: ShelfController }).__shelf = controller;
    setActive(controller.activeIndex);
    setLeaving(false);
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const controller = controllerRef.current;
    if (!controller || leaving) return;
    switch (event.key) {
      case 'ArrowRight': controller.next('key'); break;
      case 'ArrowLeft': controller.prev('key'); break;
      case 'Home': controller.go(0, 'key'); break;
      case 'End': controller.go(count - 1, 'key'); break;
      case 'Enter':
      case ' ': {
        const chosen = items[controller.activeIndex];
        if (!chosen) return;
        setLeaving(true);
        void controller.flightOut().then(() => selectRef.current(chosen));
        break;
      }
      default: return;
    }
    event.preventDefault();
  };

  const choose = () => {
    const controller = controllerRef.current;
    if (!item || leaving) return;
    if (!controller) { selectRef.current(item); return; }
    setLeaving(true);
    void controller.flightOut().then(() => selectRef.current(item));
  };

  if (count === 0 || !item) return null;

  return (
    <div className={`shelf ${className ?? ''}`.trim()} data-testid="model-shelf">
      <div
        ref={hostRef}
        className={size === 'tall' ? 'shelf-stage shelf-stage-tall' : 'shelf-stage'}
        role="group"
        aria-roledescription="carousel"
        aria-label={label}
        aria-describedby={liveId}
        aria-keyshortcuts="ArrowLeft ArrowRight Home End Enter"
        tabIndex={0}
        onKeyDown={onKeyDown}
        data-testid="model-shelf-stage"
      >
        <p id={liveId} className="sr-only" aria-live="polite" aria-atomic="true">{item.name}, {active + 1} of {count}</p>
        <button type="button" className="shelf-nav shelf-nav-prev" aria-label="Previous model" disabled={active === 0 || leaving} onClick={() => controllerRef.current?.prev('click')} data-testid="model-shelf-prev"><ChevronLeft size={18} aria-hidden="true" /></button>
        <button type="button" className="shelf-nav shelf-nav-next" aria-label="Next model" disabled={active >= count - 1 || leaving} onClick={() => controllerRef.current?.next('click')} data-testid="model-shelf-next"><ChevronRight size={18} aria-hidden="true" /></button>
        <div className="shelf-panel" key={item.id}>
          <div className="shelf-panel-in min-w-0">
            <h3 className="shelf-title truncate" data-testid="model-shelf-title">{item.name}</h3>
            <p className="shelf-meta">
              {item.subtitle ? <span>{item.subtitle}</span> : null}
              {item.statLabel ? <span>{item.statLabel}</span> : null}
            </p>
          </div>
          <div className="shelf-panel-in flex items-end gap-4">
            {item.priceLabel ? <span className="shelf-price" data-testid="model-shelf-price">{item.priceLabel}</span> : null}
            <button type="button" className="shelf-open" onClick={choose} disabled={leaving} data-testid="model-shelf-open">{selectLabel} <ArrowRight size={14} aria-hidden="true" /></button>
          </div>
        </div>
      </div>
      {count > 1 && (
        <div className="shelf-thumbs" role="tablist" aria-label="Models on the shelf">
          {items.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              className="shelf-thumb"
              aria-current={index === active ? 'true' : undefined}
              aria-selected={index === active}
              aria-label={entry.name}
              title={entry.name}
              onClick={() => controllerRef.current ? controllerRef.current.go(index, 'click') : setActive(index)}
              data-testid={`model-shelf-thumb-${index}`}
            >
              {entry.posterUrl ? <img src={entry.posterUrl} alt="" loading="lazy" /> : <GlassWater size={18} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
