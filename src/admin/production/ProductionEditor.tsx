import { Button, Field, LayerCard } from '@nocoo/basalt';
import { InputArea } from '@nocoo/basalt/components/input-area';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { type ProductionAction, productionStages, stageLabels } from '../../shared/production';
import { Assets } from './Assets';
import { BriefForm, BriefRead } from './BriefForm';
import { Confirm, CopyButton, Failure } from './controls';
import { actionLabels, dateLabel, finalMissing, nextActions } from './model';
import { PublicationPanel } from './PublicationPanel';
import { productionService } from './service';
import { useProduction } from './useProduction';
import { useUnsavedChanges } from './useUnsavedChanges';

export function ProductionEditor() {
  const { id = '' } = useParams();
  return <Editor key={id} id={id} />;
}
function Editor({ id }: { id: string }) {
  const vm = useProduction(id);
  const [dirty, setDirty] = useState(false);
  const [action, setAction] = useState<ProductionAction['action'] | null>(null);
  const [reload, setReload] = useState(false);
  const [formKey, setFormKey] = useState(0);
  useUnsavedChanges(dirty);
  const production = vm.production;
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
  const stage = production.stage;
  const hasAssets = ['production', 'final_review', 'ready'].includes(stage);
  const save = async (fields: Parameters<typeof productionService.update>[2]) => {
    if (await vm.mutate(() => productionService.update(id, production.version, fields), '改动已保存'))
      setDirty(false);
  };
  const feedback = action ? action.startsWith('revise') || action.startsWith('reopen') : false;
  const disabled = vm.pending || dirty;
  return (
    <div className="admin-page">
      <PageHeader
        title={production.title}
        description={`第 ${production.episodeNumber} 期 · ${stageLabels[stage]} · ${dirty ? '有尚未保存的改动' : `更新于 ${dateLabel(production.updatedAt)}`}`}
        actions={
          <>
            <Button variant="ghost" asChild>
              <Link to="/admin">制作列表</Link>
            </Button>
            <Button variant="outline" disabled={vm.pending} onClick={() => setReload(true)}>
              刷新内容
            </Button>
          </>
        }
      />
      <ol className="studio-progress" aria-label="节目制作进度">
        {productionStages.map((item, index) => (
          <li
            key={item}
            aria-current={item === stage ? 'step' : undefined}
            data-done={index < productionStages.indexOf(stage)}
          >
            <span>{index + 1}</span>
            {stageLabels[item]}
          </li>
        ))}
      </ol>
      {vm.error && <Failure error={vm.error} />}
      {vm.conflict && (
        <div className="studio-notice" role="alert">
          当前版本或阶段已改变。输入仍保留，请先复制需要保留的内容，再刷新核对最新版本。
          <Button variant="outline" size="sm" onClick={() => setReload(true)}>
            加载最新版本
          </Button>
        </div>
      )}
      <div className="studio-row">
        <p className="admin-muted">
          {dirty
            ? '请先保存当前改动，再进行阶段操作。'
            : stage.endsWith('review')
              ? '请由编辑本人审阅内容，再执行人工确认或填写修改意见。'
              : 'Hermes 可以准备内容，审批与发布由编辑本人完成。'}
        </p>
        <div className="studio-actions">
          {nextActions[stage].map((next) => (
            <Button
              key={next}
              variant={next.startsWith('revise') ? 'outline' : 'default'}
              disabled={
                disabled ||
                (next === 'submit_final' && finalMissing(production).length > 0) ||
                (next === 'submit_brief' && (!production.sources.length || !production.intent.trim())) ||
                (next === 'submit_script' && !production.transcript.trim())
              }
              onClick={() => setAction(next)}
            >
              {actionLabels[next]}
            </Button>
          ))}
        </div>
      </div>
      <div key={`${stage}-${formKey}`} className="studio-stack">
        {stage === 'draft' ? (
          <BriefForm value={production} pending={vm.pending} onDirty={() => setDirty(true)} onSave={save} />
        ) : (
          <BriefRead value={production} />
        )}
        {(production.transcript || (stage !== 'draft' && stage !== 'brief_review')) && (
          <LayerCard padding="none">
            <LayerCard.Header className="studio-row">
              <strong>逐字稿 · 第 {production.scriptVersion} 版</strong>
              {stage === 'scripting' && (
                <CopyButton
                  label="复制 Hermes 逐字稿提示词"
                  read={async () => (await productionService.prompts(id)).script}
                />
              )}
            </LayerCard.Header>
            <LayerCard.Body className="studio-stack studio-padding">
              {stage === 'scripting' ? (
                <form
                  className="studio-stack"
                  onChange={() => setDirty(true)}
                  onSubmit={async (event) => {
                    event.preventDefault();
                    await save({ transcript: String(new FormData(event.currentTarget).get('transcript')) });
                  }}
                >
                  <Field
                    label="完整逐字稿"
                    htmlFor="production-transcript"
                    hint="最多 50,000 字。保存后提交人工审核，批准后才能制作声音。"
                  >
                    <InputArea
                      id="production-transcript"
                      name="transcript"
                      defaultValue={production.transcript}
                      maxLength={50000}
                      rows={20}
                      disabled={vm.pending}
                    />
                  </Field>
                  <div className="studio-actions">
                    <Button type="submit" loading={vm.pending}>
                      保存逐字稿
                    </Button>
                  </div>
                </form>
              ) : (
                <details open={['draft', 'brief_review', 'script_review'].includes(stage)}>
                  <summary>阅读全文 · {production.transcript.length.toLocaleString('zh-CN')} 字</summary>
                  <p className="studio-prose studio-transcript">{production.transcript}</p>
                </details>
              )}
            </LayerCard.Body>
          </LayerCard>
        )}
        {!hasAssets && (production.summary || production.description) && (
          <LayerCard padding="none">
            <LayerCard.Header>
              <strong>已有摘要与发布简介</strong>
            </LayerCard.Header>
            <LayerCard.Body className="studio-stack studio-padding">
              <p className="admin-muted">已有文案供审阅参考，在素材制作阶段可以继续编辑。</p>
              {production.summary && (
                <div>
                  <strong>节目摘要</strong>
                  <p className="studio-prose">{production.summary}</p>
                </div>
              )}
              {production.description && (
                <div>
                  <strong>发布简介</strong>
                  <p className="studio-prose">{production.description}</p>
                </div>
              )}
            </LayerCard.Body>
          </LayerCard>
        )}
        {hasAssets && (
          <>
            <div className="studio-actions">
              <CopyButton
                label="复制 Hermes 封面提示词"
                read={async () => (await productionService.prompts(id)).cover}
              />
              <CopyButton
                label="复制 Hermes 简介提示词"
                read={async () => (await productionService.prompts(id)).description}
              />
            </div>
            <Assets
              production={production}
              pending={vm.pending}
              dirty={dirty}
              onDirty={() => setDirty(true)}
              onSave={save}
              mutate={vm.mutate}
            />
          </>
        )}
        {stage === 'ready' && (
          <PublicationPanel production={production} pending={vm.pending} mutate={vm.mutate} />
        )}
      </div>
      <LayerCard padding="none">
        <LayerCard.Header>
          <strong>审核与制作记录</strong>
        </LayerCard.Header>
        <LayerCard.Body className="studio-stack studio-padding">
          <div className="studio-grid studio-approvals">
            {(['brief', 'script', 'final'] as const).map((key) => (
              <div key={key}>
                <strong>{key === 'brief' ? '选题确认' : key === 'script' ? '逐字稿批准' : '成品确认'}</strong>
                <p className="admin-muted">
                  {production.approvals[key]
                    ? `${production.approvals[key].by} · ${dateLabel(production.approvals[key].at)}`
                    : '待人工确认'}
                </p>
              </div>
            ))}
          </div>
          <details>
            <summary>查看全部记录（{production.events.length}）</summary>
            <ol className="studio-history">
              {production.events.toReversed().map((event) => (
                <li key={event.id}>
                  <strong>
                    {actionLabels[event.action as ProductionAction['action']] ?? eventLabel(event.action)}
                  </strong>
                  <p className="admin-muted">
                    {event.actor.kind === 'human' ? '编辑' : '智能助手'} {event.actor.name} ·{' '}
                    {dateLabel(event.at)}
                  </p>
                  {event.feedback && <p className="studio-prose">{event.feedback}</p>}
                </li>
              ))}
            </ol>
          </details>
          {stage !== 'draft' && (
            <div className="studio-actions">
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => setAction('reopen_brief')}
              >
                重新修改选题
              </Button>
              {hasAssets && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => setAction('reopen_script')}
                >
                  重新修改逐字稿
                </Button>
              )}
              {stage === 'ready' && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => setAction('reopen_assets')}
                >
                  重新制作素材
                </Button>
              )}
            </div>
          )}
        </LayerCard.Body>
      </LayerCard>
      {action && (
        <Confirm
          title={actionLabels[action]}
          feedback={feedback}
          description={
            action === 'reopen_brief'
              ? '这会清除逐字稿、成品素材和全部审批。历史发布记录会保留，请说明重新修改的原因。'
              : action === 'reopen_script'
                ? '这会清除成品素材及逐字稿、成品审批，后续需要重新生成和审核。'
                : action === 'approve_final'
                  ? '请确认已经检查封面、完整音频和发布文案，三项均可对外发布。此确认由你本人负责。'
                  : feedback
                    ? '填写具体修改意见后，制作会返回对应阶段。'
                    : action.startsWith('approve')
                      ? '请确认你已亲自审阅当前内容，并同意进入下一制作阶段。'
                      : '提交已保存的内容，等待编辑本人审核。'
          }
          onClose={() => setAction(null)}
          onConfirm={(text) =>
            vm.mutate(
              () =>
                productionService.action(id, {
                  version: production.version,
                  action,
                  ...(feedback ? { feedback: text } : {}),
                }),
              '制作阶段已更新',
            )
          }
        />
      )}
      {reload && (
        <Confirm
          title="确认加载最新版本"
          description={
            dirty
              ? '尚未保存的输入将被替换，请先复制需要保留的内容。'
              : '重新读取服务器上的最新内容和制作状态。'
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
    cover_uploaded: '上传封面',
    audio_queued: '提交音频生成',
    audio_running: '开始生成音频',
    audio_complete: '音频生成完成',
    audio_failed: '音频生成失败',
    publish: '人工确认发布',
  };
  return labels[action] ?? '更新制作';
}
