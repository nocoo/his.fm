import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { PublicDataContext } from '../src/public/PublicData';
import { PublicRoutes } from '../src/public/PublicRoutes';
import { type SiteSeo, siteSeoSchema } from '../src/shared/seo';

function aboutMarkup(site: SiteSeo) {
  return renderToStaticMarkup(
    <PublicDataContext.Provider
      value={{
        origin: 'https://his.fm',
        appearance: { theme: 'interval' },
        episodes: [],
        categories: [],
        site,
      }}
    >
      <MemoryRouter initialEntries={['/about']}>
        <PublicRoutes />
      </MemoryRouter>
    </PublicDataContext.Provider>,
  );
}

describe('public author links', () => {
  it('renders the configured author homepage in About and the footer alongside the confirmed blog', () => {
    const html = aboutMarkup(
      siteSeoSchema.parse({
        podcastAuthor: 'Confirmed host',
        podcastAuthorType: 'Person',
        podcastAuthorUrl: 'https://author.example.test',
      }),
    );
    expect(html.match(/href="https:\/\/author\.example\.test"/g)).toHaveLength(2);
    expect(html.match(/href="https:\/\/lizheng\.blog"/g)).toHaveLength(2);
    expect(html).toContain('Confirmed host');
  });

  it('does not invent an author homepage when the setting is blank', () => {
    const html = aboutMarkup(siteSeoSchema.parse({}));
    expect(html).not.toContain('的主页');
    expect(html).toContain('href="https://lizheng.blog"');
    expect(html).not.toContain('lizheng.dev');
  });
});
