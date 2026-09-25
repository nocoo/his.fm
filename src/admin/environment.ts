export type AdminEnvironment = 'local' | 'production';
const storageKey = 'hisfm-admin-environment';

export function getEnvironment(): AdminEnvironment {
  if (!import.meta.env.DEV) return 'production';
  return typeof localStorage !== 'undefined' && localStorage.getItem(storageKey) === 'production'
    ? 'production'
    : 'local';
}

export function selectEnvironment(environment: AdminEnvironment) {
  if (import.meta.env.DEV) localStorage.setItem(storageKey, environment);
}
