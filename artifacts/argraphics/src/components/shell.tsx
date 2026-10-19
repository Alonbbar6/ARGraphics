import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link, useLocation } from 'wouter';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { getGetPartnerProfileQueryKey, getGetSessionQueryKey, useGetPartnerProfile, useGetSession, useLogout } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { BarChart3, ChevronDown, CircleHelp, Home, Layers, LogOut, Moon, QrCode, Settings2, Sun, type LucideIcon } from 'lucide-react';
import { initials } from '@/lib/traffic';
import { gsap, prefersReducedMotion } from '@/lib/motion';
import { installCursorSpotlight } from '@/lib/cursor-spotlight';
import { TonightProvider, useTonight } from '@/hooks/use-tonight';
import { formatHHMM } from '@/lib/service-hours';
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

/**
 * The top nav's highlight is one pill that slides to the active tab (same technique as
 * SegmentedControl): measure the active link's box, hand it to CSS, let the transition move it.
 * Off the main tabs (Settings, an editor) the pill fades out instead of jumping to Home.
 */
function useNavThumb(navRef: RefObject<HTMLElement | null>, activeIndex: number) {
  const previous = useRef(activeIndex);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const place = () => {
      const active = nav.querySelectorAll<HTMLElement>('.owner-nav-link')[activeIndex];
      if (!active) return;
      nav.style.setProperty('--thumb-left', `${active.offsetLeft}px`);
      nav.style.setProperty('--thumb-width', `${active.offsetWidth}px`);
    };
    place();
    // Fallback metrics can be off by a few pixels until the web font arrives.
    void document.fonts?.ready.then(place);
    const observer = new ResizeObserver(place);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [navRef, activeIndex]);

  // The icon of the tab you just chose gives a small hop, in the top bar and the mobile bar alike.
  useEffect(() => {
    const changed = previous.current !== activeIndex;
    previous.current = activeIndex;
    if (!changed || activeIndex < 0 || prefersReducedMotion()) return;
    const icons = Array.from(document.querySelectorAll<SVGElement>('[aria-current="page"] [data-nav-icon]'));
    if (icons.length === 0) return;
    const tween = gsap.fromTo(icons, { y: 0, scale: 1 }, { keyframes: [{ y: -3, scale: 1.18, duration: 0.16, ease: 'power2.out' }, { y: 0, scale: 1, duration: 0.3, ease: 'back.out(2.5)' }], clearProps: 'transform' });
    return () => { tween.kill(); };
  }, [activeIndex]);
}

/** The top-bar switch: forces Tonight mode on or off; the venue clock decides otherwise. */
function TonightSwitch() {
  const tonight = useTonight();
  const flip = () => tonight.setOverride(tonight.on ? (tonight.auto ? 'off' : null) : (tonight.auto ? null : 'on'));
  return (
    <button
      type="button"
      onClick={flip}
      aria-pressed={tonight.on}
      className={`owner-tonight-toggle flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-medium ${tonight.on ? 'border-border bg-muted text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
      title={tonight.on ? `Tonight mode on until ${formatHHMM(tonight.serviceClose, '03:00')}` : `Tonight mode starts at ${formatHHMM(tonight.serviceOpen)}`}
      data-testid="button-tonight"
    >
      {tonight.on ? <span className="room-live-dot" aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
      <span className="hidden sm:inline">Tonight</span>
    </button>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { data: session } = useGetSession();
  return (
    <TonightProvider enabled={Boolean(session?.authenticated)}>
      <ShellFrame>{children}</ShellFrame>
    </TonightProvider>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  const tonight = useTonight();
  const [location, setLocation] = useLocation();
  const { data: session, isLoading } = useGetSession();
  const profile = useGetPartnerProfile({ query: { enabled: Boolean(session?.authenticated), queryKey: getGetPartnerProfileQueryKey(), retry: false, staleTime: 60_000 } });
  const logout = useLogout();
  const queryClient = useQueryClient();
  const dark = useIsDark();
  const navRef = useRef<HTMLElement>(null);

  // The cursor light over every card. A callback ref, because the owner root only mounts
  // once the session is known, after the loading skeleton.
  const spotlightCleanup = useRef<(() => void) | null>(null);
  const rootRef = useCallback((node: HTMLDivElement | null) => {
    spotlightCleanup.current?.();
    spotlightCleanup.current = node ? installCursorSpotlight(node) : null;
  }, []);
  useEffect(() => () => { spotlightCleanup.current?.(); spotlightCleanup.current = null; }, []);

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

  const tabs = tabsFor(kind);
  const activeIndex = tabs.findIndex((tab) => tab.match(location));
  useNavThumb(navRef, activeIndex);

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
    <div ref={rootRef} className="argraphics-owner-root min-h-[100dvh]" data-tonight={tonight.on ? '' : undefined}>
      <header className="owner-topbar sticky top-0 z-30 border-b backdrop-blur-lg">
        <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center gap-4 px-4 md:px-7 xl:px-10">
          <Link href={tabs[0].href} className="flex min-h-11 shrink-0 items-center" aria-label="ARGraphics home">
            <Wordmark size={28} />
          </Link>
          <nav ref={navRef} className="owner-top-nav relative hidden items-center gap-1 md:flex" aria-label="Main navigation" data-hidden={activeIndex < 0 ? '' : undefined}>
            <span className="owner-top-nav-thumb" aria-hidden="true" />
            {tabs.map(({ href, label, icon: Icon }, index) => {
              const active = index === activeIndex;
              return (
                <Link
                  href={href}
                  key={href}
                  aria-current={active ? 'page' : undefined}
                  data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}
                  className={`owner-nav-link relative flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium ${active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Icon size={16} aria-hidden="true" data-nav-icon="" className="owner-nav-icon" />
                  {label}
                </Link>
              );
            })}
          </nav>
          <p className="ml-auto hidden min-w-0 truncate text-sm text-muted-foreground lg:block">
            {partnerName}<span className="mx-2 text-border">/</span><span className="text-foreground">{pageName}</span>
          </p>
          <div className="ml-auto flex shrink-0 items-center gap-1 lg:ml-0"><TonightSwitch />{profileMenu('end', true)}</div>
        </div>
      </header>
      <main id="main" className="owner-main mx-auto w-full max-w-[1400px] min-w-0 px-4 pb-32 pt-6 md:px-7 md:pb-12 md:pt-8 xl:px-10">
        {children}
      </main>
      <nav className="owner-mobile-nav fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-xl md:hidden" aria-label="Main navigation">
        <div className="relative grid grid-cols-4 px-1 pt-1" style={{ ['--index' as string]: Math.max(0, activeIndex) }}>
          <span className={`owner-tab-indicator ${activeIndex < 0 ? 'opacity-0' : ''}`} aria-hidden="true" />
          {tabs.map(({ href, label, icon: Icon }, index) => {
            const active = index === activeIndex;
            return (
              <Link href={href} key={href} aria-current={active ? 'page' : undefined} className={`flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium ${active ? 'text-foreground' : 'text-muted-foreground'}`} data-testid={`mobile-nav-${label.toLowerCase().replaceAll(' ', '-')}`}>
                <Icon size={20} className={active ? 'owner-tab-icon-active' : undefined} aria-hidden="true" data-nav-icon="" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
