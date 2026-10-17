import type { Category, CategoryInput, PublicCategory } from '../../shared/category';
import { request } from '../service';

export const categoryService = {
  list: (signal?: AbortSignal) => request<{ categories: PublicCategory[] }>('/categories', { signal }),
  get: (id: string, signal?: AbortSignal) =>
    request<{ category: Category }>(`/categories/${encodeURIComponent(id)}`, { signal }),
  save: (value: CategoryInput, id?: string, version?: number, nextId?: string) =>
    request<{ category: Category }>(id ? `/categories/${encodeURIComponent(id)}` : '/categories', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(
        id ? { ...value, version, ...(nextId && nextId !== id ? { nextId } : {}) } : value,
      ),
    }),
  remove: (id: string, version: number) =>
    request<void>(`/categories/${encodeURIComponent(id)}?version=${version}`, { method: 'DELETE' }),
};
