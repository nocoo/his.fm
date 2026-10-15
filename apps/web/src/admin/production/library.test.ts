import { describe, expect, it } from 'vitest';
import { fixture, readyFixture } from '../../../tests/worker/production-fixture';
import type { Episode } from '../../shared/episode';
import { filterLibrary, programLibrary } from './model';

function episode(changes: Partial<Episode> = {}): Episode {
  return {
    id: 'episode',
    version: 1,
    title: 'Catalog record',
    slug: 'dinner-before-the-prompt',
    episodeNumber: 8,
    category: 'life',
    tags: ['tag'],
    summary: 'Summary',
    transcript: '',
    showNotes: '',
    coverUrl: '/media/cover.png',
    audioUrl: null,
    durationSeconds: 0,
    featured: false,
    status: 'draft',
    publishedAt: null,
    createdAt: '2026-09-25T00:00:00Z',
    updatedAt: '2026-09-25T00:00:00Z',
    ...changes,
  };
}
describe('unified program library', () => {
  it('deduplicates snapshots only by explicit production relation, never title, slug or episode number', () => {
    const production = fixture();
    const unrelated = episode({ title: production.title });
    const snapshot = episode({ id: 'snapshot', sourceProductionId: production.id, status: 'published' });
    const rows = programLibrary([production], [unrelated, snapshot]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 'production:production-test',
      status: 'published',
      snapshot,
      href: '/admin/productions/production-test',
    });
    expect(rows[1]).toMatchObject({
      id: 'episode:episode',
      href: '/admin/episodes/episode',
      status: 'draft',
    });
  });
  it('does not lose orphaned snapshots and never routes them to catalog CRUD', () => {
    expect(programLibrary([], [episode({ sourceProductionId: 'missing' })])[0].href).toBe(
      '/admin/productions/missing',
    );
  });
  it('represents draft, ready and published entries and preserves live editable values', () => {
    expect(programLibrary([fixture()], [])[0]).toMatchObject({
      status: 'draft',
      coverUrl: null,
      audioUrl: null,
      summary: fixture().intent,
    });
    expect(programLibrary([readyFixture()], [])[0]).toMatchObject({
      status: 'ready',
      summary: readyFixture().summary,
      coverUrl: 'https://f.no.mt/cover.png',
    });
    expect(programLibrary([], [episode({ status: 'published' })])[0].status).toBe('published');
    const publication = {
      platform: 'wechat' as const,
      url: 'https://mp.weixin.qq.com/s/test',
      publishedAt: '2026-09-25T00:00:00Z',
      confirmedAt: '2026-09-25T00:00:00Z',
      confirmedBy: 'editor',
      version: 1,
    };
    expect(programLibrary([fixture({ publications: [publication] })], [])[0].status).toBe('published');
  });
  it('orders recent episodes consistently and combines search, category and status filters', () => {
    const rows = programLibrary(
      [
        fixture(),
        readyFixture({ id: 'ready', episodeNumber: 9, category: 'work', updatedAt: '2026-09-26T00:00:00Z' }),
      ],
      [episode({ episodeNumber: 9, tags: ['KEYWORD'], updatedAt: '2026-09-27T00:00:00Z' })],
    );
    expect(rows.map((row) => row.id)).toEqual([
      'episode:episode',
      'production:ready',
      'production:production-test',
    ]);
    expect(filterLibrary(rows, ' keyword ', 'all', 'life')).toHaveLength(1);
    expect(filterLibrary(rows, '', 'ready', 'work').map((row) => row.id)).toEqual(['production:ready']);
    expect(filterLibrary(rows, 'missing', 'all', 'all')).toEqual([]);
    expect(filterLibrary(rows, '', 'all', 'all')).toEqual(rows);
  });
});
