import { Button, Field, Input, LayerCard } from '@nocoo/basalt';
import { InputArea } from '@nocoo/basalt/components/input-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@nocoo/basalt/components/tabs';
import { useState } from 'react';
import { type Production, type Publication, publicationSchema } from '../../shared/production';
import { formatWechat, formatXiaoyuzhou } from '../../shared/publication-format';
import { toLocalDateTime } from '../model';
import { Choice, Confirm, CopyButton } from './controls';
import { dateLabel } from './model';
import { productionService } from './service';

export function PublicationPanel({
  production,
  pending,
  mutate,
}: {
  production: Production;
  pending: boolean;
  mutate: (operation: () => Promise<{ production: Production }>, message: string) => Promise<boolean>;
}) {
  const [platform, setPlatform] = useState<Publication['platform']>('wechat');
  const [confirm, setConfirm] = useState<Pick<Publication, 'platform' | 'url' | 'publishedAt'> | null>(null);
  const [error, setError] = useState('');
  const wechat = formatWechat(production);
  const xiaoyuzhou = formatXiaoyuzhou(production);
  return (
    <LayerCard padding="none">
      <LayerCard.Header>
        <strong>发布到你的平台</strong>
      </LayerCard.Header>
      <LayerCard.Body className="studio-stack studio-padding">
        <p className="admin-muted">
          复制内容，在平台完成手动发布后，回来记录真实链接和时间。确认发布会同步更新 his.fm 节目页。
        </p>
        <Tabs defaultValue="wechat">
          <TabsList aria-label="发布平台预览">
            <TabsTrigger value="wechat">微信公众号</TabsTrigger>
            <TabsTrigger value="xiaoyuzhou">小宇宙</TabsTrigger>
          </TabsList>
          <TabsContent value="wechat">
            <div className="studio-stack">
              <div className="studio-row">
                <CopyButton label="复制公众号富文本" read={() => wechat} />
                <Button variant="ghost" asChild>
                  <a href="https://mp.weixin.qq.com/" target="_blank" rel="noopener noreferrer">
                    打开公众号后台 ↗
                  </a>
                </Button>
              </div>
              <iframe
                title="微信公众号排版预览"
                className="studio-publication-preview"
                sandbox=""
                srcDoc={`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline'"></head><body style="margin:24px;background:white">${wechat.html}</body></html>`}
              />
            </div>
          </TabsContent>
          <TabsContent value="xiaoyuzhou">
            <div className="studio-stack">
              <div className="studio-row">
                <CopyButton label="复制小宇宙纯文本" read={() => xiaoyuzhou} />
                <Button variant="ghost" asChild>
                  <a href="https://podcaster.xiaoyuzhoufm.com/" target="_blank" rel="noopener noreferrer">
                    打开小宇宙后台 ↗
                  </a>
                </Button>
              </div>
              <InputArea aria-label="小宇宙简介预览" value={xiaoyuzhou} readOnly rows={12} />
            </div>
          </TabsContent>
        </Tabs>
        <form
          className="studio-stack"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const date = new Date(String(form.get('publishedAt')));
            const parsed = publicationSchema.safeParse({
              version: production.version,
              platform,
              url: String(form.get('url')),
              publishedAt: Number.isFinite(date.getTime()) ? date.toISOString() : '',
            });
            if (!parsed.success) {
              setError('请填写有效的 HTTPS 发布链接和发布时间。');
              return;
            }
            setError('');
            setConfirm(parsed.data);
          }}
        >
          <fieldset disabled={pending} className="studio-fieldset studio-stack">
            <div className="studio-grid">
              <Field label="发布平台">
                <Choice
                  label="记录发布平台"
                  value={platform}
                  onChange={(next) => setPlatform(next as Publication['platform'])}
                  options={[
                    { value: 'wechat', label: '微信公众号' },
                    { value: 'xiaoyuzhou', label: '小宇宙' },
                  ]}
                />
              </Field>
              <Field label="实际发布时间" htmlFor="publication-time" required>
                <Input
                  id="publication-time"
                  name="publishedAt"
                  type="datetime-local"
                  required
                  defaultValue={toLocalDateTime(new Date().toISOString())}
                />
              </Field>
            </div>
            <Field label="已发布的节目链接" htmlFor="publication-url" required>
              <Input
                id="publication-url"
                name="url"
                type="url"
                required
                maxLength={2048}
                placeholder="https://"
              />
            </Field>
            {error && (
              <p className="admin-error" role="alert">
                {error}
              </p>
            )}
            <div className="studio-actions">
              <Button type="submit">人工确认已发布</Button>
            </div>
          </fieldset>
        </form>
        {production.publications.length > 0 && (
          <div className="studio-stack">
            <strong>发布记录</strong>
            {production.publications.map((publication) => (
              <LayerCard.Well
                key={`${publication.platform}-${publication.version}`}
                className="studio-padding"
              >
                <a className="studio-link" href={publication.url} target="_blank" rel="noopener noreferrer">
                  {publication.platform === 'wechat' ? '微信公众号' : '小宇宙'} ↗
                </a>
                <p className="admin-muted">
                  {dateLabel(publication.publishedAt)} · {publication.confirmedBy} 人工确认
                </p>
              </LayerCard.Well>
            ))}
          </div>
        )}
        {confirm && (
          <Confirm
            title="确认记录此次发布"
            description={`确认内容已在${confirm.platform === 'wechat' ? '微信公众号' : '小宇宙'}发布，链接与时间准确。his.fm 将同步展示本次已批准的节目。`}
            onClose={() => setConfirm(null)}
            onConfirm={() =>
              mutate(
                () => productionService.publish(production.id, production.version, confirm),
                '已记录发布，节目页已同步',
              )
            }
          />
        )}
      </LayerCard.Body>
    </LayerCard>
  );
}
