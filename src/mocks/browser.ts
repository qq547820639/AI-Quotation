/**
 * MSW 浏览器 Worker（W7.3）
 */
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);
