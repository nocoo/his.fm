import type { Appearance, AppearanceUpdate } from '../../shared/appearance';
import { categoryService } from '../categories/service';
import { type LibraryEntry, programLibrary } from '../production/model';
import { productionService } from '../production/service';
import { adminService, request } from '../service';

export type CoverPreviewSource = Pick<LibraryEntry, 'id' | 'title' | 'episodeNumber'> & {
  coverUrl: string;
  categoryName: string;
};

export const appearanceService = {
  read: (signal?: AbortSignal) => request<{ appearance: Appearance }>('/appearance', { signal }),
  save: (input: AppearanceUpdate) =>
    request<{ appearance: Appearance }>('/appearance', { method: 'PUT', body: JSON.stringify(input) }),
  coverSources: async (signal?: AbortSignal): Promise<CoverPreviewSource[]> => {
    const [{ productions }, { episodes }, { categories }] = await Promise.all([
      productionService.list(signal),
      adminService.list(signal),
      categoryService.list(signal),
    ]);
    return programLibrary(productions, episodes)
      .filter((row) => row.coverUrl)
      .slice(0, 4)
      .map(({ id, title, episodeNumber, coverUrl, category }) => ({
        id,
        title,
        episodeNumber,
        coverUrl: coverUrl ?? '',
        categoryName: categories.find((item) => item.id === category)?.name ?? category,
      }));
  },
};
