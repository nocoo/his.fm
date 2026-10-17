import type { ResolvedPageSeo } from './seo-resolve';

export function applyClientSeo(seo: ResolvedPageSeo, jsonLd?: unknown[]) {
  document.title = seo.title;
  const setMeta = (selector: string, attr: 'content' | 'href', value: string) => {
    const element = document.querySelector<HTMLMetaElement | HTMLLinkElement>(selector);
    if (element) element.setAttribute(attr, value);
  };
  setMeta('meta[name="description"]', 'content', seo.description);
  setMeta('meta[name="robots"]', 'content', seo.noindex ? 'noindex, follow' : 'index, follow');
  setMeta('link[rel="canonical"]', 'href', seo.canonical);
  setMeta('meta[property="og:title"]', 'content', seo.title);
  setMeta('meta[property="og:description"]', 'content', seo.description);
  setMeta('meta[property="og:url"]', 'content', seo.canonical);
  setMeta('meta[property="og:image"]', 'content', seo.ogImageUrl);
  setMeta('meta[name="twitter:title"]', 'content', seo.title);
  setMeta('meta[name="twitter:description"]', 'content', seo.description);
  setMeta('meta[name="twitter:image"]', 'content', seo.ogImageUrl);
  document.getElementById('page-jsonld')?.remove();
  if (jsonLd?.length) {
    const script = document.createElement('script');
    script.id = 'page-jsonld';
    script.type = 'application/ld+json';
    script.text = JSON.stringify(jsonLd.length === 1 ? jsonLd[0] : jsonLd);
    document.head.appendChild(script);
  }
}
