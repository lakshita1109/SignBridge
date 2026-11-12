// Live webcam translation page.
import { api, $, pct, speak, toast, appendToken, setMeter, cameraErrorMessage, loadStatus, updateModelNote } from "./common.js";
import { createHandLandmarker, createTracker, openCamera, closeCamera } from "./landmarks.js";
import { createRecognizer } from "./recognizer.js";

const el = {
  video: $("#video"), overlay: $("#overlay"), hint: $("#stageHint"), camBtn: $("#camBtn"),
  language: $("#language"), mode: $("#mode"), showLandmarks: $("#showLandmarks"),
  threshold: $("#threshold"), thrVal: $("#thrVal"), status: $("#status"),
  liveLabel: $("#liveLabel"), meter: $("#meterFill"), liveConf: $("#liveConf"),
  output: $("#output"), note: $("#modelNote"),
  speak: $("#speakBtn"), space: $("#spaceBtn"), back: $("#backBtn"), clear: $("#clearBtn"), save: $("#saveBtn"),
};

let landmarker = null;
let tracker = null;
let running = false;
let status = null;

const getThreshold = () => Number(el.threshold.value) / 100;

function setStatus(text, tone = "") {
  el.status.textContent = text;
  el.status.className = `pill ${tone}`.trim();
}

function showLive({ state, label, confidence }) {
  if (state === "idle") {
    el.liveLabel.textContent = "-";
    el.liveLabel.className = "live-label";
    setMeter(el.meter, 0, getThreshold());
    el.liveConf.textContent = "show your hand to the camera";
    setStatus("Waiting for a hand", "");
    return;
  }
  el.liveLabel.textContent = label;
  el.liveLabel.className = `live-label ${state}`;
  setMeter(el.meter, confidence, getThreshold());
  el.liveConf.textContent =
    state === "uncertain" ? `not sure (${pct(confidence)}), try holding it steadier` : `confidence ${pct(confidence)}`;
  setStatus(state === "uncertain" ? "Uncertain" : "Recognising", state === "uncertain" ? "warn" : "ok");
}

const recognizer = createRecognizer({
  getLanguage: () => el.language.value,
  getMode: () => el.mode.value,
  getThreshold,
  onLive: showLive,
  onToken: ({ token, isWord }) => {
    el.output.value = appendToken(el.output.value, token, isWord);
    el.output.scrollTop = el.output.scrollHeight;
  },
  onError: (err) => {
    if (err.code === "model_missing") {
      updateModelNote(el.note, status, el.language.value, el.mode.value);
      setStatus("No model trained yet", "warn");
    } else {
      setStatus("Server error", "warn");
      toast(err.message);
    }
  },
});

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
      onFrame: recognizer.onFrame,
      showLandmarks: () => el.showLandmarks.checked,
    });
    tracker.start();
    running = true;
    el.hint.classList.add("hidden");
    el.camBtn.textContent = "Stop camera";
    recognizer.reset();
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
  showLive({ state: "idle" });
  setStatus("Idle", "");
}

el.camBtn.addEventListener("click", () => (running ? stopCamera() : startCamera()));

el.threshold.addEventListener("input", () => { el.thrVal.textContent = `${el.threshold.value}%`; });

function onSettingsChange() {
  recognizer.reset();
  updateModelNote(el.note, status, el.language.value, el.mode.value);
}
el.mode.addEventListener("change", onSettingsChange);
el.language.addEventListener("change", onSettingsChange);

el.speak.addEventListener("click", () => speak(el.output.value));
el.space.addEventListener("click", () => { el.output.value += " "; });
el.back.addEventListener("click", () => { el.output.value = el.output.value.slice(0, -1); });
el.clear.addEventListener("click", () => { el.output.value = ""; recognizer.reset(); });
el.save.addEventListener("click", async () => {
  const text = el.output.value.trim();
  if (!text) { toast("Nothing to save yet."); return; }
  try {
    await api("/api/history", { method: "POST", body: { text, language: el.language.value, mode: el.mode.value } });
    toast("Saved to history.");
  } catch (err) { toast(err.message); }
});

window.addEventListener("beforeunload", () => { if (running) closeCamera(el.video); });

loadStatus().then((s) => {
  status = s;
  updateModelNote(el.note, status, el.language.value, el.mode.value);
});