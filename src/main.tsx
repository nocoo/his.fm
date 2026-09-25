import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { PublicRoutes } from './public/PublicRoutes';
import './public/public.css';

const AdminRoutes = lazy(() =>
  import('./admin/AdminRoutes').then((module) => ({ default: module.AdminRoutes })),
);
const LoginPage = lazy(() => import('./admin/AdminRoutes').then((module) => ({ default: module.LoginPage })));

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense
        fallback={
          <div className="app-loading" role="status">
            正在打开 his.fm…
          </div>
        }
      >
        <Routes>
          <Route path="/admin/*" element={<AdminRoutes />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/*" element={<PublicRoutes />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);
