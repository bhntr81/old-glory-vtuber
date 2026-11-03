import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rig = JSON.parse(await readFile(join(ROOT, "assets/rig.json"), "utf8"));

/* ------------------------------------------------------------- rig.json */

test("rig.json describes a complete model", () => {
  assert.equal(rig.source.width, 1024);
  assert.equal(rig.source.height, 1536);
  const ids = rig.layers.map((l) => l.id);
  assert.deepEqual(ids, ["cape", "body", "arm_left", "cane", "arm_right", "head", "hat"]);
  for (const l of rig.layers) {
    assert.ok(l.w > 0 && l.h > 0, l.id);
    assert.ok(l.x >= 0 && l.y >= 0, l.id);
    assert.ok(rig.pivots[l.id], `missing pivot for ${l.id}`);
    // Pivots are stored relative to the crop, and the head group pivots at the
    // neck, which is outside the hat's own crop box. What must hold is that the
    // pivot lands inside the source canvas.
    const ax = l.x + l.pivot[0];
    const ay = l.y + l.pivot[1];
    assert.ok(ax >= 0 && ax <= rig.source.width, `${l.id} pivot x on canvas (${ax})`);
    assert.ok(ay >= 0 && ay <= rig.source.height, `${l.id} pivot y on canvas (${ay})`);
  }
});

test("head and hat pivot on the same canvas point", () => {
  const head = rig.layers.find((l) => l.id === "head");
  const hat = rig.layers.find((l) => l.id === "hat");
  assert.equal(head.x + head.pivot[0], hat.x + hat.pivot[0]);
  assert.equal(head.y + head.pivot[1], hat.y + hat.pivot[1]);
});

test("head and hat share the same source pivot (one unit)", () => {
  assert.deepEqual(rig.pivots.head, rig.pivots.hat);
});

test("z-order is strictly increasing (no draw-order ambiguity)", () => {
  for (let i = 1; i < rig.layers.length; i++) {
    assert.ok(rig.layers[i].z > rig.layers[i - 1].z);
  }
});

test("the blink overlay has one lens shape per goggle", () => {
  assert.equal(rig.eyes.length, 2);
  for (const e of rig.eyes) {
    assert.ok(e.rx > 8 && e.ry > 8, "lens must be big enough to see");
    assert.ok(e.cx > 0 && e.cx < rig.source.width);
    assert.ok(e.cy > 0 && e.cy < rig.source.height);
  }
});

/* ---------------------------------------------------------------- layers */

test("every layer file exists and is the size rig.json claims", async () => {
  for (const l of rig.layers) {
    const buf = await readFile(join(ROOT, l.file));
    assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], `${l.id} is a PNG`);
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    assert.equal(w, l.w, `${l.id} width`);
    assert.equal(h, l.h, `${l.id} height`);
    assert.ok(buf.length > 2000, `${l.id} is not an empty image`);
  }
});

/* ------------------------------------------------------------------ VRM */

const VRM = join(ROOT, "assets/model/old-glory.vrm");
const glb = await readFile(VRM);

function parseGlb(buf) {
  assert.equal(buf.readUInt32LE(0), 0x46546c67, "glTF magic");
  assert.equal(buf.readUInt32LE(4), 2, "glTF version");
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const binHeader = 20 + jsonLen + ((4 - (jsonLen % 4)) % 4);
  const binLen = buf.readUInt32LE(binHeader);
  const bin = buf.subarray(binHeader + 8, binHeader + 8 + binLen);
  return { json, bin };
}

const { json: gltf, bin } = parseGlb(glb);

function accessorValues(index) {
  const acc = gltf.accessors[index];
  const view = gltf.bufferViews[acc.bufferView];
  const start = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
  const out = [];
  if (acc.componentType === 5123) {
    for (let i = 0; i < acc.count * comps; i++) out.push(bin.readUInt16LE(start + i * 2));
  } else if (acc.componentType === 5125) {
    for (let i = 0; i < acc.count * comps; i++) out.push(bin.readUInt32LE(start + i * 4));
  } else if (acc.componentType === 5126) {
    for (let i = 0; i < acc.count * comps; i++) out.push(bin.readFloatLE(start + i * 4));
  } else {
    throw new Error(`unhandled componentType ${acc.componentType}`);
  }
  return { acc, values: out, comps };
}

test("VRM is a valid glTF binary with the VRM 1.0 extension", () => {
  assert.equal(gltf.asset.version, "2.0");
  assert.ok(gltf.extensionsUsed.includes("VRMC_vrm"));
  assert.equal(gltf.extensions.VRMC_vrm.specVersion, "1.0");
  assert.ok(gltf.extensions.VRMC_vrm.meta.name);
});

test("humanoid has the bones a VTuber runtime expects", () => {
  const bones = gltf.extensions.VRMC_vrm.humanoid.humanBones;
  for (const name of ["hips", "spine", "chest", "neck", "head", "leftShoulder", "rightShoulder"]) {
    assert.ok(bones[name], `missing humanoid bone ${name}`);
    assert.equal(typeof bones[name].node, "number");
  }
});

/** The seven cards are primitives of one mesh, named by their material. */
function cards() {
  const prims = gltf.meshes.flatMap((m) => m.primitives);
  return prims.map((p) => {
    const name = gltf.materials[p.material].name;
    const { values, acc } = accessorValues(p.attributes.JOINTS_0);
    const weights = accessorValues(p.attributes.WEIGHTS_0).values;
    const joints = new Set();
    for (let i = 0; i < acc.count; i++) {
      if (weights[i * 4] > 0.99) joints.add(values[i * 4]);
    }
    return { name, joint: values[0], joints: [...joints], weights };
  });
}

test("every card is rigidly skinned to exactly one joint", () => {
  const all = cards();
  assert.equal(all.length, 7, "one card per layer");
  for (const card of all) {
    assert.equal(card.joints.length, 1, `${card.name} must follow a single joint`);
  }
});

test("the hat card is parented to the head, not to the world", () => {
  const skin = gltf.skins[0];
  const names = skin.joints.map((i) => gltf.nodes[i].name);
  const headIdx = gltf.nodes.findIndex((n) => n.name === "head");
  const hatIdx = gltf.nodes.findIndex((n) => n.name === "hat");
  assert.ok(headIdx >= 0 && hatIdx >= 0, `head=${headIdx} hat=${hatIdx}`);
  const parentOfHat = gltf.nodes.findIndex((n) => (n.children || []).includes(hatIdx));
  assert.equal(parentOfHat, headIdx, "hat bone must be a child of the head bone");
  assert.ok(names.includes("head"));
});

test("head card and hat card use their own bones, and all cards differ", () => {
  const byName = new Map(cards().map((c) => [c.name, c.joint]));
  assert.ok(byName.has("head") && byName.has("hat"));
  assert.notEqual(byName.get("head"), byName.get("hat"));
  assert.equal(new Set(byName.values()).size, 7, "each card on its own joint");
});
