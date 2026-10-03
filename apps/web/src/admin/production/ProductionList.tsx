import { Button, Input, LayerCard, toast } from '@nocoo/basalt';
import { DataTable, type DataTableColumn } from '@nocoo/basalt/components/data-table';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { TagBadge } from '@nocoo/basalt/components/tag-badge';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { type Production, productionStages, stageLabels } from '../../shared/production';
import { errorMessage } from '../model';
import { Choice, Confirm } from './controls';
import { dateLabel, latestPublication } from './model';
import { productionService } from './service';

export function ProductionList() {
  const [rows, setRows] = useState<Production[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<Production | null>(null);
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const stage = params.get('stage') ?? 'all';
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const result = await productionService.list(signal);
      setRows(result.productions);
    } catch (cause) {
      if (!signal?.aborted) setError(errorMessage(cause));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== 'all') next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const visible = rows.filter(
    (row) =>
      (stage === 'all' || row.stage === stage) &&
      `${row.title} ${row.intent} ${row.tags.join(' ')}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const columns: DataTableColumn<Production>[] = [
    {
      id: 'title',
      header: '制作中的节目',
      accessor: (row) => (
        <div className="studio-stack studio-gap-sm">
          <Link className="studio-link" to={`/admin/productions/${row.id}`}>
            {row.title}
          </Link>
          <span className="admin-muted">
            第 {row.episodeNumber} 期 · {row.targetDurationSeconds / 60} 分钟
          </span>
        </div>
      ),
    },
    {
      id: 'stage',
      header: '制作阶段',
      accessor: (row) => (
        <TagBadge
          name={stageLabels[row.stage]}
          color={row.stage === 'ready' ? 'success' : row.stage.endsWith('review') ? 'amber' : 'slate'}
        />
      ),
    },
    {
      id: 'assets',
      header: '素材进度',
      accessor: (row) => (
        <span className="admin-muted">
          封面{row.assets.cover ? '已备' : '待制'} · 音频{row.assets.audio ? '已备' : '待制'}
        </span>
      ),
    },
    {
      id: 'publication',
      header: '平台发布',
      accessor: (row) => (
        <div className="studio-stack studio-gap-sm">
          {(['wechat', 'xiaoyuzhou'] as const).map((platform) => {
            const publication = latestPublication(row, platform);
            return (
              <span key={platform} className="admin-muted">
                {platform === 'wechat' ? '微信' : '小宇宙'} ·{' '}
                {publication ? (
                  <time dateTime={publication.publishedAt}>{dateLabel(publication.publishedAt)}</time>
                ) : (
                  '未发布'
                )}
              </span>
            );
          })}
        </div>
      ),
    },
    {
      id: 'updated',
      header: '最近更新',
      accessor: (row) => dateLabel(row.updatedAt),
      sortValue: (row) => row.updatedAt,
    },
    {
      id: 'actions',
      header: '操作',
      sortable: false,
      accessor: (row) => (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`删除 ${row.title}`}
          disabled={row.publications.length > 0}
          title={row.publications.length ? '已有发布记录，不能删除' : '删除制作'}
          onClick={() => setDeleting(row)}
        >
          <Trash2 size={15} />
        </Button>
      ),
    },
  ];
  return (
    <div className="admin-page">
      <PageHeader
        title="制作中的节目"
        actions={
          <>
            <Button
              variant="outline"
              size="icon"
              aria-label="刷新制作列表"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw size={16} />
            </Button>
            <Button asChild>
              <Link to="/admin/productions/new">
                <Plus size={16} />
                新建制作
              </Link>
            </Button>
          </>
        }
        filters={
          <div className="admin-filters">
            <Input
              aria-label="搜索制作"
              placeholder="搜索标题、意图或标签"
              value={query}
              onChange={(event) => filter('q', event.target.value)}
            />
            <Choice
              label="制作阶段"
              value={stage}
              onChange={(next) => filter('stage', next)}
              options={[
                { value: 'all', label: '全部阶段' },
                ...productionStages.map((value) => ({ value, label: stageLabels[value] })),
              ]}
            />
          </div>
        }
      />
      <LayerCard padding="none">
        <div className="studio-table">
          <DataTable
            aria-label="节目制作列表"
            data={visible}
            columns={columns}
            loading={loading}
            error={error || undefined}
            onRetry={() => void load()}
            empty={
              <LayerCard.Empty
                title={query || stage !== 'all' ? '没有符合条件的制作' : '开始准备第一期节目'}
                description="整理素材，写下创作意图，和主控一起制作。"
                action={
                  <Button asChild variant="outline">
                    <Link to="/admin/productions/new">新建制作</Link>
                  </Button>
                }
              />
            }
          />
        </div>
      </LayerCard>
      {deleting && (
        <Confirm
          title="确认删除制作"
          description={`「${deleting.title}」及制作记录将被删除，此操作无法撤销。`}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await productionService.remove(deleting.id, deleting.version);
            setRows(rows.filter((row) => row.id !== deleting.id));
            toast.success('制作已删除');
          }}
        />
      )}
    </div>
  );
}
