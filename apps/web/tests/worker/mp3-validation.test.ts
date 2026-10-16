import { mp3AudioStartOffset } from '@his-fm/contracts';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tinyMp3Bytes } from '../../../../packages/contracts/src/mp3-fixtures.ts';
import { readStoredProductionAudio } from '../../worker/audio';

function encodeSynchsafe(size: number) {
  return Uint8Array.from([(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
}

function wrapWithId3Padding(audio: Uint8Array, paddingBodyBytes: number) {
  const header = new Uint8Array(10);
  header.set([0x49, 0x44, 0x33, 4, 0, 0]);
  header.set(encodeSynchsafe(paddingBodyBytes), 6);
  const file = new Uint8Array(10 + paddingBodyBytes + audio.length);
  file.set(header);
  file.set(audio, 10 + paddingBodyBytes);
  return file;
}

let miniflare: Miniflare;
let bucket: R2Bucket;

beforeAll(async () => {
  miniflare = new Miniflare({
    workers: [
      {
        config: {
          name: 'mp3-validation',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: { 'index.js': { type: 'esm', contents: 'export default {}' } },
          },
          env: { MEDIA: { type: 'r2', name: 'mp3-validation' } },
        },
      },
    ],
  });
  bucket = (await miniflare.getBindings<{ MEDIA: R2Bucket }>()).MEDIA;
}, 30000);

afterAll(async () => {
  await miniflare.dispose();
});

describe('production MP3 validation', () => {
  it('reads duration through a 64 KiB ID3v2 prefix', async () => {
    const audioStart = mp3AudioStartOffset(tinyMp3Bytes, tinyMp3Bytes.length);
    const padded = wrapWithId3Padding(tinyMp3Bytes.subarray(audioStart), 64 * 1024 - 10);
    await bucket.put('id3-padded.mp3', padded);
    const stored = await readStoredProductionAudio(bucket, 'id3-padded.mp3', 'audio/mpeg');
    expect(stored.durationSeconds).toBeGreaterThan(0.2);
    expect(stored.durationSeconds).toBeLessThan(0.35);
  });
});
