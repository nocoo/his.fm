import { redirect, resolveCategoryAlias } from './episode-public';
import { feedRoute } from './feed-response';

export async function maybeRedirectCatalogueCategoryRequest(
  request: Request,
  db: D1Database,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/episodes' || !['GET', 'HEAD'].includes(request.method)) return null;
  const raw = url.searchParams.get('category');
  if (!raw || raw === 'all') return null;
  const canonical = await resolveCategoryAlias(db, raw);
  if (canonical === raw) return null;
  const next = new URL(url);
  next.searchParams.set('category', canonical);
  return redirect(`${next.pathname}${next.search}`);
}

export async function maybeRedirectCategoryFeedRequest(
  request: Request,
  db: D1Database,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!feedRoute.test(url.pathname) || !['GET', 'HEAD'].includes(request.method)) return null;
  const categoryId = /^\/feeds\/([a-z0-9-]+)\.xml$/.exec(url.pathname)?.[1];
  if (!categoryId) return null;
  const canonical = await resolveCategoryAlias(db, categoryId);
  if (canonical === categoryId) return null;
  const next = new URL(url);
  next.pathname = `/feeds/${canonical}.xml`;
  return redirect(`${next.pathname}${next.search}`);
}
