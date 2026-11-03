/**
 * Eyelid timing for the mask.
 *
 * The lenses in the illustration are opaque dark glass: there is no eyelid
 * painted on the artwork, so a blink cannot be a real deformation. What reads
 * as "something alive under the mask" is a quick lid sweep across the glass
 * plus the faint amber glint behind it switching off and on again.
 *
 * This class is pure timing: `update(dt)` returns openness 1..0..1. It can run
 * on its own (idle blinking) or be fired by the webcam when the performer
 * blinks, which is much more convincing on a live stream.
 */

const smooth = (t) => t * t * (3 - 2 * t);

export class Blink {
  constructor({ rng = Math.random, minDelay = 2.6, maxDelay = 7.2 } = {}) {
    this.rng = rng;
    this.minDelay = minDelay;
    this.maxDelay = maxDelay;
    this.enabled = true;
    this.openness = 1;
    this.phase = "idle"; // idle | closing | hold | opening
    this.t = 0;
    this.nextIn = this._delay();
    this.closeTime = 0.075;
    this.holdTime = 0.05;
    this.openTime = 0.16;
    this.queued = 0;
  }

  _delay() {
    const { minDelay, maxDelay, rng } = this;
    return minDelay + rng() * (maxDelay - minDelay);
  }

  /** Fire a blink now (webcam blink, or the B key). Safe to spam. */
  trigger() {
    if (!this.enabled) return;
    if (this.phase === "idle") {
      this.phase = "closing";
      this.t = 0;
      this.queued = 0;
    } else if ((this.phase === "opening" || this.phase === "hold") && this.queued < 2) {
      // A double blink should read as a double blink, not be swallowed.
      this.queued += 1;
    }
  }

  update(dt) {
    if (!this.enabled) {
      this.openness = 1;
      this.phase = "idle";
      return 1;
    }
    const step = Math.max(0, Math.min(dt, 0.1));

    if (this.phase === "idle") {
      this.nextIn -= step;
      if (this.nextIn <= 0) {
        this.phase = "closing";
        this.t = 0;
      }
      this.openness = 1;
      return this.openness;
    }

    this.t += step;
    if (this.phase === "closing") {
      const p = Math.min(1, this.t / this.closeTime);
      this.openness = 1 - smooth(p);
      if (p >= 1) {
        this.phase = "hold";
        this.t = 0;
      }
    } else if (this.phase === "hold") {
      this.openness = 0;
      if (this.t >= this.holdTime) {
        this.phase = "opening";
        this.t = 0;
      }
    } else if (this.phase === "opening") {
      const p = Math.min(1, this.t / this.openTime);
      this.openness = smooth(p);
      if (p >= 1) {
        this.openness = 1;
        this.t = 0;
        if (this.queued > 0) {
          this.queued -= 1;
          this.phase = "closing";
        } else {
          this.phase = "idle";
          this.nextIn = this._delay();
        }
      }
    }
    return this.openness;
  }
}
