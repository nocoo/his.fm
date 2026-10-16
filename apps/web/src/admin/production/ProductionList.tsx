import { Button, Input, LayerCard, toast } from '@nocoo/basalt';
import { DataTable, type DataTableColumn } from '@nocoo/basalt/components/data-table';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { TagBadge } from '@nocoo/basalt/components/tag-badge';
import { ToggleGroup, ToggleGroupItem } from '@nocoo/basalt/components/toggle-group';
import { ArrowUpRight, Headphones, LayoutGrid, List, Music2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { stageLabels } from '../../shared/production';
import { useCategories } from '../categories/useCategories';
import { errorMessage } from '../model';
import { adminService } from '../service';
import { Choice, Confirm, Failure } from './controls';
import { canDeleteLibraryEntry, dateLabel, filterLibrary, type LibraryEntry, programLibrary } from './model';
import { productionService } from './service';

const statusLabels = { draft: '草稿', ready: '待发布', published: '已发布' } as const;
function Status({ row }: { row: LibraryEntry }) {
  return (
    <TagBadge
      name={statusLabels[row.status]}
      color={row.status === 'published' ? 'success' : row.status === 'ready' ? 'amber' : 'slate'}
    />
  );
}
function Cover({ row, thumbnail = false }: { row: LibraryEntry; thumbnail?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={thumbnail ? 'library-thumbnail' : 'library-cover'}>
      {row.coverUrl && !failed ? (
        <img src={row.coverUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span className="library-cover-placeholder">
          <Music2 size={thumbnail ? 22 : 42} strokeWidth={1.25} />
          <span>{String(row.episodeNumber).padStart(3, '0')}</span>
        </span>
      )}
    </div>
  );
}
export function ProductionList() {
  const [rows, setRows] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<LibraryEntry | null>(null);
  const [params, setParams] = useSearchParams();
  const categories = useCategories();
  const query = params.get('q') ?? '';
  const status = params.get('status') ?? 'all';
  const category = params.get('category') ?? 'all';
  const layout = params.get('view') === 'list' ? 'list' : 'grid';
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const [productions, episodes] = await Promise.all([
        productionService.list(signal),
        adminService.list(signal),
      ]);
      if (!signal?.aborted) setRows(programLibrary(productions.productions, episodes.episodes));
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
  function filter(key: string, value: string) {
    // History updates before deferred route renders; retain preceding rapid filter changes.
    const next = new URLSearchParams(window.location.search);
    if (value && value !== 'all' && !(key === 'view' && value === 'grid')) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }
  const visible = filterLibrary(rows, query, status, category);
  const categoryName = (row: LibraryEntry) =>
    categories.categories.find((item) => item.id === row.category)?.name ?? row.category;
  const canDelete = (row: LibraryEntry) => canDeleteLibraryEntry(row);
  const columns: DataTableColumn<LibraryEntry>[] = [
    {
      id: 'episode',
      header: '节目',
      sortValue: (row) => row.episodeNumber,
      accessor: (row) => (
        <div className="admin-episode-cell">
          <Link to={row.href} tabIndex={-1} aria-hidden="true">
            <Cover row={row} thumbnail />
          </Link>
          <div>
            <Link to={row.href}>{row.title}</Link>
            <span>
              第 {row.episodeNumber} 期 · {categoryName(row)}
            </span>
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      header: '状态',
      accessor: (row) => (
        <div className="studio-stack studio-gap-sm">
          <Status row={row} />
          <span className="admin-muted">
            {row.production ? stageLabels[row.production.stage] : '独立节目'}
          </span>
        </div>
      ),
      sortValue: (row) => row.status,
    },
    {
      id: 'audio',
      header: '音频',
      accessor: (row) => <span className="admin-muted">{row.audioUrl ? '已上传' : '待上传'}</span>,
      sortable: false,
    },
    {
      id: 'updated',
      header: '最近更新',
      accessor: (row) => (
        <time className="admin-muted" dateTime={row.updatedAt} title={dateLabel(row.updatedAt)}>
          {new Date(row.updatedAt).toLocaleDateString('zh-CN')}
        </time>
      ),
      sortValue: (row) => row.updatedAt,
    },
    {
      id: 'actions',
      header: '操作',
      sortable: false,
      accessor: (row) => (
        <div className="studio-actions">
          <Button variant="ghost" size="sm" asChild>
            <Link to={row.href}>编辑</Link>
          </Button>
          {canDelete(row) && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`删除 ${row.title}`}
              onClick={() => setDeleting(row)}
            >
              <Trash2 size={15} />
            </Button>
          )}
        </div>
      ),
    },
  ];
  const empty = (
    <LayerCard.Empty
      title={query || status !== 'all' || category !== 'all' ? '没有符合条件的节目' : '开始准备第一期节目'}
      description={
        query || status !== 'all' || category !== 'all'
          ? '换个关键词，或清除筛选再试试。'
          : '整理资料、导入逐字稿和成品，在这里管理全部节目。'
      }
      action={
        query || status !== 'all' || category !== 'all' ? (
          <Button variant="outline" onClick={() => setParams(layout === 'list' ? { view: 'list' } : {})}>
            清除筛选
          </Button>
        ) : (
          <Button asChild>
            <Link to="/admin/productions/new">新建节目</Link>
          </Button>
        )
      }
    />
  );
  return (
    <div className="admin-page library-page">
      <PageHeader
        title="节目库"
        description={
          loading && !rows.length
            ? '正在读取节目'
            : `${rows.length} 期节目 · ${rows.filter((row) => row.status === 'published').length} 期已发布`
        }
        actions={
          <>
            <ToggleGroup
              type="single"
              value={layout}
              onValueChange={(value) => {
                if (value) filter('view', value);
              }}
              aria-label="节目显示方式"
            >
              <ToggleGroupItem value="grid" aria-label="封面网格">
                <LayoutGrid size={16} />
              </ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="列表">
                <List size={16} />
              </ToggleGroupItem>
            </ToggleGroup>
            <Button
              variant="outline"
              size="icon"
              aria-label="刷新节目库"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw size={16} />
            </Button>
            <Button asChild>
              <Link to="/admin/productions/new">
                <Plus size={16} />
                新建节目
              </Link>
            </Button>
          </>
        }
        filters={
          <div className="admin-filters library-filters">
            <Input
              aria-label="搜索节目"
              placeholder="搜索标题、摘要或标签"
              value={query}
              onChange={(event) => filter('q', event.target.value)}
            />
            <Choice
              label="节目状态"
              value={status}
              onChange={(value) => filter('status', value)}
              options={[
                { value: 'all', label: '全部状态' },
                ...Object.entries(statusLabels).map(([value, label]) => ({ value, label })),
              ]}
            />
            <Choice
              label="节目栏目"
              value={category}
              onChange={(value) => filter('category', value)}
              options={[
                { value: 'all', label: '全部栏目' },
                ...categories.categories.map((item) => ({ value: item.id, label: item.name })),
              ]}
            />
          </div>
        }
      />
      {categories.error && <Failure error={categories.error} retry={() => void categories.load()} />}
      {layout === 'list' ? (
        <LayerCard padding="none">
          <div className="studio-table">
            <DataTable
              aria-label="节目库列表"
              data={visible}
              columns={columns}
              getRowId={(row) => row.id}
              loading={loading}
              error={error || undefined}
              onRetry={() => void load()}
              empty={empty}
              pageSize={20}
            />
          </div>
        </LayerCard>
      ) : (
        <>
          {error && <Failure error={error} retry={() => void load()} />}
          {loading && !rows.length ? (
            <section className="library-grid" aria-label="正在加载节目">
              {['one', 'two', 'three', 'four', 'five', 'six'].map((key) => (
                <LayerCard key={key} className="library-loading">
                  <LayerCard.Loading label="正在读取节目" />
                </LayerCard>
              ))}
            </section>
          ) : !visible.length && !error ? (
            <LayerCard>{empty}</LayerCard>
          ) : (
            <section className="library-grid" aria-busy={loading} aria-label="节目封面网格">
              {visible.map((row) => (
                <LayerCard key={row.id} padding="none" className="library-card">
                  <Link to={row.href} className="library-card-main" aria-label={row.title}>
                    <Cover row={row} />
                    <div className="library-card-copy">
                      <div className="studio-row">
                        <span className="admin-number">EP {String(row.episodeNumber).padStart(3, '0')}</span>
                        <Status row={row} />
                      </div>
                      <h2>{row.title}</h2>
                      <p className="admin-muted library-description">{row.summary || '尚未填写节目摘要'}</p>
                    </div>
                  </Link>
                  <div className="library-card-footer">
                    <span className="admin-muted">{categoryName(row)}</span>
                    <div className="studio-actions">
                      {row.audioUrl && <Headphones size={14} aria-label="已有音频" />}
                      {row.snapshot?.status === 'published' && (
                        <Button variant="ghost" size="icon" asChild>
                          <Link to={`/episodes/${row.snapshot.slug}`} aria-label={`查看 ${row.title}`}>
                            <ArrowUpRight size={15} />
                          </Link>
                        </Button>
                      )}
                      {canDelete(row) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`删除 ${row.title}`}
                          onClick={() => setDeleting(row)}
                        >
                          <Trash2 size={15} />
                        </Button>
                      )}
                    </div>
                  </div>
                </LayerCard>
              ))}
            </section>
          )}
        </>
      )}
      {deleting && (
        <Confirm
          title="确认删除节目"
          description={`「${deleting.title}」及编辑记录将被删除，关联媒体原件不会删除。此操作无法撤销。`}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            if (deleting.production)
              await productionService.remove(deleting.production.id, deleting.production.version);
            else if (deleting.episode)
              await adminService.remove(deleting.episode.id, deleting.episode.version);
            setRows((current) => current.filter((row) => row.id !== deleting.id));
            toast.success('节目已删除');
          }}
        />
      )}
    </div>
  );
}
