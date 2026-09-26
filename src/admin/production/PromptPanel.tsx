import { useEffect, useState } from 'react';
import type { Production, ProductionPrompts } from '../../shared/production';
import { getEnvironment } from '../environment';
import { errorMessage } from '../model';
import { CopyButton, Failure } from './controls';
import { agentTask } from './model';
import { productionService } from './service';

const names = { brief: '素材整理', script: '逐字稿', cover: '封面', description: '发布文案' };
export function PromptPanel({
  production,
  kind,
  dirty,
}: {
  production: Production;
  kind: keyof ProductionPrompts;
  dirty: boolean;
}) {
  const [result, setResult] = useState<{ version: number; prompts: ProductionPrompts } | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retrying must reload the same saved revision after a transient error.
  useEffect(() => {
    let active = true;
    setError('');
    void productionService
      .prompts(production.id)
      .then((prompts) => {
        if (active) setResult({ version: production.version, prompts });
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [production.id, production.version, retry]);
  const prompt = result?.version === production.version ? result.prompts[kind] : '';
  const task = agentTask(
    prompt,
    production,
    getEnvironment() === 'production' ? 'https://his.fm' : window.location.origin,
  );
  return (
    <div className="studio-prompt">
      <p className="admin-muted">本地计算机 · Hermes / Codex{kind === 'cover' ? ' · GPT Image 2.5' : ''}</p>
      {prompt && (
        <details>
          <summary>查看任务提示词</summary>
          <pre className="studio-prompt-text">{task}</pre>
        </details>
      )}
      <CopyButton
        label={`复制${names[kind]}任务`}
        disabled={!prompt || dirty}
        read={async () => {
          const prompts = await productionService.prompts(production.id);
          setResult({ version: production.version, prompts });
          return agentTask(
            prompts[kind],
            production,
            getEnvironment() === 'production' ? 'https://his.fm' : window.location.origin,
          );
        }}
      />
      {dirty && <p className="admin-muted studio-prompt-feedback">先保存改动，提示词会使用最新内容。</p>}
      {error && <Failure error={error} retry={() => setRetry((value) => value + 1)} />}
    </div>
  );
}
