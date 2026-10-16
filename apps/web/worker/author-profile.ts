export const AUTHOR_PROFILE_ENDPOINT = 'https://lizheng.blog/api/authors/profile';

export const MAX_AUTHOR_PROFILE_BYTES = 16 * 1024;
export const AUTHOR_PROFILE_TIMEOUT_MS = 2500;

export interface AuthorProfile {
  name: string | null;
  avatar: string | null;
}

const EMPTY_PROFILE: AuthorProfile = { name: null, avatar: null };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashEmail(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeEmail(email));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isSafeHttpsUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function readProfile(data: unknown): AuthorProfile {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return EMPTY_PROFILE;
  const record = data as { name?: unknown; avatar?: unknown };
  const name = typeof record.name === 'string' && record.name.trim().length > 0 ? record.name.trim() : null;
  let avatar: string | null = null;
  if (typeof record.avatar === 'string' && record.avatar.trim().length > 0) {
    const trimmed = record.avatar.trim();
    if (isSafeHttpsUrl(trimmed)) avatar = trimmed;
  }
  return { name, avatar };
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function readBoundedText(response: Response, maxBytes: number): Promise<string | null> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number.parseInt(contentLength, 10) > maxBytes) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (receivedBytes === 0) return null;
  const total = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    total.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(total);
}

export async function fetchAuthorProfile(email: string, fetchFn: FetchLike = fetch): Promise<AuthorProfile> {
  if (!email.trim()) return EMPTY_PROFILE;
  try {
    const hash = await hashEmail(email);
    const response = await fetchFn(`${AUTHOR_PROFILE_ENDPOINT}?hash=${hash}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(AUTHOR_PROFILE_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      await response.body?.cancel();
      return EMPTY_PROFILE;
    }
    const text = await readBoundedText(response, MAX_AUTHOR_PROFILE_BYTES);
    if (!text) return EMPTY_PROFILE;
    return readProfile(JSON.parse(text));
  } catch {
    return EMPTY_PROFILE;
  }
}
