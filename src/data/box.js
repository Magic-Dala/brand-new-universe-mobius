// Oriented-box (xz) helpers + seeded RNG shared by the city data, physics and rendering. Pure JS.
// A box has centre (x, z), yaw, cos / sin of the yaw, half extents hw (box-X) and hd (box-Z) and a
// vertical range y0..y1. box-X = (cos, −sin) in world xz, box-Z = (sin, cos) — the same convention as
// three.js' rotationY(yaw) applied to +X / +Z.

export function boxToWorld(b, bx, y, bz, out = [0, 0, 0]) {
  out[0] = b.x + bx * b.cos + bz * b.sin; out[1] = y; out[2] = b.z - bx * b.sin + bz * b.cos;
  return out;
}
export function worldToBox(b, x, z) {
  const dx = x - b.x, dz = z - b.z;
  return [dx * b.cos - dz * b.sin, dx * b.sin + dz * b.cos];
}
/** Footprint test (xz) with optional pad (negative = inset). */
export function inFootprint(b, x, z, pad = 0) {
  const [bx, bz] = worldToBox(b, x, z);
  return Math.abs(bx) <= b.hw + pad && Math.abs(bz) <= b.hd + pad;
}
/** Distance from a point to the box surface (0 inside). */
export function distToBox(b, x, y, z) {
  const [bx, bz] = worldToBox(b, x, z);
  const ex = Math.max(0, Math.abs(bx) - b.hw), ez = Math.max(0, Math.abs(bz) - b.hd);
  const ey = y < b.y0 ? b.y0 - y : y > b.y1 ? y - b.y1 : 0;
  return Math.hypot(ex, ey, ez);
}
/** Segment a→b vs box: entry parameter t in [0, tEnd] or −1. Boxes containing a are skipped by callers. */
export function segBoxT(c, ax, ay, az, bx, by, bz, tEnd = 1) {
  const [px, pz] = worldToBox(c, ax, az), [qx, qz] = worldToBox(c, bx, bz);
  let t0 = 0, t1 = tEnd;
  const slab = (p, q, lo, hi) => {
    const dd = q - p;
    if (Math.abs(dd) < 1e-9) return p >= lo && p <= hi;
    let ta = (lo - p) / dd, tb = (hi - p) / dd; if (ta > tb) { const tt = ta; ta = tb; tb = tt; }
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; return t0 <= t1;
  };
  if (!slab(px, qx, -c.hw, c.hw) || !slab(ay, by, c.y0, c.y1) || !slab(pz, qz, -c.hd, c.hd)) return -1;
  return t0;
}
export function insideBox(c, x, y, z, pad = 0) {
  if (y < c.y0 - pad || y > c.y1 + pad) return false;
  const [bx, bz] = worldToBox(c, x, z);
  return Math.abs(bx) <= c.hw + pad && Math.abs(bz) <= c.hd + pad;
}

// ---------------------------------------------------------------- rng
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash2(a, b) {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const hashInt = (a, b) => Math.floor(hash2(a, b) * 4294967296) | 0;
