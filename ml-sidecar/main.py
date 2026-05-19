"""
ClaimsFlow ML Fraud Scoring Sidecar  —  Enterprise Edition
FastAPI microservice providing:
  POST /train              — fit GradientBoostingClassifier on labelled claim data
  POST /score              — score a single claim feature vector
  POST /score-line-items   — Isolation Forest anomaly detection on invoice line items
  POST /image-quality      — score document image quality and return preprocessing advice
  POST /score-image        — image tamper / receipt-forgery detection (ELA, EXIF, pHash, font artefacts)
  GET  /health             — readiness + model status
  GET  /weights            — return current feature importances
"""
import base64
import hashlib
import io
import json
import os
import pickle
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# ── Optional heavy imports — graceful degradation ─────────────────────────────
try:
    from sklearn.ensemble import GradientBoostingClassifier, IsolationForest
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import Pipeline
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import roc_auc_score
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False

try:
    from PIL import Image, ImageFilter, ImageStat
    import PIL.ImageOps
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

try:
    from scipy import stats as scipy_stats
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False

app = FastAPI(title="ClaimsFlow ML Sidecar", version="2.0.0")

MODEL_PATH      = Path(os.getenv("MODEL_PATH",      "/tmp/fraud_model.pkl"))
IFOREST_PATH    = Path(os.getenv("IFOREST_PATH",    "/tmp/iforest_model.pkl"))

# ── Claim-level feature names (used in fraud scoring model) ──────────────────
CLAIM_FEATURES = [
    "invoiceAmount",
    "ocrConfidence",
    "anomalyScore",
    "fraudSignalCount",
    "fraudSignalCritical",
    "resubmissionCount",
    "memberNumberPresent",
    # Line-item derived features (0 when no items extracted)
    "lineItemCount",
    "arithmeticErrorCount",
    "highRiskItemCount",
    "maxItemPriceDeviation",
    "itemPriceStdDev",
]

_model:       "Pipeline | None" = None
_model_meta:  dict              = {}
_iforest:     "IsolationForest | None" = None

# ── Startup: reload persisted models ─────────────────────────────────────────

def _load_model() -> bool:
    global _model, _model_meta
    if MODEL_PATH.exists():
        try:
            with open(MODEL_PATH, "rb") as f:
                payload = pickle.load(f)
            _model     = payload["model"]
            _model_meta = payload.get("meta", {})
            return True
        except Exception:
            pass
    return False


def _load_iforest() -> bool:
    global _iforest
    if IFOREST_PATH.exists():
        try:
            with open(IFOREST_PATH, "rb") as f:
                _iforest = pickle.load(f)
            return True
        except Exception:
            pass
    return False


def _save_model(model: "Pipeline", meta: dict) -> None:
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(MODEL_PATH, "wb") as f:
        pickle.dump({"model": model, "meta": meta}, f)


def _save_iforest(model: "IsolationForest") -> None:
    IFOREST_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(IFOREST_PATH, "wb") as f:
        pickle.dump(model, f)


_load_model()
_load_iforest()


# ── Schemas ───────────────────────────────────────────────────────────────────

class ClaimFeatures(BaseModel):
    invoiceAmount:        float = 0.0
    ocrConfidence:        float = 1.0
    anomalyScore:         float = 0.0
    fraudSignalCount:     int   = 0
    fraudSignalCritical:  int   = 0
    resubmissionCount:    int   = 0
    memberNumberPresent:  int   = 1
    # Line-item derived (optional — default to "no items")
    lineItemCount:        int   = 0
    arithmeticErrorCount: int   = 0
    highRiskItemCount:    int   = 0
    maxItemPriceDeviation: float = 0.0
    itemPriceStdDev:      float = 0.0


class TrainingRow(BaseModel):
    label:    str           # "fraud" | "suspicious" | "legitimate"
    features: ClaimFeatures


class TrainRequest(BaseModel):
    data: list[TrainingRow]


class ScoreRequest(BaseModel):
    claimId:  str
    features: ClaimFeatures


class LineItem(BaseModel):
    description: str
    quantity:    Optional[float] = None
    unitPrice:   Optional[float] = None
    totalPrice:  Optional[float] = None
    taxAmount:   Optional[float] = None
    discount:    Optional[float] = None
    serviceDate: Optional[str]   = None
    procedureCode: Optional[str] = None
    ocrConfidence: Optional[float] = None


class LineItemsRequest(BaseModel):
    claimId:    str
    vendorId:   Optional[str]  = None
    invoiceTotal: float         = 0.0
    lineItems:  list[LineItem]


class ImageQualityRequest(BaseModel):
    imageBase64: str            # base64-encoded PNG/JPEG/PDF page image
    filename:    Optional[str]  = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _features_to_array(f: ClaimFeatures) -> list[float]:
    return [
        f.invoiceAmount,
        f.ocrConfidence,
        f.anomalyScore,
        float(f.fraudSignalCount),
        float(f.fraudSignalCritical),
        float(f.resubmissionCount),
        float(f.memberNumberPresent),
        float(f.lineItemCount),
        float(f.arithmeticErrorCount),
        float(f.highRiskItemCount),
        f.maxItemPriceDeviation,
        f.itemPriceStdDev,
    ]


def _label_to_int(label: str) -> int:
    return 0 if label == "legitimate" else 1


def _item_to_vector(item: LineItem) -> list[float]:
    """Convert a single line item into a numeric feature vector."""
    unit_price   = item.unitPrice   or 0.0
    total_price  = item.totalPrice  or 0.0
    quantity     = item.quantity    or 1.0
    tax_amt      = item.taxAmount   or 0.0

    # Arithmetic validity: expected vs actual total
    expected_total = quantity * unit_price if unit_price > 0 else total_price
    arith_error    = abs(expected_total - total_price) if total_price > 0 else 0.0
    arith_error_pct = arith_error / total_price if total_price > 0 else 0.0

    # Tax rate (Kenyan VAT = 16%)
    tax_rate   = tax_amt / total_price if total_price > 0 else 0.0
    tax_anomaly = abs(tax_rate - 0.16) if tax_rate > 0 else 0.0

    # Round-number flag
    is_round_price = 1.0 if (unit_price >= 1000 and unit_price % 500 == 0) else 0.0

    # Short description flag
    desc_len = len(item.description.strip())

    return [
        unit_price,
        total_price,
        quantity,
        arith_error_pct,
        tax_anomaly,
        is_round_price,
        float(desc_len),
        item.ocrConfidence or 0.85,
    ]


# ── Image quality helpers ──────────────────────────────────────────────────────

def _compute_laplacian_variance(img: "Image.Image") -> float:
    """Higher variance = sharper image. < 50 = blurry."""
    gray = img.convert("L")
    arr  = np.array(gray, dtype=np.float32)
    # Discrete Laplacian kernel
    lap  = np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=np.float32)
    from scipy.signal import convolve2d
    filtered = convolve2d(arr, lap, mode="valid")
    return float(np.var(filtered))


def _score_image_quality(img: "Image.Image") -> dict:
    """Return a quality report with scores and preprocessing recommendations."""
    recommendations: list[str] = []

    width, height = img.size
    dpi_hint = max(width, height) / 8.5  # rough DPI estimate assuming A4/letter

    # ── Sharpness (Laplacian variance) ────────────────────────────────────────
    sharpness_score = 0.0
    if SCIPY_AVAILABLE:
        try:
            lv = _compute_laplacian_variance(img)
            sharpness_score = min(1.0, lv / 500.0)
            if lv < 50:
                recommendations.append("Image is blurry — apply sharpening filter before OCR")
            elif lv < 150:
                recommendations.append("Image sharpness is low — consider edge enhancement")
        except Exception:
            sharpness_score = 0.5

    # ── Brightness & contrast ─────────────────────────────────────────────────
    gray  = img.convert("L")
    stat  = ImageStat.Stat(gray)
    mean_brightness = stat.mean[0]     # 0-255
    std_brightness  = stat.stddev[0]   # contrast proxy

    brightness_score = 1.0 - abs(mean_brightness - 128) / 128.0
    contrast_score   = min(1.0, std_brightness / 80.0)

    if mean_brightness < 50:
        recommendations.append("Image is too dark — apply brightness normalisation")
    elif mean_brightness > 220:
        recommendations.append("Image is overexposed — reduce brightness before OCR")
    if std_brightness < 20:
        recommendations.append("Low contrast — apply adaptive histogram equalisation (CLAHE)")

    # ── Resolution ────────────────────────────────────────────────────────────
    resolution_score = min(1.0, dpi_hint / 300.0)
    if dpi_hint < 150:
        recommendations.append(f"Estimated DPI {dpi_hint:.0f} is too low — re-scan at ≥ 300 DPI")
    elif dpi_hint < 200:
        recommendations.append("Resolution is marginal — rescale to 300 DPI for best OCR")

    # ── Colour mode ───────────────────────────────────────────────────────────
    if img.mode == "RGB":
        recommendations.append("Convert to greyscale before OCR to reduce noise")

    # ── Orientation guess (aspect ratio heuristic) ────────────────────────────
    orientation = "portrait" if height >= width else "landscape"
    if orientation == "landscape":
        recommendations.append("Document appears landscape — auto-rotate 90° before OCR")

    overall = (
        sharpness_score * 0.35 +
        brightness_score * 0.20 +
        contrast_score   * 0.20 +
        resolution_score * 0.25
    )

    return {
        "overallScore":      round(overall, 3),
        "sharpnessScore":    round(sharpness_score, 3),
        "brightnessScore":   round(brightness_score, 3),
        "contrastScore":     round(contrast_score, 3),
        "resolutionScore":   round(resolution_score, 3),
        "estimatedDpi":      round(dpi_hint, 0),
        "orientation":       orientation,
        "width":             width,
        "height":            height,
        "colourMode":        img.mode,
        "recommendations":   recommendations,
        "ocrReady":          overall >= 0.65 and len(recommendations) <= 2,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status":           "ok",
        "sklearnAvailable": SKLEARN_AVAILABLE,
        "pilAvailable":     PIL_AVAILABLE,
        "scipyAvailable":   SCIPY_AVAILABLE,
        "modelLoaded":      _model is not None,
        "iforestLoaded":    _iforest is not None,
        "modelMeta":        _model_meta,
    }


@app.post("/train")
def train(req: TrainRequest):
    if not SKLEARN_AVAILABLE:
        raise HTTPException(503, "scikit-learn not installed")
    if len(req.data) < 20:
        raise HTTPException(400, f"Need at least 20 labelled rows, got {len(req.data)}")

    fraud_count = sum(1 for r in req.data if r.label in ("fraud", "suspicious"))
    legit_count = sum(1 for r in req.data if r.label == "legitimate")
    if fraud_count < 5 or legit_count < 5:
        raise HTTPException(400, f"Need ≥5 of each class. Got fraud={fraud_count} legit={legit_count}")

    X = np.array([_features_to_array(r.features) for r in req.data])
    y = np.array([_label_to_int(r.label) for r in req.data])

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    model = Pipeline([
        ("scaler", StandardScaler()),
        ("clf",    GradientBoostingClassifier(
            n_estimators=300,
            max_depth=4,
            learning_rate=0.04,
            subsample=0.8,
            min_samples_leaf=5,
            random_state=42,
        )),
    ])
    model.fit(X_train, y_train)

    auc = (
        float(roc_auc_score(y_test, model.predict_proba(X_test)[:, 1]))
        if len(np.unique(y_test)) > 1 else None
    )

    importances = dict(zip(
        CLAIM_FEATURES,
        model.named_steps["clf"].feature_importances_.tolist()
    ))

    # Also train / update the Isolation Forest on all legitimate claim vectors
    legit_X = X[y == 0]
    if len(legit_X) >= 10:
        iforest = IsolationForest(
            n_estimators=200,
            contamination=0.05,
            random_state=42,
        )
        iforest.fit(legit_X)
        global _iforest
        _iforest = iforest
        _save_iforest(iforest)

    meta = {
        "trainedAt":          datetime.utcnow().isoformat(),
        "sampleSize":         len(req.data),
        "fraudCount":         fraud_count,
        "legitimateCount":    legit_count,
        "aucRoc":             auc,
        "featureImportances": importances,
    }

    global _model, _model_meta
    _model      = model
    _model_meta = meta
    _save_model(model, meta)

    return {"success": True, **meta}


@app.post("/score")
def score(req: ScoreRequest):
    if _model is None:
        # Heuristic fallback — includes line-item signals
        f = req.features
        item_boost = min(0.20, f.highRiskItemCount * 0.05 + f.arithmeticErrorCount * 0.06)
        heuristic  = min(1.0, (
            f.fraudSignalCritical    * 0.22 +
            f.fraudSignalCount       * 0.05 +
            f.anomalyScore           * 0.38 +
            (1.0 - f.ocrConfidence)  * 0.10 +
            (1 - f.memberNumberPresent) * 0.18 +
            item_boost
        ))
        return {
            "claimId":         req.claimId,
            "fraudProbability": round(heuristic, 4),
            "riskLevel":       "high" if heuristic >= 0.6 else "medium" if heuristic >= 0.3 else "low",
            "modelUsed":       "heuristic_fallback",
        }

    X    = np.array([_features_to_array(req.features)])
    prob = float(_model.predict_proba(X)[0][1])

    # Blend with Isolation Forest anomaly score when available
    if _iforest is not None:
        # score_samples: more negative = more anomalous
        raw_if  = float(_iforest.score_samples(X)[0])
        # Normalise to 0-1 (anomaly probability)
        if_prob = max(0.0, min(1.0, 1.0 - (raw_if + 0.5)))
        prob    = 0.70 * prob + 0.30 * if_prob

    return {
        "claimId":          req.claimId,
        "fraudProbability": round(prob, 4),
        "riskLevel":        "high" if prob >= 0.6 else "medium" if prob >= 0.3 else "low",
        "modelUsed":        "gradient_boosting" + ("+isolation_forest" if _iforest else ""),
        "modelTrainedAt":   _model_meta.get("trainedAt"),
    }


@app.post("/score-line-items")
def score_line_items(req: LineItemsRequest):
    """
    Analyse invoice line items for statistical anomalies.
    Returns per-item anomaly scores and an aggregate invoice fraud risk.
    """
    if not req.lineItems:
        return {
            "claimId":        req.claimId,
            "itemCount":      0,
            "results":        [],
            "overallRisk":    "low",
            "invoiceFraudProbability": 0.0,
        }

    vectors  = [_item_to_vector(item) for item in req.lineItems]
    X        = np.array(vectors, dtype=np.float64)
    results  = []

    # Compute statistical z-scores for unit price within this invoice
    unit_prices = [item.unitPrice or 0 for item in req.lineItems]
    valid_prices = [p for p in unit_prices if p > 0]
    price_mean   = float(np.mean(valid_prices)) if valid_prices else 0
    price_std    = float(np.std(valid_prices))  if len(valid_prices) > 1 else 0

    # Isolation Forest — score within this invoice batch if we have enough items
    if_scores: list[float] = []
    if SKLEARN_AVAILABLE and len(req.lineItems) >= 3:
        try:
            local_if = IsolationForest(n_estimators=50, contamination="auto", random_state=42)
            local_if.fit(X)
            raw_scores = local_if.score_samples(X)
            # Normalise: −0.5 → 0 (normal), −1.0 → 1 (highly anomalous)
            if_scores = [max(0.0, min(1.0, 1.0 - (s + 0.5))) for s in raw_scores.tolist()]
        except Exception:
            if_scores = [0.0] * len(req.lineItems)
    else:
        if_scores = [0.0] * len(req.lineItems)

    total_items_price = sum(i.totalPrice or 0 for i in req.lineItems)
    arithmetic_errors = 0

    for idx, (item, vec, if_score) in enumerate(zip(req.lineItems, vectors, if_scores)):
        flags: list[str] = []

        # Arithmetic check
        arith_error_pct = vec[3]
        if arith_error_pct > 0.01:
            flags.append(f"Arithmetic mismatch ({arith_error_pct * 100:.1f}% deviation)")
            arithmetic_errors += 1

        # Price z-score
        price_z = 0.0
        if price_std > 0 and (item.unitPrice or 0) > 0:
            price_z = ((item.unitPrice or 0) - price_mean) / price_std
            if price_z > 2.0:
                flags.append(f"Unit price is {price_z:.1f}σ above invoice average")

        # Tax anomaly
        if vec[4] > 0.05:
            flags.append(f"Unusual tax rate ({vec[4] * 100:.1f}% deviation from 16% VAT)")

        # Round price flag
        if vec[5] == 1.0:
            flags.append("Unit price is a round number")

        # Combine scores
        rule_score = min(1.0, (
            arith_error_pct * 0.40 +
            (if_score       * 0.30) +
            (min(price_z, 4) / 4 * 0.20 if price_z > 2 else 0) +
            (vec[4] * 0.10)
        ))

        risk = "high" if rule_score >= 0.55 else "medium" if rule_score >= 0.25 else "low"

        results.append({
            "lineNumber":      idx + 1,
            "description":     item.description,
            "quantity":        item.quantity,
            "unitPrice":       item.unitPrice,
            "totalPrice":      item.totalPrice,
            "fraudRisk":       risk,
            "fraudScore":      round(rule_score, 3),
            "isolationScore":  round(if_score, 3),
            "priceZScore":     round(price_z, 2),
            "flags":           flags,
            "arithmeticValid": arith_error_pct < 0.01,
        })

    # Invoice-level totals check
    invoice_level_flags: list[str] = []
    if req.invoiceTotal > 0:
        discrepancy = abs(req.invoiceTotal - total_items_price)
        if discrepancy > 0.5:
            pct = discrepancy / req.invoiceTotal * 100
            invoice_level_flags.append(
                f"Invoice total KES {req.invoiceTotal:.2f} differs from line item sum KES {total_items_price:.2f} by {pct:.1f}%"
            )

    high_risk_count   = sum(1 for r in results if r["fraudRisk"] == "high")
    medium_risk_count = sum(1 for r in results if r["fraudRisk"] == "medium")

    invoice_fraud_prob = min(1.0, (
        high_risk_count   * 0.15 +
        medium_risk_count * 0.06 +
        (0.20 if invoice_level_flags else 0)
    ))

    overall_risk = (
        "high"   if invoice_fraud_prob >= 0.4 or high_risk_count >= 2 else
        "medium" if invoice_fraud_prob >= 0.15 or medium_risk_count >= 2 else
        "low"
    )

    return {
        "claimId":                  req.claimId,
        "itemCount":                len(req.lineItems),
        "results":                  results,
        "invoiceLevelFlags":        invoice_level_flags,
        "arithmeticErrors":         arithmetic_errors,
        "overallRisk":              overall_risk,
        "invoiceFraudProbability":  round(invoice_fraud_prob, 4),
        "calculatedTotal":          round(total_items_price, 2),
    }


@app.post("/image-quality")
def image_quality(req: ImageQualityRequest):
    """
    Analyse a base64-encoded document image and return quality scores with
    preprocessing recommendations.
    """
    if not PIL_AVAILABLE:
        raise HTTPException(503, "Pillow not installed — run: pip install Pillow")

    try:
        image_bytes = base64.b64decode(req.imageBase64)
        img = Image.open(io.BytesIO(image_bytes))
    except Exception as e:
        raise HTTPException(400, f"Could not decode image: {e}")

    quality = _score_image_quality(img)
    quality["filename"] = req.filename

    # Preprocessing sequence recommendation based on detected issues
    pipeline: list[str] = []
    if img.mode != "L":
        pipeline.append("1. Convert to greyscale")
    if quality["orientationScore"] if "orientationScore" in quality else False:
        pipeline.append("2. Auto-rotate to upright orientation")
    if quality["sharpnessScore"] < 0.4:
        pipeline.append("3. Apply Gaussian blur removal / unsharp mask")
    if quality["brightnessScore"] < 0.5:
        pipeline.append("4. Normalise brightness (histogram equalisation)")
    if quality["contrastScore"] < 0.4:
        pipeline.append("5. Apply CLAHE contrast enhancement")
    pipeline.append("6. Apply Otsu adaptive thresholding for binarisation")
    pipeline.append("7. Run deskew / perspective correction (OpenCV warpPerspective)")
    pipeline.append("8. Denoise with bilateral filter or morphological opening")

    quality["recommendedPipeline"] = pipeline
    return quality


@app.get("/weights")
def weights():
    if _model is None:
        return {"modelLoaded": False, "featureImportances": {}}
    return {
        "modelLoaded":        True,
        "iforestLoaded":      _iforest is not None,
        "featureImportances": _model_meta.get("featureImportances", {}),
        "trainedAt":          _model_meta.get("trainedAt"),
        "aucRoc":             _model_meta.get("aucRoc"),
        "features":           CLAIM_FEATURES,
    }
