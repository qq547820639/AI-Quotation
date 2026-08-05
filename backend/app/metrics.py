"""轻量级进程内指标（不依赖 prometheus_client，避免新增依赖）。

通过线程安全的进程内计数器统计请求/错误/外部调用失败等关键事件，
并通过 GET /api/metrics（JSON）暴露。重启后清零（进程生命周期内有效）。

约定：
- 所有计数器函数为幂等递增；失败打点由调用方在失败路径调用。
- ai/* 与 scanner.py 由其他任务负责，其打点由各自调用方接入。
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict

_lock = threading.Lock()
_START_TIME = time.time()
_counts: dict[str, int] = defaultdict(int)


def _inc(name: str, n: int = 1) -> None:
    with _lock:
        _counts[name] += n


def _set_gauge(name: str, value: int) -> None:
    with _lock:
        _counts[name] = value


# ============ 请求指标 ============

def request_total() -> None:
    """累计总请求数（在 log_requests 中间件每次进入时调用）。"""
    _inc("request_total")


def request_error_total() -> None:
    """累计错误请求数（status >= 400 或未捕获异常）。"""
    _inc("request_error_total")


# ============ 外部依赖失败指标 ============

def ai_call_total() -> None:
    """累计 AI 调用总数（由 ai/* 调用方负责打点）。"""
    _inc("ai_call_total")


def ai_call_failure_total() -> None:
    """累计 AI 调用失败数（由 ai/* 调用方负责打点）。"""
    _inc("ai_call_failure_total")


def email_fail_total() -> None:
    """累计邮件发送失败数（EmailNotifier 失败路径打点）。"""
    _inc("email_fail_total")


def scan_fail_total() -> None:
    """累计附件扫描失败数（由 scanner.py 调用方负责打点）。"""
    _inc("scan_fail_total")


def queue_backlog_gauge(value: int) -> None:
    """设置队列积压量（Gauge，瞬时值）。"""
    _set_gauge("queue_backlog_gauge", value)


def task_success_total() -> None:
    """累计后台任务成功数（由任务执行回写路径调用）。"""
    _inc("task_success_total")


def task_fail_total() -> None:
    """累计后台任务失败数（由任务执行失败路径调用）。"""
    _inc("task_fail_total")


def set_metric(name: str, value: int) -> None:
    """写入任意命名指标（Gauge，瞬时值）。

    供 scrape 端（GET /api/metrics）将从 DB 派生统计（队列积压/任务失败/AI 调用/扫描失败）
    写入进程内指标，使运维端点一次性暴露全部可观测数据。
    """
    _set_gauge(name, value)


# ============ 请求延迟直方图（Prometheus 风格，有界内存） ============

_LATENCY_BUCKETS_MS = [10, 50, 100, 250, 500, 1000, 5000]
_latency_buckets: dict[str, int] = defaultdict(int)  # bucket 上界 -> 累计计数（含 "+Inf"）
_latency_sum_ms = 0.0
_latency_count = 0


def record_request_duration_ms(ms: float) -> None:
    """记录单次请求耗时（毫秒），写入直方图桶与累计和/计数。"""
    global _latency_sum_ms, _latency_count
    with _lock:
        _latency_sum_ms += ms
        _latency_count += 1
        for b in _LATENCY_BUCKETS_MS:
            if ms <= b:
                _latency_buckets[str(b)] += 1
        _latency_buckets["+Inf"] += 1


def get_metrics() -> dict:
    """返回当前全部指标（含进程运行时长与请求延迟直方图）。"""
    with _lock:
        data = dict(_counts)
        latency_buckets = dict(_latency_buckets)
        latency_sum = _latency_sum_ms
        latency_count = _latency_count
    data["uptime_seconds"] = round(time.time() - _START_TIME, 3)
    data["request_duration"] = {
        "count": latency_count,
        "sum_ms": round(latency_sum, 3),
        "avg_ms": round(latency_sum / latency_count, 3) if latency_count else 0,
        "buckets": latency_buckets,
    }
    return data