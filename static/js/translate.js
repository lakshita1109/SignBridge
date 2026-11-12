const video = document.getElementById("video");
const startBtn = document.getElementById("startBtn");
const statusText = document.getElementById("status");

startBtn.addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 }
    });
    video.srcObject = stream;
    statusText.textContent = "Camera is on";
  } catch (error) {
    statusText.textContent = "Could not open camera: " + error.message;
  }
});