const mainReferencePattern = /https?:\/\/[^\s<>"'()`[\]]+|\/media\/[^\s<>"'()`[\]]+/g;
const extendedImagesPattern = /\/images\/[^\s<>"'()`[\]]+/g;
const siteHosts = ['his.fm', 'hisfm.dev.hexly.ai', 'localhost', '127.0.0.1'] as const;

function trimTrailingPunctuation(token: string) {
  return token.replace(/[.,;!，。；！]+$/, '');
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Byte-for-byte main-branch key resolution for one regex match. */
function keysFromMainMatch(match: string): string[] {
  try {
    const url = new URL(trimTrailingPunctuation(match), 'https://his.fm');
    let path = '';
    if (url.origin === 'https://f.no.mt') path = url.pathname.slice(1);
    else if (
      siteHosts.includes(url.hostname as (typeof siteHosts)[number]) &&
      url.pathname.startsWith('/media/')
    )
      path = url.pathname.slice(7);
    if (!path) return [];
    const decoded = safeDecode(path);
    return decoded ? [decoded] : [];
  } catch {
    return [];
  }
}

/** Main production extractor: unchanged regex and key resolution. */
export function collectMainReferenceKeys(text: string): string[] {
  const keys: string[] = [];
  for (const match of text.matchAll(mainReferencePattern)) keys.push(...keysFromMainMatch(match[0]));
  return keys;
}

function pathnameKeyFromToken(token: string): string | null {
  try {
    const url = new URL(trimTrailingPunctuation(token), 'https://his.fm');
    if (url.origin === 'https://f.no.mt') {
      const path = url.pathname.slice(1);
      return path ? safeDecode(path) : null;
    }
    if (!siteHosts.includes(url.hostname as (typeof siteHosts)[number])) return null;
    if (url.pathname.startsWith('/media/')) return safeDecode(url.pathname.slice(7));
    if (url.pathname.startsWith('/images/')) return safeDecode(url.pathname.slice(1));
    return null;
  } catch {
    return null;
  }
}

function rawTokenKey(token: string): string | null {
  const trimmed = trimTrailingPunctuation(token);
  if (trimmed.startsWith('/media/')) return safeDecode(trimmed.slice(7));
  if (trimmed.startsWith('/images/')) return safeDecode(trimmed.slice(1));
  if (trimmed.startsWith('https://f.no.mt/')) return safeDecode(trimmed.slice('https://f.no.mt/'.length));
  return null;
}

/** First path-like segment only; adds keys without narrowing main matches. */
function conservativePathKey(token: string): string | null {
  const trimmed = trimTrailingPunctuation(token);
  if (trimmed.startsWith('/media/')) {
    const segment = trimmed.slice(7).match(/^[a-zA-Z0-9/_.%-]+/)?.[0];
    return segment ? safeDecode(segment) : null;
  }
  if (trimmed.startsWith('/images/')) {
    const segment = trimmed.slice(8).match(/^[a-zA-Z0-9/_.%-]+/)?.[0];
    return segment ? safeDecode(`images/${segment}`) : null;
  }
  if (trimmed.startsWith('https://f.no.mt/')) {
    const segment = trimmed.slice('https://f.no.mt/'.length).match(/^[a-zA-Z0-9/_.%-]+/)?.[0];
    return segment ? safeDecode(segment) : null;
  }
  return null;
}

/** Adds /images/ matches and extra pathname/raw variants; may over-count. */
export function collectExtendedReferenceKeys(text: string): string[] {
  const keys = new Set<string>();
  for (const match of text.matchAll(extendedImagesPattern)) {
    const token = match[0];
    const raw = rawTokenKey(token);
    if (raw) keys.add(raw);
    const pathname = pathnameKeyFromToken(token);
    if (pathname) keys.add(pathname);
    const conservative = conservativePathKey(token);
    if (conservative) keys.add(conservative);
  }
  for (const match of text.matchAll(mainReferencePattern)) {
    const token = match[0];
    const raw = rawTokenKey(token);
    if (raw) keys.add(raw);
    const pathname = pathnameKeyFromToken(token);
    if (pathname) keys.add(pathname);
    const conservative = conservativePathKey(token);
    if (conservative) keys.add(conservative);
  }
  return [...keys];
}

export function collectReferenceKeys(text: string): string[] {
  return [...new Set([...collectMainReferenceKeys(text), ...collectExtendedReferenceKeys(text)])];
}
