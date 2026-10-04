import {
  Button,
  ContentIsland,
  DialogDescription,
  DialogTitle,
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarIconItem,
  SidebarItem,
  SidebarNav,
  SidebarPartition,
  SidebarProvider,
  SidebarUser,
  ThemeToggle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from '@nocoo/basalt';
import { AppHeader } from '@nocoo/basalt/components/app-header';
import { AppMain, AppShell, AppSkipLink } from '@nocoo/basalt/components/app-shell';
import {
  ArrowUpRight,
  Compass,
  GitBranch,
  HardDrive,
  Headphones,
  Library,
  LogOut,
  Menu,
  Mic2,
  Palette,
  PanelLeft,
  Plus,
  Settings,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { version } from '../../../../package.json';
import { BrandSymbol, Wordmark } from '../brand/Brand';
import { AgentProvider } from './agent/AgentProvider';
import { AgentSidebar } from './agent/AgentSidebar';
import { errorMessage } from './model';
import { EnvironmentSwitch } from './production/EnvironmentSwitch';
import { adminService, type Session } from './service';

export function AdminShell({ session, children }: { session: Session; children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const [collapsed, setCollapsed] = useState(compact);
  const [loggingOut, setLoggingOut] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => {
      setCompact(media.matches);
      setCollapsed(media.matches);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const iconOnly = collapsed && !compact;
  const isList = location.pathname === '/admin' || location.pathname === '/admin/';
  const catalog = location.pathname === '/admin/catalog' || location.pathname.startsWith('/admin/episodes/');
  const settingsTitle: Record<string, string> = {
    '/admin/ai': 'AI 设置',
    '/admin/connections': '连接管理',
    '/admin/narration': '旁白风格',
    '/admin/bumpers': '贴片库',
  };
  const settings = Boolean(settingsTitle[location.pathname]);
  const channel = location.pathname === '/admin/channel';
  const appearance = location.pathname === '/admin/appearance';
  const storage = location.pathname === '/admin/storage';
  const voiceReference = location.pathname === '/admin/voices';
  const creating = location.pathname === '/admin/productions/new';
  const query = new URLSearchParams(location.search);
  const sourceOpen =
    location.pathname.startsWith('/admin/productions/') &&
    query.has('source') &&
    (!query.get('step') || query.get('step') === 'brief');
  const title = appearance
    ? '品牌外观'
    : sourceOpen
      ? '素材详情'
      : storage
        ? '资源管理'
        : channel
          ? '全局提示词'
          : isList
            ? '制作中的节目'
            : voiceReference
              ? '音色参考'
              : settings
                ? (settingsTitle[location.pathname] ?? '工作室')
                : catalog
                  ? location.pathname === '/admin/catalog'
                    ? '节目目录'
                    : location.pathname.endsWith('/new')
                      ? '新建节目'
                      : '编辑节目'
                  : creating
                    ? '新建制作'
                    : '节目制作';
  function go(path: string) {
    navigate(path);
    if (compact) setCollapsed(true);
  }
  async function logout() {
    setLoggingOut(true);
    try {
      await adminService.logout();
      if (session.mode === 'access') window.location.assign('/cdn-cgi/access/logout');
      else navigate('/login');
    } catch (cause) {
      toast.error(errorMessage(cause));
      setLoggingOut(false);
    }
  }
  const groups = [
    {
      label: '节目制作',
      items: [
        {
          href: '/admin',
          label: '制作中的节目',
          icon: Mic2,
          active:
            isList ||
            (!catalog && !settings && !creating && !voiceReference && !channel && !storage && !appearance),
        },
        { href: '/admin/catalog', label: '节目目录', icon: Library, active: catalog },
        { href: '/admin/productions/new', label: '新建制作', icon: Plus, active: creating },
      ],
    },
    {
      label: '素材与声音',
      items: [
        { href: '/admin/storage', label: '资源管理', icon: HardDrive, active: storage },
        { href: '/admin/voices', label: '音色参考', icon: Headphones, active: voiceReference },
      ],
    },
    {
      label: '工作室',
      items: [
        { href: '/admin/channel', label: '全局提示词', icon: Compass, active: channel },
        { href: '/admin/appearance', label: '品牌外观', icon: Palette, active: appearance },
        ...Object.entries(settingsTitle).map(([href, label]) => ({
          href,
          label,
          icon: Settings,
          active: location.pathname === href,
        })),
      ],
    },
  ];
  return (
    <AgentProvider>
      <SidebarProvider collapsed={collapsed} onCollapsedChange={setCollapsed} overlay={compact}>
        <AppShell className="admin-shell">
          <AppSkipLink>跳至主要内容</AppSkipLink>
          <Sidebar>
            {compact && (
              <>
                <DialogTitle className="sr-only">工作室导航</DialogTitle>
                <DialogDescription className="sr-only">
                  选择节目制作、节目目录或工作室设置。
                </DialogDescription>
              </>
            )}
            <SidebarHeader>
              <Link className="admin-rail-mark" to="/" aria-label="his.fm 首页">
                <BrandSymbol />
              </Link>
              {!iconOnly && (
                <>
                  <span className="admin-brand" role="img" aria-label="his.fm">
                    <Wordmark />
                  </span>
                  <span className="admin-version">v{version}</span>
                </>
              )}
            </SidebarHeader>
            {!compact && (
              <div className="admin-collapse">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={collapsed ? '展开导航' : '收起导航'}
                  onClick={() => setCollapsed(!collapsed)}
                >
                  <PanelLeft size={16} strokeWidth={1.5} />
                </Button>
              </div>
            )}
            <SidebarNav aria-label="工作室导航">
              {groups.map((group) => (
                <section className="admin-nav-group" aria-label={group.label} key={group.label}>
                  {!iconOnly && <SidebarPartition>{group.label}</SidebarPartition>}
                  <div className={iconOnly ? 'admin-nav-icons' : 'admin-nav-items'}>
                    {group.items.map(({ href, label, icon: Icon, active }) =>
                      iconOnly ? (
                        <Tooltip key={href}>
                          <TooltipTrigger asChild>
                            <SidebarIconItem active={active} aria-label={label} onClick={() => go(href)}>
                              <Icon size={16} strokeWidth={1.5} />
                            </SidebarIconItem>
                          </TooltipTrigger>
                          <TooltipContent side="right">{label}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <SidebarItem key={href} active={active} onClick={() => go(href)}>
                          <Icon size={16} strokeWidth={1.5} />
                          <span>{label}</span>
                        </SidebarItem>
                      ),
                    )}
                  </div>
                </section>
              ))}
            </SidebarNav>
            <SidebarFooter>
              {iconOnly ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      loading={loggingOut}
                      aria-label="退出登录"
                      onClick={logout}
                    >
                      <LogOut size={16} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">退出登录</TooltipContent>
                </Tooltip>
              ) : (
                <SidebarUser
                  name="his.fm 编辑"
                  email={session.user.email}
                  avatar={<div className="admin-avatar">h.</div>}
                  action={
                    <Button
                      size="icon"
                      variant="ghost"
                      loading={loggingOut}
                      aria-label="退出登录"
                      onClick={logout}
                    >
                      <LogOut size={16} strokeWidth={1.5} />
                    </Button>
                  }
                />
              )}
            </SidebarFooter>
          </Sidebar>
          <AppMain tabIndex={-1}>
            <AppHeader
              title={title}
              breadcrumbs={
                sourceOpen
                  ? [
                      ...(!compact ? [{ label: '制作中的节目', href: '/admin' }] : []),
                      { label: '选题', href: `${location.pathname}?step=brief` },
                    ]
                  : isList ||
                      settings ||
                      channel ||
                      appearance ||
                      storage ||
                      voiceReference ||
                      location.pathname === '/admin/catalog'
                    ? []
                    : [
                        {
                          label: catalog ? '节目目录' : '制作中的节目',
                          href: catalog ? '/admin/catalog' : '/admin',
                        },
                      ]
              }
              leading={
                compact ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="打开导航"
                    onClick={(event) => {
                      event.currentTarget.focus({ preventScroll: true });
                      setCollapsed(false);
                    }}
                  >
                    <Menu size={18} />
                  </Button>
                ) : undefined
              }
              actions={
                <>
                  {import.meta.env.DEV && <EnvironmentSwitch />}
                  <Button size="sm" variant="ghost" className="admin-view-site" asChild>
                    <Link to="/">
                      查看网站
                      <ArrowUpRight size={14} />
                    </Link>
                  </Button>
                  <Button size="icon" variant="ghost" asChild>
                    <a
                      href="https://github.com/nocoo/his.fm"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="GitHub 仓库"
                    >
                      <GitBranch size={16} />
                    </a>
                  </Button>
                  <ThemeToggle aria-label="切换主题" />
                </>
              }
            />
            <div className="admin-workspace">
              <div className="admin-island-wrap">
                <ContentIsland className="admin-content-island">{children}</ContentIsland>
              </div>
              <AgentSidebar />
            </div>
          </AppMain>
        </AppShell>
      </SidebarProvider>
    </AgentProvider>
  );
}
