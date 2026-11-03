import { VtuberRig } from "./rig.js";
import { Mic } from "./mic.js";
import { FaceTracker } from "./face.js";
import { Blink } from "./blink.js";
import { faceToPose, pointerFromEvent } from "./mapping.js";

const params = new URLSearchParams(location.search);

const BG_MODES = {
  studio: "radial-gradient(120% 100% at 50% 18%, #4a443c 0%, #26231f 45%, #131211 100%)",
  dark: "#000000",
  green: "#00b140",
  blue: "#0a1a2f",
  none: "transparent",
};

const STORE_KEY = "old-glory:settings";

const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d", { alpha: true });
const stage = document.getElementById("stage-wrap");
const toast = document.getElementById("toast");
const facePanel = document.getElementById("face-panel");
const facePreview = document.getElementById("face-preview");
const faceStatus = document.getElementById("face-status");
const faceHint = document.getElementById("face-hint");

/* -------------------------------------------------------------- settings */

const settings = {
  faceSensitivity: 1,
  faceLimit: 1,
  micSensitivity: 2.2,
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    if (Number.isFinite(saved.faceSensitivity)) settings.faceSensitivity = saved.faceSensitivity;
    if (Number.isFinite(saved.faceLimit)) settings.faceLimit = saved.faceLimit;
    if (Number.isFinite(saved.micSensitivity)) settings.micSensitivity = saved.micSensitivity;
  } catch (_) {
    /* storage is optional */
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  } catch (_) {
    /* private mode, ignore */
  }
}

loadSettings();

const state = {
  pointer: {
    x: parseFloat(params.get("px") || "0") || 0,
    y: parseFloat(params.get("py") || "0") || 0,
  },
  view: { scale: 1, offsetX: 0, offsetY: 0 },
  zoom: 1,
  bg: params.get("bg") || "studio",
  mic: false,
  face: false,
  roll: 0,
  mirror: params.get("mirror") === "1",
  demo: params.get("demo") === "1",
  ui: params.get("ui") !== "0",
  energy: 1,
  lastBlinkShade: 0,
};

let rig = null;
const mic = new Mic();
const face = new FaceTracker();
const blink = new Blink();
mic.sensitivity = settings.micSensitivity;

/* ---------------------------------------------------------------- assets */

async function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

async function boot() {
  const res = await fetch("assets/rig.json", { cache: "no-cache" });
  const data = await res.json();
  const entries = await Promise.all(
    data.layers.map(async (l) => [l.id, await loadImage(l.file)])
  );
  rig = new VtuberRig(data, Object.fromEntries(entries));
  document.body.classList.remove("loading");
  document.getElementById("loader")?.remove();
  rig.mirror = state.mirror;
  document.body.classList.toggle("hide-ui", !state.ui);
  applyBackground();
  resize();
  requestAnimationFrame(loop);
}

/* ------------------------------------------------------------------ view */

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  computeView(w, h);
}

function computeView(w, h) {
  const src = rig ? rig.data.source : { width: 1024, height: 1536 };
  const fit = Math.min(w / src.width, h / src.height) * 0.99;
  const scale = fit * state.zoom;
  state.view.scale = scale;
  state.view.offsetX = w / 2 - (src.width * scale) / 2;
  state.view.offsetY = h - src.height * scale;
}

/* ------------------------------------------------------------------- ui */

function applyBackground() {
  const bg = BG_MODES[state.bg] || state.bg;
  document.body.style.background = bg;
  stage.style.background = "transparent";
}

let toastTimer = null;
function say(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

const STATUS_TEXT = {
  idle: ["Camera off", "F starts tracking"],
  loading: ["Starting…", "Allow the camera when asked"],
  searching: ["Looking for a face", "Sit facing the camera"],
  tracking: ["Tracking", "Head turns the mask · X re-centres"],
  error: ["Camera error", ""],
};

let lastStatusKey = "";
function refreshFaceStatus(force = false) {
  const key = face.loading ? "loading" : face.status;
  if (key === lastStatusKey && !force) return;
  lastStatusKey = key;
  const [label, hint] = STATUS_TEXT[key] || STATUS_TEXT.idle;
  faceStatus.textContent = key === "error" ? "Camera error" : label;
  faceStatus.dataset.state = key;
  faceHint.textContent = key === "error" ? face.error : hint;
  const active = state.face || face.loading;
  facePanel.hidden = !active && key !== "error";
  if (key === "error") facePanel.hidden = false;
  const btn = document.getElementById("btn-face");
  btn.classList.toggle("on", active);
  btn.setAttribute("aria-pressed", String(active));
  btn.querySelector(".label").textContent = face.loading
    ? "Starting"
    : state.face
      ? key === "tracking"
        ? "Tracked"
        : "Searching"
      : "Face";
}

function refreshUI() {
  const micBtn = document.getElementById("btn-mic");
  micBtn.classList.toggle("on", state.mic);
  micBtn.setAttribute("aria-pressed", String(state.mic));
  micBtn.querySelector(".label").textContent = state.mic ? "Listening" : "Mic";
  document.getElementById("btn-mirror").classList.toggle("on", state.mirror);
  document.getElementById("bg-name").textContent = state.bg;
  lastStatusKey = "";
  refreshFaceStatus(true);
}

function cycleBackground() {
  const keys = Object.keys(BG_MODES);
  state.bg = keys[(keys.indexOf(state.bg) + 1) % keys.length];
  applyBackground();
  refreshUI();
}

async function toggleFace() {
  if (state.face) {
    face.stop();
    state.face = false;
    state.roll = 0;
    state.pointer.x = state.pointer.y = 0;
    state.lastBlinkShade = 0;
    facePreview.replaceChildren();
    refreshUI();
    say("Face tracking off — neutral pose");
    return;
  }
  if (face.loading) {
    say("Camera is still starting…");
    return;
  }
  say("Starting camera…");
  // start() sets loading synchronously before its first await, so the panel can
  // show "Starting…" during the permission prompt and model download.
  const starting = face.start();
  refreshFaceStatus(true);
  try {
    const ok = await starting;
    if (!ok) {
      refreshUI();
      return;
    }
    state.face = true;
    if (face.video) facePreview.replaceChildren(face.video);
    say("Look at the camera. Head pose drives the model.");
  } catch (e) {
    console.error(e);
    state.face = false;
    state.roll = 0;
    state.pointer.x = state.pointer.y = 0;
    state.lastBlinkShade = 0;
    say(face.error || "Camera blocked or unavailable.");
  }
  refreshUI();
}

function wireUI() {
  document.getElementById("btn-mic").addEventListener("click", async () => {
    if (state.mic) {
      mic.stop();
      state.mic = false;
    } else {
      try {
        await mic.start();
        state.mic = true;
        say("Mic on — talk to the model");
      } catch (e) {
        say("Microphone blocked. Use https:// or localhost.");
      }
    }
    refreshUI();
  });

  document.getElementById("btn-face").addEventListener("click", toggleFace);

  document.getElementById("btn-mirror").addEventListener("click", () => {
    state.mirror = !state.mirror;
    if (rig) rig.mirror = state.mirror;
    refreshUI();
  });

  document.getElementById("btn-bg").addEventListener("click", cycleBackground);

  document.getElementById("btn-reset").addEventListener("click", () => {
    state.zoom = 1;
    state.pointer.x = state.pointer.y = 0;
    resize();
    say("Reset");
  });

  const sens = document.getElementById("sens");
  sens.value = String(settings.micSensitivity);
  sens.addEventListener("input", () => {
    mic.sensitivity = parseFloat(sens.value);
    settings.micSensitivity = mic.sensitivity;
    saveSettings();
  });

  const faceSens = document.getElementById("face-sens");
  const faceLimit = document.getElementById("face-limit");
  faceSens.value = String(settings.faceSensitivity);
  faceLimit.value = String(settings.faceLimit);
  faceSens.addEventListener("input", () => {
    settings.faceSensitivity = parseFloat(faceSens.value);
    saveSettings();
  });
  faceLimit.addEventListener("input", () => {
    settings.faceLimit = parseFloat(faceLimit.value);
    saveSettings();
    say(`Head range ${Math.round(settings.faceLimit * 100)}%`);
  });

  document.getElementById("btn-center").addEventListener("click", () => {
    face.recenter();
    say("Head pose centred");
  });

  // The cursor is the fallback driver; it must not fight the webcam.
  stage.addEventListener("pointermove", (e) => {
    if (state.face) return;
    const r = stage.getBoundingClientRect();
    const p = pointerFromEvent((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    state.pointer.x = p.x;
    state.pointer.y = p.y;
  });
  stage.addEventListener("pointerleave", () => {
    if (!state.face) state.pointer.x = state.pointer.y = 0;
  });

  stage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      state.zoom = Math.min(2.2, Math.max(0.55, state.zoom * (e.deltaY > 0 ? 0.94 : 1.06)));
      computeView(stage.clientWidth, stage.clientHeight);
    },
    { passive: false }
  );

  window.addEventListener("keydown", (e) => {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === "h") {
      state.ui = !state.ui;
      document.body.classList.toggle("hide-ui", !state.ui);
    }
    if (k === "m") cycleBackground();
    if (k === "c") document.getElementById("btn-mic").click();
    if (k === "f") document.getElementById("btn-face").click();
    if (k === "r") document.getElementById("btn-reset").click();
    if (k === "x") document.getElementById("btn-center").click();
    if (k === "b") blink.trigger();
  });

  window.addEventListener("resize", resize);

  // Never leave the camera light on after the page goes away.
  window.addEventListener("pagehide", () => {
    face.stop();
    mic.stop();
  });
}

/* ----------------------------------------------------------------- loop */

let last = performance.now();
function loop(now) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;

  let talk = 0;
  if (state.mic) talk = mic.read();
  else if (state.demo) talk = Math.max(0, Math.sin(now / 95) * 0.6 + Math.sin(now / 41) * 0.35);

  if (state.face) {
    const pose = face.update(now);
    if (pose.present) {
      const mapped = faceToPose(pose, {
        sensitivity: settings.faceSensitivity,
        limit: settings.faceLimit,
      });
      state.pointer.x = mapped.x;
      state.pointer.y = mapped.y;
      state.roll = mapped.roll;

      // Rising edge only: a blink held over several frames is one blink.
      if (pose.blink > 0.55 && state.lastBlinkShade <= 0.55) blink.trigger();
      state.lastBlinkShade = pose.blink;
    }
  }
  // Keep the "Starting…" state visible while getUserMedia/MediaPipe load.
  if (state.face || face.loading) refreshFaceStatus();

  const eyes = blink.update(dt);

  if (rig) {
    rig.update(dt, {
      pointer: state.pointer,
      talk,
      energy: state.energy,
      roll: state.roll,
      eyes,
    });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    rig.draw(ctx, state.view);
  }
  requestAnimationFrame(loop);
}

/* ---------------------------------------------------------------- start */

wireUI();
refreshUI();
boot().catch((err) => {
  console.error(err);
  say("Could not load the model: " + err.message);
});
