import {
  AUDIO_SAMPLE_RATE,
  AudioError,
  isMp3Container,
  parseMp3,
  parseWav,
  type StoredWav,
} from '@his-fm/contracts';
import {
  productionAudioMaxBytes,
  productionAudioMaxDurationSeconds,
  productionAudioMp3MaxBytes,
} from '../src/shared/production';

export { AUDIO_SAMPLE_RATE, AudioError, parseMp3, parseWav } from '@his-fm/contracts';

const HEADER_SCAN_BYTES = 64 * 1024;
export const PRODUCTION_AUDIO_MAX_DURATION_SECONDS = productionAudioMaxDurationSeconds;
export const PRODUCTION_AUDIO_MAX_BYTES = productionAudioMaxBytes;
export const PRODUCTION_AUDIO_MP3_MAX_BYTES = productionAudioMp3MaxBytes;
const AUDIO_UPLOAD_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export type ProductionAudioMime = 'audio/wav' | 'audio/mpeg';
export type StoredProductionAudio = {
  key: string;
  etag: string;
  size: number;
  durationSeconds: number;
  mimeType: ProductionAudioMime;
};

function objectMetadata(mimeType: ProductionAudioMime) {
  return {
    httpMetadata: { contentType: mimeType, cacheControl: 'public, max-age=31536000, immutable' },
    onlyIf: { etagDoesNotMatch: '*' },
  };
}

export function productionAudioExtension(mimeType: ProductionAudioMime) {
  return mimeType === 'audio/mpeg' ? 'mp3' : 'wav';
}

export function productionAudioObjectKey(
  productionId: string,
  scriptVersion: number,
  uploadId = crypto.randomUUID(),
  extension: 'wav' | 'mp3' = 'wav',
) {
  return `productions/${productionId}/audio-${scriptVersion}-${uploadId}.${extension}`;
}

export function parseAllowedProductionAudioKey(productionId: string, key: string) {
  const staging = new RegExp(`^uploads/(${AUDIO_UPLOAD_ID})\\.(wav|mp3)$`).exec(key);
  if (staging) return { kind: 'staging' as const, extension: staging[2] as 'wav' | 'mp3' };
  const attached = new RegExp(
    `^productions/${productionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/audio-(\\d+)-(${AUDIO_UPLOAD_ID})\\.(wav|mp3)$`,
  ).exec(key);
  if (attached) {
    return {
      kind: 'attached' as const,
      scriptVersion: Number(attached[1]),
      extension: attached[3] as 'wav' | 'mp3',
    };
  }
  throw new AudioError('音频对象路径无效');
}

function mimeFromExtension(extension: 'wav' | 'mp3'): ProductionAudioMime {
  return extension === 'mp3' ? 'audio/mpeg' : 'audio/wav';
}

function maxBytesForMime(mimeType: ProductionAudioMime, maximumSeconds: number) {
  if (mimeType === 'audio/mpeg') return productionAudioMp3MaxBytes;
  return maximumSeconds * AUDIO_SAMPLE_RATE * 2 + HEADER_SCAN_BYTES;
}

function parseProductionAudio(bytes: Uint8Array, fileSize: number, mimeType: ProductionAudioMime) {
  if (mimeType === 'audio/wav') {
    const wav = parseWav(bytes, fileSize);
    if (wav.dataOffset + wav.dataBytes !== fileSize) throw new AudioError('音频时长或数据大小无效');
    return wav.durationSeconds;
  }
  if (!isMp3Container(bytes)) throw new AudioError('音频必须是有效的 MP3 文件');
  return parseMp3(bytes, fileSize).durationSeconds;
}

async function inspectProductionAudio(
  bucket: R2Bucket,
  key: string,
  mimeType: ProductionAudioMime,
  maximumSeconds: number,
) {
  const stored = await readStoredProductionAudio(bucket, key, mimeType);
  const maxBytes = maxBytesForMime(mimeType, maximumSeconds);
  if (stored.durationSeconds > maximumSeconds || stored.size > maxBytes) {
    throw new AudioError('音频时长或数据大小无效');
  }
  return stored;
}

export async function adoptProductionAudioUpload(
  bucket: R2Bucket,
  productionId: string,
  scriptVersion: number,
  sourceKey: string,
) {
  const parsed = parseAllowedProductionAudioKey(productionId, sourceKey);
  const mimeType = mimeFromExtension(parsed.extension);
  if (parsed.kind === 'attached') {
    if (parsed.scriptVersion !== scriptVersion) throw new AudioError('音频对象与当前逐字稿版本不匹配');
    const stored = await inspectProductionAudio(
      bucket,
      sourceKey,
      mimeType,
      PRODUCTION_AUDIO_MAX_DURATION_SECONDS,
    );
    return { key: sourceKey, stored };
  }
  const object = await bucket.get(sourceKey);
  if (!object) throw new AudioError('音频素材不存在');
  if (object.size > maxBytesForMime(mimeType, PRODUCTION_AUDIO_MAX_DURATION_SECONDS)) {
    await object.body.cancel();
    throw new AudioError('音频上传大小无效');
  }
  const key = productionAudioObjectKey(productionId, scriptVersion, undefined, parsed.extension);
  const put = await bucket.put(key, object.body, objectMetadata(mimeType));
  if (!put) throw new AudioError('素材路径已存在，请重试');
  try {
    const stored = await inspectProductionAudio(bucket, key, mimeType, PRODUCTION_AUDIO_MAX_DURATION_SECONDS);
    return { key, stored };
  } catch (error) {
    await bucket.delete(key);
    throw error;
  }
}

export async function storeUploadedProductionAudio(
  request: Request,
  bucket: R2Bucket,
  key: string,
  maximumSeconds: number,
  mimeType: ProductionAudioMime,
) {
  const maxBytes = maxBytesForMime(mimeType, maximumSeconds);
  const minBytes = mimeType === 'audio/wav' ? 44 : 16;
  const size = Number(request.headers.get('Content-Length'));
  if (!Number.isSafeInteger(size) || size < minBytes || size > maxBytes || !request.body) {
    throw new AudioError('音频上传大小无效');
  }
  const metadata = objectMetadata(mimeType);
  const fixed = new FixedLengthStream(size);
  const controller = new AbortController();
  const piping = request.body.pipeTo(fixed.writable, { signal: controller.signal });
  let stored: R2Object | null = null;
  const putting = bucket.put(key, fixed.readable, metadata).then((object) => {
    stored = object;
    if (!object) throw new AudioError('Audio object already exists');
    return object;
  });
  try {
    await Promise.all([piping, putting]);
    return await inspectProductionAudio(bucket, key, mimeType, maximumSeconds);
  } catch (error) {
    controller.abort();
    if (!fixed.readable.locked) await fixed.readable.cancel(error);
    await Promise.allSettled([piping, putting]);
    if (stored) await bucket.delete(key);
    throw error;
  }
}

/** @deprecated Use storeUploadedProductionAudio */
export const storeUploadedWav = (request: Request, bucket: R2Bucket, key: string, maximumSeconds: number) =>
  storeUploadedProductionAudio(request, bucket, key, maximumSeconds, 'audio/wav');

async function loadProductionAudioBytes(bucket: R2Bucket, key: string, mimeType: ProductionAudioMime) {
  if (mimeType === 'audio/wav') {
    const object = await bucket.get(key, { range: { offset: 0, length: HEADER_SCAN_BYTES } });
    if (!object) throw new AudioError(`音频素材不存在：${key}`);
    return { bytes: new Uint8Array(await object.arrayBuffer()), size: object.size, etag: object.etag };
  }
  const object = await bucket.get(key);
  if (!object) throw new AudioError(`音频素材不存在：${key}`);
  return { bytes: new Uint8Array(await object.arrayBuffer()), size: object.size, etag: object.etag };
}

export async function readStoredProductionAudio(
  bucket: R2Bucket,
  key: string,
  mimeType: ProductionAudioMime,
): Promise<StoredProductionAudio> {
  const { bytes, size, etag } = await loadProductionAudioBytes(bucket, key, mimeType);
  const durationSeconds = parseProductionAudio(bytes, size, mimeType);
  return { key, etag, size, durationSeconds, mimeType };
}

export async function readStoredWav(bucket: R2Bucket, key: string): Promise<StoredWav> {
  const object = await bucket.get(key, { range: { offset: 0, length: HEADER_SCAN_BYTES } });
  if (!object) throw new AudioError(`音频素材不存在：${key}`);
  const bytes = new Uint8Array(await object.arrayBuffer());
  return { ...parseWav(bytes, object.size), key, etag: object.etag, size: object.size };
}
