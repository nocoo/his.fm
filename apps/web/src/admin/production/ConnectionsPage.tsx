import { Button, LayerCard, Popover, PopoverContent, PopoverTrigger, toast } from '@nocoo/basalt';
import { DataTable, type DataTableColumn } from '@nocoo/basalt/components/data-table';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { TagBadge } from '@nocoo/basalt/components/tag-badge';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { AgentTokenRecord } from '../../shared/production';
import { getEnvironment } from '../environment';
import { errorMessage } from '../model';
import { Confirm, CopyButton } from './controls';
import { dateLabel } from './model';
import { productionService } from './service';
import { scopeLabels, TokenDialog } from './TokenDialog';

const grantIssue = (record: AgentTokenRecord) =>
  record.invalidScopes?.length ? '权限已失效' : record.scopes.length ? null : '无授权';

export function ConnectionsPage() {
  const base = getEnvironment() === 'production' ? 'https://his.fm' : window.location.origin;
  const [tokens, setTokens] = useState<AgentTokenRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<AgentTokenRecord | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const result = await productionService.tokens(signal);
      if (!signal?.aborted) setTokens(result.tokens);
    } catch (cause) {
      if (!signal?.aborted) setError(errorMessage(cause));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const columns: DataTableColumn<AgentTokenRecord>[] = [
    {
      id: 'name',
      header: '令牌',
      sortValue: (record) => record.name,
      accessor: (record) => (
        <div className="studio-stack studio-gap-sm studio-wrap">
          <strong>{record.name}</strong>
          <code className="admin-muted">{record.prefix}…</code>
          <span className="admin-muted">
            创建于{' '}
            <time dateTime={record.createdAt} title={dateLabel(record.createdAt)}>
              {new Date(record.createdAt).toLocaleDateString('zh-CN')}
            </time>
          </span>
        </div>
      ),
    },
    {
      id: 'status',
      header: '状态 / 有效期',
      sortable: false,
      accessor: (record) => (
        <div className="studio-stack studio-gap-sm studio-token-validity">
          {record.revokedAt ? (
            <TagBadge name="已撤销" color="slate" />
          ) : grantIssue(record) ? (
            <TagBadge name={grantIssue(record) ?? ''} color="amber" />
          ) : Date.parse(record.expiresAt) <= Date.now() ? (
            <TagBadge name="已过期" color="amber" />
          ) : (
            <TagBadge name="有效" color="success" />
          )}
          <span className="admin-muted">
            <time
              dateTime={record.revokedAt ?? record.expiresAt}
              title={dateLabel(record.revokedAt ?? record.expiresAt)}
            >
              {new Date(record.revokedAt ?? record.expiresAt).toLocaleDateString('zh-CN')}
            </time>
            {record.revokedAt ? ' 撤销' : ' 到期'}
          </span>
        </div>
      ),
    },
    {
      id: 'scopes',
      header: '权限',
      sortValue: (record) => record.scopes.length,
      accessor: (record) => (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={
                grantIssue(record)
                  ? `${record.name}：${grantIssue(record)}，需要重新签发`
                  : `${record.name}：已授权 ${record.scopes.length} 项权限`
              }
            >
              {grantIssue(record) ? '需重新签发' : `${record.scopes.length} 项权限`}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="studio-token-scopes" align="start" aria-label={`${record.name}的权限`}>
            <strong>
              {record.name} · {grantIssue(record) ?? '已授权权限'}
            </strong>
            {record.invalidScopes?.length ? (
              <div className="studio-stack studio-gap-sm">
                <p className="admin-muted">
                  包含已移除或未知权限，此令牌无法通过认证。请撤销后按当前权限重新签发；不会自动扩大授权。
                </p>
                <ul className="studio-token-grants">
                  {record.invalidScopes.map((scope) => (
                    <li key={scope}>
                      <code className="studio-scope-code">{scope}</code>
                    </li>
                  ))}
                </ul>
              </div>
            ) : record.scopes.length ? (
              <ul className="studio-token-grants">
                {record.scopes.map((scope) => (
                  <li key={scope}>
                    {scopeLabels[scope]}
                    <code className="admin-muted studio-scope-code">{scope}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="admin-muted">无授权，此令牌无法通过认证。请撤销后按当前权限重新签发。</p>
            )}
          </PopoverContent>
        </Popover>
      ),
    },
    {
      id: 'used',
      header: '最近使用',
      sortValue: (record) => record.lastUsedAt ?? '',
      accessor: (record) =>
        record.lastUsedAt ? (
          <time dateTime={record.lastUsedAt} title={dateLabel(record.lastUsedAt)}>
            {new Date(record.lastUsedAt).toLocaleDateString('zh-CN')}
          </time>
        ) : (
          <span className="admin-muted">尚未使用</span>
        ),
    },
    {
      id: 'actions',
      header: '操作',
      sortable: false,
      accessor: (record) => (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`${record.revokedAt ? '删除' : '撤销'} ${record.name}`}
          onClick={() => setTarget(record)}
        >
          {record.revokedAt ? '删除' : '撤销'}
        </Button>
      ),
    },
  ];
  return (
    <div className="admin-page">
      <PageHeader
        title="连接管理"
        actions={
          <>
            <Button
              variant="outline"
              size="icon"
              aria-label="刷新令牌列表"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw size={16} />
            </Button>
            <TokenDialog onCreated={(record) => setTokens((current) => [record, ...current])} />
          </>
        }
      />
      <LayerCard className="studio-connection-info">
        <div className="studio-stack studio-gap-sm studio-wrap">
          <strong>API 接入</strong>
          <code className="studio-wrap">{base}/api/agent</code>
          <span className="admin-muted">
            使用当前环境的令牌，通过 /me 验证权限；按已授予的有限权限访问 REST API。
          </span>
        </div>
        <div className="studio-actions">
          <CopyButton label="复制接口地址" read={() => `${base}/api/agent`} />
          <Button variant="ghost" size="sm" asChild>
            <a href={`${base}/api/agent/instructions`} target="_blank" rel="noopener noreferrer">
              接入说明
            </a>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <a href={`${base}/api/agent/openapi.json`} target="_blank" rel="noopener noreferrer">
              OpenAPI
            </a>
          </Button>
        </div>
      </LayerCard>
      <LayerCard padding="none">
        <LayerCard.Header>
          <strong>访问令牌{!loading && !error && ` · ${tokens.length}`}</strong>
          <span className="admin-muted">撤销立即失效，已撤销记录可删除。</span>
        </LayerCard.Header>
        <div className="studio-table studio-token-table">
          <DataTable
            aria-label="访问令牌列表"
            getRowId={(record) => record.id}
            data={tokens}
            columns={columns}
            loading={loading}
            error={error || undefined}
            onRetry={() => void load()}
            retryLabel="重试"
            empty={
              <LayerCard.Empty title="尚未创建访问令牌" description="点击右上角创建令牌，按用途选择权限。" />
            }
          />
        </div>
      </LayerCard>
      {target && (
        <Confirm
          title={target.revokedAt ? '确认删除令牌' : '确认撤销令牌'}
          description={
            target.revokedAt
              ? `从管理列表删除「${target.name}」。保留撤销记录和审计关联，权限不会恢复。`
              : `「${target.name}」及其签发的子令牌将立即失去访问权限，撤销后不可恢复。`
          }
          onClose={() => setTarget(null)}
          onConfirm={async () => {
            if (target.revokedAt) {
              await productionService.deleteToken(target.id);
              setTokens((current) => current.filter((record) => record.id !== target.id));
              toast.success('令牌已删除');
            } else {
              await productionService.revokeToken(target.id);
              await load();
              toast.success('令牌及子令牌已撤销');
            }
          }}
        />
      )}
    </div>
  );
}
