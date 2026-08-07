"""存储抽象接口：本地存储 / S3 / MinIO

设计：
- Storage ABC 定义统一接口（save/delete/read/url_for）
- LocalStorage：本地文件系统存储（现状）
- S3Storage：S3 兼容对象存储（通过 boto3，环境变量配置）
- 工厂函数 get_storage() 根据环境变量自动选择
"""
import logging
import os
import re
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional, Tuple
from .config import UPLOAD_DIR, ALLOWED_UPLOAD_EXTENSIONS, S3_REQUIRED

logger = logging.getLogger(__name__)

# S3 配置：环境变量
S3_ENDPOINT = os.environ.get("S3_ENDPOINT", "")
S3_BUCKET = os.environ.get("S3_BUCKET", "")
S3_ACCESS_KEY = os.environ.get("S3_ACCESS_KEY", "")
S3_SECRET_KEY = os.environ.get("S3_SECRET_KEY", "")


def sanitize_filename(filename: str) -> str:
    r"""清洗文件名：去除路径分隔符、危险字符，保留扩展名。

    安全处理：
    - 去除 / \ .. 等路径遍历字符
    - 只保留：字母、数字、中文、下划线、连字符、点号、空格
    - 保证扩展名小写
    """
    # 去除路径部分，只保留文件名
    filename = os.path.basename(filename)
    # 去除危险字符：只保留安全字符
    filename = re.sub(r'[^\w\s\-\u4e00-\u9fa5.]', '', filename)
    # 去除连续空格和点号
    filename = re.sub(r'\s+', ' ', filename).strip()
    filename = re.sub(r'\.+', '.', filename).strip('.')
    if not filename:
        filename = "unnamed"
    return filename


def get_extension(filename: str) -> str:
    """获取小写扩展名（带点号），如 .pdf"""
    return Path(filename).suffix.lower()


class Storage(ABC):
    """附件存储抽象接口"""

    @abstractmethod
    def save(self, attachment_id: str, data: bytes, original_filename: str) -> Tuple[bool, str]:
        """保存文件。

        Args:
            attachment_id: 附件 ID（随机生成，已由 gen_id 保证唯一）
            data: 文件二进制内容
            original_filename: 用户上传的原始文件名（用于提取扩展名）

        Returns:
            (success: bool, error_message: str)
        """
        pass

    @abstractmethod
    def delete(self, attachment_id: str) -> bool:
        """删除文件。返回是否删除成功。"""
        pass

    @abstractmethod
    def read(self, attachment_id: str) -> Optional[bytes]:
        """读取文件内容。返回 None 表示文件不存在。"""
        pass

    @abstractmethod
    def url_for(self, attachment_id: str, original_filename: str) -> str:
        """生成访问 URL（对于本地存储是后端下载端点路径，对于 S3 是预签名 URL）。"""
        pass

    @abstractmethod
    def get_local_path(self, attachment_id: str) -> Optional[Path]:
        """获取本地文件路径（仅 LocalStorage 有意义，其他存储返回 None）。"""
        pass

    @abstractmethod
    def probe(self, timeout: Optional[float] = None) -> bool:
        """探活：存储是否可用。

        - S3Storage：head bucket →（必要时创建 bucket）→ 写入临时对象 → 读取 → 删除，
          用有限超时往返验证读写链路，禁止仅凭客户端创建成功判断可用。
        - LocalStorage：本地磁盘恒可用，返回 True。
        """
        pass


class LocalStorage(Storage):
    """本地文件系统存储"""

    def __init__(self, upload_dir: Path = UPLOAD_DIR):
        self.upload_dir = upload_dir
        self.upload_dir.mkdir(parents=True, exist_ok=True)

    def _get_candidate_path(self, attachment_id: str) -> Path:
        """获取可能的文件路径（遍历允许的扩展名）"""
        # 优先查找已知扩展名，如果找不到则 glob 查找
        for ext in ALLOWED_UPLOAD_EXTENSIONS:
            candidate = self.upload_dir / f"{attachment_id}{ext}"
            if candidate.exists():
                return candidate
        # 找不到则 glob 匹配
        for candidate in self.upload_dir.glob(f"{attachment_id}.*"):
            if candidate.is_file():
                return candidate
        return None

    def save(self, attachment_id: str, data: bytes, original_filename: str) -> Tuple[bool, str]:
        ext = get_extension(original_filename)
        stored_name = f"{attachment_id}{ext}"
        dest = self.upload_dir / stored_name
        try:
            dest.write_bytes(data)
            return True, ""
        except Exception as e:
            return False, str(e)

    def delete(self, attachment_id: str) -> bool:
        deleted = False
        # 删除所有匹配 attachment_id.* 的文件
        for candidate in self.upload_dir.glob(f"{attachment_id}.*"):
            if candidate.is_file():
                try:
                    candidate.unlink()
                    deleted = True
                except Exception:
                    logger.warning("删除本地附件文件失败: %s", candidate, exc_info=True)
        return deleted

    def read(self, attachment_id: str) -> Optional[bytes]:
        candidate = self._get_candidate_path(attachment_id)
        if candidate and candidate.exists():
            return candidate.read_bytes()
        return None

    def url_for(self, attachment_id: str, original_filename: str) -> str:
        # 本地存储使用后端下载端点，不直接暴露文件路径
        return f"/api/portal/attachments/{attachment_id}/download"

    def get_local_path(self, attachment_id: str) -> Optional[Path]:
        return self._get_candidate_path(attachment_id)

    def probe(self, timeout: Optional[float] = None) -> bool:
        """本地磁盘恒可用（已由 __init__ 创建目录）。"""
        return True


class S3Storage(Storage):
    """S3 兼容对象存储（MinIO / AWS S3）

    需要环境变量：
    - S3_ENDPOINT: 端点 URL（如 https://s3.amazonaws.com 或 http://minio:9000）
    - S3_BUCKET: 存储桶名称
    - S3_ACCESS_KEY: 访问密钥 ID
    - S3_SECRET_KEY: 密钥
    """

    def __init__(
        self,
        endpoint: str = S3_ENDPOINT,
        bucket: str = S3_BUCKET,
        access_key: str = S3_ACCESS_KEY,
        secret_key: str = S3_SECRET_KEY,
        client=None,
        probe_timeout: Optional[float] = None,
    ):
        self.endpoint = endpoint
        self.bucket = bucket
        self.access_key = access_key
        self.secret_key = secret_key
        # 可注入的底层客户端（测试用 fake client；生产为 None，走真实 boto3）。探活函数本身可测。
        self._injected_client = client
        self._probe_timeout = probe_timeout
        self._client = None
        self._initialized = False

    def _init_client(self):
        """懒加载 S3 客户端：优先使用注入的 fake client（测试），否则创建真实 boto3 客户端。"""
        if self._initialized:
            return
        if self._injected_client is not None:
            self._client = self._injected_client
            self._initialized = True
            return
        if not all([self.endpoint, self.bucket, self.access_key, self.secret_key]):
            self._initialized = True
            return
        try:
            import boto3
            from botocore.config import Config
            self._client = boto3.client(
                "s3",
                endpoint_url=self.endpoint,
                aws_access_key_id=self.access_key,
                aws_secret_access_key=self.secret_key,
                config=Config(
                    signature_version="s3v4",
                    connect_timeout=5,          # 连接建立超时（秒）
                    read_timeout=30,            # 读超时（秒）
                    retries={"max_attempts": 3, "mode": "standard"},  # 有限重试
                ),
            )
        except ImportError:
            # boto3 未安装，回退到不初始化，后续 fail-closed
            logger.warning("boto3 未安装，S3 存储不可用")
        except Exception:
            # 配置错误，不初始化，后续 fail-closed
            logger.warning("S3 客户端初始化失败，后续 fail-closed", exc_info=True)
        self._initialized = True

    @staticmethod
    def _s3_error_code(exc: Exception) -> str:
        """从异常中尽量提取 S3 错误码（ClientError.response.Error.Code 等），提取不到返回空串。"""
        resp = getattr(exc, "response", None)
        if isinstance(resp, dict):
            err = resp.get("Error", {})
            if isinstance(err, dict) and err.get("Code"):
                return str(err["Code"])
        code = getattr(exc, "code", None)
        if code:
            return str(code)
        return ""

    def probe(self, timeout: Optional[float] = None) -> bool:
        """真实探活：head bucket →（若不存在则创建）→ 写入临时对象 → 读取 → 删除。

        用有限超时的往返验证读写链路，而非仅凭客户端对象创建成功判断可用。
        任何一步失败即返回 False（fail-closed）。
        """
        self._init_client()
        if self._client is None:
            return False
        if not self.bucket:
            return False
        import uuid
        token = f"probe-{uuid.uuid4().hex}".encode("ascii")
        key = f"probe/{uuid.uuid4().hex}.bin"
        try:
            # 1) head bucket；不存在则创建（幂等）
            try:
                self._client.head_bucket(Bucket=self.bucket)
            except Exception as head_exc:  # noqa: BLE001
                if self._s3_error_code(head_exc) in ("404", "NotFound", "NoSuchBucket", "NoBucket"):
                    self._client.create_bucket(Bucket=self.bucket)
                else:
                    return False
            # 2) 写入临时对象
            self._client.put_object(Bucket=self.bucket, Key=key, Body=token)
            # 3) 读取并校验内容
            resp = self._client.get_object(Bucket=self.bucket, Key=key)
            body = resp["Body"].read()
            # 4) 删除临时对象
            self._client.delete_object(Bucket=self.bucket, Key=key)
            return body == token
        except Exception:  # noqa: BLE001 - 探活失败即 fail-closed
            return False

    def is_available(self) -> bool:
        """客户端是否可用。生产启动校验：真实往返探活，禁止仅凭客户端创建成功静默降级。"""
        return self.probe(timeout=self._probe_timeout)

    def _get_key(self, attachment_id: str, original_filename: str) -> str:
        """构造对象键。

        严格校验：attachment_id 由服务端生成（gen_id，形如 att-<ms>-<rand>），
        禁止路径遍历（..）、路径分隔符、以 / 结尾及危险字符。绝不信任用户输入路径。
        """
        if not attachment_id:
            raise ValueError("attachment_id 不能为空")
        if ".." in attachment_id or "/" in attachment_id or "\\" in attachment_id:
            raise ValueError("attachment_id 含非法路径字符")
        if not re.match(r"^[A-Za-z0-9-]+$", attachment_id):
            raise ValueError("attachment_id 含非法字符")
        ext = get_extension(original_filename)
        if ext and not re.match(r"^\.[A-Za-z0-9]+$", ext):
            raise ValueError("original_filename 含非法扩展名")
        return f"attachments/{attachment_id}{ext}"

    def save(self, attachment_id: str, data: bytes, original_filename: str) -> Tuple[bool, str]:
        self._init_client()
        if self._client is None:
            return False, "S3 client not initialized (check configuration or boto3 installation)"
        key = self._get_key(attachment_id, original_filename)
        try:
            self._client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=data,
            )
            return True, ""
        except Exception as e:
            return False, str(e)

    def delete(self, attachment_id: str) -> bool:
        self._init_client()
        if self._client is None:
            return False
        # S3 需要完整的 key，我们尝试所有允许的扩展名
        deleted_any = False
        for ext in ALLOWED_UPLOAD_EXTENSIONS:
            key = f"attachments/{attachment_id}{ext}"
            try:
                self._client.delete_object(Bucket=self.bucket, Key=key)
                deleted_any = True
            except Exception:
                logger.debug("删除 S3 对象失败（尝试扩展名 %s）: %s", ext, attachment_id, exc_info=True)
        return deleted_any

    def read(self, attachment_id: str) -> Optional[bytes]:
        self._init_client()
        if self._client is None:
            return None
        for ext in ALLOWED_UPLOAD_EXTENSIONS:
            key = f"attachments/{attachment_id}{ext}"
            try:
                resp = self._client.get_object(Bucket=self.bucket, Key=key)
                return resp["Body"].read()
            except Exception:
                logger.debug("读取 S3 对象失败（尝试扩展名 %s）: %s", ext, attachment_id, exc_info=True)
                continue
        return None

    def url_for(self, attachment_id: str, original_filename: str) -> str:
        """生成预签名下载 URL（15 分钟有效期）"""
        self._init_client()
        if self._client is None:
            # 回退到通过后端代理下载
            return f"/api/portal/attachments/{attachment_id}/download"
        key = self._get_key(attachment_id, original_filename)
        try:
            url = self._client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket, "Key": key},
                ExpiresIn=900,  # 15 分钟
            )
            return url
        except Exception:
            # 生成失败，回退到后端代理
            return f"/api/portal/attachments/{attachment_id}/download"

    def get_local_path(self, attachment_id: str) -> Optional[Path]:
        # S3 存储不直接提供本地路径
        return None


def get_storage() -> Storage:
    """工厂函数：根据环境变量选择存储后端。

    - 若 S3 配置完整 → S3Storage
    - 若 S3_REQUIRED（生产默认）但 S3 配置缺失 → 抛错，禁止静默回退本地磁盘
    - 否则（dev/test + S3_REQUIRED=false）→ LocalStorage
    """
    if all([S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY]):
        return S3Storage()
    if S3_REQUIRED:
        raise RuntimeError("生产环境强制 S3/MinIO（S3_REQUIRED=true），S3_* 配置缺失，禁止回退本地磁盘")
    return LocalStorage()


# 全局惰性单例：首次使用时才初始化并缓存。
# 不再在 import 期执行 get_storage()，避免「配置缺失/生产强制 S3」在 import 阶段即抛错，
# 让配置校验统一收敛到 lifespan 的 assert_production_config()（可给出清晰、可诊断的启动失败信息）。
_storage_singleton: "Storage | None" = None


def get_storage_singleton() -> Storage:
    """返回全局存储单例（惰性初始化并缓存）。"""
    global _storage_singleton
    if _storage_singleton is None:
        _storage_singleton = get_storage()
    return _storage_singleton
