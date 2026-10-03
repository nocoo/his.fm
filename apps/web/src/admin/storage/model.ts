import type { StorageObject } from '../../shared/storage';

export const storageStateLabels: Record<StorageObject['state'], string> = {
  referenced: '使用中',
  protected: '受保护',
  recent: '保留期',
  unused: '可清理',
};

export function storageSummary(objects: StorageObject[]) {
  return objects.reduce(
    (summary, object) => {
      summary.bytes += object.size;
      summary.count++;
      if (object.state === 'unused') {
        summary.unusedBytes += object.size;
        summary.unusedCount++;
      }
      if (object.kind === 'audio' || object.kind === 'video') summary.mediaBytes += object.size;
      return summary;
    },
    { bytes: 0, count: 0, unusedBytes: 0, unusedCount: 0, mediaBytes: 0 },
  );
}

export function filterStorage(
  objects: StorageObject[],
  query: string,
  kind: string,
  state: string,
  sort: string,
) {
  const search = query.trim().toLocaleLowerCase();
  return objects
    .filter(
      (object) =>
        (kind === 'all' || object.kind === kind) &&
        (state === 'all' || object.state === state) &&
        `${object.key} ${object.reasons.join(' ')}`.toLocaleLowerCase().includes(search),
    )
    .sort((a, b) =>
      sort === 'oldest'
        ? a.uploaded.localeCompare(b.uploaded)
        : sort === 'newest'
          ? b.uploaded.localeCompare(a.uploaded)
          : b.size - a.size || a.key.localeCompare(b.key),
    );
}
