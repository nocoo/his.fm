export const productionSections = [
  { id: 'metadata', label: '资料与素材' },
  { id: 'manuscript', label: '逐字稿' },
  { id: 'assets', label: '封面与音频' },
  { id: 'publication', label: '发布' },
] as const;

const pages: Record<string, string> = {
  '/admin/categories': '栏目管理',
  '/admin/channel': '提示词',
  '/admin/bumpers': '贴片库',
  '/admin/appearance': '品牌外观',
  '/admin/seo': '搜索与分享',
  '/admin/voice-preview': '音色预览',
  '/admin/connections': '连接管理',
  '/admin/storage': '资源管理',
};

export function adminBreadcrumbs(pathname: string, search = ''): { label: string; href?: string }[] {
  const path = pathname.replace(/\/+$/, '');
  const query = new URLSearchParams(search);
  const studio = { label: '工作室', href: '/admin' };
  const library = { label: '节目库', href: '/admin' };
  if (path === '/admin') return [{ label: '节目库' }];
  if (path === '/admin/productions/new' || path === '/admin/episodes/new')
    return [library, { label: '新建节目' }];
  if (path.startsWith('/admin/productions/')) {
    const detail = { label: '节目详情', href: path };
    if (query.has('source'))
      return [
        library,
        detail,
        { label: '资料与素材', href: `${path}?section=metadata` },
        { label: '素材详情' },
      ];
    const section =
      productionSections.find((item) => item.id === query.get('section')) ?? productionSections[0];
    return [library, detail, { label: section.label }];
  }
  if (path.startsWith('/admin/episodes/')) return [library, { label: '编辑节目' }];
  if (path.startsWith('/admin/categories/'))
    return [
      studio,
      { label: '栏目管理', href: '/admin/categories' },
      { label: path.endsWith('/new') ? '新建栏目' : '编辑栏目' },
    ];
  if (path === '/admin/channel' && (query.has('scope') || query.has('slot'))) {
    const requested = query.get('scope') ?? 'channel';
    const scope = requested.startsWith('category:') ? requested : 'channel';
    const label = scope === 'channel' ? '频道提示词' : '栏目提示词';
    const ancestors = [studio, { label: '提示词', href: path }];
    return query.has('slot')
      ? [...ancestors, { label, href: `${path}?${new URLSearchParams({ scope })}` }, { label: '提示词槽位' }]
      : [...ancestors, { label }];
  }
  return [studio, { label: pages[path] ?? '工作室' }];
}
