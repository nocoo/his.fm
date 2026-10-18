import type { ArtRecord } from '../src/shared/episode-art';
import { getAppearance } from './appearance';
import { ensureEpisodeArt } from './episode-art';
import { artRecords } from './episode-art-cache';

export async function pregenerateEpisodeArt(env: Env, origin: string, path: string) {
  try {
    let records: ArtRecord[];
    const production =
      /^\/productions\/([^/]+)(?:\/(?:actions|assets\/cover|publications(?:\/(?:site|wechat|xiaoyuzhou))?))?$/.exec(
        path,
      );
    const episode = /^\/episodes(?:\/([^/]+))?$/.exec(path);
    const category = /^\/categories\/([a-z0-9-]+)$/.exec(path);
    if (path === '/appearance') records = await artRecords(env.DB);
    else if (production) {
      records = await artRecords(env.DB, { resource: 'productions', id: production[1] });
      const linked = await env.DB.prepare('SELECT id FROM episodes WHERE source_production_id = ?')
        .bind(production[1])
        .all<{ id: string }>();
      for (const row of linked.results)
        records.push(...(await artRecords(env.DB, { resource: 'episodes', id: row.id })));
    } else if (episode) records = await artRecords(env.DB, { resource: 'episodes', id: episode[1] });
    else if (category)
      records = [
        ...(await artRecords(env.DB, { resource: 'episodes', category: category[1] })),
        ...(await artRecords(env.DB, { resource: 'productions', category: category[1] })),
      ];
    else return;
    const { theme } = await getAppearance(env.DB);
    for (const record of records) {
      for (const variant of path === '/appearance' ? [theme] : [theme, null]) {
        try {
          await ensureEpisodeArt(env, origin, record, variant);
        } catch (error) {
          console.error(
            JSON.stringify({
              event: 'episode_art_pregeneration_failed',
              resource: record.resource,
              id: record.id,
              variant: variant ?? 'share',
              message: error instanceof Error ? error.message : 'Unknown error',
            }),
          );
        }
      }
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'episode_art_pregeneration_failed',
        path,
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    );
  }
}
