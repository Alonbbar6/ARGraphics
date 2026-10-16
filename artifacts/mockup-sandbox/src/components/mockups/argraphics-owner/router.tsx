import { Children, createContext, createElement, useContext, useMemo, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';

type LocationState = { path: string; setPath: (path: string) => void };
const LocationContext = createContext<LocationState | null>(null);

export function Router({ children, initialPath = '/drinks' }: { children: ReactNode; initialPath?: string }) {
  const [path, setPath] = useState(initialPath);
  const value = useMemo(() => ({ path, setPath }), [path]);
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}
export function useLocation(): [string, (path: string) => void] {
  const value = useContext(LocationContext);
  if (!value) throw new Error('Preview route must be inside Router.');
  return [value.path, value.setPath];
}
type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };
export function Link({ href, onClick, ...props }: LinkProps) {
  const [, setPath] = useLocation();
  return <a {...props} href={href} onClick={(event) => {
    onClick?.(event);
    if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      setPath(href);
    }
  }} />;
}
type RouteProps = { path?: string; component?: () => ReactNode; children?: ReactNode };
export function Route(_props: RouteProps) { return null; }
export function Switch({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const routes = Children.toArray(children) as Array<ReturnType<typeof createElement>>;
  const match = routes.find((route) => {
    const routePath = (route.props as RouteProps).path;
    return routePath === undefined || routePath === path;
  });
  if (!match) return null;
  const props = match.props as RouteProps;
  return props.component ? createElement(props.component) : <>{props.children}</>;
}
