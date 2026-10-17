import { LayerCard } from '@nocoo/basalt';
import { useEffect, useState } from 'react';
import type { Episode } from '../../shared/episode';
import type { Production } from '../../shared/production';
import { errorMessage } from '../model';
import { Failure } from '../production/controls';
import { adminService } from '../service';
import { EpisodeSocialPreview } from './EpisodeSocialPreview';
import { productionPreviewEpisode } from './social-preview.model';

export function PublicationSocialPreview({ production }: { production: Production }) {
  const [result, setResult] = useState<{ productionId: string; episode?: Episode } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Refresh the snapshot after publication mutations or retries.
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setResult(null);
    void adminService.list(controller.signal).then(
      ({ episodes }) => {
        if (!controller.signal.aborted) {
          setResult({
            productionId: production.id,
            episode: episodes.find((episode) => episode.sourceProductionId === production.id),
          });
        }
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(cause));
      },
    );
    return () => controller.abort();
  }, [production.id, production.version, attempt]);
  if (error) return <Failure error={error} retry={() => setAttempt((value) => value + 1)} />;
  if (!result || result.productionId !== production.id) {
    return <LayerCard.Loading label="正在读取节目分享快照" />;
  }
  const episode = result.episode ?? productionPreviewEpisode(production);
  return (
    <EpisodeSocialPreview
      episode={episode}
      saved={result.episode}
      notice={
        result.episode
          ? '预览当前节目发布快照，不是制作中的修订。草稿或未来发布时间的快照不加载公开分享图；确认发布后才同步新的内容。'
          : '制作草稿推演：使用当前已保存的制作内容；尚未有节目发布快照，不请求公开分享图。'
      }
    />
  );
}
