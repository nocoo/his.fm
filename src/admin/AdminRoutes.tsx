import '@nocoo/basalt/styles/standalone';
import { Button, LinkProvider, ThemeProvider, Toaster, TooltipProvider } from '@nocoo/basalt';
import { LoadingScreen } from '@nocoo/basalt/components/loading-screen';
import { AccentProvider } from '@nocoo/basalt/providers/accent';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router';
import { AdminShell } from './AdminShell';
import { EpisodeEditor } from './EpisodeEditor';
import { EpisodeList } from './EpisodeList';
import { LoginBadge } from './LoginBadge';
import { errorMessage } from './model';
import { ApiError, adminService, type Session } from './service';
import './admin.css';

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
  if (!session) return <LoadingScreen label="正在打开工作室" />;
  return (
    <AdminShell session={session}>
      <Routes>
        <Route index element={<EpisodeList />} />
        <Route path="episodes/new" element={<EpisodeEditor />} />
        <Route path="episodes/:id" element={<EpisodeEditor />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AdminShell>
  );
}
