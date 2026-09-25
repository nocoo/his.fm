import {
  ArrowDown,
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  Headphones,
  Menu,
  MoveUpRight,
  Search,
  X,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, Route, Routes, useLocation, useParams } from 'react-router';
import { categories, type Episode } from '../shared/episode';
import { categoryLabel, dateLabel, durationLabel, filterEpisodes } from './model';
import { useEpisodes } from './useEpisodes';

const EpisodeContext = createContext<ReturnType<typeof useEpisodes> | null>(null);

function useLibrary() {
  const value = useContext(EpisodeContext);
  if (!value) throw new Error('Episode library is missing');
  return value;
}

function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

function Soundmark({ className = '' }: { className?: string }) {
  return (
    <span className={`soundmark ${className}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
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
        <Soundmark />
        his.fm<span className="wordmark-dot">●</span>
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
        his.fm<span>✳</span>
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
      <div className="public-site" id="top">
        <a className="public-skip" href="#main">
          跳到正文
        </a>
        <Header />
        <main id="main">
          <Outlet />
        </main>
        <Footer />
      </div>
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
        <Soundmark />
        <h3>第一段声音，正在路上。</h3>
        <p>节目发布后，会出现在这里。先去认识一下 his.fm。</p>
        <Link className="text-link" to="/about">
          关于我们 <ArrowUpRight size={18} />
        </Link>
      </div>
    );
  return children;
}

function EpisodeCard({ episode, index = 0 }: { episode: Episode; index?: number }) {
  return (
    <article className={`episode-card tone-${index % 3}`}>
      <Link to={`/episodes/${episode.slug}`} className="episode-art" tabIndex={-1} aria-hidden="true">
        <img src={episode.coverUrl} alt="" width="768" height="768" loading="lazy" />
        <span className="art-episode">EP.{String(episode.episodeNumber).padStart(2, '0')}</span>
        <span className="art-arrow">
          <ArrowUpRight size={25} />
        </span>
      </Link>
      <div className="episode-meta">
        <span>{categoryLabel(episode.category)}</span>
        <span>
          {durationLabel(episode.durationSeconds)}
          {!episode.audioUrl && ' · 文稿'}
        </span>
      </div>
      <h3>
        <Link to={`/episodes/${episode.slug}`}>{episode.title}</Link>
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
  const { episodes } = useLibrary();
  const featured = episodes.find((episode) => episode.featured) ?? episodes[0];
  useEffect(() => {
    document.title = 'his.fm · 世界很快，你可以慢慢来';
  }, []);
  return (
    <>
      <section className="hero">
        <img
          className="hero-image"
          src="https://f.no.mt/images/hero.webp"
          alt="巨树的树荫下，一个人坐在草地上，望向阳光中的未来城市"
          width="1536"
          height="1024"
          fetchPriority="high"
        />
        <div className="hero-shade" />
        <div className="hero-content">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}>
            <p className="eyebrow hero-eyebrow">
              <span className="live-dot" /> FOR THE HUMAN BEHIND THE CODE
            </p>
            <h1>
              世界很快。
              <br />
              你可以，
              <br />
              <span>慢慢来。</span>
              <span className="hero-asterisk" aria-hidden="true">
                ✳
              </span>
            </h1>
            <p className="hero-description">
              聊 AI，聊工作。
              <br />
              也聊屏幕之外，正在发生的生活。
            </p>
            <Link to="/episodes" className="pill-button lime">
              找一期，歇一会儿 <ArrowUpRight size={20} />
            </Link>
          </motion.div>
        </div>
        <div className="hero-edge">
          <span>一档给开发者的中文播客</span>
          <span>
            SCROLL TO UNWIND <ArrowDown size={14} />
          </span>
        </div>
        {featured && (
          <Link className="hero-feature" to={`/episodes/${featured.slug}`}>
            <img src={featured.coverUrl} alt="" width="64" height="64" />
            <div>
              <span>本期推荐 · EP.{String(featured.episodeNumber).padStart(2, '0')}</span>
              <strong>{featured.title}</strong>
              <small>
                {durationLabel(featured.durationSeconds)} · {featured.audioUrl ? '现在收听' : '先读文稿'}
              </small>
            </div>
            <span className="feature-arrow">
              <ArrowUpRight size={22} />
            </span>
          </Link>
        )}
      </section>
      <div className="ticker" aria-hidden="true">
        <div>
          {[0, 1, 2, 3].map((item) => (
            <span key={item}>
              LESS NOISE <i>✳</i> MORE LIFE <i>✳</i> 保持好奇，慢慢生长 <i>✳</i>
            </span>
          ))}
        </div>
      </div>
      <section className="episode-section wrap">
        <Reveal className="section-heading">
          <div>
            <p className="eyebrow">
              <span className="tiny-square" /> LATEST EPISODES / 最近更新
            </p>
            <h2>
              把耳朵，
              <br className="mobile-break" />
              借给生活<span className="punctuation">。</span>
            </h2>
          </div>
          <div className="section-heading-side">
            <p>
              通勤的路，散步的十分钟。
              <br />
              留一点空白，听见别的可能。
            </p>
            <Link to="/episodes" className="text-link">
              全部播客 <ArrowUpRight size={18} />
            </Link>
          </div>
        </Reveal>
        <LibraryState>
          <div className="episode-grid">
            {episodes.slice(0, 3).map((episode, index) => (
              <Reveal key={episode.id}>
                <EpisodeCard episode={episode} index={index} />
              </Reveal>
            ))}
          </div>
        </LibraryState>
      </section>
      <section className="interlude wrap">
        <Reveal className="interlude-inner">
          <div className="interlude-caption">
            <span className="eyebrow">A LITTLE ROOM FOR YOURSELF</span>
            <ArrowDownLeft size={45} strokeWidth={1} />
          </div>
          <p>
            代码之外，
            <br />
            你还有<span>一整个世界。</span>
          </p>
          <div className="interlude-foot">
            <span>写给每一个，关掉编辑器之后的你。</span>
            <Link to="/about" className="round-link" aria-label="了解 his.fm">
              <ArrowUpRight size={27} />
            </Link>
          </div>
          <span className="interlude-orbit" aria-hidden="true" />
        </Reveal>
      </section>
      <section className="about-teaser wrap">
        <Reveal className="about-teaser-image">
          <img
            src="https://f.no.mt/images/episode-03.webp"
            alt="月光映在一片安静的草地上"
            loading="lazy"
            width="768"
            height="768"
          />
          <span className="image-stamp">
            OFFLINE IS
            <br />
            <em>A GOOD PLACE.</em>
          </span>
        </Reveal>
        <Reveal className="about-teaser-copy">
          <p className="eyebrow">HELLO, WE ARE HIS.FM</p>
          <h2>
            在更新的世界里，
            <br />
            留一点<span>自己的节奏。</span>
          </h2>
          <p>每天都有新模型、新工具、新的工作方式。我们也会兴奋，也会在深夜关掉页面时，觉得有点累。</p>
          <p>
            所以有了
            his.fm。把那些来不及聊的话，放进一段声音里：写代码的日常，一次没想明白的转变，还有下班以后的小事。
          </p>
          <Link to="/about" className="pill-button outline">
            认识 his.fm <ArrowUpRight size={19} />
          </Link>
        </Reveal>
      </section>
    </>
  );
}

function Catalogue() {
  const { episodes } = useLibrary();
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const filtered = filterEpisodes(episodes, category, query);
  useEffect(() => {
    document.title = '全部播客 · his.fm';
  }, []);
  return (
    <section className="catalogue wrap">
      <Reveal className="page-heading">
        <p className="eyebrow">THE LISTENING ROOM / 全部播客</p>
        <h1>
          今天，
          <br />
          想听<span>点什么？</span>
          <Soundmark />
        </h1>
        <p>不必按顺序。挑一个此刻想聊的话题。</p>
      </Reveal>
      <div className="catalogue-tools">
        <fieldset className="category-filters" aria-label="按主题筛选">
          <button
            type="button"
            className={category === 'all' ? 'selected' : ''}
            aria-pressed={category === 'all'}
            onClick={() => setCategory('all')}
          >
            全部 <span>{episodes.length.toString().padStart(2, '0')}</span>
          </button>
          {categories.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={category === item.id}
              className={category === item.id ? 'selected' : ''}
              onClick={() => setCategory(item.id)}
            >
              {item.label}
            </button>
          ))}
        </fieldset>
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
            {filtered.map((episode, index) => (
              <Reveal key={episode.id}>
                <EpisodeCard episode={episode} index={index} />
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
                setCategory('all');
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

function ReadableText({ text }: { text: string }) {
  return (
    <div className="readable-text">
      {text
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((block, index) => {
          const key = `${index}-${block.slice(0, 20)}`;
          if (/^#{1,4} /.test(block))
            return <h3 key={key}>{block.replace(/^#{1,4} /, '').replaceAll('**', '')}</h3>;
          if (/^---+$/.test(block.trim())) return <hr key={key} />;
          return (
            <p key={key}>
              {block
                .replaceAll('**', '')
                .replace(/^> /gm, '')
                .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1（$2）')}
            </p>
          );
        })}
    </div>
  );
}

function EpisodeDetail() {
  const { slug } = useParams();
  const { episodes, loading, error } = useLibrary();
  const episode = episodes.find((item) => item.slug === slug);
  const [tab, setTab] = useState<'notes' | 'transcript'>('notes');
  const [copyState, setCopyState] = useState('');
  useEffect(() => {
    document.title = episode ? `${episode.title} · his.fm` : '节目详情 · his.fm';
  }, [episode]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Each episode starts with its own summary and share state.
  useEffect(() => {
    setTab('notes');
    setCopyState('');
  }, [slug]);
  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyState('链接已复制');
    } catch {
      setCopyState('请复制浏览器中的地址分享');
    }
  }
  if (!loading && !error && !episode) return <NotFound />;
  return (
    <div className="detail-page wrap">
      <Link to="/episodes" className="back-link">
        <ArrowLeft size={17} /> 全部播客
      </Link>
      <LibraryState>
        {episode && (
          <>
            <section className="episode-detail-hero">
              <Reveal className="detail-art">
                <img src={episode.coverUrl} alt={`${episode.title}的节目封面`} width="768" height="768" />
                <span>EP.{String(episode.episodeNumber).padStart(2, '0')}</span>
              </Reveal>
              <Reveal className="detail-intro">
                <p className="eyebrow">
                  {categoryLabel(episode.category)} <span> / </span> {dateLabel(episode.publishedAt)}
                </p>
                <h1>{episode.title}</h1>
                <p className="detail-summary">{episode.summary}</p>
                <div className="detail-tags">
                  {episode.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                {episode.audioUrl ? (
                  <div className="audio-player">
                    <span>
                      <Headphones size={17} /> {durationLabel(episode.durationSeconds)}
                    </span>
                    {/* biome-ignore lint/a11y/useMediaCaption: The complete transcript is available in the adjacent reading panel. */}
                    <audio
                      controls
                      preload="metadata"
                      src={episode.audioUrl}
                      aria-label={`收听 ${episode.title}`}
                    />
                  </div>
                ) : (
                  <div className="recording-note">
                    <Soundmark />
                    <div>
                      <strong>声音正在准备中</strong>
                      <span>预计 {durationLabel(episode.durationSeconds)} · 先读本期文稿</span>
                    </div>
                    <a href="#episode-content" className="round-link" aria-label="阅读本期文稿">
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
                <span>his.fm · EP.{String(episode.episodeNumber).padStart(2, '0')}</span>
              </aside>
              <div className="episode-writing">
                <div className="reading-tabs" role="tablist" aria-label="节目内容">
                  <button
                    id="notes-tab"
                    aria-controls="reading-panel"
                    role="tab"
                    aria-selected={tab === 'notes'}
                    type="button"
                    onClick={() => setTab('notes')}
                  >
                    本期摘要
                  </button>
                  <button
                    id="transcript-tab"
                    aria-controls="reading-panel"
                    role="tab"
                    aria-selected={tab === 'transcript'}
                    type="button"
                    onClick={() => setTab('transcript')}
                  >
                    逐字稿
                  </button>
                </div>
                <div id="reading-panel" role="tabpanel" aria-labelledby={`${tab}-tab`}>
                  <ReadableText
                    text={
                      tab === 'notes'
                        ? episode.showNotes || episode.summary
                        : episode.transcript || '逐字稿正在整理中。'
                    }
                  />
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
                  .map((item, index) => (
                    <EpisodeCard key={item.id} episode={item} index={index} />
                  ))}
              </div>
            </section>
          </>
        )}
      </LibraryState>
    </div>
  );
}

function About() {
  useEffect(() => {
    document.title = '关于 his.fm · 代码之外，还有生活';
  }, []);
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
              ✳
            </span>
          </h1>
          <div className="about-opening-bottom">
            <p>
              一档给开发者的中文播客。
              <br />
              一些声音，一点陪伴。
            </p>
            <ArrowDownLeft size={54} strokeWidth={1} />
          </div>
        </Reveal>
      </section>
      <div className="about-panorama">
        <img
          src="https://f.no.mt/images/hero.webp"
          alt="大树下的草地与远方的城市"
          width="1536"
          height="1024"
        />
        <span>
          THERE IS LIFE
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
          <Link to="/episodes" className="pill-button dark">
            从一期节目开始 <MoveUpRight size={19} />
          </Link>
        </div>
      </section>
      <section className="about-end wrap">
        <span>STAY CURIOUS.</span>
        <em>Stay human.</em>
        <Soundmark />
      </section>
    </div>
  );
}

function NotFound() {
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
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="episodes" element={<Catalogue />} />
        <Route path="episodes/:slug" element={<EpisodeDetail />} />
        <Route path="about" element={<About />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
