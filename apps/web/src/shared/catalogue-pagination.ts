export const CATALOGUE_PAGE_SIZE = 20;

export function parseCataloguePage(value: string | null): number {
  if (!value) return 1;
  if (!/^[1-9]\d*$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function paginateList<T>(items: T[], page: number, pageSize = CATALOGUE_PAGE_SIZE): T[] {
  const safePage = Math.max(1, page);
  const start = (safePage - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export function cataloguePageCount(length: number, pageSize = CATALOGUE_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(length / pageSize));
}

export function cataloguePageHref(categoryId: string | null, page: number): string {
  const params = new URLSearchParams();
  if (categoryId && categoryId !== 'all') params.set('category', categoryId);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return `/episodes${query ? `?${query}` : ''}`;
}

export function catalogueCanonical(
  origin: string,
  categoryId: string | null,
  page: number,
  pageSize = CATALOGUE_PAGE_SIZE,
  totalItems: number,
): string {
  const base = new URL('/episodes', origin);
  if (categoryId && categoryId !== 'all') base.searchParams.set('category', categoryId);
  if (page > 1 && totalItems > pageSize) base.searchParams.set('page', String(page));
  return `${base.origin}${base.pathname}${base.search}`;
}

export function cataloguePaginationLinks(
  origin: string,
  categoryId: string | null,
  page: number,
  totalItems: number,
  pageSize = CATALOGUE_PAGE_SIZE,
): string[] {
  const pages = cataloguePageCount(totalItems, pageSize);
  if (pages <= 1) return [];
  const links: string[] = [];
  if (page > 1) {
    links.push(
      `<link rel="prev" href="${catalogueCanonical(origin, categoryId, page - 1, pageSize, totalItems)}" />`,
    );
  }
  if (page < pages) {
    links.push(
      `<link rel="next" href="${catalogueCanonical(origin, categoryId, page + 1, pageSize, totalItems)}" />`,
    );
  }
  return links;
}
