# Old Glory — project status

**Baseline date:** 2026-10-23
**Branch:** `main` (tracks `origin/main`)
**Baseline commit:** `705204ae9a2d3210856f73c9058e46dfd51ad66c` — “Old Glory: layered VTuber rig and VRM export from a single illustration”
**Working tree at baseline:** dirty. 22 tracked files modified or deleted, plus untracked
`src/face.js`, `src/blink.js`, `src/mapping.js`, `tests/`, `_face.jpg`, `_facetest.html`.
No commits, pushes, or deployments were made during this baseline.

> The repository is at `/home/kali/Programming/Projects/Vtuber`, not
> `/home/kali/Projects/Vtuber` (the latter does not exist).

## Current state after the first fix pass (2026-10-24)

The baseline below is preserved as the pre-fix record. Since then, the working
tree (still uncommitted) has these additional verified changes:

- **Hat seam fixed.** A red-band bridge polygon closes the crown/brim strip,
  and the delegated alpha task added an eroded `SOLID_CORE_ERODE` fill so the
  hat interior cannot go translucent where the matte mistakes cloth for smoke.
  Browser and three-vrm renders show no green through the hat body.
- **Blink overlay contained.** The lid ellipses were reduced/shifted to the
  visible goggle glass (`402,306 r24` and `500,310 r28`). The left lid no longer
  paints onto the beak. This remains a stylised lens-shutter cue, not a human
  eyelid; the source has no visible eyes.
- **VRM license fixed.** `meta.licenseUrl` is now
  `https://vrm.dev/licenses/1.0/`; the CC BY URL is in `otherLicenseUrl`.
  `@pixiv/three-vrm` 3.5.5 now loads the model with zero errors.
- **Face-startup UI fixed.** The panel shows “Starting…” during the permission
  prompt and MediaPipe download; the button is guarded against a double start;
  stopping tracking resets the pointer and roll to neutral.
- **Mirror unit test corrected.** It now checks the actual net transform
  (`tx = 1024 - plain tx`) rather than subtracting a pivot that is already
  cancelled.
- **Alpha regression check added** by the delegated prompt-writing task:
  `npm run check:alpha` fails on the pre-fix snapshot (mean alpha 0.9544/0.9559,
  two hole components) and passes now (mean 1.0000, zero components).

Post-fix verification actually run:

| Check | Result |
| --- | --- |
| `npm test` | **32/32 pass** |
| `npm run test:e2e` | **11/11 checks pass** |
| `npm run check:alpha` | **PASS**, mean 1.0000, no core holes |
| Export freshness | all 7 embedded textures + thumbnail **True** |
| Khronos `gltf-validator` | **0 errors, 0 warnings, 9 infos** |
| VRM 1.0 JSON schema | **0 errors** |
| three-vrm 3.5.5 import/render | **0 errors**, head 0.5 rad moves hat with head |
| Green-background browser render | hat body solid; no green inside |
| Camera fake-device path | reaches “Looking for a face”; startup feedback visible |
| Synthetic MediaPipe tracking | live pose after warm-up; no physical camera used |

Remaining known defects after this pass:

1. **Smoke/fog halo** around the outer silhouette (hat brim, shoulders, arms)
   on green and in 3D. The hat *core* is now solid, but the outer edge still
   carries semi-transparent smoke colour. This is the main remaining visual
   issue and needs a focused matte/edge-decontamination pass; it was **not**
   changed in this pass because it risks the cut.
2. **Real VTuber application validation** still not done. three-vrm is a
   runtime smoke test, not VSeeFace/Warudo/Resonite.
3. **Physical webcam** still not tested.
4. **Licence metadata inconsistency** (`commercialUsage: personalNonProfit`
   vs CC BY 4.0) still needs an author decision.


## What the project is

A single 1024×1536 illustration turned into:

- **`index.html` + `src/`** — a zero-build browser rig. Layer PNGs are drawn on
  a canvas with per-part springs. Inputs: pointer, microphone, and (in the
  uncommitted work) webcam head tracking via MediaPipe Face Landmarker.
- **`assets/model/old-glory.vrm` (+ `.glb`)** — a VRM 1.0 “paper doll” export:
  seven textured cards, each rigidly skinned to one humanoid joint, with a
  non-humanoid `hat` joint parented to `head`.
- **`tools/`** — Python cut/matte/VRM build pipeline. `build_layers.py` cuts
  `assets/source/character.jpg` using polygons in `masks.py`; `build_vrm.py`
  packs the layers into the VRM.
- **`tests/`** — Node unit/assets tests and a headless-Chromium e2e smoke test
  (untracked work from the previous session).

## Commands

| Command | Purpose |
| --- | --- |
| `npm start` / `python3 -m http.server 8000` | Serve the app at `http://localhost:8000` |
| `npm run build:layers` | Re-cut layers and `assets/rig.json` |
| `npm run build:vrm` | Rebuild `old-glory.vrm` / `.glb` / thumbnail |
| `npm run build` | Both of the above |
| `npm test` | Unit + asset/VRM structure tests |
| `npm run test:e2e` | Headless Chromium smoke test on port 8123 |

Environment used for this baseline: Node 24.21.0, npm 12.2.0, Python 3.14.7,
Pillow 12.3.0, NumPy 2.4.6, SciPy 1.17.1, Chromium 150.0.7871.181.
No `gltf-validator` CLI is installed; the Khronos npm validator was run from a
throwaway directory. No VRM/VSeeFace/Warudo application is installed.

## Verified working (checks actually run)

- **Unit/assets suite:** `npm test` → 31 passed, 1 failed. The failure is a
  bad assertion in the new mirror test, not a rig failure: the test subtracts
  the pivot from `tx`, but `tx` is already the net displacement after the
  `translate(-pivot)` step. Direct inspection shows mirrored `tx = 1024 - plain tx`,
  which is the intended mirror behaviour.
- **App startup and rendering:** headless Chromium paints the model; the dock,
  background cycling, mirror toggle, `H` hide-UI shortcut, and `B` blink key
  all run without uncaught exceptions.
- **Camera failure path:** with no fake device, the app reports a camera error
  in the status panel and does not throw.
- **Camera success path:** with Chromium’s fake device, the app reaches
  “Looking for a face” in about 3 seconds and keeps running.
- **Synthetic tracking:** `_facetest.html` with `_face.jpg` loads MediaPipe from
  the CDN and returns a live pose after the model is cached. This verifies the
  tracker wiring, not a physical webcam.
- **Layer rebuild reproducibility:** `npm run build:layers` in a throwaway copy
  produced byte-identical PNGs and `rig.json` (SHA-256 compared).
- **VRM rebuild determinism:** two consecutive `build_vrm.py` runs in the
  throwaway copy produced identical VRM/GLB hashes.
- **Khronos glTF validation:** `gltf-validator` npm API → **0 errors, 0 warnings,
  9 infos** for both the committed and freshly built VRM. Infos are the
  unsupported `VRMC_vrm` extension, the thumbnail-only image, and NPOT textures.
- **VRM 1.0 JSON schema:** official `VRMC_vrm.schema.json` (with glTF base
  schemas) → **0 errors** for both models.
- **three.js runtime import:** after correcting the license URL in a throwaway
  copy, `@pixiv/three-vrm` 3.5.5 loads the model with no errors and renders it.
  Rotating the `head` bone by 0.5 rad moves the hat with the head.

## Verified broken / defects found

1. **Hat crown/brim gap.** The `HAT` cut is two polygons with no overlap. A
   horizontal transparent strip crosses the crown above the red band; on a
   green background it is a visible green line. It is also visible in the
   3D render. This is a real silhouette gap, not a texture seam.
2. **VRM rejected by three-vrm.** `meta.licenseUrl` is the CC BY URL. VRM 1.0
   runtimes expect the VRM license document (`https://vrm.dev/licenses/1.0/`);
   three-vrm throws `VRMMetaLoaderPlugin: The license url ... is not accepted`.
   The CC BY URL belongs in `otherLicenseUrl`.
3. **Blink paints outside the goggle glass.** The lid overlay uses 36 px
   ellipses that cover the beak/fabric as well as the lens. Every automatic
   blink (2.6–7.2 s) darkens part of the mask; on the left lens the beak is in
   front of the glass but the overlay is drawn on top of both. The mask design
   has opaque goggles and no painted eyelids, so a human blink is not present
   in the source.
4. **Startup feedback is missing.** While `getUserMedia`/MediaPipe is loading,
   the face panel stays hidden and the button stays “Face/off”; it only updates
   after `face.start()` resolves. The e2e test catches this after 2 s.
5. **Stopping tracking leaves the last pose.** `toggleFace()` clears `roll` but
   not `state.pointer`, so the avatar can remain turned after tracking stops.
6. **Committed VRM is stale.** Its embedded cane texture and thumbnail differ
   from the current layer PNGs (the cane layer was regenerated after the VRM
   was built). The current `assets/model/old-glory.vrm` is not reproducible from
   the current working tree until rebuilt.
7. **Fog/smoke halo on cutout edges.** On a green background there is a grey
   semi-transparent halo around the hat, shoulders and left arm. It is baked
   into the layer alpha/colour, not just the CSS background. This is visible in
   the 2D render and in three-vrm.
8. **Metadata/licence inconsistency (needs author decision).** The model says
   CC BY 4.0 but also `commercialUsage: personalNonProfit`, which contradicts
   CC BY’s allowance of commercial use. Not changed without author input.

## Implemented but not verified

- **Physical webcam tracking.** The MediaPipe path is exercised by a synthetic
  video stream, but no real camera was opened and no real face was tracked.
- **Real VTuber application import.** No VSeeFace/Warudo/Resonite installation
  is available here. three-vrm loading is a useful runtime check, not a
  substitute for the intended application.
- **VRM head/arm/full-body behaviour in an app.** The skeleton and skin weights
  are structurally verified and three-vrm renders them; app-specific retargeting
  and tracking behaviour remain untested.
- **Blinks under real tracking.** Blink blendshape detection is wired, but the
  visual result is defective as described above.

## Not implemented

- No spring-bone/secondary-motion physics in the VRM.
- No true eyelid geometry; the goggles are opaque and the source has no eyes to
  blink.
- No camera-device selection, tracking-loss timeout, or explicit cancel during
  model loading.
- No committed status/handoff docs before this file (the README is the only
  project documentation and is stale about face tracking and tests).

## Blocked by missing tools or external access

- **Intended VTuber application test:** blocked until VSeeFace/Warudo (or
  another target app) is available. Exact manual test is recorded in
  `NEXT_PROMPT.md`.
- **Physical webcam test:** blocked on a camera and a person in frame; not
  attempted here.
- **Deployment:** GitHub Pages was verified to match commit `705204a`
  (`index.html`, `src/main.js`, `assets/rig.json` byte-identical to HEAD). The
  live site does **not** include the uncommitted face-tracking work. Publishing
  is not authorized and was not done.

## Observations vs assumptions

- **Observed:** all test/build/validator/runtime results above; the hat gap and
  blink spill were reproduced in rendered PNGs; the live Pages files match HEAD.
- **Assumed, not proven:** the 3D card rig will read acceptably in a real VTuber
  app at normal viewing distance; the MediaPipe pose signs will feel correct to
  a live performer (mathematical inversion is unit-tested, but feel is not).
- **Do not claim:** “works in VSeeFace/Warudo”, “webcam verified on real
  hardware”, or “VRM imports cleanly everywhere”. The current evidence supports
  “structurally valid and loads in three-vrm after the license fix”.
