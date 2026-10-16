import {
  Avatar,
  AvatarFallback,
  AvatarImage,
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
  AudioLines,
  Compass,
  Globe,
  HardDrive,
  Library,
  LogOut,
  Menu,
  Palette,
  PanelLeft,
  Plug,
  Plus,
  Tags,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { version } from '../../../../package.json';
import { BrandSymbol, Wordmark } from '../brand/Brand';
import { GithubIcon } from '../components/GithubIcon';
import { errorMessage, sessionDisplayName, sessionInitials } from './model';
import { EnvironmentSwitch } from './production/EnvironmentSwitch';
import { adminService, type Session } from './service';

export function AdminShell({ session, children }: { session: Session; children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 1199px)').matches);
  const [collapsed, setCollapsed] = useState(compact);
  const [loggingOut, setLoggingOut] = useState(false);
  const restoreNavigationFocus = useRef(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1199px)');
    const update = () => {
      setCompact(media.matches);
      setCollapsed(media.matches);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const iconOnly = collapsed && !compact;
  const isList = location.pathname === '/admin' || location.pathname === '/admin/';
  const catalog = location.pathname.startsWith('/admin/episodes/');
  const settingsTitle: Record<string, string> = {
    '/admin/connections': '连接管理',
    '/admin/bumpers': '贴片库',
  };
  const categories = location.pathname.startsWith('/admin/categories');
  const settings = Boolean(settingsTitle[location.pathname]) || categories;
  const channel = location.pathname === '/admin/channel';
  const appearance = location.pathname === '/admin/appearance';
  const storage = location.pathname === '/admin/storage';
  const creating = location.pathname === '/admin/productions/new';
  const query = new URLSearchParams(location.search);
  const sourceOpen =
    location.pathname.startsWith('/admin/productions/') &&
    query.has('source') &&
    (!query.get('section') || query.get('section') === 'metadata');
  const title = appearance
    ? '品牌外观'
    : sourceOpen
      ? '素材详情'
      : storage
        ? '资源管理'
        : channel
          ? '提示词'
          : isList
            ? '节目库'
            : settings
              ? categories
                ? '栏目管理'
                : (settingsTitle[location.pathname] ?? '工作室')
              : catalog
                ? location.pathname.endsWith('/new')
                  ? '新建节目'
                  : '编辑节目'
                : creating
                  ? '新建节目'
                  : '节目详情';
  function go(path: string) {
    navigate(path);
    if (compact) setCollapsed(true);
  }
  function toggleNavigation() {
    restoreNavigationFocus.current = true;
    setCollapsed(!collapsed);
  }
  function focusNavigationToggle(button: HTMLButtonElement | null) {
    if (!button || !restoreNavigationFocus.current) return;
    restoreNavigationFocus.current = false;
    button.focus({ preventScroll: true });
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
  const displayName = sessionDisplayName(session);
  const avatar = (
    <Avatar className="admin-user-avatar">
      {session.user.avatar ? <AvatarImage src={session.user.avatar} alt={displayName} /> : null}
      <AvatarFallback>{sessionInitials(displayName)}</AvatarFallback>
    </Avatar>
  );
  const groups = [
    {
      label: '内容制作',
      items: [
        {
          href: '/admin',
          label: '节目库',
          icon: Library,
          active: isList || catalog || (location.pathname.startsWith('/admin/productions/') && !creating),
        },
        { href: '/admin/productions/new', label: '新建节目', icon: Plus, active: creating },
        { href: '/admin/categories', label: '栏目管理', icon: Tags, active: categories },
        { href: '/admin/channel', label: '提示词', icon: Compass, active: channel },
        {
          href: '/admin/bumpers',
          label: '贴片库',
          icon: AudioLines,
          active: location.pathname === '/admin/bumpers',
        },
      ],
    },
    {
      label: '品牌外观',
      items: [{ href: '/admin/appearance', label: '品牌外观', icon: Palette, active: appearance }],
    },
    {
      label: '全站设置',
      items: [
        {
          href: '/admin/connections',
          label: '连接管理',
          icon: Plug,
          active: location.pathname === '/admin/connections',
        },
        { href: '/admin/storage', label: '资源管理', icon: HardDrive, active: storage },
      ],
    },
  ];
  return (
    <SidebarProvider collapsed={collapsed} onCollapsedChange={setCollapsed} overlay={compact}>
      <AppShell className="admin-shell">
        <AppSkipLink>跳至主要内容</AppSkipLink>
        <Sidebar>
          {compact && (
            <>
              <DialogTitle className="sr-only">工作室导航</DialogTitle>
              <DialogDescription className="sr-only">
                访问网站，或选择内容制作、品牌外观与全站设置。
              </DialogDescription>
            </>
          )}
          <SidebarHeader className="admin-rail-header">
            <Link className="admin-rail-mark" to="/" aria-label="his.fm 首页">
              <BrandSymbol />
            </Link>
            {!iconOnly && (
              <>
                <div className="admin-brand-meta">
                  <span className="admin-brand" role="img" aria-label="his.fm">
                    <Wordmark />
                  </span>
                  <span className="admin-version">v{version}</span>
                </div>
                {!compact && (
                  <Button
                    ref={focusNavigationToggle}
                    className="admin-collapse"
                    size="icon"
                    variant="ghost"
                    aria-label="收起导航"
                    onClick={toggleNavigation}
                  >
                    <PanelLeft size={16} strokeWidth={1.5} aria-hidden="true" />
                  </Button>
                )}
              </>
            )}
          </SidebarHeader>
          {iconOnly && (
            <Button
              ref={focusNavigationToggle}
              className="admin-expand"
              size="icon"
              variant="ghost"
              aria-label="展开导航"
              onClick={toggleNavigation}
            >
              <PanelLeft size={16} strokeWidth={1.5} aria-hidden="true" />
            </Button>
          )}
          <div className="admin-site-action">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size={iconOnly ? 'icon' : 'default'}
                  className={iconOnly ? undefined : 'admin-site-link'}
                  asChild
                >
                  <Link to="/" aria-label="访问网站">
                    <Globe size={16} strokeWidth={1.5} aria-hidden="true" />
                    {!iconOnly && <span>访问网站</span>}
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">访问网站</TooltipContent>
            </Tooltip>
          </div>
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
          <SidebarFooter className="admin-sidebar-footer">
            {iconOnly ? (
              <div className="admin-sidebar-footer-compact">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="admin-sidebar-avatar-only">{avatar}</span>
                  </TooltipTrigger>
                  <TooltipContent side="right">{displayName}</TooltipContent>
                </Tooltip>
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
              </div>
            ) : (
              <SidebarUser
                name={displayName}
                email={session.user.email}
                avatar={
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="admin-sidebar-avatar-only">{avatar}</span>
                    </TooltipTrigger>
                    <TooltipContent side="right">{displayName}</TooltipContent>
                  </Tooltip>
                }
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
                    ...(!compact ? [{ label: '节目库', href: '/admin' }] : []),
                    { label: '资料与素材', href: `${location.pathname}?section=metadata` },
                  ]
                : isList || settings || channel || appearance || storage
                  ? []
                  : [
                      {
                        label: '节目库',
                        href: '/admin',
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
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant="ghost" asChild>
                      <a
                        href="https://github.com/nocoo/his.fm"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="GitHub 仓库"
                      >
                        <GithubIcon size={16} strokeWidth={1.5} aria-hidden="true" />
                      </a>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>GitHub 仓库</TooltipContent>
                </Tooltip>
                <ThemeToggle aria-label="切换主题" />
              </>
            }
          />
          <div className="admin-island-wrap">
            <ContentIsland className="admin-content-island">{children}</ContentIsland>
          </div>
        </AppMain>
      </AppShell>
    </SidebarProvider>
  );
}
