import { Button, Field, Input, LayerCard, Switch, toast } from '@nocoo/basalt';
import { InputArea } from '@nocoo/basalt/components/input-area';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nocoo/basalt/components/select';
import { ArrowLeft, ArrowUpRight, Save, Trash2 } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { FramedCover } from '../components/FramedCover';
import type { Episode } from '../shared/episode';
import { episodePublicPath } from '../shared/episode-url';
import { type Mention, mentionsSchema } from '../shared/mentions';
import type { SeoOverride } from '../shared/seo';
import { CategorySelect } from './categories/CategorySelect';
import { useCategories } from './categories/useCategories';
import { MentionsEditor } from './MentionsEditor';
import { MarkdownEditor } from './markdown/MarkdownEditor';
import { emptyEpisode, errorMessage, readEpisodeForm, toLocalDateTime } from './model';
import { CoverDownload } from './production/CoverDownload';
import { Confirm } from './production/controls';
import { canDeleteStandaloneEpisode } from './production/model';
import { useUnsavedChanges } from './production/useUnsavedChanges';
import { SeoOverrideFields } from './seo/SeoOverrideFields';
import { adminService } from './service';

export function EpisodeEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [coverPreview, setCoverPreview] = useState('');
  const [coverCopy, setCoverCopy] = useState({ title: '', episodeNumber: 1, category: '' });
  const { categories } = useCategories();
  const [mentions, setMentions] = useState<Mention[]>(emptyEpisode.mentions);
  const [seo, setSeo] = useState<SeoOverride>(emptyEpisode.seo);
  useUnsavedChanges(dirty);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The retry key intentionally restarts the request.
  useEffect(() => {
    setError('');
    setErrors({});
    setEpisode(null);
    setDirty(false);
    setLoading(Boolean(id));
    if (!id) return;
    const controller = new AbortController();
    adminService
      .get(id, controller.signal)
      .then(({ episode: result }) => {
        setEpisode(result);
        setMentions(result.mentions);
        setSeo(result.seo);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, attempt]);
  useEffect(() => {
    setCoverPreview(episode?.coverUrl ?? emptyEpisode.coverUrl);
    const source = episode ?? emptyEpisode;
    setCoverCopy({ title: source.title, episodeNumber: source.episodeNumber, category: source.category });
  }, [episode]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || episode?.sourceProductionId || (id && !episode)) return;
    const result = readEpisodeForm(new FormData(event.currentTarget));
    setErrors(result.errors ?? {});
    setError('');
    if (!result.data) return;
    let parsedMentions: Mention[];
    try {
      parsedMentions = mentionsSchema.parse(
        mentions
          .filter((mention) => mention.name.trim() || mention.description.trim() || mention.url)
          .map((mention) => ({
            name: mention.name.trim(),
            description: mention.description.trim(),
            ...(mention.url?.trim() ? { url: mention.url.trim() } : {}),
          })),
      );
    } catch {
      setErrors({ mentions: '请检查「本期提到」的名称、说明和链接格式' });
      return;
    }
    setPending(true);
    try {
      const payload = { ...result.data, mentions: parsedMentions, seo };
      const { episode: saved } =
        id && episode
          ? await adminService.update(id, payload, episode.version)
          : await adminService.create(payload);
      setEpisode(saved);
      setDirty(false);
      toast.success(saved.status === 'published' ? '节目已发布，网站内容已更新' : '草稿已保存');
      if (!id) navigate(`/admin/episodes/${saved.id}`, { replace: true });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }
  const value = episode ?? emptyEpisode;
  const deletable = episode ? canDeleteStandaloneEpisode(episode) : false;
  if (episode?.sourceProductionId) {
    return (
      <div className="admin-page">
        <PageHeader
          title={
            <span className="studio-title-group">
              <Button variant="ghost" size="icon" asChild>
                <Link to="/admin" aria-label="返回节目库">
                  <ArrowLeft size={18} />
                </Link>
              </Button>
              <span>{episode.title}</span>
            </span>
          }
          description="这是制作流程同步的已发布快照。请回到制作记录管理内容与发布。"
          actions={
            <Button asChild>
              <Link to={`/admin/productions/${episode.sourceProductionId}`}>打开制作记录</Link>
            </Button>
          }
        />
        <LayerCard>
          <div className="studio-stack">
            <strong>已发布节目 · 第 {episode.episodeNumber} 期</strong>
            <p className="studio-prose">{episode.summary}</p>
            <Link
              className="studio-link"
              to={episodePublicPath(episode.category, episode.slug)}
              target="_blank"
            >
              查看节目页面 ↗
            </Link>
          </div>
        </LayerCard>
      </div>
    );
  }
  return (
    <div className="admin-page">
      <PageHeader
        title={
          <span className="studio-title-group">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/admin" aria-label="返回节目库">
                <ArrowLeft size={18} />
              </Link>
            </Button>
            <span>{id ? value.title : '直接录入成品'}</span>
          </span>
        }
        actions={
          <>
            {deletable && (
              <Button variant="ghost" disabled={pending || dirty} onClick={() => setDeleteOpen(true)}>
                <Trash2 size={16} />
                删除节目
              </Button>
            )}
            {episode?.status === 'published' && (
              <Button variant="outline" asChild>
                <Link to={episodePublicPath(episode.category, episode.slug)} target="_blank">
                  查看页面
                  <ArrowUpRight size={16} />
                </Link>
              </Button>
            )}
            <Button
              form="episode-form"
              type="submit"
              loading={pending}
              disabled={loading || Boolean(id && !episode)}
            >
              <Save size={16} />
              保存节目
            </Button>
          </>
        }
      />
      {loading ? (
        <LayerCard>
          <LayerCard.Loading label="正在读取节目" />
        </LayerCard>
      ) : id && !episode ? (
        <LayerCard>
          <LayerCard.Empty
            title="节目暂时无法读取"
            description={error}
            action={<Button onClick={() => setAttempt(attempt + 1)}>重新加载</Button>}
          />
        </LayerCard>
      ) : (
        <form
          id="episode-form"
          key={episode?.updatedAt ?? 'new'}
          onSubmit={save}
          onChange={(event) => {
            setDirty(true);
            const data = new FormData(event.currentTarget);
            setCoverCopy({
              title: String(data.get('title') ?? ''),
              episodeNumber: Number(data.get('episodeNumber')),
              category: String(data.get('category') ?? ''),
            });
          }}
          className="admin-editor-form"
        >
          {(error || Object.keys(errors).length > 0) && (
            <div className="admin-error-banner" role="alert">
              {error || '请检查下方标记的字段，再试一次。'}
            </div>
          )}
          <fieldset disabled={pending} className="admin-editor-grid">
            <div className="admin-editor-main">
              <LayerCard padding="none">
                <LayerCard.Header>
                  <strong>节目内容</strong>
                </LayerCard.Header>
                <LayerCard.Body className="admin-fields">
                  <Field label="节目标题" htmlFor="title" required error={errors.title}>
                    <Input
                      id="title"
                      name="title"
                      defaultValue={value.title}
                      placeholder="一个具体、让人想听下去的问题"
                      maxLength={160}
                      required
                    />
                  </Field>
                  <Field
                    label="摘要"
                    htmlFor="summary"
                    required
                    error={errors.summary}
                    hint="用于列表与分享，告诉听众这一期会聊到什么。"
                  >
                    <InputArea
                      id="summary"
                      name="summary"
                      defaultValue={value.summary}
                      rows={4}
                      maxLength={2000}
                      required
                      placeholder="这一期，我们从……聊起。"
                    />
                  </Field>
                  <Field
                    label="逐字稿"
                    htmlFor="transcript"
                    error={errors.transcript}
                    hint="保留自然的停顿与表达，让内容可以被阅读、校对和继续打磨。"
                  >
                    <MarkdownEditor
                      label="逐字稿"
                      disabled={pending}
                      onChange={() => setDirty(true)}
                      id="transcript"
                      name="transcript"
                      defaultValue={value.transcript}
                      maxLength={100000}
                      placeholder="写下这一期的完整讲述……"
                    />
                  </Field>
                  <Field
                    label="节目笔记"
                    htmlFor="showNotes"
                    error={errors.showNotes}
                    hint="补充资料来源、提到的项目或延伸阅读。"
                  >
                    <MarkdownEditor
                      label="节目笔记"
                      disabled={pending}
                      onChange={() => setDirty(true)}
                      id="showNotes"
                      name="showNotes"
                      defaultValue={value.showNotes}
                      maxLength={20000}
                      placeholder="资料与延伸阅读"
                    />
                  </Field>
                </LayerCard.Body>
              </LayerCard>
              <MentionsEditor
                value={mentions}
                disabled={pending}
                onChange={(next) => {
                  setMentions(next);
                  setDirty(true);
                }}
              />
              <LayerCard padding="none">
                <LayerCard.Header>
                  <strong>节目 SEO</strong>
                </LayerCard.Header>
                <LayerCard.Body>
                  <SeoOverrideFields
                    idPrefix="episode-seo"
                    disabled={pending}
                    value={seo}
                    onChange={(next) => {
                      setSeo(next);
                      setDirty(true);
                    }}
                  />
                </LayerCard.Body>
              </LayerCard>
              {errors.mentions && (
                <div className="admin-error-banner" role="alert">
                  {errors.mentions}
                </div>
              )}
              <LayerCard padding="none">
                <LayerCard.Header>
                  <strong>封面与声音</strong>
                </LayerCard.Header>
                <LayerCard.Body className="admin-fields">
                  <Field
                    label="封面地址"
                    htmlFor="coverUrl"
                    required
                    error={errors.coverUrl}
                    hint="使用 HTTPS 地址，或 /images/、/media/ 开头的站内路径。"
                  >
                    <Input
                      id="coverUrl"
                      name="coverUrl"
                      defaultValue={value.coverUrl}
                      required
                      onChange={(event) => setCoverPreview(event.target.value)}
                    />
                  </Field>
                  {coverPreview.trim() && (
                    <FramedCover
                      className="studio-cover"
                      src={coverPreview.trim()}
                      title={coverCopy.title}
                      episodeNumber={coverCopy.episodeNumber}
                      categoryName={categories.find((item) => item.id === coverCopy.category)?.name ?? ''}
                      alt={`${coverCopy.title || '节目'}的封面预览`}
                    />
                  )}
                  {episode && (
                    <CoverDownload
                      resource="episodes"
                      id={episode.id}
                      version={episode.version}
                      episodeNumber={episode.episodeNumber}
                      disabled={dirty || pending}
                    />
                  )}
                  <Field
                    label="音频地址"
                    htmlFor="audioUrl"
                    error={errors.audioUrl}
                    hint="留空时，详情页展示文稿；添加完整音频后才会出现播放器。"
                  >
                    <Input
                      id="audioUrl"
                      name="audioUrl"
                      defaultValue={value.audioUrl ?? ''}
                      placeholder="https://…"
                    />
                  </Field>
                </LayerCard.Body>
              </LayerCard>
            </div>
            <div className="admin-editor-aside">
              <LayerCard padding="none">
                <LayerCard.Header>
                  <strong>发布设置</strong>
                </LayerCard.Header>
                <LayerCard.Body className="admin-fields">
                  <Field label="发布状态" htmlFor="status" required error={errors.status}>
                    <Select name="status" defaultValue={value.status} onValueChange={() => setDirty(true)}>
                      <SelectTrigger className="studio-select-trigger" id="status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="studio-select-content" collisionPadding={12}>
                        <SelectItem value="draft">草稿 · 仅工作室可见</SelectItem>
                        <SelectItem value="published">发布 · 所有人可见</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field
                    label="发布时间"
                    htmlFor="publishedAt"
                    error={errors.publishedAt}
                    hint="按本机时区填写，公开发布时必填。此处不提供定时发布。"
                  >
                    <Input
                      id="publishedAt"
                      name="publishedAt"
                      type="datetime-local"
                      defaultValue={toLocalDateTime(value.publishedAt)}
                    />
                  </Field>
                  <Field label="首页精选" htmlFor="featured" hint="开启后，此节目参与首页精选展示。">
                    <Switch
                      id="featured"
                      name="featured"
                      defaultChecked={value.featured}
                      onCheckedChange={() => setDirty(true)}
                    />
                  </Field>
                </LayerCard.Body>
              </LayerCard>
              <LayerCard padding="none">
                <LayerCard.Header>
                  <strong>节目资料</strong>
                </LayerCard.Header>
                <LayerCard.Body className="admin-fields">
                  <div className="admin-field-pair">
                    <Field label="期数" htmlFor="episodeNumber" required error={errors.episodeNumber}>
                      <Input
                        id="episodeNumber"
                        name="episodeNumber"
                        type="number"
                        min={1}
                        max={99999}
                        step={1}
                        defaultValue={value.episodeNumber}
                        required
                      />
                    </Field>
                    <Field
                      label="时长 / 分钟"
                      htmlFor="durationMinutes"
                      required
                      error={errors.durationSeconds}
                    >
                      <Input
                        id="durationMinutes"
                        name="durationMinutes"
                        type="number"
                        min={0}
                        max={720}
                        step="any"
                        defaultValue={value.durationSeconds / 60}
                        required
                      />
                    </Field>
                  </div>
                  <Field
                    label="链接名称"
                    htmlFor="slug"
                    required
                    error={errors.slug}
                    hint="小写英文字母、数字与连字符。"
                  >
                    <Input
                      id="slug"
                      name="slug"
                      defaultValue={value.slug}
                      placeholder="a-little-room-to-breathe"
                      required
                      pattern="[a-z0-9]+(-[a-z0-9]+)*"
                      maxLength={120}
                    />
                  </Field>
                  <Field label="栏目" htmlFor="category" required error={errors.category}>
                    <CategorySelect
                      id="category"
                      defaultValue={value.category}
                      disabled={pending}
                      onChange={(category) => {
                        setDirty(true);
                        setCoverCopy((copy) => ({ ...copy, category }));
                      }}
                    />
                  </Field>
                  <Field label="标签" htmlFor="tags" error={errors.tags} hint="使用逗号分隔，最多 10 个。">
                    <Input
                      id="tags"
                      name="tags"
                      defaultValue={value.tags.join('，')}
                      placeholder="AI，工作日常，留白"
                    />
                  </Field>
                </LayerCard.Body>
              </LayerCard>
              <p className="admin-footnote">
                {dirty
                  ? '有尚未保存的改动。'
                  : episode
                    ? '所有改动已保存。'
                    : '准备好后，点击右上角保存节目。'}
              </p>
            </div>
          </fieldset>
        </form>
      )}
      {deleteOpen && episode && (
        <Confirm
          title="确认删除节目"
          description={`「${episode.title}」将被永久删除，关联媒体原件不会删除。此操作无法撤销。`}
          onClose={() => setDeleteOpen(false)}
          onConfirm={async () => {
            await adminService.remove(episode.id, episode.version);
            toast.success('节目已删除');
            navigate('/admin');
            return true;
          }}
        />
      )}
    </div>
  );
}
