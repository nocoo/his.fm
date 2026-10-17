import type { Episode, PublicEpisode } from '../src/shared/episode';
import { episodeCanonicalUrl } from '../src/shared/episode-url';
import { parseSeoOverride } from '../src/shared/seo';
import { HttpError } from './http';

type EpisodeRow = {
  id: string;
  slug: string;
  category: string;
  status: string;
  published_at: string | null;
};

export async function resolveCategoryAlias(db: D1Database, categoryId: string): Promise<string> {
  const row = await db
    .prepare('SELECT category_id AS categoryId FROM category_id_aliases WHERE alias = ?')
    .bind(categoryId)
    .first<{ categoryId: string }>();
  return row?.categoryId ?? categoryId;
}

export async function findPublishedEpisodeBySlug(
  db: D1Database,
  slug: string,
): Promise<{ category: string; slug: string } | null> {
  const row = await db
    .prepare(
      "SELECT category, slug FROM episodes WHERE slug = ? AND status = 'published' AND published_at <= ? ORDER BY published_at ASC LIMIT 1",
    )
    .bind(slug, new Date().toISOString())
    .first<EpisodeRow>();
  return row ? { category: row.category, slug: row.slug } : null;
}

export async function findPublishedEpisodeByCategorySlug(
  db: D1Database,
  categoryId: string,
  slug: string,
): Promise<boolean> {
  const category = await resolveCategoryAlias(db, categoryId);
  const row = await db
    .prepare(
      "SELECT id FROM episodes WHERE category = ? AND slug = ? AND status = 'published' AND published_at <= ?",
    )
    .bind(category, slug, new Date().toISOString())
    .first();
  return Boolean(row);
}

export function withPublicEpisodeFields(
  episode: PublicEpisode,
  origin: string,
): PublicEpisode & { canonical: string } {
  return { ...episode, canonical: episodeCanonicalUrl(origin, episode) };
}

export function episodeSeoFromRow(raw: string) {
  return parseSeoOverride(raw);
}

export function mergeEpisodeSeo(episode: Episode, seoRaw: string) {
  return { ...episode, seo: parseSeoOverride(seoRaw) };
}

export function redirect(location: string, permanent = true) {
  return new Response(null, {
    status: permanent ? 301 : 302,
    headers: { Location: location },
  });
}

export async function assertEpisodeSlugAvailable(
  db: D1Database,
  category: string,
  slug: string,
  excludeId?: string,
) {
  const row = await db
    .prepare(
      excludeId
        ? 'SELECT id FROM episodes WHERE category = ? AND slug = ? AND id != ?'
        : 'SELECT id FROM episodes WHERE category = ? AND slug = ?',
    )
    .bind(...(excludeId ? [category, slug, excludeId] : [category, slug]))
    .first();
  if (row) throw new HttpError(409, '该栏目下已有相同链接名称');
}
