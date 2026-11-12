"""Turns raw MediaPipe hand landmarks into model features.

The SAME functions are used when training (train.py) and when predicting
(live webcam and uploaded video), so the model always sees consistent input.

A "frame" is a list of up to two hands.
A "hand" is a list of 21 landmarks, each [x, y, z] (MediaPipe, x/y in 0..1).
"""
import numpy as np

NUM_LANDMARKS = 21
HAND_DIM = NUM_LANDMARKS * 3   # 63 numbers per hand
FRAME_DIM = 2 * HAND_DIM       # 126 numbers: two hand slots
POS_DIM = 4                    # wrist (x, y) for each of the two slots
SEQ_LEN = 30                   # frames per word clip
FPS = 15                       # frames per second used everywhere (browser + server)


def clean_hands(hands):
    """Keep up to two valid hands. Two hands are ordered left-to-right in the image,
    so the slot order does not depend on MediaPipe's left/right label."""
    valid = [h for h in (hands or []) if h is not None and len(h) == NUM_LANDMARKS]
    valid = valid[:2]
    if len(valid) == 2:
        valid.sort(key=lambda h: h[0][0])
    return valid


def has_hand(hands):
    return len(clean_hands(hands)) > 0


def presence(frames):
    """Fraction of frames in which at least one hand was visible."""
    if not frames:
        return 0.0
    return sum(1 for f in frames if has_hand(f)) / len(frames)


def _normalize_hand(hand):
    """Move the wrist to (0, 0) and scale so the hand size does not matter."""
    pts = np.asarray(hand, dtype=np.float32)
    pts = pts - pts[0]
    scale = float(np.linalg.norm(pts[:, :2], axis=1).max())
    if scale < 1e-6:
        scale = 1.0
    return (pts / scale).reshape(-1)


def frame_vector(hands):
    """Hand-shape features for one frame (126 numbers). Position-independent."""
    vec = np.zeros(FRAME_DIM, dtype=np.float32)
    for i, hand in enumerate(clean_hands(hands)):
        vec[i * HAND_DIM:(i + 1) * HAND_DIM] = _normalize_hand(hand)
    return vec


def frame_position(hands):
    """Where the wrists are in the image (4 numbers). Used for word clips only."""
    pos = np.zeros(POS_DIM, dtype=np.float32)
    for i, hand in enumerate(clean_hands(hands)):
        pos[i * 2] = hand[0][0]
        pos[i * 2 + 1] = hand[0][1]
    return pos


def sequence_vector(frames, seq_len=SEQ_LEN):
    """Features for a whole clip: resample to seq_len frames, then flatten."""
    if not frames:
        frames = [[]]
    idx = np.linspace(0, len(frames) - 1, seq_len).round().astype(int)
    rows = [np.concatenate([frame_vector(frames[i]), frame_position(frames[i])]) for i in idx]
    return np.stack(rows).reshape(-1)