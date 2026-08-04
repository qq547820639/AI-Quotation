"""询价发送模板：支持变量与多语言（P1-8 Task 12）

模板变量：
- inquiryCode：询价编号
- subject：询价主题
- deadline：报价截止时间
- supplierName：供应商名称
- count：邀请供应商数量
- portalUrl：供应商门户链接（含邀请 token）
- organization：采购组织

提供：render / validate / preview，默认中英文。
"""
from __future__ import annotations

from typing import Any

# 模板变量白名单（用于校验缺失变量）
TEMPLATE_VARIABLES = ("inquiryCode", "subject", "deadline", "supplierName", "count", "portalUrl", "organization")

# 支持的语言
SUPPORTED_LANGS = ("zh", "en")

# 模板：{lang: {"subject": ..., "body": ...}}
INQUIRY_TEMPLATES: dict[str, dict[str, str]] = {
    "zh": {
        "subject": "【询价邀请】{subject}（{inquiryCode}）",
        "body": (
            "尊敬的 {supplierName}：\n\n"
            "您好！我们诚挚邀请贵公司参与以下询价：\n\n"
            "询价编号：{inquiryCode}\n"
            "询价主题：{subject}\n"
            "采购组织：{organization}\n"
            "报价截止：{deadline}\n\n"
            "请点击以下链接在截止时间前提交报价：\n{portalUrl}\n\n"
            "如有疑问，请及时联系我们。\n"
            "感谢您的支持与合作！"
        ),
    },
    "en": {
        "subject": "[Inquiry Invitation] {subject} ({inquiryCode})",
        "body": (
            "Dear {supplierName},\n\n"
            "We cordially invite your company to participate in the following inquiry:\n\n"
            "Inquiry Code: {inquiryCode}\n"
            "Subject: {subject}\n"
            "Organization: {organization}\n"
            "Deadline: {deadline}\n\n"
            "Please submit your quotation before the deadline via the link below:\n{portalUrl}\n\n"
            "Should you have any questions, please do not hesitate to contact us.\n"
            "Thank you for your support!"
        ),
    },
}


def _normalize_lang(lang: str | None) -> str:
    lang = (lang or "zh").lower()
    if lang not in SUPPORTED_LANGS:
        return "zh"
    return lang


def render_template(template_name: str, lang: str | None, variables: dict[str, Any] | None = None) -> str:
    """渲染模板正文。缺失变量在其位置保留占位符，不抛异常。"""
    variables = {k: str(v) for k, v in (variables or {}).items()}
    tmpl = INQUIRY_TEMPLATES.get(template_name, INQUIRY_TEMPLATES["zh"])
    body = tmpl["body"]
    for key, value in variables.items():
        body = body.replace("{" + key + "}", value)
    return body


def render_subject(template_name: str, lang: str | None, variables: dict[str, Any] | None = None) -> str:
    variables = {k: str(v) for k, v in (variables or {}).items()}
    tmpl = INQUIRY_TEMPLATES.get(template_name, INQUIRY_TEMPLATES["zh"])
    subject = tmpl["subject"]
    for key, value in variables.items():
        subject = subject.replace("{" + key + "}", value)
    return subject


def validate_template(template_name: str, lang: str | None, variables: dict[str, Any] | None = None) -> list[str]:
    """校验模板所需的变量是否齐全，返回缺失变量名列表。"""
    variables = variables or {}
    missing = [k for k in TEMPLATE_VARIABLES if k not in variables]
    return missing


def preview_template(template_name: str, lang: str | None, variables: dict[str, Any] | None = None) -> dict:
    """渲染预览：返回主题、正文、缺失变量与实际使用的语言。"""
    lang = _normalize_lang(lang)
    missing = validate_template(template_name, lang, variables)
    subject = render_subject(template_name, lang, variables)
    body = render_template(template_name, lang, variables)
    return {
        "template": template_name,
        "lang": lang,
        "subject": subject,
        "body": body,
        "missingVariables": missing,
    }