import { readdirSync, readFileSync } from 'node:fs';
import { scopes } from '@his-fm/contracts';
import { Miniflare } from 'miniflare';
import { expect, it } from 'vitest';
import { productionResponseSchema } from '../../worker/agent-contract';
import { authenticateAgent } from '../../worker/agent-tokens';
import { getChannel } from '../../worker/channel';
import { requireFinalAssets } from '../../worker/production-model';
import { defaultPrompts } from '../../worker/prompt-defaults';
import { routeStorage } from '../../worker/storage';
import { human, readyFixture } from './production-fixture';

it('retires native state without losing business grants, prompt bodies, published assets or audit', async () => {
  const mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'retirement-test',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response("ok")}}' },
            },
          },
          env: {
            DB: { type: 'd1', name: 'retirement' },
            MEDIA: { type: 'r2', name: 'retirement' },
            ENVIRONMENT: { type: 'json', value: 'local' },
          },
        },
      },
    ],
  });
  try {
    const env = await mf.getBindings<Env>();
    const apply = (name: string) =>
      env.DB.batch(
        readFileSync(`migrations/${name}`, 'utf8')
          .split(';')
          .filter((sql) => sql.trim())
          .map((sql) => env.DB.prepare(sql)),
      );
    for (const name of readdirSync('migrations')
      .filter((name) => name.endsWith('.sql') && !name.startsWith('0015'))
      .sort())
      await apply(name);
    const legacyPrompts = {
      ...defaultPrompts,
      coordinator: 'Original private workflow body. Do not rewrite.',
      narration: undefined,
    };
    await env.DB.prepare(
      'INSERT INTO channel_profile (id,version,content,prompts,updated_at,updated_by) VALUES (1,7,?,?,?,?)',
    )
      .bind('Original global policy', JSON.stringify(legacyPrompts), 'before', 'owner')
      .run();
    const completed = {
      ...readyFixture(),
      events: [
        {
          id: 'audit',
          at: 'before',
          actor: { kind: 'agent', name: 'Legacy executor', scopes: ['runtime:connect', 'productions:write'] },
          action: 'record_publication:wechat',
          feedback: 'Original audit',
        },
      ],
      publications: [
        {
          platform: 'wechat',
          url: 'https://mp.weixin.qq.com/s/real',
          publishedAt: '2026-09-24T00:00:00.000Z',
          confirmedAt: 'before',
          confirmedBy: 'owner',
          version: 1,
        },
      ],
      audioJob: { id: 'legacy-job', status: 'complete', scriptVersion: 1, createdAt: 'before', error: null },
    };
    await env.DB.prepare('INSERT INTO productions VALUES (?,?,?,?,?,?)')
      .bind(
        completed.id,
        completed.version,
        completed.stage,
        JSON.stringify(completed),
        completed.createdAt,
        completed.updatedAt,
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO episodes(id,slug,episode_number,title,summary,transcript,show_notes,cover_url,category,status,created_at,updated_at,audio_url,published_at,source_production_id) VALUES ('public','public',1,'Existing','Summary','Script','Notes','https://f.no.mt/cover.png','manager-notes','published','before','before','https://f.no.mt/audio.wav','2026-09-24T00:00:00.000Z',?)",
    )
      .bind(completed.id)
      .run();
    const beforeEpisode = await env.DB.prepare('SELECT * FROM episodes').first();
    await env.DB.prepare('INSERT INTO audio_jobs VALUES (?,?,?, ?,NULL,?,?)')
      .bind(
        'legacy-job',
        completed.id,
        JSON.stringify({
          scriptVersion: 1,
          voice: 'LegacyVoice',
          introKey: 'bumper.wav',
          transcript: 'PRIVATE_TRANSCRIPT',
          credentials: { gemini: 'SECRET_SENTINEL' },
        }),
        'complete',
        'before',
        'before',
      )
      .run();
    await env.DB.prepare(
      'INSERT INTO speech_jobs(id,kind,snapshot,command_id,status,result,created_at) VALUES (?,?,?,?,?,?,?)',
    )
      .bind(
        'preview',
        'preview',
        JSON.stringify({ text: 'PRIVATE_SPEECH', credentials: { gemini: 'SECRET_SENTINEL' } }),
        'old-command',
        'complete',
        JSON.stringify({ url: 'https://f.no.mt/preview.wav', durationSeconds: 12 }),
        'before',
      )
      .run();
    await env.DB.prepare('INSERT INTO production_settings VALUES (1,?)')
      .bind(
        JSON.stringify({ intro: { key: 'setting-bumper.wav' }, credentials: { apiKey: 'SECRET_SENTINEL' } }),
      )
      .run();
    const retired = [
      'settings:read',
      'settings:write',
      'credentials:write',
      'audio:generate',
      'tasks:read',
      'tasks:submit',
      'tasks:cancel',
      'tasks:manage',
      'runtime:connect',
      'runtime:manage',
    ];
    const secrets = Array.from({ length: 8 }, (_, index) => `hisfm_${String(index).repeat(64)}`);
    const grants: unknown[] = [
      ['productions:read', 'runtime:connect', 'tasks:submit', 'prompts:write'],
      ['audio:generate', 'settings:read'],
      ['episodes:read', 'unknown:grant', 'runtime:manage'],
      { invalid: 'episodes:read' },
      [
        'episodes:read',
        null,
        true,
        false,
        1,
        { invalid: 'episodes:read' },
        ['episodes:read'],
        'runtime:connect',
      ],
      ['episodes:read', 'runtime:connect', 'runtime:connect'],
      ['episodes:read', ...Array(40).fill('runtime:connect')],
      [...scopes, ...retired],
    ];
    for (const [index, token] of secrets.entries()) {
      const hash = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
      ).toString('hex');
      await env.DB.prepare(
        'INSERT INTO agent_tokens(id,name,prefix,token_hash,created_at,expires_at,scopes) VALUES (?,?,?,?,?,?,?)',
      )
        .bind(
          String(index),
          'Existing',
          'hisfm_',
          hash,
          'before',
          '2099-01-01T00:00:00.000Z',
          JSON.stringify(grants[index]),
        )
        .run();
    }
    for (const key of ['audio.wav', 'cover.png', 'bumper.wav', 'preview.wav', 'setting-bumper.wav'])
      await env.MEDIA.put(key, 'unchanged media');
    await apply('0015_retire_native_runtime.sql');
    const production = JSON.parse(
      (await env.DB.prepare('SELECT data FROM productions').first<string>('data')) ?? '{}',
    );
    const { audioJob: _removed, ...expected } = completed;
    expect(production).toEqual(expected);
    expect(productionResponseSchema.parse(production).events[0].actor.scopes).toContain('runtime:connect');
    requireFinalAssets(production);
    expect(await env.DB.prepare('SELECT * FROM episodes').first()).toEqual(beforeEpisode);
    const channel = await getChannel(env.DB);
    expect(channel).toMatchObject({
      version: 8,
      content: 'Original global policy',
      updatedAt: 'before',
      updatedBy: 'owner',
      prompts: { coordinator: legacyPrompts.coordinator, narration: defaultPrompts.narration },
    });
    for (const [key, value] of Object.entries(legacyPrompts))
      if (value !== undefined) expect(channel.prompts[key as keyof typeof defaultPrompts]).toBe(value);
    const tokenRows = await env.DB.prepare('SELECT scopes FROM agent_tokens ORDER BY id').all<{
      scopes: string;
    }>();
    expect(tokenRows.results.map((row) => JSON.parse(row.scopes))).toEqual([
      ['productions:read', 'prompts:write'],
      [],
      ['episodes:read', 'unknown:grant'],
      { invalid: 'episodes:read' },
      ['episodes:read', null, true, false, 1, { invalid: 'episodes:read' }, ['episodes:read']],
      grants[5],
      grants[6],
      [...scopes],
    ]);
    const auth = (token: string) =>
      authenticateAgent(
        new Request('https://example.test', { headers: { Authorization: `Bearer ${token}` } }),
        env,
      );
    expect((await auth(secrets[0])).scopes).toEqual(['productions:read', 'prompts:write']);
    await expect(auth(secrets[1])).rejects.toMatchObject({ status: 401 });
    await expect(auth(secrets[2])).rejects.toMatchObject({ status: 401 });
    await expect(auth(secrets[3])).rejects.toMatchObject({ status: 401 });
    await expect(auth(secrets[4])).rejects.toMatchObject({ status: 401 });
    await expect(auth(secrets[5])).rejects.toMatchObject({ status: 401 });
    await expect(auth(secrets[6])).rejects.toMatchObject({ status: 401 });
    expect((await auth(secrets[7])).scopes).toEqual(scopes);
    const archive = await env.DB.prepare('SELECT data FROM media_provenance').all<{ data: string }>();
    const archived = JSON.stringify(archive.results);
    for (const sensitive of ['SECRET_SENTINEL', 'PRIVATE_TRANSCRIPT', 'PRIVATE_SPEECH', 'credentials'])
      expect(archived).not.toContain(sensitive);
    expect(archived).toContain('legacy-job');
    const inventory = await routeStorage(new Request('https://example.test/admin/api/storage'), env, human);
    const objects = (await inventory.json()) as { objects: { key: string; state: string }[] };
    expect(objects.objects).toHaveLength(5);
    expect(objects.objects.every((object) => object.state === 'referenced')).toBe(true);
    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{
      name: string;
    }>();
    for (const name of [
      'audio_jobs',
      'speech_jobs',
      'production_settings',
      'agent_station',
      'agent_commands',
      'agent_contexts',
      'agent_events',
      'agent_receipts',
      'agent_proposals',
      'agent_write_fence',
    ])
      expect(tables.results.map((table) => table.name)).not.toContain(name);
  } finally {
    await mf.dispose();
  }
}, 30000);
