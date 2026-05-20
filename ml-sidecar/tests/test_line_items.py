"""Coverage for /score-line-items invoice anomaly detection."""


def test_empty_line_items_returns_low_risk(client):
    resp = client.post("/score-line-items", json={"claimId": "c1", "lineItems": []})
    assert resp.status_code == 200
    body = resp.json()
    assert body["itemCount"] == 0
    assert body["overallRisk"] == "low"
    assert body["invoiceFraudProbability"] == 0.0


def test_arithmetic_mismatch_is_flagged(client):
    # 2 x 1000 should be 2000, not 5000.
    resp = client.post("/score-line-items", json={
        "claimId": "c1",
        "lineItems": [
            {"description": "Consultation fee", "quantity": 2,
             "unitPrice": 1000, "totalPrice": 5000},
        ],
    })
    body = resp.json()
    item = body["results"][0]
    assert item["arithmeticValid"] is False
    assert body["arithmeticErrors"] == 1
    assert any("Arithmetic" in f for f in item["flags"])


def test_clean_invoice_scores_low(client):
    items = [
        {"description": "Diagnostic lab panel", "quantity": 1,
         "unitPrice": 1499, "totalPrice": 1499}
        for _ in range(2)
    ]
    resp = client.post("/score-line-items", json={
        "claimId": "c1", "invoiceTotal": 2998, "lineItems": items,
    })
    body = resp.json()
    assert body["arithmeticErrors"] == 0
    assert body["overallRisk"] == "low"
    assert body["calculatedTotal"] == 2998
    assert body["invoiceLevelFlags"] == []


def test_invoice_total_discrepancy_is_flagged(client):
    resp = client.post("/score-line-items", json={
        "claimId": "c1",
        "invoiceTotal": 10_000,
        "lineItems": [
            {"description": "X-Ray imaging service", "quantity": 1,
             "unitPrice": 2000, "totalPrice": 2000},
        ],
    })
    body = resp.json()
    assert body["calculatedTotal"] == 2000
    assert len(body["invoiceLevelFlags"]) >= 1
    assert any("differs from line item sum" in f for f in body["invoiceLevelFlags"])


def test_price_outlier_gets_high_z_score(client):
    items = [
        {"description": "Routine lab test", "quantity": 1,
         "unitPrice": 1000, "totalPrice": 1000}
        for _ in range(5)
    ]
    items.append({"description": "Unusually expensive line", "quantity": 1,
                  "unitPrice": 50_000, "totalPrice": 50_000})
    resp = client.post("/score-line-items", json={"claimId": "c1", "lineItems": items})
    body = resp.json()
    assert body["itemCount"] == 6
    outlier = body["results"][-1]
    assert outlier["priceZScore"] > 2.0
