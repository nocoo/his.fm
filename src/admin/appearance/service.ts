import type { Appearance, AppearanceUpdate } from '../../shared/appearance';
import { request } from '../service';

export const appearanceService = {
  read: (signal?: AbortSignal) => request<{ appearance: Appearance }>('/appearance', { signal }),
  save: (input: AppearanceUpdate) =>
    request<{ appearance: Appearance }>('/appearance', { method: 'PUT', body: JSON.stringify(input) }),
};
