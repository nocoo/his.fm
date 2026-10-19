import { expect, it } from 'vitest';
import { adminBreadcrumbs, productionSections } from './navigation.model';

it('gives every studio page a real parent link and one nonlinked current page', () => {
  expect(adminBreadcrumbs('/admin/')).toEqual([{ label: '节目库' }]);
  for (const [path, label] of Object.entries({
    categories: '栏目管理',
    channel: '提示词',
    bumpers: '贴片库',
    appearance: '品牌外观',
    seo: '搜索与分享',
    'voice-preview': '音色预览',
    connections: '连接管理',
    storage: '资源管理',
  })) {
    expect(adminBreadcrumbs(`/admin/${path}`)).toEqual([{ label: '工作室', href: '/admin' }, { label }]);
  }
  expect(adminBreadcrumbs('/admin/unknown').at(-1)).toEqual({ label: '工作室' });
});

it('tracks all production sections and lets source details return to the same brief', () => {
  const path = '/admin/productions/saved-project';
  const parents = [
    { label: '节目库', href: '/admin' },
    { label: '节目详情', href: path },
  ];
  for (const section of productionSections)
    expect(adminBreadcrumbs(path, `?section=${section.id}`)).toEqual([...parents, { label: section.label }]);
  expect(adminBreadcrumbs(path)).toEqual([...parents, { label: '资料与素材' }]);
  expect(adminBreadcrumbs(path, '?section=unknown')).toEqual(adminBreadcrumbs(path));
  expect(adminBreadcrumbs(path, '?section=publication&source=saved-source')).toEqual([
    ...parents,
    { label: '资料与素材', href: `${path}?section=metadata` },
    { label: '素材详情' },
  ]);
});

it('distinguishes category and episode creation from details', () => {
  expect(adminBreadcrumbs('/admin/categories/new').at(-1)).toEqual({ label: '新建栏目' });
  expect(adminBreadcrumbs('/admin/categories/life')).toEqual([
    { label: '工作室', href: '/admin' },
    { label: '栏目管理', href: '/admin/categories' },
    { label: '编辑栏目' },
  ]);
  for (const path of ['/admin/productions/new', '/admin/episodes/new'])
    expect(adminBreadcrumbs(path)).toEqual([{ label: '节目库', href: '/admin' }, { label: '新建节目' }]);
  expect(adminBreadcrumbs('/admin/episodes/saved')).toEqual([
    { label: '节目库', href: '/admin' },
    { label: '编辑节目' },
  ]);
});

it('preserves prompt scope when navigating from a slot to its parent', () => {
  const path = '/admin/channel';
  expect(adminBreadcrumbs(path, '?scope=channel').at(-1)).toEqual({ label: '频道提示词' });
  expect(adminBreadcrumbs(path, '?scope=unknown').at(-1)).toEqual({ label: '频道提示词' });
  expect(adminBreadcrumbs(path, '?scope=category:life').at(-1)).toEqual({ label: '栏目提示词' });
  expect(adminBreadcrumbs(path, '?slot=editor')).toEqual([
    { label: '工作室', href: '/admin' },
    { label: '提示词', href: path },
    { label: '频道提示词', href: `${path}?scope=channel` },
    { label: '提示词槽位' },
  ]);
  expect(adminBreadcrumbs(path, '?scope=category:life&slot=editor').at(-2)).toEqual({
    label: '栏目提示词',
    href: `${path}?scope=category%3Alife`,
  });
});
