import { type ReactNode, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { Shell } from '@/components/shell';
import { Landing } from '@/pages/landing';
import { DrinksPage } from '@/pages/drinks';
import { HomePage } from '@/pages/home';
import { QrCodesPage } from '@/pages/qr-codes';
import { AnalyticsPage } from '@/pages/analytics';
import { DisplaysPage } from '@/pages/displays';
import { EditDisplayPage, NewDisplayPage } from '@/pages/display-editor';
import { ArtistPage } from '@/pages/artist';
import { OnboardingPage } from '@/pages/onboarding';
import { ScanPage } from '@/pages/scan';
import { TableCardsPage, SettingsPage } from '@/pages/blocked';
import { LoginPage, RegisterPage } from '@/pages/login';
import { ForgotPasswordPage, ResetPasswordPage } from '@/pages/password-recovery';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/login" component={LoginPage} />
        <Route path="/register" component={RegisterPage} />
        <Route path="/forgot-password" component={ForgotPasswordPage} />
        <Route path="/reset-password" component={ResetPasswordPage} />
        <Route path="/welcome" component={OnboardingPage} />
        <Route path="/s/:code">{(params) => <ScanPage code={params.code} />}</Route>
        <Route path="/home">{() => <Shell><HomePage /></Shell>}</Route>
        <Route path="/artist">{() => <Shell><ArtistPage /></Shell>}</Route>
        <Route path="/displays">{() => <Shell><DisplaysPage /></Shell>}</Route>
        <Route path="/displays/new">{() => <Shell><NewDisplayPage /></Shell>}</Route>
        <Route path="/displays/:id">{(params) => <Shell><EditDisplayPage id={params.id} /></Shell>}</Route>
        <Route path="/qr-codes">{() => <Shell><QrCodesPage /></Shell>}</Route>
        <Route path="/analytics">{() => <Shell><AnalyticsPage /></Shell>}</Route>
        <Route path="/insights"><Redirect to="/analytics" replace /></Route>
        <Route path="/drinks">{() => <Shell><DrinksPage /></Shell>}</Route>
        <Route path="/table-cards">{() => <Shell><TableCardsPage /></Shell>}</Route>
        <Route path="/settings">{() => <Shell><SettingsPage /></Shell>}</Route>
        <Route component={NotFound} />
      </Switch>
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
