/**
 * Pure input mapping.
 *
 * Everything here is a plain function so the behaviour can be unit-tested in
 * node without a browser, a canvas or a camera.
 */

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const FACE_DEFAULTS = {
  /** Multiplier on top of the calibrated range. */
  sensitivity: 1,
  /** Degrees of head yaw that map to a full-deflection pose. */
  range: 30,
  /** Hard cap on the pose, 0..1. Keeps the rig inside what the artwork allows. */
  limit: 1,
  /** Degrees ignored around the neutral pose so a resting head does not jitter. */
  deadzone: 1.2,
};

/** Remove the deadzone while keeping the response continuous past it. */
function deadzone(v, dz) {
  if (!dz) return v;
  const a = Math.abs(v);
  if (a <= dz) return 0;
  return Math.sign(v) * (a - dz);
}

/**
 * Camera head pose (degrees, already neutral-calibrated) -> rig drivers.
 *
 * The sign of every axis is inverted because the camera sees a mirror image:
 * turning your head to your left must turn the character to *its* left, which
 * is screen-right for a viewer facing it.
 *
 * Values are always clamped to +/- limit, so the layer cards can never be
 * pushed past the range the illustration supports.
 */
export function faceToPose(pose, options = {}) {
  const { sensitivity, range, limit, deadzone: dz } = { ...FACE_DEFAULTS, ...options };
  const k = sensitivity / Math.max(1, range);
  const lim = clamp(limit, 0, 1);
  return {
    x: clamp(-deadzone(pose.yaw || 0, dz) * k, -lim, lim),
    // Pitch and roll travel less than yaw on a human head, so they are scaled
    // up to reach full deflection at a comfortable angle.
    y: clamp(-deadzone(pose.pitch || 0, dz) * k * 1.35, -lim, lim),
    roll: clamp(-deadzone(pose.roll || 0, dz) * k * 1.5, -lim, lim),
  };
}

/**
 * Cursor position over the stage (0..1 on each axis) -> rig drivers.
 * Slightly over-ranged so the corners of the stage reach the limit.
 */
export function pointerFromEvent(nx, ny) {
  return {
    x: (clamp(nx, 0, 1) - 0.5) * 2.4,
    y: (clamp(ny, 0, 1) - 0.5) * 1.8,
  };
}

/** Exponential smoothing factor for a given half-life in seconds. */
export function smoothingAlpha(halfLife, dt) {
  if (halfLife <= 0) return 1;
  return 1 - Math.pow(0.5, dt / halfLife);
}
