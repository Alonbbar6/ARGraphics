import { useSyncExternalStore } from 'react';

export type Drink = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  category: string;
  isAvailable: boolean;
  isPublished: boolean;
  sortOrder: number;
  thumbnailUrl: string | null;
  generationStatus: string;
  updatedAt: string;
};
export type DrinkInput = {
  name: string;
  description: string;
  priceCents: number;
  category: 'signature' | 'classic' | 'seasonal' | 'beer' | 'wine' | 'zero-proof';
};
type Options = { onSuccess?: () => void; onError?: () => void };
let demoDrinks: Drink[] = [
  { id: 'd-01', name: 'Garnish Martini', description: 'Vodka, fino sherry, olive leaf', priceCents: 1700, category: 'signature', isAvailable: true, isPublished: true, sortOrder: 0, thumbnailUrl: null, generationStatus: 'idle', updatedAt: '2025-06-12' },
  { id: 'd-02', name: 'Blood Orange Spritz', description: 'Bitter orange, bubbles, a little sunshine', priceCents: 1450, category: 'seasonal', isAvailable: true, isPublished: true, sortOrder: 1, thumbnailUrl: null, generationStatus: 'idle', updatedAt: '2025-06-12' },
  { id: 'd-03', name: 'House Old Fashioned', description: 'Rye, toasted sugar, aromatic bitters', priceCents: 1600, category: 'classic', isAvailable: false, isPublished: false, sortOrder: 2, thumbnailUrl: null, generationStatus: 'idle', updatedAt: '2025-06-11' },
  { id: 'd-04', name: 'Garden Fizz', description: 'Cucumber, basil, lime, soda', priceCents: 1200, category: 'zero-proof', isAvailable: true, isPublished: true, sortOrder: 3, thumbnailUrl: null, generationStatus: 'idle', updatedAt: '2025-06-10' },
  { id: 'd-05', name: 'Salted Paloma', description: 'Blanco tequila, grapefruit, sea salt', priceCents: 1550, category: 'signature', isAvailable: true, isPublished: true, sortOrder: 4, thumbnailUrl: null, generationStatus: 'idle', updatedAt: '2025-06-09' },
];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
const getDrinks = () => demoDrinks;
export const getListDrinksQueryKey = () => ['/api/drinks'];
export const getGetInsightsQueryKey = () => ['/api/insights'];
export const getGetSessionQueryKey = () => ['/api/auth/session'];

export function useListDrinks() {
  const drinks = useSyncExternalStore(subscribe, getDrinks, getDrinks);
  return { data: drinks, isLoading: false, isError: false, refetch: () => Promise.resolve() };
}
export function useGetSession() {
  return { data: { authenticated: true, userName: 'Marisol Vega', barName: 'Casa Marisol', barSlug: 'casa-marisol' }, isLoading: false };
}
export function useHealthCheck() { return { isError: false, isLoading: false }; }
export function useLogout() {
  return { isPending: false, mutate: (_value: unknown, options?: Options) => options?.onSuccess?.() };
}
export function useQueryClient() {
  return {
    invalidateQueries: async (_options?: { queryKey?: unknown }) => undefined,
    setQueryData: (_key: unknown, _data: unknown) => undefined,
  };
}
export function useCreateDrink() {
  return { isPending: false, mutate: ({ data }: { data: DrinkInput }, options?: Options) => {
    demoDrinks = [...demoDrinks, { ...data, id: `preview-${Date.now()}`, isAvailable: true, isPublished: false, sortOrder: demoDrinks.length, thumbnailUrl: null, generationStatus: 'idle', updatedAt: new Date().toISOString() }];
    notify(); options?.onSuccess?.();
  } };
}
export function useUpdateDrink() {
  return { isPending: false, mutate: ({ id, data }: { id: string; data: Partial<Drink> }, options?: Options) => {
    demoDrinks = demoDrinks.map((drink) => drink.id === id ? { ...drink, ...data } : drink);
    notify(); options?.onSuccess?.();
  } };
}
export function useDeleteDrink() {
  return { isPending: false, mutate: ({ id }: { id: string }, options?: Options) => {
    demoDrinks = demoDrinks.filter((drink) => drink.id !== id);
    notify(); options?.onSuccess?.();
  } };
}
