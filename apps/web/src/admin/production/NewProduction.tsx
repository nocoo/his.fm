import { Button } from '@nocoo/basalt';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { Episode } from '../../shared/episode';
import type { Production } from '../../shared/production';
import { useCategories } from '../categories/useCategories';
import { errorMessage } from '../model';
import { adminService } from '../service';
import { BriefForm } from './BriefForm';
import { Failure } from './controls';
import { emptyBrief, nextEpisodeNumberForCategory } from './model';
import { productionService } from './service';
import { useUnsavedChanges } from './useUnsavedChanges';

export function NewProduction() {
  const navigate = useNavigate();
  const [query] = useSearchParams();
  const source = query.get('source');
  const view = useRef<HTMLDivElement>(null);
  const categories = useCategories();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  const defaultCategoryId = categories.categories[0]?.id;
  const [catalog, setCatalog] = useState<{ productions: Production[]; episodes: Episode[] } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([productionService.list(controller.signal), adminService.list(controller.signal)])
      .then(([productions, episodes]) => {
        if (!controller.signal.aborted) {
          setCatalog({ productions: productions.productions, episodes: episodes.episodes });
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const suggestEpisodeNumber = useCallback(
    (category: string) =>
      catalog ? nextEpisodeNumberForCategory(category, catalog.productions, catalog.episodes) : 1,
    [catalog],
  );
  const initialBrief = useMemo(
    () => (defaultCategoryId ? emptyBrief(defaultCategoryId, suggestEpisodeNumber(defaultCategoryId)) : null),
    [defaultCategoryId, suggestEpisodeNumber],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only reset the content island when opening a source subpage.
  useLayoutEffect(() => {
    view.current?.closest('.admin-content-island')?.scrollTo({ top: 0, behavior: 'instant' });
  }, [source]);
  return (
    <div className="admin-page" ref={view}>
      {source === null && (
        <PageHeader
          title={
            <span className="studio-title-group">
              <Button asChild variant="ghost" size="icon">
                <Link to="/admin" aria-label="返回节目库">
                  <ArrowLeft size={18} />
                </Link>
              </Button>
              <span>新建节目</span>
            </span>
          }
          actions={
            <Button asChild variant="outline">
              <Link to="/admin/episodes/new">直接录入成品</Link>
            </Button>
          }
        />
      )}
      {error && <Failure error={error} />}
      {categories.error && <Failure error={categories.error} retry={() => void categories.load()} />}
      {initialBrief && (
        <BriefForm
          key={`${initialBrief.category}-${initialBrief.episodeNumber}`}
          value={initialBrief}
          pending={pending}
          suggestEpisodeNumber={suggestEpisodeNumber}
          onDirty={setDirty}
          onSave={async (brief) => {
            if (pending) return;
            setPending(true);
            setError('');
            try {
              const { production } = await productionService.create(brief);
              setDirty(false);
              navigate(`/admin/productions/${production.id}`, { replace: true });
            } catch (cause) {
              setError(errorMessage(cause));
            } finally {
              setPending(false);
            }
          }}
        />
      )}
    </div>
  );
}
