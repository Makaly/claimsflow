"""
ClaimsFlow ML Fraud Scoring Sidecar
FastAPI microservice providing:
  POST /train   — fit GradientBoostingClassifier on labelled claim data
  POST /score   — score a single claim feature vector
  GET  /health  — readiness + model status
  GET  /weights — return current feature importances
"""
import json
import os
import pickle
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Optional sklearn import — graceful degradation if not installed
try:
    from sklearn.ensemble import GradientBoostingClassifier
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import Pipeline
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import roc_auc_score
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False

app = FastAPI(title="ClaimsFlow ML Sidecar", version="1.0.0")

MODEL_PATH = Path(os.getenv("MODEL_PATH", "/tmp/fraud_model.pkl"))

FEATURES = [
    "invoiceAmount",
    "ocrConfidence",
    "anomalyScore",
    "fraudSignalCount",
    "fraudSignalCritical",
    "resubmissionCount",
    "memberNumberPresent",  # 0 or 1
]

# In-memory model state
_model: Pipeline | None = None
_model_meta: dict = {}


def _load_model() -> bool:
    global _model, _model_meta
    if MODEL_PATH.exists():
        try:
            with open(MODEL_PATH, "rb") as f:
                payload = pickle.load(f)
            _model = payload["model"]
            _model_meta = payload.get("meta", {})
            return True
        except Exception:
            pass
    return False


def _save_model(model: "Pipeline", meta: dict) -> None:
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(MODEL_PATH, "wb") as f:
        pickle.dump({"model": model, "meta": meta}, f)


# Attempt to load persisted model at startup
_load_model()


# ── Schemas ──────────────────────────────────────────────────────────────────

class ClaimFeatures(BaseModel):
    invoiceAmount: float = 0.0
    ocrConfidence: float = 1.0
    anomalyScore: float = 0.0
    fraudSignalCount: int = 0
    fraudSignalCritical: int = 0
    resubmissionCount: int = 0
    memberNumberPresent: int = 1  # 1 = present, 0 = missing


class TrainingRow(BaseModel):
    label: str          # "fraud" | "suspicious" | "legitimate"
    features: ClaimFeatures


class TrainRequest(BaseModel):
    data: list[TrainingRow]


class ScoreRequest(BaseModel):
    claimId: str
    features: ClaimFeatures


# ── Helpers ──────────────────────────────────────────────────────────────────

def _features_to_array(f: ClaimFeatures) -> list[float]:
    return [
        f.invoiceAmount,
        f.ocrConfidence,
        f.anomalyScore,
        float(f.fraudSignalCount),
        float(f.fraudSignalCritical),
        float(f.resubmissionCount),
        float(f.memberNumberPresent),
    ]


def _label_to_int(label: str) -> int:
    return 0 if label == "legitimate" else 1


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "sklearnAvailable": SKLEARN_AVAILABLE,
        "modelLoaded": _model is not None,
        "modelMeta": _model_meta,
    }


@app.post("/train")
def train(req: TrainRequest):
    if not SKLEARN_AVAILABLE:
        raise HTTPException(503, "scikit-learn not installed — run: pip install scikit-learn")
    if len(req.data) < 20:
        raise HTTPException(400, f"Need at least 20 labelled rows, got {len(req.data)}")

    fraud_count = sum(1 for r in req.data if r.label in ("fraud", "suspicious"))
    legit_count = sum(1 for r in req.data if r.label == "legitimate")
    if fraud_count < 5 or legit_count < 5:
        raise HTTPException(400, f"Need at least 5 of each class. Got fraud={fraud_count} legit={legit_count}")

    X = np.array([_features_to_array(r.features) for r in req.data])
    y = np.array([_label_to_int(r.label) for r in req.data])

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

    model = Pipeline([
        ("scaler", StandardScaler()),
        ("clf", GradientBoostingClassifier(
            n_estimators=200,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.8,
            random_state=42,
        )),
    ])
    model.fit(X_train, y_train)

    auc = float(roc_auc_score(y_test, model.predict_proba(X_test)[:, 1])) if len(np.unique(y_test)) > 1 else None

    importances = model.named_steps["clf"].feature_importances_.tolist()
    feature_importances = dict(zip(FEATURES, importances))

    meta = {
        "trainedAt": datetime.utcnow().isoformat(),
        "sampleSize": len(req.data),
        "fraudCount": fraud_count,
        "legitimateCount": legit_count,
        "aucRoc": auc,
        "featureImportances": feature_importances,
    }

    global _model, _model_meta
    _model = model
    _model_meta = meta
    _save_model(model, meta)

    return {"success": True, **meta}


@app.post("/score")
def score(req: ScoreRequest):
    if _model is None:
        # Fall back to a simple heuristic sum when no model is trained yet
        f = req.features
        heuristic = min(1.0, (
            (f.fraudSignalCritical * 0.25) +
            (f.fraudSignalCount * 0.05) +
            (f.anomalyScore * 0.40) +
            ((1.0 - f.ocrConfidence) * 0.10) +
            ((1 - f.memberNumberPresent) * 0.20)
        ))
        return {
            "claimId": req.claimId,
            "fraudProbability": round(heuristic, 4),
            "riskLevel": "high" if heuristic >= 0.6 else "medium" if heuristic >= 0.3 else "low",
            "modelUsed": "heuristic_fallback",
        }

    X = np.array([_features_to_array(req.features)])
    prob = float(_model.predict_proba(X)[0][1])
    return {
        "claimId": req.claimId,
        "fraudProbability": round(prob, 4),
        "riskLevel": "high" if prob >= 0.6 else "medium" if prob >= 0.3 else "low",
        "modelUsed": "gradient_boosting",
        "modelTrainedAt": _model_meta.get("trainedAt"),
    }


@app.get("/weights")
def weights():
    if _model is None:
        return {"modelLoaded": False, "featureImportances": {}}
    return {
        "modelLoaded": True,
        "featureImportances": _model_meta.get("featureImportances", {}),
        "trainedAt": _model_meta.get("trainedAt"),
        "aucRoc": _model_meta.get("aucRoc"),
    }
