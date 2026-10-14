import { useEffect, type ReactNode } from 'react';
import { Link, useLocation } from './router';
import { useGetSession, useHealthCheck, useLogout, getGetSessionQueryKey } from './stub-api';
import { useQueryClient } from './stub-api';
import { Activity, BarChart3, ChevronDown, CircleHelp, GlassWater, LayoutGrid, LogOut, Moon, Settings2, Sun } from 'lucide-react';

const links = [
  { href: '/drinks', label: 'Drinks', icon: GlassWater },
  { href: '/table-cards', label: 'Table cards', icon: LayoutGrid },
  { href: '/insights', label: 'Insights', icon: BarChart3 },
  { href: '/settings', label: 'Bar settings', icon: Settings2 },
];

export function Shell({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: session, isLoading } = useGetSession();
  const health = useHealthCheck();
  const logout = useLogout();
  const queryClient = useQueryClient();
  const theme = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'daylight' ? 'daylight' : 'lastcall';

  useEffect(() => {
    if (!isLoading && !session?.authenticated) setLocation('/login');
  }, [isLoading, session?.authenticated, setLocation]);

  const toggleTheme = () => {
    window.dispatchEvent(new CustomEvent('garnish-theme', { detail: theme === 'lastcall' ? 'daylight' : 'lastcall' }));
  };

  const signOut = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        queryClient.setQueryData(getGetSessionQueryKey(), {
          authenticated: false,
          userName: null,
          barName: null,
          barSlug: null,
        });
        setLocation('/login');
      },
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] p-6">
        <div className="mx-auto max-w-6xl animate-pulse space-y-5">
          <div className="h-12 w-48 rounded-2xl bg-muted" />
          <div className="h-64 rounded-3xl bg-muted" />
        </div>
      </div>
    );
  }

  if (!session?.authenticated) return null;

  return (
    <div className="min-h-[100dvh] md:grid md:grid-cols-[250px_1fr]">
      <aside className="hidden min-h-[100dvh] flex-col bg-sidebar px-5 py-7 text-sidebar-foreground md:flex">
        <Link href="/drinks" className="mb-10 flex min-h-11 items-center gap-3 px-2 text-xl font-bold tracking-tight">
          <span className="grid h-9 w-9 place-items-center rounded-xl last-call text-[#24131f]">
            <GlassWater size={19} strokeWidth={2.4} />
          </span>
          garnish<span className="text-primary">.</span>
        </Link>
        <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.2em] text-sidebar-foreground/45">Your bar</p>
        <div className="mb-7 rounded-2xl border border-white/10 bg-white/[.04] p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold" data-testid="text-bar-name">{session?.barName || 'Your bar'}</p>
              <p className="mt-1 truncate text-xs text-sidebar-foreground/55">{session?.barSlug ? `garnish.menu/${session.barSlug}` : 'Menu workspace'}</p>
            </div>
            <ChevronDown size={16} className="shrink-0 text-sidebar-foreground/50" />
          </div>
        </div>
        <nav className="space-y-1" aria-label="Main navigation">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              href={href}
              key={href}
              data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}
              className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${location === href ? 'bg-white/10 text-white' : 'text-sidebar-foreground/65 hover:bg-white/[.06] hover:text-white'}`}
            >
              <Icon size={18} />
              {label}
              {href === '/drinks' && <span className="ml-auto h-2 w-2 rounded-full bg-[#e88357]" />}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-sidebar-foreground/55">
            <Activity size={14} className={health.isError ? 'text-primary' : 'text-emerald-400'} />
            {health.isError ? 'Connection needs a check' : 'All systems pouring'}
          </div>
          <div className="flex items-center gap-3 border-t border-white/10 px-2 pt-4">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#583143] text-sm font-semibold">
              {(session?.userName || 'B').slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{session?.userName || 'Bar owner'}</p>
              <p className="text-xs text-sidebar-foreground/50">Bar owner</p>
            </div>
            <button className="grid h-10 w-10 place-items-center rounded-xl text-sidebar-foreground/60 hover:bg-white/10" aria-label="Sign out" onClick={signOut} disabled={logout.isPending} data-testid="button-sign-out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border/70 bg-background/90 px-4 backdrop-blur-lg md:px-8">
          <Link href="/drinks" className="flex min-h-11 items-center gap-2 text-lg font-bold md:hidden">
            <span className="grid h-8 w-8 place-items-center rounded-lg last-call text-[#24131f]"><GlassWater size={17} /></span>
            garnish<span className="text-primary">.</span>
          </Link>
          <p className="hidden text-sm text-muted-foreground md:block">{session?.barName || 'Your bar'} <span className="mx-2 text-border">/</span> Shift workspace</p>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={toggleTheme} className="grid h-11 w-11 place-items-center rounded-xl text-muted-foreground hover:bg-muted" aria-label="Toggle color theme" data-testid="button-theme-toggle">
              {theme === 'lastcall' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button onClick={() => window.alert('Help is on the way. Contact hello@garnish.menu for a hand.')} className="hidden h-11 items-center gap-2 rounded-xl px-3 text-sm text-muted-foreground hover:bg-muted sm:flex" data-testid="button-help">
              <CircleHelp size={17} /> Help
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1440px] px-4 pb-28 pt-7 md:px-8 md:pb-10 md:pt-10">
          {children}
        </main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-card/95 px-1 pb-[env(safe-area-inset-bottom)] pt-1 backdrop-blur-xl md:hidden" aria-label="Mobile navigation">
        {links.map(({ href, label, icon: Icon }) => (
          <Link href={href} key={href} className={`flex min-h-[60px] flex-col items-center justify-center gap-1 text-[10px] font-medium ${location === href ? 'text-primary' : 'text-muted-foreground'}`} data-testid={`mobile-nav-${label.toLowerCase().replaceAll(' ', '-')}`}>
            <Icon size={19} />
            {label === 'Bar settings' ? 'Settings' : label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
