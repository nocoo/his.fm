import { appearanceService } from '../admin/appearance/service';
import type { ThemeId } from './appearance';

export type AdminAppearanceThemeStatus = 'idle' | 'loading' | 'ready' | 'error';

type Snapshot = {
  status: AdminAppearanceThemeStatus;
  theme: ThemeId | null;
  error: unknown | null;
};

let snapshot: Snapshot = { status: 'idle', theme: null, error: null };
let generation = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function getAdminAppearanceThemeSnapshot(): Snapshot {
  return snapshot;
}

export function subscribeAdminAppearanceTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function loadAdminAppearanceTheme(): void {
  if (snapshot.status === 'loading' || snapshot.status === 'ready') return;
  const currentGeneration = ++generation;
  snapshot = { status: 'loading', theme: snapshot.theme, error: null };
  notify();
  appearanceService
    .read()
    .then(({ appearance }) => {
      if (currentGeneration !== generation) return;
      snapshot = { status: 'ready', theme: appearance.theme, error: null };
      notify();
    })
    .catch((error) => {
      if (currentGeneration !== generation) return;
      snapshot = { status: 'error', theme: null, error };
      notify();
    });
}

export function publishAdminAppearanceTheme(theme: ThemeId): void {
  generation++;
  snapshot = { status: 'ready', theme, error: null };
  notify();
}

export function retryAdminAppearanceTheme(): void {
  generation++;
  snapshot = { status: 'idle', theme: null, error: null };
  loadAdminAppearanceTheme();
}

export function resetAdminAppearanceThemeForTests(): void {
  generation++;
  snapshot = { status: 'idle', theme: null, error: null };
  listeners.clear();
}
