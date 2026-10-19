import type { Appearance, AppearanceUpdate } from '../../shared/appearance';
import type { Production } from '../../shared/production';
import { productionService } from '../production/service';
import { request } from '../service';

export type CoverPreviewSource = Pick<Production, 'id' | 'title' | 'version' | 'episodeNumber'>;

export const appearanceService = {
  read: (signal?: AbortSignal) => request<{ appearance: Appearance }>('/appearance', { signal }),
  save: (input: AppearanceUpdate) =>
    request<{ appearance: Appearance }>('/appearance', { method: 'PUT', body: JSON.stringify(input) }),
  coverSources: async (signal?: AbortSignal): Promise<CoverPreviewSource[]> => {
    const { productions } = await productionService.list(signal);
    return productions
      .filter((production) => production.assets.cover?.url)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .map(({ id, title, version, episodeNumber }) => ({ id, title, version, episodeNumber }));
  },
};
