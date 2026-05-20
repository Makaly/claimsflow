"""Health and weights endpoint coverage."""


def test_health_reports_ok_and_capabilities(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    # Capability flags must always be present so callers can degrade gracefully.
    for flag in ("sklearnAvailable", "pilAvailable", "scipyAvailable", "cv2Available"):
        assert flag in body
        assert isinstance(body[flag], bool)
    assert "modelLoaded" in body
    assert "iforestLoaded" in body


def test_weights_without_a_trained_model(client, fresh_models):
    resp = client.get("/weights")
    assert resp.status_code == 200
    body = resp.json()
    assert body["modelLoaded"] is False
    assert body["featureImportances"] == {}
