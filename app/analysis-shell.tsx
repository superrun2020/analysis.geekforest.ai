import { useEffect, useState, type ReactNode } from 'react';
import { Button, Drawer, Dropdown, Grid, Layout, Menu, Tooltip, type MenuProps } from 'antd';
import { BarChartOutlined, CloudOutlined, DashboardOutlined, ExperimentOutlined, MenuFoldOutlined, MenuOutlined, MenuUnfoldOutlined, SafetyOutlined, UserOutlined } from '@ant-design/icons';
import './analysis-shell.css';

type Entry = { key: string; label: string; children?: Entry[] };
const icons: Record<string, ReactNode> = { daily: <DashboardOutlined />, funnel: <BarChartOutlined />, vpn: <SafetyOutlined />, vpnReport: <ExperimentOutlined />, admob: <BarChartOutlined />, firebase: <CloudOutlined /> };
export function AnalysisShell({ children, entries, selectedKey, onNavigate, version, onRefresh, checking, account, onSignOut, embedded = false }: {
 children: ReactNode; entries: Entry[]; selectedKey: string; onNavigate: (key: string) => void; version: string; onRefresh: () => void; checking: boolean; account: string; onSignOut: () => void; embedded?: boolean;
}) {
 const screens = Grid.useBreakpoint();
 const mobile = !screens.md;
 const [collapsed, setCollapsed] = useState(false);
 const [drawer, setDrawer] = useState(false);
 const [openKeys, setOpenKeys] = useState<string[]>(selectedKey.startsWith('diagnostic:') ? ['vpnReport'] : []);
 useEffect(() => { if (selectedKey.startsWith('diagnostic:')) setOpenKeys(['vpnReport']); }, [selectedKey]);
 useEffect(() => { if (!mobile) setDrawer(false); }, [mobile]);
 const items: MenuProps['items'] = entries.map(entry => ({ ...entry, icon: <span aria-hidden="true">{icons[entry.key]}</span> }));
 const navigation = (compact = false) => <Menu aria-label="系统导航" mode="inline" items={items} inlineCollapsed={compact} selectedKeys={[selectedKey]} openKeys={compact ? undefined : openKeys} onOpenChange={setOpenKeys} onClick={({ key }) => { onNavigate(key); setDrawer(false); }} />;
 return <Layout className={`analysis-shell app-shell${embedded ? ' analysis-embedded' : ''}`}>
  {!embedded && !mobile && <Layout.Sider className="analysis-sider" theme="light" width={248} collapsedWidth={64} collapsed={collapsed} trigger={null}>
   <div className="analysis-brand">{collapsed ? 'GF' : 'GeekForest · 分析系统'}</div>
   <div className="analysis-navigation">{navigation(collapsed)}</div>
  </Layout.Sider>}
  <Layout className="analysis-workspace">
   {!embedded && <Layout.Header className="analysis-header">
    <Tooltip title={mobile ? '打开导航菜单' : collapsed ? '展开左侧菜单' : '折叠左侧菜单'}><Button type="text" aria-label={mobile ? '打开导航菜单' : collapsed ? '展开左侧菜单' : '折叠左侧菜单'} icon={mobile ? <MenuOutlined /> : collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => mobile ? setDrawer(true) : setCollapsed(!collapsed)} /></Tooltip>
    <strong className="analysis-header-title">分析系统</strong><span>{version}</span>
    <Button size="small" loading={checking} onClick={onRefresh}>刷新</Button>
    <Dropdown menu={{ items: [{ key: 'logout', label: '退出登录' }], onClick: onSignOut }} trigger={['click']}><Button className="analysis-account" icon={<UserOutlined />} aria-label="账户菜单">{account}</Button></Dropdown>
   </Layout.Header>}
   <Layout.Content className="analysis-content">{children}</Layout.Content>
  </Layout>
  <Drawer destroyOnHidden title="分析系统导航" placement="left" size={288} open={mobile && drawer} onClose={() => setDrawer(false)} styles={{ body: { padding: 0 } }}>{navigation()}</Drawer>
 </Layout>;
}
