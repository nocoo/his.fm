import { Button, LayerCard } from '@nocoo/basalt';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@nocoo/basalt/components/tabs';
import { Check } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { type ProductionAction, stageLabels } from '../../shared/production';
import { Assets, FinalReview } from './Assets';
import { BriefForm } from './BriefForm';
import { Confirm, Failure } from './controls';
import {
  actionLabels,
  completedSteps,
  currentStep,
  dateLabel,
  finalMissing,
  type StudioStep,
  stepLabels,
  studioSteps,
} from './model';
import { PromptPanel } from './PromptPanel';
import { PublicationPanel } from './PublicationPanel';
import { ScriptStage } from './ScriptStage';
import { productionService } from './service';
import { useProduction } from './useProduction';
import { useUnsavedChanges } from './useUnsavedChanges';

type Changes = Parameters<typeof productionService.update>[2];
const reopenActions = { brief: 'reopen_brief', script: 'reopen_script', assets: 'reopen_assets' } as const;
const completions: Record<Exclude<StudioStep, 'publish'>, ProductionAction['action']> = {
  brief: 'approve_brief',
  script: 'approve_script',
  assets: 'submit_final',
  review: 'approve_final',
};

export function ProductionEditor() {
  const { id = '' } = useParams();
  return <Editor key={id} id={id} />;
}
function Editor({ id }: { id: string }) {
  const vm = useProduction(id);
  const [query, setQuery] = useSearchParams();
  const [dirty, setDirty] = useState(false);
  const [destination, setDestination] = useState<StudioStep | null>(null);
  const [reload, setReload] = useState(false);
  const [reopen, setReopen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const nav = useRef<HTMLDivElement>(null);
  useUnsavedChanges(dirty);
  const production = vm.production;
  const loaded = Boolean(production);
  const source = query.get('source');
  const selected = query.get('step') ?? (source !== null ? 'brief' : null);
  const step = studioSteps.includes(selected as StudioStep)
    ? (selected as StudioStep)
    : currentStep(production?.stage ?? 'draft');
  const sourceOpen = source !== null && step === 'brief';
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset only the island when a stage opens; scrollIntoView also scrolls the shell and hides its header.
  useLayoutEffect(() => {
    nav.current?.closest('.admin-content-island')?.scrollTo({ top: 0, behavior: 'instant' });
  }, [step, loaded, source]);
  if (!production)
    return (
      <div className="admin-page">
        <PageHeader title="节目制作" />
        {vm.error ? (
          <Failure error={vm.error} retry={() => void vm.reload()} />
        ) : (
          <LayerCard.Loading label="正在加载节目制作" />
        )}
      </div>
    );
  const done = completedSteps(production);
  const visit = (next: StudioStep) => {
    setQuery({ step: next });
    setDirty(false);
    setFormKey((key) => key + 1);
  };
  const save = async (fields: Changes) => {
    if (await vm.mutate(() => productionService.update(id, production.version, fields), '改动已保存')) {
      setDirty(false);
    }
  };
  const complete = async (phase: Exclude<StudioStep, 'publish'>, changes?: Changes) => {
    const unchanged =
      !changes ||
      Object.entries(changes).every(
        ([key, value]) =>
          JSON.stringify(value) === JSON.stringify(production[key as keyof typeof production]),
      );
    const next = studioSteps[studioSteps.indexOf(phase) + 1];
    if (done[phase] && unchanged) return visit(next);
    if (
      await vm.mutate(
        () =>
          productionService.action(id, {
            version: production.version,
            action: completions[phase],
            ...(changes ? { changes } : {}),
          }),
        `${stepLabels[phase]}已完成`,
      )
    )
      visit(next);
  };
  const missing = finalMissing(production);
  return (
    <div className="admin-page studio-editor" ref={nav}>
      {!sourceOpen && (
        <PageHeader
          title={production.title}
          description={`第 ${production.episodeNumber} 期 · ${stageLabels[production.stage]} · ${dirty ? '有未保存改动' : '已保存'}`}
          actions={
            <Button variant="outline" disabled={vm.pending} onClick={() => setReload(true)}>
              刷新内容
            </Button>
          }
        />
      )}
      {vm.error && <Failure error={vm.error} />}
      {vm.conflict && (
        <div className="studio-notice" role="alert">
          内容版本已更新，你的输入仍保留。请先复制需要保留的内容，再刷新核对。
        </div>
      )}
      <Tabs
        value={step}
        activationMode="manual"
        onValueChange={(value) => {
          if (value === step || vm.pending) return;
          if (dirty) setDestination(value as StudioStep);
          else visit(value as StudioStep);
        }}
      >
        {!sourceOpen && (
          <TabsList className="studio-step-nav" aria-label="节目制作阶段" showIndicator={false}>
            {studioSteps.map((item, index) => (
              <TabsTrigger
                key={item}
                value={item}
                disabled={vm.pending}
                data-complete={done[item]}
                aria-current={step === item ? 'step' : undefined}
                aria-label={`${stepLabels[item]}${done[item] ? '，已完成' : ''}`}
              >
                <span className="studio-step-number" aria-hidden="true">
                  {done[item] ? <Check size={16} /> : index + 1}
                </span>
                <span>{stepLabels[item]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        )}
        <TabsContent value={step} key={`${step}-${formKey}`} className="studio-stage">
          {step === 'brief' && (
            <div className="studio-stack">
              {!sourceOpen && (
                <>
                  <p className="studio-location">
                    当前浏览器 · 你确定讲述意图；本地 Hermes 可以核实与整理素材
                  </p>
                  <PromptPanel production={production} kind="brief" dirty={dirty} />
                </>
              )}
              <BriefForm
                value={production}
                pending={vm.pending}
                completed={done.brief}
                onDirty={() => setDirty(true)}
                onSave={save}
                onComplete={(fields) => complete('brief', fields)}
              />
            </div>
          )}
          {step === 'script' && (
            <ScriptStage
              production={production}
              pending={vm.pending}
              dirty={dirty}
              onDirty={() => setDirty(true)}
              onSave={save}
              onComplete={(fields) => complete('script', fields)}
            />
          )}
          {step === 'assets' && (
            <div className="studio-stack">
              <Assets
                production={production}
                pending={vm.pending}
                dirty={dirty}
                onDirty={setDirty}
                onSave={save}
                mutate={vm.mutate}
              />
              <div className="studio-stage-footer">
                <p className="admin-muted">
                  {dirty
                    ? '先保存文案，再标记完成。'
                    : missing.length
                      ? `仍需完成：${missing.join('、')}`
                      : '三份成品准备齐全，进入最后检查。'}
                </p>
                <Button
                  loading={vm.pending}
                  disabled={dirty || missing.length > 0 || !production.approvals.script}
                  onClick={() => void complete('assets')}
                >
                  {done.assets ? '继续到最终检查' : '标记成品制作完成'}
                </Button>
              </div>
            </div>
          )}
          {step === 'review' && (
            <div className="studio-stack">
              <p className="studio-location">当前浏览器 · 你阅读文案、查看封面，并听完本次生成的节目音频</p>
              <FinalReview production={production} />
              <div className="studio-stage-footer">
                <p className="admin-muted">
                  {done.assets
                    ? '检查这份成品是否就是你想发布的样子。需要修改时直接切换到前面的阶段。'
                    : '可以提前查看；标记最终检查完成前，请先完成成品制作。'}
                </p>
                <Button loading={vm.pending} disabled={!done.assets} onClick={() => void complete('review')}>
                  {done.review ? '继续到发布' : '标记最终检查完成'}
                </Button>
              </div>
            </div>
          )}
          {step === 'publish' && (
            <div className="studio-stack">
              <p className="studio-location">
                微信公众号 / 小宇宙平台后台 · 你手动发布，随后在这里记录实际链接与时间
              </p>
              {!done.review && (
                <p className="studio-notice">可以预览发布内容；记录发布前，请先完成最终检查。</p>
              )}
              <PublicationPanel production={production} pending={vm.pending} mutate={vm.mutate} />
            </div>
          )}
          {!sourceOpen && step in reopenActions && done[step] && (
            <div className="studio-row">
              <p className="admin-muted">需要让本地助手重做时，先重新打开这一阶段。已有内容会保留。</p>
              <Button variant="ghost" disabled={dirty || vm.pending} onClick={() => setReopen(true)}>
                重新打开本阶段
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
      {!sourceOpen && (
        <details className="studio-records">
          <summary>制作记录 · {production.events.length}</summary>
          <ol className="studio-history">
            {production.events.toReversed().map((event) => (
              <li key={event.id}>
                <strong>
                  {actionLabels[event.action as ProductionAction['action']] ?? eventLabel(event.action)}
                </strong>
                <p className="admin-muted">
                  {dateLabel(event.at)} · {event.actor.kind === 'agent' ? '本地助手' : '你'}
                </p>
                {event.feedback && <p className="studio-prose">{event.feedback}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}
      {reopen && step in reopenActions && (
        <Confirm
          title="重新打开本阶段"
          description="保留已有内容，撤销这一阶段及后续的完成标记。之后可交给本地助手修改，再由你标记完成。"
          onClose={() => setReopen(false)}
          onConfirm={() =>
            vm.mutate(
              () =>
                productionService.action(id, {
                  version: production.version,
                  action: reopenActions[step as keyof typeof reopenActions],
                }),
              '已重新打开，可以继续修改',
            )
          }
        />
      )}
      {destination && (
        <Confirm
          title="切换阶段"
          description="这一阶段还有未保存的内容。切换会放弃这些输入；取消后可以先保存。"
          onClose={() => setDestination(null)}
          onConfirm={async () => {
            visit(destination);
            return true;
          }}
        />
      )}
      {reload && (
        <Confirm
          title="确认加载最新版本"
          description={
            dirty ? '未保存的输入会被替换，请先复制需要保留的内容。' : '读取本地助手或云端刚完成的内容。'
          }
          onClose={() => setReload(false)}
          onConfirm={async () => {
            if (await vm.reload()) {
              setDirty(false);
              setFormKey((key) => key + 1);
              return true;
            }
            return false;
          }}
        />
      )}
    </div>
  );
}
function eventLabel(action: string) {
  const labels: Record<string, string> = {
    create: '建立制作',
    edit: '保存内容',
    upload_cover: '上传封面',
    audio_queued: '开始音频任务',
    audio_running: '正在生成音频',
    audio_complete: '音频生成完成',
    audio_failed: '音频生成失败',
  };
  return action.startsWith('record_publication:') ? '记录平台发布' : (labels[action] ?? '更新制作');
}
