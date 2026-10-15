import { AUDIO_SAMPLE_RATE, AudioError, parseWav, type StoredWav } from '@his-fm/contracts';

export { AUDIO_SAMPLE_RATE, AudioError, parseWav } from '@his-fm/contracts';

const HEADER_SCAN_BYTES = 64 * 1024;

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
  const putting = bucket
    .put(key, fixed.readable, {
      httpMetadata: { contentType: 'audio/wav', cacheControl: 'public, max-age=31536000, immutable' },
      onlyIf: { etagDoesNotMatch: '*' },
    })
    .then((object) => {
      stored = object;
      if (!object) throw new AudioError('Audio object already exists');
      return object;
    });
  try {
    await Promise.all([piping, putting]);
    const info = await readStoredWav(bucket, key);
    if (info.durationSeconds > maximumSeconds || info.dataOffset + info.dataBytes !== info.size)
      throw new AudioError('音频时长或数据大小无效');
    return info;
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
