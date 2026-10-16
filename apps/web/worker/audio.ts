import {
  AUDIO_SAMPLE_RATE,
  AudioError,
  isMp3Container,
  measureMp3Duration,
  parseWav,
  type StoredWav,
} from '@his-fm/contracts';
import {
  productionAudioDurationCapSlackSeconds,
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

function exceedsProductionDurationCap(
  durationSeconds: number,
  maximumSeconds: number,
  mimeType: ProductionAudioMime,
) {
  const slack =
    mimeType === 'audio/mpeg' && maximumSeconds === productionAudioMaxDurationSeconds
      ? productionAudioDurationCapSlackSeconds
      : 0;
  return durationSeconds > maximumSeconds + slack;
}

function parseProductionWav(bytes: Uint8Array, fileSize: number) {
  const wav = parseWav(bytes, fileSize);
  if (wav.dataOffset + wav.dataBytes !== fileSize) throw new AudioError('音频时长或数据大小无效');
  return wav.durationSeconds;
}

async function r2ReadChunk(bucket: R2Bucket, key: string, offset: number, length: number) {
  const object = await bucket.get(key, { range: { offset, length } });
  if (!object) throw new AudioError(`音频素材不存在：${key}`);
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength !== length) throw new AudioError('MP3 文件不完整');
  return bytes;
}

async function parseProductionMp3Duration(bucket: R2Bucket, key: string, fileSize: number) {
  const head = await r2ReadChunk(bucket, key, 0, Math.min(16, fileSize));
  if (!isMp3Container(head)) throw new AudioError('音频必须是有效的 MP3 文件');
  const info = await measureMp3Duration(fileSize, (offset, length) =>
    r2ReadChunk(bucket, key, offset, length),
  );
  return info.durationSeconds;
}

async function inspectProductionAudio(
  bucket: R2Bucket,
  key: string,
  mimeType: ProductionAudioMime,
  maximumSeconds: number,
) {
  const stored = await readStoredProductionAudio(bucket, key, mimeType);
  const maxBytes = maxBytesForMime(mimeType, maximumSeconds);
  if (
    exceedsProductionDurationCap(stored.durationSeconds, maximumSeconds, mimeType) ||
    stored.size > maxBytes
  ) {
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

export async function readStoredProductionAudio(
  bucket: R2Bucket,
  key: string,
  mimeType: ProductionAudioMime,
): Promise<StoredProductionAudio> {
  const head = await bucket.head(key);
  if (!head) throw new AudioError(`音频素材不存在：${key}`);
  let durationSeconds: number;
  if (mimeType === 'audio/wav') {
    const object = await bucket.get(key, { range: { offset: 0, length: HEADER_SCAN_BYTES } });
    if (!object) throw new AudioError(`音频素材不存在：${key}`);
    durationSeconds = parseProductionWav(new Uint8Array(await object.arrayBuffer()), head.size);
  } else {
    durationSeconds = await parseProductionMp3Duration(bucket, key, head.size);
  }
  return { key, etag: head.etag, size: head.size, durationSeconds, mimeType };
}

export async function readStoredWav(bucket: R2Bucket, key: string): Promise<StoredWav> {
  const object = await bucket.get(key, { range: { offset: 0, length: HEADER_SCAN_BYTES } });
  if (!object) throw new AudioError(`音频素材不存在：${key}`);
  const bytes = new Uint8Array(await object.arrayBuffer());
  return { ...parseWav(bytes, object.size), key, etag: object.etag, size: object.size };
}
