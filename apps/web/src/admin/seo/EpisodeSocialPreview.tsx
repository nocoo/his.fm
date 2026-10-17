import { LayerCard } from '@nocoo/basalt';
import { useEffect, useState } from 'react';
import type { Episode } from '../../shared/episode';
import type { SiteSeo } from '../../shared/seo';
import { getEnvironment } from '../environment';
import { errorMessage } from '../model';
import { Failure } from '../production/controls';
import { SocialPreview } from './SocialPreview';
import { siteSeoService } from './service';
import { episodeSocialPreview } from './social-preview.model';

export function EpisodeSocialPreview({
  episode,
  saved,
  categoryName,
  notice = '文字跟随当前编辑；未保存内容不会改变公开页面。图片仅显示已公开且未改动的分享图。',
}: {
  episode: Episode;
  saved?: Episode;
  categoryName: string;
  notice?: string;
}) {
  const [site, setSite] = useState<SiteSeo | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
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
  if (!site) return <LayerCard.Loading label="正在读取分享预览元数据" />;
  const origin = getEnvironment() === 'production' ? 'https://his.fm' : window.location.origin;
  return (
    <SocialPreview
      {...episodeSocialPreview(site, origin, episode, categoryName, saved)}
      unsavedRecord={!episode.id && !episode.seo.ogImageUrl}
      notice={notice}
    />
  );
}
