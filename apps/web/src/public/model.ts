import { publicAppearanceSchema, type ThemeId } from '../shared/appearance';
import type { PublicCategory } from '../shared/category';
import type { PublicEpisode } from '../shared/episode';
import { formatEpisodeLabel } from '../shared/episode-display';

export function catalogueCategoryFromSearch(category: string | null) {
  return category ?? 'all';
}

export function catalogueSearchParamsForCategory(searchParams: URLSearchParams, next: string) {
  const params = new URLSearchParams(searchParams);
  if (next === 'all') params.delete('category');
  else params.set('category', next);
  return params;
}

export function catalogueHref(searchParams: URLSearchParams, category: string) {
  const params = catalogueSearchParamsForCategory(searchParams, category).toString();
  return `/episodes${params ? `?${params}` : ''}`;
}

export function filterEpisodes(episodes: PublicEpisode[], category: string, query: string) {
  const search = query.trim().toLocaleLowerCase();
  return episodes.filter(
    (episode) =>
      (category === 'all' || episode.category === category) &&
      [episode.title, episode.summary, ...episode.tags].join(' ').toLocaleLowerCase().includes(search),
  );
}

export function categoryLabel(category: PublicEpisode['category'], categories: PublicCategory[]) {
  return categories.find((item) => item.id === category)?.name;
}

export function episodeDisplayLabel(
  episode: Pick<PublicEpisode, 'category' | 'episodeNumber'>,
  categories: PublicCategory[],
): string {
  const name = categoryLabel(episode.category, categories);
  return name
    ? formatEpisodeLabel(name, episode.episodeNumber)
    : formatEpisodeLabel('栏目', episode.episodeNumber);
}
export async function getCategories(signal?: AbortSignal): Promise<PublicCategory[]> {
  const response = await fetch('/api/categories', { signal });
  if (!response.ok) throw new Error('栏目暂时没有加载出来，请再试一次。');
  return ((await response.json()) as { categories: PublicCategory[] }).categories;
}

export function durationLabel(seconds: number) {
  return seconds > 0 ? `${Math.ceil(seconds / 60)} 分钟` : '时长待定';
}

export function dateLabel(date: string | null) {
  return date
    ? new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'Asia/Shanghai',
      })
        .format(new Date(date))
        .replaceAll('/', '.')
    : '即将发布';
}

export async function getEpisodes(signal?: AbortSignal): Promise<PublicEpisode[]> {
  const response = await fetch('/api/episodes', { signal });
  if (!response.ok) throw new Error('节目暂时没有加载出来，请再试一次。');
  const result = (await response.json()) as { episodes: PublicEpisode[] };
  return result.episodes;
}

export async function getAppearance(signal?: AbortSignal) {
  const response = await fetch('/api/appearance', { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('网站外观暂时没有加载出来，请再试一次。');
  const result = (await response.json()) as { appearance?: unknown };
  const parsed = publicAppearanceSchema.safeParse(result.appearance);
  if (!parsed.success) throw new Error('网站外观设置无法识别，请稍后重试。');
  return parsed.data;
}

export function appearanceHref(path: string, preview: ThemeId | null) {
  if (!preview || path.startsWith('/login') || path.startsWith('/admin')) return path;
  const url = new URL(path, 'https://his.fm');
  url.searchParams.set('theme', preview);
  return `${url.pathname}${url.search}${url.hash}`;
}
