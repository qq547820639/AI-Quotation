"""种子数据初始化

首启时若 DB 为空，注入种子数据（从 src/mock/ 转写）。
init_db(db) 由 main.py lifespan 调用。
"""
from datetime import datetime, timedelta
from sqlalchemy.orm import Session

from .models import (
    User, Material, Supplier, Inquiry, InquiryItem, InquiryLog, ApprovalNode,
    Quotation, QuotationItem, AppSettings,
)
from .auth import hash_password
from .config import DEMO_USER_PASSWORD


# ============ 日期辅助（对齐 mock 的 dayjs offset 语义） ============

def _day(offset: float, hour: int = 0, minute: int = 0) -> str:
    dt = datetime.now() + timedelta(days=offset)
    return dt.replace(hour=hour, minute=minute, second=0, microsecond=0).strftime("%Y-%m-%d %H:%M:%S")


def _date_only(offset: float) -> str:
    return (datetime.now() + timedelta(days=offset)).strftime("%Y-%m-%d")


# ============ 物料 ============

MATERIALS = [
    {"id": "mat-1", "code": "MAT001", "name": "工业交换机", "category": "电子设备", "brand": "华为",
     "spec": "8口千兆非网管", "techParams": "端口：8×10/100/1000M；工作温度：-40~75℃；防护等级：IP40",
     "unit": "台", "stockQty": 5},
    {"id": "mat-2", "code": "MAT002", "name": "不锈钢法兰", "category": "五金件", "brand": "华泰",
     "spec": "DN50 PN16 304", "techParams": "材质：SUS304；标准：GB/T 9116；压力等级：PN16",
     "unit": "片", "stockQty": 120},
    {"id": "mat-3", "code": "MAT003", "name": "深沟球轴承", "category": "传动件", "brand": "SKF",
     "spec": "6205-2RS", "techParams": "内径：25mm；外径：52mm；宽度：15mm；双面密封",
     "unit": "套", "stockQty": 80},
    {"id": "mat-4", "code": "MAT004", "name": "PLC控制器", "category": "自动化设备", "brand": "西门子",
     "spec": "S7-1200 CPU 1214C", "techParams": "数字量I/O：14入/10出；模拟量I/O：2入；工作电源：DC24V",
     "unit": "台", "stockQty": 3},
    {"id": "mat-5", "code": "MAT005", "name": "办公电脑", "category": "办公设备", "brand": "联想",
     "spec": "ThinkCentre M70t", "techParams": "CPU：i5-13400；内存：16GB；硬盘：512GB SSD",
     "unit": "台", "stockQty": 10},
    {"id": "mat-6", "code": "MAT006", "name": "工业润滑油", "category": "化工", "brand": "美孚",
     "spec": "Mobil DTE 25 208L", "techParams": "粘度等级：ISO VG46；闪点：210℃；包装：208L 铁桶",
     "unit": "桶", "stockQty": None},
    {"id": "mat-7", "code": "MAT007", "name": "包装纸箱", "category": "包装材料", "brand": "正达",
     "spec": "500×400×300mm 五层", "techParams": "材质：五层瓦楞纸；承重：≤25kg；耐破强度：≥1200kPa",
     "unit": "个", "stockQty": 2000},
    {"id": "mat-8", "code": "MAT008", "name": "安全防护手套", "category": "劳保用品", "brand": "3M",
     "spec": "防切割 5 级", "techParams": "切割等级：EN388 5级；材质：HPPE+PU涂层；尺码：L",
     "unit": "双", "stockQty": 500},
]

MAT_BY_ID = {m["id"]: m for m in MATERIALS}


# ============ 用户 ============

USERS = [
    {"id": "u-1", "name": "李明辉", "avatar": "https://api.dicebear.com/7.x/initials/svg?seed=LMH&backgroundColor=165DFF",
     "role": "采购人员", "department": "采购部", "organization": "总部采购中心", "permissions": None},
    {"id": "u-2", "name": "王志强", "avatar": "https://api.dicebear.com/7.x/initials/svg?seed=WZQ&backgroundColor=00B42A",
     "role": "采购主管", "department": "采购部", "organization": "总部采购中心", "permissions": None},
    {"id": "u-3", "name": "张文静", "avatar": "https://api.dicebear.com/7.x/initials/svg?seed=ZWJ&backgroundColor=FF7D00",
     "role": "采购人员", "department": "采购部", "organization": "华东分部", "permissions": None},
    {"id": "u-4", "name": "刘建国", "avatar": "https://api.dicebear.com/7.x/initials/svg?seed=LJG&backgroundColor=165DFF",
     "role": "采购人员", "department": "采购部", "organization": "华南分部", "permissions": None},
    {"id": "u-5", "name": "陈晓燕", "avatar": "https://api.dicebear.com/7.x/initials/svg?seed=CXY&backgroundColor=F53F3F",
     "role": "采购人员", "department": "采购部", "organization": "总部采购中心", "permissions": None},
    {"id": "u-6", "name": "周大海", "avatar": "https://api.dicebear.com/7.x/initials/svg?seed=ZDH&backgroundColor=722ED1",
     "role": "管理员", "department": "信息中心", "organization": "总部采购中心", "permissions": None},
]

USER_BY_ID = {u["id"]: u for u in USERS}


# ============ 供应商 ============

SUPPLIERS = [
    {"id": "sup-1", "code": "SUP001", "name": "上海恒远工业设备有限公司", "region": "上海",
     "contact": "周建明", "phone": "021-55886677", "email": "zhoujm@hengyuan-ind.com",
     "mainCategories": ["五金件", "工业设备", "传动件"], "level": "STRATEGIC",
     "cooperationStatus": "COOPERATING", "qualified": True, "historyResponseRate": 0.96,
     "historyFulfillmentRate": 0.98, "avgDeliveryDays": 7, "lastCooperateTime": "2026-07-20",
     "historyCoopCount": 48},
    {"id": "sup-2", "code": "SUP002", "name": "苏州联创自动化科技有限公司", "region": "苏州",
     "contact": "吴海峰", "phone": "0512-66778899", "email": "whf@lianchuang-auto.com",
     "mainCategories": ["自动化设备", "电子设备"], "level": "PREMIUM",
     "cooperationStatus": "COOPERATING", "qualified": True, "historyResponseRate": 0.92,
     "historyFulfillmentRate": 0.95, "avgDeliveryDays": 10, "lastCooperateTime": "2026-07-15",
     "historyCoopCount": 32},
    {"id": "sup-3", "code": "SUP003", "name": "宁波华泰五金制造有限公司", "region": "宁波",
     "contact": "孙丽华", "phone": "0574-88997766", "email": "sunlh@huatai-metal.com",
     "mainCategories": ["五金件"], "level": "QUALIFIED", "cooperationStatus": "COOPERATING",
     "qualified": True, "historyResponseRate": 0.85, "historyFulfillmentRate": 0.9,
     "avgDeliveryDays": 12, "lastCooperateTime": "2026-06-28", "historyCoopCount": 21},
    {"id": "sup-4", "code": "SUP004", "name": "深圳智联电子科技有限公司", "region": "深圳",
     "contact": "郑伟", "phone": "0755-22334455", "email": "zhengwei@zhilian-elec.com",
     "mainCategories": ["电子设备"], "level": "PREMIUM", "cooperationStatus": "COOPERATING",
     "qualified": True, "historyResponseRate": 0.9, "historyFulfillmentRate": 0.93,
     "avgDeliveryDays": 9, "lastCooperateTime": "2026-07-25", "historyCoopCount": 27},
    {"id": "sup-5", "code": "SUP005", "name": "杭州启明供应链有限公司", "region": "杭州",
     "contact": "黄敏", "phone": "0571-66889900", "email": "huangmin@qiming-supply.com",
     "mainCategories": ["办公设备", "劳保用品", "化工", "综合"], "level": "QUALIFIED",
     "cooperationStatus": "COOPERATING", "qualified": True, "historyResponseRate": 0.88,
     "historyFulfillmentRate": 0.91, "avgDeliveryDays": 14, "lastCooperateTime": "2026-07-10",
     "historyCoopCount": 18},
    {"id": "sup-6", "code": "SUP006", "name": "广东正达包装材料有限公司", "region": "佛山",
     "contact": "林国强", "phone": "0757-88990011", "email": "lingq@zhengda-pack.com",
     "mainCategories": ["包装材料"], "level": "QUALIFIED", "cooperationStatus": "COOPERATING",
     "qualified": True, "historyResponseRate": 0.82, "historyFulfillmentRate": 0.88,
     "avgDeliveryDays": 8, "lastCooperateTime": "2026-07-05", "historyCoopCount": 15},
    {"id": "sup-7", "code": "SUP007", "name": "南京恒泰化工科技有限公司", "region": "南京",
     "contact": "徐建华", "phone": "025-55667788", "email": "xujh@hengtai-chem.com",
     "mainCategories": ["化工"], "level": "PENDING", "cooperationStatus": "DISABLED",
     "qualified": False, "historyResponseRate": 0.55, "historyFulfillmentRate": 0.6,
     "avgDeliveryDays": 20, "lastCooperateTime": "2025-11-12", "historyCoopCount": 4},
    {"id": "sup-8", "code": "SUP008", "name": "武汉顺达物流设备有限公司", "region": "武汉",
     "contact": "邓志刚", "phone": "027-88776655", "email": "dengzg@shunda-logistics.com",
     "mainCategories": ["传动件", "劳保用品"], "level": "PENDING", "cooperationStatus": "BLACKLIST",
     "qualified": False, "historyResponseRate": 0.3, "historyFulfillmentRate": 0.4,
     "avgDeliveryDays": 25, "lastCooperateTime": "2025-08-30", "historyCoopCount": 2},
]

SUP_NAME = {s["id"]: s["name"] for s in SUPPLIERS}


# ============ 询价单 ============

def _item(inquiry_id: str, index: int, mat_id: str, quantity: int, target_price=None, remark=None):
    m = MAT_BY_ID[mat_id]
    return {
        "id": f"item-{inquiry_id}-{index}",
        "inquiry_id": inquiry_id,
        "material_id": m["id"],
        "name": m["name"], "code": m["code"], "category": m["category"],
        "brand": m["brand"], "spec": m["spec"], "tech_params": m["techParams"],
        "unit": m["unit"], "quantity": quantity, "target_price": target_price,
        "expected_delivery_date": _date_only(20), "remark": remark,
    }


def _log(inquiry_id: str, offset, operator, operator_role, ltype, content, result=None):
    return {
        "id": f"log-{inquiry_id}-{offset}-{ltype}",
        "inquiry_id": inquiry_id, "time": _day(offset, 9, 30),
        "operator": operator, "operator_role": operator_role, "type": ltype,
        "content": content, "result": result,
    }


INQUIRIES = [
    {
        "id": "inq-1", "code": "INQ20260801001", "subject": "华东车间网络改造物料采购",
        "organization": "华东分部", "owner_name": "张文静", "owner_id": "u-3", "currency": "CNY",
        "deadline": _day(5, 18, 0), "expected_delivery_date": _date_only(25),
        "delivery_address": "上海市浦东新区张江高科技园区科苑路 88 号", "contact": "张文静 13800000003",
        "payment_terms": "货到验收后 30 天付款", "invoice_requirement": "增值税专用发票 13%",
        "description": "华东车间网络升级改造所需工业交换机，要求提供原厂质保及上门调试服务。",
        "status": "DRAFT", "created_by_id": "u-3", "created_by_name": "张文静",
        "created_at": _day(-2, 9, 30), "updated_at": _day(-2, 10, 0),
        "selected_supplier_map": {}, "purchaser_comments": {},
        "items": [_item("inq-1", 1, "mat-1", 20, 850, "需提供 3 年质保")],
        "invited_supplier_ids": ["sup-4", "sup-2"],
        "logs": [
            _log("inq-1", -2, "张文静", "采购人员", "CREATE", "创建询价单 INQ20260801001"),
            _log("inq-1", -2, "张文静", "采购人员", "SAVE_DRAFT", "保存询价单草稿"),
        ],
        "approval_nodes": [],
    },
    {
        "id": "inq-2", "code": "INQ20260801002", "subject": "不锈钢法兰批量采购",
        "organization": "总部采购中心", "owner_name": "李明辉", "owner_id": "u-1", "currency": "CNY",
        "deadline": _day(7, 18, 0), "expected_delivery_date": _date_only(30),
        "delivery_address": "总部仓库（上海市嘉定区工业园区）", "contact": "李明辉 13800000001",
        "payment_terms": "货到验收后 45 天付款", "invoice_requirement": "增值税专用发票 13%",
        "description": "不锈钢法兰批量采购，需提供材质证明及检验报告。",
        "status": "PENDING_SEND", "created_by_id": "u-1", "created_by_name": "李明辉",
        "created_at": _day(-3, 14, 0), "updated_at": _day(-2, 9, 0),
        "selected_supplier_map": {}, "purchaser_comments": {},
        "items": [_item("inq-2", 1, "mat-2", 100, 65)],
        "invited_supplier_ids": ["sup-1", "sup-3"],
        "logs": [
            _log("inq-2", -3, "李明辉", "采购人员", "CREATE", "创建询价单 INQ20260801002"),
            _log("inq-2", -3, "李明辉", "采购人员", "SAVE_DRAFT", "保存询价单草稿"),
            _log("inq-2", -2, "李明辉", "采购人员", "UPDATE", "修改目标价及交货日期"),
        ],
        "approval_nodes": [],
    },
    {
        "id": "inq-3", "code": "INQ20260801003", "subject": "PLC控制器及配套采购",
        "organization": "总部采购中心", "owner_name": "李明辉", "owner_id": "u-1", "currency": "CNY",
        "deadline": _day(0, 23, 0), "expected_delivery_date": _date_only(20),
        "delivery_address": "总部仓库（上海市嘉定区工业园区）", "contact": "李明辉 13800000001",
        "payment_terms": "货到验收后 30 天付款", "invoice_requirement": "增值税专用发票 13%",
        "description": "自动化产线升级所需 PLC 控制器，需提供编程调试技术支持。",
        "status": "INQUIRING", "created_by_id": "u-1", "created_by_name": "李明辉",
        "created_at": _day(-4, 10, 0), "updated_at": _day(-3, 9, 0),
        "selected_supplier_map": {}, "purchaser_comments": {},
        "items": [_item("inq-3", 1, "mat-4", 6, 4200, "含编程调试服务")],
        "invited_supplier_ids": ["sup-2", "sup-5"],
        "logs": [
            _log("inq-3", -4, "李明辉", "采购人员", "CREATE", "创建询价单 INQ20260801003"),
            _log("inq-3", -4, "李明辉", "采购人员", "SEND_INQUIRY", "向 2 家供应商发送询价"),
            _log("inq-3", -3, "苏州联创自动化科技有限公司", "供应商", "SUPPLIER_VIEW", "供应商查看询价单"),
        ],
        "approval_nodes": [],
    },
    {
        "id": "inq-4", "code": "INQ20260801004", "subject": "办公电脑集中采购",
        "organization": "总部采购中心", "owner_name": "陈晓燕", "owner_id": "u-5", "currency": "CNY",
        "deadline": _day(3, 18, 0), "expected_delivery_date": _date_only(25),
        "delivery_address": "总部办公楼（上海市浦东新区）", "contact": "陈晓燕 13800000005",
        "payment_terms": "货到验收后 30 天付款", "invoice_requirement": "增值税专用发票 13%",
        "description": "总部办公区域集中采购办公电脑，要求预装系统及办公软件。",
        "status": "PARTIAL_QUOTED", "created_by_id": "u-5", "created_by_name": "陈晓燕",
        "created_at": _day(-5, 11, 0), "updated_at": _day(-2, 15, 0),
        "selected_supplier_map": {}, "purchaser_comments": {},
        "items": [_item("inq-4", 1, "mat-5", 30, 4500, "预装 Windows 11 及 Office")],
        "invited_supplier_ids": ["sup-5", "sup-2"],
        "logs": [
            _log("inq-4", -5, "陈晓燕", "采购人员", "CREATE", "创建询价单 INQ20260801004"),
            _log("inq-4", -5, "陈晓燕", "采购人员", "SEND_INQUIRY", "向 2 家供应商发送询价"),
            _log("inq-4", -4, "杭州启明供应链有限公司", "供应商", "SUPPLIER_VIEW", "供应商查看询价单"),
            _log("inq-4", -2, "杭州启明供应链有限公司", "供应商", "SUBMIT_QUOTATION", "提交报价"),
        ],
        "approval_nodes": [],
    },
    {
        "id": "inq-5", "code": "INQ20260801005", "subject": "轴承及法兰年度采购",
        "organization": "总部采购中心", "owner_name": "李明辉", "owner_id": "u-1", "currency": "CNY",
        "deadline": _day(-2, 18, 0), "expected_delivery_date": _date_only(15),
        "delivery_address": "总部仓库（上海市嘉定区工业园区）", "contact": "李明辉 13800000001",
        "payment_terms": "货到验收后 45 天付款", "invoice_requirement": "增值税专用发票 13%",
        "description": "年度传动件及五金件集中采购，包含轴承与不锈钢法兰。",
        "status": "ALL_QUOTED", "created_by_id": "u-1", "created_by_name": "李明辉",
        "created_at": _day(-7, 10, 0), "updated_at": _day(-2, 18, 0),
        "selected_supplier_map": {}, "purchaser_comments": {},
        "items": [
            _item("inq-5", 1, "mat-3", 200, 35),
            _item("inq-5", 2, "mat-2", 50, 65),
        ],
        "invited_supplier_ids": ["sup-1", "sup-3", "sup-5"],
        "logs": [
            _log("inq-5", -7, "李明辉", "采购人员", "CREATE", "创建询价单 INQ20260801005"),
            _log("inq-5", -7, "李明辉", "采购人员", "SEND_INQUIRY", "向 3 家供应商发送询价"),
            _log("inq-5", -6, "上海恒远工业设备有限公司", "供应商", "SUPPLIER_VIEW", "供应商查看询价单"),
            _log("inq-5", -5, "宁波华泰五金制造有限公司", "供应商", "SUPPLIER_VIEW", "供应商查看询价单"),
            _log("inq-5", -4, "上海恒远工业设备有限公司", "供应商", "SUBMIT_QUOTATION", "提交报价"),
            _log("inq-5", -3, "杭州启明供应链有限公司", "供应商", "SUBMIT_QUOTATION", "提交报价"),
            _log("inq-5", -2, "宁波华泰五金制造有限公司", "供应商", "SUBMIT_QUOTATION", "提交报价"),
            _log("inq-5", -2, "系统", "系统", "QUOTATION_DEADLINE", "报价截止，共收到 3 份报价"),
        ],
        "approval_nodes": [],
    },
    {
        "id": "inq-6", "code": "INQ20260801006", "subject": "包装纸箱季度采购",
        "organization": "华南分部", "owner_name": "刘建国", "owner_id": "u-4", "currency": "CNY",
        "deadline": _day(-5, 18, 0), "expected_delivery_date": _date_only(10),
        "delivery_address": "华南分部仓库（广州市黄埔区）", "contact": "刘建国 13800000004",
        "payment_terms": "货到验收后 30 天付款", "invoice_requirement": "增值税专用发票 13%",
        "description": "华南分部季度包装纸箱集中采购。",
        "status": "TIMEOUT", "created_by_id": "u-4", "created_by_name": "刘建国",
        "created_at": _day(-10, 10, 0), "updated_at": _day(-5, 18, 0),
        "selected_supplier_map": {}, "purchaser_comments": {},
        "items": [_item("inq-6", 1, "mat-7", 5000, 3.5)],
        "invited_supplier_ids": ["sup-6", "sup-5"],
        "logs": [
            _log("inq-6", -10, "刘建国", "采购人员", "CREATE", "创建询价单 INQ20260801006"),
            _log("inq-6", -10, "刘建国", "采购人员", "SEND_INQUIRY", "向 2 家供应商发送询价"),
            _log("inq-6", -9, "广东正达包装材料有限公司", "供应商", "SUPPLIER_VIEW", "供应商查看询价单"),
            _log("inq-6", -5, "系统", "系统", "QUOTATION_DEADLINE", "报价截止，未收到任何报价，询价超时"),
        ],
        "approval_nodes": [],
    },
    {
        "id": "inq-7", "code": "INQ20260801007", "subject": "车间自动化升级物料采购",
        "organization": "总部采购中心", "owner_name": "李明辉", "owner_id": "u-1", "currency": "CNY",
        "deadline": _day(-12, 18, 0), "expected_delivery_date": _date_only(-2),
        "delivery_address": "总部仓库（上海市嘉定区工业园区）", "contact": "李明辉 13800000001",
        "payment_terms": "货到验收后 30 天付款", "invoice_requirement": "增值税专用发票 13%",
        "description": "车间自动化升级所需工业交换机与 PLC 控制器，已完成定标。",
        "status": "COMPLETED", "created_by_id": "u-1", "created_by_name": "李明辉",
        "created_at": _day(-18, 10, 0), "updated_at": _day(-8, 16, 0),
        "selected_supplier_map": {"item-inq-7-1": "sup-4", "item-inq-7-2": "sup-2"},
        "purchaser_comments": {
            "sup-2": "PLC 报价合理，技术服务能力较强",
            "sup-4": "交换机价格优势明显，交货周期短",
        },
        "items": [
            _item("inq-7", 1, "mat-1", 15, 850),
            _item("inq-7", 2, "mat-4", 8, 4200),
        ],
        "invited_supplier_ids": ["sup-2", "sup-4"],
        "logs": [
            _log("inq-7", -18, "李明辉", "采购人员", "CREATE", "创建询价单 INQ20260801007"),
            _log("inq-7", -18, "李明辉", "采购人员", "SEND_INQUIRY", "向 2 家供应商发送询价"),
            _log("inq-7", -15, "苏州联创自动化科技有限公司", "供应商", "SUBMIT_QUOTATION", "提交报价"),
            _log("inq-7", -14, "深圳智联电子科技有限公司", "供应商", "SUBMIT_QUOTATION", "提交报价"),
            _log("inq-7", -12, "系统", "系统", "QUOTATION_DEADLINE", "报价截止，共收到 2 份报价"),
            _log("inq-7", -11, "李明辉", "采购人员", "VIEW_QUOTATION", "查看并对比报价"),
            _log("inq-7", -10, "李明辉", "采购人员", "SELECT_SUPPLIER", "选择深圳智联供应交换机、苏州联创供应 PLC"),
            _log("inq-7", -8, "王志强", "采购主管", "CONFIRM_RESULT", "确认定标结果", "已完成"),
        ],
        "approval_nodes": [],
    },
    {
        "id": "inq-8", "code": "INQ20260801008", "subject": "安全防护手套采购",
        "organization": "华东分部", "owner_name": "张文静", "owner_id": "u-3", "currency": "CNY",
        "deadline": _day(2, 18, 0), "expected_delivery_date": _date_only(20),
        "delivery_address": "华东分部仓库（苏州市工业园区）", "contact": "张文静 13800000003",
        "payment_terms": "货到验收后 30 天付款", "invoice_requirement": "增值税专用发票 13%",
        "description": "车间安全防护手套采购，因需求变更取消本次询价。",
        "status": "CANCELLED", "created_by_id": "u-3", "created_by_name": "张文静",
        "created_at": _day(-6, 10, 0), "updated_at": _day(-1, 14, 0),
        "selected_supplier_map": {}, "purchaser_comments": {},
        "items": [_item("inq-8", 1, "mat-8", 500, 18)],
        "invited_supplier_ids": ["sup-5"],
        "logs": [
            _log("inq-8", -6, "张文静", "采购人员", "CREATE", "创建询价单 INQ20260801008"),
            _log("inq-8", -5, "张文静", "采购人员", "SEND_INQUIRY", "向 1 家供应商发送询价"),
            _log("inq-8", -1, "张文静", "采购人员", "CANCEL", "因需求变更取消询价", "已取消"),
        ],
        "approval_nodes": [],
    },
]


# ============ 报价单 ============

def _qitem(qid, inquiry_item_id, unit_price, quantity, delivery_days, brand,
           warranty_months=12, payment_terms="货到验收后 30 天付款"):
    return {
        "id": f"qitem-{qid}-{inquiry_item_id}",
        "quotation_id": qid, "inquiry_item_id": inquiry_item_id,
        "unit_price": unit_price, "tax_rate": 0.13,
        "tax_included_total": round(unit_price * quantity, 2), "moq": 1,
        "delivery_days": delivery_days, "delivery_date": _date_only(delivery_days),
        "brand": brand, "warranty_months": warranty_months, "payment_terms": payment_terms,
        "valid_until": _date_only(30),
    }


QUOTATIONS = [
    {"id": "quo-4-5", "inquiry_id": "inq-4", "supplier_id": "sup-5",
     "supplier_name": SUP_NAME["sup-5"], "status": "SUBMITTED",
     "submitted_at": _day(-2, 14, 30),
     "items": [_qitem("quo-4-5", "item-inq-4-1", 4380, 30, 12, "联想", 36, "货到验收后 30 天付款")],
     "total_amount": 131400, "remark": "含预装系统及办公软件，提供上门安装服务。",
     "created_at": _day(-4, 9, 0), "updated_at": _day(-2, 14, 30)},
    {"id": "quo-5-1", "inquiry_id": "inq-5", "supplier_id": "sup-1",
     "supplier_name": SUP_NAME["sup-1"], "status": "SUBMITTED",
     "submitted_at": _day(-4, 16, 0),
     "items": [
         _qitem("quo-5-1", "item-inq-5-1", 32, 200, 7, "SKF", 24),
         _qitem("quo-5-1", "item-inq-5-2", 60, 50, 7, "华泰", 24),
     ],
     "total_amount": 9400, "remark": "战略供应商价格，含材质证明及检验报告。",
     "created_at": _day(-6, 9, 0), "updated_at": _day(-4, 16, 0)},
    {"id": "quo-5-3", "inquiry_id": "inq-5", "supplier_id": "sup-3",
     "supplier_name": SUP_NAME["sup-3"], "status": "SUBMITTED",
     "submitted_at": _day(-2, 10, 0),
     "items": [
         _qitem("quo-5-3", "item-inq-5-1", 80, 200, 12, "替代品牌", 12),
         _qitem("quo-5-3", "item-inq-5-2", 70, 50, 12, "华泰", 12),
     ],
     "total_amount": 19500, "remark": "轴承需外调，价格略高；法兰可现货供应。",
     "created_at": _day(-5, 9, 0), "updated_at": _day(-2, 10, 0)},
    {"id": "quo-5-2", "inquiry_id": "inq-5", "supplier_id": "sup-5",
     "supplier_name": SUP_NAME["sup-5"], "status": "SUBMITTED",
     "submitted_at": _day(-3, 15, 0),
     "items": [
         _qitem("quo-5-2", "item-inq-5-1", 34, 200, 40, "替代品牌", 12),
         _qitem("quo-5-2", "item-inq-5-2", 63, 50, 40, "华泰", 12),
     ],
     "total_amount": 9950, "remark": "部分物料需调配，交货周期较长。",
     "created_at": _day(-5, 14, 0), "updated_at": _day(-3, 15, 0)},
    {"id": "quo-6-1", "inquiry_id": "inq-6", "supplier_id": "sup-6",
     "supplier_name": SUP_NAME["sup-6"], "status": "TIMEOUT", "submitted_at": None,
     "items": [], "total_amount": 0, "remark": "未在截止时间前提交报价。",
     "created_at": _day(-10, 9, 0), "updated_at": _day(-5, 18, 0)},
    {"id": "quo-6-2", "inquiry_id": "inq-6", "supplier_id": "sup-5",
     "supplier_name": SUP_NAME["sup-5"], "status": "TIMEOUT", "submitted_at": None,
     "items": [], "total_amount": 0, "remark": "未在截止时间前提交报价。",
     "created_at": _day(-10, 9, 0), "updated_at": _day(-5, 18, 0)},
    {"id": "quo-7-2", "inquiry_id": "inq-7", "supplier_id": "sup-2",
     "supplier_name": SUP_NAME["sup-2"], "status": "SUBMITTED",
     "submitted_at": _day(-15, 16, 0),
     "items": [
         _qitem("quo-7-2", "item-inq-7-1", 880, 15, 10, "华为", 36),
         _qitem("quo-7-2", "item-inq-7-2", 4100, 8, 12, "西门子", 36),
     ],
     "total_amount": 46000, "remark": "含编程调试服务，PLC 提供现场技术支持。",
     "created_at": _day(-17, 9, 0), "updated_at": _day(-15, 16, 0)},
    {"id": "quo-7-4", "inquiry_id": "inq-7", "supplier_id": "sup-4",
     "supplier_name": SUP_NAME["sup-4"], "status": "SUBMITTED",
     "submitted_at": _day(-14, 15, 0),
     "items": [
         _qitem("quo-7-4", "item-inq-7-1", 820, 15, 9, "华为", 36),
         _qitem("quo-7-4", "item-inq-7-2", 4300, 8, 11, "西门子", 36),
     ],
     "total_amount": 46700, "remark": "交换机价格优势明显，可快速交货。",
     "created_at": _day(-17, 10, 0), "updated_at": _day(-14, 15, 0)},
]


# ============ 初始化 ============

def init_db(db: Session):
    """首启注入种子数据：若 users 表为空则注入"""
    if db.query(User).count() > 0:
        # 兼容旧库：为缺失 password_hash 的用户回填默认演示密码哈希
        for u in db.query(User).filter(User.password_hash.is_(None)).all():
            u.password_hash = hash_password(DEMO_USER_PASSWORD)
        # 即便用户已存在，也确保 AppSettings 单行存在（防止旧 DB 缺失）
        if db.query(AppSettings).filter(AppSettings.id == 1).first() is None:
            db.add(AppSettings(
                id=1, approval_enabled=True, approval_amount_threshold=50000,
                approval_approver_id="u-2", notification_deadline_reminder=True,
                notification_deadline_reminder_hours=24, notification_quotation_submitted=True,
                notification_approval_result=True,
            ))
        db.commit()
        return

    # 用户（写入 bcrypt 密码哈希，供生产模式校验）
    for u in USERS:
        db.add(User(**u, password_hash=hash_password(DEMO_USER_PASSWORD)))

    # 物料
    for m in MATERIALS:
        db.add(Material(
            id=m["id"], code=m["code"], name=m["name"], category=m["category"],
            brand=m["brand"], spec=m["spec"], tech_params=m["techParams"],
            unit=m["unit"], stock_qty=m["stockQty"],
        ))

    # 供应商
    for s in SUPPLIERS:
        db.add(Supplier(
            id=s["id"], code=s["code"], name=s["name"], region=s["region"],
            contact=s["contact"], phone=s["phone"], email=s["email"],
            main_categories=s["mainCategories"], level=s["level"],
            cooperation_status=s["cooperationStatus"], qualified=s["qualified"],
            history_response_rate=s["historyResponseRate"],
            history_fulfillment_rate=s["historyFulfillmentRate"],
            avg_delivery_days=s["avgDeliveryDays"],
            last_cooperate_time=s["lastCooperateTime"],
            history_coop_count=s["historyCoopCount"],
        ))

    # 询价单（含 items / logs / approval_nodes / invited suppliers）
    for inq_data in INQUIRIES:
        inq = Inquiry(
            id=inq_data["id"], code=inq_data["code"], subject=inq_data["subject"],
            organization=inq_data["organization"], owner_name=inq_data["owner_name"],
            owner_id=inq_data["owner_id"], currency=inq_data["currency"],
            deadline=inq_data["deadline"],
            expected_delivery_date=inq_data["expected_delivery_date"],
            delivery_address=inq_data["delivery_address"], contact=inq_data["contact"],
            payment_terms=inq_data["payment_terms"],
            invoice_requirement=inq_data["invoice_requirement"],
            description=inq_data["description"], status=inq_data["status"],
            created_by_id=inq_data["created_by_id"],
            created_by_name=inq_data["created_by_name"],
            created_at=inq_data["created_at"], updated_at=inq_data["updated_at"],
            selected_supplier_map=inq_data["selected_supplier_map"],
            purchaser_comments=inq_data["purchaser_comments"],
        )
        for it in inq_data["items"]:
            inq.items.append(InquiryItem(
                id=it["id"], inquiry_id=it["inquiry_id"], material_id=it["material_id"],
                name=it["name"], code=it["code"], category=it["category"],
                brand=it["brand"], spec=it["spec"], tech_params=it["tech_params"],
                unit=it["unit"], quantity=it["quantity"], target_price=it["target_price"],
                expected_delivery_date=it["expected_delivery_date"], remark=it["remark"],
            ))
        for lg in inq_data["logs"]:
            inq.logs.append(InquiryLog(
                id=lg["id"], inquiry_id=lg["inquiry_id"], time=lg["time"],
                operator=lg["operator"], operator_role=lg["operator_role"],
                type=lg["type"], content=lg["content"], result=lg["result"],
            ))
        for nd in inq_data["approval_nodes"]:
            inq.approval_nodes.append(ApprovalNode(
                id=nd["id"], inquiry_id=nd["inquiry_id"], node_order=nd["node_order"],
                approver_id=nd["approver_id"], approver_name=nd["approver_name"],
                approver_role=nd["approver_role"], status=nd["status"],
                comment=nd.get("comment"), time=nd.get("time"),
            ))
        for sup_id in inq_data["invited_supplier_ids"]:
            sup = db.query(Supplier).filter(Supplier.id == sup_id).first()
            if sup is not None:
                inq.invited_suppliers.append(sup)
        db.add(inq)

    # 报价单
    for q_data in QUOTATIONS:
        q = Quotation(
            id=q_data["id"], inquiry_id=q_data["inquiry_id"],
            supplier_id=q_data["supplier_id"], supplier_name=q_data["supplier_name"],
            status=q_data["status"], submitted_at=q_data["submitted_at"],
            total_amount=q_data["total_amount"], remark=q_data["remark"],
            created_at=q_data["created_at"], updated_at=q_data["updated_at"],
        )
        for it in q_data["items"]:
            q.items.append(QuotationItem(
                id=it["id"], quotation_id=it["quotation_id"],
                inquiry_item_id=it["inquiry_item_id"], unit_price=it["unit_price"],
                tax_rate=it["tax_rate"], tax_included_total=it["tax_included_total"],
                moq=it["moq"], delivery_days=it["delivery_days"],
                delivery_date=it["delivery_date"], brand=it["brand"],
                warranty_months=it["warranty_months"], payment_terms=it["payment_terms"],
                valid_until=it["valid_until"],
            ))
        db.add(q)

    # 设置（单行默认值）
    db.add(AppSettings(
        id=1, approval_enabled=True, approval_amount_threshold=50000,
        approval_approver_id="u-2", notification_deadline_reminder=True,
        notification_deadline_reminder_hours=24, notification_quotation_submitted=True,
        notification_approval_result=True,
    ))

    db.commit()
