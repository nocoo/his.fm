import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import config from '../cloudflare.config';

vi.mock('../worker/entry', () => ({}));

describe('Cloudflare configuration', () => {
  it('uses one root version and only web and shared-contract workspaces', () => {
    const root = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    const app = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(root.workspaces).toEqual(['apps/*', 'packages/*']);
    expect(root.scripts.build).toBe('npm run build --workspace @his-fm/web');
    expect(root.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(app.version).toBeUndefined();
    expect(existsSync(new URL('../../../packages/contracts/package.json', import.meta.url))).toBe(true);
    expect(existsSync(new URL('../../../packages/agent/package.json', import.meta.url))).toBe(false);
    expect(root.scripts).not.toHaveProperty('agent');
    expect(root.scripts).not.toHaveProperty('dev:all');
  });

  it('checks the installed CLI before delegating deployment to the web workspace', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'hisfm-deploy-test-'));
    try {
      writeFileSync(join(temporary, 'npm'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
      const result = spawnSync(
        process.execPath,
        [new URL('../../../scripts/deploy.mjs', import.meta.url).pathname],
        { encoding: 'utf8', env: { ...process.env, PATH: `${temporary}:${process.env.PATH}` } },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim().split('\n')).toEqual(['run', 'deploy', '--workspace', '@his-fm/web']);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it('keeps the dependency tree free of Wrangler', () => {
    const lock = JSON.parse(readFileSync(new URL('../../../package-lock.json', import.meta.url), 'utf8'));
    expect(lock.packages['apps/web'].devDependencies.cf).toBe('1.0.0-beta.12');
    expect(Object.keys(lock.packages).filter((path) => path.endsWith('/wrangler'))).toEqual([]);
    expect(
      Object.keys(lock.packages).filter((path) => /frogie|pi-durable|packages\/agent/.test(path)),
    ).toEqual([]);
  });

  it('isolates local login, resources and domains from production', () => {
    const local = config({ mode: 'development', isPreview: false }).worker;
    const production = config({ mode: 'production', isPreview: false }).worker;
    expect(config({ mode: undefined, isPreview: false }).worker).toEqual(production);
    expect(local.env.ENVIRONMENT).toEqual({ type: 'text', value: 'local' });
    expect(production.env.ENVIRONMENT).toEqual({ type: 'text', value: 'production' });
    expect(local.domains).toEqual([]);
    expect(production.domains).toEqual(['his.fm', 'www.his.fm']);
    expect(local.cache).toEqual({ enabled: false });
    expect(production.cache).toEqual({ enabled: false });
    expect(local.exports).toEqual({
      PublicContent: { type: 'worker', cache: { enabled: false } },
    });
    expect(production.exports).toEqual({
      PublicContent: { type: 'worker', cache: { enabled: true } },
      AgentHub: { type: 'durable-object', state: 'deleted' },
    });
    expect(local.env.DB.id).toBe('00000000-0000-4000-8000-000000007056');
    expect(production.env.DB.id).toBe('66f7e201-22a8-450d-838d-ecbc382afbc6');
    for (const worker of [local, production]) {
      expect(worker.workersDev).toBe(false);
      expect(worker.previewUrls).toBe(false);
      expect(worker.env).not.toHaveProperty('AUDIO_WORKFLOW');
      expect(worker.env).not.toHaveProperty('AGENT_HUB');
      expect(worker.env).not.toHaveProperty('GEMINI_API_KEY');
      expect(worker.env.IMAGES).toEqual({ type: 'images' });
      expect(worker.assets.runWorkerFirst).toBe(true);
      expect(worker.assets.notFoundHandling).toBe('none');
    }
  });
});

describe('artwork uploader', () => {
  it.each([200, 403])('preserves metadata and records only successful uploads (%s)', (status) => {
    const root = mkdtempSync(join(tmpdir(), 'hisfm-upload-test-'));
    try {
      mkdirSync(join(root, 'artwork/identity'), { recursive: true });
      const bytes = Buffer.from('test image');
      const asset = {
        file: 'image.webp',
        key: 'images/identity/test image.webp',
        contentType: 'image/webp',
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
      writeFileSync(join(root, asset.file), bytes);
      writeFileSync(
        join(root, 'artwork/identity/manifest.json'),
        JSON.stringify({
          assets: [asset],
          cdn: 'https://f.no.mt',
          cacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      const script = new URL('../../../scripts/upload-brand-assets.mjs', import.meta.url).href;
      const result = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `
        import assert from 'node:assert/strict';
        globalThis.fetch = async (url, init) => {
          if (init.method === 'PUT') {
            assert.equal(url, 'https://api.cloudflare.com/client/v4/accounts/test-account/r2/buckets/his-fm/objects/images/identity/test%20image.webp');
            assert.equal(init.headers.Authorization, 'Bearer test-token');
            assert.equal(init.headers['Content-Type'], 'image/webp');
            assert.equal(init.headers['Cache-Control'], 'public, max-age=31536000, immutable');
            assert.equal(Buffer.from(init.body).toString(), 'test image');
            return new Response(null, { status: ${status} });
          }
          return new Response('test image', { headers: {
            'content-type': 'image/webp',
            'cache-control': 'public, max-age=31536000, immutable',
            'access-control-allow-origin': 'https://hisfm.dev.hexly.ai',
          } });
        };
        await import(${JSON.stringify(script)});
      `,
        ],
        {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: 'test-account', CLOUDFLARE_API_TOKEN: 'test-token' },
        },
      );
      expect(result.status, result.stderr).toBe(status === 200 ? 0 : 1);
      const receipt = join(root, '.local/appearance/r2-uploaded.json');
      if (status === 200) expect(JSON.parse(readFileSync(receipt, 'utf8'))).toEqual([asset.key]);
      else {
        expect(result.stderr).toContain('R2 upload failed: 403');
        expect(() => readFileSync(receipt)).toThrow();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
