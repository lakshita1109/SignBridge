"""Train SignBridge models from the samples you recorded on the Collect page.

    python train.py                 # train every model that has enough data
    python train.py --mode letters  # only letters
    python train.py --language asl

Reads  data/samples.jsonl
Writes models/<language>_<mode>.joblib
"""
import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import GroupShuffleSplit

from backend import model_store
from backend.features import frame_vector, has_hand, presence, sequence_vector

SAMPLES_FILE = Path(__file__).resolve().parent / "data" / "samples.jsonl"
MIN_RECORDINGS = 3      # a sign needs at least this many recordings
MIN_PRESENCE = 0.4      # word clips need hands in 40% of frames


def load_samples(language, mode):
    if not SAMPLES_FILE.exists():
        return []
    out = []
    with open(SAMPLES_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            s = json.loads(line)
            if s.get("language") == language and s.get("mode") == mode:
                out.append(s)
    return out


def build_dataset(samples, mode):
    X, y, rec_ids, signers = [], [], [], []
    for s in samples:
        frames = s["frames"]
        if mode == "letters":
            for hands in frames:
                if has_hand(hands):
                    X.append(frame_vector(hands))
                    y.append(s["label"])
                    rec_ids.append(s["id"])
                    signers.append(s.get("signer", "unknown"))
        else:
            if presence(frames) >= MIN_PRESENCE:
                X.append(sequence_vector(frames))
                y.append(s["label"])
                rec_ids.append(s["id"])
                signers.append(s.get("signer", "unknown"))
    return np.array(X), np.array(y), np.array(rec_ids), np.array(signers)


def new_model():
    return RandomForestClassifier(n_estimators=300, n_jobs=-1, random_state=42)


def train_one(language, mode):
    print(f"\n=== {language.upper()} {mode} ===")
    samples = load_samples(language, mode)
    if not samples:
        print("No recordings found. Use the Collect page first.")
        return

    # Drop signs with too few recordings.
    per_label = Counter(s["label"] for s in samples)
    weak = sorted(l for l, n in per_label.items() if n < MIN_RECORDINGS)
    if weak:
        print(f"Skipping signs with fewer than {MIN_RECORDINGS} recordings: {', '.join(weak)}")
    samples = [s for s in samples if per_label[s["label"]] >= MIN_RECORDINGS]
    if len({s["label"] for s in samples}) < 2:
        print("Need at least 2 different signs. Record more first.")
        return

    X, y, rec_ids, signers = build_dataset(samples, mode)
    if len(X) == 0:
        print("No usable frames (no hands were detected in the recordings).")
        return
    print(f"{len(set(y))} signs, {len(set(rec_ids))} recordings, {len(X)} training rows, "
          f"{len(set(signers))} signer(s)")

    # Honest evaluation: never test on frames from a recording used for training.
    # With 2+ signers we hold out a whole signer, which is a much harder, fairer test.
    if len(set(signers)) >= 2:
        groups, note, test_size = signers, "held-out signer(s)", 0.34
    else:
        groups, note, test_size = rec_ids, "held-out recordings (same signer - optimistic!)", 0.25

    eval_acc = None
    if len(set(groups)) >= 2:
        splitter = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=42)
        train_idx, test_idx = next(splitter.split(X, y, groups))
        clf = new_model().fit(X[train_idx], y[train_idx])
        pred = clf.predict(X[test_idx])
        eval_acc = float(accuracy_score(y[test_idx], pred))
        print(f"Test accuracy on {note}: {eval_acc:.1%}")
        print(classification_report(y[test_idx], pred, zero_division=0))
    else:
        print("Not enough separate recordings to run a test. Accuracy unknown.")
        note = "no test run"

    final = new_model().fit(X, y)
    model_store.save(language, mode, {
        "model": final,
        "eval_accuracy": eval_acc,
        "eval_note": note,
        "trained_on": int(len(X)),
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    })
    print(f"Saved models/{language}_{mode}.joblib")


def main():
    parser = argparse.ArgumentParser(description="Train SignBridge models.")
    parser.add_argument("--language", default="asl", choices=list(model_store.LANGUAGES))
    parser.add_argument("--mode", default="all", choices=["all", *model_store.KINDS])
    args = parser.parse_args()

    modes = model_store.KINDS if args.mode == "all" else (args.mode,)
    for mode in modes:
        train_one(args.language, mode)


if __name__ == "__main__":
    main()