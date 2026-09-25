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
  AudioLines,
  Compass,
  GitBranch,
  HardDrive,
  Headphones,
  Library,
  LogOut,
  Menu,
  Mic2,
  PanelLeft,
  Plus,
  Settings,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { version } from '../../package.json';
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
  const settings = location.pathname === '/admin/settings';
  const channel = location.pathname === '/admin/channel';
  const storage = location.pathname === '/admin/storage';
  const voiceReference = location.pathname === '/admin/voices';
  const creating = location.pathname === '/admin/productions/new';
  const title = storage
    ? '资源管理'
    : channel
      ? '频道定位'
      : isList
        ? '制作中的节目'
        : voiceReference
          ? '音色参考'
          : settings
            ? '工作室设置'
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
  const items = [
    {
      href: '/admin',
      label: '制作中的节目',
      icon: Mic2,
      active: isList || (!catalog && !settings && !creating && !voiceReference && !channel && !storage),
    },
    { href: '/admin/catalog', label: '节目目录', icon: Library, active: catalog },
    {
      href: '/admin/productions/new',
      label: '新建制作',
      icon: Plus,
      active: creating,
    },
    { href: '/admin/settings', label: '工作室设置', icon: Settings, active: settings },
    { href: '/admin/channel', label: '频道定位', icon: Compass, active: channel },
    { href: '/admin/voices', label: '音色参考', icon: Headphones, active: voiceReference },
    { href: '/admin/storage', label: '资源管理', icon: HardDrive, active: storage },
  ];
  return (
    <SidebarProvider collapsed={collapsed} onCollapsedChange={setCollapsed} overlay={compact}>
      <AppShell className="admin-shell">
        <AppSkipLink>跳至主要内容</AppSkipLink>
        <Sidebar>
          {compact && (
            <>
              <DialogTitle className="sr-only">工作室导航</DialogTitle>
              <DialogDescription className="sr-only">选择节目制作、节目目录或工作室设置。</DialogDescription>
            </>
          )}
          <SidebarHeader>
            <Link className="admin-rail-mark" to="/" aria-label="his.fm 首页">
              <AudioLines size={22} strokeWidth={1.5} />
            </Link>
            {!iconOnly && (
              <>
                <strong className="admin-brand">his.fm</strong>
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
            {!iconOnly && <SidebarPartition>内容工作室</SidebarPartition>}
            <div className={iconOnly ? 'admin-nav-icons' : 'admin-nav-items'}>
              {items.map(({ href, label, icon: Icon, active }) =>
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
              isList ||
              settings ||
              channel ||
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
                <Button variant="ghost" size="icon" aria-label="打开导航" onClick={() => setCollapsed(false)}>
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
          <div className="admin-island-wrap">
            <ContentIsland>{children}</ContentIsland>
          </div>
        </AppMain>
      </AppShell>
    </SidebarProvider>
  );
}
