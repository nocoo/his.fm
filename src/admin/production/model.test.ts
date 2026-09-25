import { describe, expect, it } from 'vitest';
import { fixture, readyFixture } from '../../../tests/worker/production-fixture';
import {
  agentConnectionInstructions,
  agentTask,
  audioBusy,
  completedSteps,
  currentStep,
  dateLabel,
  emptyBrief,
  finalMissing,
  latestPublication,
  readBrief,
} from './model';

function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}
const validForm = {
  title: ' 一次真实的对话 ',
  slug: 'a-real-conversation',
  episodeNumber: '7',
  category: 'life',
  durationMinutes: '12',
  intent: '整理自己的工作边界',
  tags: '生活， 工作, ,日常',
};
describe('production brief form', () => {
  it('parses numbers, trims values and accepts HTTPS links and text sources', () => {
    const sources = [{ type: 'url' as const, title: '参考', content: 'https://example.com/article' }];
    expect(readBrief(form(validForm), sources)).toEqual({
      error: '',
      data: {
        ...emptyBrief,
        title: '一次真实的对话',
        slug: 'a-real-conversation',
        episodeNumber: 7,
        category: 'life',
        targetDurationSeconds: 720,
        intent: validForm.intent,
        tags: ['生活', '工作', '日常'],
        sources,
      },
    });
    expect(readBrief(form({ ...validForm, tags: '' }), []).data?.tags).toEqual([]);
  });
  it('rejects missing values, invalid links, excessive lengths and invalid durations without losing input', () => {
    const input = form(validForm);
    expect(readBrief(input, [{ type: 'url', title: '', content: 'http://example.com' }]).data).toBeNull();
    expect(input.get('title')).toBe(validForm.title);
    for (const invalid of [
      new FormData(),
      form({ ...validForm, title: '字'.repeat(161) }),
      form({ ...validForm, durationMinutes: '31' }),
      form({ ...validForm, tags: '长'.repeat(31) }),
    ]) {
      const result = readBrief(invalid, []);
      expect(result.data).toBeNull();
      expect(result.error).toContain('HTTPS');
    }
  });
});
describe('final review readiness', () => {
  it('shows the latest actual publication separately for each platform', () => {
    const first = {
      platform: 'wechat' as const,
      url: 'https://mp.weixin.qq.com/s/first',
      publishedAt: '2026-09-24T10:00:00Z',
      confirmedAt: '2026-09-25T08:00:00Z',
      confirmedBy: 'editor',
      version: 1,
    };
    const newer = { ...first, publishedAt: '2026-09-25T07:00:00Z', version: 2 };
    const podcast = {
      ...first,
      platform: 'xiaoyuzhou' as const,
      url: 'https://www.xiaoyuzhoufm.com/episode/example',
    };
    expect(latestPublication(fixture(), 'wechat')).toBeNull();
    const production = fixture({ publications: [first, podcast, newer, first] });
    expect(latestPublication(production, 'wechat')).toEqual(newer);
    expect(latestPublication(production, 'xiaoyuzhou')).toEqual(podcast);
  });
  it('requires descriptions and current cover and completed audio', () => {
    expect(finalMissing(fixture())).toEqual(['摘要', '发布简介', '当前版本封面', '当前版本完整音频']);
    expect(finalMissing(readyFixture())).toEqual([]);
    expect(finalMissing(readyFixture({ scriptVersion: 2 }))).toEqual(['当前版本封面', '当前版本完整音频']);
    const ready = readyFixture();
    if (!ready.assets.audio || !ready.audioJob) throw new Error('Missing ready fixture assets');
    expect(
      finalMissing(
        readyFixture({
          assets: { cover: ready.assets.cover, audio: { ...ready.assets.audio, durationSeconds: 0 } },
        }),
      ),
    ).toEqual(['当前版本完整音频']);
    expect(finalMissing(readyFixture({ audioJob: null }))).toEqual(['当前版本完整音频']);
    expect(finalMissing(readyFixture({ audioJob: { ...ready.audioJob, status: 'running' } }))).toEqual([
      '当前版本完整音频',
    ]);
    expect(finalMissing(readyFixture({ audioJob: { ...ready.audioJob, scriptVersion: 2 } }))).toEqual([
      '当前版本完整音频',
    ]);
  });
  it('polls only active jobs and formats absent timestamps honestly', () => {
    expect(audioBusy(fixture())).toBe(false);
    const job = readyFixture().audioJob;
    if (!job) throw new Error('Missing audio fixture');
    for (const status of ['queued', 'running', 'failed', 'complete'] as const)
      expect(audioBusy(readyFixture({ audioJob: { ...job, status } }))).toBe(
        status === 'queued' || status === 'running',
      );
    expect(dateLabel(null)).toBe('尚无记录');
    expect(dateLabel('2026-09-25T00:00:00Z')).toContain('2026');
  });
});

describe('single-owner studio stages', () => {
  it('maps persisted agent states to the five owner views', () => {
    expect(
      ['draft', 'brief_review', 'scripting', 'script_review', 'production', 'final_review', 'ready'].map(
        (stage) => currentStep(stage as ReturnType<typeof fixture>['stage']),
      ),
    ).toEqual(['brief', 'brief', 'script', 'script', 'assets', 'review', 'publish']);
    expect(completedSteps(fixture())).toEqual({
      brief: false,
      script: false,
      assets: false,
      review: false,
      publish: false,
    });
    expect(completedSteps(readyFixture())).toEqual({
      brief: true,
      script: true,
      assets: true,
      review: true,
      publish: false,
    });
    expect(completedSteps(readyFixture({ scriptVersion: 2 })).assets).toBe(false);
  });
  it('marks publication complete only for the latest confirmed content', () => {
    const publication = {
      platform: 'wechat' as const,
      url: 'https://mp.weixin.qq.com/s/example',
      publishedAt: '2026-09-24T00:00:00Z',
      confirmedAt: '2026-09-25T00:00:00Z',
      confirmedBy: 'owner',
      version: 3,
    };
    const production = readyFixture({ publications: [publication] });
    expect(completedSteps(production).publish).toBe(true);
    production.approvals.final = { by: 'owner', at: '2026-09-25T01:00:00Z' };
    expect(completedSteps(production).publish).toBe(false);
    production.approvals.final = null;
    expect(completedSteps(production).review).toBe(false);
  });
  it('builds a credential-free task for the selected API environment', () => {
    for (const base of ['https://his.fm', 'https://hisfm.dev.hexly.ai']) {
      const task = agentTask('整理素材', fixture(), base);
      expect(task).toContain(`${base}/api/agent/productions/production-test`);
      expect(task).toContain('HISFM_AGENT_TOKEN');
      expect(agentConnectionInstructions(base)).toContain(`${base}/api/agent/me`);
      expect(agentConnectionInstructions(base)).toContain('HISFM_AGENT_TOKEN');
      expect(task).toContain('最新 version');
      expect(task).toContain('整理素材');
      expect(task).not.toContain('hisfm_one_time');
    }
  });
});
