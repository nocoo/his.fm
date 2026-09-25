import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  LayerCard,
} from '@nocoo/basalt';
import { StatCard, StatGrid } from '@nocoo/basalt/charts/stat-card';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { TagBadge } from '@nocoo/basalt/components/tag-badge';
import { AudioLines, File, Image as ImageIcon, Play, RefreshCw, Trash2, Video } from 'lucide-react';
import { useState } from 'react';
import { formatBytes, type StorageObject, storageKindLabels, storageKinds } from '../../shared/storage';
import { getEnvironment } from '../environment';
import { Choice, Confirm, CopyButton, Failure } from '../production/controls';
import { dateLabel } from '../production/model';
import { filterStorage, storageStateLabels, storageSummary } from './model';
import { storageMediaUrl } from './service';
import { useStorage } from './useStorage';
import './storage.css';

const icons = { image: ImageIcon, audio: AudioLines, video: Video, other: File };

function Preview({ object, close }: { object: StorageObject; close: () => void }) {
  const [failed, setFailed] = useState(false);
  const url = storageMediaUrl(object.key);
  const raster = object.kind === 'image' && !object.key.toLowerCase().endsWith('.svg');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent size="lg" className="storage-preview">
        <DialogTitle>资源预览</DialogTitle>
        <DialogDescription className="studio-wrap">{object.key}</DialogDescription>
        {raster && <img src={url} alt={object.key} onError={() => setFailed(true)} />}
        {object.kind === 'audio' && (
          // biome-ignore lint/a11y/useMediaCaption: This owner-only preview inspects raw assets without caption tracks.
          <audio
            controls
            preload="metadata"
            src={url}
            onError={() => setFailed(true)}
            aria-label="音频预览"
          />
        )}
        {object.kind === 'video' && (
          // biome-ignore lint/a11y/useMediaCaption: This owner-only preview inspects raw assets without caption tracks.
          <video
            controls
            playsInline
            preload="metadata"
            src={url}
            onError={() => setFailed(true)}
            aria-label="视频预览"
          />
        )}
        {!raster && !['audio', 'video'].includes(object.kind) && <p>此格式不支持内嵌预览。</p>}
        {failed && (
          <p role="alert" className="admin-error">
            无法预览，文件可能已删除或浏览器不支持此格式。
          </p>
        )}
        <div className="studio-row">
          <span>
            {formatBytes(object.size)} · {dateLabel(object.uploaded)}
          </span>
          <CopyButton
            label="复制 CDN 链接"
            read={() => `https://f.no.mt/${object.key.split('/').map(encodeURIComponent).join('/')}`}
            disabled={getEnvironment() === 'local'}
          />
        </div>
        <p className="admin-muted">{object.reasons.join('；')}</p>
      </DialogContent>
    </Dialog>
  );
}

export default function StoragePage() {
  const vm = useStorage();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [state, setState] = useState('all');
  const [sort, setSort] = useState('size');
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<StorageObject | null>(null);
  const [confirm, setConfirm] = useState(false);
  const summary = storageSummary(vm.objects);
  const visible = filterStorage(vm.objects, query, kind, state, sort);
  const pages = Math.max(1, Math.ceil(visible.length / 30));
  const currentPage = Math.min(page, pages);
  const selected = vm.objects.filter((object) => vm.selected.has(object.key));
  const selectedBytes = selected.reduce((total, object) => total + object.size, 0);
  const busy = vm.loading || vm.cleaning;
  const deleted = vm.results.filter((item) => item.status === 'deleted');
  const remaining = vm.results.filter((item) => item.status !== 'deleted');
  return (
    <div className="admin-page storage-page">
      <PageHeader
        title="资源管理"
        description={`his-fm · ${getEnvironment() === 'local' ? '本地' : '生产'}存储。查看空间去向，留下需要的文件。`}
        actions={
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setPage(1);
              void vm.scan();
            }}
          >
            <RefreshCw size={16} />
            {vm.loading ? '扫描中' : '重新扫描'}
          </Button>
        }
      />
      <StatGrid columns={3} className="storage-stats">
        <StatCard
          title={vm.complete ? '总占用' : '已扫描占用'}
          value={formatBytes(summary.bytes)}
          subtitle={`${summary.count} 个文件`}
        />
        <StatCard title="音频与视频" value={formatBytes(summary.mediaBytes)} subtitle="含制作片段" />
        <StatCard
          title="可清理空间"
          value={formatBytes(summary.unusedBytes)}
          subtitle={`${summary.unusedCount} 个文件`}
        />
      </StatGrid>
      <div className="studio-notice">
        <p>节目引用、品牌素材、生成任务与最近 24 小时的上传受保护。站外使用情况需自行确认，删除不可撤销。</p>
      </div>
      <p role="status" className="admin-muted">
        {vm.loading
          ? `正在分页扫描，已发现 ${summary.count} 个文件…`
          : vm.complete
            ? '扫描完成 · 清理前会再次核对引用与文件版本'
            : '扫描未完成，暂不可清理'}
      </p>
      {vm.error && <Failure error={vm.error} retry={busy ? undefined : () => void vm.scan()} />}
      {vm.results.length > 0 && (
        <LayerCard className="studio-stack" padding="md">
          <p role="status">
            {vm.cleaning ? '正在清理' : '本次清理'}：已删除 {deleted.length} 个，释放{' '}
            {formatBytes(deleted.reduce((sum, item) => sum + item.bytes, 0))}；跳过或失败 {remaining.length}{' '}
            个。
          </p>
          {remaining.length > 0 && (
            <details>
              <summary>查看未删除的文件</summary>
              <ul className="storage-results">
                {remaining.map((item) => (
                  <li key={item.key}>
                    {item.key}：{item.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </LayerCard>
      )}
      <LayerCard padding="none">
        <div className="storage-toolbar studio-stack studio-padding">
          <div className="storage-filters">
            <Input
              aria-label="搜索资源"
              placeholder="文件名或引用节目"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
            <Choice
              label="资源类型"
              value={kind}
              onChange={(value) => {
                setKind(value);
                setPage(1);
              }}
              options={[
                { value: 'all', label: '全部类型' },
                ...storageKinds.map((value) => ({ value, label: storageKindLabels[value] })),
              ]}
            />
            <Choice
              label="引用状态"
              value={state}
              onChange={(value) => {
                setState(value);
                setPage(1);
              }}
              options={[
                { value: 'all', label: '全部状态' },
                ...Object.entries(storageStateLabels).map(([value, label]) => ({ value, label })),
              ]}
            />
            <Choice
              label="资源排序"
              value={sort}
              onChange={(value) => {
                setSort(value);
                setPage(1);
              }}
              options={[
                { value: 'size', label: '大文件优先' },
                { value: 'newest', label: '最新上传' },
                { value: 'oldest', label: '最早上传' },
              ]}
            />
          </div>
          <div className="studio-row">
            <div className="studio-actions">
              <Button
                variant="outline"
                size="sm"
                disabled={!vm.complete || busy || !visible.some((object) => object.state === 'unused')}
                onClick={() =>
                  vm.setSelected(
                    new Set(
                      visible.filter((object) => object.state === 'unused').map((object) => object.key),
                    ),
                  )
                }
              >
                选择筛选结果中可清理的文件
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || !selected.length}
                onClick={() => vm.setSelected(new Set())}
              >
                取消选择
              </Button>
            </div>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy || !vm.complete || !selected.length}
              onClick={() => setConfirm(true)}
            >
              <Trash2 size={15} />
              清理 {selected.length} 个 · {formatBytes(selectedBytes)}
            </Button>
          </div>
        </div>
        <ul className="storage-list" aria-label="R2 资源列表" aria-busy={vm.loading}>
          {visible.slice((currentPage - 1) * 30, currentPage * 30).map((object) => {
            const Icon = icons[object.kind];
            return (
              <li key={object.key} className="storage-item">
                <Checkbox
                  aria-label={`选择 ${object.key}`}
                  checked={vm.selected.has(object.key)}
                  disabled={!vm.complete || busy || object.state !== 'unused'}
                  onCheckedChange={() => vm.toggle(object.key)}
                />
                <Button
                  variant="ghost"
                  className="storage-thumbnail"
                  aria-label={`预览 ${object.key}`}
                  onClick={() => setPreview(object)}
                >
                  {object.kind === 'image' && !object.key.toLowerCase().endsWith('.svg') ? (
                    <img loading="lazy" src={storageMediaUrl(object.key)} alt="" />
                  ) : (
                    <Icon size={24} strokeWidth={1.5} />
                  )}
                </Button>
                <div className="storage-info">
                  <strong>{object.key}</strong>
                  <div className="storage-meta">
                    <TagBadge
                      name={storageStateLabels[object.state]}
                      color={
                        object.state === 'unused'
                          ? 'amber'
                          : object.state === 'referenced'
                            ? 'success'
                            : 'slate'
                      }
                    />
                    <span>
                      {storageKindLabels[object.kind]} · {dateLabel(object.uploaded)}
                    </span>
                  </div>
                  <span className="admin-muted">{object.reasons.join('；')}</span>
                </div>
                <div className="storage-size">
                  <strong>{formatBytes(object.size)}</strong>
                  <Button variant="ghost" size="sm" onClick={() => setPreview(object)}>
                    <Play size={13} />
                    预览
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        {!visible.length && (
          <LayerCard.Empty
            title={vm.loading ? '正在读取资源' : vm.error ? '暂时无法显示资源' : '没有匹配的资源'}
            description={vm.loading ? '扫描结果会逐页出现。' : '可尝试调整筛选条件或重新扫描。'}
          />
        )}
        <div className="studio-row studio-padding">
          <span className="admin-muted">
            筛选后 {visible.length} 个 · 第 {currentPage} / {pages} 页
          </span>
          <div className="studio-actions">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === pages}
              onClick={() => setPage(currentPage + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      </LayerCard>
      {preview && <Preview key={preview.key} object={preview} close={() => setPreview(null)} />}
      {confirm && (
        <Confirm
          title="永久删除选中资源"
          description={`将从${getEnvironment() === 'local' ? '本地' : '生产'} R2 删除 ${selected.length} 个文件，预计释放 ${formatBytes(selectedBytes)}（包含筛选外已选文件）。请先确认站外没有使用这些链接；CDN 缓存可能暂时保留副本。`}
          onClose={() => setConfirm(false)}
          onConfirm={vm.cleanup}
        />
      )}
    </div>
  );
}
