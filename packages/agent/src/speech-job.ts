import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { speechSnapshotSchema } from '@his-fm/contracts';
import type { WebsiteClient } from './client.ts';
import { executionEnvironment } from './network.ts';

export async function runSpeechJob(
  client: WebsiteClient,
  generation: () => string,
  id: string,
  commandId: string,
  directory: string,
  signal: AbortSignal,
) {
  const job = await client.speech(id, commandId, generation());
  if (job.complete) return job;
  const input = speechSnapshotSchema.parse(job.input);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'speech-request.json');
  await writeFile(path, JSON.stringify(input), { mode: 0o600 });
  await client.speech(id, commandId, generation(), 'POST');
  let stdout: string;
  try {
    ({ stdout } = await promisify(execFile)(
      process.execPath,
      ['--experimental-strip-types', fileURLToPath(new URL('./speech-cli.ts', import.meta.url)), path],
      {
        env: executionEnvironment(),
        signal,
        timeout: 30 * 60000,
        maxBuffer: 64 * 1024,
      },
    ));
  } catch {
    if (!signal.aborted) await client.speech(id, commandId, generation(), 'DELETE');
    throw new Error('本机语音脚本失败；已保留分段缓存，未确认网站成品。');
  }
  const generated: { path: string } = JSON.parse(stdout);
  signal.throwIfAborted();
  const bytes = await readFile(generated.path);
  return client.speech(id, commandId, generation(), 'PUT', bytes);
}
