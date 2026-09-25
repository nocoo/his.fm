import type { StorageCleanupInput, StorageCleanupResult, StoragePage } from '../../shared/storage';
import { type AdminEnvironment, getEnvironment } from '../environment';
import { request } from '../service';

export const storageService = {
  scan: (cursor: string | null, signal?: AbortSignal, environment: AdminEnvironment = getEnvironment()) =>
    request<StoragePage>(
      `/storage${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      { signal },
      environment,
    ),
  cleanup: (items: StorageCleanupInput['items'], environment: AdminEnvironment = getEnvironment()) =>
    request<StorageCleanupResult>(
      '/storage/cleanup',
      { method: 'POST', body: JSON.stringify({ items }) },
      environment,
    ),
};

export function storageMediaUrl(key: string) {
  if (import.meta.env.DEV && getEnvironment() === 'production')
    return `https://f.no.mt/${key.split('/').map(encodeURIComponent).join('/')}`;
  return `/admin/api/storage/object?key=${encodeURIComponent(key)}`;
}
