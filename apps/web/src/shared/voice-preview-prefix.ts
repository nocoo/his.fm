export const voicePreviewStoragePrefix = 'reference/voices/';

const voicePreviewFilePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*\.mp3$/;

/** Shortest valid key: `reference/voices/a.mp3` */
export const voicePreviewStorageKeyMinLength = voicePreviewStoragePrefix.length + 'a.mp3'.length;

export const voicePreviewStorageKeyMaxLength = 1024;

/** OpenAPI / JSON Schema pattern aligned with {@link parseVoicePreviewStorageKey}. */
export const voicePreviewStorageKeyOpenApiPattern =
  '^reference/voices/(?!.*\\.\\.)[A-Za-z0-9][A-Za-z0-9._-]*\\.mp3$';

export function parseVoicePreviewStorageKey(raw: string | null | undefined) {
  if (!raw || raw.length > voicePreviewStorageKeyMaxLength) return null;
  if (raw.includes('\\') || raw.includes('//') || raw.includes('..')) return null;
  if (!raw.startsWith(voicePreviewStoragePrefix)) return null;
  const suffix = raw.slice(voicePreviewStoragePrefix.length);
  if (!suffix || suffix.includes('/')) return null;
  if (!voicePreviewFilePattern.test(suffix)) return null;
  return raw;
}
