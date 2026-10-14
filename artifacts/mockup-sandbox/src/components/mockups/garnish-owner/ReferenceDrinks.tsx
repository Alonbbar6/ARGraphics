import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from './stub-api';
import { getListDrinksQueryKey, getGetInsightsQueryKey, useCreateDrink, useDeleteDrink, useListDrinks, useUpdateDrink } from './stub-api';
import type { Drink, DrinkInput } from './stub-api';
import { AlertCircle, Check, ChevronDown, CirclePlus, GlassWater, LoaderCircle, MoreHorizontal, Pencil, Search, Sparkles, Trash2, X } from 'lucide-react';

const categories = ['all', 'signature', 'classic', 'seasonal', 'beer', 'wine', 'zero-proof'];
type Category = DrinkInput['category'];

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

  const drinks = useMemo(() => (drinksQuery.data || []).filter((drink) => {
    const matchesSearch = `${drink.name} ${drink.description}`.toLowerCase().includes(query.toLowerCase());
    return matchesSearch && (category === 'all' || drink.category === category);
  }), [drinksQuery.data, query, category]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListDrinksQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetInsightsQueryKey() });
  };

  const openCreate = () => {
    setEditing(null);
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (drink: Drink) => {
    setEditing(drink);
    setFormError('');
    setModalOpen(true);
    setMenuFor(null);
  };

  const submitDrink = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const price = Number(data.get('price'));
    const input: DrinkInput = {
      name: String(data.get('name')).trim(),
      description: String(data.get('description')).trim(),
      priceCents: Math.round(price * 100),
      category: String(data.get('category')) as Category,
    };
    if (!input.name || !Number.isFinite(price) || price < 0) {
      setFormError('Add a name and a price that makes sense.');
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
      createDrink.mutate({ data: input }, { onSuccess: closeOnSuccess, onError: () => setFormError('Could not add that drink. Try again in a moment.') });
    }
  };

  const toggleDrink = (drink: Drink, field: 'isAvailable' | 'isPublished') => {
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
    return <section className="rounded-3xl border border-border bg-card p-8 text-center"><AlertCircle className="mx-auto mb-3 text-primary" /><h1 className="serif text-3xl">The menu didn’t come through.</h1><p className="mt-2 text-muted-foreground">Check your connection and give it another go.</p><button className="mt-5 min-h-11 rounded-xl bg-primary px-5 font-semibold text-primary-foreground" onClick={() => drinksQuery.refetch()} data-testid="button-retry-drinks">Try again</button></section>;
  }

  return (
    <div className="rise owner-drinks-page">
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[.19em] text-primary">Menu workspace <span className="mx-1 text-muted-foreground/50">/</span> Drinks</p>
          <h1 className="serif text-4xl tracking-tight sm:text-[2.8rem]">A good night starts here.</h1>
          <p className="mt-2 text-sm text-muted-foreground">Keep the list sharp, the prices current, and the good stuff pouring.</p>
        </div>
        <button onClick={openCreate} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-primary px-5 font-semibold text-primary-foreground shadow-lg shadow-primary/15" data-testid="button-add-drink">
          <CirclePlus size={18} /> Add a drink
        </button>
      </div>
      <div className="owner-toolbar mb-5 flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 sm:flex-row sm:items-center">
        <label className="owner-search flex min-h-11 flex-1 items-center gap-3 rounded-xl bg-muted/60 px-3">
          <Search size={17} className="text-muted-foreground" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" placeholder="Find a drink..." aria-label="Search drinks" data-testid="input-search-drinks" />
        </label>
        <div className="flex max-w-full gap-1 overflow-x-auto pb-1 sm:pb-0" role="group" aria-label="Filter by category">
          {categories.map((item) => (
            <button key={item} onClick={() => setCategory(item)} className={`min-h-10 shrink-0 rounded-xl px-3 text-xs font-semibold capitalize ${category === item ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-muted'}`} data-testid={`filter-category-${item}`}>
              {item === 'all' ? 'All drinks' : item.replace('-', ' ')}
            </button>
          ))}
        </div>
      </div>
      {drinksQuery.data?.length === 0 ? (
        <section className="rounded-3xl border border-dashed border-border bg-card/60 px-6 py-14 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-secondary-foreground"><GlassWater size={25} /></span>
          <h2 className="serif text-3xl">First round’s on you.</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">Add the drinks your guests ask for most. You can tune the list as the shift goes.</p>
          <button onClick={openCreate} className="mt-6 min-h-12 rounded-2xl bg-primary px-5 font-semibold text-primary-foreground" data-testid="button-add-first-drink">Add your first drink</button>
        </section>
      ) : drinks.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-5 py-12 text-center"><p className="font-medium">No drinks in that round.</p><button onClick={() => { setQuery(''); setCategory('all'); }} className="mt-3 min-h-11 px-4 text-sm text-primary underline underline-offset-4" data-testid="button-clear-filter">Clear filters</button></div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-border bg-card">
          <div className="owner-drink-grid hidden gap-3 border-b border-border px-5 py-3 text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground sm:grid">
            <span>Drink</span><span>Style</span><span>Price</span><span>On the menu</span><span />
          </div>
          {drinks.map((drink) => (
            <article key={drink.id} className="owner-drink-grid grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 border-b border-border/70 px-4 py-4 last:border-0 sm:items-center sm:px-5" data-testid={`row-drink-${drink.id}`}>
              <div className="col-span-2 flex min-w-0 items-center gap-3 sm:col-span-1">
                <div className={`grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl ${drink.thumbnailUrl ? 'bg-cover bg-center' : 'last-call text-[#26151d]'}`} style={drink.thumbnailUrl ? { backgroundImage: `url(${drink.thumbnailUrl})` } : undefined}>
                  {!drink.thumbnailUrl && <GlassWater size={21} />}
                </div>
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">{drink.name}</h2>
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{drink.description || 'A little something worth talking about.'}</p>
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
                {menuFor === drink.id && <div className="absolute right-0 top-12 z-20 min-w-48 rounded-2xl border border-border bg-card p-1.5 shadow-xl">
                  <button onClick={() => openEdit(drink)} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm hover:bg-muted"><Pencil size={15} /> Edit details</button>
                  <button onClick={() => toggleDrink(drink, 'isPublished')} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm hover:bg-muted"><Sparkles size={15} /> {drink.isPublished ? 'Hide from menu' : 'Publish to menu'}</button>
                  <button onClick={() => removeDrink(drink)} disabled={deleteDrink.isPending} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm text-destructive hover:bg-muted"><Trash2 size={15} /> Remove drink</button>
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
            <div><p className="text-xs font-bold uppercase tracking-[.18em] text-primary">{editing ? 'A quick edit' : 'Add to the list'}</p><h2 id="drink-form-title" className="serif mt-1 text-3xl">{editing ? 'Tweak this pour.' : 'What are we pouring?'}</h2></div>
            <button onClick={() => setModalOpen(false)} className="grid h-11 w-11 place-items-center rounded-xl hover:bg-muted" aria-label="Close form"><X size={19} /></button>
          </div>
          <form onSubmit={submitDrink} className="space-y-4">
            <label className="block text-sm font-medium">Drink name<input required maxLength={80} name="name" defaultValue={editing?.name || ''} className="mt-1.5 min-h-12 w-full rounded-xl border border-input bg-background px-3 outline-none focus:border-primary" placeholder="e.g. House Paloma" data-testid="input-drink-name" /></label>
            <label className="block text-sm font-medium">A line about it<textarea name="description" rows={3} defaultValue={editing?.description || ''} className="mt-1.5 w-full resize-y rounded-xl border border-input bg-background px-3 py-3 outline-none focus:border-primary" placeholder="What makes this one special?" data-testid="input-drink-description" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium">Price<input required min="0" step="0.01" type="number" name="price" defaultValue={editing ? (editing.priceCents / 100).toFixed(2) : ''} className="mt-1.5 min-h-12 w-full rounded-xl border border-input bg-background px-3 outline-none focus:border-primary" placeholder="14.00" data-testid="input-drink-price" /></label>
              <label className="block text-sm font-medium">Style<span className="relative mt-1.5 block"><select name="category" defaultValue={editing?.category || 'signature'} className="min-h-12 w-full appearance-none rounded-xl border border-input bg-background px-3 pr-9 capitalize outline-none focus:border-primary" data-testid="select-drink-category">{categories.filter((item) => item !== 'all').map((item) => <option key={item} value={item}>{item.replace('-', ' ')}</option>)}</select><ChevronDown size={16} className="pointer-events-none absolute right-3 top-4 text-muted-foreground" /></span></label>
            </div>
            {formError && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</p>}
            <button disabled={createDrink.isPending || updateDrink.isPending} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground disabled:opacity-60" data-testid="button-save-drink">
              {(createDrink.isPending || updateDrink.isPending) && <LoaderCircle size={17} className="animate-spin" />}
              {editing ? 'Save changes' : 'Add to the menu'}
            </button>
          </form>
        </section>
      </div>}
    </div>
  );
}
