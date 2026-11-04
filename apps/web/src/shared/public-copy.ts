import type { PublicCategory } from './category';
import { categoriesWithIndexableEpisodes } from './public-index';

export function programmeColumnDescription(categories: PublicCategory[]): string {
  const names = categories.map((category) => category.name.trim()).filter(Boolean);
  if (!names.length) {
    return 'his.fm 是一档给开发者的中文播客。';
  }
  const joined = names.map((name) => `「${name}」`).join('、');
  return `his.fm 是一档给开发者的中文播客，设有 ${joined} 等栏目。`;
}

export function programmeColumnDescriptionForEpisodes(
  categories: PublicCategory[],
  episodes: Array<{ category: string }>,
): string {
  return programmeColumnDescription(categoriesWithIndexableEpisodes(categories, episodes));
}
