import { ArrowDown, ArrowUpRight, Headphones } from 'lucide-react';
import { BrandSymbol, Wordmark } from '../brand/Brand';
import { themeMedia, themes } from '../brand/themes';
import type { PublicEpisodeSummary } from '../shared/episode';
import { episodePublicPath } from '../shared/episode-url';
import { PublicLink, useAppearance } from './Appearance';
import { durationLabel } from './model';

export function heroImageSizes(id: string) {
  const split = ['interval', 'human-sample', 'window-seat'].includes(id);
  return {
    sizes: split ? 'max(52vw, 825px)' : 'max(100vw, 1290px)',
    mobileSizes: split ? 'max(calc(100vw - 48px), 370px)' : 'max(100vw, 740px)',
  };
}

export function ThemeImage({
  className = '',
  priority = false,
  sizes = '100vw',
  mobileSizes = 'max(100vw, 720px)',
}: {
  className?: string;
  priority?: boolean;
  sizes?: string;
  mobileSizes?: string;
}) {
  const { id } = useAppearance();
  const media = themeMedia[id];
  return (
    <picture className={className}>
      <source
        media="(max-width: 760px)"
        srcSet={media.mobileSrcSet}
        sizes={mobileSizes}
        width={1024}
        height={1024}
      />
      <img
        src={media.hero}
        srcSet={media.srcSet}
        sizes={sizes}
        width={media.width}
        height={media.height}
        alt={themes[id].imageAlt}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
      />
    </picture>
  );
}

export function Hero({ featured, episodeLabel }: { featured?: PublicEpisodeSummary; episodeLabel?: string }) {
  const { id } = useAppearance();
  const theme = themes[id];
  const imageSizes = heroImageSizes(id);
  const quiet = ['stillwood', 'tidal-hours', 'alpine-bloom'].includes(id);
  return (
    <section className="home-hero">
      {id === 'human-sample' && (
        <div className="hero-masthead">
          <Wordmark />
          <p>
            独立中文播客
            <br />
            工作 / 学习 / 生活
          </p>
          <BrandSymbol />
        </div>
      )}
      {id === 'interval' && (
        <div className="hero-index">
          <span>HIS.FM / A LITTLE OPEN SPACE</span>
          <span>
            <Headphones size={15} strokeWidth={1.5} /> 给自己一点时间
          </span>
        </div>
      )}
      <div className="hero-copy">
        <p className="hero-overline">
          {quiet || id === 'window-seat' ? `HIS.FM / ${theme.english}` : '一档给开发者的中文播客'}
        </p>
        {id === 'window-seat' && <BrandSymbol className="hero-copy-mark" />}
        <h1>
          {theme.heading.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </h1>
        <p className="hero-introduction">{theme.introduction}</p>
        <PublicLink to="/episodes" className="pill-button lime">
          找一期，歇一会儿 <ArrowUpRight size={20} />
        </PublicLink>
      </div>
      <figure className="hero-visual">
        <ThemeImage priority {...imageSizes} />
        <BrandSymbol />
        <figcaption>{theme.note}</figcaption>
      </figure>
      {(id === 'soft-landing' || id === 'tidal-hours') && (
        <p className="hero-handwriting" aria-hidden="true">
          {id === 'soft-landing' ? (
            <>
              a softer
              <br />
              <em>landing.</em>
            </>
          ) : (
            <>
              at your
              <br />
              <em>own tide.</em>
            </>
          )}
        </p>
      )}
      {quiet && (
        <div className="hero-seal" aria-hidden="true">
          <BrandSymbol />
          <span>
            {theme.english}
            <br />
            {id === 'alpine-bloom' ? (
              <em>in its own time.</em>
            ) : id === 'stillwood' ? (
              'HIS.FM'
            ) : (
              'A LITTLE TIME, YOUR OWN.'
            )}
          </span>
        </div>
      )}
      {featured && (
        <PublicLink to={episodePublicPath(featured.category, featured.slug)} className="hero-feature">
          <span className="hero-feature-number">
            {episodeLabel}
            <small>{featured.audioUrl ? '本期声音' : '本期摘要'}</small>
          </span>
          <strong>{featured.title}</strong>
          <span className="hero-feature-action">
            {featured.audioUrl ? durationLabel(featured.durationSeconds) : '先看摘要'}
            <ArrowUpRight size={22} />
          </span>
        </PublicLink>
      )}
      <a href="#episodes" className="hero-baseline">
        <span>{theme.note}</span>
        <span>
          慢慢往下看 <ArrowDown size={14} />
        </span>
      </a>
    </section>
  );
}
