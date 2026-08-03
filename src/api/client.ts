/**
 * axios 实例（W7.2）
 * 统一配置 baseURL、请求/响应拦截器
 */
import axios from 'axios';
import { message } from 'antd';

const baseURL = import.meta.env.VITE_API_BASE_URL || '/api';

export const client = axios.create({
  baseURL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器：注入认证 token
client.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('procurement_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// 响应拦截器：统一错误处理
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      const { status, data } = error.response;
      const msg = data?.message || '请求失败';
      if (status === 401) {
        message.error('登录已过期，请重新登录');
        localStorage.removeItem('procurement_token');
      } else if (status === 403) {
        message.error('无权限访问');
      } else {
        message.error(`[${status}] ${msg}`);
      }
    } else if (error.request) {
      message.error('网络异常，请检查网络连接');
    } else {
      message.error(error.message || '未知错误');
    }
    return Promise.reject(error);
  },
);
