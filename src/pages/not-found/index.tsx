import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

/** 404 页面 */
export default function NotFoundPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Result
      status="404"
      title="404"
      subTitle={t('errors.notFoundTip')}
      extra={
        <Button type="primary" onClick={() => navigate('/dashboard')}>
          {t('errors.backDashboard')}
        </Button>
      }
    />
  );
}
