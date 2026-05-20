"""Coverage for /image-quality and /preprocess-image (OpenCV pipeline)."""
import base64

from conftest import make_image_b64

# Valid base64, but the decoded bytes are not a real image.
NOT_AN_IMAGE = base64.b64encode(b"this is plainly not an image file").decode("ascii")


def test_image_quality_portrait_document(client):
    resp = client.post("/image-quality", json={"imageBase64": make_image_b64(850, 1100)})
    assert resp.status_code == 200
    body = resp.json()
    assert body["orientation"] == "portrait"
    assert 0.0 <= body["overallScore"] <= 1.0
    assert isinstance(body["recommendedPipeline"], list)
    # The numbered pipeline must be gap-free (1., 2., 3., ...).
    for idx, step in enumerate(body["recommendedPipeline"], 1):
        assert step.startswith(f"{idx}.")


def test_image_quality_landscape_recommends_auto_rotate(client):
    # Regression test: the orientation check previously read a non-existent
    # 'orientationScore' key, so auto-rotate was never recommended.
    resp = client.post("/image-quality", json={"imageBase64": make_image_b64(1100, 850)})
    body = resp.json()
    assert body["orientation"] == "landscape"
    assert any("Auto-rotate" in step for step in body["recommendedPipeline"])


def test_image_quality_rejects_non_image(client):
    resp = client.post("/image-quality", json={"imageBase64": NOT_AN_IMAGE})
    assert resp.status_code == 400


def test_preprocess_runs_full_pipeline(client):
    resp = client.post("/preprocess-image", json={"imageBase64": make_image_b64(850, 1100)})
    assert resp.status_code == 200
    body = resp.json()
    assert body["originalWidth"] == 850
    assert body["originalHeight"] == 1100
    assert isinstance(body["stepsApplied"], list)
    assert "grayscale" in body["stepsApplied"]
    # The returned image must itself be valid base64.
    base64.b64decode(body["imageBase64"], validate=True)


def test_preprocess_honours_disabled_steps(client):
    resp = client.post("/preprocess-image", json={
        "imageBase64": make_image_b64(850, 1100),
        "deskew": False, "cropToPage": False, "removeShadow": False,
        "clahe": False, "denoise": False,
    })
    body = resp.json()
    steps = body["stepsApplied"]
    assert "grayscale" in steps
    assert "removeShadow" not in steps
    assert "clahe" not in steps
    assert "denoise" not in steps
    assert not any(s.startswith("deskew") for s in steps)


def test_preprocess_rejects_non_image(client):
    resp = client.post("/preprocess-image", json={"imageBase64": NOT_AN_IMAGE})
    assert resp.status_code == 400


def test_preprocess_rejects_malformed_base64(client):
    resp = client.post("/preprocess-image", json={"imageBase64": "@@@not-base64@@@"})
    assert resp.status_code == 400
