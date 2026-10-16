import { useEffect } from 'react';
import { Route, Router, Switch, useLocation } from './router';
import './_group.css';
import { Shell } from './ReferenceShell';
import { DrinksPage } from './ReferenceDrinks';

function PreviewRoutes() {
  const [, setPath] = useLocation();
  return <Shell><Switch>
    <Route path="/drinks" component={DrinksPage} />
    <Route path="/insights"><PreviewUnavailable name="Insights" /></Route>
    <Route path="/table-cards"><PreviewUnavailable name="Table cards" /></Route>
    <Route path="/settings"><PreviewUnavailable name="Bar settings" /></Route>
    <Route><button onClick={() => setPath('/drinks')}>Back to drinks</button></Route>
  </Switch></Shell>;
}
function PreviewUnavailable({ name }: { name: string }) {
  return <section className="owner-panel p-8"><p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Preview route</p><h1 className="serif mt-2 text-4xl">{name}</h1><p className="mt-3 text-sm text-muted-foreground">This local preview focuses on the redesigned drinks workspace. API-dependent details remain in the real authenticated application.</p></section>;
}
export function ReferenceDashboard() {
  useEffect(() => {
    const applyTheme = (theme: string) => {
      document.documentElement.classList.toggle('dark', theme === 'lastcall');
      document.documentElement.dataset.theme = theme;
    };
    applyTheme('lastcall');
    const onTheme = (event: Event) => applyTheme((event as CustomEvent<string>).detail);
    window.addEventListener('argraphics-theme', onTheme);
    return () => window.removeEventListener('argraphics-theme', onTheme);
  }, []);
  return <Router initialPath="/drinks">
      <div className="argraphics-owner-root min-h-[100dvh]">
        <div className="fixed left-1/2 top-2 z-[80] -translate-x-1/2 rounded-full border border-border bg-card/90 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.16em] text-muted-foreground shadow">Redesign · local preview</div>
        <PreviewRoutes />
      </div>
    </Router>;
}
export default ReferenceDashboard;
