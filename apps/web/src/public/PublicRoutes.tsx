import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  Headphones,
  Menu,
  MoveUpRight,
  Rss,
  Search,
  X,
} from 'lucide-react';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { Outlet, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router';
import { BrandSymbol, Wordmark } from '../brand/Brand';
import { BrandLockup } from '../brand/BrandLockup';
import { themeMedia } from '../brand/themes';
import { AudioPlayer } from '../components/AudioPlayer';
import { coverArtwork, coverDesignSize } from '../shared/cover-composition';
import type { PublicEpisodeSummary } from '../shared/episode';
import { episodeThumbnailProps, episodeThumbnailSizes } from '../shared/episode-thumbnail';
import { episodePublicPath } from '../shared/episode-url';
import { ReadingText } from '../shared/ReadingText';
import { applyClientSeo } from '../shared/seo-client';
import { episodeBreadcrumbs, podcastEpisodeJsonLd, podcastSeriesJsonLd } from '../shared/seo-jsonld';
import { resolveAboutPageSeo, resolveCatalogueSeo, resolveSiteDefaults } from '../shared/seo-resolve';
import { PublicLink as Link, PublicNavLink as NavLink, SiteAppearance, useAppearance } from './Appearance';
import { EpisodeCover } from './EpisodeCover';
import { EpisodeMentions } from './EpisodeMentions';
import { Hero, ThemeImage } from './Hero';
import {
  catalogueCategoryFromSearch,
  catalogueHref,
  catalogueSearchParamsForCategory,
  dateLabel,
  durationLabel,
  episodeDisplayLabel,
  filterEpisodes,
} from './model';
import { usePublicOrigin } from './PublicData';
import { Reveal } from './Reveal';
import { useEpisodeDetail, useEpisodes } from './useEpisodes';
import { PublicSiteSeoProvider, usePublicSiteSeo } from './usePublicSiteSeo';
import './hero.css';

const EpisodeContext = createContext<ReturnType<typeof useEpisodes> | null>(null);

function useLibrary() {
  const value = useContext(EpisodeContext);
  if (!value) throw new Error('Episode library is missing');
  return value;
}

function Header() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: Navigation resets the mobile menu, including browser history changes.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  return (
    <header className="site-header">
      <Link to="/" className="wordmark" aria-label="his.fm 首页">
        <BrandLockup />
        <span className="brand-caption">中文播客</span>
      </Link>
      <nav className={`main-nav ${open ? 'is-open' : ''}`} aria-label="主导航">
        <NavLink to="/" end>
          首页
        </NavLink>
        <NavLink to="/episodes">全部播客</NavLink>
        <NavLink to="/about">关于 his.fm</NavLink>
      </nav>
      <Link className="header-listen" to="/episodes">
        给自己一点时间 <ArrowUpRight size={17} />
      </Link>
      <button
        type="button"
        className="menu-button"
        aria-label={open ? '收起导航' : '打开导航'}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? <X /> : <Menu />}
      </button>
    </header>
  );
}

function Footer() {
  const site = usePublicSiteSeo();
  return (
    <footer className="site-footer wrap">
      <div className="footer-top">
        <p>
          保持好奇。
          <br />
          也记得，照顾好自己。
        </p>
        <div>
          <Link to="/episodes">
            全部播客 <ArrowUpRight size={16} />
          </Link>
          <Link to="/about">
            关于我们 <ArrowUpRight size={16} />
          </Link>
          {site.podcastAuthorUrl && (
            <a href={site.podcastAuthorUrl} rel="me noopener noreferrer" target="_blank">
              {site.podcastAuthor}的主页 <ArrowUpRight size={16} />
            </a>
          )}
          <a href="https://lizheng.blog" rel="noopener noreferrer" target="_blank">
            博客 <ArrowUpRight size={16} />
          </a>
          <Link to="/login">
            创作后台 <ArrowUpRight size={16} />
          </Link>
        </div>
        <span className="footer-note">
          MADE FOR HUMANS.
          <br />
          IN THE AGE OF AI.
        </span>
      </div>
      <Link className="footer-wordmark" to="/" aria-label="返回 his.fm 首页">
        <Wordmark />
        <BrandSymbol />
      </Link>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} his.fm</span>
        <span>一些声音，一点陪伴。</span>
        <a href="#top">回到顶部 ↑</a>
      </div>
    </footer>
  );
}

function Layout() {
  const library = useEpisodes();
  const { pathname } = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new route resets the scroll position.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);
  return (
    <EpisodeContext.Provider value={library}>
      <SiteAppearance>
        <Header />
        <main id="main">
          <Outlet />
        </main>
        <Footer />
      </SiteAppearance>
    </EpisodeContext.Provider>
  );
}

function LibraryState({ children }: { children: ReactNode }) {
  const { error, loading, retry, episodes } = useLibrary();
  if (loading)
    return (
      <div className="episode-skeletons" role="status" aria-label="正在加载节目">
        {[0, 1, 2].map((number) => (
          <div key={number} className="episode-skeleton" />
        ))}
      </div>
    );
  if (error)
    return (
      <div className="library-message" role="alert">
        <p>{error}</p>
        <button className="pill-button dark" type="button" onClick={retry}>
          重新加载 <ArrowRight size={18} />
        </button>
      </div>
    );
  if (!episodes.length)
    return (
      <div className="library-message">
        <BrandSymbol />
        <h3>第一段声音，正在路上。</h3>
        <p>节目发布后，会出现在这里。先去认识一下 his.fm。</p>
        <Link className="text-link" to="/about">
          关于我们 <ArrowUpRight size={18} />
        </Link>
      </div>
    );
  return children;
}

function EpisodeCard({ episode }: { episode: PublicEpisodeSummary }) {
  const { categories } = useLibrary();
  const label = episodeDisplayLabel(episode, categories);
  return (
    <article className="episode-card">
      <Link
        to={episodePublicPath(episode.category, episode.slug)}
        className="episode-art"
        tabIndex={-1}
        aria-hidden="true"
      >
        <EpisodeCover
          episode={episode}
          categoryName={categories.find((item) => item.id === episode.category)?.name ?? ''}
        />
        <span className="art-arrow">
          <ArrowUpRight size={25} />
        </span>
      </Link>
      <div className="episode-meta">
        <span>{label}</span>
        <span>
          {durationLabel(episode.durationSeconds)}
          {!episode.audioUrl && ' · 摘要'}
        </span>
      </div>
      <h3>
        <Link to={episodePublicPath(episode.category, episode.slug)}>{episode.title}</Link>
      </h3>
      <p>{episode.summary}</p>
      <div className="episode-bottom">
        <span>{dateLabel(episode.publishedAt)}</span>
        <span>{episode.tags[0]}</span>
      </div>
    </article>
  );
}

function Home() {
  const { episodes, categories } = useLibrary();
  const { id } = useAppearance();
  const quiet = ['stillwood', 'tidal-hours', 'window-seat', 'alpine-bloom'].includes(id);
  const site = usePublicSiteSeo();
  const origin = usePublicOrigin();
  const featured = episodes.find((episode) => episode.featured) ?? episodes[0];
  const featuredLabel = featured ? episodeDisplayLabel(featured, categories) : undefined;
  useEffect(() => {
    applyClientSeo(resolveSiteDefaults(site, origin), [podcastSeriesJsonLd(origin, site)]);
  }, [site, origin]);
  return (
    <>
      <Hero featured={featured} episodeLabel={featuredLabel} />
      <div className="pace-line" aria-hidden="true">
        <span>主理人手札</span>
        <i />
        <Headphones size={18} strokeWidth={1.5} />
        <i />
        <span>生活还在继续</span>
      </div>
      <section className="episode-section wrap" id="episodes">
        <Reveal className="section-heading">
          <div>
            <p className="eyebrow">ON THE OTHER SIDE OF THE SCREEN</p>
            <h2>把耳朵，借给生活。</h2>
          </div>
          <Link to="/episodes" className="text-link">
            全部播客 <ArrowUpRight size={18} />
          </Link>
        </Reveal>
        <LibraryState>
          <div className="episode-grid">
            {episodes.slice(0, 3).map((episode) => (
              <Reveal key={episode.id}>
                <EpisodeCard episode={episode} />
              </Reveal>
            ))}
          </div>
        </LibraryState>
      </section>
      {!quiet && (
        <section className="interlude wrap">
          <div className="interlude-inner">
            <span className="eyebrow">A LITTLE ROOM FOR YOURSELF</span>
            <h2>
              很多事还没做完。
              <br />
              晚饭倒是可以先吃。
            </h2>
            <Link to="/about" className="text-link">
              认识 his.fm <ArrowUpRight size={19} />
            </Link>
            <BrandSymbol />
          </div>
        </section>
      )}
      <section className={`about-teaser ${quiet ? 'quiet-reflection' : 'wrap'}`}>
        <Reveal className="about-teaser-copy">
          <p className="eyebrow">HELLO, WE ARE HIS.FM</p>
          <h2>
            新的工具一直来。
            <br />
            生活也还在继续。
          </h2>
          <p>有时是一个开源项目，有时是一项研究，也可能只是下班以后没想明白的一件小事。</p>
          <p>his.fm 从这些地方开始，聊聊工作怎样进入生活，人又怎样给自己留一点位置。</p>
          <Link to="/about" className="text-link">
            关于这个频道 <ArrowUpRight size={19} />
          </Link>
        </Reveal>
        <Reveal className="about-teaser-image">
          <img
            src={themeMedia[id].artwork}
            alt="屏幕之外，一点安静的日常"
            loading="lazy"
            width={768}
            height={768}
          />
        </Reveal>
      </section>
    </>
  );
}

function Catalogue() {
  const { episodes, categories, hasData } = useLibrary();
  const site = usePublicSiteSeo();
  const origin = usePublicOrigin();
  const [searchParams, setSearchParams] = useSearchParams();
  const category = catalogueCategoryFromSearch(searchParams.get('category'));
  const [query, setQuery] = useState('');
  const setCategoryFilter = (next: string) => {
    setSearchParams(catalogueSearchParamsForCategory(searchParams, next), { replace: true });
  };
  const categoryEpisodes = filterEpisodes(episodes, category, '');
  const filtered = filterEpisodes(categoryEpisodes, 'all', query);
  const activeCategory = category === 'all' ? undefined : categories.find((item) => item.id === category);
  useEffect(() => {
    if (!hasData) return;
    applyClientSeo(resolveCatalogueSeo(site, origin, categoryEpisodes.length, activeCategory), [
      podcastSeriesJsonLd(origin, site),
    ]);
  }, [site, origin, activeCategory, categoryEpisodes.length, hasData]);
  return (
    <section className="catalogue wrap">
      <Reveal className="page-heading">
        <p className="eyebrow">{activeCategory ? 'PROGRAMME / 栏目' : 'THE LISTENING ROOM / 全部播客'}</p>
        {activeCategory ? (
          <div className="catalogue-title-row">
            <h1>{activeCategory.name}</h1>
            <a
              className="text-link"
              href={`/feeds/${encodeURIComponent(activeCategory.id)}.xml`}
              type="application/rss+xml"
            >
              <Rss size={17} aria-hidden="true" /> 订阅栏目 RSS
            </a>
          </div>
        ) : (
          <h1>
            今天，
            <br />
            想听<span>点什么？</span>
            <BrandSymbol />
          </h1>
        )}
        <p>
          {activeCategory
            ? resolveCatalogueSeo(site, origin, categoryEpisodes.length, activeCategory).description
            : '不必按顺序。挑一个此刻想聊的话题。'}
        </p>
      </Reveal>
      <div className="catalogue-tools">
        <nav className="category-filters" aria-label="播客栏目">
          <Link
            to={catalogueHref(searchParams, 'all')}
            className={category === 'all' ? 'selected' : ''}
            aria-current={category === 'all' ? 'page' : undefined}
          >
            全部 <span>{episodes.length.toString().padStart(2, '0')}</span>
          </Link>
          {categories.map((item) => (
            <Link
              key={item.id}
              to={catalogueHref(searchParams, item.id)}
              aria-current={category === item.id ? 'page' : undefined}
              className={category === item.id ? 'selected' : ''}
            >
              {item.name}
            </Link>
          ))}
        </nav>
        <label className="episode-search">
          <Search size={18} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="找个话题…"
            aria-label="搜索播客"
          />
        </label>
      </div>
      <LibraryState>
        <p className="result-count" aria-live="polite">
          {filtered.length} 期节目
        </p>
        {filtered.length ? (
          <div className="episode-grid">
            {filtered.map((episode) => (
              <Reveal key={episode.id}>
                <EpisodeCard episode={episode} />
              </Reveal>
            ))}
          </div>
        ) : (
          <div className="library-message">
            <h2>还没聊到这个话题。</h2>
            <p>换个关键词试试，或者看看全部节目。</p>
            <button
              type="button"
              className="pill-button dark"
              onClick={() => {
                setCategoryFilter('all');
                setQuery('');
              }}
            >
              查看全部 <ArrowRight size={18} />
            </button>
          </div>
        )}
      </LibraryState>
    </section>
  );
}

function EpisodeDetail() {
  const { categoryId, slug } = useParams();
  const { id: theme } = useAppearance();
  const { episodes, categories } = useLibrary();
  const { episode, error, loading, retry } = useEpisodeDetail(categoryId, slug);
  const site = usePublicSiteSeo();
  const cover = episode && episodeThumbnailProps(episode, theme);
  const [copyState, setCopyState] = useState('');
  const origin = usePublicOrigin();
  useEffect(() => {
    if (!episode) return;
    const category = categories.find((item) => item.id === episode.category) ?? {
      id: episode.category,
      name: episode.category,
      icon: 'mic',
      color: 'blue',
      seo: {},
    };
    applyClientSeo(episode.pageSeo, [
      podcastEpisodeJsonLd(origin, episode, site, episode.audioUrl),
      episodeBreadcrumbs(origin, category, episode),
      podcastSeriesJsonLd(origin, site),
    ]);
  }, [episode, categories, origin, site]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Each episode resets share state on navigation.
  useEffect(() => {
    setCopyState('');
  }, [slug, categoryId]);
  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyState('链接已复制');
    } catch {
      setCopyState('请复制浏览器中的地址分享');
    }
  }
  if (loading)
    return (
      <div className="detail-page wrap">
        <Link to="/episodes" className="back-link">
          <ArrowLeft size={17} /> 全部播客
        </Link>
        <div className="episode-skeletons" role="status" aria-label="正在加载这一期">
          <div className="episode-skeleton" />
        </div>
      </div>
    );
  if (error)
    return (
      <div className="detail-page wrap">
        <Link to="/episodes" className="back-link">
          <ArrowLeft size={17} /> 全部播客
        </Link>
        <div className="library-message" role="alert">
          <p>{error}</p>
          <button className="pill-button dark" type="button" onClick={retry}>
            重新加载 <ArrowRight size={18} />
          </button>
        </div>
      </div>
    );
  if (!episode) return <NotFound />;
  return (
    <div className="detail-page wrap">
      <Link to="/episodes" className="back-link">
        <ArrowLeft size={17} /> 全部播客
      </Link>
      <section className="episode-detail-hero">
        <Reveal className="detail-art">
          {episode.audioUrl ? (
            <AudioPlayer
              src={episode.audioUrl}
              title={episode.title}
              coverUrl={cover?.src}
              coverSrcSet={cover?.srcSet}
              coverSizes={episodeThumbnailSizes(coverArtwork(theme).width / coverDesignSize, true)}
              mediaArtworkUrl={`${origin}/episodes/${encodeURIComponent(episode.id)}/art.jpg`}
              episodeNumber={episode.episodeNumber}
              categoryName={categories.find((item) => item.id === episode.category)?.name ?? ''}
              subtitle={episodeDisplayLabel(episode, categories)}
            />
          ) : (
            <EpisodeCover
              episode={episode}
              categoryName={categories.find((item) => item.id === episode.category)?.name ?? ''}
              priority
            />
          )}
        </Reveal>
        <Reveal className="detail-intro">
          <p className="eyebrow">
            {episodeDisplayLabel(episode, categories)} <span> / </span> {dateLabel(episode.publishedAt)}
          </p>
          <h1>{episode.title}</h1>
          <p className="detail-summary">{episode.summary}</p>
          <div className="detail-tags">
            {episode.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          <EpisodeMentions mentions={episode.mentions} />
          <p className="episode-license">
            文字内容采用{' '}
            <a
              href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh"
              rel="license noopener noreferrer"
              target="_blank"
            >
              知识共享 署名-非商业性使用-相同方式共享 4.0
            </a>{' '}
            许可。
          </p>
          {!episode.audioUrl && (
            <div className="recording-note">
              <BrandSymbol />
              <div>
                <strong>声音正在准备中</strong>
                <span>预计 {durationLabel(episode.durationSeconds)} · 先看本期摘要</span>
              </div>
              <a href="#episode-content" className="round-link" aria-label="阅读本期摘要">
                <ArrowDown size={21} />
              </a>
            </div>
          )}
          <button type="button" className="share-link" onClick={share}>
            {copyState === '链接已复制' ? <Check size={16} /> : <Copy size={16} />}
            {copyState || '分享这一期'}
          </button>
          <span className="sr-only" aria-live="polite">
            {copyState}
          </span>
        </Reveal>
      </section>
      <div className="episode-body" id="episode-content">
        <aside>
          <p className="eyebrow">IN THIS EPISODE</p>
          <p>
            给这段文字，
            <br />
            留一会儿时间。
          </p>
          <span>his.fm · {episodeDisplayLabel(episode, categories)}</span>
        </aside>
        <div className="episode-writing">
          <h2 className="sr-only">本期摘要</h2>
          <div id="reading-panel">
            <ReadingText className="readable-text" text={episode.showNotes || episode.summary} />
          </div>
        </div>
      </div>
      <section className="related-episodes">
        <div className="section-heading">
          <div>
            <p className="eyebrow">STAY A LITTLE LONGER</p>
            <h2>再坐一会儿。</h2>
          </div>
          <Link to="/episodes" className="text-link">
            全部播客 <ArrowUpRight size={18} />
          </Link>
        </div>
        <div className="episode-grid">
          {episodes
            .filter((item) => item.id !== episode.id)
            .slice(0, 3)
            .map((item) => (
              <EpisodeCard key={item.id} episode={item} />
            ))}
        </div>
      </section>
    </div>
  );
}

function About() {
  const site = usePublicSiteSeo();
  const origin = usePublicOrigin();
  useEffect(() => {
    applyClientSeo(resolveAboutPageSeo(site, origin), [podcastSeriesJsonLd(origin, site)]);
  }, [site, origin]);
  return (
    <div className="about-page">
      <section className="about-opening wrap">
        <Reveal>
          <p className="eyebrow">A PODCAST. A PAUSE. A LITTLE COMPANY.</p>
          <h1>
            你好。
            <br />
            这里是 <span>his.fm</span>
            <span className="about-star" aria-hidden="true">
              <BrandSymbol />
            </span>
          </h1>
          <div className="about-opening-bottom">
            <p>
              一档给开发者的中文播客。
              <br />
              一些声音，一点陪伴。
            </p>
            <ArrowDown size={40} strokeWidth={1} />
          </div>
        </Reveal>
      </section>
      <div className="about-panorama">
        <ThemeImage mobileSizes="max(100vw, 360px)" />
        <span>
          生活还在继续。
          <br />
          <em>BEYOND THE SCREEN.</em>
        </span>
      </div>
      <section className="about-story wrap">
        <p className="eyebrow">WHY WE PRESS RECORD / 为什么开始</p>
        <div>
          <h2>
            新的一天，
            <br />
            不只有新的版本。
          </h2>
          <p>
            有时是早高峰里没回完的消息，有时是一个让人兴奋的新工具，也有时，只是下班路上突然想起：今天好像还没好好吃饭。
          </p>
          <p>
            AI
            改变了很多工作。写代码变快了，要理解的东西却未必变少。我们在项目里学着跟上，也在生活里重新安排自己的时间。
          </p>
          <p>
            his.fm 想聊这些具体的时刻。一个开源项目能帮上什么忙，一次 Code Review
            怎样开口，一天结束时怎么把思路留给明天。也聊一顿饭、一段路，和没有被待办清单记录的日常。
          </p>
          <p>你可以边走边听，听到一半停下来。希望这些声音，会刚好陪你经过某一段路。</p>
          <p>
            {site.podcastAuthorUrl && (
              <>
                <a
                  className="text-link"
                  href={site.podcastAuthorUrl}
                  rel="me noopener noreferrer"
                  target="_blank"
                >
                  {site.podcastAuthor}的主页 <ArrowUpRight size={16} />
                </a>
                {' · '}
              </>
            )}
            <a className="text-link" href="https://lizheng.blog" rel="noopener noreferrer" target="_blank">
              博客 <ArrowUpRight size={16} />
            </a>
          </p>
          <Link to="/episodes" className="pill-button dark">
            从一期节目开始 <MoveUpRight size={19} />
          </Link>
        </div>
      </section>
      <section className="about-end wrap">
        <span>STAY CURIOUS.</span>
        <em>Stay human.</em>
        <BrandSymbol />
      </section>
    </div>
  );
}

export function NotFound() {
  const site = usePublicSiteSeo();
  useEffect(() => {
    applyClientSeo({
      ...resolveSiteDefaults(site, window.location.origin),
      title: '页面不存在 · his.fm',
      canonical: `${window.location.origin}${window.location.pathname}`,
      noindex: true,
    });
  }, [site]);
  return (
    <section className="not-found wrap">
      <p className="eyebrow">404 / A SMALL DETOUR</p>
      <h1>
        好像，
        <br />
        走到了别的频道。
      </h1>
      <p>这段声音还不在这里。我们回去挑一期。</p>
      <Link to="/episodes" className="pill-button dark">
        回到全部播客 <ArrowUpRight size={19} />
      </Link>
    </section>
  );
}

export function PublicRoutes() {
  return (
    <PublicSiteSeoProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="episodes" element={<Catalogue />} />
          <Route path="episodes/:categoryId/:slug" element={<EpisodeDetail />} />
          <Route path="episodes/:slug" element={<EpisodeDetail />} />
          <Route path="about" element={<About />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </PublicSiteSeoProvider>
  );
}
