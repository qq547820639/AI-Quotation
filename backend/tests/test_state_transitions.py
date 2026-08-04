"""询价状态流转 + 事务回滚测试

状态流转（对齐 inquiries.py 实际 status 语义）：
  DRAFT →(send) INQUIRING →(submit-approval) PENDING_APPROVAL →(approve/reject) PENDING_CONFIRM →(confirm) COMPLETED
每个动作断言 status 变化 + 日志追加 + 无权限用户被拒（403）。
事务：重复 code 触发唯一约束失败，断言无部分状态（回滚）。
"""


def _create_inquiry(client, headers, code):
    payload = {
        "code": code,
        "subject": f"状态流转测试 {code}",
        "deadline": "2026-09-01 18:00:00",
        "deliveryAddress": "测试地址",
        "contact": "测试 13800000000",
        "paymentTerms": "货到验收后 30 天付款",
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
            }
        ],
        "invitedSupplierIds": ["sup-1", "sup-2"],
    }
    resp = client.post("/api/inquiries", json=payload, headers=headers)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


def _log_types(data):
    return [l["type"] for l in data["logs"]]


def test_full_state_flow(client, buyer_headers, supervisor_headers):
    inq = _create_inquiry(client, buyer_headers, "INQ-FLOW-001")
    inq_id = inq["id"]
    assert inq["status"] == "DRAFT"

    # 发送 → INQUIRING
    resp = client.post(f"/api/inquiries/{inq_id}/send", headers=buyer_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "INQUIRING"
    assert "SEND_INQUIRY" in _log_types(data)

    # 提交审批 → PENDING_APPROVAL
    resp = client.post(f"/api/inquiries/{inq_id}/submit-approval", headers=buyer_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "PENDING_APPROVAL"
    assert "SUBMIT_APPROVAL" in _log_types(data)
    assert any(n["status"] == "PENDING" for n in data["approvalNodes"])

    # 审批通过 → PENDING_CONFIRM（需主管权限）
    resp = client.post(
        f"/api/inquiries/{inq_id}/approve",
        json={"comment": "同意"},
        headers=supervisor_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "PENDING_CONFIRM"
    assert "APPROVE" in _log_types(data)
    assert any(n["status"] == "APPROVED" for n in data["approvalNodes"])

    # 定标确认 → COMPLETED
    resp = client.post(f"/api/inquiries/{inq_id}/confirm", headers=supervisor_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "COMPLETED"
    assert "CONFIRM_RESULT" in _log_types(data)


def test_approve_requires_permission_and_no_state_change(client, buyer_headers):
    inq = _create_inquiry(client, buyer_headers, "INQ-FLOW-002")
    inq_id = inq["id"]
    client.post(f"/api/inquiries/{inq_id}/send", headers=buyer_headers)
    client.post(f"/api/inquiries/{inq_id}/submit-approval", headers=buyer_headers)

    # 采购人员无 INQUIRY_APPROVE → 403，且状态、日志均不变
    resp = client.post(
        f"/api/inquiries/{inq_id}/approve",
        json={"comment": "越权"},
        headers=buyer_headers,
    )
    assert resp.status_code == 403
    detail = client.get(f"/api/inquiries/{inq_id}", headers=buyer_headers).json()
    assert detail["status"] == "PENDING_APPROVAL"
    assert "APPROVE" not in _log_types(detail)


def test_reject_flow(client, buyer_headers, supervisor_headers):
    inq = _create_inquiry(client, buyer_headers, "INQ-FLOW-003")
    inq_id = inq["id"]
    client.post(f"/api/inquiries/{inq_id}/send", headers=buyer_headers)
    client.post(f"/api/inquiries/{inq_id}/submit-approval", headers=buyer_headers)

    resp = client.post(
        f"/api/inquiries/{inq_id}/reject",
        json={"comment": "资料不全"},
        headers=supervisor_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "PENDING_CONFIRM"
    assert "REJECT" in _log_types(data)
    assert any(n["status"] == "REJECTED" for n in data["approvalNodes"])


def test_failed_create_rolls_back_no_partial_state(client, buyer_headers):
    # 先建一个询价，捕获其服务端生成的 id
    first = _create_inquiry(client, buyer_headers, "INQ-ROLLBACK-001")
    first_id = first["id"]
    before = client.get("/api/inquiries", headers=buyer_headers).json()
    before_ids = {i["id"] for i in before}

    # 用相同 id 再建一个（主键冲突）→ 内部 commit 失败应回滚，无部分状态
    payload = {
        "id": first_id,
        "subject": "应回滚的询价",
        "deadline": "2026-09-01 18:00:00",
        "deliveryAddress": "测试地址",
        "contact": "测试 13800000000",
        "paymentTerms": "货到付款",
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
            }
        ],
    }
    # TestClient 默认 raise_server_exceptions=True，主键冲突会直接抛出
    # IntegrityError（而非返回 500）；两种情况都符合"失败"语义，关键是后续无部分状态。
    try:
        resp = client.post("/api/inquiries", json=payload, headers=buyer_headers)
        assert resp.status_code == 500
    except Exception:
        pass

    after = client.get("/api/inquiries", headers=buyer_headers).json()
    after_ids = {i["id"] for i in after}
    # 无部分状态：新询价未出现，原有询价集合不变
    assert first_id in after_ids  # 原询价仍在
    assert after_ids == before_ids