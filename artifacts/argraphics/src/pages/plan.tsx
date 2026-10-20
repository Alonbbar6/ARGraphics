import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { getGetBillingPlanQueryKey, useCreateBillingPortal, useCreateCheckout, useGetBillingPlan, useGetPartnerProfile } from '@workspace/api-client-react';
import { BadgeCheck, CreditCard, Layers, Minus, Plus, Sparkles, Store } from 'lucide-react';
import { Badge, Button, ErrorPanel, Field, inputClass, PageHeader, Skeleton } from '@/components/partner-ui';
import { billingErrorMessage, creditsLabel, dollars, exclusivitySentence, liveSummary, planLabel } from '@/lib/plan';
import { toast } from '@/hooks/use-toast';

/**
 * Plan & billing. Free accounts see their live-display allowance and credit balance and
 * can buy credits or upgrade; Business and founding partners see what they have. Every
 * payment happens on Stripe's pages; this page only sends people there and reads back.
 */
export function PlanPage() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const plan = useGetBillingPlan();
  const profile = useGetPartnerProfile();
  const checkout = useCreateCheckout();
  const portal = useCreateBillingPortal();
  const [quantity, setQuantity] = useState(2);
  const [category, setCategory] = useState('');

  // Back from Stripe: say what happened and refresh, since the webhook may have landed already.
  useEffect(() => {
    const outcome = new URLSearchParams(window.location.search).get('checkout');
    if (!outcome) return;
    if (outcome === 'success') toast({ title: 'Payment received', description: 'Your plan updates in a few seconds. Thank you.' });
    else toast({ title: 'Checkout cancelled', description: 'Nothing was charged.' });
    void queryClient.invalidateQueries({ queryKey: getGetBillingPlanQueryKey() });
    const timer = window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: getGetBillingPlanQueryKey() }), 4000);
    setLocation('/plan', { replace: true });
    return () => window.clearTimeout(timer);
  }, [queryClient, setLocation]);

  const go = (product: 'business' | 'credits') => {
    checkout.mutate({ data: product === 'business' ? { product, ...(category.trim() ? { category: category.trim() } : {}) } : { product, quantity } }, {
      onSuccess: (result) => window.location.assign(result.url),
      onError: (error) => toast({ title: 'Could not open checkout', description: billingErrorMessage(error).message, variant: 'destructive' }),
    });
  };
  const manage = () => portal.mutate(undefined, {
    onSuccess: (result) => window.location.assign(result.url),
    onError: (error) => toast({ title: 'Could not open billing', description: billingErrorMessage(error).message, variant: 'destructive' }),
  });

  if (plan.isLoading || profile.isLoading) return <div className="space-y-5"><Skeleton className="h-12 w-56" /><Skeleton className="h-64" /></div>;
  if (!plan.data || !profile.data) return <ErrorPanel onRetry={() => void plan.refetch()} />;

  const data = plan.data;
  const me = profile.data;
  const paid = data.effective !== 'free';
  const isVenue = me.kind === 'venue';
  const prices = data.prices;
  const sentence = exclusivitySentence(category, me.venueType, me.neighborhood);

  return (
    <div className="space-y-6">
      <PageHeader title="Plan & billing" lede={paid ? 'Everything is included. Thank you for being here early.' : 'Browsing is free for everyone. You pay for what you put out.'} />

      <section className="pa-card p-5 sm:p-7" data-testid="card-current-plan">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.17em] text-muted-foreground">Your plan</p>
            <h2 className="mt-1 flex items-center gap-2 text-2xl font-semibold">
              {planLabel(data.effective)}
              {paid && <BadgeCheck size={22} className="text-primary" aria-label="Verified" />}
            </h2>
            {data.effective === 'founding' && data.foundingUntil && <p className="mt-1 text-sm text-muted-foreground">Business features free until {new Date(data.foundingUntil).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}.</p>}
            {data.effective === 'business' && data.currentPeriodEnd && <p className="mt-1 text-sm text-muted-foreground">{data.subscriptionStatus === 'past_due' ? 'Your last payment failed; Stripe will retry. ' : ''}Renews {new Date(data.currentPeriodEnd).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}.</p>}
          </div>
          {data.portalAvailable && <Button variant="ghost" onClick={manage} loading={portal.isPending} icon={CreditCard}>Manage billing</Button>}
        </div>
        <dl className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border p-4"><dt className="flex items-center gap-2 text-xs text-muted-foreground"><Layers size={14} aria-hidden="true" /> Live displays</dt><dd className="mt-1 text-lg font-semibold" data-testid="text-live-summary">{liveSummary(data.liveDisplays, data.liveDisplayLimit)}</dd></div>
          <div className="rounded-2xl border border-border p-4"><dt className="flex items-center gap-2 text-xs text-muted-foreground"><Sparkles size={14} aria-hidden="true" /> 3D builds</dt><dd className="mt-1 text-lg font-semibold" data-testid="text-credits">{data.buildsIncluded ? 'Included' : creditsLabel(data.buildCredits)}</dd></div>
          <div className="rounded-2xl border border-border p-4"><dt className="flex items-center gap-2 text-xs text-muted-foreground"><Store size={14} aria-hidden="true" /> Exclusivity</dt><dd className="mt-1 text-lg font-semibold">{data.slot ? `${data.slot.category} · ${data.slot.neighborhood}` : paid ? 'Ask us to set it' : 'Business only'}</dd></div>
        </dl>
        {!data.checkoutAvailable && !paid && <p className="mt-4 text-sm text-muted-foreground">Online billing is not switched on yet. Email <a href="mailto:hello@argraphics.app" className="underline">hello@argraphics.app</a> and we will set your plan by hand.</p>}
      </section>

      {!data.buildsIncluded && (
        <section className="pa-card p-5 sm:p-7" data-testid="card-credits">
          <h2 className="text-lg font-semibold">Build credits</h2>
          <p className="mt-1 text-sm text-muted-foreground">One credit turns one photo into a 3D model, {dollars(prices.buildCreditCents)} each. If a build fails or does not pass our quality check, the credit comes back.</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-xl border border-border">
              <button type="button" onClick={() => setQuantity((n) => Math.max(1, n - 1))} className="grid h-11 w-11 place-items-center" aria-label="Fewer credits"><Minus size={16} /></button>
              <span className="min-w-10 text-center text-lg font-semibold tabular-nums" data-testid="text-credit-quantity">{quantity}</span>
              <button type="button" onClick={() => setQuantity((n) => Math.min(10, n + 1))} className="grid h-11 w-11 place-items-center" aria-label="More credits"><Plus size={16} /></button>
            </div>
            <Button onClick={() => go('credits')} loading={checkout.isPending} disabled={!data.checkoutAvailable} data-testid="button-buy-credits">Buy {creditsLabel(quantity)} for {dollars(quantity * prices.buildCreditCents)}</Button>
          </div>
        </section>
      )}

      {isVenue && !paid && (
        <section className="pa-card p-5 sm:p-7" data-testid="card-business">
          <div className="flex items-center gap-2"><h2 className="text-lg font-semibold">Business</h2><Badge tone="featured">{dollars(prices.businessMonthlyCents)}/month</Badge></div>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex gap-2"><BadgeCheck size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />Unlimited live displays and 3D builds included.</li>
            <li className="flex gap-2"><BadgeCheck size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />Verified badge and promoted placement wherever people browse.</li>
            <li className="flex gap-2"><BadgeCheck size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />Exclusivity: {sentence}. Nobody else in your category gets promoted there while you are a member.</li>
          </ul>
          <div className="mt-4 max-w-sm">
            <Field label="What you are known for" hint="One or two words. This is what your exclusivity covers."><input className={inputClass} value={category} onChange={(event) => setCategory(event.target.value)} maxLength={40} placeholder={me.venueType === 'truck' ? 'tacos' : 'cocktails'} data-testid="input-category" /></Field>
          </div>
          {!me.neighborhood.trim() && <p className="mt-3 text-sm text-destructive">Add your neighborhood in Settings first; that is what the exclusivity covers.</p>}
          <Button className="mt-4" onClick={() => go('business')} loading={checkout.isPending} disabled={!data.checkoutAvailable || !me.neighborhood.trim()} data-testid="button-upgrade">Upgrade to Business</Button>
          <p className="mt-3 text-xs text-muted-foreground">Billed monthly through Stripe. Cancel anytime from this page; features stay on until the end of the month you paid for.</p>
        </section>
      )}
    </div>
  );
}
