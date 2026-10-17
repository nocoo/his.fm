import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './App';
import { type PublicData, PublicDataContext } from './public/PublicData';
import './public/public.css';

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing');
const bootstrap = document.getElementById('public-data');
const data: PublicData | null = bootstrap ? JSON.parse(bootstrap.textContent ?? 'null') : null;
const app = (
  <StrictMode>
    <PublicDataContext.Provider value={data}>
      <App />
    </PublicDataContext.Provider>
  </StrictMode>
);
if (data) hydrateRoot(root, app);
else createRoot(root).render(app);
