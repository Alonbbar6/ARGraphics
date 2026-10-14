import { useGetInsights } from '@workspace/api-client-react';
import { AlertCircle, ArrowUpRight, Eye, GlassWater, Sparkles } from 'lucide-react';

export function InsightsPage() {
  const insightsQuery = useGetInsights();
  if (insightsQuery.isLoading) {
    return <div className="space-y-5" aria-label="Loading insights"><div className="h-10 w-56 animate-pulse rounded-lg bg-muted" /><div className="grid gap-4 sm:grid-cols-3"><div className="h-36 animate-pulse rounded-3xl bg-muted" /><div className="h-36 animate-pulse rounded-3xl bg-muted" /><div className="h-36 animate-pulse rounded-3xl bg-muted" /></div><div className="h-64 animate-pulse rounded-3xl bg-muted" /></div>;
  }
  if (insightsQuery.isError) {
    return <section className="rounded-3xl border border-border bg-card p-8 text-center"><AlertCircle className="mx-auto mb-3 text-primary" /><h1 className="serif text-3xl">The numbers are taking a breather.</h1><p className="mt-2 text-muted-foreground">We couldn’t load your bar’s activity just now.</p><button onClick={() => insightsQuery.refetch()} className="mt-5 min-h-11 rounded-xl bg-primary px-5 font-semibold text-primary-foreground">Try again</button></section>;
  }
  const insights = insightsQuery.data;
  const maxViews = Math.max(1, ...(insights?.viewsByDrink || []).map((drink) => drink.views));
  return (
    <div className="rise">
      <div className="mb-8"><p className="mb-2 text-xs font-bold uppercase tracking-[.22em] text-primary">A look around the room</p><h1 className="serif text-4xl sm:text-5xl">What’s catching eyes.</h1><p className="mt-2 text-sm text-muted-foreground">A little signal from the tables. No guesswork needed.</p></div>
      {!insights || (insights.viewsThisWeek === 0 && insights.viewsByDrink.length === 0) ? (
        <section className="rounded-3xl border border-dashed border-border bg-card/60 px-6 py-14 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-secondary-foreground"><Eye size={24} /></span>
          <h2 className="serif text-3xl">The room’s just warming up.</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">When guests start opening your menu, you’ll see which drinks they spend time with right here.</p>
        </section>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <section className="rounded-3xl border border-border bg-card p-5 sm:p-6"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-muted-foreground">Menu looks this week</span><span className="grid h-9 w-9 place-items-center rounded-xl bg-secondary text-secondary-foreground"><Eye size={17} /></span></div><p className="serif mt-5 text-5xl tabular-nums" data-testid="value-views-this-week">{insights.viewsThisWeek.toLocaleString()}</p><p className="mt-2 text-xs text-muted-foreground">A fresh week, a fresh round</p></section>
            <section className="rounded-3xl border border-border bg-card p-5 sm:p-6"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-muted-foreground">Signatures on the menu</span><span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary"><Sparkles size={17} /></span></div><p className="serif mt-5 text-5xl tabular-nums" data-testid="value-published-signatures">{insights.publishedSignatures}</p><p className="mt-2 text-xs text-muted-foreground">The house favorites</p></section>
            <section className="rounded-3xl border border-border bg-card p-5 sm:p-6"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-muted-foreground">Most-loved pour</span><span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/30 text-accent-foreground"><GlassWater size={17} /></span></div><p className="serif mt-5 line-clamp-1 text-3xl" data-testid="value-most-viewed-drink">{insights.mostViewedDrink || 'Not called yet'}</p><p className="mt-2 text-xs text-muted-foreground">The drink guests linger on</p></section>
          </div>
          <section className="mt-5 rounded-3xl border border-border bg-card p-5 sm:p-7">
            <div className="mb-7 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-primary">The table-side shortlist</p><h2 className="serif mt-1 text-3xl">Drinks getting a look</h2></div><span className="text-xs text-muted-foreground">This week</span></div>
            {insights.viewsByDrink.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No drink views yet. Your menu is ready when the room is.</p> : <div className="space-y-5">{insights.viewsByDrink.map((item, index) => <div key={`${item.drinkName}-${index}`} data-testid={`insight-drink-${index}`}><div className="mb-2 flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-xs font-bold text-muted-foreground">{String(index + 1).padStart(2, '0')}</span><span className="truncate text-sm font-semibold">{item.drinkName}</span></div><span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">{item.views.toLocaleString()} <Eye size={13} /></span></div><div className="ml-11 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full last-call" style={{ width: `${Math.max(5, (item.views / maxViews) * 100)}%` }} /></div></div>)}</div>}
          </section>
          <div className="mt-5 flex items-start gap-3 rounded-2xl bg-secondary/55 p-4 text-sm"><ArrowUpRight size={17} className="mt-0.5 shrink-0 text-primary" /><p><strong className="font-semibold">Last menu update:</strong> <span className="text-muted-foreground">{insights.lastMenuUpdate ? new Date(insights.lastMenuUpdate).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) : 'No update recorded yet.'}</span></p></div>
        </>
      )}
    </div>
  );
}
