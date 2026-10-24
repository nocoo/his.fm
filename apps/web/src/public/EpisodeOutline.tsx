import { ArrowDown } from 'lucide-react';
import type { OutlineEntry } from '../shared/show-notes-outline';

const visibleEntries = 5;

export function EpisodeOutline({ entries }: { entries: OutlineEntry[] }) {
  if (!entries.length) return null;
  const shown = entries.slice(0, visibleEntries);
  const remaining = entries.length - shown.length;
  return (
    <section className="episode-outline" aria-labelledby="episode-outline-heading">
      <h2 id="episode-outline-heading" className="eyebrow">
        本期讲什么
      </h2>
      <ol>
        {shown.map((entry, index) => (
          <li key={entry.title}>
            <span className="outline-index">{String(index + 1).padStart(2, '0')}</span>
            <span className="outline-text">
              <strong>{entry.title}</strong>
              {entry.detail && <em>{entry.detail}</em>}
            </span>
          </li>
        ))}
      </ol>
      {remaining > 0 && (
        <a className="outline-more" href="#episode-content">
          还有 {remaining} 个话题 <ArrowDown size={15} aria-hidden="true" />
        </a>
      )}
    </section>
  );
}
