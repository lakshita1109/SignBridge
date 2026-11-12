"""SignBridge - Flask entry point.  Run with:  python app.py"""
import json
import math
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, render_template, request

from backend import database, model_store, recognition
from backend.features import NUM_LANDMARKS, presence

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
SAMPLES_FILE = DATA_DIR / "samples.jsonl"

MODES = ("letters", "words")
MAX_FRAMES = 3000                      # ~200 s of video at 15 fps
LABEL_RE = re.compile(r"^[A-Za-z0-9 _\-]{1,30}$")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024
database.init_db()
_file_lock = threading.Lock()


# ---------------------------------------------------------------- helpers
def error(message, status=400, code=None):
    payload = {"error": message}
    if code:
        payload["code"] = code
    return jsonify(payload), status


def parse_frames(raw):
    """Validate landmark data coming from the browser."""
    if not isinstance(raw, list):
        raise ValueError("'frames' must be a list.")
    if len(raw) > MAX_FRAMES:
        raise ValueError(f"Too many frames (max {MAX_FRAMES}).")
    frames = []
    for frame in raw:
        if not isinstance(frame, list) or len(frame) > 2:
            raise ValueError("Each frame must contain at most two hands.")
        hands = []
        for hand in frame:
            if not isinstance(hand, list) or len(hand) != NUM_LANDMARKS:
                raise ValueError(f"Each hand must have {NUM_LANDMARKS} landmarks.")
            pts = []
            for p in hand:
                if not isinstance(p, list) or len(p) < 3:
                    raise ValueError("Each landmark must be [x, y, z].")
                x, y, z = float(p[0]), float(p[1]), float(p[2])
                if not (math.isfinite(x) and math.isfinite(y) and math.isfinite(z)):
                    raise ValueError("Landmark values must be finite numbers.")
                pts.append([x, y, z])
            hands.append(pts)
        frames.append(hands)
    return frames


def read_request():
    """Common checks for the prediction endpoints. Returns (language, mode, frames, body)."""
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ValueError("Send a JSON body.")
    language = body.get("language", "asl")
    mode = body.get("mode")
    if language not in model_store.LANGUAGES:
        raise ValueError("Unsupported language.")
    if mode not in MODES:
        raise ValueError("'mode' must be 'letters' or 'words'.")
    try:
        frames = parse_frames(body.get("frames", []))
    except (ValueError, TypeError) as exc:
        raise ValueError(str(exc))
    return language, mode, frames, body


def model_missing(language, mode):
    return error(f"No trained {language.upper()} {mode} model yet.", 503, "model_missing")


# ------------------------------------------------------------------ pages
@app.route("/")
def home():
    return render_template("index.html")


@app.route("/translate")
def translate():
    return render_template("translate.html")


@app.route("/upload")
def upload():
    return render_template("upload.html")


@app.route("/learn")
def learn():
    return render_template("learn.html")


@app.route("/history")
def history():
    return render_template("history.html")


@app.route("/collect")
def collect():
    return render_template("collect.html")


# -------------------------------------------------------------- recognition
@app.get("/api/status")
def api_status():
    return jsonify({"languages": model_store.LANGUAGES, "models": model_store.status()})


@app.post("/api/predict")
def api_predict():
    try:
        language, mode, frames, _ = read_request()
    except ValueError as exc:
        return error(str(exc))
    try:
        return jsonify(recognition.predict_live(language, mode, frames))
    except recognition.ModelMissing:
        return model_missing(language, mode)


@app.post("/api/analyze")
def api_analyze():
    try:
        language, mode, frames, body = read_request()
    except ValueError as exc:
        return error(str(exc))
    if not frames:
        return error("No frames received.")
    try:
        min_conf = min(max(float(body.get("min_confidence", 0.6)), 0.0), 1.0)
    except (TypeError, ValueError):
        return error("'min_confidence' must be a number.")
    try:
        return jsonify(recognition.analyze(language, mode, frames, min_conf))
    except recognition.ModelMissing:
        return model_missing(language, mode)


# ------------------------------------------------------- training-data tools
@app.post("/api/collect")
def api_collect():
    try:
        language, mode, frames, body = read_request()
    except ValueError as exc:
        return error(str(exc))

    label = " ".join(str(body.get("label", "")).split())
    if not LABEL_RE.match(label):
        return error("Label must be 1-30 characters: letters, numbers, space, _ or -.")
    if not label.startswith("_"):   # keep idle labels like "_nothing" exactly as typed
        label = label.upper() if mode == "letters" else label.lower()

    signer = " ".join(str(body.get("signer", "")).split())[:40] or "unknown"
    if not 10 <= len(frames) <= 120:
        return error("A recording needs between 10 and 120 frames.")
    if presence(frames) < 0.3:
        return error("No hand was detected in most of the recording. Try again.")

    record = {
        "id": uuid.uuid4().hex[:12],
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "language": language,
        "mode": mode,
        "label": label,
        "signer": signer,
        "frames": frames,
    }
    DATA_DIR.mkdir(exist_ok=True)
    with _file_lock:
        with open(SAMPLES_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
    return jsonify({"ok": True, "id": record["id"], "label": label})


@app.get("/api/collect/stats")
def api_collect_stats():
    counts = {"letters": {}, "words": {}}
    signers = set()
    total = 0
    if SAMPLES_FILE.exists():
        with _file_lock, open(SAMPLES_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    s = json.loads(line)
                except json.JSONDecodeError:
                    continue
                bucket = counts.get(s.get("mode"))
                if bucket is None:
                    continue
                bucket[s["label"]] = bucket.get(s["label"], 0) + 1
                signers.add(s.get("signer", "unknown"))
                total += 1
    return jsonify({"counts": counts, "signers": sorted(signers), "total": total})


@app.post("/api/collect/undo")
def api_collect_undo():
    """Delete the most recent recording (handy after a bad take)."""
    with _file_lock:
        if not SAMPLES_FILE.exists():
            return error("Nothing to undo.", 404)
        lines = [ln for ln in SAMPLES_FILE.read_text(encoding="utf-8").splitlines() if ln.strip()]
        if not lines:
            return error("Nothing to undo.", 404)
        removed = json.loads(lines[-1])
        SAMPLES_FILE.write_text("".join(ln + "\n" for ln in lines[:-1]), encoding="utf-8")
    return jsonify({"ok": True, "removed": removed["label"], "mode": removed["mode"]})


# ------------------------------------------------------------------ history
@app.get("/api/history")
def api_history_list():
    return jsonify(database.list_history())


@app.post("/api/history")
def api_history_add():
    body = request.get_json(silent=True) or {}
    text = str(body.get("text", "")).strip()
    language = body.get("language", "asl")
    mode = body.get("mode", "letters")
    if not text:
        return error("Nothing to save: the text is empty.")
    if len(text) > 2000:
        return error("Text is too long (max 2000 characters).")
    if language not in model_store.LANGUAGES or mode not in MODES:
        return error("Invalid language or mode.")
    return jsonify({"ok": True, "id": database.add_history(text, language, mode)}), 201


@app.delete("/api/history/<int:item_id>")
def api_history_delete(item_id):
    if not database.delete_history(item_id):
        return error("Item not found.", 404)
    return jsonify({"ok": True})


@app.delete("/api/history")
def api_history_clear():
    database.clear_history()
    return jsonify({"ok": True})


@app.errorhandler(413)
def too_large(_):
    return error("Request is too large.", 413)


if __name__ == "__main__":
    app.run(debug=True)