"""扫描器单元测试：NoopScanner / SanitizingScanner / ClamAVScanner / get_scanner。

不依赖真实 clamd：使用假 socket 模拟 INSTREAM 协议，或直接测 SanitizingScanner 的静态校验逻辑。
"""
import io
import socket
import zipfile

import pytest

from app import config
from app.scanner import (
    ClamAVScanner, NoopScanner, SanitizingScanner, ScanResult, ScanStatus,
    get_scanner, FileScanner,
)


# ============ NoopScanner ============

def test_noop_scanner_returns_clean():
    result = NoopScanner().scan(b"anything", "x.pdf", "application/pdf")
    assert result.status == ScanStatus.CLEAN


# ============ SanitizingScanner ============

class _NoopProbe(FileScanner):
    """记录是否被底层调用，并返回 clean。"""

    def __init__(self):
        self.called = False

    def scan(self, data, filename, mime_type):
        self.called = True
        return ScanResult.clean()


def _scanner():
    probe = _NoopProbe()
    return SanitizingScanner(probe), probe


def test_sanitizing_clean_file_passes_to_inner():
    s, probe = _scanner()
    result = s.scan(b"%PDF-1.4 fake", "报告.pdf", "application/pdf")
    assert result.status == ScanStatus.CLEAN
    assert probe.called is True


def test_sanitizing_rejects_disallowed_extension():
    s, probe = _scanner()
    result = s.scan(b"x", "evil.exe", "application/octet-stream")
    assert result.status == ScanStatus.INFECTED
    assert probe.called is False


def test_sanitizing_rejects_path_traversal():
    s, probe = _scanner()
    result = s.scan(b"%PDF-1.4 fake", "../etc/passwd.pdf", "application/pdf")
    assert result.status == ScanStatus.INFECTED
    assert probe.called is False


def test_sanitizing_rejects_double_extension():
    s, probe = _scanner()
    result = s.scan(b"%PDF-1.4 fake", "virus.exe.pdf", "application/pdf")
    assert result.status == ScanStatus.INFECTED
    assert probe.called is False


def test_sanitizing_rejects_mime_forgery():
    """扩展名 .pdf 但文件头不是 PDF → MIME 伪造 → infected"""
    s, probe = _scanner()
    result = s.scan(b"\x89PNG\r\n\x1a\n....", "fake.pdf", "application/pdf")
    assert result.status == ScanStatus.INFECTED
    assert probe.called is False


def test_sanitizing_accepts_matching_magic():
    s, probe = _scanner()
    result = s.scan(b"\x89PNG\r\n\x1a\n....", "img.png", "image/png")
    assert result.status == ScanStatus.CLEAN
    assert probe.called is True


def test_sanitizing_rejects_oversize(monkeypatch):
    monkeypatch.setattr(config, "MAX_UPLOAD_SIZE", 10)
    s, probe = _scanner()
    result = s.scan(b"%PDF-1.4 fake" * 5, "big.pdf", "application/pdf")
    assert result.status == ScanStatus.ERROR
    assert probe.called is False


def _make_zip(entries, compression=zipfile.ZIP_DEFLATED):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=compression) as zf:
        for name, data in entries:
            zf.writestr(name, data)
    return buf.getvalue()


def test_sanitizing_accepts_normal_office_zip():
    s, probe = _scanner()
    data = _make_zip([("docProps/core.xml", b"<xml/>"), ("xl/workbook.xml", b"<x/>")])
    result = s.scan(data, "book.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    assert result.status == ScanStatus.CLEAN
    assert probe.called is True


def test_sanitizing_detects_zipbomb_by_ratio():
    s, probe = _scanner()
    # 200KB 全零 → 解压比远超 100 → 压缩炸弹
    data = _make_zip([("a.txt", b"\x00" * (200 * 1024))])
    result = s.scan(data, "bomb.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    assert result.status == ScanStatus.INFECTED
    assert probe.called is False


def test_sanitizing_rejects_corrupt_office():
    s, probe = _scanner()
    # 声明 .docx 但魔数正确、内容非合法 zip → error（fail closed）
    result = s.scan(b"PK\x03\x04 not a real zip", "bad.docx",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    assert result.status == ScanStatus.ERROR
    assert probe.called is False


# ============ ClamAVScanner（假 socket） ============

class FakeSocket:
    """模拟 clamd TCP socket：按顺序返回 recv 数据。"""

    def __init__(self, responses):
        self._responses = list(responses)
        self.sent = b""

    def sendall(self, data):
        self.sent += data

    def recv(self, bufsize):
        if self._responses:
            return self._responses.pop(0)
        return b""

    def settimeout(self, t):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _patch_connection(monkeypatch, sock):
    monkeypatch.setattr(socket, "create_connection", lambda *a, **k: sock)


def test_clamav_instream_clean(monkeypatch):
    sock = FakeSocket([b"stream: OK\n"])
    _patch_connection(monkeypatch, sock)
    result = ClamAVScanner("clamav", 3310).scan(b"%PDF-1.4 fake", "a.pdf", "application/pdf")
    assert result.status == ScanStatus.CLEAN
    assert sock.sent.startswith(b"zINSTREAM\x00")  # INSTREAM 协议握手


def test_clamav_instream_infected(monkeypatch):
    sock = FakeSocket([b"stream: Eicar-Test-Signature FOUND\n"])
    _patch_connection(monkeypatch, sock)
    result = ClamAVScanner("clamav", 3310).scan(b"X5O!P%@AP[4\\PZX54(P^)7CC)7}", "e.txt", "text/plain")
    assert result.status == ScanStatus.INFECTED
    assert "Eicar" in result.result


def test_clamav_unavailable_fails_closed(monkeypatch):
    def raise_refused(*a, **k):
        raise ConnectionRefusedError("clamd down")
    monkeypatch.setattr(socket, "create_connection", raise_refused)
    result = ClamAVScanner("clamav", 3310, fail_open=False).scan(b"x", "a.pdf", "application/pdf")
    assert result.status == ScanStatus.ERROR


def test_clamav_unavailable_fails_open(monkeypatch):
    def raise_refused(*a, **k):
        raise ConnectionRefusedError("clamd down")
    monkeypatch.setattr(socket, "create_connection", raise_refused)
    result = ClamAVScanner("clamav", 3310, fail_open=True).scan(b"x", "a.pdf", "application/pdf")
    assert result.status == ScanStatus.CLEAN


def test_clamav_timeout_fails_closed(monkeypatch):
    class TimeoutSocket(FakeSocket):
        def recv(self, bufsize):
            raise socket.timeout("scan timeout")
    _patch_connection(monkeypatch, TimeoutSocket([]))
    result = ClamAVScanner("clamav", 3310, fail_open=False).scan(b"x", "a.pdf", "application/pdf")
    assert result.status == ScanStatus.ERROR
    assert "超时" in result.result


# ============ 工厂 ============

def test_get_scanner_dev_defaults_to_noop():
    assert isinstance(get_scanner(), NoopScanner)


def test_get_scanner_prod_rejects_noop(monkeypatch):
    monkeypatch.setattr(config, "APP_ENV", "prod")
    monkeypatch.setattr(config, "SCANNER_PROVIDER", "noop")
    with pytest.raises(RuntimeError):
        get_scanner()


def test_get_scanner_prod_rejects_empty(monkeypatch):
    monkeypatch.setattr(config, "APP_ENV", "prod")
    monkeypatch.setattr(config, "SCANNER_PROVIDER", "")
    with pytest.raises(RuntimeError):
        get_scanner()


def test_get_scanner_prod_clamav_ok(monkeypatch):
    monkeypatch.setattr(config, "APP_ENV", "prod")
    monkeypatch.setattr(config, "SCANNER_PROVIDER", "clamav")
    scanner = get_scanner()
    assert isinstance(scanner, SanitizingScanner)
    assert isinstance(scanner.inner, ClamAVScanner)


def test_get_scanner_unknown_provider_raises(monkeypatch):
    monkeypatch.setattr(config, "APP_ENV", "dev")
    monkeypatch.setattr(config, "SCANNER_PROVIDER", "bogus")
    with pytest.raises(RuntimeError):
        get_scanner()