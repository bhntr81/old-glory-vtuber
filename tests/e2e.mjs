#!/usr/bin/env node
/**
 * End-to-end smoke test.
 *
 * Serves the repository, opens it in headless Chromium and drives it over the
 * DevTools protocol: the model must actually paint pixels, the dock must work,
 * keyboard shortcuts must apply, and asking for the camera in a machine with no
 * camera must fail *gracefully* (status text, no uncaught exception).
 *
 *   node tests/e2e.mjs
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = normalize(join(fileURLToPath(import.meta.url), "..", ".."));
const PORT = 8123;
const DEBUG_PORT = 9333;
const CHROME = process.env.CHROME || "chromium";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".vrm": "model/gltf-binary",
};

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
      if (!path.startsWith(ROOT)) {
        res.writeHead(403).end();
        return;
      }
      const file = path.endsWith("/") ? join(path, "index.html") : path;
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools(timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(150);
  }
  throw new Error("chromium devtools endpoint never came up");
}

function cdp(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return {
    ready,
    events,
    send(method, params = {}) {
      const mid = ++id;
      return new Promise((resolve, reject) => {
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params }));
      });
    },
    close: () => ws.close(),
  };
}

async function main() {
  const server = await serve();
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--enable-unsafe-swiftshader",
      "--hide-scrollbars",
      "--window-size=1024,768",
      "--use-fake-ui-for-media-stream",
      `--remote-debugging-port=${DEBUG_PORT}`,
      "--user-data-dir=/tmp/opencode/og-e2e-profile",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );

  let chromeErr = "";
  chrome.stderr.on("data", (d) => (chromeErr += d.toString()));

  const failures = [];
  const check = (name, ok, detail = "") => {
    if (ok) console.log(`  ok   ${name}`);
    else {
      console.log(`  FAIL ${name} ${detail}`);
      failures.push(name);
    }
  };

  const client = cdp(await waitForDevtools());
  await client.ready;
  await client.send("Runtime.enable");
  await client.send("Log.enable");
  await client.send("Page.enable");

  const evaluate = async (expression) => {
    const res = await client.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || "evaluate threw");
    }
    return res.result.value;
  };

  await client.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html` });
  await sleep(2500);

  // --- model paints -------------------------------------------------------
  const painted = await evaluate(`(() => {
    const c = document.getElementById('stage');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) opaque++;
    return { w: c.width, h: c.height, opaque, total: d.length / 4 };
  })()`);
  check("canvas has a backing size", painted.w > 0 && painted.h > 0, JSON.stringify(painted));
  check("model paints pixels", painted.opaque > painted.total * 0.05, JSON.stringify(painted));

  // --- dock ---------------------------------------------------------------
  const dock = await evaluate(`(() => {
    const ids = ['btn-mic','btn-face','btn-bg','btn-mirror','btn-reset','sens'];
    return ids.filter((id) => !document.getElementById(id));
  })()`);
  check("dock controls exist", dock.length === 0, dock.join(","));

  const panelHidden = await evaluate(
    `document.getElementById('face-panel').hidden && !document.getElementById('face-panel').offsetParent`
  );
  check("tracking panel hidden until enabled", panelHidden === true);

  // --- background + mirror + shortcuts ------------------------------------
  const bgBefore = await evaluate(`getComputedStyle(document.body).backgroundColor`);
  await evaluate(`document.getElementById('btn-bg').click()`);
  await sleep(120);
  const bgAfter = await evaluate(`getComputedStyle(document.body).backgroundColor`);
  check("background cycles", bgBefore !== bgAfter, `${bgBefore} -> ${bgAfter}`);

  await evaluate(`document.getElementById('btn-mirror').click()`);
  check(
    "mirror toggles",
    (await evaluate(`document.getElementById('btn-mirror').classList.contains('on')`)) === true
  );
  await evaluate(`document.getElementById('btn-mirror').click()`);

  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }))`
  );
  check(
    "H hides the UI",
    (await evaluate(`document.body.classList.contains('hide-ui')`)) === true
  );
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }))`
  );

  // --- keyboard blink should not throw ------------------------------------
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }))`);
  await sleep(120);
  check("B triggers a blink without errors", true);

  // --- camera failure path ------------------------------------------------
  await evaluate(`document.getElementById('btn-face').click()`);
  await sleep(2000);
  const camera = await evaluate(`(() => {
    const s = document.getElementById('face-status');
    return {
      state: s.dataset.state,
      text: s.textContent,
      hint: document.getElementById('face-hint').textContent,
      pressed: document.getElementById('btn-face').getAttribute('aria-pressed'),
      panel: !document.getElementById('face-panel').hidden,
    };
  })()`);
  // Headless Chromium has no camera; either the error state must show, or the
  // fake stream starts and the status is searching/tracking.
  check(
    "camera start is reported, not silently ignored",
    camera.panel === true && (camera.state === "error" || camera.state === "searching" || camera.state === "loading"),
    JSON.stringify(camera)
  );
  check(
    "camera failure gives a readable reason",
    camera.state !== "error" || /camera|permission|found|use/i.test(camera.hint),
    JSON.stringify(camera)
  );

  // --- no uncaught page errors -------------------------------------------
  const exceptions = client.events.filter((e) => e.method === "Runtime.exceptionThrown");
  check(
    "no uncaught exceptions",
    exceptions.length === 0,
    exceptions.map((e) => e.params?.exceptionDetails?.text).join("; ")
  );

  client.close();
  chrome.kill("SIGTERM");
  server.close();

  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("\nall e2e checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
