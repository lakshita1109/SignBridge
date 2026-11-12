"""Prediction logic: single live predictions and whole-video analysis."""
import numpy as np

from . import model_store
from .features import FPS, SEQ_LEN, frame_vector, has_hand, presence, sequence_vector

MIN_PRESENCE = 0.4      # a word window needs hands in at least 40% of its frames
LETTER_MIN_RUN = 3      # frames in a row before a letter counts (video analysis)
WORD_STRIDE = 5         # slide the word window by 5 frames (video analysis)
SPACE_GAP_FRAMES = FPS  # a pause of 1 second between letters becomes a space


class ModelMissing(Exception):
    pass


def _bundle(language, mode):
    bundle = model_store.load(language, mode)
    if bundle is None:
        raise ModelMissing()
    return bundle


def _top(clf, vec, k=3):
    proba = clf.predict_proba(vec.reshape(1, -1))[0]
    order = np.argsort(proba)[::-1][:k]
    return [{"label": str(clf.classes_[i]), "confidence": float(proba[i])} for i in order]


def _no_hand():
    return {"label": None, "confidence": 0.0, "reason": "no_hand"}


def predict_live(language, mode, frames):
    """One prediction for the live camera. Letters use the last frame;
    words use the recent frames (up to 30)."""
    clf = _bundle(language, mode)["model"]
    if mode == "letters":
        hands = frames[-1] if frames else []
        if not has_hand(hands):
            return _no_hand()
        top = _top(clf, frame_vector(hands))
    else:
        recent = frames[-SEQ_LEN:]
        if presence(recent) < MIN_PRESENCE:
            return _no_hand()
        top = _top(clf, sequence_vector(recent))

    best = top[0]
    if best["label"].startswith("_"):  # "_nothing" / "_neutral" = idle class
        return {"label": None, "confidence": best["confidence"], "reason": "idle", "top": top}
    return {"label": best["label"], "confidence": best["confidence"], "top": top}


def analyze(language, mode, frames, min_conf=0.6):
    """Turn a whole video (list of per-frame landmarks) into a list of signs."""
    clf = _bundle(language, mode)["model"]
    if mode == "letters":
        segments = _analyze_letters(clf, frames, min_conf)
    else:
        segments = _analyze_words(clf, frames, min_conf)

    if mode == "letters":
        text = ""
        prev_end = None
        for seg in segments:
            if prev_end is not None and seg["start"] - prev_end > SPACE_GAP_FRAMES:
                text += " "
            text += seg["label"]
            prev_end = seg["end"]
    else:
        text = " ".join(seg["label"] for seg in segments)

    return {
        "text": text,
        "segments": segments,
        "frames": len(frames),
        "frames_with_hands": sum(1 for f in frames if has_hand(f)),
        "fps": FPS,
    }


def _analyze_letters(clf, frames, min_conf):
    idx = [i for i, f in enumerate(frames) if has_hand(f)]
    if not idx:
        return []
    X = np.stack([frame_vector(frames[i]) for i in idx])
    proba = clf.predict_proba(X)
    labels = clf.classes_[proba.argmax(axis=1)]
    confs = proba.max(axis=1)

    per_frame = {}
    for i, label, conf in zip(idx, labels, confs):
        label = str(label)
        if conf >= min_conf and not label.startswith("_"):
            per_frame[i] = (label, float(conf))

    # Merge runs of the same letter on consecutive frames.
    segments, run = [], None
    for i in range(len(frames)):
        item = per_frame.get(i)
        if item and run and run["label"] == item[0] and i == run["end"] + 1:
            run["end"] = i
            run["confs"].append(item[1])
        else:
            if run:
                segments.append(run)
            run = {"label": item[0], "start": i, "end": i, "confs": [item[1]]} if item else None
    if run:
        segments.append(run)

    return [
        {"label": s["label"], "confidence": float(np.mean(s["confs"])), "start": s["start"], "end": s["end"]}
        for s in segments
        if len(s["confs"]) >= LETTER_MIN_RUN
    ]


def _analyze_words(clf, frames, min_conf):
    if not frames:
        return []
    last_start = max(0, len(frames) - SEQ_LEN)
    starts = list(range(0, last_start + 1, WORD_STRIDE))
    if starts[-1] != last_start:
        starts.append(last_start)

    windows, kept = [], []
    for s in starts:
        window = frames[s:s + SEQ_LEN]
        if presence(window) >= MIN_PRESENCE:
            windows.append(sequence_vector(window))
            kept.append((s, s + len(window) - 1))
    if not windows:
        return []

    proba = clf.predict_proba(np.stack(windows))
    labels = clf.classes_[proba.argmax(axis=1)]
    confs = proba.max(axis=1)

    segments, current = [], None
    for (start, end), label, conf in zip(kept, labels, confs):
        label = str(label)
        ok = conf >= min_conf and not label.startswith("_")
        if ok and current and current["label"] == label and start <= current["end"] + WORD_STRIDE:
            current["end"] = end
            current["confs"].append(float(conf))
        else:
            if current:
                segments.append(current)
            current = {"label": label, "start": start, "end": end, "confs": [float(conf)]} if ok else None
    if current:
        segments.append(current)

    return [
        {"label": s["label"], "confidence": float(np.mean(s["confs"])), "start": s["start"], "end": s["end"]}
        for s in segments
    ]