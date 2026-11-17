// Molten Fortress / 熔火堡壘 — an industrial volcanic canyon: jagged graphite basalt wrapped in riveted steel buttresses,
// tall glowing vent ports and furnace drums, oxidized pipe elbows with flange clamps, open steel lattice bridges, a lava
// channel far below (emissive flowing floor, no simulation), lava falls on the outer walls, and the great foundry rising
// toward a smoking volcano crater ahead. Orange heat against charcoal metal; cyan anchors stay distinct (dark mounts).
// Blender parts (tools/blender/build_molten_kit.py) are appended into the existing GeoBuilder batches near flight height.
import * as THREE from 'three';
import { K, pick, rr, inward, faceX, drawTiers, band, railing } from './common.js';
import { GeoBuilder } from '../art/builder.js';
import { MOLTEN_PARTS, MOLTEN_SLOTS } from '../art/moltenKit.js';
import { toWorld, frameAt, pathY } from '../route.js';
import { audio } from '../../core/audio.js';

const IRON = [0x3d3b47, 0x33333d, 0x44404a], BASALT = [0x2b2933, 0x333038, 0x272530], RUST = 0x6a3a26, GLOW = 0xff7a20;

const SLOT = { basalt: { col: 0x2c2828, kind: K.ROCK }, steel: { col: 0x403a3c, kind: K.METAL }, rust: { col: 0x6a3a26, kind: K.METAL }, glow: { col: GLOW, kind: K.EMIS } };
const SLOT_LOOK = MOLTEN_SLOTS.map((n) => ({ ...SLOT[n], col: new THREE.Color(SLOT[n].col) }));
const _c = [new THREE.Color(), new THREE.Color()];
/** Append Blender part `name` at (x, y, z) (yaw / scale); o = { basalt, glow (hex), v: variation }. */
function part(b, name, x, y, z, yaw = 0, sx = 1, sy = 1, sz = 1, o = {}) {
  const P = MOLTEN_PARTS[name], base = b.vcount, n = P.s.length;
  if (o.basalt != null) _c[0].set(o.basalt);
  if (o.glow != null) _c[1].set(o.glow);
  b.pushTRS(x, y, z, yaw, sx, sy, sz);
  for (let i = 0; i < n; i++) {
    const sl = P.s[i], L = SLOT_LOOK[sl];
    const col = sl === 0 && o.basalt != null ? _c[0] : sl === 3 && o.glow != null ? _c[1] : L.col;
    const px = P.p[i * 3] / 1000, py = P.p[i * 3 + 1] / 1000, pz = P.p[i * 3 + 2] / 1000;
    b._vert(px, py, pz, P.n[i * 3] / 127, P.n[i * 3 + 1] / 127, P.n[i * 3 + 2] / 127, col, px * sx + pz * sz, py * sy, L.kind, o.v ?? 0);
  }
  for (let i = 0; i < P.i.length; i += 3) b.I.push3(base + P.i[i], base + P.i[i + 1], base + P.i[i + 2]);
  b.pop();
}
const yawTo = (dx, dz) => Math.atan2(dx, dz); // turns a part's +z (out of its wall) toward (dx, dz)

/** Swing anchors on structure s in its local frame (x across the route, z along it, y up). */
function anchorsOn(m, s) {
  if (!m?.anchors || s.u == null) return [];
  const out = [], [sx, sz] = toWorld(m, s.u, s.v), yaw = -frameAt(m, s.u).a, c = Math.cos(yaw), n = Math.sin(yaw);
  for (const a of m.anchors) {
    if (a.sid !== s.id) continue;
    const [ax, az] = toWorld(m, a.u, a.v), dx = ax - sx, dz = az - sz;
    out.push({ x: dx * c - dz * n, y: a.y, z: dx * n + dz * c });
  }
  return out;
}
/** True when no device on the face sits within z ± half, y - down .. y + up (a device is ~1.9 m in radius). */
const clearAt = (face, z, y, down, up, half = 2.4) => !face.some((a) => Math.abs(a.z - z) < half && a.y > y - down - 1.9 && a.y < y + up + 1.9);

/** Corridor-facing structural backing for a tier: a dark slab flush with the face, so wall devices always have a body behind them. */
function backing(b, s, t, col, kind, depth = 2.6) {
  const dir = inward(s), dd = Math.min(depth, t.d * 0.6);
  b.box(faceX(s, t) - dir * dd / 2, t.y0, -t.du, dd, t.y1 - t.y0, t.w, { col, kind, var: 0.4, faces: dir < 0 ? 'xzZt' : 'XzZt' });
}
/** Riveted steel bands wrapped around the backing at a few heights. */
function ribs(b, t, y0, step) {
  for (let y = y0; y < t.y1 - 3; y += step) band(b, t, y, 0.7, 0.3, 0x2a2424, K.METAL, 'xXzZ');
}
/** Hero hardware near flight height (vents, elbows) + sparse far-floor vents, all kept off the Anchor devices. */
function hardware(b, s, t, r, anchors, target) {
  const dir = inward(s), fx = faceX(s, t), yaw = yawTo(dir, 0), half = t.w / 2 - 2.6;
  if (half < 1) return;
  const step = 26, start = Math.max(t.y0 + 5, 8), y0 = start + Math.max(0, Math.round((target - 3 - start) / step)) * step;
  for (let y = y0 - step; y < t.y1 - 9; y += step) {
    if (y < start) continue;
    const z = -t.du + rr(r, -half, half);
    if (y === y0 || r() < 0.55) { if (clearAt(anchors, z, y - 0.5, 0, 7.4, 2.4)) part(b, 'vent', fx, y, z, yaw, 1, 1, 1, { glow: r() < 0.7 ? GLOW : 0xffa030 }); }
    const ze = -t.du + rr(r, -half, half), ye = y + 9;
    if (ye + 5 >= t.y1 - 2 || Math.abs(ze - z) <= 4 || !clearAt(anchors, ze, ye, 4.8, 5, 4.2)) continue;
    part(b, 'elbow', fx, ye, ze, yaw);
    const pipeX = fx + dir * 0.95, pipeZ = ze - dir * 0.2;
    b.cyl(pipeX, ye - 4.5, pipeZ, 0.52, 0.52, 4.55, 8, { col: RUST, kind: K.METAL, caps: 'b' });
    b.cyl(pipeX, ye - 4.65, pipeZ, 0.77, 0.77, 0.34, 8, { col: 0x37323d, kind: K.METAL });
  }
}
/** Thin lit slots on the rest of the face (cheap, flat). */
function slots(b, s, t, r, anchors) {
  const fx = faceX(s, t) + inward(s) * 0.03, f = inward(s) < 0 ? 'x' : 'X';
  for (let y = 10; y < t.y1 - 6; y += rr(r, 9, 13)) {
    const z = -t.du + rr(r, -t.w / 2 + 2, t.w / 2 - 2), hh = rr(r, 1.4, 2.6);
    if (clearAt(anchors, z, y, 0, hh, 1.8)) b.box(fx, y, z, 0.06, hh, rr(r, 0.8, 2), { col: r() < 0.7 ? GLOW : 0xffb040, kind: K.EMIS, faces: f });
  }
}
/** Steel rail bays along the far edge of a roof; chimneys and an occasional crane (never on a landing terrace). */
function roof(b, s, r) {
  const top = s.tiers.at(-1), dir = inward(s), n = Math.max(1, Math.round(top.w / 8)), bay = top.w / n;
  for (let i = 0; i < n; i++) part(b, 'gusset', top.dv - dir * (top.d / 2 - 0.5), top.y1, -top.du - top.w / 2 + bay * (i + 0.5), Math.PI / 2, bay / 4, 1, 1);
  for (let k = 0; k < (r() < 0.65 ? 2 : 1); k++) {
    const x = top.dv + rr(r, -top.d / 4, top.d / 4) - dir * 1.5, z = -top.du + rr(r, -top.w / 4, top.w / 4), h = rr(r, 8, 16);
    b.cyl(x, top.y1, z, 1.5, 1.1, h, 8, { col: 0x4a3a34, kind: K.METAL }); b.cyl(x, top.y1 + h - 1.5, z, 1.45, 1.45, 0.5, 8, { col: 0x2a2424, kind: K.METAL }); b.cyl(x, top.y1 + h, z, 1.0, 1.0, 0.3, 8, { col: GLOW, kind: K.EMIS });
  }
  if (r() < 0.4) crane(b, top.dv - dir * 2, top.y1, -top.du, rr(r, 8, 14), r);
}
function crane(b, x, y, z, L, r) { b.box(x, y, z, 1.2, 12, 1.2, { col: 0x5a3a2a, kind: K.METAL }); b.pushTRS(x, y + 12, z, rr(r, 0, 6.28)); b.truss(-2, L, 0, 0, 1.6, 1.4, 0.18, { col: 0x6a4430 }); b.box(L - 0.5, -6, 0, 0.06, 6, 0.06, { col: 0x222 }); b.box(L - 0.5, -7.2, 0, 1.4, 1.2, 1.4, { col: 0x7a5a3a, kind: K.METAL }); b.pop(); }
function catwalk(b, s, t, r, y, anchors) {
  const fx = faceX(s, t), dir = inward(s), L = Math.min(t.w - 1, rr(r, 6, 12)), z = -t.du + rr(r, -t.w / 4, t.w / 4);
  if (!clearAt(anchors, z, y, 1.9, 1.3, L / 2 + 1.8)) return;
  for (const offset of [-L * 0.32, L * 0.32]) b.pipe([fx, y - 1.8, z + offset],
    [fx + dir * 1.48, y - 0.05, z + offset], 0.13, 4, { col: 0x4e3f42, kind: K.METAL });
  b.box(fx + dir * 0.8, y, z, 1.6, 0.15, L, { col: 0x2a2424, kind: K.METAL }); for (let q = -L / 2; q <= L / 2; q += 2.4) b.box(fx + dir * 1.55, y + 0.15, z + q, 0.08, 1.0, 0.08, { col: 0x5a4a40, kind: K.METAL }); b.box(fx + dir * 1.55, y + 1.1, z, 0.08, 0.08, L, { col: 0x5a4a40, kind: K.METAL }); b.box(fx + dir * 1.55, y + 0.2, z, 0.05, 0.05, L, { col: GLOW, kind: K.EMIS });
}

/** Faceted volcano with molten runnels attached to the slopes facing the city. */
function volcano(b, g, r) {
  b.pushTRS(116, 0, -730);
  const count = 14;
  const rings = [[-24, 355, 11], [115, 220, 28], [228, 124, 18], [319, 48, 13]].map(([y, radius, relief]) =>
    Array.from({ length: count }, (_, i) => {
      const a = i * Math.PI * 2 / count, width = radius * rr(r, 0.82, 1.14);
      return [Math.sin(a) * width, y + rr(r, -relief, relief), Math.cos(a) * width];
    }));
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count, a = (i + 0.5) * Math.PI * 2 / count;
    const n = [Math.sin(a), 0.35, Math.cos(a)], col = pick(r, BASALT);
    for (let level = 0; level < rings.length - 1; level++) {
      const lo = rings[level], hi = rings[level + 1];
      b.quadN(lo[i], lo[j], hi[j], hi[i], n, col, K.ROCK, r());
    }
  }
  for (const i of [0, 1, count - 1, count - 2]) {
    const j = (i + 1) % count, a = (i + 0.5) * Math.PI * 2 / count;
    const n = [Math.sin(a), 0.6, Math.cos(a)];
    const offsets = rings.map(() => rr(r, 0.30, 0.70));
    const edge = (level, sign) => {
      const [p, q] = [rings[level][i], rings[level][j]];
      const u = offsets[level] + sign * (level === 3 ? 0.064 : 0.041);
      return p.map((v, k) => v + (q[k] - v) * u + n[k] * 1.2);
    };
    for (let level = i === 0 || i === count - 1 ? 0 : 1; level < rings.length - 1; level++) {
      const lowLeft = edge(level, -1), lowRight = edge(level, 1), highRight = edge(level + 1, 1), highLeft = edge(level + 1, -1);
      b.quadN(lowLeft, lowRight, highRight, highLeft, n, GLOW, K.LAVAGLOW, 0, [0, lowLeft[1], 3.5, highRight[1] - lowLeft[1]]);
    }
  }
  b.cyl(0, 313, 0, 45, 45, 3, 14, { col: 0xffa040, kind: K.EMIS });
  g.blob(0, 323, 0, 79, 0.52, { col: 0x772812, kind: 3, detail: 1, jitter: 0 });
  g.blob(14, 402, 12, 137, 0.49, { col: 0x271433, kind: 3, detail: 1, jitter: 0 });
  b.pop();
}

/** A stepped foundry silhouette with a raised glowing main furnace and a service gantry. */
function distantFoundry(b, g, r) {
  b.pushTRS(-28, 0, -450);
  const steps = [[0, 48, 158, 74, 0], [48, 46, 132, 68, -7], [94, 46, 104, 60, -13],
    [140, 56, 78, 52, -18], [196, 35, 48, 42, -21]];
  for (const [y, h, w, d, z] of steps) {
    const front = z + d / 2;
    b.box(0, y, z, w, h, d, { col: pick(r, IRON), kind: K.METAL });
    b.box(0, y + h - 3, z, w + 4, 3, d + 4, { col: 0x312b38, kind: K.METAL });
    for (const side of [-1, 1]) {
      b.frustum(side * (w / 2 - 5), y, front - 3, 10, 13, h - 3, 6, 6, { col: 0x48414c, kind: K.METAL });
      b.box(side * w * 0.28, y + h * 0.24, front + 0.65, 3.5, h * 0.50, 1.1, { col: GLOW, kind: K.LAVAGLOW });
    }
  }
  const z = 8.6, y = 143, hotFace = z + 2.35;
  b.box(0, y, z - 0.25, 35, 44, 1.9, { col: 0x4a3d48, kind: K.METAL });
  b.quad([-11, y + 3, hotFace], [11, y + 3, hotFace],
    [11, y + 31, hotFace], [-11, y + 31, hotFace], GLOW, K.LAVAGLOW);
  b.tri([-11, y + 31, hotFace], [11, y + 31, hotFace],
    [0, y + 39, hotFace], GLOW, K.LAVAGLOW);
  for (const x of [-6, 0, 6]) b.box(x, y + 3, hotFace + 0.9, 1, 30, 1.1, { col: 0x3e3039, kind: K.METAL });
  g.blob(0, y + 18, z + 2, 20, 1.1, { col: 0x6f260a, kind: 3, detail: 1, jitter: 0 });
  for (const [x, base, h] of [[-46, 140, 66], [-20, 196, 58], [20, 196, 52], [46, 140, 71]]) {
    b.cyl(x, base, -20, 6, 4, h, 8, { col: 0x3d3744, kind: K.METAL });
    b.cyl(x, base + h, -20, 4.5, 4.5, 2.6, 8, { col: GLOW, kind: K.EMIS });
  }
  b.truss(-60, 60, 135, 26, 7, 3, 0.7, { col: 0x59444b });
  b.pop();
}

/** Three points across each section keep the flow UV continuous through bends. */
function lavaRibbon(b, sections, phase, twoSided = false) {
  let distance = 0;
  for (let i = 1; i < sections.length; i++) {
    const prev = sections[i - 1], next = sections[i];
    const step = Math.hypot(...next[1].map((v, axis) => v - prev[1][axis]));
    for (let j = 0; j < 2; j++) {
      b.quad(prev[j], prev[j + 1], next[j + 1], next[j], GLOW, K.LAVA_FLOW, phase, [j * 0.5, distance, 0.5, step]);
      if (twoSided) b.quad(prev[j + 1], prev[j], next[j], next[j + 1], GLOW, K.LAVA_FLOW, phase,
        [(j + 1) * 0.5, distance, -0.5, step]);
    }
    distance += step;
  }
}

/** A refractory trough carried outside the bridge deck, with its visible lip below the hot surface. */
function spanLava(b, s, y) {
  const length = s.d / 2 - 0.7, inside = s.w / 2 + 0.23, lip = inside + 1.14;
  const left = -length, right = length, end = y - 0.39;
  const section = (x, h) => [[x, h + 0.61, inside], [x, h + 0.39, inside + 0.48], [x, h + 0.11, lip]];
  lavaRibbon(b, [section(left, y), section(right, end)], (s.u * 0.036) % 1);
  b.quad([left, y - 0.36, lip], [right, end - 0.36, lip], [right, end + 0.14, lip], [left, y + 0.14, lip],
    0x51404a, K.METAL);
  b.quad([left, y - 0.36, inside], [right, end - 0.36, inside], [right, end - 0.36, lip], [left, y - 0.36, lip],
    0x352c36, K.METAL);
  for (const [x, h] of [[left + 0.5, y], [0, (y + end) / 2], [right - 0.5, end]]) {
    b.box(x, h - 0.42, inside + 0.53, 0.42, 0.39, 1.52, { col: 0x645056, kind: K.METAL, faces: 'xXzZb' });
  }
}

/** A wall spout feeds a falling ribbon and a shallow runoff tongue at the lava bank. */
function wallLava(b, ctx) {
  const { m, rng: r, local } = ctx;
  const side = m.idx % 2 ? -1 : 1, middle = m.L * 0.5;
  const candidates = m.structures.filter((s) => s.role === 'inner' && !s.isPlatform && s.u > 7 && s.u < m.L - 7)
    .sort((a, c) => (a.side === side ? 0 : m.L) - (c.side === side ? 0 : m.L) + Math.abs(a.u - middle) - Math.abs(c.u - middle));
  for (const s of candidates) {
    const t = s.tiers[0], dir = inward(s), fx = faceX(s, t), anchors = anchorsOn(m, s);
    const top = Math.min(pathY(m, s.u) - 5, t.y1 - 7), centre = -t.du;
    if (t.y0 !== 0 || top < 20) continue;
    const z = [centre, centre - t.w * 0.19, centre + t.w * 0.19]
      .find((v) => clearAt(anchors, v, top, top, 2.1, 3.25));
    if (z === undefined) continue;

    const [x, oz] = local(s.u, s.v), width = rr(r, 1.35, 2.05), sway = rr(r, -0.27, 0.27);
    b.pushTRS(x, 0, oz, -frameAt(m, s.u).a);
    b.box(fx + dir * 0.15, top - 1.05, z, 0.9, 3.1, width + 1.04, { col: 0x4b3c45, kind: K.METAL });
    for (const edge of [-1, 1]) b.box(fx + dir * 0.93, top - 0.65, z + edge * (width / 2 + 0.22),
      1.96, 0.76, 0.33, { col: 0x5b464a, kind: K.METAL });
    b.box(fx + dir * 0.95, top - 0.75, z, 1.98, 0.28, width + 0.54, { col: 0x342831, kind: K.METAL });
    const section = (reach, y, offset, spread, bulge = 0.17) => {
      const base = fx + dir * reach, half = width * spread * 0.5;
      return [[base, y, z + offset - dir * half], [base + dir * bulge, y, z + offset], [base, y, z + offset + dir * half]];
    };
    lavaRibbon(b, [
      section(0.6, top + 0.22, 0, 0.85, 0),
      section(1.84, top, 0, 1, 0.08),
      section(2.34, top - 1.05, sway * 0.3, 0.93),
      section(2.52, top * 0.75, sway, 0.83),
      section(2.48, top * 0.36, sway * 1.5, 0.67),
      section(2.75, 1.14, sway, 0.88),
      section(3.35, 0.19, sway, 1.34, 0),
      section(8.2, 0.12, sway - 0.15, 0.53, 0),
    ], r(), true);
    b.pop();
    return;
  }
}

export const molten = {
  fortress(b, s, { rng: r, m }) {
    const c = pick(r, IRON), near = s.role === 'inner', target = near ? pathY(m, s.u) + 3 : 60, anchors = anchorsOn(m, s);
    drawTiers(b, s, () => ({ col: c, kind: K.METAL, var: r(), top: { col: 0x2a2424, kind: K.METAL } }));
    for (const t of s.tiers) {
      const stone = pick(r, BASALT);
      // The ground footing can flare out. Upper tiers need a flush mounting face for their Anchor devices.
      if (t.y0 === 0) b.frustum(t.dv, 0, -t.du, t.d + 2.4, t.w + 2.4, 14, t.d, t.w, { col: stone, kind: K.ROCK });
      ribs(b, t, t.y0 + 16, rr(r, 18, 24));
      band(b, t, t.y1 - 1.6, 1.6, 0.5, 0x2a2424, K.METAL);
      if (near) hardware(b, s, t, r, anchors, target);
      slots(b, s, t, r, anchors);
      if (near && r() < 0.45) catwalk(b, s, t, r, rr(r, 14, Math.max(15, t.y1 - 8)), anchors);
    }
    if (!s.isPlatform && near) roof(b, s, r);
    else if (s.isPlatform) railing(b, s, s.tiers[0], { col: 0x5a4a40, kind: K.METAL });
  },
  basalt(b, s, { rng: r, m }) { // a rock tower of jagged graphite basalt columns wrapped in steel hardware
    const near = s.role === 'inner', target = near ? pathY(m, s.u) + 3 : 60, anchors = anchorsOn(m, s), dir = inward(s);
    for (const t of s.tiers) {
      backing(b, s, t, BASALT[0], K.ROCK, 3.2);
      b.box(t.dv, t.y0, -t.du, t.d * 0.8, (t.y1 - t.y0) * 0.9, t.w * 0.8, { col: BASALT[0], kind: K.ROCK });
      for (let k = 0; k < 6; k++) { const R = rr(r, 1.8, 3.0), x = t.dv + rr(r, -t.d / 2 + R, t.d / 2 - R), z = -t.du + rr(r, -t.w / 2 + R, t.w / 2 - R), h = (t.y1 - t.y0) * rr(r, 0.7, 1); b.cyl(x, t.y0, z, R, R * rr(r, 0.55, 0.9), h, 5, { col: pick(r, BASALT), kind: K.ROCK, var: r(), a0: r() }); }
      const fx = faceX(s, t), yaw = yawTo(dir, 0);
      for (let y = Math.max(t.y0, 0) + 1; y < t.y1 - 10; y += near ? 28 : 60) { // jagged outcrops with steel hardware growing from the face
        const z = -t.du + rr(r, -t.w / 2 + 3, t.w / 2 - 3);
        if (near && clearAt(anchors, z, y, 0, 8.6, 3.2)) part(b, 'outcrop', fx - dir * 0.2, y, z, yaw, rr(r, 1, 1.3), rr(r, 0.9, 1.4), 1, { basalt: pick(r, BASALT) });
      }
      if (near) hardware(b, s, t, r, anchors, target);
      if (r() < 0.55) b.box(fx + dir * 0.05, rr(r, 4, 10), -t.du + rr(r, -t.w / 4, t.w / 4), 0.1, rr(r, 10, 30), rr(r, 1, 2.2), { col: GLOW, kind: K.LAVAGLOW, faces: dir < 0 ? 'x' : 'X' }); // glowing seam
    }
    if (s.isPlatform) railing(b, s, s.tiers[0], { col: 0x5a4a40, kind: K.METAL });
  },
  furnace(b, s, { rng: r, glow: g, m }) { // a faceted furnace drum inside a riveted steel shaft, glowing slots and a hot top
    const near = s.role === 'inner', target = near ? pathY(m, s.u) + 3 : 60, anchors = anchorsOn(m, s);
    for (const t of s.tiers) {
      const R = Math.min(t.d, t.w) / 2, H = t.y1 - t.y0;
      backing(b, s, t, 0x342e2e, K.METAL, 2.8);
      b.cyl(t.dv, t.y0, -t.du, R, R * 0.92, H, 10, { col: pick(r, IRON), kind: K.METAL, var: r(), caps: '' });
      for (let y = t.y0 + 8; y < t.y1 - 3; y += 14) b.cyl(t.dv, y, -t.du, R + 0.3, R + 0.3, 0.8, 10, { col: 0x2a2424, kind: K.METAL, caps: '' });
      for (let y = t.y0 + 11; y < t.y1 - 6; y += 14) for (let k = 0; k < 5; k++) { const a = k * 1.2566 + y; b.pushTRS(t.dv + Math.cos(a) * (R - 0.02), y, -t.du + Math.sin(a) * (R - 0.02), -a); b.box(0, 0, 0, 0.08, 3, 0.7, { col: GLOW, kind: K.EMIS, faces: 'XxzZ' }); b.pop(); }
      if (near) hardware(b, s, t, r, anchors, target);
      slots(b, s, t, r, anchors);
    }
    const t = s.tiers.at(-1), R = Math.min(t.d, t.w) / 2;
    b.cyl(t.dv, t.y1, -t.du, R * 0.7, R * 0.4, 4, 10, { col: 0x3a3030, kind: K.METAL });
    b.cyl(t.dv, t.y1 + 4, -t.du, R * 0.38, R * 0.38, 0.4, 10, { col: 0xffb040, kind: K.EMIS });
    g.blob(t.dv, t.y1 + 6, -t.du, R * 1.2, 0.6, { col: 0x5a2a0a, kind: 3, jitter: 0 });
    if (s.isPlatform) railing(b, s, s.tiers[0], { col: 0x5a4a40, kind: K.METAL });
  },
  structure(b, s, ctx) { molten.fortress(b, s, ctx); },
  pillar(b, s, ctx) { molten.basalt(b, s, ctx); },
  bridgeHigh(b, s) { // open steel lattice bridge (deck = the collision box); everything stays above the flat deck underside
    const L = s.d, w = s.w;
    b.box(0, s.y0, 0, L, 0.7, w, { col: 0x2e2a2a, kind: K.METAL, faces: 'xXzZtb' });
    for (const z of [-w / 2, w / 2]) b.box(0, s.y0 + 0.4, z, L, 0.14, 0.1, { col: GLOW, kind: K.EMIS });
    const n = Math.max(2, Math.round(L / 8)), bay = L / n;
    const rise = (s.h - s.y0 - 0.7) / 1.62;
    for (let i = 0; i < n; i++) for (const side of [-1, 1]) part(b, 'gusset',
      -L / 2 + bay * (i + 0.5), s.y0 + 0.7, side * (w / 2 - 0.05), yawTo(0, side), bay / 4, rise, 1);
    for (const x of [-L / 2 + 2, 0, L / 2 - 2]) b.box(x, s.y0 + 0.7, 0, 0.32, 0.18, w, { col: 0x3a3640, kind: K.METAL });
    spanLava(b, s, s.y0 + 1.42);
  },
  bridgeLow(b, s, { rng: r }) { // a heavy plate-girder span, its railings bent and part of the edge broken away
    const L = s.d, w = s.w;
    b.box(0, s.y0, 0, L, s.h - s.y0, w, { col: 0x342e2c, kind: K.METAL, faces: 'xXzZtb', top: { col: 0x2a2626, kind: K.METAL } });
    for (const z of [-w / 2 + 0.2, w / 2 - 0.2]) for (let x = -L / 2 + 0.8; x < L / 2; x += 1.8) { const bent = r() < 0.15; b.pushTRS(x, s.h, z, 0, 1, 1, 1, bent ? rr(r, -0.6, 0.6) : 0); b.box(0, 0, 0, 0.12, 1.1, 0.12, { col: 0x5a4a40, kind: K.METAL }); b.pop(); }
    b.box(rr(r, -L / 4, L / 4), s.y0 - 3, w / 2 - 0.5, 4, 3, 0.4, { col: RUST, kind: K.METAL, faces: 'xXzZb' }); // a torn plate hanging under the edge
    for (let x = -L / 2 + 3; x < L / 2; x += 6) b.box(x, s.y0 - 0.15, 0, 0.5, 0.15, w * 0.7, { col: GLOW, kind: K.EMIS });
    if (s.kind === 'bridgeLow') spanLava(b, s, s.h - 1.05);
  },
  obstacle(b, s, { rng: r }) { // a foundry conveyor housing across the rift
    b.box(0, s.y0, 0, s.d, s.h - s.y0, s.w, { col: pick(r, IRON), kind: K.METAL, var: r(), faces: 'xXzZtb' });
    for (let x = -s.d / 2 + 2; x < s.d / 2; x += 4) b.box(x, s.y0 + 2, -s.w / 2 - 0.04, 1.8, 2.2, 0.08, { col: GLOW, kind: K.EMIS });
    b.truss(-s.d / 2, s.d / 2, s.h, 0, 2.2, s.w * 0.8, 0.25, { col: 0x4a3a34 });
    spanLava(b, s, s.y0 + 3.15);
  },
  startPlatform(b, s, ctx) { molten.bridgeLow(b, s, ctx); },
  closure(b, s, ctx) { molten.fortress(b, { ...s, side: 1, role: 'closure', tiers: [{ y0: 0, y1: s.h, w: s.w, d: s.d, du: 0, dv: 0 }] }, ctx); },
  landmarkTower(b, s, ctx) { // the great furnace tower with a crane on top
    molten.furnace(b, s, ctx); const t = s.tiers[0]; crane(b, t.dv, t.y1 + 4, 0, 16, ctx.rng);
  },
  moduleDecor(b, ctx) { // dark rocks along the banks and wall outlets feeding the lava river
    const { m, rng: r, local, halfW } = ctx;
    for (let u = 0; u < m.L; u += rr(r, 6, 10)) for (const side of [-1, 1]) { const [x, z] = local(u, side * rr(r, halfW * 0.6, halfW + 1)); b.blob(x, 0.4, z, rr(r, 1.5, 4), 0.55, { col: pick(r, BASALT), kind: K.ROCK, var: r(), seed: u }); }
    wallLava(b, ctx);
  },
  /**
   * Telegraphed environmental event (visual only, never in the swing path): every 11–17 s a lava geyser erupts from
   * the river ahead at the corridor edge — 1.6 s of a brightening, spreading glow + a low rumble first, then a column
   * that rises at most to 9 m below the flight path and sinks back.
   */
  animate(R, dt, t, cam) {
    const w = R.world; if (!w || !w.live.size) return;
    if (!R._geyser) {
      const gb = new GeoBuilder(); gb.cyl(0, 0, 0, 1, 0.55, 1, 10, { col: 0xff7a20, kind: 3, caps: '' }); gb.cyl(0, 0, 0, 0.55, 0.2, 1.08, 8, { col: 0xffd060, kind: 3, caps: '' });
      const rb = new GeoBuilder(); rb.cyl(0, 0, 0, 1, 1, 0.1, 24, { col: 0xff5a10, kind: 3, caps: 't' });
      R._geyser = { col: new THREE.Mesh(gb.build(), R.glowMat), ring: new THREE.Mesh(rb.build(), R.glowMat), next: t + 9, phase: null, t: 0 };
      for (const m of [R._geyser.col, R._geyser.ring]) { m.visible = false; m.renderOrder = 7; R.root.add(m); }
    }
    const G = R._geyser;
    if (!G.phase && t >= G.next) {
      const pr = w.progress(cam.x, cam.z), s = pr.s + rr(Math.random, 70, 100), m = w.moduleAtS(s), side = Math.random() < 0.5 ? -1 : 1;
      if (!m || !w.live.get(m.idx)?.ready) { G.next = t + 2; return; }
      const p = w.pointAt(s), a = w.headingAt(s), v = side * (m.halfW - 3);
      G.pos = new THREE.Vector3(p.x + Math.cos(a) * v, 0.2, p.z + Math.sin(a) * v); G.top = Math.max(6, p.y - 9); G.phase = 'warn'; G.t = 0;
      audio.tone?.(48, 1.8, { type: 'sawtooth', gain: 0.06, slideTo: 30 }); audio.noise?.(1.6, { type: 'lowpass', f0: 300, f1: 120, gain: 0.12 });
    }
    if (!G.phase) return;
    G.t += dt;
    G.ring.position.copy(G.pos); G.col.position.copy(G.pos);
    if (G.phase === 'warn') {
      const k = Math.min(1, G.t / 1.6); G.ring.visible = true; G.ring.scale.set(2 + k * 4, 1, 2 + k * 4); G.col.visible = false;
      if (k >= 1) { G.phase = 'burst'; G.t = 0; audio.noise?.(0.9, { type: 'bandpass', f0: 900, f1: 200, gain: 0.18 }); }
    } else {
      const k = G.t / 1.6, h = G.top * Math.sin(Math.min(1, k) * Math.PI);
      G.col.visible = h > 0.3; G.col.scale.set(2.2, Math.max(0.01, h), 2.2); G.ring.scale.set(6 - k * 4, 1, 6 - k * 4);
      if (k >= 1) { G.phase = null; G.col.visible = G.ring.visible = false; G.next = t + 11 + Math.random() * 6; }
    }
  },
  backdrop(b, g, { rng: r }) {
    for (let i = 0; i < 60; i++) { const a = (i / 60) * Math.PI * 2 + rr(r, -0.05, 0.05), d = rr(r, 420, 820), x = Math.sin(a) * d, z = -Math.cos(a) * d, h = rr(r, 50, 160); b.cyl(x, -5, z, rr(r, 30, 70), rr(r, 4, 16), h, 6, { col: pick(r, BASALT), kind: K.ROCK, a0: r() * 6 }); }
    for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2, d = rr(r, 400, 700), x = Math.sin(a) * d, z = -Math.cos(a) * d, h = rr(r, 40, 120), w = rr(r, 14, 30); b.box(x, 0, z, w, h, w, { col: pick(r, IRON), kind: K.METAL }); b.box(x, h * 0.6, z - w / 2 - 0.2, w * 0.5, 3, 0.2, { col: GLOW, kind: K.EMIS }); b.cyl(x, h, z, 2, 1.6, rr(r, 10, 30), 6, { col: 0x3a3030, kind: K.METAL }); }
    volcano(b, g, r);
    distantFoundry(b, g, r);
  },
};
