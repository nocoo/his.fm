import { Button, LayerCard, toast } from '@nocoo/basalt';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@nocoo/basalt/components/tabs';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type { Episode } from '../../shared/episode';
import { type ProductionAction, stageLabels } from '../../shared/production';
import { useCategories } from '../categories/useCategories';
import { adminService } from '../service';
import { Assets, FinalReview } from './Assets';
import { BriefForm } from './BriefForm';
import { Confirm, Failure } from './controls';
import { actionLabels, canDeleteProduction, dateLabel, finalMissing } from './model';
import { PublicationPanel } from './PublicationPanel';
import { ScriptStage } from './ScriptStage';
import { productionService } from './service';
import { useProduction } from './useProduction';
import { useUnsavedChanges } from './useUnsavedChanges';

const sections = [
  { id: 'metadata', label: '资料与素材' },
  { id: 'manuscript', label: '逐字稿' },
  { id: 'assets', label: '封面与音频' },
  { id: 'publication', label: '发布' },
] as const;
type Section = (typeof sections)[number]['id'];
type Changes = Parameters<typeof productionService.update>[2];
const reopenActions = {
  metadata: 'reopen_brief',
  manuscript: 'reopen_script',
  assets: 'reopen_assets',
} as const;

export function ProductionEditor() {
  const { id = '' } = useParams();
  return <Editor key={id} id={id} />;
}
function Editor({ id }: { id: string }) {
  const vm = useProduction(id);
  const { categories } = useCategories();
  const navigate = useNavigate();
  const [query, setQuery] = useSearchParams();
  const [drafts, setDrafts] = useState<Partial<Record<Section, boolean>>>({});
  const [reload, setReload] = useState(false);
  const [reopen, setReopen] = useState<keyof typeof reopenActions | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [linkedSnapshot, setLinkedSnapshot] = useState<Episode | null>(null);
  const [formKey, setFormKey] = useState(0);
  const view = useRef<HTMLDivElement>(null);
  const anyDirty = Object.values(drafts).some(Boolean);
  useUnsavedChanges(anyDirty);
  const production = vm.production;
  const source = query.get('source');
  const requested = source !== null ? 'metadata' : query.get('section');
  const section: Section = sections.some((item) => item.id === requested)
    ? (requested as Section)
    : 'metadata';
  const sourceOpen = source !== null && section === 'metadata';
  const markDirty = (key: Section, value: boolean) =>
    setDrafts((current) => (current[key] === value ? current : { ...current, [key]: value }));
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only the content island should scroll during section navigation.
  useLayoutEffect(() => {
    view.current?.closest('.admin-content-island')?.scrollTo({ top: 0, behavior: 'instant' });
  }, [section, source]);
  useEffect(() => {
    const controller = new AbortController();
    adminService
      .list(controller.signal)
      .then(({ episodes }) =>
        setLinkedSnapshot(episodes.find((episode) => episode.sourceProductionId === id) ?? null),
      )
      .catch(() => setLinkedSnapshot(null));
    return () => controller.abort();
  }, [id]);
  if (!production)
    return (
      <div className="admin-page">
        <PageHeader title="节目详情" />
        {vm.error ? (
          <Failure error={vm.error} retry={() => void vm.reload()} />
        ) : (
          <LayerCard.Loading label="正在加载节目" />
        )}
      </div>
    );
  const save = async (changes: Changes) => {
    await vm.mutate(() => productionService.update(id, production.version, changes), '改动已保存');
  };
  const action = async (name: ProductionAction['action'], changes?: Changes) => {
    await vm.mutate(
      () =>
        productionService.action(id, {
          version: production.version,
          action: name,
          ...(changes ? { changes } : {}),
        }),
      actionLabels[name],
    );
  };
  const missing = finalMissing(production);
  const categoryName = categories.find((item) => item.id === production.category)?.name ?? '';
  const completed = {
    metadata: Boolean(production.approvals.brief),
    manuscript: Boolean(production.approvals.script),
    assets: ['final_review', 'ready'].includes(production.stage),
  };
  const deletable = canDeleteProduction(production, linkedSnapshot);
  return (
    <div className="admin-page studio-editor" ref={view}>
      {!sourceOpen && (
        <PageHeader
          title={
            <span className="studio-title-group">
              <Button asChild variant="ghost" size="icon">
                <Link to="/admin" aria-label="返回节目库">
                  <ArrowLeft size={18} />
                </Link>
              </Button>
              <span>{production.title}</span>
            </span>
          }
          description={`第 ${production.episodeNumber} 期 · ${stageLabels[production.stage]} · ${anyDirty ? '有未保存改动' : `已保存 · v${production.version}`}`}
          actions={
            <>
              {deletable && (
                <Button
                  variant="ghost"
                  disabled={vm.pending || anyDirty}
                  aria-label={`删除 ${production.title}`}
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 size={16} />
                  删除节目
                </Button>
              )}
              <Button variant="outline" disabled={vm.pending} onClick={() => setReload(true)}>
                刷新内容
              </Button>
            </>
          }
        />
      )}
      {vm.error && <Failure error={vm.error} />}
      {vm.conflict && (
        <div className="studio-notice" role="alert">
          内容版本已更新，你的输入完整保留。刷新前请复制需要保留的草稿，或核对服务端内容后重试。
        </div>
      )}
      <Tabs value={section} activationMode="manual" onValueChange={(value) => setQuery({ section: value })}>
        {!sourceOpen && (
          <TabsList className="studio-section-nav" aria-label="节目详情分区">
            {sections.map((item) => (
              <TabsTrigger value={item.id} key={item.id} disabled={vm.pending}>
                {item.label}
                {drafts[item.id] && <span title="有未保存改动"> *</span>}
              </TabsTrigger>
            ))}
          </TabsList>
        )}
        {sections.map(({ id: panel }) => (
          <TabsContent
            value={panel}
            key={`${panel}-${formKey}`}
            className="studio-section"
            forceMount
            hidden={panel !== section}
          >
            {panel === 'metadata' && (
              <BriefForm
                value={production}
                pending={vm.pending}
                completed={completed.metadata}
                onDirty={(dirty) => markDirty(panel, dirty)}
                onSave={save}
                onComplete={(changes) => action('approve_brief', changes)}
              />
            )}
            {panel === 'manuscript' && (
              <ScriptStage
                production={production}
                pending={vm.pending}
                dirty={drafts.manuscript ?? false}
                onDirty={(dirty) => markDirty(panel, dirty)}
                onSave={save}
                onComplete={(changes) => action('approve_script', changes)}
              />
            )}
            {panel === 'assets' && (
              <Assets
                production={production}
                categoryName={categoryName}
                pending={vm.pending}
                dirty={drafts.assets ?? false}
                onDirty={(dirty) => markDirty(panel, dirty)}
                onSave={save}
                mutate={vm.mutate}
              />
            )}
            {panel === 'publication' && (
              <div className="studio-stack">
                <details className="studio-review" open={!production.approvals.final}>
                  <summary>发布前检查{production.approvals.final ? ' · 已批准' : ''}</summary>
                  <FinalReview production={production} categoryName={categoryName} />
                  <div className="studio-stage-footer">
                    <p className="admin-muted">
                      {anyDirty
                        ? '先保存所有改动，再提交检查。'
                        : missing.length
                          ? `仍需完成：${missing.join('、')}`
                          : '确认文稿、封面与完整音频，再批准发布。'}
                    </p>
                    <div className="studio-actions">
                      <Button
                        variant="outline"
                        disabled={
                          vm.pending ||
                          anyDirty ||
                          missing.length > 0 ||
                          !production.approvals.script ||
                          completed.assets
                        }
                        onClick={() => void action('submit_final')}
                      >
                        提交最终检查
                      </Button>
                      <Button
                        loading={vm.pending}
                        disabled={anyDirty || !completed.assets || Boolean(production.approvals.final)}
                        onClick={() => void action('approve_final')}
                      >
                        {production.approvals.final ? '成品已批准' : '批准成品'}
                      </Button>
                    </div>
                  </div>
                </details>
                <PublicationPanel
                  production={production}
                  categoryName={categoryName}
                  pending={
                    vm.pending ||
                    Object.entries(drafts).some(([key, dirty]) => key !== 'publication' && dirty)
                  }
                  mutate={vm.mutate}
                  onDirty={(dirty) => markDirty(panel, dirty)}
                />
              </div>
            )}
            {panel in reopenActions && !sourceOpen && completed[panel as keyof typeof completed] && (
              <div className="studio-row">
                <p className="admin-muted">修改已批准内容前，显式重新打开；已有成品与发布快照保留。</p>
                <Button
                  variant="ghost"
                  disabled={anyDirty || vm.pending}
                  onClick={() => setReopen(panel as keyof typeof reopenActions)}
                >
                  重新打开{sections.find((item) => item.id === panel)?.label}
                </Button>
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
      {!sourceOpen && (
        <details className="studio-records">
          <summary>编辑记录 · {production.events.length}</summary>
          <ol className="studio-history">
            {production.events.toReversed().map((event) => (
              <li key={event.id}>
                <strong>
                  {actionLabels[event.action as ProductionAction['action']] ?? eventLabel(event.action)}
                </strong>
                <p className="admin-muted">
                  {dateLabel(event.at)} · {event.actor.kind === 'agent' ? '外部 API' : '编辑'}
                </p>
                {event.feedback && <p className="studio-prose">{event.feedback}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}
      {reopen && (
        <Confirm
          title="重新打开已批准内容"
          description="保留已有内容，撤销该部分及后续的批准。既有发布快照不会被改写。"
          onClose={() => setReopen(null)}
          onConfirm={() =>
            vm.mutate(
              () =>
                productionService.action(id, { version: production.version, action: reopenActions[reopen] }),
              '已重新打开，可以继续修改',
            )
          }
        />
      )}
      {reload && (
        <Confirm
          title="确认加载最新版本"
          description={
            anyDirty
              ? '所有未保存输入会被替换。请先复制需要保留的草稿。'
              : '读取外部 API 或其他编辑刚保存的最新内容。'
          }
          onClose={() => setReload(false)}
          onConfirm={async () => {
            if (!(await vm.reload())) return false;
            setDrafts({});
            setFormKey((key) => key + 1);
            return true;
          }}
        />
      )}
      {deleteOpen && (
        <Confirm
          title="确认删除节目"
          description={`「${production.title}」及编辑记录将被删除，关联媒体原件不会删除。此操作无法撤销。`}
          onClose={() => setDeleteOpen(false)}
          onConfirm={async () => {
            await productionService.remove(production.id, production.version);
            toast.success('节目已删除');
            navigate('/admin');
            return true;
          }}
        />
      )}
    </div>
  );
}
function eventLabel(action: string) {
  const labels: Record<string, string> = {
    create: '建立节目',
    edit: '保存内容',
    upload_cover: '上传封面',
    upload_audio: '上传音频',
    detach_cover: '解除封面关联',
    detach_audio: '解除音频关联',
  };
  return action.startsWith('record_publication:') ? '记录平台发布' : (labels[action] ?? '更新节目');
}
