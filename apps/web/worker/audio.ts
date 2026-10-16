import { AUDIO_SAMPLE_RATE, AudioError, parseWav, type StoredWav } from '@his-fm/contracts';

export { AUDIO_SAMPLE_RATE, AudioError, parseWav } from '@his-fm/contracts';

const HEADER_SCAN_BYTES = 64 * 1024;
export const PRODUCTION_AUDIO_MAX_DURATION_SECONDS = 1800;
const AUDIO_UPLOAD_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const wavObjectMetadata = {
  httpMetadata: { contentType: 'audio/wav', cacheControl: 'public, max-age=31536000, immutable' },
  onlyIf: { etagDoesNotMatch: '*' },
};

export function productionAudioObjectKey(
  productionId: string,
  scriptVersion: number,
  uploadId = crypto.randomUUID(),
) {
  return `productions/${productionId}/audio-${scriptVersion}-${uploadId}.wav`;
}

export function parseAllowedProductionAudioKey(productionId: string, key: string) {
  const staging = new RegExp(`^uploads/(${AUDIO_UPLOAD_ID})\\.wav$`).exec(key);
  if (staging) return { kind: 'staging' as const };
  const attached = new RegExp(
    `^productions/${productionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/audio-(\\d+)-(${AUDIO_UPLOAD_ID})\\.wav$`,
  ).exec(key);
  if (attached) return { kind: 'attached' as const, scriptVersion: Number(attached[1]) };
  throw new AudioError('音频对象路径无效');
}

async function inspectProductionWav(bucket: R2Bucket, key: string, maximumSeconds: number) {
  const info = await readStoredWav(bucket, key);
  if (
    info.durationSeconds > maximumSeconds ||
    info.size > maximumSeconds * AUDIO_SAMPLE_RATE * 2 + HEADER_SCAN_BYTES ||
    info.dataOffset + info.dataBytes !== info.size
  )
    throw new AudioError('音频时长或数据大小无效');
  return info;
}

export async function adoptProductionAudioUpload(
  bucket: R2Bucket,
  productionId: string,
  scriptVersion: number,
  sourceKey: string,
) {
  const parsed = parseAllowedProductionAudioKey(productionId, sourceKey);
  if (parsed.kind === 'attached') {
    if (parsed.scriptVersion !== scriptVersion) throw new AudioError('音频对象与当前逐字稿版本不匹配');
    const stored = await inspectProductionWav(bucket, sourceKey, PRODUCTION_AUDIO_MAX_DURATION_SECONDS);
    return { key: sourceKey, stored };
  }
  const object = await bucket.get(sourceKey);
  if (!object) throw new AudioError('音频素材不存在');
  if (object.size > PRODUCTION_AUDIO_MAX_DURATION_SECONDS * AUDIO_SAMPLE_RATE * 2 + HEADER_SCAN_BYTES) {
    await object.body.cancel();
    throw new AudioError('音频上传大小无效');
  }
  const key = productionAudioObjectKey(productionId, scriptVersion);
  const put = await bucket.put(key, object.body, wavObjectMetadata);
  if (!put) throw new AudioError('素材路径已存在，请重试');
  try {
    const stored = await inspectProductionWav(bucket, key, PRODUCTION_AUDIO_MAX_DURATION_SECONDS);
    return { key, stored };
  } catch (error) {
    await bucket.delete(key);
    throw error;
  }
}

export async function storeUploadedWav(
  request: Request,
  bucket: R2Bucket,
  key: string,
  maximumSeconds: number,
) {
  const size = Number(request.headers.get('Content-Length'));
  if (
    !Number.isSafeInteger(size) ||
    size < 44 ||
    size > maximumSeconds * AUDIO_SAMPLE_RATE * 2 + HEADER_SCAN_BYTES ||
    !request.body
  )
    throw new AudioError('音频上传大小无效');
  const fixed = new FixedLengthStream(size);
  const controller = new AbortController();
  const piping = request.body.pipeTo(fixed.writable, { signal: controller.signal });
  let stored: R2Object | null = null;
  const putting = bucket.put(key, fixed.readable, wavObjectMetadata).then((object) => {
    stored = object;
    if (!object) throw new AudioError('Audio object already exists');
    return object;
  });
  try {
    await Promise.all([piping, putting]);
    return await inspectProductionWav(bucket, key, maximumSeconds);
  } catch (error) {
    controller.abort();
    if (!fixed.readable.locked) await fixed.readable.cancel(error);
    await Promise.allSettled([piping, putting]);
    if (stored) await bucket.delete(key);
    throw error;
  }
}
export async function readStoredWav(bucket: R2Bucket, key: string): Promise<StoredWav> {
  const object = await bucket.get(key, { range: { offset: 0, length: HEADER_SCAN_BYTES } });
  if (!object) throw new AudioError(`音频素材不存在：${key}`);
  const bytes = new Uint8Array(await object.arrayBuffer());
  return { ...parseWav(bytes, object.size), key, etag: object.etag, size: object.size };
}
