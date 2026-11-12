// Training-data recorder: 3-2-1 countdown, then 30 frames (2 s) of hand landmarks are saved.
import { api, $, SEQ_LEN, toast, cameraErrorMessage } from "./common.js";
import { createHandLandmarker, createTracker, openCamera, closeCamera } from "./landmarks.js";

const GOOD_ENOUGH = 15;   // recordings per sign we recommend
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").concat("_nothing");

const el = {
  signer: $("#signer"), mode: $("#mode"), letterField: $("#letterField"), letterSelect: $("#letterSelect"),
  wordField: $("#wordField"), wordInput: $("#wordInput"), wordList: $("#wordList"),
  video: $("#video"), overlay: $("#overlay"), hint: $("#stageHint"), badge: $("#badge"), countdown: $("#countdown"),
  camBtn: $("#camBtn"), recBtn: $("#recBtn"), undoBtn: $("#undoBtn"), recNote: $("#recNote"),
  stats: $("#stats"), total: $("#total"),
};

let landmarker = null;
let tracker = null;
let running = false;
let recording = false;
let frames = [];
let finishRecording = null;
let counts = { letters: {}, words: {} };

// Remember the signer name between visits (storage may be blocked, so guard it).
try { el.signer.value = localStorage.getItem("signbridge.signer") || ""; } catch { /* ignore */ }
el.signer.addEventListener("input", () => {
  try { localStorage.setItem("signbridge.signer", el.signer.value); } catch { /* ignore */ }
});

for (const letter of LETTERS) {
  const opt = document.createElement("option");
  opt.value = letter;
  opt.textContent = letter;
  el.letterSelect.appendChild(opt);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function currentLabel() {
  return el.mode.value === "letters" ? el.letterSelect.value : el.wordInput.value.trim();
}

function renderStats() {
  const mode = el.mode.value;
  const bucket = counts[mode] || {};
  const labels = mode === "letters" ? LETTERS : Object.keys(bucket).sort();
  el.stats.className = `stats${mode === "words" ? " words" : ""}`;
  el.stats.innerHTML = "";
  if (!labels.length) {
    el.stats.textContent = "No words recorded yet.";
    return;
  }
  for (const label of labels) {
    const n = bucket[label] || 0;
    const row = document.createElement("div");
    row.className = `stat${n >= GOOD_ENOUGH ? " enough" : ""}`;
    const name = document.createElement("span");
    name.textContent = label;
    const count = document.createElement("b");
    count.textContent = n;
    row.append(name, count);
    el.stats.appendChild(row);
  }
  const all = Object.values(counts.letters).concat(Object.values(counts.words)).reduce((a, b) => a + b, 0);
  el.total.textContent = `(${all} total, goal ${GOOD_ENOUGH}+ each)`;

  el.wordList.innerHTML = "";
  for (const w of new Set([...Object.keys(counts.words), "_neutral"])) {
    const opt = document.createElement("option");
    opt.value = w;
    el.wordList.appendChild(opt);
  }
}

async function refreshStats() {
  try {
    const data = await api("/api/collect/stats");
    counts = data.counts;
    renderStats();
  } catch (err) { toast(err.message); }
}

function onFrame(hands) {
  if (!recording) return;
  frames.push(hands);
  el.badge.textContent = `Recording ${frames.length}/${SEQ_LEN}`;
  if (frames.length >= SEQ_LEN) {
    recording = false;
    finishRecording?.(frames);
  }
}

async function record() {
  const label = currentLabel();
  const signer = el.signer.value.trim();
  if (!running) { toast("Start the camera first."); return; }
  if (!label) { toast("Choose or type what you are recording."); return; }
  if (!signer) { toast("Enter your name so the trainer can test on other people."); el.signer.focus(); return; }

  el.recBtn.disabled = true;
  el.countdown.hidden = false;
  for (const n of [3, 2, 1]) {
    el.countdown.textContent = n;
    await wait(1000);
  }
  el.countdown.hidden = true;

  frames = [];
  el.badge.hidden = false;
  el.badge.textContent = `Recording 0/${SEQ_LEN}`;
  const captured = await new Promise((resolve) => {
    finishRecording = resolve;
    recording = true;
  });
  el.badge.hidden = true;

  try {
    const res = await api("/api/collect", {
      method: "POST",
      body: { language: "asl", mode: el.mode.value, label, signer, frames: captured },
    });
    const n = (counts[el.mode.value][res.label] || 0) + 1;
    toast(`Saved "${res.label}" (recording ${n}).`);
    await refreshStats();
  } catch (err) {
    toast(err.message);
  } finally {
    el.recBtn.disabled = !running;
  }
}

async function startCamera() {
  el.camBtn.disabled = true;
  try {
    landmarker ??= await createHandLandmarker("VIDEO");
    await openCamera(el.video);
    tracker = createTracker({ video: el.video, canvas: el.overlay, landmarker, onFrame });
    tracker.start();
    running = true;
    el.hint.classList.add("hidden");
    el.camBtn.textContent = "Stop camera";
    el.recBtn.disabled = false;
  } catch (err) {
    console.error(err);
    toast(cameraErrorMessage(err));
  } finally {
    el.camBtn.disabled = false;
  }
}

function stopCamera() {
  tracker?.stop();
  closeCamera(el.video);
  running = false;
  recording = false;
  el.hint.classList.remove("hidden");
  el.camBtn.textContent = "Start camera";
  el.recBtn.disabled = true;
}

el.camBtn.addEventListener("click", () => (running ? stopCamera() : startCamera()));
el.recBtn.addEventListener("click", record);
el.undoBtn.addEventListener("click", async () => {
  try {
    const res = await api("/api/collect/undo", { method: "POST" });
    toast(`Removed the last recording ("${res.removed}").`);
    await refreshStats();
  } catch (err) { toast(err.message); }
});

el.mode.addEventListener("change", () => {
  const letters = el.mode.value === "letters";
  el.letterField.hidden = !letters;
  el.wordField.hidden = letters;
  renderStats();
});

window.addEventListener("beforeunload", () => { if (running) closeCamera(el.video); });

renderStats();
refreshStats();