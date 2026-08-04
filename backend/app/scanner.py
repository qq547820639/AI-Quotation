"""占位病毒扫描器（预留）

真实环境可接入 ClamAV / VirusTotal 等扫描服务。当前实现为占位：
- 对可执行/危险扩展名与 MIME 标记为 infected
- 其余标记为 clean
- 扫描异常标记为 error

扫描状态流转：pending → scanned / clean / infected / error
"""
from pathlib import Path

# 危险扩展名（可执行/脚本/压缩包等，上传时已被 ALLOWED 过滤，此处兜底）
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


def run_scan(record) -> str:
    """对附件执行占位扫描，更新 record.scan_status / scan_result 并返回状态。

    返回：scan_status（clean / infected / error）
    """
    try:
        name = record.name or ""
        ext = Path(name).suffix.lower()
        mime = (getattr(record, "mime_type", None) or "").lower()

        if ext in DANGEROUS_EXTENSIONS:
            record.scan_status = "infected"
            record.scan_result = f"检测到危险扩展名: {ext or '(无扩展名)'}"
            return "infected"
        if mime in DANGEROUS_MIME_TYPES:
            record.scan_status = "infected"
            record.scan_result = f"检测到危险 MIME 类型: {mime or '(未知)'}"
            return "infected"

        record.scan_status = "clean"
        record.scan_result = "占位扫描通过：未发现恶意特征"
        return "clean"
    except Exception as e:  # noqa: BLE001
        record.scan_status = "error"
        record.scan_result = f"扫描失败: {e}"
        return "error"