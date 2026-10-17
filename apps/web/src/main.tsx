import { z } from 'zod';
import './public/public.css';
import './public/hero.css';
import './components/FramedCover.css';
import './components/AudioPlayer.css';

z.config({ jitless: true });
void import('./bootstrap');
