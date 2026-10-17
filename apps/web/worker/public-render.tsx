import { Suspense } from 'react';
import { renderToString } from 'react-dom/server.edge';
import { Route, Routes, StaticRouter } from 'react-router';
import { themeMedia } from '../src/brand/themes';
import { heroImageSizes } from '../src/public/Hero';
import { type PublicData, PublicDataContext } from '../src/public/PublicData';
import { PublicRoutes } from '../src/public/PublicRoutes';
import type { ThemeId } from '../src/shared/appearance';

export function renderHeroPreloads(theme: ThemeId) {
  const media = themeMedia[theme];
  const { sizes, mobileSizes } = heroImageSizes(theme);
  return renderToString(
    <>
      <link
        rel="preload"
        as="image"
        media="(max-width: 760px)"
        imageSrcSet={media.mobileSrcSet}
        imageSizes={mobileSizes}
        fetchPriority="high"
      />
      <link
        rel="preload"
        as="image"
        media="(min-width: 760.01px)"
        imageSrcSet={media.srcSet}
        imageSizes={sizes}
        fetchPriority="high"
      />
    </>,
  );
}

export function renderPublicPage(location: string, data: PublicData) {
  return renderToString(
    <PublicDataContext.Provider value={data}>
      <StaticRouter location={location}>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/*" element={<PublicRoutes />} />
          </Routes>
        </Suspense>
      </StaticRouter>
    </PublicDataContext.Provider>,
  );
}
