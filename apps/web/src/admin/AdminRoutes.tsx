import { Button, LinkProvider, ThemeProvider, Toaster, TooltipProvider } from '@nocoo/basalt';
import { LoadingScreen } from '@nocoo/basalt/components/loading-screen';
import { AccentProvider } from '@nocoo/basalt/providers/accent';
import type { ReactNode } from 'react';
import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router';
import { BrandSymbol } from '../brand/Brand';
import { clearClientJsonLd } from '../shared/seo-client';
import { AdminShell } from './AdminShell';
import { EpisodeEditor } from './EpisodeEditor';
import { LoginBadge } from './LoginBadge';
import { errorMessage } from './model';
import { BumpersPage } from './production/BumpersPage';
import { ConnectionsPage } from './production/ConnectionsPage';
import { NewProduction } from './production/NewProduction';
import { ProductionEditor } from './production/ProductionEditor';
import { ProductionList } from './production/ProductionList';
import { ApiError, adminService, type Session } from './service';
import './admin.css';
import './production/production.css';

const CategoryPage = lazy(() => import('./categories/CategoryPage'));
const ChannelPage = lazy(() => import('./channel/ChannelPage'));
const StoragePage = lazy(() => import('./storage/StoragePage'));
const AppearancePage = lazy(() => import('./appearance/AppearancePage'));
const SeoPage = lazy(() => import('./seo/SeoPage'));
const VoicePreviewPage = lazy(() => import('./voice-preview/VoicePreviewPage'));

function StudioLoading({ label }: { label: string }) {
  return <LoadingScreen label={label} mark={<BrandSymbol className="admin-loading-mark" />} />;
}

function RouterLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children?: ReactNode;
}) {
  return /^(?:https?:|\/\/|mailto:|tel:)/.test(href) ? (
    <a href={href} className={className} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <Link to={href} className={className}>
      {children}
    </Link>
  );
}

function AdminProviders({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const sync = () => meta?.setAttribute('content', getComputedStyle(root).backgroundColor);
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'data-mode'] });
    sync();
    return () => {
      observer.disconnect();
      meta?.setAttribute('content', getComputedStyle(root).getPropertyValue('--public-paper').trim());
    };
  }, []);
  return (
    <ThemeProvider storageKey="hisfm-theme" defaultTheme="system">
      <AccentProvider defaultAccent="green" storageKey="hisfm-accent">
        <LinkProvider render={RouterLink}>
          <TooltipProvider>
            <div className="admin-app">{children}</div>
            <Toaster />
          </TooltipProvider>
        </LinkProvider>
      </AccentProvider>
    </ThemeProvider>
  );
}

export function LoginPage() {
  useEffect(() => {
    clearClientJsonLd();
  }, []);
  return (
    <AdminProviders>
      <LoginBadge />
    </AdminProviders>
  );
}

export function AdminRoutes() {
  return (
    <AdminProviders>
      <SessionGate />
    </AdminProviders>
  );
}

function SessionGate() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The retry key intentionally restarts the request.
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    adminService
      .session(controller.signal)
      .then(setSession)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401) setUnauthorized(true);
        else setError(errorMessage(cause));
      });
    return () => controller.abort();
  }, [attempt]);
  if (unauthorized) return <Navigate to="/login" replace />;
  if (error)
    return (
      <main className="admin-gate">
        <h1>工作室暂时无法连接</h1>
        <p role="alert">{error}</p>
        <Button onClick={() => setAttempt(attempt + 1)}>重新连接</Button>
        <Link to="/">返回 his.fm</Link>
      </main>
    );
  if (!session) return <StudioLoading label="正在打开工作室" />;
  return (
    <AdminShell session={session}>
      <Routes>
        <Route index element={<ProductionList />} />
        <Route path="productions/new" element={<NewProduction />} />
        <Route path="productions/:id" element={<ProductionEditor />} />
        <Route
          path="categories/:id?"
          element={
            <Suspense fallback={<StudioLoading label="正在打开栏目管理" />}>
              <CategoryPage />
            </Suspense>
          }
        />
        <Route path="connections" element={<ConnectionsPage />} />
        <Route path="bumpers" element={<BumpersPage />} />
        <Route
          path="channel"
          element={
            <Suspense fallback={<StudioLoading label="正在打开提示词" />}>
              <ChannelPage />
            </Suspense>
          }
        />
        <Route
          path="appearance"
          element={
            <Suspense fallback={<StudioLoading label="正在打开品牌外观" />}>
              <AppearancePage />
            </Suspense>
          }
        />
        <Route
          path="seo"
          element={
            <Suspense fallback={<StudioLoading label="正在打开搜索与分享" />}>
              <SeoPage />
            </Suspense>
          }
        />
        <Route
          path="voice-preview"
          element={
            <Suspense fallback={<StudioLoading label="正在打开音色预览" />}>
              <VoicePreviewPage />
            </Suspense>
          }
        />
        <Route
          path="storage"
          element={
            <Suspense fallback={<StudioLoading label="正在打开资源管理" />}>
              <StoragePage />
            </Suspense>
          }
        />
        <Route path="episodes/new" element={<EpisodeEditor />} />
        <Route path="episodes/:id" element={<EpisodeEditor />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AdminShell>
  );
}
