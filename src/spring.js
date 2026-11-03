/** Critically-damped spring, used for every driver so motion has weight. */
export class Spring {
  constructor(value = 0, stiffness = 90, damping = 0.82) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.stiffness = stiffness;
    this.damping = damping;
  }

  update(dt) {
    // Clamp dt so a background tab doesn't explode the simulation.
    const step = Math.max(0, Math.min(dt, 1 / 20));
    const force = (this.target - this.value) * this.stiffness;
    this.velocity = (this.velocity + force * step) * Math.pow(this.damping, step * 60);
    this.value += this.velocity * step;
    return this.value;
  }

  set(target) {
    this.target = target;
  }
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
