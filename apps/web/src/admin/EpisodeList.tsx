import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Input,
  LayerCard,
  toast,
} from '@nocoo/basalt';
import { DataTable, type DataTableColumn } from '@nocoo/basalt/components/data-table';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nocoo/basalt/components/select';
import { TagBadge } from '@nocoo/basalt/components/tag-badge';
import { ArrowUpRight, FileText, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Episode } from '../shared/episode';
import { useCategories } from './categories/useCategories';
import { errorMessage } from './model';
import { adminService } from './service';

export function EpisodeList() {
  const { categories } = useCategories();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [params, setParams] = useSearchParams();
  const [deleting, setDeleting] = useState<Episode | null>(null);
  const [pending, setPending] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const query = params.get('q') ?? '';
  const status = params.get('status') ?? 'all';
  // biome-ignore lint/correctness/useExhaustiveDependencies: The retry key intentionally restarts the request.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    adminService
      .list(controller.signal)
      .then(({ episodes: rows }) => setEpisodes(rows))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value && value !== 'all') next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }
  async function remove() {
    if (!deleting || pending) return;
    setPending(true);
    setDeleteError('');
    try {
      await adminService.remove(deleting.id);
      setEpisodes((current) => current.filter((episode) => episode.id !== deleting.id));
      setDeleting(null);
      toast.success('节目已删除');
    } catch (cause) {
      setDeleteError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }
  const visible = episodes.filter(
    (episode) =>
      (status === 'all' || episode.status === status) &&
      `${episode.title} ${episode.summary} ${episode.tags.join(' ')}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const columns: DataTableColumn<Episode>[] = [
    {
      id: 'number',
      header: '期数',
      width: 72,
      accessor: (episode) => (
        <span className="admin-number">{String(episode.episodeNumber).padStart(3, '0')}</span>
      ),
      sortValue: (episode) => episode.episodeNumber,
    },
    {
      id: 'title',
      header: '节目',
      accessor: (episode) => (
        <div className="admin-episode-cell">
          <img src={episode.coverUrl} alt="" width={48} height={48} loading="lazy" />
          <div>
            <Link to={`/admin/episodes/${episode.id}`}>{episode.title}</Link>
            <span>
              {categories.find((category) => category.id === episode.category)?.name} ·{' '}
              {Math.round(episode.durationSeconds / 60)} 分钟
              {episode.featured ? ' · 首页精选' : ''}
            </span>
          </div>
        </div>
      ),
      sortValue: (episode) => episode.title,
    },
    {
      id: 'status',
      header: '状态',
      width: 110,
      accessor: (episode) => (
        <TagBadge
          name={episode.status === 'published' ? '已发布' : '草稿'}
          color={episode.status === 'published' ? 'success' : 'slate'}
        />
      ),
      sortValue: (episode) => episode.status,
    },
    {
      id: 'audio',
      header: '音频',
      width: 120,
      accessor: (episode) => <span className="admin-muted">{episode.audioUrl ? '已添加' : '待制作'}</span>,
      sortable: false,
    },
    {
      id: 'updated',
      header: '最近更新',
      width: 128,
      accessor: (episode) => (
        <span className="admin-muted">{new Date(episode.updatedAt).toLocaleDateString('zh-CN')}</span>
      ),
      sortValue: (episode) => episode.updatedAt,
    },
    {
      id: 'actions',
      header: '操作',
      width: 132,
      sortable: false,
      accessor: (episode) => (
        <div className="admin-row-actions">
          <Button asChild variant="ghost" size="icon">
            <Link
              to={
                episode.sourceProductionId
                  ? `/admin/productions/${episode.sourceProductionId}`
                  : `/admin/episodes/${episode.id}`
              }
              aria-label={`${episode.sourceProductionId ? '打开制作' : '编辑'} ${episode.title}`}
            >
              <Pencil size={15} />
            </Link>
          </Button>
          {episode.status === 'published' && (
            <Button asChild variant="ghost" size="icon">
              <Link to={`/episodes/${episode.slug}`} aria-label={`查看 ${episode.title}`}>
                <ArrowUpRight size={15} />
              </Link>
            </Button>
          )}
          {!episode.sourceProductionId && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`删除 ${episode.title}`}
              onClick={() => {
                setDeleting(episode);
                setDeleteError('');
              }}
            >
              <Trash2 size={15} />
            </Button>
          )}
        </div>
      ),
    },
  ];
  return (
    <div className="admin-page">
      <PageHeader
        title="节目目录"
        actions={
          <>
            <Button
              variant="outline"
              size="icon"
              aria-label="刷新节目"
              disabled={loading}
              onClick={() => setAttempt(attempt + 1)}
            >
              <RefreshCw size={16} />
            </Button>
            <Button asChild>
              <Link to="/admin/episodes/new">
                <Plus size={16} />
                新建节目
              </Link>
            </Button>
          </>
        }
        filters={
          <div className="admin-filters">
            <Input
              aria-label="搜索节目"
              placeholder="搜索标题、摘要或标签…"
              value={query}
              onChange={(event) => filter('q', event.target.value)}
            />
            <Select value={status} onValueChange={(value) => filter('status', value)}>
              <SelectTrigger className="studio-select-trigger" aria-label="发布状态">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="studio-select-content" collisionPadding={12}>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="draft">草稿</SelectItem>
                <SelectItem value="published">已发布</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />
      <LayerCard padding="none">
        <LayerCard.Header>
          <div className="admin-list-heading">
            <span>
              <FileText size={16} />
              节目库
            </span>
            <span className="admin-muted">
              {loading
                ? '正在同步'
                : `${episodes.length} 期节目 · ${episodes.filter((episode) => episode.status === 'published').length} 期已发布`}
            </span>
          </div>
        </LayerCard.Header>
        <div className="admin-table-wrap">
          <DataTable
            data={visible}
            columns={columns}
            getRowId={(episode) => episode.id}
            loading={loading}
            error={error || undefined}
            onRetry={() => setAttempt(attempt + 1)}
            retryLabel="重试"
            pageSize={12}
            defaultSort={{ id: 'number', dir: 'desc' }}
            aria-label="播客节目列表"
            empty={
              <div className="admin-empty">
                <MicEmpty />
                <strong>{query || status !== 'all' ? '没有找到符合条件的节目' : '第一期，等你开始'}</strong>
                <p>
                  {query || status !== 'all'
                    ? '换个关键词，或清除筛选再试试。'
                    : '新建一期节目，保存文稿、摘要与声音。'}
                </p>
                {query || status !== 'all' ? (
                  <Button variant="outline" onClick={() => setParams({})}>
                    清除筛选
                  </Button>
                ) : (
                  <Button asChild>
                    <Link to="/admin/episodes/new">新建节目</Link>
                  </Button>
                )}
              </div>
            }
          />
        </div>
      </LayerCard>
      <p className="admin-footnote">节目内容和媒体地址会在保存后生效。草稿仅在工作室中可见。</p>
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open && !pending) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这期节目？</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.title}
              ”的节目资料和文稿会永久删除。关联的媒体文件不会被删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p className="admin-error" role="alert">
              {deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>保留节目</AlertDialogCancel>
            <Button variant="destructive" loading={pending} onClick={remove}>
              确认删除
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MicEmpty() {
  return <FileText size={28} strokeWidth={1.3} aria-hidden="true" />;
}
