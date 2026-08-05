"""附件病毒扫描器（P0）

生产环境必须使用真实扫描器（ClamAV）并 **fail closed**：
- 上传附件先入 pending，扫描通过（clean）才允许下载。
- 扫描服务不可用 / 超时 / 校验失败 → 禁止下载（infected / error）。

组成：
- ScanResult：扫描结果（clean / infected / error）。
- FileScanner：扫描器抽象基类。
- ClamAVScanner：通过 clamd 的 INSTREAM 协议调用真实 ClamAV（socket 实现，无需第三方库）。
- SanitizingScanner：文件校验层（魔数 / 扩展名白名单 / 大小上限 / 双扩展名 / 路径遍历 / 压缩炸弹），
  作为 FileScanner 的装饰层包裹真实扫描器。
- NoopScanner：占位扫描器（仅开发/测试且显式 SCANNER_PROVIDER=noop 时使用）。
- get_scanner()：工厂，按配置返回扫描器；APP_ENV=prod 时禁止 noop（fail closed）。
- run_scan(record)：兼容旧接口，供既有调用点使用。
"""
import io
import socket
import struct
import zipfile
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from . import config
# 本地导入存储，避免模块级循环依赖（storage 只依赖 config）
from .storage import storage

# ============ 状态常量 ============


class ScanStatus:
    PENDING = "pending"
    CLEAN = "clean"
    INFECTED = "infected"
    ERROR = "error"


# 危险扩展名（可执行/脚本/压缩包等；上传时已被 ALLOWED 过滤，此处兜底）
DANGEROUS_EXTENSIONS = {
    ".exe", ".bat", ".cmd", ".com", ".scr", ".dll", ".ocx", ".sys", ".drv",
    ".sh", ".bash", ".zsh", ".ps1", ".vbs", ".js", ".jsx", ".ts", ".tsx",
    ".jar", ".class", ".apk", ".ipa", ".msi", ".reg", ".pif", ".wsf", ".cpl",
    ".py", ".rb", ".php", ".pl", ".cgi", ".elf", ".so", ".dylib",
    ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".iso", ".img", ".dmg",
}

# 危险 MIME 类型
DANGEROUS_MIME_TYPES = {
    "application/x-msdownload", "application/x-msdos-program", "application/x-executable",
    "application/x-sh", "application/x-python-code", "application/x-java-archive",
    "application/octet-stream", "application/x-msi", "application/vnd.ms-cab-compressed",
    "application/x-httpd-php", "text/x-perl", "application/x-ruby",
}


@dataclass
class ScanResult:
    """扫描结果。status ∈ {clean, infected, error}。"""

    status: str
    result: str
    matched: Optional[str] = None

    @staticmethod
    def clean(result: str = "扫描通过", matched: Optional[str] = None) -> "ScanResult":
        return ScanResult(status=ScanStatus.CLEAN, result=result, matched=matched)

    @staticmethod
    def infected(result: str = "检测到恶意内容", matched: Optional[str] = None) -> "ScanResult":
        return ScanResult(status=ScanStatus.INFECTED, result=result, matched=matched)

    @staticmethod
    def error(result: str = "扫描失败", matched: Optional[str] = None) -> "ScanResult":
        return ScanResult(status=ScanStatus.ERROR, result=result, matched=matched)


class FileScanner(ABC):
    """扫描器抽象基类。"""

    display_name = "file"

    @abstractmethod
    def scan(self, data: bytes, filename: str, mime_type: str) -> ScanResult:
        """扫描文件内容，返回 ScanResult。data 为文件二进制内容。"""

    def __repr__(self) -> str:  # pragma: no cover - 调试辅助
        return f"<{type(self).__name__}: {self.display_name}>"


# ============ ClamAV INSTREAM 扫描器 ============

_INSTREAM_MAGIC = b"zINSTREAM\x00"
# 单块最大发送字节（INSTREAM 协议要求 4 字节大端长度前缀）
_STREAM_CHUNK = 64 * 1024


class ClamAVScanner(FileScanner):
    """通过 clamd 的 INSTREAM 协议调用真实 ClamAV。

    无需第三方库，直接用 socket 实现：
    1. 发送 zINSTREAM\\0
    2. 分块发送：4 字节大端长度 + 数据
    3. 发送 0 长度终止块
    4. 读取响应：stream: OK / stream: <签名> FOUND / ERROR: ...
    """

    display_name = "clamav"

    def __init__(
        self,
        host: str,
        port: int,
        timeout: float = 30.0,
        connect_timeout: float = 5.0,
        fail_open: bool = False,
    ):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.connect_timeout = connect_timeout
        self.fail_open = fail_open

    def _unavailable(self, message: str) -> ScanResult:
        """扫描服务不可用/超时时按 fail-open/fail-closed 策略返回。"""
        if self.fail_open:
            return ScanResult.clean(result=f"{message}（fail-open 放行）", matched=message)
        # 生产默认 fail closed：服务不可用 → error，禁止下载
        return ScanResult.error(result=f"{message}（fail-closed 拒绝）", matched=message)

    def scan(self, data: bytes, filename: str, mime_type: str) -> ScanResult:
        try:
            with socket.create_connection((self.host, self.port), timeout=self.connect_timeout) as s:
                s.settimeout(self.timeout)
                s.sendall(_INSTREAM_MAGIC)
                for i in range(0, len(data), _STREAM_CHUNK):
                    chunk = data[i:i + _STREAM_CHUNK]
                    s.sendall(struct.pack(">I", len(chunk)) + chunk)
                s.sendall(struct.pack(">I", 0))  # 终止块

                # 读取响应（一行，以换行结束）
                resp = b""
                while True:
                    part = s.recv(4096)
                    if not part:
                        break
                    resp += part
                    if b"\n" in resp:
                        break
        except socket.timeout:
            return self._unavailable("ClamAV 扫描超时")
        except (OSError, BrokenPipeError, ConnectionError) as e:  # noqa: B014
            return self._unavailable(f"ClamAV 连接失败: {e}")

        text = resp.decode("utf-8", "replace").strip()
        if "FOUND" in text:
            sig = text.split("FOUND")[0].strip() or text
            return ScanResult.infected(
                result=f"ClamAV 检测到病毒: {text}",
                matched=sig or text,
            )
        if "OK" in text:
            return ScanResult.clean(result="ClamAV 扫描通过")
        # 未知/异常响应 → fail closed
        return ScanResult.error(result=f"ClamAV 异常响应: {text or '(空响应)'}", matched=text)


# ============ 占位扫描器（仅开发/测试） ============


class NoopScanner(FileScanner):
    """直接返回 clean。仅开发/测试且显式 SCANNER_PROVIDER=noop 时使用。"""

    display_name = "noop"

    def scan(self, data: bytes, filename: str, mime_type: str) -> ScanResult:
        return ScanResult.clean(result="NoopScanner：未执行真实扫描（仅开发/测试）")


# ============ 文件校验层 ============

# 扩展名 → 期望的魔数（文件头）。用于检测 MIME 伪造 / 扩展名与内容不一致。
_MAGIC_BY_EXT = {
    ".pdf": b"%PDF-",
    ".png": b"\x89PNG\r\n\x1a\n",
    ".jpg": b"\xff\xd8\xff",
    ".jpeg": b"\xff\xd8\xff",
    ".gif": b"GIF8",
    ".webp": b"WEBP",  # RIFF....WEBP，检查 WEBP 标记
    ".xlsx": b"PK\x03\x04",  # zip
    ".docx": b"PK\x03\x04",  # zip
}

# 压缩炸弹防护：最大条目数 / 单文件解压大小上限 / 解压比上限
_ZIP_MAX_ENTRIES = 1000
_ZIP_MAX_FILE_SIZE = 512 * 1024 * 1024  # 512MB
_ZIP_MAX_RATIO = 100


class SanitizingScanner(FileScanner):
    """文件校验 + 真实扫描的组合层。

    先做静态校验（魔数/扩展名/大小/双扩展名/路径遍历/压缩炸弹），
    校验失败返回 infected/error；通过后才调用底层 inner 扫描器。
    """

    display_name = "sanitizing"

    def __init__(self, inner: FileScanner):
        self.inner = inner

    def _ext_allowed(self, ext: str) -> bool:
        return ext in config.ALLOWED_UPLOAD_EXTENSIONS

    def _suspicious_name(self, name: str) -> Optional[ScanResult]:
        """文件名级校验：路径遍历 / 控制字符 / 双扩展名。"""
        if not name:
            return ScanResult.infected(result="文件名缺失", matched=name)
        if "\x00" in name or "/" in name or "\\" in name or ".." in name:
            return ScanResult.infected(result=f"非法文件名（路径分隔符/遍历）: {name}", matched=name)
        # 双扩展名：如 virus.exe.pdf（末扩展名被允许但中间段为危险扩展名）
        parts = name.split(".")
        if len(parts) >= 3:
            mid = parts[-2].lower()
            if "." + mid in DANGEROUS_EXTENSIONS:
                return ScanResult.infected(result=f"检测到双扩展名（危险中间扩展名）: {name}", matched=name)
        return None

    def _check_zipbomb(self, data: bytes, ext: str) -> Optional[ScanResult]:
        """压缩炸弹检查：zip 条目数 / 解压比 / 单条解压大小。"""
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                infos = zf.infolist()
                if len(infos) > _ZIP_MAX_ENTRIES:
                    return ScanResult.infected(
                        result=f"zip 条目数超限（{len(infos)}>{_ZIP_MAX_ENTRIES}），疑似压缩炸弹", matched="zip-entries")
                for info in infos:
                    if info.file_size > _ZIP_MAX_FILE_SIZE:
                        return ScanResult.infected(result="zip 存在超大解压条目，疑似压缩炸弹", matched=info.filename)
                    if info.compress_size > 0 and info.file_size / info.compress_size > _ZIP_MAX_RATIO:
                        return ScanResult.infected(result="zip 解压比异常，疑似压缩炸弹", matched=info.filename)
        except zipfile.BadZipFile:
            # 声明的 Office/压缩文件但非合法 zip → error（fail closed）
            if ext in (".xlsx", ".docx"):
                return ScanResult.error(result="Office 文件损坏（非合法 zip）", matched=ext)
        return None

    def scan(self, data: bytes, filename: str, mime_type: str) -> ScanResult:
        ext = Path(filename or "").suffix.lower()

        # 1) 文件名安全
        r = self._suspicious_name(filename or "")
        if r:
            return r

        # 2) 扩展名白名单
        if not self._ext_allowed(ext):
            return ScanResult.infected(result=f"不允许的扩展名: {ext or '(无扩展名)'}", matched=ext)

        # 3) 大小上限
        if len(data) > config.MAX_UPLOAD_SIZE:
            return ScanResult.error(
                result=f"文件超过大小上限（>{config.MAX_UPLOAD_SIZE} bytes）", matched=str(len(data)))

        # 4) 魔数校验（MIME 伪造）：扩展名与文件头必须一致
        expected = _MAGIC_BY_EXT.get(ext)
        if expected is not None:
            if ext == ".webp":
                if b"WEBP" not in data[:12]:
                    return ScanResult.infected(result=f"文件头与扩展名不一致（MIME 伪造）: {filename}", matched=ext)
            elif not data[:len(expected)].startswith(expected):
                return ScanResult.infected(result=f"文件头与扩展名不一致（MIME 伪造）: {filename}", matched=ext)

        # 5) 压缩炸弹（xlsx/docx 本质是 zip）
        if ext in (".xlsx", ".docx") or data[:2] == b"PK":
            r = self._check_zipbomb(data, ext)
            if r:
                return r

        # 6) 底层真实扫描
        return self.inner.scan(data, filename, mime_type)


# ============ 工厂 ============

_UNSAFE_PROVIDERS = {"", "noop"}


def get_scanner() -> FileScanner:
    """按配置返回扫描器。

    约束：
    - APP_ENV=prod 且 SCANNER_PROVIDER 未设置或为不安全占位（noop/空）→ 抛错（fail closed）。
    - 仅开发/测试且显式 SCANNER_PROVIDER 为 noop 时才用 NoopScanner。
    - SCANNER_PROVIDER=clamav → SanitizingScanner(ClamAVScanner(...))。
    """
    provider = (config.SCANNER_PROVIDER or "").strip().lower()
    env = (config.APP_ENV or "dev").strip().lower()

    if provider in _UNSAFE_PROVIDERS:
        if env == "prod":
            raise RuntimeError(
                "生产环境必须显式配置 SCANNER_PROVIDER=clamav 并使用真实扫描器，禁止使用 noop/空占位扫描器（fail closed）"
            )
        return NoopScanner()

    if provider == "clamav":
        inner = ClamAVScanner(
            host=config.CLAMAV_HOST,
            port=config.CLAMAV_PORT,
            timeout=config.CLAMAV_TIMEOUT_SECONDS,
            connect_timeout=config.CLAMAV_CONNECT_TIMEOUT_SECONDS,
            fail_open=config.SCAN_FAIL_OPEN,
        )
        return SanitizingScanner(inner)

    if provider == "sanitizing":
        return SanitizingScanner(NoopScanner())

    raise RuntimeError(f"未知的 SCANNER_PROVIDER: {provider!r}")


def scan_bytes(data: bytes, filename: str, mime_type: str) -> ScanResult:
    """便捷入口：使用当前配置的扫描器扫描一段字节内容。"""
    return get_scanner().scan(data, filename, mime_type)


def run_scan(record) -> str:
    """兼容旧接口：使用新扫描器扫描 record 对应物理文件并更新 record 扫描状态。

    返回：scan_status（clean / infected / error）。
    """
    try:
        data = storage.read(record.id)
        if data is None:
            record.scan_status = ScanStatus.ERROR
            record.scan_result = "扫描失败：附件文件缺失"
            return record.scan_status
        name = record.name or ""
        mime = (getattr(record, "mime_type", None) or "")
        result = get_scanner().scan(data, name, mime)
        record.scan_status = result.status
        record.scan_result = result.result
        return record.scan_status
    except Exception as e:  # noqa: BLE001
        record.scan_status = ScanStatus.ERROR
        record.scan_result = f"扫描失败: {e}"
        return record.scan_status