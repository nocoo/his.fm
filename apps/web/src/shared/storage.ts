import { z } from 'zod';

export const storageKinds = ['image', 'audio', 'video', 'other'] as const;
export type StorageKind = (typeof storageKinds)[number];
export const storageKindLabels: Record<StorageKind, string> = {
  image: '图片',
  audio: '音频',
  video: '视频',
  other: '其他',
};
export const storageKeySchema = z.string().min(1).max(1024);
export const storageCleanupSchema = z.strictObject({
  items: z
    .array(z.strictObject({ key: storageKeySchema, version: z.string().min(1).max(256) }))
    .min(1)
    .max(50),
});
export type StorageCleanupInput = z.infer<typeof storageCleanupSchema>;
export type StorageObject = {
  key: string;
  version: string;
  size: number;
  uploaded: string;
  contentType: string;
  kind: StorageKind;
  state: 'referenced' | 'protected' | 'recent' | 'unused';
  reasons: string[];
};
export type StoragePage = { objects: StorageObject[]; cursor: string | null };
export type StorageCleanupResult = {
  results: { key: string; status: 'deleted' | 'skipped' | 'failed'; reason: string; bytes: number }[];
};

export function storageKind(key: string, contentType: string): StorageKind {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('audio/')) return 'audio';
  if (contentType.startsWith('video/')) return 'video';
  const extension = key.toLowerCase().split('.').pop();
  if (['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'svg'].includes(extension ?? '')) return 'image';
  if (['wav', 'mp3', 'm4a', 'ogg', 'flac', 'aac'].includes(extension ?? '')) return 'audio';
  if (['mp4', 'webm', 'mov', 'm4v'].includes(extension ?? '')) return 'video';
  return 'other';
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  return `${(bytes / 1024 ** unit).toFixed(1)} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][unit]}`;
}
