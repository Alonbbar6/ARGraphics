import { type ReactNode, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { Shell } from '@/components/shell';
import { Landing } from '@/pages/landing';
import { DrinksPage } from '@/pages/drinks';
import { InsightsPage } from '@/pages/insights';
import { TableCardsPage, SettingsPage } from '@/pages/blocked';
import { LoginPage } from '@/pages/login';
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
        <Route path="/drinks">{() => <Shell><DrinksPage /></Shell>}</Route>
        <Route path="/table-cards">{() => <Shell><TableCardsPage /></Shell>}</Route>
        <Route path="/insights">{() => <Shell><InsightsPage /></Shell>}</Route>
        <Route path="/settings">{() => <Shell><SettingsPage /></Shell>}</Route>
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function ThemeManager() {
  const [theme, setTheme] = useState('lastcall');
  useEffect(() => {
    const stored = localStorage.getItem('garnish-theme');
    const detected = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'lastcall' : 'daylight';
    const initial = stored || detected;
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
      localStorage.setItem('garnish-theme', selected);
    };
    window.addEventListener('garnish-theme', onTheme);
    return () => window.removeEventListener('garnish-theme', onTheme);
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
