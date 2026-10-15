import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configurationStatus, runtimeSettings } from './settings.ts';
import { testConfig } from './testing/fixtures.ts';

describe('private native configuration', () => {
  it('returns allowlisted settings without keys and atomically applies versioned updates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hisfm-settings-'));
    const path = join(directory, 'config.json');
    const config = testConfig(directory);
    config.speechKeys = { gemini: 'private-gemini-key', elevenlabs: '' };
    try {
      await writeFile(path, JSON.stringify(config), { mode: 0o600 });
      const status = await runtimeSettings({ kind: 'settings.read' }, path);
      expect(status).toEqual(configurationStatus(config));
      expect(status.providers).toMatchObject({ gemini: true, elevenlabs: false });
      expect(JSON.stringify(status)).not.toMatch(
        /private-gemini-key|fake-model-key|fake-site-key|apiKey|speechKeys/,
      );
      const next = await runtimeSettings(
        {
          kind: 'settings.update',
          input: {
            version: status.version,
            settings: { ...status.settings, defaultProvider: 'elevenlabs' },
            credentials: { elevenlabs: 'private-eleven-key' },
          },
        },
        path,
      );
      expect(next.version).not.toBe(status.version);
      expect(next.providers.elevenlabs).toBe(true);
      expect(JSON.stringify(next)).not.toContain('private-eleven-key');
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      const saved = JSON.parse(await readFile(path, 'utf8'));
      expect(saved.speechKeys).toEqual({ gemini: 'private-gemini-key', elevenlabs: 'private-eleven-key' });
      expect(saved.websites).toEqual(config.websites);
      await expect(
        runtimeSettings(
          { kind: 'settings.update', input: { version: status.version, settings: status.settings } },
          path,
        ),
      ).rejects.toThrow('已更新');
      const refreshed = await runtimeSettings({ kind: 'settings.read' }, path);
      const rotateOnly = await runtimeSettings(
        {
          kind: 'settings.update',
          input: {
            version: refreshed.version,
            settings: refreshed.settings,
            credentials: { elevenlabs: 'rotated-key' },
          },
        },
        path,
      );
      expect(rotateOnly.version).not.toBe(refreshed.version);
      expect(JSON.stringify(rotateOnly)).not.toContain('rotated-key');
      const cleared = await runtimeSettings(
        {
          kind: 'settings.update',
          input: { version: rotateOnly.version, credentials: { gemini: null, elevenlabs: null } },
        },
        path,
      );
      expect(cleared.providers).toMatchObject({ gemini: false, elevenlabs: false });
      expect(cleared.settings).toEqual(rotateOnly.settings);
      expect(JSON.parse(await readFile(path, 'utf8')).speechKeys).toEqual({ gemini: '', elevenlabs: '' });
      await expect(runtimeSettings({ kind: 'settings.read' }, join(directory, 'missing'))).rejects.toThrow(
        '配置',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
