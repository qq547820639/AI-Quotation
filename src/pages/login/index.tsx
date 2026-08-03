/**
 * 登录页（W4）
 * - 演示用：选择用户 + 任意密码登录
 * - 已登录访问 /login 自动跳 dashboard
 */
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Card, Form, Input, Select, Space, Typography } from 'antd';
import { LockOutlined, ToolOutlined, UserOutlined } from '@ant-design/icons';
import { useAuthStore } from '@/store/useAuthStore';
import { notifyError } from '@/utils/confirm';
import { useTranslation } from 'react-i18next';

const { Title, Text } = Typography;

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuthStore((s) => s.login);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const users = useAuthStore((s) => s.users);
  const [userId, setUserId] = useState<string>(users[0]?.id ?? '');
  const [password, setPassword] = useState('');

  // 已登录自动跳转
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/dashboard';
  if (isAuthenticated) {
    navigate(from, { replace: true });
    return null;
  }

  const handleLogin = () => {
    if (!userId) {
      notifyError(t('login.selectUserRequired'));
      return;
    }
    if (!password) {
      notifyError(t('login.passwordRequired'));
      return;
    }
    const ok = login(userId);
    if (ok) {
      navigate(from, { replace: true });
    } else {
      notifyError(t('login.loginFailed'));
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, var(--color-primary) 0%, #722ED1 100%)',
      }}
    >
      <Card style={{ width: 400, borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <ToolOutlined style={{ fontSize: 40, color: 'var(--color-primary)' }} />
            <Title level={3} style={{ margin: '12px 0 4px' }}>
              {t('login.shortTitle')}
            </Title>
            <Text type="secondary">{t('login.platformDesc')}</Text>
          </div>
          <Form layout="vertical">
            <Form.Item label={t('login.selectUser')} required>
              <Select
                value={userId}
                onChange={setUserId}
                showSearch
                optionFilterProp="label"
                options={users.map((u) => ({
                  label: `${u.name}（${u.role}·${u.organization}）`,
                  value: u.id,
                }))}
                suffixIcon={<UserOutlined />}
              />
            </Form.Item>
            <Form.Item label={t('login.password')} required>
              <Input.Password
                prefix={<LockOutlined />}
                placeholder={t('login.passwordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onPressEnter={handleLogin}
              />
            </Form.Item>
            <Button type="primary" block size="large" onClick={handleLogin}>
              {t('login.login')}
            </Button>
          </Form>
          <Text type="secondary" style={{ fontSize: 12, textAlign: 'center', display: 'block' }}>
            {t('login.demoTip')}
          </Text>
        </Space>
      </Card>
    </div>
  );
}
