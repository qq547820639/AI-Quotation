"""报价收集进度推进（回归：供应商全部报价后询价仍停在 INQUIRING）

询价状态机声明了 INQUIRING → PARTIAL_QUOTED → ALL_QUOTED，但后端此前没有任何写入口
推进它：门户提交报价只写报价单本身。结果是报价对比页的「定标 / 提交审批」入口
（要求 ALL_QUOTED 或 PENDING_CONFIRM）永远不出现，采购→报价→定标链路在服务端断头。
"""
import pytest

ITEM_PRICE = 4200


def _create_and_send(client, buyer_headers, code):
    """建单（受邀 sup-1 + sup-2）→ 发送，返回 (询价 id, 明细 id)"""
    payload = {
        "code": code,
        "subject": f"报价进度回归-{code}",
        "deadline": "2030-09-01 18:00:00",
        "deliveryAddress": "测试地址",
        "contact": "测试 13800000000",
        "paymentTerms": "货到验收后 30 天付款",
        "invitedSupplierIds": ["sup-1", "sup-2"],
        "items": [
            {
                "materialId": "mat-1",
                "name": "工业交换机",
                "code": "MAT001",
                "category": "电子设备",
                "brand": "华为",
                "spec": "8口千兆",
                "techParams": "8口",
                "unit": "台",
                "quantity": 10,
                "targetPrice": 800,
            }
        ],
    }
    created = client.post("/api/inquiries", json=payload, headers=buyer_headers)
    assert created.status_code in (200, 201), created.text
    body = created.json()
    inquiry_id = body["id"]
    item_id = body["items"][0]["id"]

    sent = client.post(
        f"/api/inquiries/{inquiry_id}/send",
        json={"version": body.get("version", 1)},
        headers=buyer_headers,
    )
    assert sent.status_code == 200, sent.text
    assert sent.json()["status"] == "INQUIRING"
    return inquiry_id, item_id


def _token_for(client, buyer_headers, inquiry_id, supplier_id) -> str:
    """重新生成该供应商的邀请 Token（原始 token 不落库，只能从该接口响应拿到）"""
    regen = client.post(
        f"/api/inquiries/{inquiry_id}/invitations/{supplier_id}/regenerate",
        headers=buyer_headers,
    )
    assert regen.status_code == 200, regen.text
    return regen.json()["token"]


def _submit_with_token(client, token, item_id):
    return client.post(
        "/api/portal/quotations/submit",
        headers={"X-Invitation-Token": token},
        json={
            "items": [
                {
                    "inquiryItemId": item_id,
                    "unitPrice": ITEM_PRICE,
                    "taxRate": 0.13,
                    "deliveryDays": 10,
                }
            ]
        },
    )


def _submit_quote(client, buyer_headers, inquiry_id, supplier_id, item_id):
    """用重新生成的邀请 Token 以供应商身份提交报价"""
    token = _token_for(client, buyer_headers, inquiry_id, supplier_id)
    resp = _submit_with_token(client, token, item_id)
    assert resp.status_code == 200, resp.text
    return resp


def test_status_is_inquiring_until_any_quote_submitted(client, buyer_headers):
    inquiry_id, item_id = _create_and_send(client, buyer_headers, "INQ-PROGRESS-0")
    assert (
        client.get(f"/api/inquiries/{inquiry_id}", headers=buyer_headers).json()["status"]
        == "INQUIRING"
    )
    _submit_quote(client, buyer_headers, inquiry_id, "sup-1", item_id)
    # 两家受邀只提交一家 → PARTIAL_QUOTED
    assert (
        client.get(f"/api/inquiries/{inquiry_id}", headers=buyer_headers).json()["status"]
        == "PARTIAL_QUOTED"
    )


def test_all_invited_quotes_advance_to_all_quoted(client, buyer_headers):
    inquiry_id, item_id = _create_and_send(client, buyer_headers, "INQ-PROGRESS-1")
    _submit_quote(client, buyer_headers, inquiry_id, "sup-1", item_id)
    _submit_quote(client, buyer_headers, inquiry_id, "sup-2", item_id)
    data = client.get(f"/api/inquiries/{inquiry_id}", headers=buyer_headers).json()
    assert data["status"] == "ALL_QUOTED", data


def test_repeat_submission_does_not_move_status_backward(client, buyer_headers):
    """重复提交（幂等回执）不得把 ALL_QUOTED 拉回 PARTIAL_QUOTED"""
    inquiry_id, item_id = _create_and_send(client, buyer_headers, "INQ-PROGRESS-2")
    _submit_quote(client, buyer_headers, inquiry_id, "sup-1", item_id)
    _submit_quote(client, buyer_headers, inquiry_id, "sup-2", item_id)
    _submit_quote(client, buyer_headers, inquiry_id, "sup-2", item_id)
    assert (
        client.get(f"/api/inquiries/{inquiry_id}", headers=buyer_headers).json()["status"]
        == "ALL_QUOTED"
    )


def test_portal_submit_broadcasts_quotation_event(client, buyer_headers, monkeypatch):
    """门户提交必须广播 quotation_submitted

    采购端 SSE「免刷新」的唯一触发源是这个事件；此前只有内部提交路径
    （POST /api/quotations/{id}/submit）广播，而供应商实际走门户路径。
    """
    calls = []
    monkeypatch.setattr(
        "app.routers.portal.publish", lambda *args, **kwargs: calls.append(args)
    )
    inquiry_id, item_id = _create_and_send(client, buyer_headers, "INQ-PROGRESS-3")
    token = _token_for(client, buyer_headers, inquiry_id, "sup-1")
    assert _submit_with_token(client, token, item_id).status_code == 200

    assert calls, "门户提交报价未广播 SSE 事件"
    (event_type, data), = calls
    assert event_type == "quotation_submitted"
    assert set(data) == {"quotationId", "inquiryId", "supplierId"}
    assert data["inquiryId"] == inquiry_id
    assert data["supplierId"] == "sup-1"
    assert data["quotationId"]

    # 同一邀请再次提交：走「已提交」提前返回分支，只回放回执，不得重复广播
    assert _submit_with_token(client, token, item_id).status_code == 200
    assert len(calls) == 1, calls
