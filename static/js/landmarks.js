
// MediaPipe hand tracking in the browser: model loading, camera, drawing, frame loop.
import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";
import { FPS } from "./common.js";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// Which landmark connects to which (the hand "skeleton").
const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

let filesetPromise = null;

/** runningMode: "VIDEO" for the live camera, "IMAGE" for seeking through an uploaded video. */
export async function createHandLandmarker(runningMode = "VIDEO") {
  filesetPromise ??= FilesetResolver.forVisionTasks(WASM_URL);
  const fileset = await filesetPromise;
  const make = (delegate) =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode,
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  try {
    return await make("GPU");
  } catch (err) {
    console.warn("GPU delegate unavailable, falling back to CPU.", err);
    return make("CPU");
  }
}

/** Raw MediaPipe result -> [[ [x,y,z] * 21 ] per hand]. This is exactly what the server expects. */
export function extractHands(result) {
  return (result.landmarks || []).map((hand) => hand.map((p) => [p.x, p.y, p.z]));
}

export function drawHands(ctx, hands, canvas) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.lineWidth = Math.max(2, w / 220);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.fillStyle = "#7fe0b8";
  for (const hand of hands) {
    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      ctx.moveTo(hand[a][0] * w, hand[a][1] * h);
      ctx.lineTo(hand[b][0] * w, hand[b][1] * h);
    }
    ctx.stroke();
    for (const p of hand) {
      ctx.beginPath();
      ctx.arc(p[0] * w, p[1] * h, Math.max(3, w / 190), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export async function openCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera access is not available. Open the site at http://127.0.0.1:5000");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await new Promise((resolve) => { video.onloadedmetadata = resolve; });
  await video.play();
  return stream;
}

export function closeCamera(video) {
  const stream = video.srcObject;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}

/** Runs hand tracking on the live video at a fixed FPS and calls onFrame(hands) each time. */
export function createTracker({ video, canvas, landmarker, onFrame, showLandmarks = () => true, fps = FPS }) {
  const ctx = canvas.getContext("2d");
  const interval = 1000 / fps;
  let running = false;
  let last = 0;
  let raf = 0;

  function loop(now) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (now - last < interval || video.readyState < 2 || !video.videoWidth) return;
    last = now;

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    let hands = [];
    try {
      hands = extractHands(landmarker.detectForVideo(video, performance.now()));
    } catch (err) {
      console.error("Hand tracking failed on a frame:", err);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (showLandmarks()) drawHands(ctx, hands, canvas);
    onFrame(hands);
  }

  return {
    start() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}