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
import { IS_DEMO_MODE } from '@/config';

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
  const [submitting, setSubmitting] = useState(false);

  // 已登录自动跳转
  // 优先取 401 回跳地址（redirect_after_login），其次路由 state.from，最后默认工作台
  const from =
    (location.state as { from?: { pathname: string } } | null)?.from?.pathname ??
    localStorage.getItem('redirect_after_login') ??
    '/dashboard';
  if (isAuthenticated) {
    localStorage.removeItem('redirect_after_login');
    navigate(from, { replace: true });
    return null;
  }

  const handleLogin = async () => {
    if (!userId) {
      notifyError(t('login.selectUserRequired'));
      return;
    }
    if (!password && !IS_DEMO_MODE) {
      notifyError(t('login.passwordRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const ok = await login(userId, password);
      if (ok) {
        const target = localStorage.getItem('redirect_after_login') ?? from;
        localStorage.removeItem('redirect_after_login');
        navigate(target, { replace: true });
      } else {
        notifyError(t('login.loginFailed'));
      }
    } finally {
      setSubmitting(false);
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
                aria-label={t('login.selectUser')}
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
            <Button type="primary" block size="large" onClick={handleLogin} loading={submitting}>
              {t('login.login')}
            </Button>
          </Form>
          <Text type="secondary" style={{ fontSize: 12, textAlign: 'center', display: 'block' }}>
            {IS_DEMO_MODE ? t('login.demoTip') : t('login.prodTip')}
          </Text>
        </Space>
      </Card>
    </div>
  );
}
