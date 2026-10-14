import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getListTableCardsQueryKey, useUpdateTableCard, type TableCard } from '@workspace/api-client-react';
import { LoaderCircle } from 'lucide-react';

export function TableCardEditor({ card, onClose }: { card: TableCard; onClose: () => void }) {
  const queryClient = useQueryClient();
  const updateCard = useUpdateTableCard();
  const [name, setName] = useState(card.name);
  const [widthCm, setWidthCm] = useState(String(card.physicalWidthCm));
  const [isActive, setIsActive] = useState(card.isActive);
  const [error, setError] = useState('');

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const physicalWidthCm = Number(widthCm);
    if (!name.trim() || name.length > 80 || !Number.isFinite(physicalWidthCm) ||
        physicalWidthCm < 0.001 || physicalWidthCm > 100) {
      setError('Enter a name and a width from 0.001 to 100 cm.');
      return;
    }
    try {
      const updated = await updateCard.mutateAsync({
        id: card.id,
        data: { name: name.trim(), physicalWidthCm, isActive },
      });
      queryClient.setQueryData<TableCard[]>(getListTableCardsQueryKey(), (cards) =>
        cards?.map((saved) => saved.id === updated.id ? updated : saved));
      await queryClient.invalidateQueries({ queryKey: getListTableCardsQueryKey() });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your changes. Try again.');
    }
  };

  return (
    <form onSubmit={save} aria-label={`Edit ${card.name}`} className="space-y-4 border-t border-border p-4">
      <fieldset disabled={updateCard.isPending} className="space-y-4 disabled:opacity-60">
        <label className="block text-sm font-medium">Card name
          <input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)}
            className="mt-2 h-11 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-primary" />
        </label>
        <label className="block text-sm font-medium">Printed width (cm)
          <input required type="number" min="0.001" max="100" step="any" value={widthCm}
            onChange={(event) => setWidthCm(event.target.value)}
            className="mt-2 h-11 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-primary" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} className="h-4 w-4 accent-primary" />
          Active in the iOS menu
        </label>
        <p className="text-xs text-muted-foreground">Your existing artwork stays unchanged.</p>
        {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">
            {updateCard.isPending && <LoaderCircle size={16} className="animate-spin" />}
            {updateCard.isPending ? 'Saving…' : 'Save changes'}
          </button>
          <button type="button" onClick={onClose} className="min-h-11 rounded-xl bg-secondary px-4 text-sm font-semibold text-secondary-foreground">Cancel</button>
        </div>
      </fieldset>
    </form>
  );
}
