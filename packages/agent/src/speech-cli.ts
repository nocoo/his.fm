import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AudioError, speechSnapshotSchema } from '@his-fm/contracts';
import { loadConfig } from './config.ts';
import { generateSpeech } from './speech.ts';

export async function runSpeech(
  args: string[],
  services = { loadConfig, generateSpeech },
  directory = join(homedir(), '.config/his.fm/speech'),
) {
  if (args.length !== 1 || !args[0]) throw new Error('需要一个语音任务 JSON 文件路径');
  const input = speechSnapshotSchema.parse(JSON.parse(await readFile(args[0], 'utf8')));
  return services.generateSpeech(await services.loadConfig(), input, directory);
}
export async function speechCli(args: string[], run = runSpeech, host = process) {
  try {
    console.log(JSON.stringify(await run(args)));
  } catch (error) {
    const reason =
      error instanceof TypeError && error.cause
        ? 'network'
        : error instanceof AudioError
          ? 'provider'
          : 'unknown';
    console.error(`hisfm-speech-error:${JSON.stringify({ reason })}`);
    console.error('语音生成失败，已保留分段缓存；请检查模型、音色、Key 权限和额度。');
    host.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await speechCli(process.argv.slice(2));
