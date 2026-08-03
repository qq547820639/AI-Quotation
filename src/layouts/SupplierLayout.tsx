/**
 * 供应商报价填报端布局：简洁顶部栏，无完整侧边栏
 */
import { Suspense } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Layout, Space, Typography, Button, Tag } from 'antd';
import { ArrowLeftOutlined, ShopOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useSupplierStore } from '@/store/useSupplierStore';
import RouteSuspense from '@/components/RouteSuspense';
import { useIsMobile } from '@/utils/useIsMobile';

const { Header, Content } = Layout;
const { Title, Text } = Typography;

export default function SupplierLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  // 路由形如 /supplier-portal/:inquiryId/:supplierId
  const segments = location.pathname.split('/').filter(Boolean);
  const supplierId = segments[2] ?? '';
  const supplier = useSupplierStore((s) => s.getSupplierById(supplierId));

  return (
    <Layout style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <Header
        style={{
          background: 'var(--color-card)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: isMobile ? '0 8px' : '0 24px',
          borderBottom: '1px solid var(--color-border)',
          height: 64,
          gap: 8,
        }}
      >
        <Space size={isMobile ? 4 : 8} style={{ minWidth: 0 }}>
          <ShopOutlined style={{ fontSize: isMobile ? 18 : 22, color: 'var(--color-primary)' }} />
          <Title level={4} style={{ margin: 0, fontSize: isMobile ? 15 : undefined, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {t('supplierPortal.platformTitle')}
          </Title>
        </Space>
        <Space size={isMobile ? 4 : 'middle'} wrap={isMobile}>
          {supplier && !isMobile && (
            <>
              <Text type="secondary">{t('supplierPortal.currentSupplier')}</Text>
              <Tag color="blue">{supplier.name}</Tag>
            </>
          )}
          {supplier && isMobile && (
            <Tag color="blue" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {supplier.name}
            </Tag>
          )}
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} size={isMobile ? 'small' : 'middle'}>
            {isMobile ? '' : t('common.back')}
          </Button>
        </Space>
      </Header>
      <Content style={{ padding: isMobile ? 12 : 24 }}>
        <Suspense fallback={<RouteSuspense />}>
          <Outlet />
        </Suspense>
      </Content>
    </Layout>
  );
}
