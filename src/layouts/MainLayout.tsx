/**
 * 主端布局：侧边导航 + 顶部工具栏 + 内容区
 */
import { Suspense, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import RouteSuspense from '@/components/RouteSuspense';
import {
  Badge,
  Drawer,
  Dropdown,
  Empty,
  Input,
  Layout,
  List,
  Menu,
  Popover,
  Select,
  Space,
  Typography,
  Avatar,
  Button,
  Tag,
  Divider,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  AppstoreOutlined,
  BellOutlined,
  DashboardOutlined,
  FileTextOutlined,
  GlobalOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  MoonOutlined,
  ProfileOutlined,
  SettingOutlined,
  ShopOutlined,
  SolutionOutlined,
  SunOutlined,
  SwapOutlined,
  ToolOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useUIStore } from '@/store/useUIStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useInquiryStore } from '@/store/useInquiryStore';
import { InquiryStatus, type Permission } from '@/types';
import { formatDateTime } from '@/utils/format';
import { changeLanguage } from '@/i18n';
import { useThemeStore } from '@/store/useThemeStore';
import GlobalSearch from '@/components/GlobalSearch';
import { useIsMobile } from '@/utils/useIsMobile';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

type MenuItem = Required<MenuProps>['items'][number];

/** 按权限构建菜单（W4 RBAC + B1 i18n） */
function buildMenuItems(
  hasPermission: (p: Permission) => boolean,
  t: (key: string) => string,
): MenuItem[] {
  const items: MenuItem[] = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: t('menu.dashboard') },
  ];
  // 询价管理组
  if (hasPermission('INQUIRY_CREATE') || hasPermission('INQUIRY_EDIT')) {
    const children: MenuItem[] = [
      { key: '/inquiry/list', label: t('menu.inquiryList') },
    ];
    if (hasPermission('INQUIRY_CREATE')) {
      children.push({ key: '/inquiry/create', label: t('menu.createInquiry') });
    }
    items.push({
      key: 'inquiry-group',
      icon: <FileTextOutlined />,
      label: t('menu.inquiry'),
      children,
    });
  }
  // 报价管理组（含审批）
  const quotationChildren: MenuItem[] = [
    { key: '/quotation/pending', label: t('menu.quotationPending') },
    { key: '/quotation/compare', label: t('menu.quotationCompare') },
  ];
  if (hasPermission('INQUIRY_APPROVE')) {
    quotationChildren.push({ key: '/approval', label: t('menu.approval') });
  }
  items.push({
    key: 'quotation-group',
    icon: <SolutionOutlined />,
    label: t('menu.quotation'),
    children: quotationChildren,
  });
  // 通知中心（所有人可见）
  items.push({ key: '/notification', icon: <BellOutlined />, label: t('menu.notification') });
  // 供应商/物料/日志/设置
  if (hasPermission('SUPPLIER_MANAGE') || hasPermission('SUPPLIER_DISABLE')) {
    items.push({ key: '/supplier', icon: <ShopOutlined />, label: t('menu.supplier') });
  }
  if (hasPermission('MATERIAL_MANAGE')) {
    items.push({ key: '/material', icon: <AppstoreOutlined />, label: t('menu.material') });
  }
  if (hasPermission('VIEW_LOG')) {
    items.push({ key: '/log', icon: <ProfileOutlined />, label: t('menu.log') });
  }
  if (hasPermission('SETTINGS_MANAGE')) {
    items.push({ key: '/settings', icon: <SettingOutlined />, label: t('menu.settings') });
  }
  return items;
}

/** 根据路径计算当前选中菜单与展开的分组 */
function useMenuState(pathname: string) {
  const selectedKey = useMemo(() => {
    if (pathname.startsWith('/inquiry/create')) return '/inquiry/create';
    if (pathname.startsWith('/inquiry')) return '/inquiry/list';
    if (pathname.startsWith('/quotation/compare')) return '/quotation/compare';
    if (pathname.startsWith('/quotation')) return '/quotation/pending';
    if (pathname.startsWith('/approval')) return '/approval';
    if (pathname.startsWith('/notification')) return '/notification';
    if (pathname.startsWith('/supplier')) return '/supplier';
    if (pathname.startsWith('/material')) return '/material';
    if (pathname.startsWith('/log')) return '/log';
    if (pathname.startsWith('/settings')) return '/settings';
    return '/dashboard';
  }, [pathname]);

  const defaultOpenKeys = useMemo<string[]>(() => {
    const keys: string[] = [];
    if (pathname.startsWith('/inquiry')) keys.push('inquiry-group');
    if (pathname.startsWith('/quotation') || pathname.startsWith('/approval')) keys.push('quotation-group');
    return keys;
  }, [pathname]);

  return { selectedKey, defaultOpenKeys };
}

export default function MainLayout() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { collapsed, toggleCollapsed, setCollapsed, currentOrganization, setCurrentOrganization } =
    useUIStore();
  const themeMode = useThemeStore((s) => s.mode);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const { selectedKey, defaultOpenKeys } = useMenuState(location.pathname);

  // W4：认证与权限
  const currentUser = useAuthStore((s) => s.currentUser);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const logout = useAuthStore((s) => s.logout);
  const switchUser = useAuthStore((s) => s.switchUser);
  const users = useAuthStore((s) => s.users);
  const organizations = useAuthStore((s) => s.organizations);
  const isAdmin = hasPermission('VIEW_ALL_ORG');
  const menuItems = useMemo(() => buildMenuItems(hasPermission, t), [hasPermission, t]);

  // 通知中心：真实数据（B7）
  const notifications = useNotificationStore((s) => s.notifications);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const unreadCount = notifications.filter((n) => !n.read).length;
  // 待处理询价数（询价中/部分已报价）作为消息图标 Badge
  const pendingInquiryCount = useInquiryStore(
    (s) =>
      s.inquiries.filter(
        (i) => i.status === InquiryStatus.INQUIRING || i.status === InquiryStatus.PARTIAL_QUOTED,
      ).length,
  );
  const messageCount = pendingInquiryCount + unreadCount;
  const [openKeys, setOpenKeys] = useState<string[]>(defaultOpenKeys);
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 响应式：移动端（< 768px）使用 Drawer 抽屉式侧边栏（B7 改用 useIsMobile hook）
  const isMobile = useIsMobile();
  useEffect(() => {
    if (isMobile) setCollapsed(true);
  }, [isMobile, setCollapsed]);

  // 桌面端：窗口宽度 < 1024 自动折叠侧边栏
  useEffect(() => {
    if (!isMobile && window.innerWidth < 1024) setCollapsed(true);
  }, [setCollapsed, isMobile]);

  const onMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key.startsWith('/')) {
      navigate(key);
      if (isMobile) setDrawerOpen(false);
    }
  };

  // 用户下拉菜单（W4：角色展示 + 切换用户 + 退出登录 + B1 i18n）
  const userMenuItems: MenuProps['items'] = useMemo(() => {
    const items: MenuProps['items'] = [
      {
        key: 'info',
        disabled: true,
        label: (
          <div style={{ padding: '4px 0' }}>
            <div style={{ fontWeight: 600 }}>{currentUser.name}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
              {currentUser.department} · {currentUser.organization}
            </div>
            <Tag color="purple" style={{ marginTop: 6 }}>
              {t(`enum.role.${currentUser.role}`)}
            </Tag>
          </div>
        ),
      },
      { type: 'divider' },
      { key: 'profile', icon: <UserOutlined />, label: t('common.user') },
      { key: 'settings', icon: <SettingOutlined />, label: t('menu.settings'), onClick: () => navigate('/settings') },
      { type: 'divider' },
    ];
    // 切换用户子菜单（演示用）
    const switchChildren: MenuProps['items'] = users
      .filter((u) => u.id !== currentUser.id)
      .map((u) => ({
        key: `switch-${u.id}`,
        label: `${u.name}（${t(`enum.role.${u.role}`)}）`,
        onClick: () => {
          switchUser(u.id);
          navigate('/dashboard');
        },
      }));
    items.push({
      key: 'switch-user',
      icon: <SwapOutlined />,
      label: t('common.more'),
      children: switchChildren,
    });
    items.push({ type: 'divider' });
    items.push({
      key: 'logout',
      icon: <LogoutOutlined />,
      label: t('common.logout'),
      danger: true,
      onClick: () => {
        logout();
        navigate('/login', { replace: true });
      },
    });
    return items;
  }, [currentUser, logout, navigate, switchUser, users, t]);

  // 语言切换菜单（B1）
  const langMenuItems: MenuProps['items'] = useMemo(
    () => [
      { key: 'zh-CN', label: '中文', onClick: () => changeLanguage('zh-CN') },
      { key: 'en-US', label: 'English', onClick: () => changeLanguage('en-US') },
    ],
    [],
  );

  // 通知内容（真实数据 + 点击跳转 + 全部已读 + 查看全部 + B1 i18n）
  const notificationContent = (
    <div style={{ width: 340 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '4px 0 8px',
        }}
      >
        <Text strong>{t('notification.title')}</Text>
        {unreadCount > 0 && (
          <Button type="link" size="small" onClick={markAllRead}>
            {t('notification.markAllRead')}
          </Button>
        )}
      </div>
      <List
        size="small"
        dataSource={notifications.slice(0, 10)}
        locale={{
          emptyText: <Empty description={t('notification.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />,
        }}
        renderItem={(n) => (
          <List.Item
            style={{
              background: n.read ? 'transparent' : 'var(--color-primary-bg)',
              cursor: 'pointer',
              padding: '8px 12px',
              borderRadius: 4,
            }}
            onClick={() => {
              markRead(n.id);
              if (n.inquiryId) navigate(`/inquiry/detail/${n.inquiryId}`);
            }}
          >
            <List.Item.Meta
              title={<Text strong={!n.read}>{n.title}</Text>}
              description={
                <>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {formatDateTime(n.time)}
                  </Text>
                  {n.content && (
                    <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                      {n.content}
                    </Text>
                  )}
                </>
              }
            />
          </List.Item>
        )}
      />
      <Divider style={{ margin: '8px 0' }} />
      <div style={{ textAlign: 'center' }}>
        <Button type="link" size="small" onClick={() => navigate('/notification')}>
          {t('notification.title')}
        </Button>
      </div>
    </div>
  );

  // 侧边栏内容（Sider 和 Drawer 共用）
  const sidebarContent = (
    <>
      <div
        style={{
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontWeight: 600,
          fontSize: collapsed ? 14 : 16,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        <ToolOutlined style={{ marginRight: collapsed ? 0 : 8 }} />
        {!collapsed && t('login.title')}
      </div>
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[selectedKey]}
        openKeys={openKeys}
        onOpenChange={(keys) => setOpenKeys(keys)}
        onClick={onMenuClick}
        items={menuItems}
      />
    </>
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {isMobile ? (
        <Drawer
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          width={220}
          styles={{ body: { padding: 0, background: '#001529' } }}
          closable={false}
        >
          {sidebarContent}
        </Drawer>
      ) : (
        <Sider
          trigger={null}
          collapsible
          collapsed={collapsed}
          width={220}
          style={{ overflow: 'auto', height: '100vh', position: 'sticky', top: 0 }}
        >
          {sidebarContent}
        </Sider>
      )}

      <Layout>
        <Header
          style={{
            padding: '0 16px',
            background: 'var(--color-card)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--color-border)',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <Space size="middle">
            <Button
              type="text"
              icon={isMobile ? (drawerOpen ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />) : (collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />)}
              onClick={() => {
                if (isMobile) setDrawerOpen(!drawerOpen);
                else toggleCollapsed();
              }}
            />
            <Select
              value={currentOrganization}
              onChange={setCurrentOrganization}
              style={{ width: 180 }}
              options={
                isAdmin
                  ? [
                      { label: t('common.all'), value: '__ALL__' },
                      ...organizations.map((o) => ({ label: o, value: o })),
                    ]
                  : organizations.map((o) => ({ label: o, value: o }))
              }
            />
          </Space>

          <Input.Search
            placeholder={t('globalSearch.placeholder')}
            className="mobile-hide"
            style={{ maxWidth: 360, width: '32vw', minWidth: 200 }}
            enterButton
            readOnly
            onClick={() => setSearchOpen(true)}
            onSearch={() => setSearchOpen(true)}
          />

          <Space size="large">
            <Dropdown menu={{ items: langMenuItems }} placement="bottomRight">
              <Button type="text" icon={<GlobalOutlined style={{ fontSize: 16 }} />}>
                <span className="mobile-hide">{i18n.language === 'en-US' ? 'EN' : '中'}</span>
              </Button>
            </Dropdown>
            <Button
              type="text"
              icon={themeMode === 'dark' ? <SunOutlined style={{ fontSize: 16 }} /> : <MoonOutlined style={{ fontSize: 16 }} />}
              onClick={toggleTheme}
              aria-label={themeMode === 'dark' ? t('common.switchToLight') : t('common.switchToDark')}
            />
            <Badge count={messageCount} size="small" overflowCount={99}>
              <MessageOutlined style={{ fontSize: 18, cursor: 'pointer' }} />
            </Badge>
            <Popover
              content={notificationContent}
              trigger="click"
              placement="bottomRight"
            >
              <Badge count={unreadCount} size="small" overflowCount={99}>
                <BellOutlined style={{ fontSize: 18, cursor: 'pointer' }} />
              </Badge>
            </Popover>
            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              <Space style={{ cursor: 'pointer' }}>
                <Avatar size="small" src={currentUser.avatar} icon={<UserOutlined />} />
                <Text>{currentUser.name}</Text>
              </Space>
            </Dropdown>
          </Space>
        </Header>

        <Content style={{ margin: 0, padding: 24, background: 'var(--color-bg)' }}>
          <Suspense fallback={<RouteSuspense />}>
            <Outlet />
          </Suspense>
        </Content>
      </Layout>
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </Layout>
  );
}
