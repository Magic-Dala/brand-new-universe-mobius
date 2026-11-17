// Redrock Canyon / 赤岩峽谷 (v0.46 art upgrade) — layered, weathered sandstone cliffs with strata ledges and desert
// varnish, hoodoos on stacked support shafts, a natural arch spanning the corridor, river arches / hoodoos / overhang
// alcoves with cliff dwellings down by the turquoise river, rope suspension bridges, mesas and buttes all around.
//
// Asset split (see src/worlds/art/redrockArt.js): THIS file draws the code masses inside the route's collision tiers
// (irregular strata courses, dwellings, rope bridges, the river banks' far canyon backdrop) and PLACES instanced pieces
// through ctx.extras.add():
//   Tripo (user): rr_arch (landmark span + river arches + far arches), rr_hoodoo_a / rr_hoodoo_b (pillar crowns, river
//   banks, mesa tops), rr_alcove (river-level rock shelters with dwellings).
//   Blender (tools/blender/build_redrock_kit.py): support shafts, ledges, caprock, talus, boulders, anchor mounts, spires,
//   mesas.
// Gameplay is untouched: the route (route.js), colliders, anchors and coins are the pre-upgrade ones; everything new is
// visual and uses its own RNG streams (never ctx.rng after the original draws), so the legacy RNG sequence per structure
// is consumed exactly as before only in the legacy path. Rules: rock drawn in the swing space stays within ~0.5 m of a
// collider face; visual-only rock (river level, mid distance) sits ≥ 30 m below the flight path or beyond the corridor
// pull-back; wall faces stay flush (±0.25 m) around every anchor and the arch / hoodoos get mount knobs where the
// device would otherwise float.
// Frame: structure-local, +x = route right, −z = route forward; the corridor side of a structure is x · inward(s) > 0.
import { foliage } from '../../art/treeFoliage.js';
import { K, pick, rr, inward, faceX, railing, mulC } from './common.js';
import { RedrockDetail, REDROCK_DIMS as D, trs, yawTo } from '../art/redrockArt.js';
import { toWorld, frameAt, pathY } from '../route.js';
import { mulberry32 } from '../../data/box.js';

const ROCK = [0xb85a36, 0xc4683e, 0xa84e30, 0xcc7448, 0xb0583a];
const DARK = 0x7a3a28, SHRUB = [0x6a7a3a, 0x5a6a32, 0x7a8a44];
const ADOBE = 0xc89a72, WOOD = 0x6a4a30, ROPE = 0x8a7458;
const SAND = 29; // REDROCK shader kind: layered sandstone (shaders.js rrSand)
const kitOn = (ctx) => !!ctx.extras?.on; // instanced pieces available (assets ready or loading)
const artOn = (ctx) => !!ctx.extras && ctx.extras.quality !== 'off'; // the new code cliffs (no assets needed)
const tint = (r, a = 0.9, b = 1.06) => { const k = rr(r, a, b), g = rr(r, 0.97, 1.03); return (Math.round(255 * Math.min(1, k)) << 16) | (Math.round(255 * Math.min(1, k * g)) << 8) | Math.round(255 * Math.min(1, k * 0.97)); };
const own = (seed, salt) => mulberry32(((seed >>> 0) ^ salt) >>> 0 || 1);
/** Swing anchors of structure s (or all within rad of it) in the structure's local frame. */
function anchorsLocal(m, s, all = false, rad = 60) {
  const out = [], [sx, sz] = toWorld(m, s.u, s.v), yaw = -frameAt(m, s.u).a, c = Math.cos(yaw), n = Math.sin(yaw);
  for (const a of m.anchors) {
    if (!all && a.sid !== s.id) continue;
    const [ax, az] = toWorld(m, a.u, a.v), dx = ax - sx, dz = az - sz; if (dx * dx + dz * dz > rad * rad) continue;
    out.push({ x: dx * c - dz * n, y: a.y, z: dx * n + dz * c, side: a.side, id: a.id });
  }
  return out;
}
/** River centre-line offset / half width at route arc length s — identical to the REDROCK floor shader. */
export const riverOff = (s) => Math.sin(s * 0.009) * 5 + Math.sin(s * 0.027 + 1.1) * 2.5;
export const riverHalf = (s) => 8.5 + 2.5 * Math.sin(s * 0.013 + 0.4);
/** |v| of the corridor face of the inner wall covering u on `side` at height y (module frame), or null. */
function wallFace(m, side, u, y = 6) {
  let best = null;
  for (const s of m.structures) {
    if (s.role !== 'inner' || Math.sign(s.v) !== side) continue;
    const half = (s.uw ?? s.w) / 2; if (Math.abs(u - s.u) > half) continue;
    for (const t of s.tiers) if (y >= t.y0 && y <= t.y1) { const f = Math.abs(s.v) + side * t.dv - t.d / 2; if (best == null || f < best) best = f; }
  }
  return best;
}

// =============================================================================================== code cliffs
/**
 * One collision tier as irregular sandstone courses: each course's corridor face is a polyline (≈ 4.5 m segments) with
 * an undercut foot, a proud lip and a bevelled top — offsets −2.2..+0.45 m from the collider face (rounded ends), flush
 * (−0.15..+0.25) wherever an anchor sits; course boundaries never pass within 1.6 m of an anchor's height.
 */
function strataWall(b, s, t, r, base, anchors, { lite = false, yFrom = null } = {}) {
  const dir = inward(s), fx = faceX(s, t), bx = t.dv - dir * t.d / 2, z0 = -t.du - t.w / 2, w = t.w;
  const near = anchors.filter((a) => Math.abs(a.x - fx) < 3 && a.z > z0 - 2 && a.z < z0 + w + 2);
  // course boundaries
  const ys = [yFrom ?? t.y0]; let y = ys[0];
  while (y < t.y1 - 0.5) {
    let yn = y + rr(r, lite ? 9 : 5, lite ? 16 : 11); if (t.y1 - yn < 3) yn = t.y1;
    for (const a of near) if (Math.abs(a.y - yn) < 1.6 && yn < t.y1) yn = a.y + 1.7 < t.y1 - 1 ? a.y + 1.7 : Math.max(y + 2, a.y - 1.7);
    yn = Math.min(t.y1, yn); ys.push(yn); y = yn;
  }
  const K = Math.max(3, Math.ceil(w / (lite ? 8 : 4.5)));
  const zs = []; for (let i = 0; i <= K; i++) zs.push(z0 + (w * i) / K);
  for (let li = 0; li + 1 < ys.length; li++) {
    const y0 = ys[li], y1 = ys[li + 1], h = y1 - y0; if (h < 0.3) continue;
    const pale = r() < 0.16, col = pale ? mulC(0xd9a274, rr(r, 0.9, 1.05)) : mulC(base, rr(r, 0.86, 1.1)), vr = r();
    const push = rr(r, -0.9, 0.15), cut = rr(r, 0.45, 1.2), bev = rr(r, 0.35, 0.8);
    const o = [], flush = [];
    for (let i = 0; i <= K; i++) {
      const z = zs[i], fl = near.some((a) => Math.abs(a.z - z) < 3.4 && a.y > y0 - 1.5 && a.y < y1 + 1.5);
      let v = i === 0 || i === K ? -rr(r, 0.8, 2.2) : push + rr(r, -1.3, 0.45);
      if (fl) v = rr(r, -0.15, 0.25);
      o.push(Math.min(0.45, v)); flush.push(fl);
    }
    const X = (i, d) => fx + dir * (o[i] + d);
    const rows = [[y0, (i) => (flush[i] ? -0.2 : -cut)], [y0 + h * 0.2, () => 0], [y1 - h * 0.12, (i) => (flush[i] ? 0 : 0.18)], [y1, (i) => (flush[i] ? -0.15 : -bev)]];
    for (let k = 0; k < 3; k++) {
      const [ya, fa] = rows[k], [yb, fb] = rows[k + 1];
      for (let i = 0; i < K; i++) {
        b.quadN([X(i, fa(i)), ya, zs[i]], [X(i + 1, fa(i + 1)), ya, zs[i + 1]], [X(i + 1, fb(i + 1)), yb, zs[i + 1]], [X(i, fb(i)), yb, zs[i]], [dir, 0, 0], col, SAND, vr, [zs[i], ya, zs[i + 1] - zs[i], yb - ya]);
      }
    }
    // course top (a ledge where the next course is set back) + both ends
    for (let i = 0; i < K; i++) b.quadN([X(i, rows[3][1](i)), y1, zs[i]], [X(i + 1, rows[3][1](i + 1)), y1, zs[i + 1]], [bx, y1, zs[i + 1]], [bx, y1, zs[i]], [0, 1, 0], mulC(col, 1.06), SAND, vr);
    for (const [i, nz] of [[0, -1], [K, 1]]) b.quadN([X(i, 0), y0, zs[i]], [bx, y0, zs[i]], [bx, y1, zs[i]], [X(i, 0), y1, zs[i]], [0, 0, nz], mulC(col, 0.95), SAND, vr);
  }
  b.quadN([bx, ys[0], z0], [bx, ys[0], z0 + w], [bx, t.y1, z0 + w], [bx, t.y1, z0], [-dir, 0, 0], mulC(base, 0.9), SAND, r()); // back face
}
function shrubs(b, t, r, n) { for (let k = 0; k < n; k++) foliage(b, t.dv + rr(r, -t.d / 2, t.d / 2) * 0.8, t.y1 + 0.4, -t.du + rr(r, -t.w / 2, t.w / 2) * 0.8, rr(r, 0.8, 1.8), 0.6, { col: pick(r, SHRUB), var: r() }); }

// =============================================================================================== legacy (assets off / failed)
function strata(b, s, t, r, base) {
  let y = t.y0; const dir = inward(s);
  while (y < t.y1 - 0.5) {
    const h = Math.min(t.y1 - y, rr(r, 6, 15));
    const push = rr(r, -2.6, 0.7), dw = rr(r, -3, 0), taper = rr(r, -1.6, 1.2);
    const d = t.d + push, xc = t.dv + dir * push / 2;
    b.frustum(xc, y, -t.du, d, t.w + dw, h, d + taper, t.w + dw + taper * 0.5, { col: mulC(base, rr(r, 0.86, 1.1)), kind: K.ROCK, var: r(), top: { col: mulC(base, 1.15), kind: K.ROCK } });
    if (r() < 0.35) b.box(xc + dir * (d / 2 + 0.3), y + h - 0.6, -t.du + rr(r, -t.w / 3, t.w / 3), 0.6, 0.6, rr(r, 3, 8), { col: mulC(base, 1.1), kind: K.ROCK }); // ledge lip
    y += h;
  }
  for (let k = 0; k < 3; k++) b.frustum(t.dv + rr(r, -t.d * 0.25, t.d * 0.25), t.y1, -t.du + rr(r, -t.w * 0.3, t.w * 0.3), rr(r, 5, 10), rr(r, 5, 10), rr(r, 1.5, 4), rr(r, 2, 5), rr(r, 2, 5), { col: mulC(base, 1.05), kind: K.ROCK });
  for (let k = 0; k < 4; k++) foliage(b, t.dv + rr(r, -t.d / 2, t.d / 2), t.y1 + 0.4, -t.du + rr(r, -t.w / 2, t.w / 2), rr(r, 0.8, 1.8), 0.6, { col: pick(r, SHRUB), var: r() });
}
function dwelling(b, s, t, r, y) { // adobe rooms in an alcove on the corridor face
  const fx = faceX(s, t), dir = inward(s), z0 = -t.du + rr(r, -t.w / 4, t.w / 4), W = Math.min(14, t.w - 4);
  b.box(fx + dir * -1.2, y - 0.5, z0, 2.6, 7.5, W + 1.5, { col: 0x3a1a12, kind: K.PLAIN, faces: dir < 0 ? 'x' : 'X' }); // alcove shadow (recessed)
  for (let k = 0; k < 4; k++) {
    const zz = z0 + (k - 1.5) * (W / 4), h = rr(r, 2.6, 4.6), dd = rr(r, 1.6, 2.4);
    b.box(fx - dir * dd / 2 + dir * 0.5, y, zz, dd, h, W / 4 - 0.4, { col: mulC(ADOBE, rr(r, 0.9, 1.05)), kind: K.ADOBE, var: r() });
    b.box(fx + dir * 0.52, y + h * 0.4, zz, 0.06, 0.9, 0.7, { col: 0x1a0e08, kind: K.PLAIN, faces: dir < 0 ? 'x' : 'X' }); // window
    if (r() < 0.5) for (let q = 0; q < 4; q++) b.pipe([fx + dir * 0.6, y + h - 0.3, zz - 1 + q * 0.6], [fx + dir * 1.4, y + h - 0.5, zz - 1 + q * 0.6], 0.07, 4, { col: WOOD }); // vigas
  }
  b.box(fx + dir * 0.9, y - 0.3, z0, 1.6, 0.25, W, { col: WOOD, kind: K.WOOD }); // balcony
  for (let z = -W / 2; z <= W / 2; z += 1.4) b.box(fx + dir * 1.62, y - 0.05, z0 + z, 0.1, 1.0, 0.1, { col: WOOD });
  b.box(fx + dir * 1.62, y + 0.9, z0, 0.1, 0.1, W, { col: WOOD });
}
/** Cliff dwelling (art path): a warm, shaded recess with a rock overhang lip and a sill — the rooms keep the original
 * layout (adobe blocks, windows, vigas, balcony) but no flat black panel. Stays within the old protrusion (≤ 2.4 m). */
function dwellingArt(b, s, t, r, y, base) {
  const fx = faceX(s, t), dir = inward(s), z0 = -t.du + rr(r, -t.w / 4, t.w / 4), W = Math.min(14, t.w - 4);
  b.box(fx - dir * 0.9, y - 0.6, z0, 1.9, 7.2, W + 1.2, { col: 0x6a3424, kind: SAND, var: r(), faces: dir < 0 ? 'xzZ' : 'XzZ' }); // recess back (shaded rock)
  b.frustum(fx + dir * 0.35, y + 6.6, z0, 2.4, W + 3.6, 1.6, 1.5, W + 2.2, { col: mulC(base, 1.04), kind: SAND, var: r() }); // overhang lip
  b.frustum(fx + dir * 0.25, y - 1.6, z0, 2.0, W + 2.6, 1.1, 2.4, W + 3.2, { col: mulC(base, 0.96), kind: SAND, var: r() }); // sill ledge
  for (let k = 0; k < 4; k++) {
    const zz = z0 + (k - 1.5) * (W / 4), h = rr(r, 2.6, 4.6), dd = rr(r, 1.6, 2.4);
    b.box(fx - dir * dd / 2 + dir * 0.5, y - 0.5, zz, dd, h + 0.5, W / 4 - 0.4, { col: mulC(ADOBE, rr(r, 0.9, 1.05)), kind: K.ADOBE, var: r() });
    b.box(fx + dir * 0.52, y + h * 0.4, zz, 0.06, 0.9, 0.7, { col: 0x1a0e08, kind: K.PLAIN, faces: dir < 0 ? 'x' : 'X' }); // window
    if (r() < 0.5) for (let q = 0; q < 4; q++) b.pipe([fx + dir * 0.6, y + h - 0.3, zz - 1 + q * 0.6], [fx + dir * 1.4, y + h - 0.5, zz - 1 + q * 0.6], 0.07, 4, { col: WOOD });
  }
  b.box(fx + dir * 0.9, y - 0.3, z0, 1.6, 0.25, W, { col: WOOD, kind: K.WOOD }); // balcony
  for (let z = -W / 2; z <= W / 2; z += 1.4) b.box(fx + dir * 1.62, y - 0.05, z0 + z, 0.1, 1.0, 0.1, { col: WOOD });
  b.box(fx + dir * 1.62, y + 0.9, z0, 0.1, 0.1, W, { col: WOOD });
}
function ropeSpan(b, L, y, w, r, deckTh = 0.35) { // planks + two sagging hand ropes + hanger ropes
  const n = Math.round(L / 0.9);
  for (let i = 0; i < n; i++) { const x = -L / 2 + (i + 0.5) * (L / n); if (r() < 0.04) continue; b.box(x, y, 0, L / n - 0.12, deckTh, w, { col: mulC(WOOD, rr(r, 0.85, 1.15)), kind: K.WOOD }); }
  for (const z of [-w / 2, w / 2]) {
    const seg = 12; let prev = null;
    for (let i = 0; i <= seg; i++) { const x = -L / 2 + (L * i) / seg, sag = 1.2 * (1 - ((2 * i) / seg - 1) ** 2), p = [x, y + 1.3 - sag * 0.4, z]; if (prev) b.pipe(prev, p, 0.07, 4, { col: ROPE }); prev = p; if (i % 2 === 0 && i > 0 && i < seg) b.pipe([x, y + deckTh, z], p, 0.04, 3, { col: ROPE }); }
    b.pipe([-L / 2, y, z], [L / 2, y, z], 0.08, 4, { col: ROPE });
  }
}
export const legacy = {
  cliff(b, s, { rng: r }) {
    const base = pick(r, ROCK);
    for (const t of s.tiers) strata(b, s, t, r, base);
    const t = s.tiers[0];
    if (s.role === 'inner' && !s.isPlatform && r() < 0.32 && t.y1 > 30) dwelling(b, s, t, r, rr(r, Math.max(14, t.y1 * 0.35), t.y1 * 0.6));
    if (s.isPlatform) { const f = s.tiers[0]; b.box(f.dv, f.y1, -f.du, f.d, 0.3, f.w, { col: 0xc89a6a, kind: K.ROCK }); railing(b, s, f, { col: WOOD, kind: K.WOOD, post: 0.12, step: 1.8, h: 1.0 }); }
  },
  pillar(b, s, { rng: r }) { // hoodoo: stacked tapering drums + a cap rock
    const t = s.tiers[0], base = pick(r, ROCK); let y = 0, R = t.d / 2;
    while (y < t.y1 - 2) { const h = Math.min(t.y1 - 2 - y, rr(r, 4, 9)), r1 = R * rr(r, 0.82, 0.98); b.cyl(t.dv, y, 0, R, r1, h, 9, { col: mulC(base, rr(r, 0.85, 1.1)), kind: K.ROCK, var: r(), a0: r() }); R = Math.max(t.d * 0.32, r1 * rr(r, 0.95, 1.05)); y += h; }
    b.frustum(t.dv, t.y1 - 2, 0, t.d * 1.05, t.w * 1.05, 2, t.d * 0.8, t.w * 0.8, { col: mulC(base, 1.15), kind: K.ROCK });
    foliage(b, t.dv, t.y1 + 0.2, 0, 1.4, 0.6, { col: pick(r, SHRUB), kind: K.LEAF });
  },
  landmarkArch(b, s, { rng: r }) { // the natural arch of the concept (code)
    const R = s.d / 2 - 4, sy = s.y0 - R * 0.75;
    b.arch(0, sy, 0, R * 2, s.h - s.y0 + 2, s.w, 20, { col: 0xc06a40, kind: K.ROCK, rise: 0.75 });
    b.arch(0, sy - 1.5, 0, R * 2 + 3, 1.6, s.w * 0.7, 20, { col: 0xa85434, kind: K.ROCK, rise: 0.78 });
    for (let i = 0; i < 6; i++) foliage(b, rr(r, -R * 0.6, R * 0.6), s.h + 0.3, rr(r, -2, 2), rr(r, 1, 2), 0.6, { col: pick(r, SHRUB), kind: K.LEAF });
  },
  moduleDecor(b, ctx) { // talus slopes + boulders along the river
    const { m, rng: r, local, halfW } = ctx;
    for (let u = 0; u < m.L; u += rr(r, 6, 11)) for (const side of [-1, 1]) {
      const [x, z] = local(u, side * rr(r, halfW * 0.55, halfW + 2));
      b.blob(x, 0.5, z, rr(r, 2, 5), 0.55, { col: mulC(pick(r, ROCK), 0.85), kind: K.ROCK, var: r(), seed: u * side });
      if (r() < 0.3) foliage(b, x, 1, z, 1.2, 0.6, { col: pick(r, SHRUB), seed: u });
    }
  },
  backdrop(b, g, { rng: r }) { // mesas, buttes and far canyon walls in warm haze
    for (let i = 0; i < 80; i++) {
      const a = (i / 80) * Math.PI * 2 + rr(r, -0.03, 0.03), d = rr(r, 420, 900), x = Math.sin(a) * d, z = -Math.cos(a) * d;
      const h = rr(r, 40, 150), w = rr(r, 40, 140);
      b.pushTRS(x, 0, z, -a + rr(r, -0.4, 0.4));
      let y = 0, ww = w; while (y < h) { const hh = Math.min(h - y, rr(r, 10, 30)); b.box(0, y, 0, ww, hh, ww * rr(r, 0.5, 0.9), { col: mulC(pick(r, ROCK), rr(r, 0.85, 1.05)), kind: K.ROCK, var: r() }); y += hh; ww *= rr(r, 0.8, 1.0); }
      b.pop();
    }
    for (const sx of [-1, 1]) for (let k = 0; k < 10; k++) { const z = -120 - k * 90; b.box(sx * (90 + k * 8), 0, z, 60, rr(r, 90, 130), 92, { col: mulC(pick(r, ROCK), 0.95), kind: K.ROCK, var: r() }); }
    b.pushTRS(0, 0, -760); b.arch(0, 40, 0, 160, 26, 24, 16, { col: 0xb85a36, kind: K.ROCK, rise: 0.8 }); b.pop();
  },
};

// =============================================================================================== instanced pieces
/** Mount knob behind an anchor (local frame): the knob's face sits just behind the device, its body reaches `gap` m back
 * into the rock along −n (n = the anchor's facing in the local frame; [0, −1, 0] = an underside anchor). */
function mount(X, r, a, nx, ny, nz, gap) {
  const L = gap + 0.9, sc = rr(r, 0.95, 1.15);
  if (ny < -0.5) X.add('rk_mount', trs(a.x, a.y + 0.3, a.z, rr(r, 0, 6.28), sc, sc, L, Math.PI / 2), tint(r, 0.85, 1.0));
  else X.add('rk_mount', trs(a.x - nx * 0.3, a.y, a.z - nz * 0.3, yawTo(nx, nz), sc, sc, L), tint(r, 0.85, 1.0));
}
/** Hoodoo support shaft from y0 to y1, width d, centred (x, z): stacked Blender segments (height 1.5 d nominal). */
function shaft(X, r, x, z, d, y0, y1) {
  const H = y1 - y0; if (H <= 0.2) return;
  const n = Math.max(1, Math.round(H / (1.5 * d))), sy = H / (n * 1.5);
  for (let i = 0; i < n; i++) X.add(i % 2 ? 'rk_shaft_b' : 'rk_shaft_a', trs(x, y0 + i * 1.5 * sy, z, rr(r, 0, 6.28), d * rr(r, 0.98, 1.05), sy * 1.0, d * rr(r, 0.98, 1.05)), tint(r, 0.88, 1.05));
}

/** Route-space point (u, v) of module ctx.m keeps `min` m from the centre line of this module and its neighbours. */
function farClear(ctx, u, v, min) {
  const m = ctx.m, M = ctx.world?.route?.modules || [m], [x, z] = toWorld(m, u, v);
  for (let i = Math.max(0, m.idx - 2); i <= m.idx + 2 && i < M.length; i++) {
    const n = M[i]; for (let k = 0; k <= n.L; k += 4) { const [cx, cz] = toWorld(n, k, 0); if ((cx - x) ** 2 + (cz - z) ** 2 < min * min) return false; }
  }
  return true;
}

// =============================================================================================== the kit
export const redrock = {
  createExtras(wr) { return new RedrockDetail(wr); },
  animate(wr) { const o = wr.world.off; for (const m of [wr.mat, wr.backMat]) m.uniforms.uOff?.value.set(o[0], o[1]); }, // route-space noise
  cliff(b, s, ctx) {
    if (!artOn(ctx)) return legacy.cliff(b, s, ctx);
    const r = own(s.seed, 0x636c6966), X = ctx.extras, base = pick(r, ROCK), lite = s.role !== 'inner', dir = inward(s);
    const anchors = lite ? [] : anchorsLocal(ctx.m, s);
    const front = s.tiers[0];
    s.tiers.forEach((t, i) => strataWall(b, s, t, r, base, anchors, { lite, yFrom: s.isPlatform && i > 0 && t.y1 > front.y1 ? Math.max(t.y0, front.y1 - 1) : null }));
    const top = s.tiers.reduce((a, t) => (t.y1 > a.y1 ? t : a), s.tiers[0]);
    shrubs(b, top, r, lite ? 2 : 3);
    if (s.role === 'inner' && !s.isPlatform && r() < 0.32 && front.y1 > 30) {
      const y = rr(r, Math.max(14, front.y1 * 0.35), front.y1 * 0.6), fx = faceX(s, front);
      if (!anchors.some((a) => Math.abs(a.x - fx) < 3 && a.y > y - 3 && a.y < y + 9)) dwellingArt(b, s, front, r, y, base); // (never over a device)
    }
    if (s.isPlatform) { b.box(front.dv, front.y1, -front.du, front.d, 0.3, front.w, { col: 0xc89a6a, kind: SAND }); railing(b, s, front, { col: WOOD, kind: K.WOOD, post: 0.12, step: 1.8, h: 1.0 }); }
    if (!kitOn(ctx)) return;
    // caprock crown on the top (set back from the corridor edge; the strata courses carry the ledges)
    const ccount = lite ? 1 : 1 + (r() < 0.5 ? 1 : 0);
    for (let k = 0; k < ccount; k++) X.add('rk_cap', trs(top.dv - dir * top.d * rr(r, 0.1, 0.25), top.y1 - 0.5, -top.du + rr(r, -top.w / 4, top.w / 4), rr(r, 0, 6.28), Math.min(top.d, top.w) / 11 * rr(r, 0.8, 1.1), rr(r, 0.45, 0.85), Math.min(top.d, top.w) / 11 * rr(r, 0.8, 1.1)), tint(r));
  },
  structure(b, s, ctx) { redrock.cliff(b, s, ctx); },
  pillar(b, s, ctx) { // a hoodoo: Blender support shaft up to a proportionate Tripo crown (never one stretched needle)
    if (!kitOn(ctx)) return legacy.pillar(b, s, ctx);
    const r = own(s.seed, 0x686f6f64), X = ctx.extras, t = s.tiers[0], d = Math.min(t.d, t.w), top = t.y1, dir = inward(s), fx = faceX(s, t);
    const anchors = anchorsLocal(ctx.m, s);
    const SA = d / 0.86, capA = top - (1 - D.hoodoo_a.capY0) * SA;
    // B turns its stem (−x) to the corridor: anchors at any height then sit on rock; A only while every anchor is on its cap
    const useB = anchors.some((a) => a.y < capA + 0.6) || r() < 0.4;
    if (useB) {
      const S = d / 0.95, cx = t.dv + dir * (d / 2 - (-D.hoodoo_b.stemMinX) * S - 0.1);
      shaft(X, r, t.dv, 0, d, -1, top - S + 0.4);
      X.add('rr_hoodoo_b', trs(cx, top - S, 0, dir > 0 ? Math.PI : 0, S * rr(r, 0.98, 1.02), S, S), tint(r, 0.95, 1.04));
      // (the stem face is ≤ 0.1 S behind the collider face at every height: anchors there sit ≈ 0.5–1 m off the rock)
      for (const a of anchors) { const gap = Math.abs(a.x - fx) - 0.35 + 0.1 + d * 0.05; if (a.y > top - S && gap > 0.7) mount(X, r, a, dir, 0, 0, gap); }
    } else { // A only when every anchor is on its cap (cap edge ≈ 0.05 d behind the collider face)
      shaft(X, r, t.dv, 0, d, -1, top - SA + 0.4);
      X.add('rr_hoodoo_a', trs(t.dv, top - SA, 0, rr(r, 0, 6.28), SA, SA, SA), tint(r, 0.95, 1.04));
    }
  },
  bridgeHigh(b, s, { rng: r }) { ropeSpan(b, s.d, s.y0 + 0.2, s.w * 0.7, r, 0.3); for (const sx of [-1, 1]) for (const z of [-1, 1]) b.box(sx * (s.d / 2 - 2), s.y0 - 0.5, z * s.w * 0.35, 0.35, 2.6, 0.35, { col: WOOD, kind: K.WOOD }); },
  bridgeLow(b, s, ctx) { redrock.bridgeHigh(b, s, ctx); },
  obstacle(b, s, ctx) { // a fallen natural bridge chunk wedged between the walls
    const r = ctx.rng, k = artOn(ctx) ? SAND : K.ROCK;
    let y = s.y0; while (y < s.h) { const h = Math.min(s.h - y, rr(r, 2.5, 4)); b.box(0, y, 0, s.d, h, s.w + rr(r, -2, 0), { col: mulC(pick(r, ROCK), rr(r, 0.9, 1.1)), kind: k, var: r(), faces: 'xXzZtb' }); y += h; }
    b.box(0, s.y0 - 2.5, 0, s.d * 0.7, 2.5, s.w * 0.6, { col: DARK, kind: k, faces: 'xXzZb' });
  },
  startPlatform(b, s, ctx) { // a broad rock bridge with a wooden deck edge
    const r = ctx.rng, k = artOn(ctx) ? SAND : K.ROCK;
    let y = s.y0; while (y < s.h) { const h = Math.min(s.h - y, 2); b.box(0, y, 0, s.d, h, s.w, { col: mulC(0xc06a40, rr(r, 0.9, 1.1)), kind: k, faces: 'xXzZtb' }); y += h; }
    b.box(0, s.y0 - 3, 0, s.d * 0.8, 3, s.w * 0.7, { col: 0xa04e30, kind: k, faces: 'xXzZb' });
  },
  closure(b, s, { rng: r }) { strata(b, { ...s, side: 1 }, { dv: 0, du: 0, d: s.d, w: s.w, y0: 0, y1: s.h }, r, pick(r, ROCK)); },
  landmarkArch(b, s, ctx) { // the user's Tripo arch fitted to the span collider: crown underside on the under-anchors, legs behind the walls
    if (!kitOn(ctx)) return legacy.landmarkArch(b, s, ctx);
    const r = own(s.seed, 0x61726368), X = ctx.extras, m = ctx.m, A = D.arch;
    let S = 100;
    for (let it = 0; it < 3; it++) { // legs' inner edge ≥ every inner wall face (+1 m) within the legs' depth
      const reach = A.halfDepth * S * 0.62 + 2; let face = 0;
      for (const side of [-1, 1]) for (let du = -reach; du <= reach; du += 2) { for (let y = 0; y < s.y0; y += 8) { const f = wallFace(m, side, s.u + du, y); if (f != null) face = Math.max(face, f); } }
      S = Math.min(125, Math.max(100, (face + 1) / A.halfFeet));
    }
    const base = s.y0 - 0.2 - A.underSide * S, Sz = 0.62 * S;
    X.add('rr_arch', trs(-A.cx * S, base, 0, 0, S, S, Sz), tint(r, 0.96, 1.03));
    for (const a of anchorsLocal(m, s)) { // under-anchors: a knob up into the crown for every device (sized to the highest
      // underside, the crown centre: where the rock comes lower the knob only reaches deeper into it)
      const gap = base + A.under * S - a.y - 0.35; mount(X, r, a, 0, -1, 0, Math.max(0.6, gap));
    }
  },
  moduleDecor(b, ctx) {
    if (!artOn(ctx)) return legacy.moduleDecor(b, ctx);
    if (!kitOn(ctx)) return legacy.moduleDecor(b, ctx);
    const { m, local, halfW } = ctx, X = ctx.extras, r = own(m.seed, 0x52524b31);
    const at = (u, v, y, yaw, sx, sy = sx, sz = sx) => { const [x, z] = local(u, v), a = frameAt(m, u).a; return trs(x, y, z, -a + yaw, sx, sy, sz); };
    const pillars = m.structures.filter((s) => s.role === 'pillar').map((s) => s.u);
    const busy = []; const free = (u, half) => u - half > -4 && u + half < m.L + 4 && !busy.some(([a, bb]) => u + half > a && u - half < bb);
    const nearPillar = (u, d) => pillars.some((p) => Math.abs(p - u) < d);
    const face = (side, u) => wallFace(m, side, u) ?? halfW + 2;
    const lowPath = Math.min(pathY(m, 0), pathY(m, m.L / 2), pathY(m, m.L));
    // 1. a Tripo arch over the river (≥ 30 m below the flight path); module 0 always: the first view from the start platform
    if ((m.idx === 0 || (m.idx % 3 === 1 && m.type !== 'landmark' && m.type !== 'branch')) && lowPath > 60) {
      const S = rr(r, 62, 72), u = m.idx === 0 ? 62 : [0.35, 0.5, 0.65].map((f) => f * m.L).find((uu) => !nearPillar(uu, 26) && free(uu, 20));
      if (u != null && S * D.arch.top + 1 < lowPath - 30) {
        X.add('rr_arch', at(u, -D.arch.cx * S, -1.5, 0, S, S, S * 0.7), tint(r, 0.95, 1.04)); busy.push([u - 22, u + 22]);
      }
    }
    // 2. an overhang alcove with cliff dwellings at the foot of an inner wall (its cavity wholly in front of the wall face)
    if (m.idx === 1 || (m.idx % 2 === 0 && m.idx > 0 && r() < 0.8)) {
      const walls = m.structures.filter((s) => s.role === 'inner' && !s.isPlatform && (s.uw ?? s.w) > 18 && s.u > 10 && s.u < m.L - 10 && !nearPillar(s.u, 24));
      const s = walls.length ? walls[Math.floor(r() * walls.length)] : null;
      if (s && free(s.u, 14)) {
        const side = Math.sign(s.v), S = Math.min(22, Math.max(16, (s.uw ?? s.w) * 0.8)), f = face(side, s.u), v = side * (f + D.alcove.backZ * S);
        const [x, z] = local(s.u, v), yaw = -frameAt(m, s.u).a + yawTo(-side, 0);
        X.add('rr_alcove', trs(x, -0.8, z, yaw, S, S, S), tint(r, 0.95, 1.04)); busy.push([s.u - S / 2 - 4, s.u + S / 2 + 4]);
        // dwellings on the cavity floor against the back wall (code geometry in the alcove frame)
        b.pushTRS(x, -0.8, z, yaw);
        const fy = D.alcove.floorY * S, roomH = (D.alcove.roofY - D.alcove.floorY) * S;
        for (let k = 0; k < 4; k++) {
          const lx = (k - 1.5) * S * 0.12 + rr(r, -0.5, 0.5), h = Math.min(roomH * 0.75, rr(r, 2.6, 4.4)), dd = rr(r, 2.4, 3.6), lz = (D.alcove.backZ + 0.07) * S + dd / 2;
          b.box(lx, fy, lz, S * 0.11, h, dd, { col: mulC(ADOBE, rr(r, 0.88, 1.04)), kind: K.ADOBE, var: r(), top: { col: mulC(ADOBE, 0.8), kind: K.ADOBE } });
          b.box(lx + rr(r, -0.6, 0.6), fy + h * 0.35, lz + dd / 2 + 0.03, 0.8, 1.1, 0.06, { col: 0x1a0e08, kind: K.PLAIN, faces: 'Z' });
          if (r() < 0.6) for (let q = 0; q < 3; q++) b.pipe([lx - 0.8 + q * 0.8, fy + h - 0.3, lz + dd / 2 - 0.2], [lx - 0.8 + q * 0.8, fy + h - 0.45, lz + dd / 2 + 0.7], 0.07, 4, { col: WOOD });
        }
        b.box(0, fy, (D.alcove.backZ + 0.07) * S + 4.2, S * 0.45, 0.25, 1.4, { col: WOOD, kind: K.WOOD }); // a timber walkway in front of the rooms
        b.pop();
      }
    }
    // 3. hoodoos on the river banks (visual only, far below the flight path), backs against the walls
    const nh = m.idx === 0 ? 2 : (r() < 0.6 ? 1 : 0) + (r() < 0.35 ? 1 : 0);
    for (let k = 0; k < nh; k++) {
      const side = m.idx === 0 ? (k ? 1 : -1) : r() < 0.5 ? -1 : 1, H = rr(r, 15, 24), u = m.idx === 0 ? 36 + k * 16 : rr(r, 10, m.L - 10);
      if (nearPillar(u, 14 + H * 0.4) || !free(u, H * 0.45) || H + 6 > lowPath - 25) continue;
      const A = r() < 0.5, f = face(side, u), v = side * (f - (A ? 0.25 : 0.3) * H);
      X.add(A ? 'rr_hoodoo_a' : 'rr_hoodoo_b', at(u, v, -0.6, A ? rr(r, 0, 6.28) : (side > 0 ? 0 : Math.PI) + rr(r, -0.3, 0.3), H), tint(r, 0.94, 1.05));
      X.add('rk_talus', at(u + rr(r, -3, 3), v - side * H * 0.25, -0.3, yawTo(-side, 0), rr(r, 0.8, 1.1), rr(r, 0.6, 0.9)), tint(r)); busy.push([u - H * 0.45, u + H * 0.45]);
    }
    // 4. talus at the wall feet + boulders along the river edge
    for (const side of [-1, 1]) for (let u = rr(r, 2, 9); u < m.L; u += rr(r, 11, 19)) {
      if (nearPillar(u, 6)) continue;
      X.add('rk_talus', at(u, side * (face(side, u) - rr(r, 1.5, 3.5)), -0.2, yawTo(-side, 0) + rr(r, -0.4, 0.4), rr(r, 0.8, 1.35), rr(r, 0.7, 1.2), rr(r, 0.8, 1.2)), tint(r, 0.85, 1.02));
    }
    for (let u = rr(r, 3, 10); u < m.L; u += rr(r, 9, 16)) {
      const s = m.s0 + u, sd = r() < 0.5 ? -1 : 1, v = riverOff(s) + sd * (riverHalf(s) + rr(r, -1.5, 1.5));
      X.add('rk_boulder', at(u, v, -0.4, r() * 6.28, rr(r, 0.9, 2.2), rr(r, 0.7, 1.3), rr(r, 0.9, 2.0)), tint(r, 0.85, 1.05));
    }
    // 5. the middle distance (|v| 90–260 m, never reachable: the pull-back starts at halfW + 34): mesas, spires, far
    //    Tripo hoodoos on mesa tops, and every few modules a far arch on a long mesa
    for (const side of [-1, 1]) for (let u = rr(r, 0, 30); u < m.L; u += rr(r, 50, 80)) {
      const kind = r(), out = (half) => side * (halfW + 41 + half + rr(r, 0, 140)); // inner edge of the piece ≥ halfW + 41 m (beyond the pull-back)
      const clear = (v, half) => farClear(ctx, u, v, halfW + 41 + half); // (the inside of a turn brings the centre line closer: skip there)
      if (kind < 0.5) {
        const w = rr(r, 45, 90), h = rr(r, 160, 300), v = out(0.7 * w); if (!clear(v, 0.7 * w)) continue;
        X.add('rk_mesa', at(u, v, -2, r() * 6.28, w, h, w * rr(r, 0.7, 1.0)), tint(r, 0.88, 1.04), 'far');
        if (r() < 0.45) { const S = rr(r, 26, 44); X.add(r() < 0.5 ? 'rr_hoodoo_a' : 'rr_hoodoo_b', at(u, v, h * 0.5 - 3, r() * 6.28, S), tint(r, 0.92, 1.03), 'far'); }
      } else if (kind < 0.82 || m.idx % 4 !== 2) {
        const sc = rr(r, 18, 32), v = out(0.62 * sc); if (!clear(v, 0.62 * sc)) continue;
        X.add('rk_spire', at(u, v, -2, r() * 6.28, sc, rr(r, 22, 36), sc), tint(r, 0.88, 1.04), 'far');
      } else {
        const S = rr(r, 150, 210), base = rr(r, 20, 45), v = out(0.4 * S); if (!clear(v, 0.5 * S)) continue; // (the arch stands on a long mesa, its opening toward the route)
        X.add('rk_mesa', at(u, v, -2, yawTo(-side, 0), S * 0.95, (base + 2) / 0.51, S * 0.38), tint(r, 0.88, 1.0), 'far');
        X.add('rr_arch', at(u, v, base, yawTo(-side, 0), S, S, S * 0.5), tint(r, 0.92, 1.03), 'far');
      }
    }
  },
  backdrop(b, g, ctx) { redrockBackdrop(b, g, ctx); },
};

/** The far canyon (follows the camera, faces the route's main heading): three rings of layered mesas, buttes and spires
 * (irregular drums with strata colours, talus skirts) all around — front, rear and both sides — and two far arches. */
function redrockBackdrop(b, g, { rng: r }) {
  const tiers = (x, z, w, h, a0, seg, pale) => {
    b.cyl(x, -4, z, w * 0.62, w * 0.5, Math.min(h * 0.18, 30), seg, { col: mulC(0x9a5a40, rr(r, 0.9, 1.05)), kind: SAND, var: r(), a0, caps: '' }); // talus skirt
    let y = Math.min(h * 0.16, 26), R = w * 0.5, k = 0;
    while (y < h) {
      const hh = Math.min(h - y, rr(r, h * 0.12, h * 0.3)), R1 = R * rr(r, 0.9, 1.0);
      const col = (k % 3 === 1 && pale) ? mulC(0xd8a274, rr(r, 0.92, 1.04)) : mulC(pick(r, ROCK), rr(r, 0.86, 1.06));
      b.cyl(x, y, z, R, R1, hh, seg, { col, kind: SAND, var: r(), a0: a0 + k * 0.4, caps: y + hh >= h ? 't' : '' });
      if (y + hh < h && r() < 0.6) { b.cyl(x, y + hh - 0.1, z, R1 * 1.04, R1 * 0.96, Math.min(4, hh * 0.25), seg, { col: mulC(col, 1.08), kind: SAND, var: r(), a0, caps: 't' }); }
      y += hh; R = R1 * rr(r, 0.8, 0.97); k++;
    }
  };
  for (const [d0, d1, n, hs] of [[340, 460, 34, [50, 130]], [520, 720, 30, [70, 170]], [780, 980, 26, [90, 210]]]) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rr(r, -0.06, 0.06), d = rr(r, d0, d1), x = Math.sin(a) * d, z = -Math.cos(a) * d;
      const spire = r() < 0.22, w = spire ? rr(r, 14, 30) : rr(r, 50, 140), h = spire ? rr(r, hs[0] * 1.1, hs[1] * 1.1) : rr(r, hs[0], hs[1]);
      tiers(x, z, w, h, r() * 6, spire ? 7 : 9, !spire);
      if (spire) b.cyl(x, h - 0.5, z, w * 0.62, w * 0.55, rr(r, 4, 8), 7, { col: 0x8a4a32, kind: SAND, var: r(), caps: 't' }); // caprock
    }
  }
  for (const [x, z, s] of [[-180, -820, 1], [260, 700, 0.8]]) { b.pushTRS(x, 0, z, Math.atan2(-x, z)); b.arch(0, 50 * s, 0, 150 * s, 24 * s, 26 * s, 14, { col: 0xb85a36, kind: SAND, rise: 0.75 }); for (const sx of [-1, 1]) b.cyl(sx * 88 * s, -4, 0, 22 * s, 18 * s, 54 * s, 8, { col: 0xa85434, kind: SAND, var: 0.3 }); b.pop(); }
}
export { pathY };
