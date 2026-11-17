// Cloud Palace Ancient City / 雲闕古城 — tall Chinese-inspired palace towers: carved pale stone bases with dragon
// relief panels, red-columned storeys with gold lattice windows, painted dougong brackets under jade-green and golden
// glazed-tile roofs with upturned corners, white marble balustrades, monumental gatehouses with an opening at flight
// height, covered bridges, a soft sunrise cloud sea (the procedural cloud floor) and karst mountains with the golden
// cloud palace ahead. The eaves, corner tips, brackets, ridge ends, rails and reliefs are Blender parts
// (tools/blender/build_cloudpalace_kit.py) appended into the streamed module batches; rich detail goes on the one
// storey per face nearest the chase line. Every eave / bracket / plant keeps the swing-anchor devices clear.
import * as THREE from 'three';
import { foliage } from '../../art/treeFoliage.js';
import { K, pick, rr, inward, faceX, lantern } from './common.js';
import { CLOUDPALACE_PARTS, CLOUDPALACE_SLOTS } from '../art/cloudpalaceKit.js';
import { toWorld, frameAt, pathY } from '../route.js';

const RED = [0xb02a20, 0xbc3224, 0xa4241c], JADE = [0x1f8a68, 0x28966e, 0x1a7a5e], GOLDR = [0xe0a82c, 0xe8b438], GOLD = 0xe6b84a, TEAL = 0x1f6a60;
const STONE = [0xece2cf, 0xe4d8c3, 0xf2eadb], MARBLE = 0xf4eee2;

// Blender parts: material slot → colour / surface kind (tile is overridden per call: jade or gold glaze).
const SLOT = {
  tile: { col: JADE[0], kind: K.TILE }, gold: { col: GOLD, kind: K.PLAIN }, red: { col: 0xb02a20, kind: K.PLAIN },
  teal: { col: TEAL, kind: K.PLAIN }, stone: { col: 0xe4d8c3, kind: K.STONE }, marble: { col: MARBLE, kind: K.STONE },
  carve: { col: 0xc9bca2, kind: K.STONE },
};
const SLOT_LOOK = CLOUDPALACE_SLOTS.map((n) => ({ ...SLOT[n], col: new THREE.Color(SLOT[n].col) }));
const _tile = new THREE.Color();
/** Append Blender part `name` at (x, y, z) with yaw and per-axis scale; uv = planar metres along the dominant normal. */
function part(b, name, x, y, z, yaw = 0, sx = 1, sy = 1, sz = 1, tile = 0) {
  const P = CLOUDPALACE_PARTS[name], base = b.vcount, n = P.s.length;
  if (tile) _tile.set(tile);
  b.pushTRS(x, y, z, yaw, sx, sy, sz);
  for (let i = 0; i < n; i++) {
    const px = P.p[i * 3] / 1000, py = P.p[i * 3 + 1] / 1000, pz = P.p[i * 3 + 2] / 1000;
    const nx = P.n[i * 3] / 127, ny = P.n[i * 3 + 1] / 127, nz = P.n[i * 3 + 2] / 127, ax = Math.abs(nx), ay = Math.abs(ny);
    const u = ax > ay && ax > Math.abs(nz) ? pz * sz : px * sx, v = ay >= ax && ay >= Math.abs(nz) ? pz * sz : py * sy;
    const L = SLOT_LOOK[P.s[i]];
    b._vert(px, py, pz, nx, ny, nz, tile && P.s[i] === 0 ? _tile : L.col, u, v, L.kind, 0);
  }
  for (let i = 0; i < P.i.length; i += 3) b.I.push3(base + P.i[i], base + P.i[i + 1], base + P.i[i + 2]);
  b.pop();
}
const yawTo = (dx, dz) => Math.atan2(dx, dz); // turns a part's +z (out of its wall) toward local (dx, dz)

// =============================================================================================== anchors
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
// A device is ~1.9 m in radius on the wall: a roof edge at y (down to y-0.2, dougong to y-1.4) stays above it
// (y ≥ a.y + 2.6) or below it (y ≤ a.y - 2.0).
const blocks = (y, a) => y > a.y - 2.0 && y < a.y + 2.6;
function eaveY(y, face, lo, hi) {
  const hit = face.find((a) => blocks(y, a));
  if (!hit) return y;
  const options = [hit.y + 2.6, hit.y - 2.0].sort((p, q) => Math.abs(p - y) - Math.abs(q - y));
  return options.find((c) => c > lo && c < hi && !face.some((a) => blocks(c, a))) ?? null;
}
const clearAt = (face, z, y, down, up, half = 2.2) => !face.some((a) => Math.abs(a.z - z) < half && a.y > y - down - 1.9 && a.y < y + up + 1.9);
const faceAnchors = (ctx, s, fx, y0, y1) => anchorsOn(ctx.m, s).filter((a) => Math.abs(a.x - fx) < 1.6 && a.y > y0 - 2 && a.y < y1 + 3);

// =============================================================================================== roofs
/** Hip roof with a closed painted fascia and one flat soffit (no see-through sheets); optional gold ridge ends. */
function tiledRoof(b, x, y, z, depth, width, rise, over, curl, tile, { ridge = GOLD, ends = false, lite = 0 } = {}) {
  b.hipRoof(x, y, z, depth, width, rise, over, curl, { col: tile, kind: K.TILE, ridge, ridgeKind: K.PLAIN, under: false });
  const dx = depth / 2 + over, dz = width / 2 + over, lower = y - 0.28;
  const corners = [[x - dx, z + dz], [x + dx, z + dz], [x + dx, z - dz], [x - dx, z - dz]];
  const centre = [x, lower, z];
  for (let i = 0; i < corners.length; i++) {
    const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % corners.length], mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const a = [ax, lower + curl, az], mid = [mx, lower, mz], end = [bx, lower + curl, bz];
    if (!lite || (mx - x) * lite > 0.5) {
      b.quad(a, mid, [mx, y, mz], [ax, y + curl, az], TEAL, K.PLAIN);
      b.quad(mid, end, [bx, y + curl, bz], [mx, y, mz], TEAL, K.PLAIN);
    }
    b.tri(centre, mid, a, 0x254d47, K.PLAIN);
    b.tri(centre, end, mid, 0x254d47, K.PLAIN);
  }
  if (ends) for (const [cx, cz] of corners) if (ends === true || (cx - x) * ends > 0) part(b, 'ridge_end', cx, y + curl - 0.1, cz, Math.atan2(-(cz - z), cx - x), 0.8, 0.8, 0.8);
}

// =============================================================================================== towers
/** Columns + lattice wall + painted beam on the corridor face (the wall sits 0.3 m inside the collision face). */
function wallBand(b, s, t, y0, y1, r, red, lite, wallTop) {
  const dir = inward(s), fx = faceX(s, t), wx = fx - dir * 0.3;
  b.box(t.dv - dir * 0.15, y0, -t.du, t.d - 0.3, wallTop - y0, t.w - 0.3, { col: red, kind: K.LATTICE, var: r(), faces: 'xXzZ' });
  const step = Math.max(lite ? 6 : 3, (t.w - 1) / Math.round(t.w / (lite ? 6 : 3)));
  if (!lite) for (let z = -t.w / 2 + 0.5; z <= t.w / 2 - 0.45; z += step) b.cyl(wx + dir * 0.35, y0, -t.du + z, 0.3, 0.28, y1 - y0 - 0.5, 6, { col: red, kind: K.PLAIN, caps: '' });
  b.box(t.dv - dir * 0.1, y1 - 0.6, -t.du, t.d - 0.1, 0.6, t.w + 0.1, { col: TEAL, kind: K.PLAIN, faces: 'xXzZ' });
  if (!lite) b.box(wx + dir * 0.3, y1 - 0.75, -t.du, 0.5, 0.15, t.w + 0.1, { col: GOLD, kind: K.PLAIN, faces: 'xXzZ' });
}
/** Dougong clusters under a roof edge at y (the soffit), on the corridor face. */
function brackets(b, g, s, t, y, anchors, r) {
  const dir = inward(s), wx = faceX(s, t) - dir * 0.3, n = Math.min(2, Math.floor(t.w / 5)), step = t.w / n;
  for (let i = 0; i < n; i++) {
    const zb = -t.du - t.w / 2 + step * (i + 0.5);
    if (clearAt(anchors, zb, y, 1.4, 0)) part(b, 'dougong', wx, y, zb, yawTo(dir, 0));
  }
  const zl = -t.du - t.w / 2 + step * (n > 1 ? 1 : 0.5);
  if (n > 1 && r() < 0.8 && clearAt(anchors, zl, y, 1.8, 0)) lantern(b, g, wx + dir * 1.9, y - 1.0, zl, { col: 0xff5a30, r: 0.38, body: 0x5a1a10 });
}
/** Carved stone relief panel (dragon) on the pale base face, if no device sits on it. */
function relief(b, s, t, anchors, y, h) {
  const k = Math.min(1.1, (h - 0.6) / 4, (t.w - 2) / 6.2), z = -t.du;
  if (k > 0.55 && clearAt(anchors, z, y + 2 * k, 2 * k, 2 * k, 3.2 * k + 1.9)) part(b, 'relief', faceX(s, t), y, z, yawTo(inward(s), 0), k, k, k);
}
function terracePlant(b, x, y, z, r) {
  b.cyl(x, y, z, 0.16, 0.11, 1.8, 5, { col: 0x4a3420, kind: K.BARK, caps: '' });
  foliage(b, x, y + 2.3, z, rr(r, 1.3, 1.8), 0.8, { col: pick(r, [0x4a8a4a, 0x5a9a50]), var: r(), cards: 3 });
}
/** Marble balustrade along the corridor edge of a platform tier. */
function terraceRail(b, s, t, anchors) {
  const dir = inward(s), x = faceX(s, t) - dir * 0.25, n = Math.max(1, Math.round(t.w / 3.4)), bay = t.w / n;
  for (let i = 0; i < n; i++) {
    const z = -t.du - t.w / 2 + bay * (i + 0.5);
    if (clearAt(anchors, z, t.y1, 0, 1.4, bay / 2 + 1.0)) part(b, 'rail_bay', x, t.y1, z, Math.PI / 2, bay / 2);
  }
}

function palace(b, s, ctx) {
  const { rng: r, glow: g } = ctx, near = s.role === 'inner', lite = s.role === 'outer', stone = pick(r, STONE);
  const jade = r() < 0.55, body = jade ? pick(r, JADE) : pick(r, GOLDR), cap = r() < 0.45 ? (jade ? pick(r, GOLDR) : pick(r, JADE)) : body;
  const target = s.u != null && ctx.m ? pathY(ctx.m, s.u) + 4 : 1e9;
  for (const t of s.tiers) {
    const fx = faceX(s, t), dir = inward(s), anchors = near ? faceAnchors(ctx, s, fx, t.y0, t.y1) : [];
    const baseTop = Math.min(t.y1 - 7, Math.max(t.y0 + 10, (t.y1 - t.y0) * rr(r, 0.4, 0.55) + t.y0));
    b.box(t.dv, t.y0, -t.du, t.d, baseTop - t.y0, t.w, { col: stone, kind: K.STONE, var: r() });
    for (let y = t.y0 + 8; y < baseTop - 1; y += 9) b.box(t.dv, y, -t.du, t.d + 0.5, 0.6, t.w + 0.5, { col: MARBLE, kind: K.STONE });
    if (near && baseTop - t.y0 > 12) relief(b, s, t, anchors, t.y0 + 3, baseTop - t.y0 - 5);
    let y = baseTop; const n = Math.max(1, Math.round((t.y1 - baseTop) / 9));
    for (let k = 0; k < n; k++) {
      const last = k === n - 1, red = pick(r, RED);
      let y1 = last ? t.y1 - 1.2 : y + (t.y1 - baseTop) / n - 1.2;
      if (!last && near) y1 = (eaveY(y1 + 0.45, anchors, y + 4, t.y1 - 5) ?? y1 + 0.45) - 0.45; // roof edge clear of devices
      const wallTop = last ? t.y1 : y1 + 1.8;
      wallBand(b, s, t, y, y1, r, red, lite, wallTop);
      const tight = anchors.some((a) => a.y > y1 - 3.4 && a.y < y1 + 3.4 && last), tile = last ? cap : body;
      const rich = near && !last && Math.abs(y1 + 0.45 - target) < 10 && clearAt(anchors, -t.du, y1 + 0.15, 1.4, 0, t.w);
      tiledRoof(b, t.dv, y1 + 0.45, -t.du, t.d, t.w, last ? Math.min(t.d, t.w) * 0.34 + 2.5 : 2.4, tight ? 0.5 : last ? 1.9 : 1.7, last ? 2.0 : 1.4, tile, { ends: last && near && !tight && dir, lite: last && near ? 0 : rich ? 0 : dir });
      if (rich) brackets(b, g, s, t, y1 + 0.15, anchors, r);
      y = wallTop;
    }
    if (s.isPlatform && s.tiers[0] === t) {
      if (near) terraceRail(b, s, t, anchors);
      if (near && r() < 0.7) { const z = -t.du + (r() < 0.5 ? -1 : 1) * t.w * 0.3; if (clearAt(anchors, z, t.y1, 0, 5, 2.6)) terracePlant(b, fx - dir * 1.2, t.y1, z, r); }
    }
  }
}
function pagoda(b, s, ctx) {
  const { rng: r } = ctx, near = s.role === 'inner', dir = inward(s);
  const jade = r() < 0.6, roof = jade ? pick(r, JADE) : pick(r, GOLDR), tip = jade ? pick(r, GOLDR) : pick(r, JADE);
  const stone = pick(r, STONE), target = pathY(ctx.m, s.u) + 4;
  for (const t of s.tiers) {
    const fx = faceX(s, t), cz = -t.du, anchors = near ? faceAnchors(ctx, s, fx, t.y0, t.y1) : [];
    if (s.isPlatform && t === s.tiers[0]) {
      b.box(t.dv, t.y0, cz, t.d, t.y1 - t.y0, t.w, { col: stone, kind: K.STONE, top: { col: MARBLE, kind: K.STONE } });
      terraceRail(b, s, t, anchors);
      const plantZ = cz + (r() < 0.5 ? -1 : 1) * (t.w / 2 - 1.65);
      if (clearAt(anchors, plantZ, t.y1, 0, 4, 2.5)) terracePlant(b, fx - dir * (t.d - 1.2), t.y1, plantZ, r);
      continue;
    }
    const baseH = Math.min(16, (t.y1 - t.y0) * 0.3), base = t.y0 + baseH;
    b.box(t.dv, t.y0, cz, t.d, baseH, t.w, { col: stone, kind: K.STONE, var: r() });
    b.box(t.dv, t.y0 + baseH * 0.5, cz, t.d + 0.5, 0.6, t.w + 0.5, { col: MARBLE, kind: K.STONE });
    if (near && baseH > 11) relief(b, s, t, anchors, t.y0 + 3, baseH - 5);
    const n = Math.max(2, Math.round((t.y1 - base) / (near ? 8 : 10))), step = (t.y1 - base) / n;
    const feature = Math.max(0, Math.min(n - 1, Math.round((target - base) / step) - 1));
    for (let k = 0; k < n; k++) {
      const y = base + k * step, wallTop = k === n - 1 ? t.y1 : y + step;
      const last = k === n - 1, rich = near && k === feature;
      const dk = Math.max(3, t.d * (1 - k / n * 0.36) - 0.35);
      // Keep the playable facade wide enough for devices near its ends while the roof steps back in depth.
      const wd = near ? t.w - 0.28 : t.w * (1 - k / n * 0.32);
      const cx = fx - dir * (dk / 2 + 0.25), red = pick(r, RED);
      b.box(cx, y, cz, dk, wallTop - y, wd, { col: red, kind: K.LATTICE, var: r(), faces: 'xXzZ' });
      const roofY = wallTop + 0.3;
      const tight = anchors.some((a) => blocks(roofY, a));
      const over = tight ? 0.38 : rich ? 1.8 : 1.3;
      if (rich) {
        for (const side of [-1, 1]) {
          const z = cz + side * wd * 0.28;
          if (clearAt(anchors, z, wallTop, wallTop - y, 0)) b.cyl(fx, y, z, 0.28, 0.25, wallTop - y, 6, { col: red, kind: K.PLAIN, caps: '' });
          if (!tight && clearAt(anchors, z, wallTop, 1.35, 0)) part(b, 'dougong', fx - dir * 0.25, wallTop, z, yawTo(dir, 0));
        }
      }
      tiledRoof(b, cx, roofY, cz, dk, wd, last ? 3.4 : 1.65, over, last ? 1.55 : 0.85, last ? tip : roof, { ends: last && near && !tight && dir, lite: last && near ? 0 : dir });
    }
  }
}

/** A gate-tower storey across the route: red wall, columns on both route faces, eave runs, gold hip roof. */
function gateStorey(b, g, y0, y1, L, w, r, tile) {
  const red = pick(r, RED), wd = w * 0.82;
  b.box(0, y0, 0, L, y1 - y0, wd, { col: red, kind: K.LATTICE, var: r() });
  for (const e of [1, -1]) {
    for (let x = -L / 2 + 1; x < L / 2; x += Math.max(3, (L - 2) / Math.round(L / 3))) b.cyl(x, y0, e * (wd / 2 + 0.05), 0.3, 0.28, y1 - y0 - 0.5, 6, { col: red, kind: K.PLAIN, caps: '' });
    b.box(0, y1 - 0.6, e * (wd / 2 + 0.05), L + 0.2, 0.6, 0.5, { col: TEAL, kind: K.PLAIN });
    b.box(0, y1 - 0.75, e * (wd / 2 + 0.3), L + 0.2, 0.15, 0.1, { col: GOLD, kind: K.PLAIN });
  }
  b.box(0, y1 - 0.6, 0, L + 0.2, 0.6, wd, { col: TEAL, kind: K.PLAIN });
  tiledRoof(b, 0, y1 + 0.4, 0, L, wd, Math.min(L, wd) * 0.3 + 2.2, 2.2, 2.2, tile, { ends: true });
  for (const e of [1, -1]) {
    for (let x = -L / 2 + 3; x < L / 2 - 2; x += Math.max(6, L / 4)) part(b, 'dougong', x, y1 + 0.1, e * (wd / 2 + 0.05), yawTo(0, e));
    for (const sx of [-1, 1]) lantern(b, g, sx * L * 0.3, y1 - 1.2, e * (wd / 2 + 2.4), { col: 0xff5a30, r: 0.45, body: 0x5a1a10 });
  }
}

function rail(b, x0, x1, y, z) { // marble balustrade along x
  const n = Math.max(1, Math.round((x1 - x0) / 3.2)), bay = (x1 - x0) / n;
  for (let i = 0; i < n; i++) part(b, 'rail_bay', x0 + bay * (i + 0.5), y, z, 0, bay / 2);
  b.box(x1, y, z, 0.24, 1.2, 0.24, { col: MARBLE, kind: K.STONE });
}

function karst(b, r, x, z, h, R) {
  b.cyl(x, -10, z, R, R * 0.35, h, 7, { col: pick(r, [0x7e8a94, 0x8a8a9a, 0x7a8896]), kind: K.ROCK, var: r(), a0: r() * 6 });
  b.cyl(x, h * 0.55, z, R * 0.72, R * 0.4, h * 0.5, 7, { col: 0x748a86, kind: K.ROCK, var: r(), a0: r() * 6 });
  foliage(b, x, h - 14, z, R * 0.45, 0.5, { col: 0x5a7a5a, var: r(), cards: 3 });
}

export const cloudpalace = {
  palace,
  pagoda,
  structure(b, s, ctx) { palace(b, s, ctx); },
  pillar(b, s, ctx) { pagoda(b, s, ctx); },
  bridgeHigh(b, s, { rng: r, halfW }) { // open covered bridge: marble deck (flat underside), red posts, thick-fascia jade roof
    const L = s.d, w = s.w, y0 = s.y0, H = s.h - s.y0, top = s.h - 0.7, tile = pick(r, r() < 0.5 ? JADE : GOLDR);
    b.box(0, y0, 0, L, 0.8, w, { col: MARBLE, kind: K.STONE, faces: 'xXzZtb' });
    for (const e of [1, -1]) {
      for (let x = -L / 2 + 1; x < L / 2; x += 4) b.cyl(x, y0 + 0.8, e * (w / 2 - 0.6), 0.24, 0.22, H - 2.1, 6, { col: pick(r, RED), kind: K.PLAIN, caps: '' });
      b.box(0, top - 0.6, e * (w / 2 - 0.6), L, 0.5, 0.4, { col: TEAL, kind: K.PLAIN });
      b.box(0, top - 0.8, e * (w / 2 - 0.35), L, 0.12, 0.1, { col: GOLD, kind: K.PLAIN });
      rail(b, -Math.min(L / 2, halfW + 4), Math.min(L / 2, halfW + 4), y0 + 0.8, e * (w / 2 - 0.2));
      part(b, 'eave', 0, top, e * (w / 2 - 0.6), yawTo(0, e), L, 1, 1, tile);
      for (let x = -halfW + 4; x < halfW - 3; x += 12) part(b, 'dougong', x, top - 0.3, e * (w / 2 - 0.6), yawTo(0, e));
    }
    b.box(0, top - 0.5, 0, L, 0.5, w - 1.2, { col: TEAL, kind: K.PLAIN });
    b.gableRoof(0, top - 0.1, 0, L, w - 1.4, 1.5, 0.3, { col: tile, kind: K.TILE, gableCol: 0xa82418 });
    for (const e of [1, -1]) part(b, 'ridge_end', e * (L / 2), top + 1.3, 0, e > 0 ? 0 : Math.PI, 1.1, 1.1, 1.1);
  },
  bridgeLow(b, s, { halfW }) { // marble arch bridge with carved balustrades
    const L = s.d, w = s.w;
    b.box(0, s.y0, 0, L, s.h - s.y0, w, { col: MARBLE, kind: K.STONE, faces: 'xXzZtb' });
    b.arch(0, s.y0 - L * 0.12, 0, L * 0.5, 1.4, w * 0.9, 12, { col: 0xe6dccb, kind: K.STONE, rise: 0.4 });
    for (const e of [1, -1]) rail(b, -Math.min(L / 2, halfW + 4), Math.min(L / 2, halfW + 4), s.h, e * (w / 2 - 0.25));
  },
  gate(b, s, ctx) { cloudpalace.grandGate(b, s, ctx); },
  grandGate(b, s, { rng: r, glow: g }) { // white stone gatehouse: solid lintel above the flight opening, red gate tower above it
    const low = s.tiers[1], top = s.tiers[0], L = s.d, w = s.w, hh = (top.y1 - top.y0) * 0.45, y1 = top.y0 + hh;
    b.box(0, 0, 0, L, low.y1, w, { col: pick(r, STONE), kind: K.STONE, var: r() });
    b.box(0, low.y1 - 1, 0, L + 0.6, 1, w + 0.6, { col: MARBLE, kind: K.STONE });
    b.box(0, top.y0, 0, L, hh, w, { col: pick(r, STONE), kind: K.STONE, var: r(), faces: 'xXzZtb' });
    for (const e of [1, -1]) { // painted lintel band + relief panel on each route face (nothing below the lintel)
      b.box(0, y1 - 1.1, e * (w / 2 + 0.2), L + 0.4, 1.1, 0.4, { col: MARBLE, kind: K.STONE });
      b.box(0, y1 - 1.45, e * (w / 2 + 0.1), L + 0.2, 0.35, 0.2, { col: GOLD, kind: K.PLAIN });
      // Raised stone molding sits on the lintel face, above its flat Anchor mounting surface.
      b.arch(0, top.y0 + 0.25, e * (w / 2 + 0.09), L * 0.74, 0.62, 0.24, 12,
        { col: 0xe2d2b7, kind: K.STONE, rise: 0.19 });
      if (hh > 8) {
        const size = Math.min(0.9, (hh - 4) / 4);
        for (const side of [-1, 1]) part(b, 'relief', side * L * 0.30, top.y0 + hh * 0.43,
          e * (w / 2), yawTo(0, e), size, size, size);
      }
    }
    gateStorey(b, g, y1, top.y1 - 1.8, L * 0.78, w * 0.9, r, pick(r, GOLDR));
  },
  obstacle(b, s, { rng: r, glow: g }) { // a pavilion hall carried across the canyon (flat underside)
    b.box(0, s.y0, 0, s.d, 2, s.w, { col: MARBLE, kind: K.STONE, faces: 'xXzZtb' });
    gateStorey(b, g, s.y0 + 2, s.h - 2.6, s.d, s.w, r, pick(r, JADE));
  },
  startPlatform(b, s, ctx) { cloudpalace.bridgeLow(b, s, ctx); },
  closure(b, s, ctx) { palace(b, { ...s, side: 1, tiers: [{ y0: 0, y1: s.h, w: s.w, d: s.d, du: 0, dv: 0 }] }, ctx); },
  landmarkTower(b, s, ctx) { pagoda(b, s, ctx); },
  backdrop(b, g, { rng: r }) {
    for (let i = 0; i < 60; i++) { // karst peaks rising from the cloud sea, all around
      const a = (i / 60) * Math.PI * 2 + rr(r, -0.04, 0.04), d = rr(r, 380, 860), h = rr(r, 90, 230), R = rr(r, 26, 60);
      karst(b, r, Math.sin(a) * d, -Math.cos(a) * d, h, R);
      if (r() < 0.2) { const x = Math.sin(a) * d, z = -Math.cos(a) * d; b.box(x, h - 10, z, 12, 8, 12, { col: 0xb02a20, kind: K.LATTICE }); tiledRoof(b, x, h - 2, z, 12, 12, 4, 3, 1.5, pick(r, GOLDR)); }
    }
    // the golden cloud palace on its mountain ahead: stepped marble terraces, red halls, glazed roofs, gold crown
    b.pushTRS(0, 0, -600);
    b.cyl(0, -20, 0, 170, 60, 150, 10, { col: 0x9a98a8, kind: K.ROCK });
    b.cyl(0, 120, 0, 120, 100, 6, 10, { col: MARBLE, kind: K.STONE });
    for (let k = 0; k < 5; k++) {
      const y = 126 + k * 24, w = 150 - k * 26, d = w * 0.62, top = k >= 3;
      b.box(0, y, 0, w, 14, d, { col: MARBLE, kind: K.STONE }); b.box(0, y + 14, 0, w * 0.82, 8, d * 0.72, { col: 0xb02a20, kind: K.LATTICE });
      tiledRoof(b, 0, y + 22.5, 0, w * 0.82, d * 0.72, k === 4 ? 12 : 7, 6, 3, top ? GOLD : pick(r, JADE), { ends: false });
    }
    for (const sx of [-1, 1]) { // flanking gold pavilions + waterfalls
      for (let k = 0; k < 2; k++) { const w = 34 - k * 8, y = 126 + k * 22; b.box(sx * 92, y, 6, w, 14, w * 0.7, { col: 0xb02a20, kind: K.LATTICE }); tiledRoof(b, sx * 92, y + 14.5, 6, w, w * 0.7, 6, 4, 2.6, GOLD); }
      g.quad([sx * 40 - 5, 20, 40], [sx * 40 + 5, 20, 40], [sx * 40 + 5, 120, 40], [sx * 40 - 5, 120, 40], 0xd8e8f0, 2, 0, [0, 0, 1, 1]);
    }
    b.cyl(0, 256.25, 0, 2.5, 0.2, 18, 6, { col: GOLD, kind: K.METAL });
    b.pop();
  },
};
