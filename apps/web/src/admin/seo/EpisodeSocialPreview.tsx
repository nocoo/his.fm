import { LayerCard } from '@nocoo/basalt';
import { useEffect, useState } from 'react';
import type { Episode } from '../../shared/episode';
import type { SiteSeo } from '../../shared/seo';
import { useCategories } from '../categories/useCategories';
import { getEnvironment } from '../environment';
import { errorMessage } from '../model';
import { Failure } from '../production/controls';
import { SocialPreview } from './SocialPreview';
import { siteSeoService } from './service';
import { episodeSocialPreview } from './social-preview.model';

export function EpisodeSocialPreview({
  episode,
  saved,
  notice = '文字跟随当前编辑；未保存内容不会改变公开页面。图片仅显示已公开且未改动的分享图。',
}: {
  episode: Episode;
  saved?: Episode;
  notice?: string;
}) {
  const [site, setSite] = useState<SiteSeo | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const { categories, error: categoryError, loading, load } = useCategories();
  const categoryName = categories.find((item) => item.id === episode.category)?.name;
  const origin = getEnvironment() === 'production' ? 'https://his.fm' : window.location.origin;
  const [preview, setPreview] = useState<{
    episode: Episode;
    saved?: Episode;
    site: SiteSeo;
    categoryName: string;
    value: Awaited<ReturnType<typeof episodeSocialPreview>>;
  } | null>(null);
  useEffect(() => {
    let active = true;
    if (site && categoryName) {
      void episodeSocialPreview(site, origin, episode, categoryName, saved).then(
        (value) => {
          if (active) setPreview({ episode, saved, site, categoryName, value });
        },
        (cause: unknown) => {
          if (active) setError(errorMessage(cause));
        },
      );
    }
    return () => {
      active = false;
    };
  }, [site, origin, episode, categoryName, saved]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The retry key restarts the aborted read.
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void siteSeoService.read(controller.signal).then(
      ({ seo }) => {
        if (!controller.signal.aborted) setSite(seo);
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(cause));
      },
    );
    return () => controller.abort();
  }, [attempt]);
  if (error) return <Failure error={error} retry={() => setAttempt((value) => value + 1)} />;
  if (categoryError) return <Failure error={categoryError} retry={() => void load()} />;
  if (!site || loading) return <LayerCard.Loading label="正在读取分享预览元数据" />;
  if (!categoryName)
    return <Failure error="请先选择有效栏目，再重新加载分享预览" retry={() => void load()} />;
  if (!preview) return <LayerCard.Loading label="正在读取分享预览元数据" />;
  return (
    <SocialPreview
      {...preview.value}
      imageAvailable={
        preview.episode === episode &&
        preview.saved === saved &&
        preview.site === site &&
        preview.categoryName === categoryName &&
        preview.value.imageAvailable
      }
      unsavedRecord={!episode.id && !episode.seo.ogImageUrl}
      notice={notice}
    />
  );
}
