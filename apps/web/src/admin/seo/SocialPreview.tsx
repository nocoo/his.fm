import { Button, LayerCard } from '@nocoo/basalt';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nocoo/basalt/components/select';
import { useId, useState } from 'react';
import type { ResolvedPageSeo } from '../../shared/seo-resolve';
import { type SocialPlatform, socialPlatforms } from './social-preview.model';
import './social-preview.css';

export function SocialPreview({
  seo,
  siteName,
  imageAvailable,
  notice,
  unsavedRecord = false,
}: {
  seo: ResolvedPageSeo;
  siteName: string;
  imageAvailable: boolean;
  notice: string;
  unsavedRecord?: boolean;
}) {
  const [platform, setPlatform] = useState<SocialPlatform>('x');
  const [failedImage, setFailedImage] = useState('');
  const labelId = useId();
  const platformLabel = socialPlatforms.find((item) => item.id === platform)?.label;
  const showImage = imageAvailable && failedImage !== seo.ogImageUrl;
  const host = new URL(seo.canonical).host;
  return (
    <LayerCard padding="none" className="social-preview">
      <LayerCard.Header className="social-preview-heading">
        <strong id={labelId}>社交分享预览</strong>
        <Select
          value={platform}
          onValueChange={(value) => {
            if (socialPlatforms.some((item) => item.id === value)) setPlatform(value as SocialPlatform);
          }}
        >
          <SelectTrigger aria-label="社交预览平台" className="social-preview-selector">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="studio-select-content" collisionPadding={12}>
            {socialPlatforms.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </LayerCard.Header>
      <LayerCard.Body className="studio-stack">
        <p className="admin-muted">{notice}</p>
        <div className="social-preview-stage">
          <article
            className={`social-card social-card-${platform}`}
            aria-label={`${platformLabel} 分享卡片近似预览`}
          >
            <div className="social-card-image">
              {showImage ? (
                <img
                  src={seo.ogImageUrl}
                  alt="分享图片"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={() => setFailedImage(seo.ogImageUrl)}
                />
              ) : (
                <span>{imageAvailable ? '图片暂时无法加载' : '图片待公开或保存后可用'}</span>
              )}
            </div>
            <div className="social-card-copy">
              <span className="social-card-site">{platform === 'x' ? host : siteName}</span>
              <strong className="social-card-title">{seo.title}</strong>
              <p className="social-card-description">{seo.description}</p>
              <span className="social-card-domain">{host}</span>
            </div>
          </article>
        </div>
        {imageAvailable && failedImage === seo.ogImageUrl && (
          <Button type="button" variant="outline" onClick={() => setFailedImage('')}>
            重新加载分享图片
          </Button>
        )}
        <p className="admin-muted">
          近似模拟，非平台实时抓取；实际裁切、摘要和缓存由平台决定。微信还可能需要 JS-SDK 配置。
        </p>
        <details className="social-preview-metadata">
          <summary>查看实际解析的 SEO 元数据</summary>
          <dl aria-labelledby={labelId}>
            <dt>og:title / twitter:title</dt>
            <dd>{seo.title}</dd>
            <dt>og:description / twitter:description</dt>
            <dd>{seo.description}</dd>
            <dt>og:url / canonical</dt>
            <dd>{seo.canonical}</dd>
            <dt>og:image / twitter:image</dt>
            <dd>{unsavedRecord ? '保存节目后生成分享图地址' : seo.ogImageUrl}</dd>
            <dt>站点名称（站点设置）</dt>
            <dd>{siteName}</dd>
            <dt>twitter:card</dt>
            <dd>summary_large_image</dd>
            <dt>robots</dt>
            <dd>{seo.noindex ? 'noindex, follow' : 'index, follow'}</dd>
          </dl>
        </details>
      </LayerCard.Body>
    </LayerCard>
  );
}
