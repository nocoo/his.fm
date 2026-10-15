import { type Scope, scopePresets, scopes } from '@his-fm/contracts';
import { Button, Checkbox, Field, Input, LayerCard, toast } from '@nocoo/basalt';
import { InputArea } from '@nocoo/basalt/components/input-area';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { useCallback, useEffect, useState } from 'react';
import type { AgentTokenRecord } from '../../shared/production';
import { getEnvironment } from '../environment';
import { errorMessage } from '../model';
import { request } from '../service';
import { Choice, Confirm, CopyButton, Failure } from './controls';
import { dateLabel } from './model';
import { productionService } from './service';

const scopeLabels: Record<Scope, string> = {
  'productions:read': '读取制作',
  'productions:write': '创建和编辑制作',
  'productions:delete': '删除制作',
  'productions:submit': '提交制作审核',
  'productions:approve': '审批制作',
  'productions:reopen': '退回和重新打开制作',
  'publications:read': '读取发布记录',
  'publications:write': '确认实际发布',
  'publications:delete': '删除发布记录',
  'episodes:read': '读取节目库',
  'episodes:write': '创建和编辑节目',
  'episodes:delete': '删除节目',
  'episodes:publish': '改变节目发布状态',
  'categories:read': '读取分类',
  'categories:write': '创建和编辑分类',
  'categories:delete': '删除分类',
  'prompts:read': '读取私有提示词',
  'prompts:write': '修改提示词',
  'appearance:read': '读取外观',
  'appearance:write': '修改外观',
  'settings:read': '读取非敏感设置',
  'settings:write': '修改设置',
  'credentials:write': '替换提供商密钥（不可读取）',
  'audio:generate': '请求音频生成（可能产生费用）',
  'bumpers:read': '读取片头片尾',
  'bumpers:write': '上传和编辑片头片尾',
  'bumpers:delete': '删除片头片尾',
  'storage:read': '读取资源清单',
  'storage:write': '上传资源',
  'storage:delete': '删除和清理资源',
  'tokens:read': '读取令牌授权信息',
  'tokens:issue': '签发子令牌',
  'tokens:revoke': '撤销令牌',
  'tasks:read': '读取主控任务',
  'tasks:submit': '提交主控任务',
  'tasks:cancel': '取消主控任务',
  'tasks:manage': '管理全站任务并访问共享主控历史（高风险）',
  'runtime:connect': '连接本机执行主控',
  'runtime:manage': '绑定执行工作站',
};
const presetOptions = [
  { value: 'reader', label: '只读（默认）' },
  { value: 'editor', label: '内容编辑' },
  { value: 'coordinator', label: '本机主控' },
  { value: 'owner', label: '完全控制（高风险）' },
  { value: 'custom', label: '自定义权限' },
];

export function ConnectionsPage() {
  const base = getEnvironment() === 'production' ? 'https://his.fm' : window.location.origin;
  const [tokens, setTokens] = useState<AgentTokenRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [token, setToken] = useState('');
  const [preset, setPreset] = useState('reader');
  const [grants, setGrants] = useState<Scope[]>([...scopePresets.reader]);
  const [confirmed, setConfirmed] = useState(false);
  const [revoking, setRevoking] = useState<AgentTokenRecord | null>(null);
  const [station, setStation] = useState<{ tokenId: string; stationId: string; version: number } | null>(
    null,
  );
  const [online, setOnline] = useState(false);
  const highRisk = grants.filter(
    (scope) => !scope.endsWith(':read') && !['productions:write', 'productions:submit'].includes(scope),
  );
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const [result, binding, snapshot] = await Promise.all([
        productionService.tokens(signal),
        request<{ station: { tokenId: string; stationId: string; version: number } | null }>(
          '/agent/station',
          { signal },
        ),
        request<{ online: boolean }>('/agent/snapshot', { signal }),
      ]);
      setTokens(result.tokens);
      setStation(binding.station ?? null);
      setOnline(snapshot.online === true);
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
  return (
    <div className="admin-page">
      <PageHeader title="连接管理" />
      <p className="admin-muted">
        {getEnvironment() === 'production' ? 'Prod' : 'Local'} · 主控{online ? '在线' : '离线'}
        {station ? ` · ${station.stationId}` : ' · 尚未绑定工作站'}
      </p>
      <LayerCard padding="none">
        <LayerCard.Header>
          <strong>本机主控与访问令牌</strong>
        </LayerCard.Header>
        <LayerCard.Body className="studio-stack studio-padding">
          <div className="studio-row">
            <p>
              接口地址：<code className="studio-wrap">{base}/api/agent</code>
            </p>
            <CopyButton label="复制接口地址" read={() => `${base}/api/agent`} />
          </div>
          <div className="studio-actions">
            <Button variant="outline" asChild>
              <a href={`${base}/api/agent/instructions`} target="_blank" rel="noopener noreferrer">
                接入说明
              </a>
            </Button>
            <Button variant="ghost" asChild>
              <a href={`${base}/api/agent/openapi.json`} target="_blank" rel="noopener noreferrer">
                OpenAPI
              </a>
            </Button>
          </div>
          <p className="admin-muted">使用当前环境的令牌。入口可公开读取，令牌是否有效请通过 /me 验证。</p>
          <p className="admin-muted">
            令牌仅能执行你明确勾选的权限，默认只读。审批、发布、删除、密钥和令牌管理等能力需要单独授权。
          </p>
          {error && <Failure error={error} retry={() => void load()} />}
          {token && (
            <LayerCard.Well className="studio-stack studio-padding">
              <strong>新令牌只显示这一次</strong>
              <p className="admin-muted">复制并交给你的助手，离开页面后无法再次查看。</p>
              <InputArea aria-label="新建助手令牌" readOnly value={token} rows={3} />
              <div className="studio-actions">
                <CopyButton label="复制新令牌" read={() => token} />
                <Button variant="ghost" onClick={() => setToken('')}>
                  我已保存，隐藏令牌
                </Button>
              </div>
            </LayerCard.Well>
          )}
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (pending || token || !grants.length || (highRisk.length > 0 && !confirmed)) return;
              const form = event.currentTarget;
              const values = new FormData(form);
              setPending(true);
              setError('');
              try {
                const result = await productionService.createToken(
                  String(values.get('name')).trim(),
                  Number(values.get('expiresInDays')),
                  grants,
                );
                setTokens((current) => [result.record, ...current]);
                setToken(result.token);
                form.reset();
                setPreset('reader');
                setGrants([...scopePresets.reader]);
                setConfirmed(false);
                toast.success('助手令牌已创建');
              } catch (cause) {
                setError(errorMessage(cause));
              } finally {
                setPending(false);
              }
            }}
          >
            <fieldset disabled={pending || Boolean(token)} className="studio-fieldset studio-stack">
              <Field label="权限预设">
                <Choice
                  label="权限预设"
                  value={preset}
                  disabled={pending || Boolean(token)}
                  options={presetOptions}
                  onChange={(value) => {
                    setPreset(value);
                    if (value in scopePresets)
                      setGrants([...scopePresets[value as keyof typeof scopePresets]]);
                    setConfirmed(false);
                  }}
                />
              </Field>
              <details className="studio-preview-settings">
                <summary>
                  逐项设置权限（已选 {grants.length} / {scopes.length}）
                </summary>
                <Checkbox.Group
                  value={grants}
                  disabled={pending || Boolean(token)}
                  onValueChange={(values) => {
                    setGrants(values as Scope[]);
                    setPreset('custom');
                    setConfirmed(false);
                  }}
                  className="studio-fieldset studio-grid"
                >
                  <Checkbox.Legend>允许的操作</Checkbox.Legend>
                  {scopes.map((scope) => (
                    <label className="studio-checkbox" key={scope} htmlFor={`grant-${scope}`}>
                      <Checkbox.Item id={`grant-${scope}`} value={scope} aria-label={scopeLabels[scope]} />
                      <span className="studio-wrap">
                        {scopeLabels[scope]} <small className="admin-muted">{scope}</small>
                      </span>
                    </label>
                  ))}
                </Checkbox.Group>
              </details>
              {highRisk.length > 0 && (
                <LayerCard.Well
                  className="studio-stack studio-padding"
                  role="region"
                  aria-label="高风险授权确认"
                >
                  <strong>{grants.length === scopes.length ? '完全控制授权' : '额外授权确认'}</strong>
                  <p className="admin-muted">
                    {highRisk.map((scope) => scopeLabels[scope]).join('、')}
                    。这些操作可能改变站点、删除数据、产生费用或扩大访问权限；设置和密钥由 Local / Prod 共享。
                  </p>
                  {grants.includes('tasks:manage') && (
                    <p className="admin-muted">
                      主控会话和执行者可能保留其他任务的历史。此授权允许访问全站任务及共享历史，不提供令牌间会话隔离。
                    </p>
                  )}
                  <label className="studio-checkbox" htmlFor="token-risk-confirmation">
                    <Checkbox
                      id="token-risk-confirmation"
                      checked={confirmed}
                      onCheckedChange={(value) => setConfirmed(value === true)}
                      aria-label="我确认授予以上高风险权限"
                      disabled={pending || Boolean(token)}
                    />
                    <span>我确认授予以上高风险权限</span>
                  </label>
                </LayerCard.Well>
              )}
              <div className="studio-token-form">
                <Field label="助手名称" htmlFor="token-name" required>
                  <Input
                    id="token-name"
                    name="name"
                    required
                    maxLength={100}
                    placeholder="例如：工作室主控"
                  />
                </Field>
                <Field label="有效天数" htmlFor="token-days" required>
                  <Input
                    id="token-days"
                    name="expiresInDays"
                    type="number"
                    min={1}
                    max={365}
                    defaultValue={30}
                    required
                  />
                </Field>
                <Button
                  type="submit"
                  loading={pending}
                  disabled={!grants.length || (highRisk.length > 0 && !confirmed)}
                >
                  创建助手令牌
                </Button>
              </div>
            </fieldset>
          </form>
          {loading ? (
            <LayerCard.Loading label="正在加载助手令牌" />
          ) : !tokens.length ? (
            <p className="admin-muted">尚未创建助手令牌。</p>
          ) : (
            <ul className="studio-token-list">
              {tokens.map((record) => (
                <li key={record.id}>
                  <div>
                    <strong>{record.name}</strong>
                    <p className="admin-muted">
                      {record.prefix}… ·{' '}
                      {record.revokedAt
                        ? `已撤销 ${dateLabel(record.revokedAt)}`
                        : new Date(record.expiresAt) <= new Date()
                          ? '已过期'
                          : `到期 ${dateLabel(record.expiresAt)}`}
                    </p>
                    <p className="admin-muted">
                      创建于 {dateLabel(record.createdAt)} · 最近使用 {dateLabel(record.lastUsedAt)}
                    </p>
                    <details className="studio-wrap">
                      <summary>已授权 {record.scopes.length} 项权限</summary>
                      <p className="admin-muted">
                        {record.scopes.length
                          ? record.scopes.map((scope) => `${scopeLabels[scope]} (${scope})`).join('、')
                          : '无授权，此令牌不可用于访问，请重新签发。'}
                      </p>
                    </details>
                  </div>
                  {!record.revokedAt && (
                    <Button variant="outline" size="sm" onClick={() => setRevoking(record)}>
                      撤销 {record.name}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {revoking && (
            <Confirm
              title="确认撤销令牌"
              description={`「${revoking.name}」将立即失去访问工作室的权限，撤销后不可恢复。`}
              onClose={() => setRevoking(null)}
              onConfirm={async () => {
                await productionService.revokeToken(revoking.id);
                setTokens(
                  tokens.map((record) =>
                    record.id === revoking.id ? { ...record, revokedAt: new Date().toISOString() } : record,
                  ),
                );
                setToken('');
                toast.success('令牌已撤销');
              }}
            />
          )}
        </LayerCard.Body>
      </LayerCard>
    </div>
  );
}
