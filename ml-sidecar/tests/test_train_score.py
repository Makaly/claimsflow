"""Coverage for /train, /score and the heuristic fallback path."""


def _training_payload(n_legit: int = 15, n_fraud: int = 10) -> dict:
    """Build a labelled dataset with a clear, learnable fraud signal."""
    rows = []
    for i in range(n_legit):
        rows.append({
            "label": "legitimate",
            "features": {
                "invoiceAmount": 1000 + i * 50,
                "ocrConfidence": 0.95,
                "anomalyScore": 0.05,
                "fraudSignalCount": 0,
                "fraudSignalCritical": 0,
                "resubmissionCount": 0,
                "memberNumberPresent": 1,
            },
        })
    for i in range(n_fraud):
        rows.append({
            "label": "fraud",
            "features": {
                "invoiceAmount": 80_000 + i * 5_000,
                "ocrConfidence": 0.50,
                "anomalyScore": 0.85,
                "fraudSignalCount": 4,
                "fraudSignalCritical": 2,
                "resubmissionCount": 3,
                "memberNumberPresent": 0,
            },
        })
    return {"data": rows}


def test_train_rejects_too_few_rows(client):
    resp = client.post("/train", json=_training_payload(n_legit=6, n_fraud=6))
    assert resp.status_code == 400


def test_train_rejects_class_imbalance(client):
    # 22 rows total clears the row-count gate, but 0 fraud rows fails the
    # per-class minimum.
    resp = client.post("/train", json=_training_payload(n_legit=22, n_fraud=0))
    assert resp.status_code == 400


def test_score_heuristic_fallback_when_no_model(client, fresh_models):
    resp = client.post("/score", json={
        "claimId": "h1",
        "features": {
            "anomalyScore": 0.9,
            "fraudSignalCritical": 3,
            "fraudSignalCount": 5,
            "memberNumberPresent": 0,
        },
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["modelUsed"] == "heuristic_fallback"
    assert body["riskLevel"] == "high"
    assert 0.0 <= body["fraudProbability"] <= 1.0


def test_score_heuristic_fallback_low_risk_for_clean_claim(client, fresh_models):
    resp = client.post("/score", json={
        "claimId": "h2",
        "features": {"ocrConfidence": 0.99, "memberNumberPresent": 1},
    })
    body = resp.json()
    assert body["riskLevel"] == "low"


def test_train_then_score_uses_the_model(client, fresh_models):
    train = client.post("/train", json=_training_payload())
    assert train.status_code == 200, train.text
    meta = train.json()
    assert meta["success"] is True
    assert meta["sampleSize"] == 25
    assert meta["fraudCount"] == 10
    assert meta["legitimateCount"] == 15
    assert set(meta["featureImportances"]) >= {"invoiceAmount", "anomalyScore"}

    # A fraud-shaped claim should now be scored by the trained model.
    score = client.post("/score", json={
        "claimId": "c1",
        "features": {
            "invoiceAmount": 95_000,
            "ocrConfidence": 0.50,
            "anomalyScore": 0.85,
            "fraudSignalCount": 4,
            "fraudSignalCritical": 2,
            "resubmissionCount": 3,
            "memberNumberPresent": 0,
        },
    })
    assert score.status_code == 200
    body = score.json()
    assert body["modelUsed"].startswith("gradient_boosting")
    assert 0.0 <= body["fraudProbability"] <= 1.0

    # /weights should now report the trained model.
    weights = client.get("/weights")
    assert weights.json()["modelLoaded"] is True
