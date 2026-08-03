/**
 * 统一确认弹窗：替代浏览器原生 confirm/alert
 * 关键操作（批量发送、取消、删除、移除、确认供应商、提交报价、结束询价）使用此工具二次确认
 * B1 i18n：命令式 API 用 i18n.t() 直接翻译
 */
import { Modal, message } from 'antd';
import i18n from '@/i18n';

interface ConfirmOptions {
  title: string;
  content?: string;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
  onOk: () => void | Promise<void>;
  /** 取消时的回调（透传至 Modal.confirm） */
  onCancel?: () => void;
}

/** 二次确认弹窗 */
export function confirmAction({
  title,
  content,
  okText,
  cancelText,
  danger = false,
  onOk,
  onCancel,
}: ConfirmOptions): void {
  Modal.confirm({
    title,
    content,
    okText: okText || i18n.t('common.ok'),
    cancelText: cancelText || i18n.t('common.cancel'),
    okType: danger ? 'danger' : 'primary',
    okButtonProps: { danger },
    onOk,
    onCancel,
  });
}

/** 操作成功提示 */
export function notifySuccess(content: string): void {
  message.success(content);
}

/** 操作失败提示 */
export function notifyError(content: string): void {
  message.error(content);
}

/** 警告提示 */
export function notifyWarning(content: string): void {
  message.warning(content);
}

/** 信息提示 */
export function notifyInfo(content: string): void {
  message.info(content);
}
