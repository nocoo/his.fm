import { AUDIO_SAMPLE_RATE, AudioError, parseWav, type StoredWav, wavHeader } from '@his-fm/contracts';

export { AUDIO_SAMPLE_RATE, AudioError, chunkTranscript, parseWav, wavHeader } from '@his-fm/contracts';

const HEADER_SCAN_BYTES = 64 * 1024;

export async function storeNativeWav(
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

export function wavStream(bucket: R2Bucket, parts: StoredWav[]): ReadableStream<Uint8Array> {
  const dataBytes = parts.reduce((total, part) => total + part.dataBytes, 0);
  const header = wavHeader(dataBytes);
  let partIndex = -1;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let remaining = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (partIndex === -1) {
          partIndex = 0;
          controller.enqueue(header);
          return;
        }
        while (partIndex < parts.length) {
          const part = parts[partIndex];
          if (!reader) {
            const object = await bucket.get(part.key, {
              range: { offset: part.dataOffset, length: part.dataBytes },
              onlyIf: { etagMatches: part.etag },
            });
            if (!object || !('body' in object)) throw new AudioError('音频素材在合成前发生变化');
            reader = object.body.getReader();
            remaining = part.dataBytes;
          }
          const next = await reader.read();
          if (next.done) {
            reader.releaseLock();
            reader = undefined;
            if (remaining !== 0) throw new AudioError('音频素材数据不完整');
            partIndex++;
            continue;
          }
          remaining -= next.value.byteLength;
          if (remaining < 0) throw new AudioError('音频素材数据超出声明大小');
          controller.enqueue(next.value);
          return;
        }
        controller.close();
      } catch (error) {
        await reader?.cancel();
        controller.error(error);
      }
    },
    async cancel() {
      await reader?.cancel();
    },
  });
}

export async function composeWav(bucket: R2Bucket, keys: string[], outputKey: string) {
  const parts: StoredWav[] = [];
  for (const key of keys) parts.push(await readStoredWav(bucket, key));
  const dataBytes = parts.reduce((total, part) => total + part.dataBytes, 0);
  if (dataBytes > 1800 * AUDIO_SAMPLE_RATE * 2) throw new AudioError('合成音频不能超过 30 分钟');
  const body = wavStream(bucket, parts);
  const fixed = new FixedLengthStream(44 + dataBytes);
  const controller = new AbortController();
  const piping = body.pipeTo(fixed.writable, { signal: controller.signal });
  const putting = bucket.put(outputKey, fixed.readable, {
    httpMetadata: { contentType: 'audio/wav', cacheControl: 'public, max-age=31536000, immutable' },
    onlyIf: { etagDoesNotMatch: '*' },
  });
  try {
    const [, object] = await Promise.all([piping, putting]);
    if (!object) throw new AudioError('合成音频写入失败');
  } catch (error) {
    controller.abort();
    if (!fixed.readable.locked) await fixed.readable.cancel(error);
    await Promise.allSettled([piping, putting]);
    throw error;
  }
  return { key: outputKey, bytes: dataBytes + 44, durationSeconds: dataBytes / (AUDIO_SAMPLE_RATE * 2) };
}
