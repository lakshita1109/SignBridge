"""Loads and saves trained models (one file per language and mode)."""
import threading
from pathlib import Path

import joblib

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

# Add "isl" here later, once it has its own data and models.
LANGUAGES = {"asl": "American Sign Language"}
KINDS = ("letters", "words")

_cache = {}
_lock = threading.Lock()


def model_path(language, kind):
    return MODELS_DIR / f"{language}_{kind}.joblib"


def load(language, kind):
    """Return the saved model bundle, or None if it has not been trained yet.
    The file is re-read automatically after you retrain (no server restart needed)."""
    path = model_path(language, kind)
    if not path.exists():
        return None
    mtime = path.stat().st_mtime
    with _lock:
        cached = _cache.get(path)
        if cached and cached[0] == mtime:
            return cached[1]
        bundle = joblib.load(path)
        _cache[path] = (mtime, bundle)
        return bundle


def save(language, kind, bundle):
    MODELS_DIR.mkdir(exist_ok=True)
    joblib.dump(bundle, model_path(language, kind), compress=3)


def status():
    """Summary used by the UI: which models exist and what they can recognise."""
    out = {}
    for lang in LANGUAGES:
        out[lang] = {}
        for kind in KINDS:
            bundle = load(lang, kind)
            if bundle is None:
                out[lang][kind] = None
            else:
                out[lang][kind] = {
                    "classes": [str(c) for c in bundle["model"].classes_],
                    "eval_accuracy": bundle.get("eval_accuracy"),
                    "eval_note": bundle.get("eval_note"),
                    "trained_at": bundle.get("trained_at"),
                }
    return out