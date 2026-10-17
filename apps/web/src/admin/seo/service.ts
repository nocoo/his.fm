import type { SiteSeoRecord, SiteSeoUpdate } from '../../shared/seo';
import { request } from '../service';

export type SiteSeoUpdateInput = SiteSeoUpdate;

export const siteSeoService = {
  read: (signal?: AbortSignal) => request<{ seo: SiteSeoRecord }>('/seo', { signal }),
  save: (input: SiteSeoUpdateInput) =>
    request<{ seo: SiteSeoRecord }>('/seo', { method: 'PUT', body: JSON.stringify(input) }),
};
