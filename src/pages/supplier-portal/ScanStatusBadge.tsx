/**
 * 附件安全扫描状态徽标（P0 T3）
 * - 上传后显示"正在进行安全检查"，不直接显示为完全成功
 * - clean 显示已通过安全检查；infected 明确风险；error 显示扫描失败
 * - 支持中英文、图标、非纯颜色表达、ARIA 标签与键盘操作
 * - 不暴露内部扫描器地址/路径/堆栈/敏感签名
 */
import React from 'react';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { Tag, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import type { PortalScanStatus } from './types';

interface Props {
  status?: PortalScanStatus;
  /** 脱敏后的扫描结果说明（可选） */
  scanResult?: string;
}

const STATUS_CONFIG: Record<
  PortalScanStatus,
  { color: string; icon: React.ReactNode; labelKey: string; describedKey: string }
> = {
  pending: {
    color: 'default',
    icon: <StopOutlined aria-hidden />,
    labelKey: 'supplierPortal.scanPending',
    describedKey: 'supplierPortal.scanPendingDesc',
  },
  scanning: {
    color: 'processing',
    icon: <LoadingOutlined aria-hidden />,
    labelKey: 'supplierPortal.scanScanning',
    describedKey: 'supplierPortal.scanScanningDesc',
  },
  clean: {
    color: 'success',
    icon: <CheckCircleOutlined aria-hidden />,
    labelKey: 'supplierPortal.scanClean',
    describedKey: 'supplierPortal.scanCleanDesc',
  },
  infected: {
    color: 'error',
    icon: <CloseCircleOutlined aria-hidden />,
    labelKey: 'supplierPortal.scanInfected',
    describedKey: 'supplierPortal.scanInfectedDesc',
  },
  error: {
    color: 'warning',
    icon: <ExclamationCircleOutlined aria-hidden />,
    labelKey: 'supplierPortal.scanError',
    describedKey: 'supplierPortal.scanErrorDesc',
  },
};

export default function ScanStatusBadge({ status, scanResult }: Props): React.ReactElement | null {
  const { t } = useTranslation();
  if (!status) return null;
  const cfg = STATUS_CONFIG[status];
  if (!cfg) return null;
  const label = t(cfg.labelKey);
  const described = t(cfg.describedKey);
  return (
    <Tooltip title={scanResult ? `${described}：${scanResult}` : described} aria-label={described}>
      <Tag
        color={cfg.color}
        icon={cfg.icon}
        role="status"
        aria-label={label}
        aria-describedby={undefined}
        tabIndex={0}
      >
        {label}
      </Tag>
    </Tooltip>
  );
}
