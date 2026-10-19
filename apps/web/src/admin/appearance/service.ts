import type { Appearance, AppearanceUpdate } from '../../shared/appearance';
import type { Production } from '../../shared/production';
import { categoryService } from '../categories/service';
import { productionService } from '../production/service';
import { request } from '../service';

export type CoverPreviewSource = Pick<Production, 'id' | 'title' | 'version' | 'episodeNumber'> & {
  coverUrl: string;
  categoryName: string;
};

export const appearanceService = {
  read: (signal?: AbortSignal) => request<{ appearance: Appearance }>('/appearance', { signal }),
  save: (input: AppearanceUpdate) =>
    request<{ appearance: Appearance }>('/appearance', { method: 'PUT', body: JSON.stringify(input) }),
  coverSources: async (signal?: AbortSignal): Promise<CoverPreviewSource[]> => {
    const { productions } = await productionService.list(signal);
    const covered = productions.filter((production) => production.assets.cover?.url);
    if (!covered.length) return [];
    const { categories } = await categoryService.list(signal);
    return covered
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .map(({ id, title, version, episodeNumber, assets, category }) => ({
        id,
        title,
        version,
        episodeNumber,
        coverUrl: assets.cover?.url ?? '',
        categoryName: categories.find((item) => item.id === category)?.name ?? '',
      }));
  },
};
