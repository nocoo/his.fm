import type { ResolvedPageSeo } from './seo-resolve';

export function clearClientJsonLd() {
  for (const node of document.querySelectorAll('script[type="application/ld+json"]')) node.remove();
}

function upsertMeta(name: string, content: string) {
  let element = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute('name', name);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

function upsertProperty(property: string, content: string) {
  let element = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute('property', property);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

function upsertCanonical(href: string) {
  let element = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!element) {
    element = document.createElement('link');
    element.setAttribute('rel', 'canonical');
    document.head.appendChild(element);
  }
  element.setAttribute('href', href);
}

export function applyClientSeo(seo: ResolvedPageSeo, jsonLd?: unknown[]) {
  document.title = seo.title;
  upsertMeta('description', seo.description);
  upsertMeta('robots', seo.noindex ? 'noindex, follow' : 'index, follow');
  upsertCanonical(seo.canonical);
  upsertProperty('og:title', seo.title);
  upsertProperty('og:description', seo.description);
  upsertProperty('og:url', seo.canonical);
  upsertProperty('og:type', seo.ogType);
  upsertProperty('og:image', seo.ogImageUrl);
  upsertMeta('twitter:title', seo.title);
  upsertMeta('twitter:description', seo.description);
  upsertMeta('twitter:image', seo.ogImageUrl);
  clearClientJsonLd();
  if (jsonLd?.length) {
    const script = document.createElement('script');
    script.id = 'page-jsonld';
    script.type = 'application/ld+json';
    script.text = JSON.stringify(jsonLd.length === 1 ? jsonLd[0] : jsonLd);
    document.head.appendChild(script);
  }
}
