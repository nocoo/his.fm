/** Internal query param that scopes Workers Cache entries to a deployment revision. */
export const PUBLIC_CACHE_REVISION_PARAM = '_hisfm_r';

export function withPublicCacheRevision(url: URL, revision: string): URL {
  const next = new URL(url);
  next.searchParams.set(PUBLIC_CACHE_REVISION_PARAM, revision);
  return next;
}

export function stripPublicCacheRevision(url: URL): URL {
  const next = new URL(url);
  next.searchParams.delete(PUBLIC_CACHE_REVISION_PARAM);
  return next;
}

export function publicContentRequestUrl(request: Request): URL {
  return stripPublicCacheRevision(new URL(request.url));
}
