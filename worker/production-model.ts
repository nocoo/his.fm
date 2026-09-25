import type { Actor, Production, ProductionAction } from '../src/shared/production';
import { HttpError } from './http';

export function requireHuman(actor: Actor) {
  if (actor.kind !== 'human') throw new HttpError(403, '此操作需要人工确认');
}

export function requireStage(production: Production, ...stages: Production['stage'][]) {
  if (!stages.includes(production.stage)) throw new HttpError(409, '当前阶段不能进行此操作');
}

export function requireFinalAssets(production: Production) {
  if (!production.approvals.brief || !production.approvals.script || !production.transcript.trim()) {
    throw new HttpError(409, '请先完成人工选题与逐字稿确认');
  }
  if (!production.summary.trim() || !production.description.trim())
    throw new HttpError(409, '请完成摘要与发布简介');
  if (!production.assets.cover || !production.assets.audio) throw new HttpError(409, '请完成封面与音频');
  if (
    [production.assets.cover, production.assets.audio].some(
      (asset) => asset.scriptVersion !== production.scriptVersion,
    )
  ) {
    throw new HttpError(409, '素材不属于当前逐字稿版本，请重新制作');
  }
  if (
    !production.assets.audio.durationSeconds ||
    production.audioJob?.status !== 'complete' ||
    production.audioJob.scriptVersion !== production.scriptVersion
  ) {
    throw new HttpError(409, '请等待当前版本音频制作完成');
  }
}

function clearArtifacts(production: Production): Production {
  return {
    ...production,
    description: '',
    summary: '',
    assets: { cover: null, audio: null },
    audioJob: null,
    approvals: { ...production.approvals, final: null },
  };
}

export function applyAction(production: Production, action: ProductionAction, actor: Actor): Production {
  const feedbackActions = [
    'revise_brief',
    'revise_script',
    'revise_assets',
    'reopen_script',
    'reopen_brief',
    'reopen_assets',
  ];
  if (!['submit_brief', 'submit_script', 'submit_final'].includes(action.action)) requireHuman(actor);
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
      requireStage(production, 'brief_review');
      return { ...production, stage: 'scripting', approvals: { ...production.approvals, brief: approval } };
    case 'revise_brief':
      requireStage(production, 'brief_review');
      return { ...production, stage: 'draft' };
    case 'submit_script':
      requireStage(production, 'scripting');
      if (!production.transcript.trim()) throw new HttpError(400, '请先完成逐字稿');
      return { ...production, stage: 'script_review' };
    case 'approve_script':
      requireStage(production, 'script_review');
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
      return {
        ...clearArtifacts(production),
        stage: 'scripting',
        scriptVersion: production.scriptVersion + 1,
        approvals: { ...production.approvals, script: null, final: null },
      };
    case 'reopen_brief':
      if (production.stage === 'draft') throw new HttpError(409, '当前已在选题阶段');
      return {
        ...clearArtifacts(production),
        stage: 'draft',
        transcript: '',
        scriptVersion: production.scriptVersion + 1,
        approvals: { brief: null, script: null, final: null },
      };
    case 'reopen_assets':
      requireStage(production, 'ready');
      return { ...production, stage: 'production', approvals: { ...production.approvals, final: null } };
  }
}
