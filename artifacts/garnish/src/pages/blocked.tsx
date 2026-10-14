import { useGetPublicMenu, useGetPublicMenuVersion, getGetPublicMenuQueryKey, getGetPublicMenuVersionQueryKey, useGetSession } from '@workspace/api-client-react';
import { useState } from 'react';
import { AlertCircle, Check, Copy, ExternalLink, KeyRound, LayoutGrid, Link2, ShieldCheck } from 'lucide-react';

export function TableCardsPage() {
  return (
    <div className="rise">
      <div className="mb-8"><p className="mb-2 text-xs font-bold uppercase tracking-[.22em] text-primary">At every seat</p><h1 className="serif text-4xl sm:text-5xl">Table cards.</h1><p className="mt-2 text-sm text-muted-foreground">Make the first scan feel like the first sip.</p></div>
      <section className="mx-auto max-w-3xl rounded-[2rem] border border-border bg-card p-7 sm:p-10">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground"><LayoutGrid size={24} /></div>
        <p className="text-xs font-bold uppercase tracking-[.2em] text-primary">Not connected yet</p>
        <h2 className="serif mt-2 text-3xl sm:text-4xl">Your table cards are waiting on a print setup.</h2>
        <p className="mt-4 max-w-xl leading-7 text-muted-foreground">This workspace doesn’t have table-card management wired up yet. Your drinks and menu are ready to manage, but we won’t pretend a card has been made or sent to print.</p>
        <div className="mt-7 rounded-2xl border border-border bg-background p-4 text-sm"><p className="font-semibold">What will be here</p><p className="mt-1 text-muted-foreground">Card design, QR download, and a quick print-ready check once the service is available.</p></div>
      </section>
    </div>
  );
}

export function SettingsPage() {
  const { data: session, isLoading } = useGetSession();
  const slug = session?.barSlug || '';
  const menuVersion = useGetPublicMenuVersion(slug, { query: { queryKey: getGetPublicMenuVersionQueryKey(slug), enabled: Boolean(slug) } });
  const publicMenu = useGetPublicMenu(slug, { query: { queryKey: getGetPublicMenuQueryKey(slug), enabled: Boolean(slug) } });
  const [copied, setCopied] = useState(false);
  const url = slug ? `${window.location.origin}/menu/${slug}` : '';
  const copyUrl = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  if (isLoading) {
    return <div className="space-y-5"><div className="h-10 w-56 animate-pulse rounded-lg bg-muted" /><div className="h-48 animate-pulse rounded-3xl bg-muted" /><div className="h-48 animate-pulse rounded-3xl bg-muted" /></div>;
  }

  return (
    <div className="rise">
      <div className="mb-8"><p className="mb-2 text-xs font-bold uppercase tracking-[.22em] text-primary">The back bar</p><h1 className="serif text-4xl sm:text-5xl">Settings & details.</h1><p className="mt-2 text-sm text-muted-foreground">Your bar’s name, your menu’s address, and the bits behind the scenes.</p></div>
      <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
        <section className="rounded-3xl border border-border bg-card p-5 sm:p-7">
          <div className="mb-6 flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Your bar</p><h2 className="serif mt-1 text-3xl">The basics</h2></div><span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-secondary-foreground"><ShieldCheck size={19} /></span></div>
          <dl className="divide-y divide-border">
            <div className="flex min-h-16 items-center justify-between gap-5"><dt className="text-sm text-muted-foreground">Bar name</dt><dd className="text-right text-sm font-semibold" data-testid="text-settings-bar-name">{session?.barName || 'Not set'}</dd></div>
            <div className="flex min-h-16 items-center justify-between gap-5"><dt className="text-sm text-muted-foreground">Menu address</dt><dd className="text-right text-sm font-semibold">{slug ? `/${slug}` : 'Not set'}</dd></div>
            <div className="flex min-h-16 items-center justify-between gap-5"><dt className="text-sm text-muted-foreground">Menu version</dt><dd className="text-right text-sm font-semibold">{menuVersion.isLoading ? 'Checking…' : menuVersion.data ? `Version ${menuVersion.data.version}` : menuVersion.isError ? 'Not available' : '—'}</dd></div>
          </dl>
          {slug && <div className="mt-5 flex flex-col gap-2 rounded-2xl bg-background p-3 sm:flex-row"><div className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-2 text-sm text-muted-foreground"><Link2 size={15} className="shrink-0" /><span className="truncate">{url}</span></div><button onClick={copyUrl} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-secondary px-4 text-sm font-semibold text-secondary-foreground" data-testid="button-copy-menu-url">{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy link'}</button><a href={url} target="_blank" rel="noreferrer" className="grid min-h-11 place-items-center rounded-xl px-3 text-muted-foreground hover:bg-muted" aria-label="Open public menu"><ExternalLink size={16} /></a></div>}
          {publicMenu.isError && <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground"><AlertCircle size={14} className="mt-0.5 shrink-0" />Couldn’t check the live menu right now. Your bar details are still shown above.</p>}
          {publicMenu.data && <p className="mt-3 text-xs text-muted-foreground">Public menu is up with {publicMenu.data.drinks.length} listed drinks.</p>}
        </section>
        <section className="rounded-3xl border border-border bg-card p-5 sm:p-7">
          <div className="mb-5 flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Connection</p><h2 className="serif mt-1 text-3xl">API access</h2></div><span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary"><KeyRound size={19} /></span></div>
          <p className="text-sm leading-6 text-muted-foreground">API key management isn’t available in this workspace yet. No keys are being generated or stored here.</p>
          <div className="mt-5 rounded-2xl border border-dashed border-border bg-background p-4">
            <p className="text-xs font-bold uppercase tracking-[.15em] text-muted-foreground">When it’s ready</p>
            <p className="mt-2 text-sm">Create and revoke keys here, with a clear record of which tools can access your menu.</p>
          </div>
          <button disabled className="mt-5 min-h-12 w-full cursor-not-allowed rounded-xl bg-muted text-sm font-semibold text-muted-foreground" aria-disabled="true">API keys unavailable</button>
        </section>
      </div>
      <section className="mt-5 rounded-3xl border border-border bg-card p-5 sm:p-7">
        <p className="text-xs font-bold uppercase tracking-[.18em] text-primary">A note on changes</p>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Bar profile editing and billing aren’t connected yet. Your bar details above are read-only for now, so nothing here can accidentally change the live menu.</p>
      </section>
    </div>
  );
}
