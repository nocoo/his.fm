import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { PublicRoutes } from './public/PublicRoutes';

const AdminRoutes = lazy(() =>
  import('./admin/AdminRoutes').then((module) => ({ default: module.AdminRoutes })),
);
const LoginPage = lazy(() => import('./admin/AdminRoutes').then((module) => ({ default: module.LoginPage })));

export function App() {
  return (
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
  );
}
