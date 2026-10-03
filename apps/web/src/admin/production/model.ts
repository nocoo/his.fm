import {
  briefSchema,
  type Production,
  type ProductionAction,
  type ProductionBrief,
  type Publication,
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
    !production.assets.audio.durationSeconds ||
    production.audioJob?.status !== 'complete' ||
    production.audioJob.scriptVersion !== production.scriptVersion
  )
    missing.push('当前版本完整音频');
  return missing;
}
export function dateLabel(value: string | null) {
  return value
    ? new Date(value).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
    : '尚无记录';
}
export function audioBusy(production: Production) {
  return production.audioJob?.status === 'queued' || production.audioJob?.status === 'running';
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

export const studioSteps = ['brief', 'script', 'assets', 'review', 'publish'] as const;
export type StudioStep = (typeof studioSteps)[number];
export const stepLabels: Record<StudioStep, string> = {
  brief: '选题',
  script: '逐字稿',
  assets: '成品制作',
  review: '最终检查',
  publish: '发布',
};
export function currentStep(stage: Production['stage']): StudioStep {
  if (stage === 'draft' || stage === 'brief_review') return 'brief';
  if (stage === 'scripting' || stage === 'script_review') return 'script';
  if (stage === 'production') return 'assets';
  if (stage === 'final_review') return 'review';
  return 'publish';
}
export function completedSteps(production: Production): Record<StudioStep, boolean> {
  return {
    brief: Boolean(production.approvals.brief),
    script: Boolean(production.approvals.script),
    assets: ['final_review', 'ready'].includes(production.stage) && !finalMissing(production).length,
    review: Boolean(production.approvals.final),
    publish:
      Boolean(production.approvals.final) &&
      production.publications.some(
        (item) => Date.parse(item.confirmedAt) >= Date.parse(production.approvals.final?.at ?? ''),
      ),
  };
}
