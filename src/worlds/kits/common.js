// Shared kit helpers (v0.40). Structure-local frame: origin = structure centre on the ground, +x = route right,
// −z = route forward, y up. A tier t sits at x = t.dv, z = −t.du with size t.d (x) × t.w (z), y t.y0..t.y1.
// The corridor-facing side of a structure is x · (−side) > 0 ("inward").
import { K } from '../art/builder.js';
export { K };

export const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];
export const rr = (r, a, b) => a + (b - a) * r();
export const inward = (s) => -(s.side || 1);
/** x of the corridor face of tier t. */
export const faceX = (s, t) => t.dv + inward(s) * t.d / 2;
/** Face letter of the corridor-facing side ('x' = −x, 'X' = +x). */
export const faceKey = (s) => (inward(s) < 0 ? 'x' : 'X');

/** Draw every collision tier as a box (o(t, i) → box options). */
export function drawTiers(b, s, o) { s.tiers.forEach((t, i) => b.box(t.dv, t.y0, -t.du, t.d, t.y1 - t.y0, t.w, o(t, i))); }
/** A cornice / band slightly larger than the tier, at height y. */
export function band(b, t, y, h, over, col, kind = K.PLAIN, faces = 'xXzZt') { b.box(t.dv, y, -t.du, t.d + over * 2, h, t.w + over * 2, { col, kind, faces }); }
/** Railing along the corridor edge of a platform tier (posts + top rail). */
export function railing(b, s, t, { col = 0x2a2a2e, kind = K.METAL, h = 1.1, step = 1.6, post = 0.08 } = {}) {
  const x = faceX(s, t) - inward(s) * 0.15, y = t.y1, L = t.w;
  for (let z = -L / 2 + 0.3; z <= L / 2 - 0.3; z += step) b.box(x, y, -t.du + z, post, h, post, { col, kind });
  b.box(x, y + h - 0.06, -t.du, post * 1.6, 0.08, L - 0.4, { col, kind });
  b.box(x, y + h * 0.5, -t.du, post, 0.05, L - 0.4, { col, kind });
}
/** Span structure (bridge / gate / obstacle) helpers: lateral extent d, along w, at y0..h. */
export function spanBox(b, s, o = {}) { b.box(0, s.y0, 0, s.d, s.h - s.y0, s.w, o); }
/** Small hanging lantern (glow) at local position. */
export function lantern(b, g, x, y, z, { col = 0xffa040, r = 0.32, body = 0x3a1a10 } = {}) {
  b.cyl(x, y + r * 0.9, z, 0.05, 0.05, 0.6, 4, { col: body, kind: K.PLAIN, caps: '' });
  b.cyl(x, y - r, z, r * 0.9, r * 0.9, r * 1.9, 8, { col, kind: K.EMIS });
  g.blob(x, y, z, r * 3.2, 1, { col: mulC(col, 0.55), kind: 3, jitter: 0 });
}
export function mulC(hex, k) { const r = ((hex >> 16) & 255) * k, g = ((hex >> 8) & 255) * k, bl = (hex & 255) * k; return (Math.min(255, r) << 16) | (Math.min(255, g) << 8) | Math.min(255, bl); }
/** Generic bridge deck (fallback for kits without their own). */
export function genericSpan(b, s, col = 0x5a5a60) { spanBox(b, s, { col, kind: K.STONE, faces: 'xXzZtb' }); }
