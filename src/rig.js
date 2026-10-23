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
    rot: (s) => s.yaw * 0.9 + s.breath * 0.30,
    dx: (s) => s.yaw * 5,
    dy: (s) => -s.breath * 2 + s.talk * 1.2,
    scale: (s) => 1 + s.breath * 0.004,
  },
  cape: {
    rot: (s) => s.yaw * 0.55 + s.sway * 0.8,
    dx: (s) => -s.yaw * 7,
    dy: (s) => s.breath * 1.2,
  },
  arm_left: {
    rot: (s) => s.yaw * 1.7 + s.breath * 0.55,
    dx: (s) => s.yaw * 3,
  },
  cane: {
    rot: (s) => s.yaw * 1.3 + s.breath * 0.3,
  },
  arm_right: {
    rot: (s) => s.yaw * 1.5 - s.breath * 0.45,
    dx: (s) => s.yaw * 2,
    dy: (s) => -s.breath * 1.5,
  },
  head: {
    rot: (s) => s.yaw * 5.5 + s.talk * 1.4,
    dx: (s) => s.yaw * 9,
    dy: (s) => -s.breath * 1.6 - s.talk * 5,
    scaleY: (s) => 1 + s.talk * 0.012,
  },
  hat: {
    rot: (s) => s.hatYaw * 6.4 + s.talk * 0.9,
    dx: (s) => s.hatYaw * 11,
    dy: (s) => -s.breath * 1.2 - s.talk * 2.4,
  },
};

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
    this.slowYaw = new Spring(0, 34, 0.86);
    this.sway = new Spring(0, 26, 0.90);
    this.breath = 0;
    this.talk = 0;
    this.talkTarget = 0;
    this.time = 0;
    this.mirror = false;
  }

  /** @param {{x:number,y:number,active:boolean}} pointer normalised -1..1 */
  update(dt, { pointer, talk = 0, energy = 1 }) {
    this.time += dt;
    const t = this.time;

    // Idle wander keeps the character alive even with no pointer input.
    const wanderX = Math.sin(t * 0.37) * 0.16 + Math.sin(t * 0.19 + 1.7) * 0.09;
    const wanderY = Math.sin(t * 0.29 + 0.6) * 0.12;

    const tx = clamp((pointer.x || 0) + wanderX, -1, 1);
    const ty = clamp((pointer.y || 0) + wanderY, -1, 1);

    this.yaw.set(tx * energy);
    this.pitch.set(ty * energy);
    this.slowYaw.set(tx * energy);
    this.sway.set(Math.sin(t * 0.53) * 0.55 + Math.sin(t * 0.23 + 2.1) * 0.35);

    this.yaw.update(dt);
    this.pitch.update(dt);
    this.slowYaw.update(dt);
    this.sway.update(dt);

    this.breath = Math.sin(t * 1.15);
    this.talkTarget = talk;
    this.talk += (this.talkTarget - this.talk) * Math.min(1, dt * 14);

    this.state = {
      yaw: this.yaw.value,
      pitch: this.pitch.value,
      hatYaw: this.slowYaw.value,
      sway: this.sway.value,
      breath: this.breath,
      talk: this.talk,
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
      ctx.restore();
    }
    ctx.restore();
  }
}
