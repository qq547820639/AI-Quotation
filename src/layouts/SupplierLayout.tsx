/**
 * 供应商报价填报端布局：简洁顶部栏，无完整侧边栏
 */
import { Suspense } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Layout, Space, Typography, Button } from 'antd';
import { ArrowLeftOutlined, ShopOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import RouteSuspense from '@/components/RouteSuspense';
import { useIsMobile } from '@/utils/useIsMobile';

const { Header, Content } = Layout;
const { Title } = Typography;

export default function SupplierLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

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
          <Title
            level={4}
            style={{
              margin: 0,
              fontSize: isMobile ? 15 : undefined,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {t('supplierPortal.platformTitle')}
          </Title>
        </Space>
        <Space size={isMobile ? 4 : 'middle'} wrap={isMobile}>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate(-1)}
            size={isMobile ? 'small' : 'middle'}
          >
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
