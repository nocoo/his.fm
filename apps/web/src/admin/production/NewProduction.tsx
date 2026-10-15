import { Button } from '@nocoo/basalt';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { ArrowLeft } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { errorMessage } from '../model';
import { BriefForm } from './BriefForm';
import { Failure } from './controls';
import { emptyBrief } from './model';
import { productionService } from './service';
import { useUnsavedChanges } from './useUnsavedChanges';

export function NewProduction() {
  const navigate = useNavigate();
  const [query] = useSearchParams();
  const source = query.get('source');
  const view = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
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
      <BriefForm
        value={emptyBrief}
        pending={pending}
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
    </div>
  );
}
