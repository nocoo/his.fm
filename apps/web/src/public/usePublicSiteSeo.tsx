import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { type SiteSeo, siteSeoSchema } from '../shared/seo';
import { usePublicData } from './PublicData';

const SiteSeoContext = createContext<SiteSeo>(siteSeoSchema.parse({}));

export function PublicSiteSeoProvider({ children }: { children: ReactNode }) {
  const initial = usePublicData();
  const [site, setSite] = useState<SiteSeo>(() => initial?.site ?? siteSeoSchema.parse({}));
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/site-seo', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const payload = data as { seo?: unknown } | null;
        if (payload?.seo) setSite(siteSeoSchema.parse(payload.seo));
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return <SiteSeoContext.Provider value={site}>{children}</SiteSeoContext.Provider>;
}

export function usePublicSiteSeo() {
  return useContext(SiteSeoContext);
}
