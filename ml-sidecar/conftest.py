"""
Shared pytest fixtures for the ML sidecar test suite.

This file lives at the package root (next to main.py) so `import main`
resolves cleanly and the model-path env vars are set *before* main.py is
imported — main.py reads MODEL_PATH / IFOREST_PATH at import time.
"""
import base64
import io
import os
import tempfile
from pathlib import Path

import pytest

# ── Redirect model persistence to a throwaway temp dir ────────────────────────
# Done at collection time, before any test module runs `import main`, so the
# suite never reads or writes the real /tmp/fraud_model.pkl on the host.
_TEST_MODEL_DIR = Path(tempfile.mkdtemp(prefix="ml-sidecar-test-"))
os.environ["MODEL_PATH"] = str(_TEST_MODEL_DIR / "fraud_model.pkl")
os.environ["IFOREST_PATH"] = str(_TEST_MODEL_DIR / "iforest_model.pkl")


@pytest.fixture(scope="session")
def client():
    """A FastAPI TestClient bound to the sidecar app."""
    from fastapi.testclient import TestClient
    import main

    return TestClient(main.app)


@pytest.fixture
def fresh_models():
    """
    Reset the in-memory + on-disk models so a test starts from a clean
    'no model trained' state. Use this for heuristic-fallback assertions.
    """
    import main

    main._model = None
    main._model_meta = {}
    main._iforest = None
    for path in (main.MODEL_PATH, main.IFOREST_PATH):
        if path.exists():
            path.unlink()
    yield


# ── Image helpers ─────────────────────────────────────────────────────────────

def make_image_b64(width: int = 850, height: int = 1100, mode: str = "RGB",
                   background: int = 245, with_text: bool = True) -> str:
    """
    Build a small document-like image and return it base64-encoded.
    Includes printed-text-like marks so quality/deskew steps have content.
    """
    from PIL import Image, ImageDraw

    img = Image.new(mode, (width, height),
                    background if mode == "L" else (background, background, background))
    if with_text:
        draw = ImageDraw.Draw(img)
        ink = 20 if mode == "L" else (20, 20, 20)
        for row in range(8):
            y = 80 + row * 90
            draw.rectangle([60, y, width - 60, y + 28], outline=ink, width=2)
            for col in range(6):
                x = 80 + col * ((width - 200) // 6)
                draw.text((x, y + 6), "INVOICE", fill=ink)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")
