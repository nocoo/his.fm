import { Button } from '@nocoo/basalt';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { errorMessage } from '../model';
import { BriefForm } from './BriefForm';
import { Failure } from './controls';
import { emptyBrief } from './model';
import { productionService } from './service';
import { useUnsavedChanges } from './useUnsavedChanges';

export function NewProduction() {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  return (
    <div className="admin-page">
      <PageHeader
        title="新建制作"
        description="从一个明确的创作意图出发。选题确认后，再开始写逐字稿。"
        actions={
          <Button variant="ghost" asChild>
            <Link to="/admin">返回制作列表</Link>
          </Button>
        }
      />
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
