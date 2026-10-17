import { type EpisodeInput, episodeInputSchema } from '../shared/episode';
import type { Session } from './service';

export const emptyEpisode: EpisodeInput = {
  slug: '',
  episodeNumber: 1,
  title: '',
  summary: '',
  transcript: '',
  showNotes: '',
  coverUrl: 'https://f.no.mt/images/episode-01.webp',
  category: 'manager-notes',
  tags: [],
  durationSeconds: 600,
  audioUrl: null,
  status: 'draft',
  featured: false,
  publishedAt: null,
};

export function toLocalDateTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function readEpisodeForm(form: FormData) {
  const text = (key: string) => String(form.get(key) ?? '');
  const dateText = text('publishedAt');
  const date = new Date(dateText);
  const publishedAt = dateText && Number.isFinite(date.getTime()) ? date.toISOString() : dateText || null;
  const parsed = episodeInputSchema.safeParse({
    slug: text('slug'),
    episodeNumber: Number(text('episodeNumber')),
    title: text('title'),
    summary: text('summary'),
    transcript: text('transcript'),
    showNotes: text('showNotes'),
    coverUrl: text('coverUrl'),
    category: text('category'),
    tags: text('tags')
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
    durationSeconds: Math.round(Number(text('durationMinutes')) * 60),
    audioUrl: text('audioUrl').trim() || null,
    status: text('status'),
    featured: form.get('featured') === 'on',
    publishedAt,
  });
  if (parsed.success) return { data: parsed.data, errors: null };
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0]);
    errors[key] = issue.message;
  }
  return { data: null, errors };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '暂时无法完成操作，请稍后重试';
}

export function sessionDisplayName(session: Session): string {
  return session.user.name?.trim() || session.user.email;
}

export function sessionInitials(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  const local = trimmed.includes('@') ? trimmed.split('@')[0] : trimmed;
  return local.slice(0, 2).toUpperCase();
}
