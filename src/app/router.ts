import { useSyncExternalStore } from 'react';

export type Screen =
  | 'terminal' | 'markets' | 'instrument' | 'portfolio' | 'orders' | 'news' | 'research' | 'clients' | 'rivals'
  | 'team' | 'business' | 'risk' | 'report' | 'achievements' | 'settings' | 'gameover' | 'help' | 'career' | 'saves';

export interface Route { screen: Screen; id?: string }

let route: Route = parse();
const listeners = new Set<() => void>();

function parse(): Route {
  if (typeof location === 'undefined') return { screen: 'terminal' };
  const h = location.hash.replace(/^#\/?/, '');
  const [screen, id] = h.split('/');
  return { screen: (screen || 'terminal') as Screen, id: id ? decodeURIComponent(id) : undefined };
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    route = parse();
    listeners.forEach((l) => l());
  });
}

export function go(screen: Screen | string, id?: string) {
  const h = `#/${screen}${id ? '/' + encodeURIComponent(id) : ''}`;
  if (location.hash !== h) location.hash = h;
  else { route = parse(); listeners.forEach((l) => l()); }
}

export function useRoute(): Route {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => route);
}

export function currentRoute() {
  return route;
}
