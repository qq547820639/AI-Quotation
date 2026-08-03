/**
 * Web Vitals 采集（P5.2）
 * 采集 CLS/LCP/FCP/TTFB/INP 五项核心指标，通过 sendBeacon 上报
 * 若 Sentry 已初始化，同时上报到 Sentry
 */
import type { Metric } from 'web-vitals';

const REPORT_URL = '/api/metrics';

function report(metric: Metric) {
  // Sentry 上报（若已初始化）
  const Sentry = (window as unknown as { Sentry?: { captureMessage: (msg: string) => void } }).Sentry;
  if (Sentry) {
    Sentry.captureMessage(`WebVital:${metric.name}=${metric.value.toFixed(2)}`);
  }

  // sendBeacon 上报（若支持）
  if (navigator.sendBeacon) {
    const body = JSON.stringify({
      name: metric.name,
      value: metric.value,
      id: metric.id,
      delta: metric.delta,
      rating: metric.rating,
    });
    navigator.sendBeacon(REPORT_URL, body);
  }
}

export async function initWebVitals() {
  const { onCLS, onLCP, onFCP, onTTFB, onINP } = await import('web-vitals');
  onCLS(report);
  onLCP(report);
  onFCP(report);
  onTTFB(report);
  onINP(report);
}
