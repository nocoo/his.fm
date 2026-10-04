import { randomBytes, randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { type AiStatus, aiUpdateSchema, type RuntimeRequest } from '@his-fm/contracts';
import { type Config, loadConfig } from './config.ts';

export function configurationStatus(config: Config): AiStatus {
  return {
    version: config.configRevision,
    settings: config.speech,
    providers: {
      gemini: Boolean(config.speechKeys.gemini),
      elevenlabs: Boolean(config.speechKeys.elevenlabs),
      raven: Boolean(config.providers.raven.apiKey),
      decision: Boolean(config.decision.apiKey),
    },
    coordinator: {
      provider: config.coordinator.provider,
      model: config.coordinator.model,
      thinkingLevel: config.coordinator.thinkingLevel,
    },
    executor: {
      provider: config.executor.provider,
      model: config.executor.model,
      thinkingLevels: config.executor.thinkingLevels,
    },
    decision: {
      model: config.decision.model,
      maxInputBytes: config.decision.maxInputBytes,
      maxBatchQuestions: config.decision.maxBatchQuestions,
    },
  };
}

let updating = Promise.resolve();
export function runtimeSettings(
  request: RuntimeRequest,
  path = join(homedir(), '.config/his.fm/config.json'),
) {
  const result = updating.then(async () => {
    const lock = new DatabaseSync(`${path}.lock.sqlite`);
    try {
      lock.exec('PRAGMA busy_timeout = 2000; BEGIN IMMEDIATE');
      const config = await loadConfig(path);
      if (request.kind === 'settings.update') {
        const input = aiUpdateSchema.parse(request.input);
        if (configurationStatus(config).version !== input.version)
          throw new Error('配置已更新，请刷新后重试。');
        config.speech = input.settings;
        config.configRevision = randomBytes(32).toString('hex');
        Object.assign(config.speechKeys, input.credentials);
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
          await rename(temporary, path);
        } finally {
          await rm(temporary, { force: true });
        }
      }
      return configurationStatus(config);
    } finally {
      lock.close();
    }
  });
  updating = result.then(
    () => {},
    () => {},
  );
  return result;
}
