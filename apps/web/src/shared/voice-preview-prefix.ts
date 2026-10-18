export const voicePreviewStoragePrefix = 'reference/voices/';

const voicePreviewFilePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*\.mp3$/;

export function parseVoicePreviewStorageKey(raw: string | null | undefined) {
  if (!raw || raw.length > 1024) return null;
  if (raw.includes('\\') || raw.includes('//') || raw.includes('..')) return null;
  if (!raw.startsWith(voicePreviewStoragePrefix)) return null;
  const suffix = raw.slice(voicePreviewStoragePrefix.length);
  if (!suffix || suffix.includes('/')) return null;
  if (!voicePreviewFilePattern.test(suffix)) return null;
  return raw;
}
