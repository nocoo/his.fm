import { createContext, type ReactNode, useContext, useEffect, useLayoutEffect, useState } from 'react';
import { Link, type LinkProps, NavLink, type NavLinkProps, useLocation } from 'react-router';
import { BrandSymbol } from '../brand/Brand';
import { themeStyle, themes } from '../brand/themes';
import { type PublicAppearance, type ThemeId, themeIdSchema } from '../shared/appearance';
import { appearanceHref, getAppearance } from './model';

const AppearanceContext = createContext<{ id: ThemeId; preview: ThemeId | null } | null>(null);

export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('Website appearance is missing');
  return value;
}

export function PublicLink({ to, ...props }: Omit<LinkProps, 'to'> & { to: string }) {
  const { preview } = useAppearance();
  return <Link {...props} to={appearanceHref(to, preview)} />;
}

export function PublicNavLink({ to, ...props }: Omit<NavLinkProps, 'to'> & { to: string }) {
  const { preview } = useAppearance();
  return <NavLink {...props} to={appearanceHref(to, preview)} />;
}

export function SiteAppearance({ children }: { children: ReactNode }) {
  const location = useLocation();
  const selected = themeIdSchema.safeParse(new URLSearchParams(location.search).get('theme'));
  const preview = selected.success ? selected.data : null;
  const [appearance, setAppearance] = useState<PublicAppearance | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const id = preview ?? appearance?.theme;

  // biome-ignore lint/correctness/useExhaustiveDependencies: A retry or a returning tab refreshes the server-selected appearance.
  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    setError('');
    getAppearance(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setAppearance(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('网站外观暂时无法加载，请重试。');
      });
    return () => controller.abort();
  }, [attempt, preview]);

  useEffect(() => {
    const refresh = () => setAttempt((value) => value + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  useLayoutEffect(() => {
    if (!id) return;
    const root = document.documentElement;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const paper = themes[id].palette[0];
    root.style.setProperty('--public-paper', paper);
    meta?.setAttribute('content', paper);
    return () => {
      root.style.removeProperty('--public-paper');
    };
  }, [id]);

  if (!id) {
    return (
      <main className="appearance-gate">
        <BrandSymbol />
        <p role={error ? 'alert' : 'status'}>{error || '正在打开 his.fm…'}</p>
        {error && (
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            重新加载
          </button>
        )}
      </main>
    );
  }
  const exit = new URLSearchParams(location.search);
  exit.delete('theme');
  const exitPath = `${location.pathname}${exit.size ? `?${exit}` : ''}${location.hash}`;
  return (
    <AppearanceContext.Provider value={{ id, preview }}>
      <div
        className="public-site"
        id="top"
        data-theme={id}
        data-home={location.pathname === '/'}
        style={themeStyle(id)}
      >
        <a className="public-skip" href="#main">
          跳到正文
        </a>
        {preview && (
          <aside className="appearance-preview" aria-label="外观预览">
            <span>
              外观预览 · {themes[id].name}
              <span className="preview-explanation"> · 仅当前页面可见</span>
            </span>
            <Link to={exitPath}>退出预览 ↗</Link>
          </aside>
        )}
        {error && !preview && (
          <div className="appearance-preview" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              重试
            </button>
          </div>
        )}
        {children}
      </div>
    </AppearanceContext.Provider>
  );
}
