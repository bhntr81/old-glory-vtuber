#!/usr/bin/env python3
"""Build a VRM 1.0 avatar from the layered cutouts.

The source is a single 2D illustration, so the 3D export is a "paper doll":
every layer becomes a textured card on a real humanoid skeleton. Head tracking,
arm tracking and full-body rigs work, because the cards are bound with proper
skin weights -- the geometry is flat by nature, not by accident.

    python3 tools/build_vrm.py

Writes assets/model/old-glory.vrm  (+ .glb twin, thumbnail).
"""
import json
import os
import struct
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAYERS = os.path.join(ROOT, "assets", "rig.json")
OUT_DIR = os.path.join(ROOT, "assets", "model")

# 1 source pixel -> metres. The visible bust becomes ~1.35 m tall.
MPP = 1.35 / 1536.0
CX, CY = 512.0, 768.0

# name, parent, world position (metres)
HUMANOID = [
    ("hips", None, (0.0, -0.470, 0.0)),
    ("spine", "hips", (0.0, -0.330, 0.0)),
    ("chest", "spine", (0.0, -0.120, 0.0)),
    ("upperChest", "chest", (0.0, 0.010, 0.0)),
    ("neck", "upperChest", (0.0, 0.095, 0.0)),
    ("head", "neck", (0.0, 0.160, 0.0)),
    ("leftShoulder", "upperChest", (0.030, 0.050, 0.0)),
    ("leftUpperArm", "leftShoulder", (0.165, 0.035, 0.0)),
    ("leftLowerArm", "leftUpperArm", (0.225, -0.155, 0.0)),
    ("leftHand", "leftLowerArm", (0.245, -0.305, 0.0)),
    ("rightShoulder", "upperChest", (-0.030, 0.050, 0.0)),
    ("rightUpperArm", "rightShoulder", (-0.165, 0.015, 0.0)),
    ("rightLowerArm", "rightUpperArm", (-0.210, -0.170, 0.0)),
    ("rightHand", "rightLowerArm", (-0.230, -0.320, 0.0)),
    ("leftUpperLeg", "hips", (0.075, -0.470, 0.0)),
    ("leftLowerLeg", "leftUpperLeg", (0.075, -0.820, 0.0)),
    ("leftFoot", "leftLowerLeg", (0.075, -1.140, 0.0)),
    ("leftToes", "leftFoot", (0.075, -1.200, 0.06)),
    ("rightUpperLeg", "hips", (-0.075, -0.470, 0.0)),
    ("rightLowerLeg", "rightUpperLeg", (-0.075, -0.820, 0.0)),
    ("rightFoot", "rightLowerLeg", (-0.075, -1.140, 0.0)),
    ("rightToes", "rightFoot", (-0.075, -1.200, 0.06)),
]

# Which bone each card follows, and how far in front of the body it sits.
RIG = {
    "cape": ("chest", -0.012),
    "body": ("spine", -0.006),
    "arm_left": ("rightLowerArm", 0.004),   # screen-left arm is the model's right
    "cane": ("rightHand", 0.008),
    "arm_right": ("leftLowerArm", 0.004),
    "head": ("head", 0.012),
    "hat": ("hat", 0.020),
}

HAT_BONE = ("hat", "head", (0.0, 0.035, 0.012))


class Bin:
    def __init__(self):
        self.data = bytearray()

    def add(self, payload: bytes, target=None) -> int:
        while len(self.data) % 4:
            self.data.append(0)
        offset = len(self.data)
        self.data.extend(payload)
        return offset

    def view(self, offset, length, target=None):
        v = {"buffer": 0, "byteOffset": offset, "byteLength": length}
        if target is not None:
            v["target"] = target
        return v


def main():
    rig = json.load(open(LAYERS))
    layers = [l for l in rig["layers"] if l["id"] in RIG]
    # "backfill" is a 2D-only seam filler; in 3D the body card already sits behind the head.
    order = ["cape", "body", "arm_left", "cane", "arm_right", "head", "hat"]
    layers.sort(key=lambda l: order.index(l["id"]))

    b = Bin()
    accessors, buffer_views, images, textures, materials, primitives = [], [], [], [], [], []

    # ---------------------------------------------------------------- skeleton
    world = {name: np.array(pos, dtype=np.float64) for name, _, pos in HUMANOID}
    world[HAT_BONE[0]] = world[HAT_BONE[1]] + np.array(HAT_BONE[2])

    nodes = []
    node_index = {}

    def add_node(name, translation=(0, 0, 0), parent=None, **extra):
        idx = len(nodes)
        node = {"name": name, "translation": [float(t) for t in translation]}
        node.update(extra)
        nodes.append(node)
        node_index[name] = idx
        if parent is not None:
            nodes[node_index[parent]].setdefault("children", []).append(idx)
        return idx

    add_node("Root")
    for name, parent, _ in HUMANOID:
        base = world[parent] if parent else np.zeros(3)
        add_node(name, world[name] - base, parent="Root" if parent is None else parent)
    add_node(HAT_BONE[0], world[HAT_BONE[0]] - world[HAT_BONE[1]], parent=HAT_BONE[1])

    joint_names = [n for n, _, _ in HUMANOID] + [HAT_BONE[0]]
    joints = [node_index[n] for n in joint_names]

    ibms = []
    for n in joint_names:
        m = np.eye(4)
        m[:3, 3] = -world[n]
        ibms.append(m.astype(np.float32).tobytes(order="F"))
    ibm_blob = b"".join(ibms)
    ibm_off = b.add(ibm_blob)
    buffer_views.append(b.view(ibm_off, len(ibm_blob)))
    accessors.append({
        "bufferView": len(buffer_views) - 1,
        "componentType": 5126,
        "count": len(ibms),
        "type": "MAT4",
    })

    # ------------------------------------------------------------------- cards
    for layer in layers:
        img_path = os.path.join(ROOT, layer["file"])
        png = open(img_path, "rb").read()
        off = b.add(png)
        buffer_views.append(b.view(off, len(png)))
        images.append({"bufferView": len(buffer_views) - 1, "mimeType": "image/png"})
        textures.append({"source": len(images) - 1, "sampler": 0})
        materials.append({
            "name": layer["id"],
            "pbrMetallicRoughness": {
                "baseColorTexture": {"index": len(textures) - 1},
                "baseColorFactor": [1, 1, 1, 1],
                "metallicFactor": 0.0,
                "roughnessFactor": 1.0,
            },
            "alphaMode": "MASK",
            "alphaCutoff": 0.35,
            "doubleSided": True,
            "extensions": {"KHR_materials_unlit": {}},
        })

        x0 = (layer["x"] - CX) * MPP
        x1 = (layer["x"] + layer["w"] - CX) * MPP
        y1 = (CY - layer["y"]) * MPP
        y0 = (CY - (layer["y"] + layer["h"])) * MPP
        z = RIG[layer["id"]][1]

        pos = np.array([
            [x0, y1, z], [x1, y1, z], [x1, y0, z], [x0, y0, z],
        ], dtype=np.float32)
        uv = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], dtype=np.float32)
        nrm = np.tile(np.array([0, 0, 1], dtype=np.float32), (4, 1))
        joint_idx = joint_names.index(RIG[layer["id"]][0])
        jnt = np.tile(np.array([joint_idx, 0, 0, 0], dtype=np.uint16), (4, 1))
        wgt = np.tile(np.array([1, 0, 0, 0], dtype=np.float32), (4, 1))
        idx = np.array([0, 1, 2, 0, 2, 3], dtype=np.uint16)

        def push(arr, ctype, atype, target=34962):
            off = b.add(arr.tobytes())
            buffer_views.append(b.view(off, arr.nbytes, target))
            acc = {
                "bufferView": len(buffer_views) - 1,
                "componentType": ctype,
                "count": int(arr.shape[0]),
                "type": atype,
            }
            if arr.ndim == 2 and atype == "VEC3" and arr.dtype == np.float32:
                acc["min"] = [float(v) for v in arr.min(axis=0)]
                acc["max"] = [float(v) for v in arr.max(axis=0)]
            accessors.append(acc)
            return len(accessors) - 1

        primitives.append({
            "attributes": {
                "POSITION": push(pos, 5126, "VEC3"),
                "NORMAL": push(nrm, 5126, "VEC3"),
                "TEXCOORD_0": push(uv, 5126, "VEC2"),
                "JOINTS_0": push(jnt, 5123, "VEC4"),
                "WEIGHTS_0": push(wgt, 5126, "VEC4"),
            },
            "indices": push(idx, 5123, "SCALAR", target=34963),
            "material": len(materials) - 1,
        })

    # Skinned mesh nodes must be scene roots: parent transforms are ignored.
    mesh_node = add_node("OldGloryMesh", (0, 0, 0), mesh=0, skin=0)

    # -------------------------------------------------------------- thumbnail
    thumb_path = os.path.join(OUT_DIR, "thumbnail.png")
    os.makedirs(OUT_DIR, exist_ok=True)
    preview = Image.open(os.path.join(ROOT, "assets", "preview.png")).convert("RGBA")
    tile = Image.new("RGBA", (512, 512), (26, 24, 22, 255))
    fit = preview.copy()
    fit.thumbnail((512, 512), Image.LANCZOS)
    tile.alpha_composite(fit, ((512 - fit.width) // 2, (512 - fit.height) // 2))
    tile.save(thumb_path)
    thumb_bytes = open(thumb_path, "rb").read()
    thumb_off = b.add(thumb_bytes)
    buffer_views.append(b.view(thumb_off, len(thumb_bytes)))
    images.append({"bufferView": len(buffer_views) - 1, "mimeType": "image/png"})

    # ------------------------------------------------------------------ VRM
    vrm = {
        "specVersion": "1.0",
        "meta": {
            "name": "Old Glory",
            "version": "1.0",
            "authors": ["bhntr81"],
            "copyrightInformation": "Built from an original illustration.",
            "contactInformation": "https://github.com/bhntr81",
            "thirdPartyLicenses": "",
            "thumbnailImage": len(images) - 1,
            "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
            "avatarPermission": "everyone",
            "allowExcessivelyViolentUsage": False,
            "allowExcessivelySexualUsage": False,
            "commercialUsage": "personalNonProfit",
            "allowPoliticalOrReligiousUsage": True,
            "allowAntisocialOrHateUsage": False,
            "creditNotation": "required",
            "allowRedistribution": True,
            "modification": "allowModification",
        },
        "humanoid": {
            "humanBones": {
                name: {"node": node_index[name]} for name, _, _ in HUMANOID
            }
        },
        "firstPerson": {},
        "lookAt": {"type": "bone"},
        "expressions": {},
    }

    gltf = {
        "asset": {"version": "2.0", "generator": "old-glory build_vrm.py"},
        "extensionsUsed": ["VRMC_vrm", "KHR_materials_unlit"],
        "extensions": {"VRMC_vrm": vrm},
        "scene": 0,
        "scenes": [{"name": "OldGlory", "nodes": [node_index["Root"], mesh_node]}],
        "nodes": nodes,
        "meshes": [{"name": "OldGlory", "primitives": primitives}],
        "materials": materials,
        "textures": textures,
        "images": images,
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}],
        "skins": [{
            "name": "OldGloryRig",
            "inverseBindMatrices": 0,
            "joints": joints,
            "skeleton": node_index["hips"],
        }],
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(b.data)}],
    }

    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    while len(json_bytes) % 4:
        json_bytes += b" "
    bin_bytes = bytes(b.data)
    while len(bin_bytes) % 4:
        bin_bytes += b"\x00"

    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    glb = bytearray()
    glb += struct.pack("<III", 0x46546C67, 2, total)
    glb += struct.pack("<II", len(json_bytes), 0x4E4F534A) + json_bytes
    glb += struct.pack("<II", len(bin_bytes), 0x004E4942) + bin_bytes

    for name in ("old-glory.vrm", "old-glory.glb"):
        with open(os.path.join(OUT_DIR, name), "wb") as fh:
            fh.write(glb)

    print(f"  mesh node     {mesh_node}")
    print(f"  cards         {len(primitives)}")
    print(f"  joints        {len(joints)}")
    print(f"  size          {total/1024/1024:.2f} MB")
    print(f"  wrote         {OUT_DIR}/old-glory.vrm")


if __name__ == "__main__":
    main()
