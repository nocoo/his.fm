import { hasScope } from '@his-fm/contracts';
import {
  type Actor,
  agentEditableFields,
  type Production,
  type ProductionAction,
  type ProductionBrief,
  productionAudioMaxDurationSeconds,
} from '../src/shared/production';
import { requireScope } from './authorization';
import { HttpError } from './http';

export function requireStage(production: Production, ...stages: Production['stage'][]) {
  if (!stages.includes(production.stage)) throw new HttpError(409, '当前阶段不能进行此操作');
}

export function requireFinalAssets(production: Production) {
  if (!production.approvals.brief || !production.approvals.script || !production.transcript.trim()) {
    throw new HttpError(409, '请先完成选题与逐字稿确认');
  }
  if (!production.summary.trim()) throw new HttpError(409, '请完成摘要与发布简介');
  if (!production.description.trim() && (production.topics ?? []).length < 3)
    throw new HttpError(409, '请完成发布简介或至少三条本期听点');
  if (!production.assets.cover || !production.assets.audio) throw new HttpError(409, '请完成封面与音频');
  if (
    [production.assets.cover, production.assets.audio].some(
      (asset) => asset.scriptVersion !== production.scriptVersion,
    )
  ) {
    throw new HttpError(409, '素材不属于当前逐字稿版本，请重新制作');
  }
  if (
    !Number.isFinite(production.assets.audio.durationSeconds) ||
    (production.assets.audio.durationSeconds ?? 0) <= 0 ||
    (production.assets.audio.durationSeconds ?? 0) > productionAudioMaxDurationSeconds
  )
    throw new HttpError(409, '请上传有效的成品音频');
}

function reopenContent(production: Production, stage: 'draft' | 'scripting'): Production {
  return {
    ...production,
    stage,
    scriptVersion: production.scriptVersion + 1,
    approvals: {
      brief: stage === 'draft' ? null : production.approvals.brief,
      script: null,
      final: null,
    },
  };
}

export function editAssets(production: Production, actor: Actor): Production {
  if (!canReopen(actor)) requireStage(production, 'production');
  return {
    ...production,
    stage: ['final_review', 'ready'].includes(production.stage) ? 'production' : production.stage,
    approvals: { ...production.approvals, final: null },
  };
}

type EditableProductionFields = Partial<
  ProductionBrief &
    Pick<
      Production,
      'transcript' | 'summary' | 'description' | 'lead' | 'researchNote' | 'credits' | 'body' | 'topics'
    >
>;

function canReopen(actor: Actor) {
  return hasScope(actor, 'productions:reopen');
}

export function applyPatch(
  production: Production,
  fields: EditableProductionFields,
  actor: Actor,
  editedKeys?: string[],
): Production {
  requireScope(actor, 'productions:write');
  if (!canReopen(actor)) {
    requireStage(production, 'draft', 'scripting', 'production');
    const allowed = agentEditableFields[production.stage];
    const keys = editedKeys ?? Object.keys(fields);
    if (keys.some((key) => !allowed.includes(key)))
      throw new HttpError(409, '当前字段需要 productions:reopen 权限');
  }
  const changed = Object.keys(fields).filter(
    (key) =>
      JSON.stringify(fields[key as keyof typeof fields]) !==
      JSON.stringify(production[key as keyof Production]),
  );
  if (!changed.length) return production;
  const briefChanged = changed.some((key) =>
    ['title', 'episodeNumber', 'targetDurationSeconds', 'sources', 'intent', 'category', 'mentions'].includes(
      key,
    ),
  );
  const scriptChanged = changed.includes('transcript');
  if (briefChanged && production.approvals.brief && !canReopen(actor))
    requireScope(actor, 'productions:reopen');
  let next = production;
  if (
    briefChanged &&
    (production.stage !== 'draft' ||
      production.transcript ||
      production.assets.cover ||
      production.assets.audio)
  )
    next = reopenContent(production, 'draft');
  else if (scriptChanged)
    next = reopenContent(production, production.approvals.brief ? 'scripting' : 'draft');
  else if (['final_review', 'ready'].includes(production.stage)) next = editAssets(production, actor);
  return { ...next, ...fields };
}

export function applyAction(production: Production, action: ProductionAction, actor: Actor): Production {
  const feedbackActions = ['revise_brief', 'revise_script', 'revise_assets'];
  requireScope(
    actor,
    action.action.startsWith('submit_')
      ? 'productions:submit'
      : action.action.startsWith('reopen_') || feedbackActions.includes(action.action)
        ? 'productions:reopen'
        : 'productions:approve',
  );
  if (feedbackActions.includes(action.action) && !action.feedback?.trim())
    throw new HttpError(400, '请填写修改意见');
  const approval = { at: new Date().toISOString(), by: actor.name };
  switch (action.action) {
    case 'submit_brief':
      requireStage(production, 'draft');
      if (!production.sources.length || !production.intent.trim())
        throw new HttpError(400, '请补充素材和创作意图');
      return { ...production, stage: 'brief_review' };
    case 'approve_brief':
      requireStage(production, 'draft', 'brief_review');
      if (!production.sources.length || !production.intent.trim())
        throw new HttpError(400, '请补充素材和创作意图');
      return { ...production, stage: 'scripting', approvals: { ...production.approvals, brief: approval } };
    case 'revise_brief':
      requireStage(production, 'brief_review');
      return { ...production, stage: 'draft' };
    case 'submit_script':
      requireStage(production, 'scripting');
      if (!production.transcript.trim()) throw new HttpError(400, '请先完成逐字稿');
      return { ...production, stage: 'script_review' };
    case 'approve_script':
      requireStage(production, 'scripting', 'script_review');
      if (!production.approvals.brief || !production.transcript.trim())
        throw new HttpError(400, '请先完成选题与逐字稿');
      return { ...production, stage: 'production', approvals: { ...production.approvals, script: approval } };
    case 'revise_script':
      requireStage(production, 'script_review');
      return { ...production, stage: 'scripting' };
    case 'submit_final':
      requireStage(production, 'production');
      requireFinalAssets(production);
      return { ...production, stage: 'final_review' };
    case 'approve_final':
      requireStage(production, 'final_review');
      requireFinalAssets(production);
      return { ...production, stage: 'ready', approvals: { ...production.approvals, final: approval } };
    case 'revise_assets':
      requireStage(production, 'final_review');
      return { ...production, stage: 'production' };
    case 'reopen_script':
      requireStage(production, 'production', 'final_review', 'ready');
      return reopenContent(production, 'scripting');
    case 'reopen_brief':
      if (production.stage === 'draft') throw new HttpError(409, '当前已在选题阶段');
      return reopenContent(production, 'draft');
    case 'reopen_assets':
      requireStage(production, 'final_review', 'ready');
      return editAssets(production, actor);
  }
}
