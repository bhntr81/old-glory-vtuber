/**
 * Webcam head-pose tracking (MediaPipe Face Landmarker).
 *
 * The character wears goggles and a mask, so there are no eyes or mouth to
 * drive — head pose is the signal that matters: yaw, pitch and roll. Blink is
 * used only as a *trigger* (0..1 blendshape), never to hold the mask's lids
 * shut, because the goggles hide the real eyes.
 *
 * Loaded on demand so the rig stays a zero-dependency page when tracking is off.
 */
const VISION_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const DEG = 180 / Math.PI;
const CALIBRATION_FRAMES = 24;
const DETECT_INTERVAL_MS = 40; // 25 Hz is plenty for a head and leaves CPU for drawing
const SMOOTHING = 0.35;

/** Human-readable reason for a failed start, for the status line and toast. */
export function describeCameraError(err) {
  const name = err && err.name ? err.name : "";
  if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return "This browser cannot open a camera. Use https:// or localhost.";
  }
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera permission was denied. Allow it in the address bar and try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera was found.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "The camera is in use by another app.";
  }
  if (location.protocol === "file:") {
    return "Open the page over http(s) — browsers block cameras on file:// URLs.";
  }
  return "Camera could not start" + (err && err.message ? `: ${err.message}` : ".");
}

export class FaceTracker {
  constructor() {
    this.video = null;
    this.stream = null;
    this.landmarker = null;
    this.running = false;
    this.loading = false;
    /** idle | loading | searching | tracking | error */
    this.status = "idle";
    this.error = "";
    this.pose = { yaw: 0, pitch: 0, roll: 0, blink: 0, present: false };
    this.neutral = { yaw: 0, pitch: 0, roll: 0 };
    this._calibration = [];
    this._lastVideoTime = -1;
    this._lastDetect = 0;
    this._framesSinceFace = 0;
  }

  async start() {
    // Expose the whole startup, including the permission prompt and the model
    // download, so the UI can say "Starting…" instead of looking switched off.
    if (this.running || this.loading) return false;
    this.loading = true;
    this.status = "loading";
    this.error = "";
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, frameRate: 30, facingMode: "user" },
        audio: false,
      });
    } catch (err) {
      this.loading = false;
      this.status = "error";
      this.error = describeCameraError(err);
      throw err;
    }
    try {
      return await this.startWithStream(stream);
    } catch (err) {
      this.stop();
      this.status = "error";
      this.error = "Face model failed to load. Check your connection and retry.";
      throw err;
    }
  }

  /** Also used by tests: any MediaStream with a face in it works. */
  async startWithStream(stream) {
    this.loading = true;
    this.stream = stream;

    const video = document.createElement("video");
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    this.video = video;

    const { FaceLandmarker, FilesetResolver } = await import(
      /* @vite-ignore */ `${VISION_URL}/vision_bundle.mjs`
    );
    const fileset = await FilesetResolver.forVisionTasks(`${VISION_URL}/wasm`);
    this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: true,
    });

    this.running = true;
    this.loading = false;
    this.status = "searching";
    this._calibration = [];
    this._framesSinceFace = 0;
    return true;
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.video) {
      this.video.pause?.();
      this.video.srcObject = null;
    }
    if (this.landmarker && this.landmarker.close) {
      try {
        this.landmarker.close();
      } catch (_) {
        /* already closed */
      }
    }
    this.stream = null;
    this.landmarker = null;
    this.video = null;
    this.running = false;
    this.loading = false;
    this.status = "idle";
    this.pose = { yaw: 0, pitch: 0, roll: 0, blink: 0, present: false };
  }

  /** Forget the current pose as "forward" and treat it as neutral. */
  recenter() {
    this.neutral = {
      yaw: this.pose.yaw + this.neutral.yaw,
      pitch: this.pose.pitch + this.neutral.pitch,
      roll: this.pose.roll + this.neutral.roll,
    };
    this.pose.yaw = 0;
    this.pose.pitch = 0;
    this.pose.roll = 0;
    this._calibration = [];
    this.status = "searching";
  }

  /** Call once per frame; returns the smoothed pose. */
  update(now) {
    if (!this.running || !this.landmarker || !this.video) return this.pose;
    if (now - this._lastDetect < DETECT_INTERVAL_MS) return this.pose;
    this._lastDetect = now;
    if (this.video.readyState < 2) return this.pose;
    if (this.video.currentTime === this._lastVideoTime) return this.pose;
    this._lastVideoTime = this.video.currentTime;

    let result;
    try {
      result = this.landmarker.detectForVideo(this.video, now);
    } catch (e) {
      return this.pose;
    }

    if (!result.faceLandmarks || !result.faceLandmarks.length) {
      this.pose.present = false;
      this._framesSinceFace += 1;
      if (this._framesSinceFace > 6) this.status = "searching";
      return this.pose;
    }
    this._framesSinceFace = 0;

    const m = result.facialTransformationMatrixes[0].data; // column-major 4x4
    const R = (row, col) => m[col * 4 + row];
    const yaw = Math.atan2(-R(2, 0), Math.hypot(R(2, 1), R(2, 2))) * DEG;
    const pitch = Math.atan2(R(2, 1), R(2, 2)) * DEG;
    const roll = Math.atan2(R(1, 0), R(0, 0)) * DEG;

    // Average the first moments so a camera that sits off-axis does not bias
    // the character's resting pose.
    if (this._calibration.length < CALIBRATION_FRAMES) {
      this._calibration.push({ yaw, pitch, roll });
      if (this._calibration.length === CALIBRATION_FRAMES) {
        const avg = (k) =>
          this._calibration.reduce((s, v) => s + v[k], 0) / this._calibration.length;
        this.neutral = { yaw: avg("yaw"), pitch: avg("pitch"), roll: avg("roll") };
      }
      this.pose.present = true;
      this.status = "tracking";
      return this.pose;
    }

    this.pose.yaw += (yaw - this.neutral.yaw - this.pose.yaw) * SMOOTHING;
    this.pose.pitch += (pitch - this.neutral.pitch - this.pose.pitch) * SMOOTHING;
    this.pose.roll += (roll - this.neutral.roll - this.pose.roll) * SMOOTHING;
    this.pose.present = true;
    this.status = "tracking";
    this.pose.blink = this._readBlink(result);
    return this.pose;
  }

  /** Blendshapes exist even behind the goggles; 0..1, 1 = eyes shut. */
  _readBlink(result) {
    const shapes = result.faceBlendshapes && result.faceBlendshapes[0];
    if (!shapes || !shapes.categories) return 0;
    let left = 0;
    let right = 0;
    for (const c of shapes.categories) {
      if (c.categoryName === "eyeBlinkLeft") left = c.score;
      else if (c.categoryName === "eyeBlinkRight") right = c.score;
    }
    return Math.min(1, (left + right) * 0.5);
  }
}
