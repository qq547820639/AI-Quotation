/**
 * API 层入口（W7.2）
 * 统一导出各模块 API
 */
export { client } from './client';
export { inquiryApi } from './inquiryApi';
export type { BatchItemResult, BatchOperationResult } from './inquiryApi';
export { supplierApi } from './supplierApi';
export { quotationApi } from './quotationApi';
export { materialApi } from './materialApi';
export { authApi } from './authApi';
export { notificationApi } from './notificationApi';
export { settingsApi } from './settingsApi';
export { portalApi } from './portal';
export { usersApi } from './usersApi';
export { searchApi } from './searchApi';
