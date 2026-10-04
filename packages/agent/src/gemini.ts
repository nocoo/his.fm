import { AUDIO_SAMPLE_RATE, AudioError, chunkTranscript, parseWav } from '@his-fm/contracts';

const AUDIO_MODEL = 'gemini-3.8-flash-tts';
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
async function boundedJson(response: Response, maximum = MAX_RESPONSE_BYTES): Promise<unknown> {
  if (!response.body) throw new AudioError('语音服务返回空响应');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maximum) throw new AudioError('语音服务响应超出分段大小限制');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AudioError('语音服务返回无效 JSON');
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function speechFailure(response: Response): Promise<AudioError> {
  const data = await boundedJson(response, 8192).catch(() => null);
  const error = record(data) && record(data.error) ? data.error : null;
  const message = error && typeof error.message === 'string' ? error.message : '';
  let reason = '语音服务请求失败';
  if (/location is not supported|unsupported (?:country|region|location)/i.test(message))
    reason = 'Gemini 不支持当前服务出口地区，请联系管理员检查本机运行地区';
  else if (/free tier.*(?:country|region)|billing.*(?:enable|disabled|required)/i.test(message))
    reason = 'Gemini 项目需要开通计费，请检查 Google AI Studio 项目设置';
  else if (/API key not valid|API key (?:has )?expired|API_KEY_INVALID/i.test(message))
    reason = 'Gemini API 密钥无效或已过期，请更新本机密钥';
  else if (/(?:invalid|unknown|unsupported) voice|voice.*(?:not found|not supported|invalid)/i.test(message))
    reason = 'Gemini 不支持当前音色，请选择其他音色';
  else if (error?.status === 'INVALID_ARGUMENT')
    reason = 'Gemini 拒绝了语音参数，请检查音色、试听文字和讲述风格';
  else if (response.status === 429) reason = 'Gemini 额度或调用频率受限，请检查配额后重试';
  console.warn(JSON.stringify({ event: 'tts_provider_error', status: response.status, reason }));
  return new AudioError(
    `${reason}（HTTP ${response.status}）`,
    response.status === 429 || response.status >= 500,
  );
}

export async function synthesizeSpeech(apiKey: string, text: string, voice: string, speakingStyle: string) {
  if (!apiKey) throw new AudioError('尚未配置 Gemini API 密钥');
  if (chunkTranscript(text).length !== 1) throw new AudioError('语音分段超过 420 字符');
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    signal: AbortSignal.timeout(180_000),
    redirect: 'error',
    body: JSON.stringify({
      model: AUDIO_MODEL,
      input: [
        {
          type: 'user_input',
          content: [
            {
              type: 'text',
              text,
              annotations: [{ type: 'speech_metadata', style: speakingStyle }],
            },
          ],
        },
      ],
      response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: AUDIO_SAMPLE_RATE },
      generation_config: { speech_config: [{ voice }] },
    }),
  });
  if (!response.ok) throw await speechFailure(response);
  const result = await boundedJson(response);
  if (!record(result) || !Array.isArray(result.steps)) throw new AudioError('语音服务响应结构无效');
  const blocks = result.steps.flatMap((step: unknown) =>
    record(step) && step.type === 'model_output' && Array.isArray(step.content)
      ? step.content.filter((content: unknown) => record(content) && content.type === 'audio')
      : [],
  );
  if (blocks.length !== 1 || typeof blocks[0].data !== 'string') {
    throw new AudioError('语音服务未返回唯一完整音频');
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(blocks[0].data), (character) => character.charCodeAt(0));
  } catch {
    throw new AudioError('语音服务返回无效音频编码');
  }
  return { bytes, info: parseWav(bytes), interactionId: typeof result.id === 'string' ? result.id : null };
}
