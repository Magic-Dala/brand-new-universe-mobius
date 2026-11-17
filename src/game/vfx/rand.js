// Deterministic randomness for VFX: every effect gets a seed, never Math.random → its look is a pure function of
// (seed, elapsed time).
export function mulberry32(a) {
  a >>>= 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Integer hash (seed mixing). */
export function hashSeed(a, b = 0) {
  let h = (a | 0) ^ Math.imul(b | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
/** Small reusable RNG object with helpers (no allocation per call). */
export class Rng {
  constructor(seed = 1) { this.reset(seed); }
  reset(seed) { this.r = mulberry32(seed >>> 0 || 1); return this; }
  next() { return this.r(); }
  range(a, b) { return a + (b - a) * this.r(); }
  sym(a = 1) { return (this.r() * 2 - 1) * a; }
  /** Uniform unit vector into out (x, y, z setters). */
  dir(out) {
    const u = this.r() * 2 - 1, th = this.r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    return out.set(s * Math.cos(th), u, s * Math.sin(th));
  }
  /** Unit vector biased upward (hemisphere, bias 0 = flat … 1 = straight up). */
  hemi(out, bias = 0.4) {
    const u = bias + (1 - bias) * this.r(), th = this.r() * Math.PI * 2, s = Math.sqrt(Math.max(0, 1 - u * u));
    return out.set(s * Math.cos(th), u, s * Math.sin(th));
  }
}
