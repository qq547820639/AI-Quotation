/**
 * 403 无权限页（W4）
 */
import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function ForbiddenPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Result
      status="403"
      title="403"
      subTitle={t('errors.forbiddenTip')}
      extra={
        <Button type="primary" onClick={() => navigate('/dashboard')}>
          {t('errors.backHome')}
        </Button>
      }
    />
  );
}
