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
  submit_brief: '提交选题审核',
  approve_brief: '人工确认选题',
  revise_brief: '退回修改选题',
  submit_script: '提交逐字稿审核',
  approve_script: '人工批准逐字稿',
  revise_script: '退回修改逐字稿',
  submit_final: '提交成品审核',
  approve_final: '人工确认全部成品',
  revise_assets: '退回修改素材',
  reopen_brief: '重新修改选题',
  reopen_script: '重新修改逐字稿',
  reopen_assets: '重新制作素材',
};
export const nextActions: Record<Production['stage'], ProductionAction['action'][]> = {
  draft: ['submit_brief'],
  brief_review: ['approve_brief', 'revise_brief'],
  scripting: ['submit_script'],
  script_review: ['approve_script', 'revise_script'],
  production: ['submit_final'],
  final_review: ['approve_final', 'revise_assets'],
  ready: [],
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
