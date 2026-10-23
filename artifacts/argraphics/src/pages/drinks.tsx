import { createElement, useEffect, useMemo, useState, type FormEvent } from 'react';
import { billingErrorMessage } from '@/lib/plan';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { getListDrinksQueryKey, getGetInsightsQueryKey, getGetDrinkGenerationQueryKey, getGetSavedPhotoCleanupQueryKey, useCreateDrink, useDeleteDrink, useGetDrinkGeneration, useGetSavedPhotoCleanup, useListDrinks, useListDisplays, useStartDrinkGeneration, useUpdateDrink } from '@workspace/api-client-react';
import { Link, useLocation, useSearch } from 'wouter';
import type { Drink, DrinkInput, SavedPhotoCleanup } from '@workspace/api-client-react';
import { AlertCircle, ArrowLeft, Camera, Check, ChevronDown, CirclePlus, GlassWater, ImagePlus, LoaderCircle, MoreHorizontal, Pencil, RefreshCw, Search, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { CameraCapture } from '@/components/camera-capture';
import { cameraSupported } from '@/lib/camera';
import { removePhotoBackground, savedCleanupImageUrl } from '@/lib/photo-cleanup';
import { createPhotoReviewAnalytics } from '@/lib/photo-review-analytics';
import heic2any from 'heic2any';
import { ensureModelViewer } from '@/lib/model-viewer';
import { countLabel } from '@/lib/traffic';

const categories = ['all', 'signature', 'classic', 'seasonal', 'beer', 'wine', 'zero-proof', 'dish', 'figure', 'art', 'object'];

/** Real-world heights for native AR (cm). Glass sizes follow the AR pipeline guide. */
const sizePresets = [
  { value: '', label: 'Automatic (16 cm)' },
  { value: '9', label: 'Rocks glass · 9 cm' },
  { value: '12', label: 'Coupe · 12 cm' },
  { value: '15', label: 'Highball · 15 cm' },
  { value: '20', label: 'Wine glass · 20 cm' },
  { value: '22', label: 'Flute · 22 cm' },
  { value: '8', label: 'Dish or plate · 8 cm' },
  { value: '25', label: 'Tabletop figure · 25 cm' },
  { value: '60', label: 'Statue or sculpture · 60 cm' },
  { value: 'custom', label: 'Custom height…' },
];
type Category = DrinkInput['category'];

/** The preset matching a saved height, else 'custom' (or '' when unset). */
function sizeChoiceFor(heightCm: number | null) {
  if (heightCm === null) return '';
  return sizePresets.find((preset) => preset.value === String(heightCm))?.value ?? 'custom';
}

const MAX_PHOTO_SIZE = 15 * 1024 * 1024;
function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function DrinksPage() {
  const queryClient = useQueryClient();
  const drinksQuery = useListDrinks();
  const createDrink = useCreateDrink();
  const updateDrink = useUpdateDrink();
  const deleteDrink = useDeleteDrink();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Drink | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [studioDrink, setStudioDrink] = useState<{ drink: Drink; camera: boolean } | null>(null);
  const [snapAfterCreate, setSnapAfterCreate] = useState(false);
  const [sizeChoice, setSizeChoice] = useState('');
  const displaysQuery = useListDisplays();
  const menuScans = displaysQuery.data ? displaysQuery.data.filter((display) => display.type === 'menu_item').reduce((sum, display) => sum + display.scansThisWeek, 0) : null;

  const drinks = useMemo(() => (drinksQuery.data || []).filter((drink) => {
    const matchesSearch = `${drink.name} ${drink.description}`.toLowerCase().includes(query.toLowerCase());
    return matchesSearch && (category === 'all' || drink.category === category);
  }), [drinksQuery.data, query, category]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListDrinksQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetInsightsQueryKey() });
  };

  const openCreate = (snap = false) => {
    setEditing(null);
    setSizeChoice('');
    setFormError('');
    setSnapAfterCreate(snap);
    setModalOpen(true);
  };

  const openEdit = (drink: Drink) => {
    setEditing(drink);
    setSizeChoice(sizeChoiceFor(drink.realHeightCm));
    setFormError('');
    setModalOpen(true);
    setMenuFor(null);
  };

  const openStudio = (drink: Drink, camera = false) => {
    setStudioDrink({ drink, camera });
    setMenuFor(null);
  };

  // `/drinks?open=<id>` (from the home page shelf) opens that drink's 3D studio, then drops the parameter.
  const search = useSearch();
  const [, setLocation] = useLocation();
  useEffect(() => {
    const openId = new URLSearchParams(search).get('open');
    if (!openId || !drinksQuery.data) return;
    const drink = drinksQuery.data.find((entry) => entry.id === openId);
    if (drink) setStudioDrink({ drink, camera: false });
    setLocation('/drinks', { replace: true });
  }, [search, drinksQuery.data, setLocation]);

  const submitDrink = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const price = Number(data.get('price'));
    const size = String(data.get('size') ?? '');
    const realHeightCm = size === '' ? null : Number(size === 'custom' ? data.get('customHeight') : size);
    const input: DrinkInput = {
      name: String(data.get('name')).trim(),
      description: String(data.get('description')).trim(),
      priceCents: Math.round(price * 100),
      category: String(data.get('category')) as Category,
      realHeightCm,
    };
    if (!input.name || !Number.isFinite(price) || price < 0) {
      setFormError('Add a name and a price that makes sense.');
      return;
    }
    if (realHeightCm !== null && !(realHeightCm >= 1 && realHeightCm <= 500)) {
      setFormError('Enter a real height between 1 and 500 cm.');
      return;
    }
    const closeOnSuccess = () => {
      refresh();
      setModalOpen(false);
      setEditing(null);
    };
    if (editing) {
      updateDrink.mutate({ id: editing.id, data: input }, { onSuccess: closeOnSuccess, onError: () => setFormError('That edit did not stick. Give it another try.') });
    } else {
      createDrink.mutate({ data: input }, {
        onSuccess: (created) => {
          closeOnSuccess();
          // "Snap a photo": straight from the name to the camera, no second menu.
          if (snapAfterCreate) openStudio(created, true);
        },
        onError: () => setFormError('Could not add that item. Try again in a moment.'),
      });
    }
  };

  const toggleDrink = (drink: Drink, field: 'isAvailable' | 'isPublished') => {
    if (field === 'isPublished' && !drink.isPublished && !drink.modelGlbUrl) {
      openStudio(drink);
      return;
    }
    updateDrink.mutate({ id: drink.id, data: { [field]: !drink[field] } }, { onSuccess: refresh });
    setMenuFor(null);
  };

  const removeDrink = (drink: Drink) => {
    if (!window.confirm(`Pull ${drink.name} off the menu for good?`)) return;
    deleteDrink.mutate({ id: drink.id }, { onSuccess: refresh });
    setMenuFor(null);
  };

  if (drinksQuery.isLoading) {
    return <div className="space-y-5" aria-label="Loading drinks"><div className="h-9 w-52 animate-pulse rounded-lg bg-muted" /><div className="h-16 animate-pulse rounded-2xl bg-muted" /><div className="h-72 animate-pulse rounded-3xl bg-muted" /></div>;
  }

  if (drinksQuery.isError) {
    return <section className="rounded-3xl border border-border bg-card p-8 text-center"><AlertCircle className="mx-auto mb-3 text-primary" /><h1 className="pa-title">The menu didn’t come through.</h1><p className="mt-2 text-muted-foreground">Check your connection and give it another go.</p><button className="mt-5 min-h-11 rounded-xl bg-primary px-5 font-semibold text-primary-foreground" onClick={() => drinksQuery.refetch()} data-testid="button-retry-drinks">Try again</button></section>;
  }

  return (
    <div className="rise owner-drinks-page">
      <Link href="/displays" className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={15} aria-hidden="true" /> Displays</Link>
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1.5 text-xs text-muted-foreground">3D menu library</p>
          <h1 className="pa-title">Dishes worth walking in for.</h1>
          <p className="mt-2 text-sm text-muted-foreground">Snap a photo, we turn it into 3D, and it floats over the table when guests scan.{menuScans !== null ? <> Your 3D menu items got <strong className="font-semibold text-foreground">{countLabel(menuScans, 'scan')}</strong> this week.</> : null}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button onClick={() => openCreate(true)} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-primary px-5 font-semibold text-primary-foreground shadow-lg shadow-primary/15" data-testid="button-snap-drink">
            <Camera size={18} /> Snap a photo
          </button>
          <button onClick={() => openCreate()} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-card px-5 font-semibold hover:bg-muted" data-testid="button-add-drink">
            <CirclePlus size={18} /> Add without a photo
          </button>
        </div>
      </div>
      <div className="owner-toolbar mb-5 flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 sm:flex-row sm:items-center">
        <label className="owner-search flex min-h-11 flex-1 items-center gap-3 rounded-xl bg-muted/60 px-3">
          <Search size={17} className="text-muted-foreground" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" placeholder="Find an item..." aria-label="Search items" data-testid="input-search-drinks" />
        </label>
        <div className="flex max-w-full gap-1 overflow-x-auto pb-1 sm:pb-0" role="group" aria-label="Filter by category">
          {categories.map((item) => (
            <button key={item} onClick={() => setCategory(item)} className={`min-h-10 shrink-0 rounded-xl px-3 text-xs font-semibold capitalize ${category === item ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-muted'}`} data-testid={`filter-category-${item}`}>
              {item === 'all' ? 'All items' : item.replace('-', ' ')}
            </button>
          ))}
        </div>
      </div>
      {drinksQuery.data?.length === 0 ? (
        <section className="rounded-3xl border border-dashed border-border bg-card/60 px-6 py-14 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-secondary-foreground"><GlassWater size={25} /></span>
          <h2 className="text-xl font-semibold">First round’s on you.</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">Add the dishes, drinks and products your guests ask for most. You can tune the list as the shift goes.</p>
          <button onClick={() => openCreate(true)} className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-2xl bg-primary px-5 font-semibold text-primary-foreground" data-testid="button-add-first-drink"><Camera size={18} /> Snap your first dish</button>
        </section>
      ) : drinks.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-5 py-12 text-center"><p className="font-medium">Nothing in that group.</p><button onClick={() => { setQuery(''); setCategory('all'); }} className="mt-3 min-h-11 px-4 text-sm text-primary underline underline-offset-4" data-testid="button-clear-filter">Clear filters</button></div>
      ) : (
        <div className="rounded-3xl border border-border bg-card">
          <div className="owner-drink-grid hidden gap-3 border-b border-border px-5 py-3 text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground sm:grid">
            <span>Item</span><span>Style</span><span>Price</span><span>On the menu</span><span />
          </div>
          {drinks.map((drink, index) => (
            <article key={drink.id} className="owner-drink-grid grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 border-b border-border/70 px-4 py-4 last:border-0 sm:items-center sm:px-5" data-testid={`row-drink-${drink.id}`}>
              <div className="col-span-2 flex min-w-0 items-center gap-3 sm:col-span-1">
                <div className={`grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl ${drink.thumbnailUrl ? 'bg-cover bg-center' : 'last-call text-[#26151d]'}`} style={drink.thumbnailUrl ? { backgroundImage: `url(${drink.thumbnailUrl})` } : undefined}>
                  {!drink.thumbnailUrl && <GlassWater size={21} />}
                </div>
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">{drink.name}</h2>
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{drink.description || 'A little something worth talking about.'}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${drink.modelGlbUrl ? 'text-emerald-600 dark:text-emerald-400' : drink.generationStatus === 'processing' ? 'text-primary' : 'text-muted-foreground'}`}>
                      {drink.modelGlbUrl ? <><Check size={11} /> 3D ready</> : drink.generationStatus === 'processing' ? <><LoaderCircle size={11} className="animate-spin" /> Building 3D</> : 'No 3D preview'}
                    </span>
                  </div>
                </div>
              </div>
              <span className="hidden text-sm capitalize text-muted-foreground sm:block">{drink.category.replace('-', ' ')}</span>
              <span className="hidden font-semibold tabular-nums sm:block">{formatPrice(drink.priceCents)}</span>
              <div className="flex items-center gap-2">
                <button onClick={() => toggleDrink(drink, 'isAvailable')} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${drink.isAvailable ? 'bg-primary' : 'bg-muted'}`} role="switch" aria-checked={drink.isAvailable} aria-label={`${drink.isAvailable ? 'Mark unavailable' : 'Mark available'}: ${drink.name}`} data-testid={`toggle-available-${drink.id}`}>
                  <span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition-transform ${drink.isAvailable ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
                <span className="whitespace-nowrap text-xs text-muted-foreground sm:hidden">{formatPrice(drink.priceCents)}</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">{drink.isAvailable ? 'Pouring' : '86’d'}</span>
              </div>
              <div className="relative flex justify-end">
                <button onClick={() => setMenuFor(menuFor === drink.id ? null : drink.id)} className="grid h-11 w-11 place-items-center rounded-xl text-muted-foreground hover:bg-muted" aria-label={`More for ${drink.name}`} data-testid={`button-more-${drink.id}`}><MoreHorizontal size={19} /></button>
                {menuFor === drink.id && <div className={`absolute right-0 z-20 w-max min-w-52 rounded-2xl border border-border bg-card p-1.5 shadow-xl ${index >= drinks.length - 2 && drinks.length > 2 ? 'bottom-12' : 'top-12'}`}>
                  <button onClick={() => openEdit(drink)} className="flex min-h-11 w-full items-center gap-2 whitespace-nowrap rounded-xl px-3 text-left text-sm hover:bg-muted"><Pencil size={15} /> Edit details</button>
                  <button onClick={() => openStudio(drink)} className="flex min-h-11 w-full items-center gap-2 whitespace-nowrap rounded-xl px-3 text-left text-sm hover:bg-muted"><Sparkles size={15} /> {drink.modelGlbUrl ? 'Review 3D preview' : 'Make 3D preview'}</button>
                  <button onClick={() => toggleDrink(drink, 'isPublished')} disabled={!drink.isPublished && !drink.modelGlbUrl} title={!drink.isPublished && !drink.modelGlbUrl ? 'A generated 3D model is required before publishing.' : undefined} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"><Check size={15} /> {drink.isPublished ? 'Hide from menu' : drink.modelGlbUrl ? 'Publish to menu' : 'Generate model to publish'}</button>
                  <button onClick={() => removeDrink(drink)} disabled={deleteDrink.isPending} className="flex min-h-11 w-full items-center gap-2 whitespace-nowrap rounded-xl px-3 text-left text-sm text-destructive hover:bg-muted"><Trash2 size={15} /> Remove item</button>
                </div>}
              </div>
              <div className="col-span-2 flex items-center gap-2 pl-[60px] sm:hidden">
                <span className="rounded-full bg-secondary/70 px-2.5 py-1 text-[10px] font-semibold capitalize text-secondary-foreground">{drink.category.replace('-', ' ')}</span>
                {drink.isPublished && <span className="flex items-center gap-1 text-[10px] text-emerald-500"><Check size={12} /> Live</span>}
              </div>
            </article>
          ))}
        </div>
      )}
      {modalOpen && <div className="fixed inset-0 z-50 grid place-items-end bg-black/55 p-0 backdrop-blur-sm sm:place-items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="drink-form-title" className="w-full max-w-lg rounded-t-[2rem] border border-border bg-card p-5 shadow-2xl sm:rounded-[2rem] sm:p-7">
          <div className="mb-5 flex items-start justify-between">
            <div><p className="text-xs font-bold uppercase tracking-[.18em] text-primary">{editing ? 'A quick edit' : 'Add to the list'}</p><h2 id="drink-form-title" className="mt-1 text-xl font-semibold">{editing ? 'Tweak this pour.' : snapAfterCreate ? 'Name it, then point the camera.' : 'What are we pouring?'}</h2></div>
            <button onClick={() => setModalOpen(false)} className="grid h-11 w-11 place-items-center rounded-xl hover:bg-muted" aria-label="Close form"><X size={19} /></button>
          </div>
          <form onSubmit={submitDrink} className="space-y-4">
            <label className="block text-sm font-medium">Item name<input required maxLength={80} name="name" defaultValue={editing?.name || ''} className="mt-1.5 min-h-12 w-full rounded-xl border border-input bg-background px-3 outline-none focus:border-primary" placeholder="e.g. House Paloma" data-testid="input-drink-name" /></label>
            <label className="block text-sm font-medium">A line about it<textarea name="description" rows={3} defaultValue={editing?.description || ''} className="mt-1.5 w-full resize-y rounded-xl border border-input bg-background px-3 py-3 outline-none focus:border-primary" placeholder="What makes this one special?" data-testid="input-drink-description" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium">Price<input required min="0" step="0.01" type="number" name="price" defaultValue={editing ? (editing.priceCents / 100).toFixed(2) : ''} className="mt-1.5 min-h-12 w-full rounded-xl border border-input bg-background px-3 outline-none focus:border-primary" placeholder="14.00" data-testid="input-drink-price" /></label>
              <label className="block text-sm font-medium">Style<span className="relative mt-1.5 block"><select name="category" defaultValue={editing?.category || 'signature'} className="min-h-12 w-full appearance-none rounded-xl border border-input bg-background px-3 pr-9 capitalize outline-none focus:border-primary" data-testid="select-drink-category">{categories.filter((item) => item !== 'all').map((item) => <option key={item} value={item}>{item.replace('-', ' ')}</option>)}</select><ChevronDown size={16} className="pointer-events-none absolute right-3 top-4 text-muted-foreground" /></span></label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className={`block text-sm font-medium ${sizeChoice === 'custom' ? '' : 'col-span-2'}`}>Real size in AR
                <span className="relative mt-1.5 block">
                  <select name="size" value={sizeChoice} onChange={(event) => setSizeChoice(event.target.value)} className="min-h-12 w-full appearance-none rounded-xl border border-input bg-background px-3 pr-9 outline-none focus:border-primary" data-testid="select-drink-size">
                    {sizePresets.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
                  </select>
                  <ChevronDown size={16} className="pointer-events-none absolute right-3 top-4 text-muted-foreground" />
                </span>
              </label>
              {sizeChoice === 'custom' && <label className="block text-sm font-medium">Height (cm)<input required min="1" max="500" step="0.5" type="number" name="customHeight" defaultValue={editing?.realHeightCm ?? ''} className="mt-1.5 min-h-12 w-full rounded-xl border border-input bg-background px-3 outline-none focus:border-primary" placeholder="30" data-testid="input-drink-height" /></label>}
              <p className="col-span-2 -mt-1 text-xs text-muted-foreground">How tall it stands on the table in the guest app. Match the real glass so it looks right next to the real thing.</p>
            </div>
            {formError && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</p>}
            <button disabled={createDrink.isPending || updateDrink.isPending} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground disabled:opacity-60" data-testid="button-save-drink">
              {(createDrink.isPending || updateDrink.isPending) && <LoaderCircle size={17} className="animate-spin" />}
              {editing ? 'Save changes' : snapAfterCreate ? 'Next: take the photo' : 'Add to the menu'}
            </button>
          </form>
        </section>
      </div>}
      {studioDrink && <PhotoTo3DStudio drink={studioDrink.drink} startWithCamera={studioDrink.camera} onClose={() => setStudioDrink(null)} onPublished={() => { refresh(); setStudioDrink(null); }} />}
    </div>
  );
}

function messageFrom(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function PhotoTo3DStudio({ drink, startWithCamera = false, onClose, onPublished }: { drink: Drink; startWithCamera?: boolean; onClose: () => void; onPublished: () => void }) {
  const [reviewAnalytics] = useState(createPhotoReviewAnalytics);
  const queryClient = useQueryClient();
  const startGeneration = useStartDrinkGeneration();
  const updateDrink = useUpdateDrink();
  const generationQuery = useGetDrinkGeneration(drink.id, {
    query: {
      enabled: true,
      queryKey: getGetDrinkGenerationQueryKey(drink.id),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === 'processing' ? 1800 : false;
      },
    },
  });
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [savedDraft, setSavedDraft] = useState<SavedPhotoCleanup | null>(null);
  const [choosingNewPhoto, setChoosingNewPhoto] = useState(false);
  // Camera first when the owner came here to shoot; the viewfinder closes once a frame is taken.
  const [cameraOpen, setCameraOpen] = useState(startWithCamera && cameraSupported());
  // "Snap and build": skip the cutout check and start the paid 3D build as soon as the cutout is ready.
  const [autoBuild, setAutoBuild] = useState(false);
  const cleanupQuery = useGetSavedPhotoCleanup(drink.id, {
    query: {
      queryKey: getGetSavedPhotoCleanupQueryKey(drink.id),
      staleTime: 0,
      refetchOnMount: 'always',
      refetchInterval: (query) => query.state.data?.draft?.status === 'processing' ? 2000 : false,
    },
  });
  const hasPhoto = !!sourceFile || !!savedDraft;
  const [originalPreview, setOriginalPreview] = useState('');
  const [cleanedPreview, setCleanedPreview] = useState('');
  const [busyMessage, setBusyMessage] = useState('');
  const [error, setError] = useState('');
  const [approved, setApproved] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [notice, setNotice] = useState('');
  const [viewerError, setViewerError] = useState('');

  useEffect(() => {
    const latest = cleanupQuery.data?.draft;
    const draft = latest?.status === 'failed' ? cleanupQuery.data?.previousReadyDraft || latest : latest;
    if (!draft || choosingNewPhoto || busyMessage) return;
    reviewAnalytics.restored(draft);
    setSavedDraft(draft);
    setOriginalPreview(savedCleanupImageUrl(draft, 'source'));
    setCleanedPreview(draft.status === 'ready' ? savedCleanupImageUrl(draft, 'cleaned') : '');
    setApproved(false);
    if (draft.status === 'ready') setNotice('Your cutout is saved. Review and approve it before building; no new cleanup is needed.');
    if (latest?.status === 'failed') {
      setError(draft.status === 'ready'
        ? 'The replacement cleanup failed. Your earlier cutout is still saved below; you can review and build from it without another cleanup.'
        : latest.error || 'The cleanup was interrupted.');
    }
  }, [cleanupQuery.data, choosingNewPhoto, busyMessage, reviewAnalytics]);

  useEffect(() => () => {
    if (originalPreview.startsWith('blob:')) URL.revokeObjectURL(originalPreview);
  }, [originalPreview]);
  useEffect(() => () => {
    if (cleanedPreview.startsWith('blob:')) URL.revokeObjectURL(cleanedPreview);
  }, [cleanedPreview]);

  const generation = generationQuery.data;
  const modelUrl = generation?.modelGlbUrl || drink.modelGlbUrl;
  const active = generation?.status === 'processing';
  const progress = Math.min(100, Math.max(0, generation?.progress ?? drink.generationProgress ?? 0));

  useEffect(() => {
    if (generation?.status === 'ready' || generation?.status === 'failed') {
      void queryClient.invalidateQueries({ queryKey: getListDrinksQueryKey() });
    }
  }, [generation?.status, queryClient]);

  useEffect(() => {
    if (!modelUrl) return;
    let cancelled = false;
    setViewerError('');
    const canvas = document.createElement('canvas');
    try {
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) {
        setViewerError('This browser cannot display 3D because WebGL is unavailable. Enable hardware acceleration or open the dashboard in another browser. Your model is saved.');
        return;
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      setViewerError('This browser could not start the 3D viewer. Try another browser. Your model is saved.');
      return;
    }
    void ensureModelViewer().catch((cause: unknown) => {
      if (!cancelled) setViewerError(messageFrom(cause, 'The interactive 3D viewer could not load. Try another browser. Your model is saved.'));
    });
    return () => { cancelled = true; };
  }, [modelUrl]);

  const choosePhoto = async (file?: File, buildRightAway = autoBuild) => {
    if (!file) return;
    setCameraOpen(false);
    setError('');
    setNotice('');
    const looksHeic = /\\.hei[cf]$/i.test(file.name) || ['image/heic', 'image/heif'].includes(file.type.toLowerCase());
    if (!ACCEPTED_TYPES.includes(file.type.toLowerCase()) && !looksHeic) {
      setError('Choose a JPG, PNG, WebP, HEIC or HEIF image.');
      return;
    }
    if (file.size > MAX_PHOTO_SIZE) {
      setError('That photo is over 15 MB. Choose a smaller image.');
      return;
    }
    setBusyMessage(looksHeic ? 'Converting HEIC photo to JPEG…' : 'Preparing your photo…');
    setSourceFile(null);
    setSavedDraft(null);
    setChoosingNewPhoto(true);
    setOriginalPreview('');
    setCleanedPreview('');
    setApproved(false);
    try {
      let normalized = file;
      if (looksHeic) {
        const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
        const jpegBlob = Array.isArray(converted) ? converted[0] : converted;
        normalized = new File([jpegBlob], file.name.replace(/\\.hei[cf]$/i, '.jpg'), { type: 'image/jpeg', lastModified: Date.now() });
      } else if (!normalized.type) {
        const extensionType: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
        const extension = file.name.split('.').pop()?.toLowerCase() || '';
        normalized = new File([file], file.name, { type: extensionType[extension] || '' });
      }
      if (normalized.size > MAX_PHOTO_SIZE) throw new Error('The converted photo is over 15 MB. Choose a smaller image.');
      setSourceFile(normalized);
      const sourceUrl = URL.createObjectURL(normalized);
      setOriginalPreview(sourceUrl);
      const result = await removePhotoBackground(drink.id, normalized, setBusyMessage);
      reviewAnalytics.cleaned(result);
      queryClient.setQueryData(getGetSavedPhotoCleanupQueryKey(drink.id), { draft: result, previousReadyDraft: null });
      setSavedDraft(result);
      setCleanedPreview(savedCleanupImageUrl(result, 'cleaned'));
      setChoosingNewPhoto(false);
      void cleanupQuery.refetch();
      setBusyMessage('');
      if (buildRightAway) {
        setApproved(true);
        await generateFrom(result);
      }
    } catch (cause) {
      setBusyMessage('');
      setError(messageFrom(cause, 'Could not prepare that photo. Try another.'));
      setChoosingNewPhoto(false);
      void cleanupQuery.refetch();
    }
  };

  const generateFrom = async (draft: SavedPhotoCleanup) => {
    if (!draft.cleanedPhotoPath || draft.status !== 'ready') return;
    setError('');
    setNotice('');
    setBusyMessage('Starting the 3D build from your saved cutout…');
    try {
      const sourcePhotoPath = draft.sourcePhotoPath;
      const cleanedPhotoPath = draft.cleanedPhotoPath;
      const cutoutSource = reviewAnalytics.source(draft);
      const result = await startGeneration.mutateAsync({ id: drink.id, data: { sourcePhotoPath, cleanedPhotoPath } });
      reviewAnalytics.generated(cutoutSource);
      queryClient.setQueryData(getGetDrinkGenerationQueryKey(drink.id), result);
      queryClient.invalidateQueries({ queryKey: getListDrinksQueryKey() });
      setNotice('Your photos are in. We’ll keep this preview up to date while the model is built.');
      setBusyMessage('');
      void generationQuery.refetch();
    } catch (cause) {
      setBusyMessage('');
      setError(billingErrorMessage(cause, 'The 3D build could not start. Your photos are still here—try again.').message);
    }
  };

  const generate = async () => {
    if (!savedDraft || !approved) return;
    await generateFrom(savedDraft);
  };

  const publish = () => {
    if (!modelUrl || viewerError) return;
    setError('');
    updateDrink.mutate({ id: drink.id, data: { isPublished: true } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDrinksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetInsightsQueryKey() });
        setNotice('Published to your menu.');
        onPublished();
      },
      onError: () => setError('Could not publish this item. Try again.'),
    });
  };

  const reshoot = (withCamera = cameraSupported()) => {
    reviewAnalytics.retake(savedDraft);
    setCameraOpen(withCamera);
    setSourceFile(null);
    setSavedDraft(null);
    setChoosingNewPhoto(true);
    setOriginalPreview('');
    setCleanedPreview('');
    setApproved(false);
    setError('');
    setNotice('');
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-end bg-black/60 p-0 backdrop-blur-sm sm:place-items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="studio-title" className="max-h-[94dvh] w-full max-w-[48rem] overflow-y-auto rounded-t-[2rem] border border-border bg-card shadow-2xl sm:rounded-[2rem]">
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-border bg-card/95 px-5 py-4 backdrop-blur sm:px-7">
          <div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Photo to 3D · {drink.category}</p><h2 id="studio-title" className="mt-1 text-xl font-semibold">Make {drink.name} menu-ready.</h2><p className="mt-1 text-sm text-muted-foreground">A clean cutout makes a better model. You approve it before we build.</p></div>
          <button onClick={onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl hover:bg-muted" aria-label="Close 3D studio" data-testid="button-close-3d-studio"><X size={19} /></button>
        </header>
        <div className="space-y-5 p-5 sm:p-7">
          {cleanupQuery.isLoading && <p role="status">Checking for a saved cutout…</p>}
          {cleanupQuery.isError && <div role="alert">Could not check your saved cutout. <button onClick={() => void cleanupQuery.refetch()} className="underline">Try again</button></div>}
          {savedDraft?.status === 'processing' && <p role="status" data-testid="status-saved-cleanup">Your photo cleanup is still running. You can close the studio; the cutout will be saved here when ready.</p>}
          {cameraOpen && !busyMessage && !active && (
            <CameraCapture subject={drink.name} accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" onCancel={() => setCameraOpen(false)} onCapture={(file) => void choosePhoto(file)} onPickFile={(file) => void choosePhoto(file)} />
          )}
          {!cameraOpen && !hasPhoto && !active && !modelUrl && !cleanupQuery.isLoading && !cleanupQuery.isError && (
            <div className="rounded-[1.5rem] border border-dashed border-primary/40 bg-secondary/35 px-5 py-8 text-center" data-testid="panel-photo-picker">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-card text-primary shadow-sm"><Camera size={25} /></span>
              <p className="mt-4 font-semibold">Show us {drink.name}.</p>
              <p className="mt-1 text-sm text-muted-foreground">Point your phone at it on a plain surface in good light, or pick a photo you already have.</p>
              <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
                {cameraSupported() && <button type="button" onClick={() => setCameraOpen(true)} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground" data-testid="button-open-camera"><Camera size={17} /> Take a photo</button>}
                <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 font-semibold hover:bg-muted" data-testid="button-choose-photo">
                  <ImagePlus size={17} /> Choose from library
                  <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" capture="environment" onChange={(event) => { void choosePhoto(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} data-testid="input-drink-photo" />
                </label>
              </div>
              <label className="mx-auto mt-5 flex max-w-md cursor-pointer items-start gap-3 rounded-xl border border-border bg-background px-3 py-3 text-left text-sm">
                <input type="checkbox" checked={autoBuild} onChange={(event) => setAutoBuild(event.target.checked)} className="mt-0.5 h-5 w-5 accent-[hsl(var(--primary))]" data-testid="checkbox-auto-build" />
                <span><span className="font-semibold">Build the 3D model right away.</span> <span className="text-muted-foreground">Skips the cutout check. One photo, one model, no clicks in between.</span></span>
              </label>
              <p className="mt-3 text-[11px] text-muted-foreground">Best results: phone camera, up close, the whole item in frame on a plain surface, in good light. JPG, PNG, WebP, HEIC or HEIF · up to 15 MB · we cut the background out for you; only the 3D build uses Meshy credits.</p>
            </div>
          )}
          {busyMessage && <div className="flex items-center gap-3 rounded-2xl bg-secondary/55 px-4 py-3 text-sm" role="status" data-testid="status-photo-workflow"><LoaderCircle className="shrink-0 animate-spin text-primary" size={18} /><span>{busyMessage}</span></div>}
          {hasPhoto && !cleanedPreview && !busyMessage && savedDraft?.status !== 'processing' && <button onClick={() => reshoot()} className="min-h-11 rounded-xl border border-border px-4 text-sm font-semibold" data-testid="button-retry-photo-cleanup">Choose a photo and retry cleanup</button>}
          {hasPhoto && cleanedPreview && (
            <div>
              <div className="mb-3 flex items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.17em] text-primary">Cutout review</p><p className="mt-1 text-sm text-muted-foreground">Check the glass edge and garnish before we send it to 3D.</p></div><button onClick={() => reshoot()} className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-primary hover:bg-secondary/60" data-testid="button-reshoot-photo"><RefreshCw size={16} /> Retake</button></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <figure className="overflow-hidden rounded-2xl border border-border bg-muted"><div className="grid h-48 place-items-center sm:h-60"><img src={originalPreview} alt="Original photo" className="max-h-full max-w-full object-contain" /></div><figcaption className="border-t border-border bg-card px-3 py-2 text-xs font-semibold">Original photo</figcaption></figure>
                <figure className="overflow-hidden rounded-2xl border border-border bg-card"><div className="checkerboard grid h-48 place-items-center sm:h-60" style={{ backgroundColor: 'hsl(var(--card))', backgroundImage: 'linear-gradient(45deg, hsl(var(--muted)) 25%, transparent 25%), linear-gradient(-45deg, hsl(var(--muted)) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, hsl(var(--muted)) 75%), linear-gradient(-45deg, transparent 75%, hsl(var(--muted)) 75%)', backgroundSize: '24px 24px', backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0' }}><img src={cleanedPreview} alt="Transparent background cutout preview" className="max-h-full max-w-full object-contain" /></div><figcaption className="border-t border-border bg-card px-3 py-2 text-xs font-semibold">Background removed <span className="ml-1 font-normal text-muted-foreground">· transparent</span></figcaption></figure>
              </div>
              <label className="mt-4 flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-border bg-background px-3 text-sm">
                <input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} className="h-5 w-5 accent-[hsl(var(--primary))]" data-testid="checkbox-approve-cutout" />
                <span>I’ve checked the cutout. It’s ready to become a 3D model.</span>
              </label>
               <button onClick={() => void generate()} disabled={!approved || !!busyMessage || active || startGeneration.isPending} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-45" data-testid="button-start-generation"><Sparkles size={17} /> Build the 3D preview</button>
            </div>
          )}
          {generationQuery.isLoading && !sourceFile && !modelUrl && <div className="space-y-3"><div className="h-8 w-44 animate-pulse rounded-lg bg-muted" /><div className="h-48 animate-pulse rounded-2xl bg-muted" /></div>}
          {active && (
            <div className="rounded-[1.5rem] border border-border bg-background p-5" data-testid="status-generation-progress">
              <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.17em] text-primary">Building your model</p><p className="mt-1 text-lg font-semibold">A little patience. A better pour.</p><p className="mt-1 text-sm text-muted-foreground">{generation?.status === 'uploaded' ? 'Photos received and queued.' : 'Meshy is shaping the glass and garnish.'}</p></div><span className="font-mono text-lg tabular-nums text-primary">{progress}%</span></div>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${progress}%` }} /></div>
              <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle size={14} className="animate-spin" /> This panel updates automatically.</p>
            </div>
          )}
          {generation?.status === 'failed' && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4" role="alert" data-testid="status-generation-error"><p className="font-semibold text-destructive">The model needs another go.</p><p className="mt-1 text-sm text-muted-foreground">{generation.error || drink.generationError || 'The 3D build did not finish.'}</p>
              <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => savedDraft?.status === 'ready' ? void generate() : reshoot()} disabled={!!busyMessage || (savedDraft?.status === 'ready' && !approved)} className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground" data-testid="button-retry-generation"><RefreshCw size={15} /> Retry build</button><button onClick={() => reshoot()} className="min-h-11 rounded-xl border border-border px-4 text-sm font-semibold" data-testid="button-reshoot-after-error">Reshoot photo</button></div>
            </div>
          )}
          {generationQuery.isError && !active && <div className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive" role="alert">Couldn’t load the latest generation status. <button onClick={() => generationQuery.refetch()} className="font-semibold underline underline-offset-2">Try again</button></div>}
          {modelUrl && (
            <div className="overflow-hidden rounded-[1.5rem] border border-border bg-background" data-testid="panel-model-review">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3"><div><p className="text-xs font-bold uppercase tracking-[.17em] text-primary">Ready for a closer look</p><p className="text-sm text-muted-foreground">Drag to rotate · pinch or scroll to zoom</p></div><span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">3D ready</span></div>
              <div className="checkerboard flex h-72 items-center justify-center sm:h-96" style={{ backgroundColor: 'hsl(var(--card))', backgroundImage: 'linear-gradient(45deg, hsl(var(--muted)) 25%, transparent 25%), linear-gradient(-45deg, hsl(var(--muted)) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, hsl(var(--muted)) 75%), linear-gradient(-45deg, transparent 75%, hsl(var(--muted)) 75%)', backgroundSize: '24px 24px', backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0' }}>{viewerError ? <div className="max-w-[30rem] rounded-2xl border border-border bg-card p-5 text-center text-sm" role="alert" data-testid="status-3d-browser-unavailable"><AlertCircle className="mx-auto mb-3 text-primary" /><p>{viewerError}</p><a href={modelUrl} download className="mt-3 inline-flex min-h-11 items-center px-3 font-semibold text-primary underline">Download saved 3D model</a></div> : createElement('model-viewer', { src: modelUrl, 'camera-controls': true, 'auto-rotate': true, 'rotation-per-second': '18deg', 'shadow-intensity': '0.7', 'environment-image': 'neutral', 'alt': `Interactive 3D preview of ${drink.name}`, style: { width: '100%', height: '100%', backgroundColor: 'transparent' } })}</div>
              <div className="flex flex-col gap-3 border-t border-border bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-muted-foreground">{drink.isPublished ? 'This drink is already on your menu.' : viewerError ? 'Open the preview in a WebGL-enabled browser before publishing.' : 'Looks right? Put it on your menu.'}</p>{!drink.isPublished && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} className="h-5 w-5 accent-[hsl(var(--primary))]" data-testid="checkbox-reviewed-model" /> I’m satisfied with how it looks</label>}{!drink.isPublished && <button onClick={publish} disabled={updateDrink.isPending || !!viewerError || !reviewed} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground disabled:opacity-60" data-testid="button-publish-generated-drink">{updateDrink.isPending && <LoaderCircle size={16} className="animate-spin" />}Publish to menu</button>}</div>
            </div>
          )}
          {modelUrl && !hasPhoto && !cameraOpen && !cleanupQuery.isLoading && !cleanupQuery.isError && !active && <div><p className="mb-2 text-xs text-muted-foreground">A new photo replaces the cutout. Building a new model uses Meshy credits.</p><div className="flex flex-wrap gap-2">{cameraSupported() && <button type="button" onClick={() => setCameraOpen(true)} className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold hover:bg-muted" data-testid="button-new-model-camera"><Camera size={15} /> Snap a new photo</button>}<label className="flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold hover:bg-muted" data-testid="button-new-model-photo"><RefreshCw size={15} /> Build another version from a library photo<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" capture="environment" onChange={(event) => { void choosePhoto(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} /></label></div></div>}
          {notice && <p className="rounded-xl bg-secondary/60 px-3 py-2 text-sm" role="status" data-testid="status-studio-notice">{notice}</p>}
          {error && <div className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive" role="alert" data-testid="status-studio-error"><AlertCircle size={16} className="mt-0.5 shrink-0" />{error}</div>}
          {(generation?.status === 'ready' || modelUrl) && hasPhoto && !busyMessage && savedDraft?.status !== 'processing' && <button onClick={() => reshoot()} className="flex min-h-11 items-center gap-2 text-sm font-semibold text-primary" data-testid="button-reshoot-ready"><RefreshCw size={15} /> Make another version from a new photo</button>}
          {!hasPhoto && !cameraOpen && !active && !modelUrl && generation?.status === 'failed' && <button onClick={() => reshoot()} className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold"><Upload size={15} /> Choose a new photo</button>}
        </div>
      </section>
    </div>,
    document.body,
  );
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
