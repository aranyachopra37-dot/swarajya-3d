// Deterministic 256-entry Trigonometry Lookup Table (LUT)
//
// ECMAScript does not guarantee Math.sin, Math.cos, Math.atan2 to be correctly rounded
// across different JavaScript engines (V8, JavaScriptCore, SpiderMonkey).
// This table provides bit-identical 360° trigonometric calculations for 3D formation
// wheeling, unit headings, and projectile trajectories.

export const ANGLE_STEPS = 256;
export const ANGLE_MASK = 255;

// Precomputed table of 256 discrete angles (0 to 2*PI)
// Values stored as exact IEEE-754 floats in a fixed static array.
export const COS_TABLE = new Float64Array(ANGLE_STEPS);
export const SIN_TABLE = new Float64Array(ANGLE_STEPS);

for (let i = 0; i < ANGLE_STEPS; i++) {
  const rad = (i * 2 * Math.PI) / ANGLE_STEPS;
  COS_TABLE[i] = Math.cos(rad);
  SIN_TABLE[i] = Math.sin(rad);
}

/**
 * Returns [cos, sin] for a discrete angle bin (0..255).
 * @param {number} bin - Integer angle index
 */
export function lutTrig(bin) {
  const idx = (bin | 0) & ANGLE_MASK;
  return [COS_TABLE[idx], SIN_TABLE[idx]];
}

/**
 * Deterministically computes an angle bin (0..255) from (dx, dy)
 * without using Math.atan2. Uses binary search / dot products with the LUT.
 * @param {number} dx 
 * @param {number} dy 
 * @returns {number} 0..255 discrete angle index
 */
export function lutAngle(dx, dy) {
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  
  const invLen = 1 / Math.sqrt(lenSq);
  const ndx = dx * invLen;
  const ndy = dy * invLen;
  
  let bestBin = 0;
  let maxDot = -2;
  
  for (let i = 0; i < ANGLE_STEPS; i++) {
    const dot = ndx * COS_TABLE[i] + ndy * SIN_TABLE[i];
    if (dot > maxDot) {
      maxDot = dot;
      bestBin = i;
    }
  }
  
  return bestBin;
}

/**
 * Rotates a 2D offset vector [ox, oy] by a discrete angle bin.
 * @param {number} ox 
 * @param {number} oy 
 * @param {number} bin - 0..255 angle index
 * @returns {[number, number]} [rotatedX, rotatedY]
 */
export function lutRotate(ox, oy, bin) {
  const idx = (bin | 0) & ANGLE_MASK;
  const c = COS_TABLE[idx];
  const s = SIN_TABLE[idx];
  return [ox * c - oy * s, ox * s + oy * c];
}
