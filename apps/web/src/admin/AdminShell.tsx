import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  ContentIsland,
  Sidebar,
  SidebarBrand,
  SidebarDrawer,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarIconItem,
  SidebarItem,
  SidebarNav,
  SidebarProvider,
  SidebarToggle,
  SidebarUser,
  ThemeToggle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from '@nocoo/basalt';
import { AppHeader, AppHeaderMenuButton, GitHubLink } from '@nocoo/basalt/components/app-header';
import { AppMain, AppShell, AppSkipLink } from '@nocoo/basalt/components/app-shell';
import { useSidebar } from '@nocoo/basalt/components/sidebar';
import {
  AudioLines,
  AudioWaveform,
  Compass,
  Globe,
  HardDrive,
  Library,
  Palette,
  Plug,
  Search,
  Tags,
} from 'lucide-react';
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { version } from '../../../../package.json';
import { BrandSymbol, Wordmark } from '../brand/Brand';
import { ThemeFavicon } from '../brand/ThemeFavicon';
import { themeStyle, themes } from '../brand/themes';
import { useResolvedThemeId } from '../shared/useResolvedThemeId';
import { errorMessage, sessionDisplayName, sessionInitials } from './model';
import { adminBreadcrumbs } from './navigation.model';
import { EnvironmentSwitch } from './production/EnvironmentSwitch';
import { adminService, type Session } from './service';

type RailVariant = 'desktop' | 'drawer';

interface AdminRailProps {
  variant: RailVariant;
  session: Session;
  onSignOut: () => void;
  onNavigate: (path: string) => void;
  onDismiss?: () => void;
}

function AdminRail({ variant, session, onSignOut, onNavigate, onDismiss }: AdminRailProps) {
  const { themeId, resolved } = useResolvedThemeId();
  const { pathname } = useLocation();
  const { collapsed, peek, peeking } = useSidebar();
  const railCollapsed = collapsed && !(peek && peeking);
  const [basaltDark, setBasaltDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const sync = () => setBasaltDark(document.documentElement.classList.contains('dark'));
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    sync();
    return () => observer.disconnect();
  }, []);
  const isList = pathname === '/admin' || pathname === '/admin/';
  const groups = [
    {
      label: '内容制作',
      items: [
        {
          href: '/admin',
          label: '节目库',
          icon: Library,
          active:
            isList || pathname.startsWith('/admin/episodes/') || pathname.startsWith('/admin/productions/'),
        },
        {
          href: '/admin/categories',
          label: '栏目管理',
          icon: Tags,
          active: pathname.startsWith('/admin/categories'),
        },
        { href: '/admin/channel', label: '提示词', icon: Compass, active: pathname === '/admin/channel' },
        {
          href: '/admin/bumpers',
          label: '贴片库',
          icon: AudioLines,
          active: pathname === '/admin/bumpers',
        },
      ],
    },
    {
      label: '品牌外观',
      items: [
        {
          href: '/admin/appearance',
          label: '品牌外观',
          icon: Palette,
          active: pathname === '/admin/appearance',
        },
        { href: '/admin/seo', label: '搜索与分享', icon: Search, active: pathname === '/admin/seo' },
        {
          href: '/admin/voice-preview',
          label: '音色预览',
          icon: AudioWaveform,
          active: pathname === '/admin/voice-preview',
        },
      ],
    },
    {
      label: '全站设置',
      items: [
        {
          href: '/admin/connections',
          label: '连接管理',
          icon: Plug,
          active: pathname === '/admin/connections',
        },
        { href: '/admin/storage', label: '资源管理', icon: HardDrive, active: pathname === '/admin/storage' },
      ],
    },
  ];
  const displayName = sessionDisplayName(session);
  const avatar = (
    <Avatar className="admin-user-avatar">
      {session.user.avatar ? <AvatarImage src={session.user.avatar} alt={displayName} /> : null}
      <AvatarFallback>{sessionInitials(displayName)}</AvatarFallback>
    </Avatar>
  );
  return (
    <Sidebar resizable={variant === 'desktop'}>
      <SidebarHeader className="admin-rail-header">
        <SidebarBrand
          logo={
            <Link
              className="admin-rail-mark"
              style={resolved ? themeStyle(themeId) : undefined}
              to="/"
              aria-label="his.fm 首页"
            >
              <BrandSymbol />
            </Link>
          }
          name={
            <span
              className="admin-rail-wordmark"
              style={resolved ? { color: basaltDark ? '#fff' : themes[themeId].palette[1] } : undefined}
            >
              <Wordmark />
            </span>
          }
          version={`v${version}`}
          action={
            variant === 'drawer' ? (
              <SidebarToggle mode="dismiss" onDismiss={onDismiss} dismissLabel="关闭导航" />
            ) : (
              <SidebarToggle expandLabel="展开导航" collapseLabel="收起导航" />
            )
          }
        />
      </SidebarHeader>
      <div className="admin-site-action">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size={railCollapsed ? 'icon' : 'default'}
              className={railCollapsed ? undefined : 'admin-site-link'}
              asChild
            >
              <Link to="/" aria-label="访问网站">
                <Globe size={16} strokeWidth={1.5} aria-hidden="true" />
                {!railCollapsed && <span>访问网站</span>}
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">访问网站</TooltipContent>
        </Tooltip>
      </div>
      <SidebarNav aria-label="工作室导航">
        {railCollapsed
          ? groups.flatMap((group) =>
              group.items.map(({ href, label, icon: Icon, active }) => (
                <Tooltip key={href}>
                  <TooltipTrigger asChild>
                    <SidebarIconItem active={active} aria-label={label} onClick={() => onNavigate(href)}>
                      <Icon size={16} strokeWidth={1.5} />
                    </SidebarIconItem>
                  </TooltipTrigger>
                  <TooltipContent side="right">{label}</TooltipContent>
                </Tooltip>
              )),
            )
          : groups.map((group) => (
              <SidebarGroup label={group.label} key={group.label}>
                {group.items.map(({ href, label, icon: Icon, active }) => (
                  <SidebarItem key={href} active={active} onClick={() => onNavigate(href)}>
                    <Icon size={16} strokeWidth={1.5} />
                    <span>{label}</span>
                  </SidebarItem>
                ))}
              </SidebarGroup>
            ))}
      </SidebarNav>
      <SidebarFooter>
        <SidebarUser
          name={displayName}
          email={session.user.email}
          avatar={avatar}
          tooltip={displayName}
          onSignOut={onSignOut}
          signOutLabel="退出登录"
        />
      </SidebarFooter>
    </Sidebar>
  );
}

export function AdminShell({ session, children }: { session: Session; children: ReactNode }) {
  const { themeId, resolved } = useResolvedThemeId();
  const navigate = useNavigate();
  const location = useLocation();
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 1199px)').matches);
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerId = useId();
  const currentBreadcrumb = useRef<HTMLSpanElement>(null);
  const breadcrumbs = adminBreadcrumbs(location.pathname, location.search);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Scroll only the breadcrumb strip after route changes.
  useLayoutEffect(() => {
    const trail = currentBreadcrumb.current?.closest('nav');
    if (trail) trail.scrollLeft = trail.scrollWidth;
  }, [location.pathname, location.search, compact]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1199px)');
    const update = () => {
      setCompact(media.matches);
      setDrawerOpen(false);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  function go(path: string) {
    navigate(path);
    if (compact) setDrawerOpen(false);
  }
  async function logout() {
    if (loggingOut) return;
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
  return (
    <AppShell className="admin-shell">
      {resolved && <ThemeFavicon theme={themeId} />}
      <AppSkipLink>跳至主要内容</AppSkipLink>
      {!compact && (
        <SidebarProvider collapsed={collapsed} onCollapsedChange={setCollapsed}>
          <AdminRail variant="desktop" session={session} onSignOut={logout} onNavigate={go} />
        </SidebarProvider>
      )}
      {compact && (
        <SidebarDrawer
          id={drawerId}
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          returnFocusRef={menuButtonRef}
          title="工作室导航"
          description="访问网站，或选择内容制作、品牌外观与全站设置。"
        >
          <AdminRail
            variant="drawer"
            session={session}
            onSignOut={logout}
            onNavigate={go}
            onDismiss={() => setDrawerOpen(false)}
          />
        </SidebarDrawer>
      )}
      <AppMain tabIndex={-1}>
        <AppHeader
          className="admin-header"
          breadcrumbs={breadcrumbs.map((item, index) => ({
            ...item,
            label:
              index === breadcrumbs.length - 1 ? (
                <span ref={currentBreadcrumb}>{item.label}</span>
              ) : (
                item.label
              ),
          }))}
          breadcrumbsLabel="面包屑导航"
          leading={
            compact ? (
              <AppHeaderMenuButton
                ref={menuButtonRef}
                label="打开导航"
                aria-controls={drawerId}
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen(true)}
              />
            ) : undefined
          }
          actions={
            <>
              {import.meta.env.DEV && <EnvironmentSwitch />}
              <GitHubLink repo="nocoo/his.fm" label="GitHub 仓库" newTabLabel="（在新标签页中打开）" />
              <ThemeToggle aria-label="切换主题" />
            </>
          }
        />
        <div className="admin-island-wrap">
          <ContentIsland className="admin-content-island">{children}</ContentIsland>
        </div>
      </AppMain>
    </AppShell>
  );
}
