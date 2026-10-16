import type { Episode } from '../../shared/episode';
import {
  briefSchema,
  type Production,
  type ProductionAction,
  type ProductionBrief,
  type Publication,
  productionAudioMaxDurationSeconds,
} from '../../shared/production';

export const emptyBrief: ProductionBrief = {
  title: '',
  slug: '',
  episodeNumber: 1,
  category: 'work',
  tags: [],
  targetDurationSeconds: 600,
  sources: [],
  intent: '',
};
export const actionLabels: Record<ProductionAction['action'], string> = {
  submit_brief: '选题准备就绪',
  approve_brief: '标记选题完成',
  revise_brief: '继续调整选题',
  submit_script: '逐字稿准备就绪',
  approve_script: '标记逐字稿完成',
  revise_script: '继续修改逐字稿',
  submit_final: '标记成品制作完成',
  approve_final: '标记最终检查完成',
  revise_assets: '继续调整成品',
  reopen_brief: '重新修改选题',
  reopen_script: '重新修改逐字稿',
  reopen_assets: '重新制作素材',
};
export function readBrief(form: FormData, sources: ProductionBrief['sources']) {
  const text = (key: string) => String(form.get(key) ?? '');
  const result = briefSchema.safeParse({
    title: text('title'),
    slug: text('slug'),
    episodeNumber: Number(text('episodeNumber')),
    category: text('category'),
    tags: text('tags')
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
    targetDurationSeconds: Number(text('durationMinutes')) * 60,
    sources,
    intent: text('intent'),
  });
  if (result.success) return { data: result.data, error: '' };
  return {
    data: null,
    error:
      '请检查必填字段、链接格式和长度。标题最多 160 字；素材链接必须使用 HTTPS；标签最多 10 个，每个最多 30 字。',
  };
}
export function finalMissing(production: Production): string[] {
  const missing: string[] = [];
  if (!production.summary.trim()) missing.push('摘要');
  if (!production.description.trim()) missing.push('发布简介');
  if (!production.assets.cover || production.assets.cover.scriptVersion !== production.scriptVersion)
    missing.push('当前版本封面');
  if (
    !production.assets.audio ||
    production.assets.audio.scriptVersion !== production.scriptVersion ||
    !Number.isFinite(production.assets.audio.durationSeconds) ||
    (production.assets.audio.durationSeconds ?? 0) <= 0 ||
    (production.assets.audio.durationSeconds ?? 0) > productionAudioMaxDurationSeconds
  )
    missing.push('当前版本完整音频');
  return missing;
}
export function dateLabel(value: string | null) {
  return value
    ? new Date(value).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
    : '尚无记录';
}
export function latestPublication(production: Production, platform: Publication['platform']) {
  return production.publications
    .filter((item) => item.platform === platform)
    .reduce<Publication | null>(
      (latest, item) =>
        !latest || Date.parse(item.publishedAt) > Date.parse(latest.publishedAt) ? item : latest,
      null,
    );
}

export type LibraryEntry = {
  id: string;
  title: string;
  episodeNumber: number;
  category: string;
  summary: string;
  tags: string[];
  coverUrl: string | null;
  audioUrl: string | null;
  status: 'draft' | 'ready' | 'published';
  updatedAt: string;
  href: string;
  production?: Production;
  episode?: Episode;
  snapshot?: Episode;
};
export function programLibrary(productions: Production[], episodes: Episode[]): LibraryEntry[] {
  const ids = new Set(productions.map((production) => production.id));
  return [
    ...productions.map((production): LibraryEntry => {
      const snapshot = episodes.find((episode) => episode.sourceProductionId === production.id);
      return {
        id: `production:${production.id}`,
        title: production.title,
        episodeNumber: production.episodeNumber,
        category: production.category,
        summary: production.summary || production.intent,
        tags: production.tags,
        coverUrl: production.assets.cover?.url ?? null,
        audioUrl: production.assets.audio?.url ?? null,
        status:
          snapshot?.status === 'published' || production.publications.length > 0
            ? 'published'
            : production.stage === 'ready'
              ? 'ready'
              : 'draft',
        updatedAt: production.updatedAt,
        href: `/admin/productions/${production.id}`,
        production,
        snapshot,
      };
    }),
    ...episodes
      .filter((episode) => !episode.sourceProductionId || !ids.has(episode.sourceProductionId))
      .map(
        (episode): LibraryEntry => ({
          id: `episode:${episode.id}`,
          title: episode.title,
          episodeNumber: episode.episodeNumber,
          category: episode.category,
          summary: episode.summary,
          tags: episode.tags,
          coverUrl: episode.coverUrl,
          audioUrl: episode.audioUrl,
          status: episode.status,
          updatedAt: episode.updatedAt,
          href: episode.sourceProductionId
            ? `/admin/productions/${episode.sourceProductionId}`
            : `/admin/episodes/${episode.id}`,
          episode,
        }),
      ),
  ].sort((a, b) => b.episodeNumber - a.episodeNumber || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
export function filterLibrary(rows: LibraryEntry[], query: string, status: string, category: string) {
  const search = query.trim().toLocaleLowerCase();
  return rows.filter(
    (row) =>
      (status === 'all' || row.status === status) &&
      (category === 'all' || row.category === category) &&
      `${row.title} ${row.summary} ${row.tags.join(' ')}`.toLocaleLowerCase().includes(search),
  );
}
