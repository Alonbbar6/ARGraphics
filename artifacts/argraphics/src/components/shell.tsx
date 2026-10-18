import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { getGetPartnerProfileQueryKey, getGetSessionQueryKey, useGetPartnerProfile, useGetSession, useLogout } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { BarChart3, ChevronDown, CircleHelp, Home, Layers, LogOut, Moon, QrCode, Settings2, Sun, type LucideIcon } from 'lucide-react';
import { initials } from '@/lib/traffic';
import './owner.css';
import './partner.css';

type Tab = { href: string; label: string; icon: LucideIcon; match: (path: string) => boolean };

function tabsFor(kind: 'venue' | 'artist'): Tab[] {
  return [
    kind === 'artist'
      ? { href: '/artist', label: 'Home', icon: Home, match: (path) => path === '/artist' || path === '/home' }
      : { href: '/home', label: 'Home', icon: Home, match: (path) => path === '/home' },
    { href: '/displays', label: 'Displays', icon: Layers, match: (path) => path.startsWith('/displays') || path === '/drinks' },
    { href: '/qr-codes', label: 'QR Codes', icon: QrCode, match: (path) => path === '/qr-codes' || path === '/table-cards' },
    { href: '/analytics', label: 'Analytics', icon: BarChart3, match: (path) => path === '/analytics' },
  ];
}

const pageNames: Record<string, string> = {
  '/drinks': '3D menu library',
  '/table-cards': 'Card art markers',
  '/settings': 'Settings',
  '/displays/new': 'New display',
};

import { BrandMark, Wordmark } from './brand';
export { BrandMark, Wordmark };

const ONBOARDING_SKIP_KEY = 'argraphics-onboarding-skipped';

export function markOnboardingSkipped() {
  try { sessionStorage.setItem(ONBOARDING_SKIP_KEY, '1'); } catch { /* storage may be blocked */ }
}

function onboardingSkipped() {
  try { return sessionStorage.getItem(ONBOARDING_SKIP_KEY) === '1'; } catch { return false; }
}

export function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  window.dispatchEvent(new CustomEvent('argraphics-theme', { detail: isDark ? 'daylight' : 'lastcall' }));
}

function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
    const onTheme = (event: Event) => setDark((event as CustomEvent<string>).detail === 'lastcall');
    window.addEventListener('argraphics-theme', onTheme);
    return () => window.removeEventListener('argraphics-theme', onTheme);
  }, []);
  return dark;
}

export function Shell({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: session, isLoading } = useGetSession();
  const profile = useGetPartnerProfile({ query: { enabled: Boolean(session?.authenticated), queryKey: getGetPartnerProfileQueryKey(), retry: false, staleTime: 60_000 } });
  const logout = useLogout();
  const queryClient = useQueryClient();
  const dark = useIsDark();

  useEffect(() => {
    if (!isLoading && !session?.authenticated) setLocation('/login');
  }, [isLoading, session?.authenticated, setLocation]);

  // A partner who hasn't told us where they are yet gets the three-screen welcome first.
  useEffect(() => {
    if (profile.data && !profile.data.neighborhood.trim() && !onboardingSkipped()) setLocation('/welcome');
  }, [profile.data, setLocation]);

  const kind = session?.partnerKind === 'artist' || profile.data?.kind === 'artist' ? 'artist' : 'venue';

  useEffect(() => {
    if (kind === 'artist' && location === '/home') setLocation('/artist');
  }, [kind, location, setLocation]);

  const signOut = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        queryClient.clear();
        queryClient.setQueryData(getGetSessionQueryKey(), { authenticated: false, userName: null, barName: null, barSlug: null, partnerKind: null });
        setLocation('/login');
      },
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] p-6" aria-busy="true" aria-label="Loading your dashboard">
        <div className="mx-auto max-w-6xl space-y-5">
          <div className="pa-skeleton h-12 w-48" />
          <div className="pa-skeleton h-64" />
        </div>
      </div>
    );
  }

  if (!session?.authenticated) return null;

  const tabs = tabsFor(kind);
  const activeIndex = tabs.findIndex((tab) => tab.match(location));
  const partnerName = profile.data?.name || session.barName || (kind === 'artist' ? 'Your studio' : 'Your spot');
  const pageName = activeIndex >= 0 ? tabs[activeIndex].label : pageNames[location] ?? (location.startsWith('/displays/') ? 'Edit display' : 'Workspace');

  const profileMenu = (align: 'start' | 'end', compact: boolean) => (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={compact
            ? 'grid h-11 w-11 place-items-center rounded-full'
            : 'flex w-full items-center gap-3 rounded-2xl border border-border bg-card/60 p-2.5 text-left hover:bg-muted'}
          aria-label={`Account menu for ${partnerName}`}
          data-testid="button-profile-menu"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-muted text-xs font-semibold text-foreground" aria-hidden="true">{initials(partnerName)}</span>
          {!compact && <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold" data-testid="text-bar-name">{partnerName}</span>
              <span className="block truncate text-xs text-muted-foreground">{session.userName || 'Owner'} · {kind === 'artist' ? 'Artist' : 'Venue'}</span>
            </span>
            <ChevronDown size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          </>}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align={align} side={compact ? 'bottom' : 'top'} sideOffset={8} className="pa-menu">
          <DropdownMenu.Label className="px-3 pb-2 pt-1">
            <span className="block text-sm font-semibold">{partnerName}</span>
            <span className="block text-xs text-muted-foreground">{session.userName}</span>
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item className="pa-menu-item" onSelect={() => setLocation('/settings')}><Settings2 size={16} aria-hidden="true" /> Settings & profile</DropdownMenu.Item>
          <DropdownMenu.Item className="pa-menu-item" onSelect={(event) => { event.preventDefault(); toggleTheme(); }} data-testid="button-theme-toggle">
            {dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />} {dark ? 'Light mode' : 'Dark mode'}
          </DropdownMenu.Item>
          <DropdownMenu.Item className="pa-menu-item" asChild><a href="mailto:hello@argraphics.app"><CircleHelp size={16} aria-hidden="true" /> Help from a real person</a></DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item className="pa-menu-item" disabled={logout.isPending} onSelect={signOut} data-testid="button-sign-out"><LogOut size={16} aria-hidden="true" /> Sign out</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );

  return (
    <div className="argraphics-owner-root min-h-[100dvh] md:grid md:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="owner-sidebar hidden min-h-[100dvh] flex-col bg-sidebar px-3 py-5 text-sidebar-foreground md:flex">
        <Link href={tabs[0].href} className="mb-8 flex min-h-11 items-center px-2" aria-label="ARGraphics home">
          <Wordmark />
        </Link>
        <nav className="relative space-y-1" aria-label="Main navigation" style={{ ['--index' as string]: Math.max(0, activeIndex) }}>
          <span className={`owner-nav-indicator ${activeIndex < 0 ? 'opacity-0' : ''}`} aria-hidden="true" />
          {tabs.map(({ href, label, icon: Icon }, index) => {
            const active = index === activeIndex;
            return (
              <Link
                href={href}
                key={href}
                aria-current={active ? 'page' : undefined}
                data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}
                className={`owner-nav-link relative flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium ${active ? 'text-foreground' : 'text-sidebar-foreground/70 hover:text-sidebar-foreground'}`}
              >
                <Icon size={17} aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto">{profileMenu('start', false)}</div>
      </aside>
      <div className="min-w-0">
        <header className="owner-topbar sticky top-0 z-30 flex h-16 items-center justify-between border-b px-4 backdrop-blur-lg md:px-8">
          <Link href={tabs[0].href} className="flex min-h-11 items-center md:hidden" aria-label="ARGraphics home">
            <Wordmark size={28} />
          </Link>
          <p className="hidden text-sm text-muted-foreground md:block">
            {partnerName}<span className="mx-2 text-border">/</span><span className="text-foreground">{pageName}</span>
          </p>
          <div className="ml-auto flex items-center gap-1 md:hidden">{profileMenu('end', true)}</div>
        </header>
        <main id="main" className="owner-main mx-auto w-full max-w-[1400px] min-w-0 px-4 pb-32 pt-6 md:px-7 md:pb-12 md:pt-8 xl:px-10">
          {children}
        </main>
      </div>
      <nav className="owner-mobile-nav fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-xl md:hidden" aria-label="Main navigation">
        <div className="relative grid grid-cols-4 px-1 pt-1" style={{ ['--index' as string]: Math.max(0, activeIndex) }}>
          <span className={`owner-tab-indicator ${activeIndex < 0 ? 'opacity-0' : ''}`} aria-hidden="true" />
          {tabs.map(({ href, label, icon: Icon }, index) => {
            const active = index === activeIndex;
            return (
              <Link href={href} key={href} aria-current={active ? 'page' : undefined} className={`flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium ${active ? 'text-foreground' : 'text-muted-foreground'}`} data-testid={`mobile-nav-${label.toLowerCase().replaceAll(' ', '-')}`}>
                <Icon size={20} className={active ? 'owner-tab-icon-active' : undefined} aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
