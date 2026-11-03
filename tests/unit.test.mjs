import test from "node:test";
import assert from "node:assert/strict";

import { Spring, clamp, lerp } from "../src/spring.js";
import { faceToPose, pointerFromEvent, smoothingAlpha } from "../src/mapping.js";
import { Blink } from "../src/blink.js";
import { VtuberRig } from "../src/rig.js";

/* --------------------------------------------------------------- spring */

test("spring converges on its target", () => {
  const s = new Spring(0, 70, 0.8);
  s.set(1);
  for (let i = 0; i < 120; i++) s.update(1 / 60);
  assert.ok(Math.abs(s.value - 1) < 0.01, `value ${s.value}`);
});

test("spring survives a negative or huge dt", () => {
  const s = new Spring(0, 90, 0.82);
  s.set(1);
  s.update(-1);
  s.update(10);
  assert.ok(Number.isFinite(s.value), "value must stay finite");
});

test("clamp and lerp", () => {
  assert.equal(clamp(5, -1, 1), 1);
  assert.equal(clamp(-5, -1, 1), -1);
  assert.equal(lerp(0, 10, 0.25), 2.5);
});

/* -------------------------------------------------------------- mapping */

const pose = (yaw = 0, pitch = 0, roll = 0) => ({ yaw, pitch, roll });

test("yaw maps to the opposite screen direction (mirror-image camera)", () => {
  const right = faceToPose(pose(30, 0, 0));
  assert.ok(right.x < -0.9, `expected strong negative x, got ${right.x}`);
  const left = faceToPose(pose(-30, 0, 0));
  assert.ok(left.x > 0.9, `expected strong positive x, got ${left.x}`);
});

test("pitch and roll are inverted too", () => {
  assert.ok(faceToPose(pose(0, 25, 0)).y < -0.9);
  assert.ok(faceToPose(pose(0, 0, 20)).roll < -0.9);
});

test("deadzone suppresses a resting head", () => {
  const p = faceToPose(pose(0.8, -0.6, 0.4));
  assert.ok(p.x === 0 && p.y === 0 && p.roll === 0, JSON.stringify(p));
});

test("limit caps every axis", () => {
  const p = faceToPose(pose(90, 90, 90), { limit: 0.4 });
  assert.ok(Math.abs(p.x) <= 0.4 + 1e-9);
  assert.ok(Math.abs(p.y) <= 0.4 + 1e-9);
  assert.ok(Math.abs(p.roll) <= 0.4 + 1e-9);
});

test("sensitivity scales the response", () => {
  const low = faceToPose(pose(12, 0, 0), { sensitivity: 0.5 });
  const high = faceToPose(pose(12, 0, 0), { sensitivity: 2 });
  assert.ok(Math.abs(high.x) > Math.abs(low.x) * 3);
});

test("a narrower degree range reaches the limit sooner", () => {
  const wide = faceToPose(pose(20, 0, 0), { range: 40 });
  const narrow = faceToPose(pose(20, 0, 0), { range: 20 });
  assert.ok(Math.abs(narrow.x) > Math.abs(wide.x) * 1.5);
});

test("pointer mapping covers the stage", () => {
  assert.deepEqual(pointerFromEvent(0.5, 0.5), { x: 0, y: 0 });
  assert.equal(pointerFromEvent(1, 1).x, 1.2);
  assert.equal(pointerFromEvent(0, 1).y, 0.9);
});

test("smoothingAlpha matches a half-life", () => {
  assert.equal(smoothingAlpha(0, 0.016), 1);
  assert.ok(Math.abs(smoothingAlpha(0.1, 0.1) - 0.5) < 1e-9);
});

/* ---------------------------------------------------------------- blink */

function run(blink, frames, dt = 1 / 120) {
  const seen = [];
  for (let i = 0; i < frames; i++) seen.push(blink.update(dt));
  return seen;
}

test("blink starts open and stays open while idle", () => {
  const b = new Blink({ rng: () => 0.5 });
  assert.equal(run(b, 10).every((v) => v === 1), true);
});

test("a triggered blink closes and reopens", () => {
  const b = new Blink({ rng: () => 0.5 });
  b.trigger();
  const values = run(b, 120); // 1 second at 120 fps
  assert.ok(Math.min(...values) < 0.02, "must fully close");
  assert.equal(values[values.length - 1], 1, "must end open");
});

test("closing is faster than opening (reads as a blink, not a fade)", () => {
  const b = new Blink({ rng: () => 0.5 });
  b.trigger();
  let closedAt = -1;
  let reopenedAt = -1;
  for (let i = 0; i < 240; i++) {
    const v = b.update(1 / 240);
    if (closedAt < 0 && v <= 0.01) closedAt = i / 240;
    if (closedAt >= 0 && reopenedAt < 0 && v >= 0.99) reopenedAt = i / 240;
  }
  assert.ok(closedAt > 0 && closedAt < 0.12, `close took ${closedAt}`);
  assert.ok(reopenedAt > closedAt && reopenedAt - closedAt < 0.35, `open took ${reopenedAt}`);
});

test("double blink is queued rather than swallowed", () => {
  const b = new Blink({ rng: () => 0.5 });
  b.trigger();
  const values = run(b, 15); // first blink is mid-close
  b.trigger(); // second one arrives inside the first
  values.push(...run(b, 240));
  let dips = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0.5 && values[i] <= 0.5) dips++;
  }
  assert.ok(dips >= 2, `expected two closures, saw ${dips}`);
});

test("disabled blink always reports open", () => {
  const b = new Blink({ rng: () => 0.5 });
  b.enabled = false;
  b.trigger();
  assert.equal(run(b, 60).every((v) => v === 1), true);
});

test("autonomous blinking happens within the delay window", () => {
  const b = new Blink({ rng: () => 1, minDelay: 0.2, maxDelay: 0.2 });
  const values = run(b, 240, 1 / 120); // 2 seconds
  assert.ok(Math.min(...values) < 0.05, "should blink on its own");
});

/* ------------------------------------------------------- rig coordination */

function mockCtx() {
  const draws = [];
  let tx = 0;
  let ty = 0;
  let rot = 0;
  const stack = [];
  const gradient = { addColorStop() {} };
  return {
    draws,
    save() {
      stack.push({ tx, ty, rot });
    },
    restore() {
      const s = stack.pop();
      tx = s.tx;
      ty = s.ty;
      rot = s.rot;
    },
    translate(x, y) {
      tx += x;
      ty += y;
    },
    rotate(r) {
      rot += r;
    },
    scale() {},
    drawImage(_img, x, y, w, h) {
      draws.push({ x, y, w, h, tx, ty, rot });
    },
    beginPath() {},
    ellipse() {},
    clip() {},
    fillRect() {},
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    set fillStyle(_v) {},
  };
}

function makeRig() {
  const layers = [
    ["cape", 1, 10, 20, 100, 100],
    ["body", 2, 30, 40, 100, 100],
    ["head", 6, 50, 60, 100, 100],
    ["hat", 7, 70, 80, 100, 100],
  ].map(([id, z, x, y, w, h]) => ({
    id,
    file: `${id}.png`,
    x,
    y,
    w,
    h,
    z,
    pivot: [10, 10],
  }));
  const data = { source: { width: 1024, height: 1536 }, layers, eyes: [{ cx: 390, cy: 311, rx: 36, ry: 36 }] };
  const images = Object.fromEntries(layers.map((l) => [l.id, { fake: true }]));
  return new VtuberRig(data, images);
}

test("head and hat receive the identical transform", () => {
  const rig = makeRig();
  for (let i = 0; i < 90; i++) {
    rig.update(1 / 60, { pointer: { x: 1, y: -0.7 }, talk: 0.4, roll: 0.5, eyes: 1 });
  }
  const ctx = mockCtx();
  rig.draw(ctx, { scale: 1, offsetX: 0, offsetY: 0 });
  const head = ctx.draws.find((d) => d.x === 50);
  const hat = ctx.draws.find((d) => d.x === 70);
  assert.ok(head && hat);
  assert.equal(head.tx, hat.tx);
  assert.equal(head.ty, hat.ty);
  assert.equal(head.rot, hat.rot);
});

test("body moves less than the head", () => {
  const rig = makeRig();
  for (let i = 0; i < 90; i++) {
    rig.update(1 / 60, { pointer: { x: 1, y: 0 }, talk: 0, roll: 1 });
  }
  const ctx = mockCtx();
  rig.draw(ctx, { scale: 1, offsetX: 0, offsetY: 0 });
  const body = ctx.draws.find((d) => d.x === 30);
  const head = ctx.draws.find((d) => d.x === 50);
  assert.ok(Math.abs(head.rot) > Math.abs(body.rot) * 2);
});

test("eye openness is clamped and forwarded to the rig state", () => {
  const rig = makeRig();
  rig.update(1 / 60, { pointer: { x: 0, y: 0 }, eyes: -4 });
  assert.equal(rig.state.eyes, 0);
  rig.update(1 / 60, { pointer: { x: 0, y: 0 }, eyes: 9 });
  assert.equal(rig.state.eyes, 1);
});

test("mirroring flips horizontal motion but not rotation", () => {
  const rig = makeRig();
  for (let i = 0; i < 90; i++) {
    rig.update(1 / 60, { pointer: { x: 1, y: 0 }, talk: 0 });
  }
  const plain = mockCtx();
  rig.draw(plain, { scale: 1, offsetX: 0, offsetY: 0 });
  rig.mirror = true;
  const mirrored = mockCtx();
  rig.draw(mirrored, { scale: 1, offsetX: 0, offsetY: 0 });
  const plainHead = plain.draws.find((d) => d.x === 50);
  const mirrorHead = mirrored.draws.find((d) => d.x === 50);
  // tx is the net displacement: pivotX is added and then cancelled by the
  // translate(-pivot) that puts the layer back in place. Under the mirror the
  // context is translated by the source width, so the net offset is width - dx.
  const plainOffset = plainHead.tx;
  const mirrorOffset = mirrorHead.tx - 1024;
  assert.ok(Math.abs(plainOffset) > 1, "the head should be displaced by the pose");
  assert.ok(Math.abs(plainOffset + mirrorOffset) < 1e-6, "mirror must negate dx");
});
