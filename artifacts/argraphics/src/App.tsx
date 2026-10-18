import { lazy, Suspense, type ComponentType, type ReactNode, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

/*
 * Every page is its own chunk. The public guest page (/s/:code) is opened on bar wifi
 * from a printed code, so it must not pay for the landing story (GSAP, frame sequences)
 * or the partner dashboard; the landing likewise never loads the dashboard, and the
 * dashboard never loads the landing.
 */
const Landing = lazy(() => import('@/pages/landing').then((m) => ({ default: m.Landing })));
const ScanPage = lazy(() => import('@/pages/scan').then((m) => ({ default: m.ScanPage })));
const LoginPage = lazy(() => import('@/pages/login').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('@/pages/login').then((m) => ({ default: m.RegisterPage })));
const ForgotPasswordPage = lazy(() => import('@/pages/password-recovery').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('@/pages/password-recovery').then((m) => ({ default: m.ResetPasswordPage })));
const OnboardingPage = lazy(() => import('@/pages/onboarding').then((m) => ({ default: m.OnboardingPage })));
const Shell = lazy(() => import('@/components/shell').then((m) => ({ default: m.Shell })));
const HomePage = lazy(() => import('@/pages/home').then((m) => ({ default: m.HomePage })));
const ArtistPage = lazy(() => import('@/pages/artist').then((m) => ({ default: m.ArtistPage })));
const DisplaysPage = lazy(() => import('@/pages/displays').then((m) => ({ default: m.DisplaysPage })));
const NewDisplayPage = lazy(() => import('@/pages/display-editor').then((m) => ({ default: m.NewDisplayPage })));
const EditDisplayPage = lazy(() => import('@/pages/display-editor').then((m) => ({ default: m.EditDisplayPage })));
const QrCodesPage = lazy(() => import('@/pages/qr-codes').then((m) => ({ default: m.QrCodesPage })));
const AnalyticsPage = lazy(() => import('@/pages/analytics').then((m) => ({ default: m.AnalyticsPage })));
const DrinksPage = lazy(() => import('@/pages/drinks').then((m) => ({ default: m.DrinksPage })));
const TableCardsPage = lazy(() => import('@/pages/blocked').then((m) => ({ default: m.TableCardsPage })));
const SettingsPage = lazy(() => import('@/pages/blocked').then((m) => ({ default: m.SettingsPage })));

// Dev only: the frame baker for the landing page's image sequences. Vite drops this
// branch (and three.js with it) from production builds.
const BakeFramesPage = import.meta.env.DEV ? lazy(() => import('@/pages/dev/bake-frames')) : null;

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

/** Dashboard pages share the signed-in shell (tabs, profile menu). */
function InShell({ page: Page, ...props }: { page: ComponentType<any>; [key: string]: unknown }) {
  return <Shell><Page {...props} /></Shell>;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Suspense fallback={<div className="min-h-[100dvh]" aria-busy="true" />}>
        <Switch>
          <Route path="/" component={Landing} />
          <Route path="/login" component={LoginPage} />
          <Route path="/register" component={RegisterPage} />
          <Route path="/forgot-password" component={ForgotPasswordPage} />
          <Route path="/reset-password" component={ResetPasswordPage} />
          <Route path="/welcome" component={OnboardingPage} />
          <Route path="/s/:code">{(params) => <ScanPage code={params.code} />}</Route>
          <Route path="/home">{() => <InShell page={HomePage} />}</Route>
          <Route path="/artist">{() => <InShell page={ArtistPage} />}</Route>
          <Route path="/displays">{() => <InShell page={DisplaysPage} />}</Route>
          <Route path="/displays/new">{() => <InShell page={NewDisplayPage} />}</Route>
          <Route path="/displays/:id">{(params) => <InShell page={EditDisplayPage} id={params.id} />}</Route>
          <Route path="/qr-codes">{() => <InShell page={QrCodesPage} />}</Route>
          <Route path="/analytics">{() => <InShell page={AnalyticsPage} />}</Route>
          <Route path="/insights"><Redirect to="/analytics" replace /></Route>
          <Route path="/drinks">{() => <InShell page={DrinksPage} />}</Route>
          <Route path="/table-cards">{() => <InShell page={TableCardsPage} />}</Route>
          <Route path="/settings">{() => <InShell page={SettingsPage} />}</Route>
          {BakeFramesPage ? <Route path="/dev/bake" component={BakeFramesPage} /> : null}
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </RoutedErrorBoundary>
  );
}

function ThemeManager() {
  const [theme, setTheme] = useState('lastcall');
  useEffect(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem('argraphics-theme'); } catch { /* storage may be blocked */ }
    // Dark is the ARGraphics default; light is an opt-in from the profile menu.
    const initial = stored === 'daylight' ? 'daylight' : 'lastcall';
    setTheme(initial);
    document.documentElement.classList.toggle('dark', initial === 'lastcall');
    document.documentElement.dataset.theme = initial;
  }, []);
  useEffect(() => {
    const onTheme = (event: Event) => {
      const selected = (event as CustomEvent<string>).detail;
      setTheme(selected);
      document.documentElement.classList.toggle('dark', selected === 'lastcall');
      document.documentElement.dataset.theme = selected;
      try { localStorage.setItem('argraphics-theme', selected); } catch { /* storage may be blocked */ }
    };
    window.addEventListener('argraphics-theme', onTheme);
    return () => window.removeEventListener('argraphics-theme', onTheme);
  }, []);
  return <span className="sr-only" aria-live="polite">Theme {theme}</span>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <div className="grain min-h-[100dvh]">
            <ThemeManager />
            <Router />
          </div>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
