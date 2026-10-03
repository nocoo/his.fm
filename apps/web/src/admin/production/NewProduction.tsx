import { Button } from '@nocoo/basalt';
import { PageHeader } from '@nocoo/basalt/components/page-header';
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
          title="新建制作"
          actions={
            <Button variant="ghost" asChild>
              <Link to="/admin">返回制作列表</Link>
            </Button>
          }
        />
      )}
      {error && <Failure error={error} />}
      <BriefForm
        value={emptyBrief}
        pending={pending}
        onDirty={() => setDirty(true)}
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
