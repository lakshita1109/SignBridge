// Small helpers shared by every page.

export const FPS = 15;      // must match FPS in backend/features.py
export const SEQ_LEN = 30;  // must match SEQ_LEN in backend/features.py

export const $ = (selector, root = document) => root.querySelector(selector);

export const pct = (x) => `${Math.round(x * 100)}%`;

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no JSON body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data && data.code;
    throw err;
  }
  return data;
}

let toastTimer = null;
export function toast(message) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

export function speak(text) {
  if (!("speechSynthesis" in window)) {
    toast("Speech is not supported in this browser.");
    return;
  }
  if (!text.trim()) {
    toast("There is nothing to speak yet.");
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  window.speechSynthesis.speak(utterance);
}

// Letters are glued together; words are separated by spaces.
export function appendToken(text, token, isWord) {
  if (isWord) {
    const base = text.replace(/\s+$/, "");
    return (base ? base + " " : "") + token + " ";
  }
  return text + token;
}

export function setMeter(fillEl, value, threshold) {
  fillEl.style.width = `${Math.round(value * 100)}%`;
  fillEl.classList.toggle("low", value < threshold);
}

export function cameraErrorMessage(err) {
  if (err && err.name === "NotAllowedError") return "Camera permission was denied. Allow it in your browser's address bar and try again.";
  if (err && err.name === "NotFoundError") return "No camera was found on this device.";
  if (err && err.name === "NotReadableError") return "The camera is busy. Close other apps that use it and try again.";
  return (err && err.message) || "Could not start the camera.";
}

export async function loadStatus() {
  try { return await api("/api/status"); } catch { return null; }
}

// Shows the "no trained model" note when the chosen language/mode has no model yet.
export function updateModelNote(noteEl, status, language, mode) {
  if (!status) { noteEl.hidden = true; return; }
  const model = status.models?.[language]?.[mode];
  if (model) { noteEl.hidden = true; return; }
  noteEl.hidden = false;
  noteEl.textContent =
    `No trained ${language.toUpperCase()} ${mode} model yet. Record samples on the Collect data page, ` +
    `then run "python train.py" in the terminal.`;
}