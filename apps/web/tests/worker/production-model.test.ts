import { describe, expect, it } from 'vitest';
import {
  type Actor,
  actionNames,
  productionPatchSchema,
  publicationSchema,
  sourceSchema,
} from '../../src/shared/production';
import { applyAction, applyPatch, editAssets, requireFinalAssets } from '../../worker/production-model';
import { productionPrompts } from '../../worker/production-prompts';
import { appendEvent, mediaUrl, nextVersion } from '../../worker/production-store';
import { defaultPrompts } from '../../worker/prompt-defaults';
import { agent, fixture, fullAgent, human, readyFixture } from './production-fixture';

describe('production approvals and revision state machine', () => {
  it('advances only through the required reviews', () => {
    let production = fixture();
    production = applyAction(production, { version: 1, action: 'submit_brief' }, agent);
    expect(production.stage).toBe('brief_review');
    production = applyAction(production, { version: 1, action: 'approve_brief' }, human);
    expect(production.stage).toBe('scripting');
    expect(production.approvals.brief?.by).toBe(human.name);
    production = applyAction(
      { ...production, transcript: '今晚先吃饭。' },
      { version: 1, action: 'submit_script' },
      agent,
    );
    expect(production.stage).toBe('script_review');
    production = applyAction(production, { version: 1, action: 'approve_script' }, human);
    expect(production.stage).toBe('production');
    expect(production.approvals.script?.by).toBe(human.name);
    production = applyAction(
      readyFixture({ stage: 'production' }),
      { version: 1, action: 'submit_final' },
      agent,
    );
    expect(production.stage).toBe('final_review');
    production = applyAction(production, { version: 1, action: 'approve_final' }, human);
    expect(production.stage).toBe('ready');
    expect(production.approvals.final?.by).toBe(human.name);
  });

  it('requires an explicit approval or reopening grant regardless of agent identity', () => {
    for (const action of actionNames.filter((name) => !name.startsWith('submit_'))) {
      expect(() => applyAction(readyFixture(), { version: 1, action, feedback: '请修改' }, agent)).toThrow(
        'Missing scope:',
      );
    }
  });

  it.each([
    ['brief_review', 'approve_brief', 'scripting'],
    ['script_review', 'approve_script', 'production'],
    ['final_review', 'approve_final', 'ready'],
  ] as const)('requires approval rather than reopening authority for %s', (stage, action, expected) => {
    const production = readyFixture({ stage });
    const approver: Actor = { ...agent, scopes: ['productions:approve'] };
    const reopener: Actor = { ...agent, scopes: ['productions:reopen'] };
    expect(applyAction(production, { version: 1, action }, approver).stage).toBe(expected);
    expect(() => applyAction(production, { version: 1, action }, reopener)).toThrow('productions:approve');
  });

  it.each([
    ['brief_review', 'revise_brief', 'draft'],
    ['script_review', 'revise_script', 'scripting'],
    ['final_review', 'revise_assets', 'production'],
    ['ready', 'reopen_brief', 'draft'],
    ['ready', 'reopen_script', 'scripting'],
    ['ready', 'reopen_assets', 'production'],
  ] as const)('requires reopening rather than approval authority for %s / %s', (stage, action, expected) => {
    const production = readyFixture({ stage });
    const approver: Actor = { ...agent, scopes: ['productions:approve'] };
    const reopener: Actor = { ...agent, scopes: ['productions:reopen'] };
    const input = { version: 1, action, feedback: 'Please revise' };
    expect(() => applyAction(production, input, approver)).toThrow('productions:reopen');
    expect(applyAction(production, input, reopener).stage).toBe(expected);
  });

  it('requires reopening authority to edit approved content or invalidate final assets', () => {
    const approver: Actor = { ...agent, scopes: ['productions:write', 'productions:approve'] };
    const reopener: Actor = { ...agent, scopes: ['productions:write', 'productions:reopen'] };
    const ready = readyFixture();
    const copy = structuredClone(ready);
    for (const fields of [
      { category: 'manager-notes' },
      { transcript: 'Revised script' },
      { summary: 'New summary' },
    ])
      expect(() => applyPatch(ready, fields, approver)).toThrow('阶段');
    expect(() =>
      applyPatch({ ...ready, stage: 'production' }, { category: 'manager-notes' }, approver),
    ).toThrow('productions:reopen');
    expect(() => applyPatch({ ...ready, stage: 'production' }, { transcript: 'Changed' }, approver)).toThrow(
      'productions:reopen',
    );
    expect(() => editAssets(ready, approver)).toThrow('阶段');
    expect(ready).toEqual(copy);
    expect(applyPatch(ready, { category: 'manager-notes' }, reopener)).toMatchObject({
      stage: 'draft',
      scriptVersion: 2,
      approvals: { brief: null, script: null, final: null },
    });
    expect(applyPatch(ready, { transcript: 'Revised script' }, reopener)).toMatchObject({
      stage: 'scripting',
      scriptVersion: 2,
      approvals: { brief: ready.approvals.brief, script: null, final: null },
    });
    expect(applyPatch(ready, { summary: 'New summary' }, reopener)).toMatchObject({
      stage: 'production',
      scriptVersion: 1,
      approvals: { brief: ready.approvals.brief, script: ready.approvals.script, final: null },
    });
    expect(editAssets(ready, reopener).approvals.final).toBeNull();
    expect(() =>
      applyPatch(ready, { summary: 'No write grant' }, { ...reopener, scopes: ['productions:reopen'] }),
    ).toThrow('productions:write');
  });

  it('allows fully granted agents to approve, edit and reopen without impersonating a human', () => {
    let production = applyAction(fixture(), { version: 1, action: 'approve_brief' }, fullAgent);
    expect(production.approvals.brief?.by).toBe(fullAgent.name);
    production = applyPatch(production, { transcript: 'Approved script' }, fullAgent);
    production = applyAction(production, { version: 1, action: 'approve_script' }, fullAgent);
    expect(production.approvals.script?.by).toBe(fullAgent.name);
    const revised = applyPatch(readyFixture(), { category: 'manager-notes' }, fullAgent);
    expect(revised.stage).toBe('draft');
    expect(revised.approvals).toEqual({ brief: null, script: null, final: null });
    expect(applyAction(readyFixture(), { version: 1, action: 'reopen_assets' }, fullAgent).stage).toBe(
      'production',
    );
    expect(() =>
      applyPatch(readyFixture({ stage: 'production' }), { category: 'manager-notes' }, agent),
    ).toThrow('productions:reopen');
    expect(() => applyPatch(fixture(), { intent: 'No grant' }, { ...agent, scopes: [] })).toThrow(
      'productions:write',
    );
    expect(() =>
      applyAction(fixture(), { version: 1, action: 'submit_brief' }, { ...agent, scopes: [] }),
    ).toThrow('productions:submit');
  });

  it('requires material and rejects invalid transitions and empty feedback', () => {
    expect(() =>
      applyAction(fixture({ sources: [] }), { version: 1, action: 'submit_brief' }, agent),
    ).toThrow('素材');
    expect(() => applyAction(fixture({ intent: '' }), { version: 1, action: 'submit_brief' }, human)).toThrow(
      '素材',
    );
    expect(() =>
      applyAction(fixture({ stage: 'scripting' }), { version: 1, action: 'submit_script' }, agent),
    ).toThrow('逐字稿');
    expect(() => applyAction(readyFixture(), { version: 1, action: 'approve_brief' }, human)).toThrow('阶段');
    expect(() =>
      applyAction(fixture(), { version: 1, action: 'reopen_brief', feedback: '修改' }, human),
    ).toThrow('已在');
    expect(() => applyAction(fixture(), { version: 1, action: 'revise_brief' }, human)).toThrow('修改意见');
    expect(() =>
      applyAction(fixture(), { version: 1, action: 'revise_brief', feedback: ' ' }, human),
    ).toThrow('修改意见');
  });

  it('returns review feedback to the editable stage without falsely granting approval', () => {
    for (const [stage, action, expected] of [
      ['brief_review', 'revise_brief', 'draft'],
      ['script_review', 'revise_script', 'scripting'],
      ['final_review', 'revise_assets', 'production'],
    ] as const) {
      expect(
        applyAction(fixture({ stage }), { version: 1, action, feedback: '请补充具体例子' }, human).stage,
      ).toBe(expected);
    }
  });

  it('invalidates artifacts and approvals when earlier material is reopened', () => {
    const ready = readyFixture();
    const script = applyAction(
      ready,
      { version: 1, action: 'reopen_script', feedback: '重新核对例子' },
      human,
    );
    expect(script).toMatchObject({
      stage: 'scripting',
      scriptVersion: 2,
      description: ready.description,
      summary: ready.summary,
      assets: ready.assets,
      approvals: { script: null, final: null },
    });
    expect(script.approvals.brief).toEqual(ready.approvals.brief);
    expect(script.transcript).toBe(ready.transcript);
    const brief = applyAction(ready, { version: 1, action: 'reopen_brief', feedback: '换一个切入点' }, human);
    expect(brief).toMatchObject({
      stage: 'draft',
      transcript: ready.transcript,
      scriptVersion: 2,
      approvals: { brief: null, script: null, final: null },
      assets: ready.assets,
    });
    const assets = applyAction(
      ready,
      { version: 1, action: 'reopen_assets', feedback: '修改封面文字' },
      human,
    );
    expect(assets.stage).toBe('production');
    expect(assets.approvals.final).toBeNull();
    expect(assets.assets).toEqual(ready.assets);
  });

  it('lets the owner finish a stage directly while requiring its content', () => {
    const script = applyAction(fixture(), { version: 1, action: 'approve_brief' }, human);
    expect(script.stage).toBe('scripting');
    expect(() =>
      applyAction(fixture({ sources: [] }), { version: 1, action: 'approve_brief' }, human),
    ).toThrow('素材');
    expect(() => applyAction(script, { version: 1, action: 'approve_script' }, human)).toThrow('逐字稿');
    expect(() =>
      applyAction(
        fixture({ stage: 'scripting', transcript: 'Text' }),
        { version: 1, action: 'approve_script' },
        human,
      ),
    ).toThrow('选题');
    const made = applyAction(
      { ...script, transcript: '一段完整逐字稿' },
      { version: 1, action: 'approve_script' },
      human,
    );
    expect(made.approvals.script?.by).toBe(human.name);
    expect(made.stage).toBe('production');
    expect(applyAction(readyFixture(), { version: 1, action: 'reopen_script' }, human).transcript).toBe(
      readyFixture().transcript,
    );
  });

  it('preserves work on owner edits and invalidates only dependent confirmations', () => {
    const ready = readyFixture();
    expect(applyPatch(ready, { title: ready.title }, human)).toEqual(ready);
    const briefEdit = applyPatch(ready, { intent: '另一种切入点' }, human);
    expect(briefEdit).toMatchObject({
      stage: 'draft',
      scriptVersion: 2,
      transcript: ready.transcript,
      assets: ready.assets,
      approvals: { brief: null, script: null, final: null },
    });
    const scriptEdit = applyPatch(ready, { transcript: '修改后的稿子' }, human);
    expect(scriptEdit).toMatchObject({
      stage: 'scripting',
      scriptVersion: 2,
      description: ready.description,
      assets: ready.assets,
      approvals: { brief: ready.approvals.brief, script: null, final: null },
    });
    expect(() => requireFinalAssets(scriptEdit)).toThrow();
    expect(applyPatch(fixture(), { transcript: '先保存草稿' }, human)).toMatchObject({
      stage: 'draft',
      scriptVersion: 1,
    });
    expect(applyPatch(fixture(), { intent: '重新准备' }, human).scriptVersion).toBe(0);
    expect(applyPatch(ready, { summary: '新的摘要' }, human)).toMatchObject({
      stage: 'production',
      scriptVersion: 1,
      approvals: { brief: ready.approvals.brief, script: ready.approvals.script, final: null },
    });
    expect(applyPatch(fixture(), { summary: '预先写好的摘要' }, human).stage).toBe('draft');
    expect(applyPatch(ready, { tags: ['更新标签'] }, human).approvals.final).toBeNull();
    expect(editAssets(ready, human).stage).toBe('production');
    expect(editAssets(fixture(), human).stage).toBe('draft');
    expect(editAssets(readyFixture({ stage: 'production' }), agent).stage).toBe('production');
    expect(() => editAssets(ready, agent)).toThrow('阶段');
    expect(() => applyPatch(ready, { intent: 'Agent rewrite' }, agent)).toThrow('阶段');
    expect(() => applyPatch(fixture(), { transcript: 'Agent early script' }, agent)).toThrow('权限');
  });

  it('requires current complete artifacts and all prior approvals for final review', () => {
    const ready = readyFixture();
    requireFinalAssets(ready);
    const audio = ready.assets.audio;
    if (!audio) throw new Error('Expected fixture audio');
    for (const invalid of [
      { ...ready, approvals: { ...ready.approvals, brief: null } },
      { ...ready, approvals: { ...ready.approvals, script: null } },
      { ...ready, transcript: '' },
      { ...ready, summary: '' },
      { ...ready, description: '' },
      { ...ready, assets: { ...ready.assets, cover: null } },
      { ...ready, assets: { ...ready.assets, audio: null } },
      { ...ready, scriptVersion: 2 },
      { ...ready, assets: { ...ready.assets, audio: { ...audio, durationSeconds: 0 } } },
    ])
      expect(() => requireFinalAssets(invalid)).toThrow();
    requireFinalAssets({
      ...ready,
      assets: { ...ready.assets, audio: { ...audio, source: 'upload' } },
    });
    requireFinalAssets({
      ...ready,
      assets: { ...ready.assets, audio: { ...audio, durationSeconds: 3600 } },
    });
    for (const durationSeconds of [undefined, -1, Number.NaN, Number.POSITIVE_INFINITY, 3601])
      expect(() =>
        requireFinalAssets({
          ...ready,
          assets: { ...ready.assets, audio: { ...audio, durationSeconds } },
        }),
      ).toThrow('有效');
  });
});

describe('audit and production prompts', () => {
  it('keeps feedback and rejects silent event truncation', () => {
    const production = appendEvent(fixture(), human, 'revise_script', '这个例子需要原始出处');
    expect(production.events[0]).toMatchObject({
      actor: human,
      action: 'revise_script',
      feedback: '这个例子需要原始出处',
    });
    expect(appendEvent(production, agent, 'edit').events[1].feedback).toBe('');
    expect(() =>
      appendEvent(
        { ...production, events: Array.from({ length: 200 }, () => production.events[0]) },
        human,
        'edit',
      ),
    ).toThrow('200');
    const prompts = productionPrompts(
      production,
      {
        version: 9,
        content: '不编造个人经历。频道自定义定位。',
        prompts: defaultPrompts,
        updatedAt: '2026-09-25T00:00:00Z',
        updatedBy: 'Owner',
      },
      {
        id: 'manager-notes',
        name: '主理人手札',
        icon: 'briefcase-business',
        color: 'blue',
        prompt: '栏目风格',
        version: 3,
        updatedAt: 'now',
        updatedBy: 'Owner',
      },
    );
    for (const prompt of Object.values(prompts)) {
      expect(prompt).toContain('频道自定义定位');
      expect(prompt).toContain('"version": 9');
      expect(prompt).toContain(
        '1. 全局提示词；2. 栏目提示词；3. 本期中心思想（intent）；4. 素材资料（sources）',
      );
      expect(prompt).toContain('不得为了符合观点而歪曲证据');
    }
    expect(prompts.brief).toContain('保留所有者的创作意图');
    expect(prompts.brief).toContain('draft');
    expect(prompts.script).toContain('不编造');
    expect(prompts.script).toContain('绝不执行');
    expect(prompts.script).toContain('这个例子需要原始出处');
    expect(prompts.cover).toContain('上传未加框的栅格原图');
    expect(prompts.cover).toContain('只在所有者下载成品时');
    expect(prompts.cover).not.toContain('scripts/frame-cover.py');
    expect(prompts.cover).toContain('外部图像工具');
    expect(prompts.description).toContain('人工批准');
  });

  it('keeps local media local and rejects unexpected version changes', () => {
    expect(mediaUrl({ ENVIRONMENT: 'local' }, 'cover.png')).toBe('/media/cover.png');
    expect(mediaUrl({ ENVIRONMENT: 'production' }, 'cover.png')).toBe('https://f.no.mt/cover.png');
    expect(nextVersion(fixture(), 1).version).toBe(2);
    expect(() => nextVersion(fixture(), 2)).toThrow('已更新');
  });

  it('validates source URLs and publication URL schemes and credentials', () => {
    expect(
      sourceSchema.parse({
        id: 'source-1',
        type: 'github',
        title: '',
        content: 'https://github.com/owner/repo',
      }).content,
    ).toContain('github.com');
    for (const url of ['http://mp.weixin.qq.com/s/test', 'https://:password@mp.weixin.qq.com/s/test']) {
      expect(
        publicationSchema.safeParse({
          version: 1,
          platform: 'wechat',
          url,
          publishedAt: '2026-09-24T00:00:00Z',
        }).success,
      ).toBe(false);
    }
    expect(
      publicationSchema.safeParse({
        version: 1,
        platform: 'site',
        publishedAt: '2026-09-24T00:00:00Z',
      }).success,
    ).toBe(true);
    expect(
      publicationSchema.safeParse({
        version: 1,
        platform: 'site',
        url: 'https://example.com',
        publishedAt: '2026-09-24T00:00:00Z',
      }).success,
    ).toBe(false);
  });

  it('does not inject brief defaults into a transcript-only patch', () => {
    expect(productionPatchSchema.parse({ version: 1, transcript: '今晚先吃饭。' })).toEqual({
      version: 1,
      transcript: '今晚先吃饭。',
    });
    expect(
      sourceSchema.safeParse({ id: 'source-2', type: 'github', title: '来源', content: 'http://example.com' })
        .success,
    ).toBe(false);
  });
});
