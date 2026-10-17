import type { Mention } from '../shared/mentions';
import { formatMentionHtml } from '../shared/mentions-format';

function mentionListKey(mention: Mention) {
  return `${mention.name}\u0000${mention.description}\u0000${mention.url ?? ''}`;
}

export function EpisodeMentions({ mentions }: { mentions: Mention[] }) {
  if (!mentions.length) return null;
  return (
    <section className="episode-mentions" aria-labelledby="episode-mentions-heading">
      <h2 id="episode-mentions-heading">本期提到</h2>
      <ul>
        {mentions.map((mention) => (
          <li key={mentionListKey(mention)}>
            {/* biome-ignore lint/security/noDangerouslySetInnerHtml: escaped mention labels */}
            <span dangerouslySetInnerHTML={{ __html: formatMentionHtml(mention) }} />
          </li>
        ))}
      </ul>
    </section>
  );
}
