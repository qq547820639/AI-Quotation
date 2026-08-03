/**
 * 路由配置
 * 主端使用 MainLayout 包裹（RequireAuth 守卫），供应商报价端使用 SupplierLayout
 * 页面组件采用 React.lazy 懒加载，缩小首屏主 chunk 体积
 */
import { lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import MainLayout from '@/layouts/MainLayout';
import SupplierLayout from '@/layouts/SupplierLayout';
import RequireAuth from '@/components/RequireAuth';

// 布局组件保持静态 import（骨架需立即渲染）
// 页面组件懒加载，按需拆分 chunk
const DashboardPage = lazy(() => import('@/pages/dashboard'));
const InquiryListPage = lazy(() => import('@/pages/inquiry/list'));
const InquiryCreatePage = lazy(() => import('@/pages/inquiry/create'));
const InquiryDetailPage = lazy(() => import('@/pages/inquiry/detail'));
const QuotationPendingPage = lazy(() => import('@/pages/quotation/pending'));
const QuotationComparePage = lazy(() => import('@/pages/quotation/compare'));
const ApprovalPage = lazy(() => import('@/pages/approval'));
const NotificationPage = lazy(() => import('@/pages/notification'));
const SupplierPage = lazy(() => import('@/pages/supplier'));
const SupplierDetailPage = lazy(() => import('@/pages/supplier/detail'));
const MaterialPage = lazy(() => import('@/pages/material'));
const LogPage = lazy(() => import('@/pages/log'));
const SettingsPage = lazy(() => import('@/pages/settings'));
const SupplierPortalPage = lazy(() => import('@/pages/supplier-portal'));
const NotFoundPage = lazy(() => import('@/pages/not-found'));
const LoginPage = lazy(() => import('@/pages/login'));
const ForbiddenPage = lazy(() => import('@/pages/forbidden'));

export const appRouter = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/403', element: <ForbiddenPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <MainLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'inquiry/list', element: <InquiryListPage /> },
      { path: 'inquiry/create', element: <InquiryCreatePage /> },
      { path: 'inquiry/edit/:id', element: <InquiryCreatePage /> },
      { path: 'inquiry/detail/:id', element: <InquiryDetailPage /> },
      { path: 'quotation/pending', element: <QuotationPendingPage /> },
      { path: 'quotation/compare', element: <QuotationComparePage /> },
      { path: 'quotation/compare/:inquiryId', element: <QuotationComparePage /> },
      { path: 'approval', element: <ApprovalPage /> },
      { path: 'notification', element: <NotificationPage /> },
      { path: 'supplier', element: <SupplierPage /> },
      { path: 'supplier/:id', element: <SupplierDetailPage /> },
      { path: 'material', element: <MaterialPage /> },
      { path: 'log', element: <LogPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    path: '/supplier-portal/:inquiryId/:supplierId',
    element: <SupplierLayout />,
    children: [{ index: true, element: <SupplierPortalPage /> }],
  },
]);
