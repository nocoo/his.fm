import { Field, Input, Switch } from '@nocoo/basalt';
import { InputArea } from '@nocoo/basalt/components/input-area';
import type { SeoOverride } from '../../shared/seo';

export function SeoOverrideFields({
  value,
  disabled,
  onChange,
  idPrefix = 'seo',
}: {
  value: SeoOverride;
  disabled?: boolean;
  onChange: (next: SeoOverride) => void;
  idPrefix?: string;
}) {
  return (
    <div className="admin-fields">
      <Field label="SEO 标题" htmlFor={`${idPrefix}-title`} hint="留空则使用页面默认标题。">
        <Input
          id={`${idPrefix}-title`}
          value={value.title ?? ''}
          maxLength={120}
          disabled={disabled}
          placeholder="自定义搜索结果与分享标题"
          onChange={(event) => onChange({ ...value, title: event.target.value.trim() || undefined })}
        />
      </Field>
      <Field label="SEO 描述" htmlFor={`${idPrefix}-description`} hint="留空则使用摘要或站点默认描述。">
        <InputArea
          id={`${idPrefix}-description`}
          value={value.description ?? ''}
          rows={3}
          maxLength={320}
          disabled={disabled}
          placeholder="一句话说明这一页适合谁、会看到什么"
          onChange={(event) => onChange({ ...value, description: event.target.value.trim() || undefined })}
        />
      </Field>
      <Field
        label="分享图地址"
        htmlFor={`${idPrefix}-og-image`}
        hint="HTTPS 或站内 /images/、/media/ 路径；留空使用封面或站点默认图。"
      >
        <Input
          id={`${idPrefix}-og-image`}
          value={value.ogImageUrl ?? ''}
          maxLength={2048}
          disabled={disabled}
          placeholder="https://… 或 /images/episode-01.webp"
          onChange={(event) => onChange({ ...value, ogImageUrl: event.target.value.trim() || undefined })}
        />
      </Field>
      <Field label="不编入索引" htmlFor={`${idPrefix}-noindex`} hint="开启后公开页会输出 noindex。">
        <Switch
          id={`${idPrefix}-noindex`}
          checked={Boolean(value.noindex)}
          disabled={disabled}
          onCheckedChange={(checked) => onChange({ ...value, noindex: checked || undefined })}
        />
      </Field>
    </div>
  );
}
