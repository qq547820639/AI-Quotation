import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { appRouter } from '@/router';
import { startDeadlineWatcher } from '@/utils/deadlineWatcher';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useSupplierStore } from '@/store/useSupplierStore';
import { useQuotationStore } from '@/store/useQuotationStore';
import { useMaterialStore } from '@/store/useMaterialStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useEventStream } from '@/hooks/useEventStream';
import { queryClient, QUERY_KEYS } from '@/lib/queryClient';

/**
 * W7.4：应用启动时从 API 加载业务数据
 * - MSW 启用后由 main.tsx 先 await enableMocking() 再渲染，此处 MSW 已就绪
 * - 各 store 的 loadFromApi 自带降级，Promise.allSettled 保证互不阻塞
 */
function bootstrapStores() {
  return Promise.allSettled([
    useInquiryStore.getState().loadFromApi(),
    useSupplierStore.getState().loadFromApi(),
    useQuotationStore.getState().loadFromApi(),
    useMaterialStore.getState().loadFromApi(),
    useNotificationStore.getState().loadFromApi(),
    useSettingsStore.getState().loadFromApi(),
    useAuthStore.getState().loadFromApi(),
  ]);
}

// 应用根组件：渲染路由 + 启动截止监听 + 启动 API 数据加载 + SSE 实时刷新
function App() {
  useEffect(() => {
    startDeadlineWatcher();
    void bootstrapStores();
  }, []);

  // P2-12 Task 17：订阅 SSE 事件，实时刷新未读数与相关查询缓存
  useEventStream((event) => {
    const { type } = event;
    if (type === 'quotation_submitted' || type === 'inquiry_confirmed') {
      useInquiryStore.getState().loadFromApi();
      useQuotationStore.getState().loadFromApi();
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.inquiries });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.quotations });
    }
    if (type === 'notification' || type === 'quotation_submitted') {
      useNotificationStore.getState().refreshUnreadCount();
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notifications });
    }
  });

  return <RouterProvider router={appRouter} />;
}

export default App;
