# Next prompt — fix hat alpha holes and refresh the export

**Authored by:** delegated prompt-writing agent, subagent session `ses_e93e84294ffeHNctVEXXrBbPfc`; model identity not supplied. The primary agent read this prompt before execution.  
**Baseline:** `main` @ `705204ae9a2d3210856f73c9058e46dfd51ad66c`; snapshot at `/tmp/opencode/og-alpha-baseline-1792815674`; full state in `STATUS.md`.

## Objective

Fix the confirmed Priority A alpha-bleed in the layered rig: the hat crown and brim interiors must render opaque over green and checkerboard backgrounds. Preserve the source artwork, the intended smoky silhouette edge, and all uncommitted work. Add one durable core-opacity regression check. Rebuild the VRM/GLB/thumbnail so export textures match the regenerated layers.

## Starting state and scope

- Actual path: `/home/kali/Programming/Projects/Vtuber`.
- Preserve all 28 working-tree entries; no commit, push, deploy, reset, clean, stash, checkout/restore, or deletion of untracked work. Do not restore `assets/layers/backfill.png`.
- Source artwork `assets/source/character.jpg` is read-only.
- In scope: `tools/masks.py`, `tools/matte.py`, `tools/build_layers.py`, new `tools/check_alpha.py`, one npm script in `package.json`, and regenerated `assets/layers/*.png`, `assets/rig.json`, `assets/preview.png`, `assets/model/*`.
- Out of scope: renderer changes, blink alignment, mirror test repair, e2e camera timing, README rewrite, new dependencies, VRM schema/app validation.
- No VTuber app, Khronos validator, or real physical-webcam validation is available; do not claim any.

## Required behavior

1. The 16 px-eroded core of the hand-authored `masks.HAT` crown+brim polygons must be effectively fully opaque: mean alpha ≥ 0.995 and no 4-connected `alpha < 230` component ≥ 32 px, for both `assets/layers/hat.png` and `assets/preview.png`.
2. Preserve RGB and the feathered outer edge; do not repaint, recolor, inpaint, or make unrelated layers opaque.
3. Keep the 7-layer ids, z-order, pivots, and current `eyes` metadata. Head and hat must still share one canvas pivot.
4. Rebuild `assets/model/old-glory.vrm`, `.glb`, and `thumbnail.png`. Every embedded layer texture must byte-match the current layer PNG, and the embedded thumbnail must byte-match `assets/model/thumbnail.png`.

## Acceptance checks

```bash
cd /home/kali/Programming/Projects/Vtuber

# 1. New check fails before the fix and passes after it
python3 tools/check_alpha.py 2>&1 | tee /tmp/opencode/og-alpha-check-before.txt

# 2. Rebuild generated assets, then verify
npm run build
npm run check:alpha
npm test          # expected 31/32, only the known mirroring failure
npm run test:e2e  # expected 8/9, only the known camera-timing failure

# 3. Export freshness: all 7 materials and thumbnail must print True
python3 - <<'PY'
import json, struct, pathlib
root = pathlib.Path('.')
b = (root / 'assets/model/old-glory.vrm').read_bytes()
jlen = struct.unpack_from('<I', b, 12)[0]
g = json.loads(b[20:20+jlen])
off = 20 + jlen
blen = struct.unpack_from('<I', b, off)[0]
bin = b[off+8:off+8+blen]
for m in g['materials']:
    src = g['textures'][m['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
    v = g['bufferViews'][g['images'][src]['bufferView']]
    got = bin[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
    want = (root / 'assets/layers' / f"{m['name']}.png").read_bytes()
    print(m['name'], got == want)
thumb = g['images'][g['extensions']['VRMC_vrm']['meta']['thumbnailImage']]
v = g['bufferViews'][thumb['bufferView']]
got = bin[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
print('thumbnail', got == (root / 'assets/model/thumbnail.png').read_bytes())
PY

# 4. Visual check: serve locally and capture green + dark screenshots
python3 -m http.server 8000
# In another shell:
chromium --headless=new --no-sandbox --disable-gpu --enable-unsafe-swiftshader \
  --hide-scrollbars --window-size=1024,1536 --virtual-time-budget=10000 \
  --user-data-dir=/tmp/opencode/og-shot-profile \
  --screenshot=/tmp/opencode/og-alpha-green.png \
  'http://127.0.0.1:8000/index.html?bg=green&ui=0'
```

Inspect the green screenshot and a crop of the hat: no green may show inside the opaque hat body; the smoky edge, head/mask, cape, body, and arms must remain visually unchanged; `tools/build_layers.py`’s checkerboard output must show no hat-core holes.

## Baseline failures and stopping condition

- Known pre-existing failures: `npm test` 31/32 (`mirroring flips horizontal motion but not rotation`), `npm run test:e2e` 8/9 (camera timing). Do not modify or weaken existing tests.
- Do not fix the blink overlay (`rig.json` eyes at cy 311/310 vs actual lens centres ≈285–295), recentre logic, README, or Pages in this task.
- Stop when the acceptance checks pass, or after two attempts at the same alpha failure with no new evidence; then report the two attempts and exact outputs instead of repeating.
- Finish with exact commands run, before/after core metrics, changed paths, screenshot paths, test results, and honest limitations.
