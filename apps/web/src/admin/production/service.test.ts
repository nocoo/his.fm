import { afterEach, describe, expect, it, vi } from 'vitest';
import { brief, fixture } from '../../../tests/worker/production-fixture';
import { productionService as service } from './service';

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);
afterEach(() => fetchMock.mockReset());
function response(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(status === 204 ? null : JSON.stringify(body), { status }));
}
function lastRequest() {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error('No request recorded');
  const [url, init] = call;
  return { url, ...init };
}

describe('production service contracts', () => {
  it('loads production data, prompts and settings with cancellation', async () => {
    const signal = new AbortController().signal;
    for (const [call, url, body] of [
      [() => service.list(signal), '/productions', { productions: [fixture()] }],
      [() => service.get('a/b', signal), '/productions/a%2Fb', { production: fixture() }],
      [
        () => service.prompts('a/b'),
        '/productions/a%2Fb/prompts',
        { script: '逐字稿提示', cover: '封面提示', description: '简介提示' },
      ],
      [() => service.settings(signal), '/production-settings', { settings: { voice: 'Kore' } }],
      [() => service.tokens(signal), '/agent-tokens', { tokens: [] }],
      [() => service.channel(signal), '/channel', { channel: { version: 1, content: '定位' } }],
    ] as const) {
      response(body);
      expect(await call()).toEqual(body);
      expect(lastRequest()).toMatchObject({ url: `/admin/api${url}`, credentials: 'same-origin' });
    }
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(signal);
    expect(fetchMock.mock.calls[1][1]?.signal).toBe(signal);
    expect(fetchMock.mock.calls[3][1]?.signal).toBe(signal);
    expect(fetchMock.mock.calls[4][1]?.signal).toBe(signal);
  });
  it('sends expected versions for mutations, publication and deletion', async () => {
    response({ channel: { version: 2, content: '新定位' } });
    await service.saveChannel({ version: 1, content: '新定位' });
    expect(lastRequest()).toMatchObject({
      url: '/admin/api/channel',
      method: 'PUT',
      body: '{"version":1,"content":"新定位"}',
    });
    const production = fixture();
    response({ production }, 201);
    expect(await service.create(brief)).toEqual({ production });
    expect(lastRequest()).toMatchObject({
      url: '/admin/api/productions',
      method: 'POST',
      body: JSON.stringify(brief),
    });
    response({ production });
    await service.update('a/b', 4, { transcript: '已修改的逐字稿' });
    expect(JSON.parse(String(lastRequest().body))).toEqual({ version: 4, transcript: '已修改的逐字稿' });
    expect(lastRequest()).toMatchObject({ url: '/admin/api/productions/a%2Fb', method: 'PUT' });
    const action = { version: 4, action: 'revise_script' as const, feedback: '请补充事实来源' };
    response({ production });
    await service.action('a/b', action);
    expect(lastRequest()).toMatchObject({
      url: '/admin/api/productions/a%2Fb/actions',
      method: 'POST',
      body: JSON.stringify(action),
    });
    response({ production }, 202);
    await service.audio('a/b', { version: 5, voice: 'Sulafat', includeBumpers: false });
    expect(lastRequest()).toMatchObject({
      url: '/admin/api/productions/a%2Fb/audio',
      method: 'POST',
      body: '{"version":5,"voice":"Sulafat","includeBumpers":false}',
    });
    response({ preview: { url: '/media/preview.wav' } });
    await service.preview({ voice: 'Sulafat', speakingStyle: '自然', text: '这里是 his.fm。' });
    expect(lastRequest()).toMatchObject({ url: '/admin/api/production-settings/preview', method: 'POST' });
    expect(JSON.parse(String(lastRequest().body))).toEqual({
      voice: 'Sulafat',
      speakingStyle: '自然',
      text: '这里是 his.fm。',
    });
    const publication = {
      platform: 'wechat' as const,
      url: 'https://mp.weixin.qq.com/s/test',
      publishedAt: '2026-09-25T00:00:00.000Z',
    };
    response({ production });
    await service.publish('a/b', 6, publication);
    expect(lastRequest()).toMatchObject({ url: '/admin/api/productions/a%2Fb/publications', method: 'POST' });
    expect(JSON.parse(String(lastRequest().body))).toEqual({ ...publication, version: 6 });
    response(null, 204);
    expect(await service.remove('a/b', 7)).toBeUndefined();
    expect(lastRequest()).toMatchObject({ url: '/admin/api/productions/a%2Fb?version=7', method: 'DELETE' });
  });
  it('uploads binary cover and bumper data without JSON serialization', async () => {
    const cover = new File(['image'], 'cover.webp', { type: 'image/webp' });
    response({ production: fixture() });
    await service.cover('a/b', 8, cover);
    expect(lastRequest()).toMatchObject({
      url: '/admin/api/productions/a%2Fb/assets/cover?version=8',
      method: 'PUT',
      body: cover,
      headers: { 'Content-Type': 'image/webp' },
    });
    const wav = new File(['audio'], 'intro.wav');
    response({ settings: {} });
    await service.bumper('intro', wav);
    expect(lastRequest()).toMatchObject({
      url: '/admin/api/production-settings/intro',
      body: wav,
      headers: { 'Content-Type': 'audio/wav' },
    });
    response({ settings: {} });
    await service.bumper('outro', wav);
    expect(lastRequest().url).toBe('/admin/api/production-settings/outro');
  });
  it('saves voice configuration and creates and revokes expiring tokens', async () => {
    const settings = { voice: 'Kore' as const, speakingStyle: '自然、轻松地讲述' };
    response({ settings });
    expect(await service.saveSettings(settings)).toEqual({ settings });
    expect(lastRequest()).toMatchObject({ method: 'PUT', body: JSON.stringify(settings) });
    response({ token: 'one-time-token', record: { id: 'one' } }, 201);
    expect((await service.createToken('Hermes', 30)).token).toBe('one-time-token');
    expect(lastRequest()).toMatchObject({
      url: '/admin/api/agent-tokens',
      method: 'POST',
      body: '{"name":"Hermes","expiresInDays":30}',
    });
    response(null, 204);
    await service.revokeToken('a/b');
    expect(lastRequest()).toMatchObject({ url: '/admin/api/agent-tokens/a%2Fb', method: 'DELETE' });
  });
  it('preserves version conflicts, revoked sessions and upload errors for the viewmodel', async () => {
    for (const status of [401, 409, 413]) {
      response({ error: '请检查后重试' }, status);
      await expect(service.update('id', 1, { title: '未保存内容' })).rejects.toMatchObject({
        status,
        message: '请检查后重试',
      });
    }
    fetchMock.mockRejectedValueOnce(new TypeError('网络中断'));
    await expect(service.tokens()).rejects.toThrow('网络中断');
  });
});
