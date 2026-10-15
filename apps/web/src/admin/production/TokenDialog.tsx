import { type Scope, scopePresets, scopes } from '@his-fm/contracts';
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  LayerCard,
  toast,
} from '@nocoo/basalt';
import { InputArea } from '@nocoo/basalt/components/input-area';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { AgentTokenRecord } from '../../shared/production';
import { errorMessage } from '../model';
import { Choice, CopyButton } from './controls';
import { productionService } from './service';

export const scopeLabels: Record<Scope, string> = {
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
  'bumpers:read': '读取片头片尾',
  'bumpers:write': '上传和编辑片头片尾',
  'bumpers:delete': '删除片头片尾',
  'storage:read': '读取资源清单',
  'storage:write': '上传资源',
  'storage:delete': '删除和清理资源',
  'tokens:read': '读取令牌授权信息',
  'tokens:issue': '签发子令牌',
  'tokens:revoke': '撤销令牌',
  'tokens:delete': '删除已撤销令牌',
};
const presetOptions = [
  { value: 'reader', label: '只读（默认）' },
  { value: 'editor', label: '内容编辑' },
  { value: 'owner', label: '完全控制（高风险）' },
  { value: 'custom', label: '自定义权限' },
];

const scopeGroups = [
  { label: '制作与发布', prefixes: ['productions', 'publications', 'episodes'] },
  { label: '分类与提示词', prefixes: ['categories', 'prompts'] },
  { label: '素材与音频', prefixes: ['bumpers', 'storage'] },
  { label: '站点设置', prefixes: ['appearance'] },
  { label: '令牌管理', prefixes: ['tokens'] },
];

export function TokenDialog({ onCreated }: { onCreated: (record: AgentTokenRecord) => void }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [token, setToken] = useState('');
  const [preset, setPreset] = useState('reader');
  const [grants, setGrants] = useState<Scope[]>([...scopePresets.reader]);
  const [confirmed, setConfirmed] = useState(false);
  const highRisk = grants.filter(
    (scope) => !scope.endsWith(':read') && !['productions:write', 'productions:submit'].includes(scope),
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        setToken('');
        setError('');
        setPreset('reader');
        setGrants([...scopePresets.reader]);
        setConfirmed(false);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus size={16} />
          创建令牌
        </Button>
      </DialogTrigger>
      <DialogContent
        size="xl"
        className="studio-token-dialog"
        disablePointerDismissal={pending || Boolean(token)}
      >
        <DialogHeader>
          <DialogTitle>{token ? '保存新令牌' : '创建访问令牌'}</DialogTitle>
          <DialogDescription>
            {token
              ? '完整令牌只显示这一次，关闭后无法再次查看。'
              : '先填写用途，再选择权限。未勾选的操作一律不允许。'}
          </DialogDescription>
        </DialogHeader>
        {token ? (
          <div className="studio-stack">
            <InputArea aria-label="新建访问令牌" readOnly value={token} rows={3} />
            <DialogFooter>
              <CopyButton label="复制新令牌" read={() => token} />
              <DialogClose asChild>
                <Button>我已保存，关闭</Button>
              </DialogClose>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="studio-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              if (pending || !grants.length || (highRisk.length > 0 && !confirmed)) return;
              const values = new FormData(event.currentTarget);
              setPending(true);
              setError('');
              try {
                const result = await productionService.createToken(
                  String(values.get('name')).trim(),
                  Number(values.get('expiresInDays')),
                  grants,
                );
                onCreated(result.record);
                setToken(result.token);
                toast.success('访问令牌已创建');
              } catch (cause) {
                setError(errorMessage(cause));
              } finally {
                setPending(false);
              }
            }}
          >
            <fieldset disabled={pending} className="studio-fieldset studio-stack">
              <div className="studio-token-form">
                <Field label="令牌名称" htmlFor="token-name" required>
                  <Input
                    id="token-name"
                    name="name"
                    required
                    maxLength={100}
                    placeholder="例如：外部内容编辑"
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
              </div>
              <Field label="权限预设">
                <Choice
                  label="权限预设"
                  value={preset}
                  disabled={pending}
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
                  disabled={pending}
                  onValueChange={(values) => {
                    setGrants(values as Scope[]);
                    setPreset('custom');
                    setConfirmed(false);
                  }}
                  className="studio-fieldset studio-scope-groups"
                >
                  <Checkbox.Legend>允许的操作</Checkbox.Legend>
                  {scopeGroups.map((group) => (
                    <section
                      className="studio-stack studio-scope-group"
                      key={group.label}
                      aria-label={group.label}
                    >
                      <h3>{group.label}</h3>
                      {scopes
                        .filter((scope) => group.prefixes.includes(scope.split(':')[0]))
                        .map((scope) => (
                          <label className="studio-checkbox" key={scope} htmlFor={`grant-${scope}`}>
                            <Checkbox.Item
                              id={`grant-${scope}`}
                              value={scope}
                              aria-label={scopeLabels[scope]}
                            />
                            <span className="studio-wrap">
                              {scopeLabels[scope]}
                              <code className="admin-muted studio-scope-code">{scope}</code>
                            </span>
                          </label>
                        ))}
                    </section>
                  ))}
                </Checkbox.Group>
              </details>
              {highRisk.length > 0 && (
                <LayerCard className="studio-stack" role="region" aria-label="高风险授权确认">
                  <strong>{grants.length === scopes.length ? '完全控制授权' : '额外授权确认'}</strong>
                  <p className="admin-muted">
                    包含 {highRisk.length}{' '}
                    项高风险权限，可能改变站点、删除数据或扩大访问权限。令牌仅用于当前环境。
                  </p>
                  <details>
                    <summary>查看高风险权限</summary>
                    <p className="admin-muted">{highRisk.map((scope) => scopeLabels[scope]).join('、')}</p>
                  </details>
                  <label className="studio-checkbox" htmlFor="token-risk-confirmation">
                    <Checkbox
                      id="token-risk-confirmation"
                      checked={confirmed}
                      onCheckedChange={(value) => setConfirmed(value === true)}
                      aria-label="我确认授予以上高风险权限"
                      disabled={pending}
                    />
                    <span>我确认授予以上高风险权限</span>
                  </label>
                </LayerCard>
              )}
            </fieldset>
            {error && (
              <p className="admin-error" role="alert">
                {error}
              </p>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" disabled={pending}>
                  取消
                </Button>
              </DialogClose>
              <Button
                type="submit"
                loading={pending}
                disabled={!grants.length || (highRisk.length > 0 && !confirmed)}
              >
                创建访问令牌
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
