import { Button, Field, Input, LayerCard, toast } from '@nocoo/basalt';
import { InputArea } from '@nocoo/basalt/components/input-area';
import { PageHeader } from '@nocoo/basalt/components/page-header';
import { useCallback, useEffect, useState } from 'react';
import type { AgentTokenRecord } from '../../shared/production';
import { getEnvironment } from '../environment';
import { errorMessage } from '../model';
import { request } from '../service';
import { Confirm, CopyButton, Failure } from './controls';
import { dateLabel } from './model';
import { productionService } from './service';

export function ConnectionsPage() {
  const base = getEnvironment() === 'production' ? 'https://his.fm' : window.location.origin;
  const [tokens, setTokens] = useState<AgentTokenRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [token, setToken] = useState('');
  const [revoking, setRevoking] = useState<AgentTokenRecord | null>(null);
  const [station, setStation] = useState<{ tokenId: string; stationId: string; version: number } | null>(
    null,
  );
  const [online, setOnline] = useState(false);
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
            令牌允许助手准备内容与生成素材。选题、逐字稿、成品审批和发布确认仍由编辑本人完成。
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
              if (pending) return;
              const form = event.currentTarget;
              const values = new FormData(form);
              setPending(true);
              setError('');
              try {
                const result = await productionService.createToken(
                  String(values.get('name')).trim(),
                  Number(values.get('expiresInDays')),
                );
                setTokens((current) => [result.record, ...current]);
                setToken(result.token);
                form.reset();
                toast.success('助手令牌已创建');
              } catch (cause) {
                setError(errorMessage(cause));
              } finally {
                setPending(false);
              }
            }}
          >
            <fieldset disabled={pending || Boolean(token)} className="studio-fieldset studio-token-form">
              <Field label="助手名称" htmlFor="token-name" required>
                <Input id="token-name" name="name" required maxLength={100} placeholder="例如：工作室主控" />
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
              <Button type="submit" loading={pending}>
                创建助手令牌
              </Button>
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
