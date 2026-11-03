import { Spring, clamp } from "./spring.js";

const DEG = Math.PI / 180;

/**
 * Per-part motion. Values are tuned so the silhouette reads as cloth and
 * leather rather than as a stack of cards:
 *   yaw/pitch  -1..1 pointer position
 *   breath     -1..1 slow idle cycle
 *   talk        0..1 microphone envelope
 *   lag         0..1 how much this part trails the head (secondary motion)
 */
const MOTION = {
  body: {
    rot: (s) => s.yaw * 0.55 + s.roll * 0.5 + s.breath * 0.22,
    dx: (s) => s.yaw * 4,
    dy: (s) => -s.breath * 2 + s.talk * 1.2 - s.pitch * 2,
    scale: (s) => 1 + s.breath * 0.004,
  },
  cape: {
    rot: (s) => s.yaw * 0.38 + s.roll * 0.35 + s.sway * 0.45,
    dx: (s) => -s.yaw * 3,
    dy: (s) => s.breath * 1.2,
  },
  arm_left: {
    rot: (s) => s.yaw * 0.9 + s.breath * 0.35,
    dx: (s) => s.yaw * 2,
  },
  cane: {
    rot: (s) => s.yaw * 0.7 + s.breath * 0.2,
  },
  arm_right: {
    rot: (s) => s.yaw * 0.8 - s.breath * 0.3,
    dx: (s) => s.yaw * 1.5,
    dy: (s) => -s.breath * 1.2,
  },
};

/**
 * The whole head assembly (hat, hood, mask, goggles, scarf) is one rigid unit.
 * Every one of those layers gets this exact transform and the neck pivot, so
 * no relative shear or gap can ever open between them.
 */
const HEAD_MOTION = {
  rot: (s) => s.yaw * 3.4 + s.roll * 3.6 + s.talk * 1.2,
  dx: (s) => s.yaw * 9,
  dy: (s) => -s.breath * 1.6 - s.talk * 5 - s.pitch * 7,
  scaleY: (s) => 1 + s.talk * 0.01,
};
MOTION.head = HEAD_MOTION;
MOTION.hat = HEAD_MOTION;

export class VtuberRig {
  constructor(data, images) {
    this.data = data;
    this.layers = data.layers
      .slice()
      .sort((a, b) => a.z - b.z)
      .map((l) => ({
        ...l,
        img: images[l.id],
        pivotX: l.x + l.pivot[0],
        pivotY: l.y + l.pivot[1],
      }));

    this.yaw = new Spring(0, 70, 0.80);
    this.pitch = new Spring(0, 70, 0.80);
    this.roll = new Spring(0, 80, 0.80);
    this.sway = new Spring(0, 26, 0.90);
    this.breath = 0;
    this.talk = 0;
    this.talkTarget = 0;
    this.time = 0;
    this.mirror = false;
  }

  /** @param {{x:number,y:number,active:boolean}} pointer normalised -1..1 */
  update(dt, { pointer, talk = 0, energy = 1, roll = 0, eyes = 1 }) {
    this.time += dt;
    const t = this.time;

    // Idle wander keeps the character alive even with no pointer input.
    const wanderX = Math.sin(t * 0.37) * 0.16 + Math.sin(t * 0.19 + 1.7) * 0.09;
    const wanderY = Math.sin(t * 0.29 + 0.6) * 0.12;

    const tx = clamp((pointer.x || 0) + wanderX, -1, 1);
    const ty = clamp((pointer.y || 0) + wanderY, -1, 1);

    this.yaw.set(tx * energy);
    this.pitch.set(ty * energy);
    this.roll.set(roll);
    this.sway.set(Math.sin(t * 0.53) * 0.55 + Math.sin(t * 0.23 + 2.1) * 0.35);

    this.yaw.update(dt);
    this.pitch.update(dt);
    this.roll.update(dt);
    this.sway.update(dt);

    this.breath = Math.sin(t * 1.15);
    this.talkTarget = talk;
    this.talk += (this.talkTarget - this.talk) * Math.min(1, dt * 14);

    this.eyesOpen = clamp(eyes, 0, 1);
    this.state = {
      yaw: this.yaw.value,
      pitch: this.pitch.value,
      roll: this.roll.value,
      sway: this.sway.value,
      breath: this.breath,
      talk: this.talk,
      eyes: this.eyesOpen,
    };
  }

  draw(ctx, view) {
    const s = this.state;
    ctx.save();
    ctx.translate(view.offsetX, view.offsetY);
    ctx.scale(view.scale, view.scale);
    if (this.mirror) {
      ctx.translate(this.data.source.width, 0);
      ctx.scale(-1, 1);
    }

    for (const L of this.layers) {
      if (!L.img) continue;
      const m = MOTION[L.id];
      const rot = m && m.rot ? m.rot(s) : 0;
      const dx = (m && m.dx ? m.dx(s) : 0) * (this.mirror ? -1 : 1);
      const dy = m && m.dy ? m.dy(s) : 0;
      const sy = m && m.scaleY ? m.scaleY(s) : 1;
      const sc = m && m.scale ? m.scale(s) : 1;

      ctx.save();
      ctx.translate(L.pivotX + dx, L.pivotY + dy);
      ctx.rotate(rot * DEG);
      ctx.scale(sc, sc * sy);
      ctx.translate(-L.pivotX, -L.pivotY);
      ctx.drawImage(L.img, L.x, L.y, L.w, L.h);
      // The goggle lenses live in the head card, so the blink overlay has to be
      // drawn inside the same transform or it will slide off the eyes.
      if (L.id === "head") this._drawMaskEyes(ctx, s);
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * Blink overlay. The artwork has dark glass lenses and no painted eyelids, so
   * this is an explicit approximation: a lid sweeps down over each lens and the
   * faint amber glint behind the glass switches off. With `eyesOpen === 1` the
   * glint is at its resting intensity, which is how the character looks with
   * the effect idle.
   */
  _drawMaskEyes(ctx, s) {
    const eyes = (this.data && this.data.eyes) || [];
    if (!eyes.length) return;
    const open = clamp(s.eyes, 0, 1);
    const pulse = 0.86 + 0.14 * Math.sin(this.time * 1.7);
    const glint = 0.15 * open * pulse;

    for (const e of eyes) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(e.cx, e.cy, e.rx, e.ry, 0, 0, Math.PI * 2);
      ctx.clip();

      if (glint > 0.002) {
        const g = ctx.createRadialGradient(e.cx, e.cy, e.rx * 0.08, e.cx, e.cy, e.rx * 0.98);
        g.addColorStop(0, `rgba(255, 184, 104, ${glint})`);
        g.addColorStop(0.5, `rgba(224, 112, 58, ${glint * 0.45})`);
        g.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(e.cx - e.rx, e.cy - e.ry, e.rx * 2, e.ry * 2);
      }

      const lid = 1 - open;
      if (lid > 0.01) {
        const top = e.cy - e.ry;
        const h = e.ry * 2 * lid;
        const lg = ctx.createLinearGradient(0, top, 0, top + h);
        lg.addColorStop(0, "rgba(7, 6, 5, 0.96)");
        lg.addColorStop(0.75, "rgba(10, 8, 6, 0.86)");
        lg.addColorStop(1, "rgba(12, 10, 8, 0.2)");
        ctx.fillStyle = lg;
        ctx.fillRect(e.cx - e.rx, top, e.rx * 2, h);
      }
      ctx.restore();
    }
  }
}
