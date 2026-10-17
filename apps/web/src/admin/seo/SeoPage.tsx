import { Button, Field, Input, LayerCard, Switch } from '@nocoo/basalt';
import { InputArea } from '@nocoo/basalt/components/input-area';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { Check } from 'lucide-react';
import type { SiteSeo } from '../../shared/seo';
import { Failure } from '../production/controls';
import { SeoOverrideFields } from './SeoOverrideFields';
import { useSiteSeoSettings } from './useSiteSeoSettings';

function SiteSeoForm({
  value,
  setValue,
  pending,
}: {
  value: SiteSeo;
  setValue: (next: SiteSeo) => void;
  pending: boolean;
}) {
  const patch = (next: Partial<SiteSeo>) => setValue({ ...value, ...next });
  return (
    <>
      <LayerCard className="studio-stack">
        <strong>站点默认</strong>
        <div className="admin-fields">
          <Field label="站点名称" htmlFor="site-name" required>
            <Input
              id="site-name"
              value={value.siteName}
              maxLength={80}
              disabled={pending}
              onChange={(event) => patch({ siteName: event.target.value })}
            />
          </Field>
          <Field label="标题后缀" htmlFor="title-suffix" hint="自动追加在页面标题末尾。">
            <Input
              id="title-suffix"
              value={value.titleSuffix}
              maxLength={80}
              disabled={pending}
              onChange={(event) => patch({ titleSuffix: event.target.value })}
            />
          </Field>
          <Field label="默认标题" htmlFor="default-title" required>
            <Input
              id="default-title"
              value={value.defaultTitle}
              maxLength={120}
              disabled={pending}
              onChange={(event) => patch({ defaultTitle: event.target.value })}
            />
          </Field>
          <Field label="默认描述" htmlFor="default-description" required>
            <InputArea
              id="default-description"
              value={value.defaultDescription}
              rows={3}
              maxLength={320}
              disabled={pending}
              onChange={(event) => patch({ defaultDescription: event.target.value })}
            />
          </Field>
          <Field label="默认分享图" htmlFor="default-og-image" required>
            <Input
              id="default-og-image"
              value={value.defaultOgImageUrl}
              maxLength={2048}
              disabled={pending}
              onChange={(event) => patch({ defaultOgImageUrl: event.target.value })}
            />
          </Field>
        </div>
      </LayerCard>
      <LayerCard className="studio-stack">
        <strong>播客 Feed（RSS / Apple Podcasts）</strong>
        <div className="admin-fields">
          <Field label="播客简介" htmlFor="podcast-description" required>
            <InputArea
              id="podcast-description"
              value={value.podcastDescription}
              rows={4}
              maxLength={4000}
              disabled={pending}
              onChange={(event) => patch({ podcastDescription: event.target.value })}
            />
          </Field>
          <Field label="作者 / 出品方" htmlFor="podcast-author" required>
            <Input
              id="podcast-author"
              value={value.podcastAuthor}
              maxLength={120}
              disabled={pending}
              onChange={(event) => patch({ podcastAuthor: event.target.value })}
            />
          </Field>
          <Field label="语言代码" htmlFor="site-language" required>
            <Input
              id="site-language"
              value={value.language}
              maxLength={12}
              disabled={pending}
              onChange={(event) => patch({ language: event.target.value })}
            />
          </Field>
          <Field label="iTunes 分类" htmlFor="itunes-category" required>
            <Input
              id="itunes-category"
              value={value.itunesCategory}
              maxLength={80}
              disabled={pending}
              onChange={(event) => patch({ itunesCategory: event.target.value })}
            />
          </Field>
          <Field label="含成人内容" htmlFor="itunes-explicit">
            <Switch
              id="itunes-explicit"
              checked={value.itunesExplicit}
              disabled={pending}
              onCheckedChange={(checked) => patch({ itunesExplicit: checked })}
            />
          </Field>
          <Field label="Twitter @站点" htmlFor="twitter-site" hint="可选，用于 twitter:site。">
            <Input
              id="twitter-site"
              value={value.twitterSite ?? ''}
              maxLength={80}
              disabled={pending}
              onChange={(event) => patch({ twitterSite: event.target.value.trim() || undefined })}
            />
          </Field>
        </div>
      </LayerCard>
      <LayerCard className="studio-stack">
        <strong>全站页面覆盖</strong>
        <p className="admin-muted">作用于首页等未单独配置的公开页。</p>
        <SeoOverrideFields
          idPrefix="site-overrides"
          disabled={pending}
          value={value.overrides ?? {}}
          onChange={(overrides) => patch({ overrides })}
        />
      </LayerCard>
    </>
  );
}

export default function SeoPage() {
  const vm = useSiteSeoSettings();
  return (
    <div className="admin-page">
      <PageHeader
        title="搜索与分享"
        description="站点级默认标题、播客 Feed 与公开页结构化数据。"
        actions={
          <Button disabled={!vm.dirty || vm.conflict} loading={vm.pending} onClick={() => void vm.save()}>
            <Check size={16} />
            保存 SEO 设置
          </Button>
        }
      />
      {vm.error && <Failure error={vm.error} retry={!vm.saved ? () => void vm.load() : undefined} />}
      {!vm.value && !vm.error && <LayerCard.Loading label="正在读取 SEO 设置" />}
      {vm.value && (
        <>
          {vm.conflict && (
            <LayerCard className="studio-stack">
              <p>站点 SEO 已在别处更新。请读取最新设置后重新编辑。</p>
              <Button variant="outline" loading={vm.pending} onClick={() => void vm.load()}>
                读取最新设置
              </Button>
            </LayerCard>
          )}
          <SiteSeoForm value={vm.value} setValue={vm.setValue} pending={vm.pending} />
          {vm.saved && (
            <p className="admin-muted" role="status">
              {vm.dirty ? '有未保存改动' : `已保存 · v${vm.saved.version}`}
            </p>
          )}
        </>
      )}
    </div>
  );
}
