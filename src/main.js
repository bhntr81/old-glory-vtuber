import { VtuberRig } from "./rig.js";
import { Mic } from "./mic.js";

const params = new URLSearchParams(location.search);

const BG_MODES = {
  studio: "radial-gradient(120% 100% at 50% 18%, #4a443c 0%, #26231f 45%, #131211 100%)",
  dark: "#000000",
  green: "#00b140",
  blue: "#0a1a2f",
  none: "transparent",
};

const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d", { alpha: true });
const stage = document.getElementById("stage-wrap");
const toast = document.getElementById("toast");

const state = {
  pointer: {
    x: parseFloat(params.get("px") || "0") || 0,
    y: parseFloat(params.get("py") || "0") || 0,
  },
  view: { scale: 1, offsetX: 0, offsetY: 0 },
  zoom: 1,
  bg: params.get("bg") || "studio",
  mic: false,
  mirror: params.get("mirror") === "1",
  demo: params.get("demo") === "1",
  ui: params.get("ui") !== "0",
  energy: 1,
};

let rig = null;
const mic = new Mic();

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
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
}

function refreshUI() {
  const micBtn = document.getElementById("btn-mic");
  micBtn.classList.toggle("on", state.mic);
  micBtn.setAttribute("aria-pressed", String(state.mic));
  micBtn.querySelector(".label").textContent = state.mic ? "Listening" : "Mic";
  document.getElementById("btn-mirror").classList.toggle("on", state.mirror);
  document.getElementById("bg-name").textContent = state.bg;
}

function cycleBackground() {
  const keys = Object.keys(BG_MODES);
  state.bg = keys[(keys.indexOf(state.bg) + 1) % keys.length];
  applyBackground();
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
  sens.addEventListener("input", () => {
    mic.sensitivity = parseFloat(sens.value);
  });

  stage.addEventListener("pointermove", (e) => {
    const r = stage.getBoundingClientRect();
    state.pointer.x = ((e.clientX - r.left) / r.width - 0.5) * 2.4;
    state.pointer.y = ((e.clientY - r.top) / r.height - 0.5) * 1.8;
  });
  stage.addEventListener("pointerleave", () => {
    state.pointer.x = state.pointer.y = 0;
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
    if (e.key === "h") {
      state.ui = !state.ui;
      document.body.classList.toggle("hide-ui", !state.ui);
    }
    if (e.key === "m") cycleBackground();
    if (e.key === "c") document.getElementById("btn-mic").click();
    if (e.key === "r") document.getElementById("btn-reset").click();
  });

  window.addEventListener("resize", resize);
}

/* ----------------------------------------------------------------- loop */

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  let talk = 0;
  if (state.mic) talk = mic.read();
  else if (state.demo) talk = Math.max(0, Math.sin(now / 95) * 0.6 + Math.sin(now / 41) * 0.35);

  if (rig) {
    rig.update(dt, { pointer: state.pointer, talk, energy: state.energy });
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
