// Turns a stream of per-frame hand landmarks into stable "tokens" (a letter or a word).
// It asks the server for a prediction, then waits until the same answer repeats
// before accepting it, so one noisy frame never adds text.
import { api, SEQ_LEN } from "./common.js";

const LETTER_STABLE_FRAMES = 6;   // ~0.4 s of the same letter at 15 fps
const WORD_AGREE = 2;             // two matching word predictions in a row
const WORD_INTERVAL_MS = 300;     // ask for a word prediction ~3 times a second
const WORD_COOLDOWN_MS = 1800;    // pause after a word so it is not repeated
const WORD_MIN_FRAMES = 12;

/**
 * getLanguage(), getMode(), getThreshold() -> current settings (threshold is 0..1)
 * onLive({ state, label, confidence }) -> state: "idle" | "uncertain" | "confident"
 * onToken({ token, isWord, confidence }) -> a sign was accepted
 * onError(error) -> server/model problem
 */
export function createRecognizer({ getLanguage, getMode, getThreshold, onLive, onToken, onError }) {
  let buffer = [];
  let busy = false;
  let blocked = false;       // true when no model exists (stop asking)
  let candidate = null;
  let stable = 0;
  let lastAdded = null;      // last letter added; cleared when the hand is lowered
  let cooldownUntil = 0;
  let lastWordAt = 0;

  function reset() {
    buffer = [];
    candidate = null;
    stable = 0;
    lastAdded = null;
    cooldownUntil = 0;
    lastWordAt = 0;
    blocked = false;
  }

  const predict = (frames, mode) =>
    api("/api/predict", { method: "POST", body: { language: getLanguage(), mode, frames } });

  function handleError(err) {
    if (err.code === "model_missing") blocked = true;
    onError(err);
  }

  function track(result) {
    // Returns true when the prediction is confident enough to count.
    const threshold = getThreshold();
    if (!result.label) {
      candidate = null;
      stable = 0;
      onLive({ state: "idle", label: null, confidence: result.confidence || 0 });
      return false;
    }
    if (result.confidence < threshold) {
      candidate = null;
      stable = 0;
      onLive({ state: "uncertain", label: result.label, confidence: result.confidence });
      return false;
    }
    if (result.label === candidate) stable += 1;
    else { candidate = result.label; stable = 1; }
    onLive({ state: "confident", label: result.label, confidence: result.confidence });
    return true;
  }

  async function onFrame(hands) {
    buffer.push(hands);
    if (buffer.length > SEQ_LEN) buffer.shift();

    if (!hands.length) {
      candidate = null;
      stable = 0;
      lastAdded = null;       // hand lowered: the same letter may be signed again
      onLive({ state: "idle", label: null, confidence: 0 });
      return;
    }
    if (blocked || busy) return;

    const mode = getMode();
    if (mode === "letters") {
      busy = true;
      try {
        const result = await predict([hands], "letters");
        if (track(result) && stable >= LETTER_STABLE_FRAMES && result.label !== lastAdded) {
          lastAdded = result.label;
          stable = 0;
          onToken({ token: result.label, isWord: false, confidence: result.confidence });
        }
      } catch (err) { handleError(err); } finally { busy = false; }
      return;
    }

    // words
    const now = performance.now();
    if (now < cooldownUntil || now - lastWordAt < WORD_INTERVAL_MS || buffer.length < WORD_MIN_FRAMES) return;
    lastWordAt = now;
    busy = true;
    try {
      const result = await predict(buffer.slice(), "words");
      if (track(result) && stable >= WORD_AGREE) {
        onToken({ token: result.label, isWord: true, confidence: result.confidence });
        candidate = null;
        stable = 0;
        buffer = [];
        cooldownUntil = performance.now() + WORD_COOLDOWN_MS;
      }
    } catch (err) { handleError(err); } finally { busy = false; }
  }

  return { onFrame, reset };
}