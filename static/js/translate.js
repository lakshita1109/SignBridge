// Live translation page (hand-tracking stage only).
import { $, toast, cameraErrorMessage } from "./common.js";
import { createHandLandmarker, createTracker, openCamera, closeCamera } from "./landmarks.js";

const el = {
  video: $("#video"),
  overlay: $("#overlay"),
  hint: $("#stageHint"),
  camBtn: $("#camBtn"),
  showLandmarks: $("#showLandmarks"),
  status: $("#status"),
};

let landmarker = null;
let tracker = null;
let running = false;

function setStatus(text, tone = "") {
  el.status.textContent = text;
  el.status.className = `pill ${tone}`.trim();
}

function onFrame(hands) {
  if (hands.length === 0) setStatus("Waiting for a hand", "");
  else setStatus(`Tracking ${hands.length} hand${hands.length > 1 ? "s" : ""}`, "ok");
}

async function startCamera() {
  el.camBtn.disabled = true;
  setStatus("Loading hand tracker...", "");
  try {
    landmarker ??= await createHandLandmarker("VIDEO");
    await openCamera(el.video);
    tracker = createTracker({
      video: el.video,
      canvas: el.overlay,
      landmarker,
      onFrame,
      showLandmarks: () => el.showLandmarks.checked,
    });
    tracker.start();
    running = true;
    el.hint.classList.add("hidden");
    el.camBtn.textContent = "Stop camera";
    setStatus("Waiting for a hand", "");
  } catch (err) {
    console.error(err);
    setStatus("Camera off", "warn");
    toast(cameraErrorMessage(err));
  } finally {
    el.camBtn.disabled = false;
  }
}

function stopCamera() {
  tracker?.stop();
  closeCamera(el.video);
  running = false;
  el.hint.classList.remove("hidden");
  el.camBtn.textContent = "Start camera";
  setStatus("Idle", "");
}

el.camBtn.addEventListener("click", () => (running ? stopCamera() : startCamera()));
window.addEventListener("beforeunload", () => { if (running) closeCamera(el.video); });