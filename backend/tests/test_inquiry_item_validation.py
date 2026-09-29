"""R35：坏写不得毒掉整个询价列表；非编号冲突不得被说成"编号生成冲突"

现场一（实测复现于 dev compose 栈）：
  POST /api/inquiries 带 items[0].quantity="NOT-A-NUMBER" → 该行**落库成功**，
  随后 GET /api/inquiries 对所有人返回 500，traceback 落在
  `serializers.py:inquiry_item_to_schema` → `InquiryItemSchema.quantity`
  `Input should be a valid integer ... input_value='NOT-A-NUMBER'`。
  原因：`_build_inquiry_items` 原样透传，SQLite 列不校验类型，读侧 schema 要求 int。

现场二：把一条已存在的单改 id 后回 POST（子行 items[].id 已存在）→
  IntegrityError 被重试循环吞掉，连撞 5 次后回 500「编号生成冲突重试耗尽」——
  原因说错了，而且这类冲突重试多少次都会同样失败。
"""

import itertools

_seq = itertools.count()


def _payload(quantity, name="交换机"):
    """item id 必须逐次唯一：固定 id 会让本模块自己的用例互相撞主键（写用例时踩过一次）"""
    n = next(_seq)
    return {
        "subject": f"R35 校验用例 {n}",
        "items": [{"id": f"it-r35-{n}", "name": name, "unit": "台", "quantity": quantity}],
    }


def test_不可表示的_quantity_被_422_拒绝而不是_500(client, buyer_headers):
    resp = client.post("/api/inquiries", json=_payload("NOT-A-NUMBER"), headers=buyer_headers)
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail["error_type"] == "invalid_inquiry_item"
    assert "quantity" in detail["fields"], detail
    assert detail["index"] == 0


def test_坏写之后列表仍可读且没有多出记录(client, buyer_headers):
    """这条才是 R35 的真正牙齿：只断"这次请求返回什么"抓不到"行已经落库"。"""
    before = client.get("/api/inquiries", headers=buyer_headers)
    assert before.status_code == 200, before.text
    n_before = len(before.json())

    bad = client.post("/api/inquiries", json=_payload("NOT-A-NUMBER"), headers=buyer_headers)
    assert bad.status_code == 422, bad.text

    after = client.get("/api/inquiries", headers=buyer_headers)
    assert after.status_code == 200, (
        f"一次被拒绝的写把列表端点打挂了：{after.status_code} {after.text[:200]}"
    )
    assert len(after.json()) == n_before, "被拒绝的写不应该留下任何行"


def test_可转换的数字字符串按转换后的值落库(client, buyer_headers):
    """lax 语义：'10' 是合法输入，但库里必须是 int 10，否则读侧照样炸。"""
    resp = client.post("/api/inquiries", json=_payload("10"), headers=buyer_headers)
    assert resp.status_code == 200, resp.text
    created = resp.json()
    assert created["items"][0]["quantity"] == 10
    assert isinstance(created["items"][0]["quantity"], int)

    listed = client.get("/api/inquiries", headers=buyer_headers)
    assert listed.status_code == 200, listed.text
    row = next(i for i in listed.json() if i["id"] == created["id"])
    assert row["items"][0]["quantity"] == 10


def test_非字符串的_name_同样被拒(client, buyer_headers):
    """读侧 name: str；写进 dict 一样会毒掉列表，所以判据不能只盯 quantity 一列。"""
    n = next(_seq)
    resp = client.post(
        "/api/inquiries",
        json={
            "subject": f"R35 name 类型 {n}",
            "items": [{"id": f"it-r35-name-{n}", "name": {"nested": 1}}],
        },
        headers=buyer_headers,
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["error_type"] == "invalid_inquiry_item"
    assert client.get("/api/inquiries", headers=buyer_headers).status_code == 200


def test_更新路径同样校验(client, buyer_headers):
    created = client.post("/api/inquiries", json=_payload(5), headers=buyer_headers)
    assert created.status_code == 200, created.text
    body = created.json()
    resp = client.put(
        f"/api/inquiries/{body['id']}",
        json={
            "items": [{"id": body["items"][0]["id"], "name": "x", "quantity": "STILL-BAD"}],
            "version": body["version"],
        },
        headers=buyer_headers,
    )
    assert resp.status_code == 422, resp.text
    assert client.get("/api/inquiries", headers=buyer_headers).status_code == 200


def test_子行主键冲突报_409_而不是谎称编号碰撞(client, buyer_headers):
    """现场二：复用已存在的 items[].id。原实现回 500 且 detail 说"编号生成冲突"。"""
    first = client.post("/api/inquiries", json=_payload(3), headers=buyer_headers)
    assert first.status_code == 200, first.text
    shared_item_id = first.json()["items"][0]["id"]

    again = client.post(
        "/api/inquiries",
        json={
            "subject": "R35 复用子行 id",
            "items": [{"id": shared_item_id, "name": "交换机", "quantity": 3}],
        },
        headers=buyer_headers,
    )
    assert again.status_code == 409, again.text
    detail = again.json()["detail"]
    assert detail["error_type"] == "inquiry_conflict"
    # 判据的核心：不得把非编号冲突说成编号碰撞。
    # 注意别写成 `"编号" not in message` —— 实现里"（非编号碰撞）"这种**否认**句
    # 会被它命中（本用例第一版就是这么假红的），要钉的是那句被伪造出来的原因。
    assert "编号生成冲突" not in detail["message"], detail
    assert detail["error_type"] != "inquiry_code_exhausted"
    assert client.get("/api/inquiries", headers=buyer_headers).status_code == 200
