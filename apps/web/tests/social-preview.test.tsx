// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryService } from '../src/admin/categories/service';
import { EpisodeSocialPreview } from '../src/admin/seo/EpisodeSocialPreview';
import { PublicationSocialPreview } from '../src/admin/seo/PublicationSocialPreview';
import { SocialPreview } from '../src/admin/seo/SocialPreview';
import { siteSeoService } from '../src/admin/seo/service';
import {
  episodeSocialPreview,
  productionPreviewEpisode,
  socialPlatforms,
} from '../src/admin/seo/social-preview.model';
import { adminService } from '../src/admin/service';
import type { Episode } from '../src/shared/episode';
import { type SiteSeoRecord, siteSeoSchema } from '../src/shared/seo';
import { fixture, readyFixture } from './worker/production-fixture';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const site: SiteSeoRecord = {
  ...siteSeoSchema.parse({ siteName: '慢慢来', titleSuffix: ' · 慢慢来' }),
  version: 1,
  updatedAt: '2026-10-01T00:00:00Z',
  updatedBy: 'editor',
};
const episode: Episode = {
  ...productionPreviewEpisode(readyFixture()),
  status: 'published',
  publishedAt: '2026-10-01T00:00:00Z',
};

describe('studio social previews', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.spyOn(siteSeoService, 'read').mockResolvedValue({ seo: site });
    vi.spyOn(categoryService, 'list').mockResolvedValue({
      categories: [
        { id: 'life', name: '生活', icon: 'leaf', color: 'teal', seo: {} },
        { id: 'learning', name: '学习', icon: 'book-open', color: 'blue', seo: {} },
      ],
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('switches all eight platform cards live without changing metadata or submitting a form', async () => {
    const submit = vi.fn((event: React.SubmitEvent) => event.preventDefault());
    const props = episodeSocialPreview(site, 'https://his.fm', episode, '生活', episode);
    await act(async () => {
      root.render(
        <form onSubmit={submit}>
          <SocialPreview {...props} notice="已发布快照" />
        </form>,
      );
    });
    for (const platform of socialPlatforms) {
      const trigger = container.querySelector('[role="combobox"]');
      expect(trigger).not.toBeNull();
      act(() => {
        trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      const option = [...document.querySelectorAll('[role="option"]')].find(
        (item) => item.textContent === platform.label,
      );
      expect(option).toBeDefined();
      act(() => {
        option?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      expect(container.querySelector(`.social-card-${platform.id}`)).not.toBeNull();
      expect(container.querySelector('.social-card-title')?.textContent).toBe(props.seo.title);
      expect(container.querySelector('img')?.getAttribute('src')).toBe(props.seo.ogImageUrl);
    }
    expect(submit).not.toHaveBeenCalled();
    expect(container.textContent).toContain('近似模拟，非平台实时抓取');
    expect(container.textContent).toContain('summary_large_image');
  });

  it('shows explicit unavailable states without substituting original covers', async () => {
    const props = episodeSocialPreview(site, 'https://his.fm', episode, '生活', episode);
    await act(async () => root.render(<SocialPreview {...props} notice="已发布" />));
    act(() => {
      container.querySelector('img')?.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('图片暂时无法加载');
    const next = { ...props, seo: { ...props.seo, ogImageUrl: 'https://his.fm/media/new.jpg' } };
    await act(async () => root.render(<SocialPreview {...next} notice="新的图片" />));
    expect(container.querySelector('img')?.getAttribute('src')).toBe(next.seo.ogImageUrl);
    await act(async () => root.render(<SocialPreview {...next} imageAvailable={false} notice="草稿" />));
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('图片待公开或保存后可用');
    expect(container.textContent).not.toContain(episode.coverUrl);
  });

  it('resolves edited episode metadata from real site settings and keeps drafts image-free', async () => {
    const draft = { ...episode, title: '正在编辑', seo: { description: '自定义分享描述', noindex: true } };
    await act(async () => {
      root.render(<EpisodeSocialPreview episode={draft} categoryName="生活" />);
    });
    expect(container.querySelector('.social-card-title')?.textContent).toContain(
      `正在编辑${site.titleSuffix}`,
    );
    expect(container.querySelector('.social-card-description')?.textContent).toBe('自定义分享描述');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('noindex, follow');
    expect(siteSeoService.read).toHaveBeenCalledWith(expect.any(AbortSignal));
    await act(async () => {
      root.render(<EpisodeSocialPreview episode={episode} saved={episode} categoryName="生活" />);
    });
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      `${window.location.origin}/episodes/production-test/share.jpg`,
    );
  });

  it('uses production URLs for production data viewed through a local studio', async () => {
    localStorage.setItem('hisfm-admin-environment', 'production');
    await act(async () => {
      root.render(<EpisodeSocialPreview episode={episode} saved={episode} categoryName="生活" />);
    });
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://his.fm/episodes/production-test/share.jpg',
    );
    expect(container.textContent).toContain('https://his.fm/episodes/life/dinner-before-the-prompt');
  });

  it('does not request future publication images or invent an unsaved record image URL', async () => {
    const future = { ...episode, publishedAt: '2999-01-01T00:00:00Z' };
    await act(async () => {
      root.render(<EpisodeSocialPreview episode={future} saved={future} categoryName="生活" />);
    });
    expect(container.querySelector('img')).toBeNull();
    await act(async () => {
      root.render(<EpisodeSocialPreview episode={{ ...episode, id: '' }} categoryName="生活" />);
    });
    expect(container.textContent).toContain('保存节目后生成分享图地址');
    expect(container.textContent).not.toContain('/episodes//share.jpg');
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows and retries actual site metadata read failures instead of inventing defaults', async () => {
    vi.mocked(siteSeoService.read).mockRejectedValueOnce(new Error('SEO settings unavailable'));
    await act(async () => {
      root.render(<EpisodeSocialPreview episode={episode} saved={episode} categoryName="生活" />);
    });
    expect(container.textContent).toContain('SEO settings unavailable');
    expect(container.querySelector('.social-card')).toBeNull();
    await act(async () => container.querySelector('button')?.click());
    expect(container.querySelector('.social-card')).not.toBeNull();
    expect(siteSeoService.read).toHaveBeenCalledTimes(2);
  });

  it('aborts metadata reads on unmount', async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(siteSeoService.read).mockImplementation((value) => {
      signal = value;
      return new Promise(() => {});
    });
    await act(async () => {
      root.render(<EpisodeSocialPreview episode={episode} categoryName="生活" />);
    });
    expect(container.querySelector('[aria-label="正在读取分享预览元数据"]')).not.toBeNull();
    await act(async () => root.render(null));
    expect(signal?.aborted).toBe(true);
  });

  it('previews the linked snapshot by sourceProductionId rather than slug, title or current revision', async () => {
    const snapshot = { ...episode, id: 'immutable-record', category: 'learning', title: '已发布标题' };
    vi.spyOn(adminService, 'list').mockResolvedValue({
      episodes: [{ ...episode, sourceProductionId: 'other-production' }, snapshot],
    });
    await act(async () => {
      root.render(<PublicationSocialPreview production={fixture({ title: '正在制作的修订' })} />);
    });
    expect(container.querySelector('.social-card-title')?.textContent).toBe(
      `学习 EP.08 · 已发布标题${site.titleSuffix}`,
    );
    expect(container.textContent).toContain('预览当前节目发布快照，不是制作中的修订');
    expect(container.textContent).not.toContain('正在制作的修订');
    expect(container.querySelector('img')?.getAttribute('src')).toContain(
      '/episodes/immutable-record/share.jpg',
    );
  });

  it('projects pre-publication production content without loading a public image', async () => {
    vi.spyOn(adminService, 'list').mockResolvedValue({ episodes: [] });
    await act(async () => {
      root.render(<PublicationSocialPreview production={readyFixture({ seo: { title: '待发布标题' } })} />);
    });
    expect(container.querySelector('.social-card-title')?.textContent).toBe('待发布标题');
    expect(container.textContent).toContain('制作草稿推演');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('/episodes/production-test/share.jpg');
  });

  it('refreshes publication snapshots after a production version changes', async () => {
    vi.spyOn(adminService, 'list')
      .mockResolvedValueOnce({ episodes: [] })
      .mockResolvedValueOnce({ episodes: [episode] });
    await act(async () => root.render(<PublicationSocialPreview production={readyFixture()} />));
    expect(container.querySelector('img')).toBeNull();
    await act(async () =>
      root.render(<PublicationSocialPreview production={readyFixture({ version: 2 })} />),
    );
    expect(container.querySelector('img')).not.toBeNull();
    expect(adminService.list).toHaveBeenCalledTimes(2);
  });
});
