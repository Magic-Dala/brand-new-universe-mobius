// Moonlit Japanese City / 月影和風城 (approved v2: the dense, TALL architectural canyon) — multi-storey timber
// towers with glowing shoji walls and curved dark-tile eaves every two storeys, wooden brackets and paper lanterns at
// chase height, white-plaster castle towers with chidori gables, covered timber skybridges, cherry blossoms, a canal far
// below with stone walkways, and the castle keep on its hill ahead.
// The eaves, corners, brackets, lanterns, gables, ridge ends and rails are Blender parts (tools/blender/
// build_moonlit_kit.py) appended into the streamed module batches. Rich detail (upturned corners, brackets, lanterns)
// goes on the one eave level per corridor face nearest the chase line; the other levels and the outer row repeat the
// cheap stretched eave run. Every eave keeps the swing-anchor devices clear (see eaveY).
import * as THREE from 'three';
import { foliage } from '../../art/treeFoliage.js';
import { K, pick, rr, inward, faceX, lantern, mulC } from './common.js';
import { MOONLIT_PARTS, MOONLIT_SLOTS } from '../art/moonlitKit.js';
import { toWorld, frameAt, pathY } from '../route.js';

const WOOD = [0x6a4028, 0x74462a, 0x5e3822, 0x7a4c2e];
const TILE = [0x232a3c, 0x283044, 0x1f2535];
const PLASTER = 0xe8e4da, STONE = 0x5a5c66, BLOSSOM = [0xffc4dc, 0xffb4d2, 0xffd2e4, 0xffa8cc], GOLD = 0xd8a840, BANNER = 0x2a2a6a;
const STOREY = 3.5, EAVE_D = 1.68; // storey height; eave projection of the Blender run (m)

// Blender parts: material slot → colour / surface kind.
const SLOT = {
  tile: { col: 0x262d40, kind: K.TILE }, ridge: { col: 0x161a24, kind: K.PLAIN }, wood: { col: 0x6a4028, kind: K.WOOD },
  darkwood: { col: 0x2e1c12, kind: K.WOOD }, plaster: { col: PLASTER, kind: K.PLAIN }, paper: { col: 0xffa850, kind: K.EMIS },
  rib: { col: 0x7a3c16, kind: K.EMIS }, lacquer: { col: 0x1a1210, kind: K.PLAIN }, gold: { col: GOLD, kind: K.PLAIN },
};
const SLOT_LOOK = MOONLIT_SLOTS.map((n) => ({ ...SLOT[n], col: new THREE.Color(SLOT[n].col) }));
/** Append Blender part `name` at (x, y, z) with yaw and per-axis scale; uv = planar metres along the dominant normal. */
function part(b, name, x, y, z, yaw = 0, sx = 1, sy = 1, sz = 1) {
  const P = MOONLIT_PARTS[name], base = b.vcount, n = P.s.length;
  b.pushTRS(x, y, z, yaw, sx, sy, sz);
  for (let i = 0; i < n; i++) {
    const px = P.p[i * 3] / 1000, py = P.p[i * 3 + 1] / 1000, pz = P.p[i * 3 + 2] / 1000;
    const nx = P.n[i * 3] / 127, ny = P.n[i * 3 + 1] / 127, nz = P.n[i * 3 + 2] / 127, ax = Math.abs(nx), ay = Math.abs(ny);
    const u = ax > ay && ax > Math.abs(nz) ? pz * sz : px * sx, v = ay >= ax && ay >= Math.abs(nz) ? pz * sz : py * sy;
    const L = SLOT_LOOK[P.s[i]];
    b._vert(px, py, pz, nx, ny, nz, L.col, u, v, L.kind, 0);
  }
  for (let i = 0; i < P.i.length; i += 3) b.I.push3(base + P.i[i], base + P.i[i + 1], base + P.i[i + 2]);
  b.pop();
}
/** Yaw that turns a part's +z (out of its wall) toward local direction (dx, dz). */
const yawTo = (dx, dz) => Math.atan2(dx, dz);
/** Paper lantern hanging from (x, y, z) with its warm halo in the glow batch. */
function paperLantern(b, g, x, y, z) {
  part(b, 'lantern', x, y, z);
  g.blob(x, y - 0.6, z, 1.05, 1, { col: 0x8c4c1c, kind: 3, jitter: 0 });
}
/** Timber balustrade along a line of length L centred at (x, z), running along yaw's +x, deck at y. */
function rails(b, x, y, z, yaw, L) {
  const n = Math.max(1, Math.round(L / 2.6)), bay = L / n, ax = Math.cos(yaw), az = -Math.sin(yaw);
  for (let i = 0; i < n; i++) { const o = -L / 2 + bay * (i + 0.5); part(b, 'rail_bay', x + ax * o, y, z + az * o, yaw, bay / 2); }
  b.box(x + ax * L / 2, y, z + az * L / 2, 0.13, 1.1, 0.13, { col: SLOT.darkwood.col, kind: K.WOOD }); // closing post
}
function blossom(b, x, y, z, r, R = 2.6) {
  b.cyl(x, y, z, 0.18, 0.12, 2.2, 5, { col: 0x3a2418, kind: K.BARK, caps: '' });
  for (let i = 0; i < 4; i++) foliage(b, x + rr(r, -1.6, 1.6), y + 2.6 + rr(r, -0.4, 0.8), z + rr(r, -1.6, 1.6),
    R * rr(r, 0.6, 0.9), 0.7, { col: pick(r, BLOSSOM), var: r(), variant: 'blossom', cards: 3 });
}

// =============================================================================================== anchors
/** Swing anchors on structure s in its local frame (x across the route, z along it, y up). */
function anchorsOn(m, s) {
  const out = [], [sx, sz] = toWorld(m, s.u, s.v), yaw = -frameAt(m, s.u).a, c = Math.cos(yaw), n = Math.sin(yaw);
  for (const a of m.anchors) {
    if (a.sid !== s.id) continue;
    const [ax, az] = toWorld(m, a.u, a.v), dx = ax - sx, dz = az - sz;
    out.push({ x: dx * c - dz * n, y: a.y, z: dx * n + dz * c });
  }
  return out;
}
// An anchor device is ~1.9 m in radius on the wall. An eave at y (tiles y-0.66..y, brackets / lanterns to y-1.6)
// stays fully above it (y ≥ a.y + 2.6) or below it (y ≤ a.y - 2.0).
const blocks = (y, a) => y > a.y - 2.0 && y < a.y + 2.6;
/** Eave height near y on a face with anchors `face`: unchanged, moved just clear of a device, or null (leave bare). */
function eaveY(y, face, lo, hi) {
  const hit = face.find((a) => blocks(y, a));
  if (!hit) return y;
  const options = [hit.y + 2.6, hit.y - 2.0].sort((p, q) => Math.abs(p - y) - Math.abs(q - y));
  return options.find((c) => c > lo && c < hi && !face.some((a) => blocks(c, a))) ?? null;
}
/** Is a bracket / lantern / gable spanning y-down..y+up around z clear of every device on the face? */
const clearAt = (face, z, y, down, up, half = 2.2) => !face.some((a) => Math.abs(a.z - z) < half && a.y > y - down - 1.9 && a.y < y + up + 1.9);

// =============================================================================================== eaves
/** Eave heights on tier t: two storeys apart (three on the outer row), starting above any lower tier / terrace. */
function levels(s, t) {
  const lower = s.tiers.filter((o) => o !== t && o.y1 < t.y1 && o.y0 <= t.y0);
  const start = Math.max(7, t.y0, ...lower.map((o) => o.y1 + 4)), step = s.role === 'inner' ? 2 * STOREY : 3 * STOREY;
  const out = [];
  for (let y = Math.ceil((start + 3) / STOREY) * STOREY; y < t.y1 - 2; y += step) out.push(y);
  return out;
}
/**
 * What abuts the end of s toward local ±z (e = +1: back along the route), also across the module boundary: the highest
 * row neighbour there (it hides that end's eaves below its top) and the neighbours' anchors within reach of that end.
 */
function endInfo(ctx, s, e) {
  const { m, world } = ctx, edge = s.u - e * (s.uw ?? s.w) / 2, out = { top: 0, anchors: [] };
  const mods = [[m, 0]], adj = world?.route.modules.find((x) => x.idx === m.idx - e);
  if (adj) mods.push([adj, e > 0 ? -adj.L : m.L]); // (u offset of the adjacent module in this module's frame)
  for (const [mm, du] of mods) {
    for (const n of mm.structures) {
      if (n === s || n.side !== s.side || n.role !== s.role || !n.tiers) continue;
      if (Math.abs(n.u + du + e * (n.uw ?? n.w) / 2 - edge) < 3.5) out.top = Math.max(out.top, ...n.tiers.map((o) => o.y1));
    }
    for (const a of mm.anchors) if (a.sid !== s.id && a.side === s.side && Math.abs(a.u + du - edge) < 3.5) out.anchors.push(a);
  }
  return out;
}
/**
 * One eave level around tier t: curved runs on the corridor face and on both ends (the back is never seen from the
 * canyon). An end stays bare where a neighbour hides it or a neighbour's anchor device is within reach. rich: upturned
 * corners instead of straight-cut capped run ends, wooden brackets and a lantern. face: draw the corridor run.
 */
function eaveLevel(b, g, s, t, y, { face = true, rich = false, anchors = [], ends = [], r }) {
  const dir = inward(s), fx = faceX(s, t), z = -t.du, half = t.w / 2;
  const open = [1, -1].map((e, i) => !ends[i]?.anchors.some((a) => blocks(y, a)));
  [1, -1].forEach((e, i) => { if (open[i] && y > (ends[i]?.top ?? 0) + 0.5) part(b, 'eave', t.dv, y, z + e * half, e > 0 ? 0 : Math.PI, t.d); });
  if (!face) return;
  if (!rich || !open[0] || !open[1]) { // straight run, carried over the open corners, capped
    const len = t.w + EAVE_D * (open[0] + open[1]), zc = z + (open[0] - open[1]) * EAVE_D / 2;
    part(b, 'eave', fx, y, zc, yawTo(dir, 0), len);
    part(b, 'eave_caps', fx, y, zc, yawTo(dir, 0), len);
    return;
  }
  part(b, 'eave', fx, y, z, yawTo(dir, 0), t.w);
  for (const e of [1, -1]) part(b, 'eave_corner', fx, y, z + e * half, yawTo(dir, e) - Math.PI / 4);
  const n = Math.min(3, Math.floor(t.w / 4)), step = t.w / n;
  for (let i = 0; i < n; i++) {
    const zb = z - half + step * (i + 0.5);
    if (clearAt(anchors, zb, y, 1.4, 0)) part(b, 'bracket', fx, y, zb, yawTo(dir, 0));
  }
  const zl = z - half + step * (r() < 0.5 ? 1 : n - 1); // between two brackets
  if (n > 1 && r() < 0.75 && clearAt(anchors, zl, y, 1.7, 0)) paperLantern(b, g, fx + dir * 1.15, y - 0.58, zl);
}
/** All eave levels of tier t. Returns the rich level's height (or null, for the balcony) and the face's anchors. */
function eaves(b, g, s, t, ctx, { gable = false } = {}) {
  const { m, rng: r } = ctx, near = s.role === 'inner', fx = faceX(s, t);
  const anchors = anchorsOn(m, s).filter((a) => Math.abs(a.x - fx) < 1.5 && a.y > t.y0 && a.y < t.y1 + 2);
  const ys = levels(s, t), target = pathY(m, s.u) + 4;
  const ends = [endInfo(ctx, s, 1), endInfo(ctx, s, -1)];
  let richY = null;
  if (near) for (const y of ys) if (Math.abs(y - target) < 9 && (richY == null || Math.abs(y - target) < Math.abs(richY - target))) richY = y;
  ys.forEach((y0, i) => {
    const y = eaveY(y0, anchors, (ys[i - 1] ?? t.y0) + 2.5, t.y1 - 1.2);
    eaveLevel(b, g, s, t, y ?? y0, { face: y != null, rich: y0 === richY && y != null, anchors, ends, r });
    if (gable && y != null && (y0 === richY || i === ys.length - 1)) chidori(b, s, t, y, anchors);
    if (y0 === richY && y == null) richY = null;
  });
  return { richY, anchors };
}
/** A chidori gable sitting on the corridor-face eave (castle and plaster towers). */
function chidori(b, s, t, y, anchors) {
  const k = Math.min(2.4, t.w / 5), dir = inward(s), z = -t.du;
  if (clearAt(anchors, z, y, 0.6, 0.9 * k, 1.2 * k + 1.9)) part(b, 'gable', faceX(s, t) + dir * 0.85, y - 0.42, z, yawTo(dir, 0), k, k, k);
}
/** Close the curled roof edge with a timber fascia and a continuous underside above the wall. */
function tiledRoof(b, x, y, z, depth, width, rise, over, curl, tile, ridge) {
  b.hipRoof(x, y, z, depth, width, rise, over, curl, {
    col: tile, kind: K.TILE, ridge, ridgeKind: K.PLAIN, under: false,
  });
  const dx = depth / 2 + over, dz = width / 2 + over, lower = y - 0.16;
  const fascia = SLOT.darkwood.col;
  const corners = [[x - dx, z + dz], [x + dx, z + dz], [x + dx, z - dz], [x - dx, z - dz]];
  for (let i = 0; i < corners.length; i++) {
    const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % corners.length];
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    b.quad([ax, lower, az], [mx, lower, mz], [mx, y, mz], [ax, y + curl, az], fascia, K.WOOD);
    b.quad([mx, lower, mz], [bx, lower, bz], [bx, y + curl, bz], [mx, y, mz], fascia, K.WOOD);
  }
  b.quad([x - dx, lower, z - dz], [x + dx, lower, z - dz],
    [x + dx, lower, z + dz], [x - dx, lower, z + dz], fascia, K.WOOD);
}

/** Hip roof on the top tier with ridge-end ornaments; a shallow overhang where a device sits just under the roof line. */
function roofTop(b, t, tile, anchors, near) {
  const tight = anchors.some((a) => a.y > t.y1 - 3.4), over = tight ? 0.5 : 1.4;
  const rise = 3 + Math.min(t.d, t.w) * 0.18;
  tiledRoof(b, t.dv, t.y1, -t.du, t.d, t.w, rise, over, 0.7, tile, 0x161a24);
  if (!near || t.d < t.w + 1) return; // (a pyramid roof has no ridge to finish)
  const rl = (t.d - t.w) / 2 * 0.9 + 0.3, k = Math.min(2.2, Math.max(1.2, t.w / 7));
  for (const e of [1, -1]) part(b, 'ridge_end', t.dv + e * rl, t.y1 + rise - 0.12, -t.du, e > 0 ? 0 : Math.PI, k, k, k);
}

// =============================================================================================== towers
/** Balcony one storey under the rich eave: plank deck, timber rails, sometimes a blossom tree. */
function balcony(b, s, t, y, anchors, wood, r) {
  const dir = inward(s), fx = faceX(s, t), z = -t.du + rr(r, -t.w / 5, t.w / 5), L = Math.min(t.w - 2, rr(r, 5, 8));
  if (anchors.some((a) => Math.abs(a.z - z) < L / 2 + 2 && a.y > y - 2.2 && a.y < y + 3.2)) return;
  b.box(fx + dir * 0.7, y - 0.2, z, 1.4, 0.2, L, { col: mulC(wood, 1.1), kind: K.WOOD, faces: 'xXzZtb' });
  rails(b, fx + dir * 1.32, y, z, Math.PI / 2, L);
  const zt = z + (L / 2 - 1) * (r() < 0.5 ? -1 : 1); // the canopy spreads ~3.2 m and reaches 5 m above the deck
  if (r() < 0.7 && clearAt(anchors, zt, y, 0, 5.2, 3.6)) blossom(b, fx + dir * 0.7, y, zt, r, 1.8);
}
function windows(b, s, t, y, r) { // castle / plaster: small dark windows (some lit) one storey under each eave
  const dir = inward(s), fx = faceX(s, t) + dir * 0.03, faces = dir < 0 ? 'x' : 'X';
  for (const z of [-t.w / 3, 0, t.w / 3]) b.box(fx, y - STOREY + 0.9, -t.du + z, 0.04, 1.2, 1.1, { col: r() < 0.55 ? 0xffb060 : 0x1a1410, kind: K.EMIS, faces });
}
function tower(b, s, ctx, style) {
  const { rng: r, glow: g } = ctx, wood = pick(r, WOOD), tile = pick(r, TILE), near = s.role === 'inner';
  const t0 = s.tiers[0], castle = style === 'castle', baseH = castle ? Math.min(14, t0.y1 * 0.25) : 7;
  // stone base at canal level (the castle's is a battered wall), then the storeys on the exact collision tiers
  b.frustum(t0.dv, 0, -t0.du, t0.d + (castle ? 2.4 : 1.2), t0.w + (castle ? 2.4 : 1.2), baseH, t0.d, t0.w, { col: STONE, kind: K.STONE, var: r() });
  let all = [];
  for (const t of s.tiers) {
    const y0 = Math.max(t.y0, baseH);
    const body = style === 'timber' ? { col: wood, kind: K.SHOJI } : { col: PLASTER, kind: K.PLASTER };
    b.box(t.dv, y0, -t.du, t.d, t.y1 - y0, t.w, { ...body, var: r(), top: { col: tile, kind: K.TILE } });
    const { richY, anchors } = eaves(b, g, s, t, ctx, { gable: style !== 'timber' && near });
    all = all.concat(anchors);
    if (style !== 'timber') for (const y of levels(s, t)) windows(b, s, t, y, r);
    else if (near && richY != null && r() < 0.5) balcony(b, s, t, richY - STOREY, anchors, wood, r);
    if (style === 'timber' && near && r() < 0.3) { // banner on the corridor face
      const dir = inward(s), fx = faceX(s, t), z = -t.du + rr(r, -t.w / 3, t.w / 3), y = rr(r, y0 + 6, Math.max(y0 + 7, t.y1 - 10));
      const faces = dir < 0 ? 'x' : 'X';
      if (clearAt(anchors, z, y, 0, 5, 2.6)) { b.box(fx + dir * 0.08, y, z, 0.05, 5, 1.4, { col: BANNER, kind: K.PLAIN, faces }); b.box(fx + dir * 0.11, y + 2.6, z, 0.04, 0.9, 0.9, { col: 0xf0e8f0, kind: K.PLAIN, faces }); }
    }
  }
  roofTop(b, s.tiers.at(-1), tile, all, near);
  if (s.isPlatform) { // the landing terrace: rails on its corridor edge, a blossom tree at the back corner
    const f = s.tiers[0], dir = inward(s), fx = faceX(s, f);
    rails(b, fx - dir * 0.15, f.y1, -f.du, Math.PI / 2, f.w - 0.6);
    blossom(b, fx - dir * (f.d - 1.6), f.y1, -f.du + (f.w / 2 - 1.6) * (r() < 0.5 ? -1 : 1), r);
  }
}

/** Castle keep: stacked white storeys with full eave rings, chidori gables, gold ridge ends (landmark + backdrop). */
function keep(b, g, cx, cz, y0, size, tiers, r, { tile = pick(r, TILE), rich = true } = {}) {
  let y = y0, sz = size;
  for (let i = 0; i < tiers; i++) {
    const h = sz * 0.42 + 2, k = Math.min(3.2, sz / 8), top = y + h;
    b.box(cx, y, cz, sz, h, sz, { col: PLASTER, kind: K.PLASTER, var: r(), top: { col: tile, kind: K.TILE } });
    for (const f of [-1, 1]) { // lit window bands (all four faces on the hero keeps)
      b.box(cx, y + h * 0.45, cz + f * (sz / 2 + 0.03), sz * 0.6, 0.8, 0.05, { col: 0xffb060, kind: K.EMIS, faces: f > 0 ? 'Z' : 'z' });
      if (rich) b.box(cx + f * (sz / 2 + 0.03), y + h * 0.45, cz, 0.05, 0.8, sz * 0.6, { col: 0xffb060, kind: K.EMIS, faces: f > 0 ? 'X' : 'x' });
    }
    if (!rich || i === tiers - 1) {
      b.hipRoof(cx, top, cz, sz, sz, sz * 0.28, sz * 0.18 + 0.8, sz * 0.06 + 0.3, { col: tile, kind: K.TILE, ridge: GOLD, ridgeKind: K.PLAIN });
      if (rich) for (const e of [1, -1]) part(b, 'ridge_end', cx + e * 0.4, top + sz * 0.28 - 0.1, cz, e > 0 ? 0 : Math.PI, k * 0.8, k * 0.8, k * 0.8);
    } else {
      for (const [ex, ez] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) part(b, 'eave', cx + ex * sz / 2, top, cz + ez * sz / 2, yawTo(ex, ez), sz, k, k);
      for (const [qx, qz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) part(b, 'eave_corner', cx + qx * sz / 2, top, cz + qz * sz / 2, yawTo(qx, qz) - Math.PI / 4, k, k, k);
      const gf = i % 2 ? [1, 0] : [0, 1]; // chidori gables alternate between the two face pairs
      for (const e of [1, -1]) part(b, 'gable', cx + e * gf[0] * (sz / 2 + 0.85 * k), top - 0.42 * k, cz + e * gf[1] * (sz / 2 + 0.85 * k), yawTo(e * gf[0], e * gf[1]), k * 1.4, k * 1.4, k * 1.4);
    }
    y = top + (rich && i < tiers - 1 ? 0 : sz * 0.16); sz *= 0.78;
  }
  b.cyl(cx, y, cz, 0.35, 0.1, sz * 0.9 + 2, 6, { col: GOLD, kind: K.METAL });
  if (rich) for (const [ex, ez] of [[1, 1], [-1, -1]]) g.blob(cx + ex * size * 0.5, y0 + size * 0.3, cz + ez * size * 0.5, size * 0.25, 0.8, { col: 0x5a3414, kind: 3, jitter: 0 });
  return y;
}

export const moonlit = {
  timber(b, s, ctx) { tower(b, s, ctx, 'timber'); },
  plaster(b, s, ctx) { tower(b, s, ctx, 'plaster'); },
  castle(b, s, ctx) { tower(b, s, ctx, 'castle'); },
  structure(b, s, ctx) { moonlit.timber(b, s, ctx); },
  pillar(b, s, ctx) { moonlit.castle(b, s, ctx); },
  bridgeHigh(b, s, { rng: r, glow: g, halfW }) { // covered timber corridor: shoji walls, curved eaves on brackets, a veranda rail
    const L = s.d, w = s.w, y0 = s.y0, top = s.h - 1.1, wall = w * 0.42, tile = pick(r, TILE);
    // flat deck underside: the two swing anchors hang 0.45 m under it at ±halfW / 2, nothing else comes near them
    b.box(0, y0, 0, L, 0.6, w, { col: 0x3a2418, kind: K.WOOD, faces: 'xXzZtb' });
    for (const e of [1, -1]) b.box(0, y0 - 0.3, e * (w / 2 - 0.35), L, 0.3, 0.3, { col: 0x24160e, kind: K.WOOD, faces: 'zZb' });
    b.box(0, y0 + 0.6, 0, L, top - y0 - 0.6, wall * 2, { col: 0x4a2e1e, kind: K.SHOJI, var: r(), faces: 'zZ' });
    b.gableRoof(0, top, 0, L, wall * 2, 1.4, 0, { col: tile, kind: K.TILE, gableCol: 0x2e1c12 });
    const n = Math.max(2, Math.round((2 * halfW) / 4.2)), step = (2 * halfW) / n;
    for (const e of [1, -1]) {
      part(b, 'eave', 0, top, e * wall, e > 0 ? 0 : Math.PI, L);
      rails(b, 0, y0 + 0.6, e * (w / 2 - 0.12), 0, 2 * halfW + 4);
      for (let i = 0; i <= n; i++) { // wall posts with a bracket under the eave
        const x = -halfW + step * i;
        b.box(x, y0 + 0.6, e * (wall + 0.06), 0.24, top - y0 - 0.6, 0.12, { col: 0x2e1c12, kind: K.WOOD, faces: e > 0 ? 'xXZ' : 'xXz' });
        if (i > 0 && i < n) part(b, 'bracket', x, top, e * (wall + 0.12), e > 0 ? 0 : Math.PI);
      }
    }
    for (const [x, e] of [[-halfW + 2.5, 1], [0, -1], [halfW - 2.5, 1]]) paperLantern(b, g, x, y0, e * (w / 2 - 1.0));
  },
  bridgeLow(b, s, { rng: r, glow: g, halfW }) { // open timber walkway: plank deck (the landing surface), rails on both edges
    const L = s.d, w = s.w;
    b.box(0, s.y0, 0, L, s.h - s.y0, w, { col: 0x4a2e1e, kind: K.WOOD, faces: 'xXzZtb', top: { col: 0x5a3a24, kind: K.WOOD } });
    for (const e of [1, -1]) rails(b, 0, s.h, e * (w / 2 - 0.15), 0, Math.min(L, 2 * halfW + 6));
    for (const x of [-halfW * 0.55, halfW * 0.55]) paperLantern(b, g, x, s.y0, 0);
    void r;
  },
  obstacle(b, s, ctx) { // a two-storey corridor building spanning the canyon
    const { rng: r, glow: g, halfW } = ctx, tile = pick(r, TILE), y = s.y0 + (s.h - s.y0) * 0.5;
    b.box(0, s.y0, 0, s.d, s.h - s.y0, s.w, { col: 0x4a2e1e, kind: K.SHOJI, var: r(), faces: 'xXzZtb', top: { col: tile, kind: K.TILE } });
    for (const e of [1, -1]) {
      part(b, 'eave', 0, y, e * s.w / 2, e > 0 ? 0 : Math.PI, s.d);
      for (const x of [-halfW * 0.5, halfW * 0.5]) part(b, 'bracket', x, y, e * s.w / 2, e > 0 ? 0 : Math.PI);
    }
    b.box(0, s.y0 - 0.4, 0, s.d, 0.4, s.w + 1, { col: 0x2a1a10, kind: K.WOOD, faces: 'xXzZb' });
    for (let x = -halfW + 3; x < halfW; x += 5) paperLantern(b, g, x, s.y0 - 0.4, rr(r, -2, 2));
  },
  startPlatform(b, s, ctx) { moonlit.bridgeLow(b, s, ctx); },
  closure(b, s, ctx) { // the wall across the canyon behind the start: plain shoji storeys and eaves
    const { rng: r, glow: g } = ctx, t = { dv: 0, du: 0, d: s.d, w: s.w, y0: 7, y1: s.h }, c = { ...s, side: 1, role: 'closure', tiers: [t] };
    b.box(0, 0, 0, s.d, s.h, s.w, { col: pick(r, WOOD), kind: K.SHOJI, var: r(), top: { col: pick(r, TILE), kind: K.TILE } });
    for (const y of levels(c, t)) eaveLevel(b, g, c, t, y, { r });
  },
  landmarkTower(b, s, { rng: r, glow: g }) { // the castle keep beside the canyon
    const t = s.tiers[0];
    b.frustum(t.dv, 0, 0, t.d, t.w, t.y1 * 0.35, t.d * 0.82, t.w * 0.82, { col: STONE, kind: K.STONE, var: r() });
    keep(b, g, t.dv, 0, t.y1 * 0.35, Math.min(t.d, t.w) * 0.8, 5, r);
  },
  moduleDecor(b, ctx) { // canal walkways, lanterns, a red arched footbridge far below, blossom trees at the water
    const { m, rng: r, local, glow: g, halfW } = ctx;
    for (const side of [-1, 1]) for (let k = 0; k < Math.ceil(m.L / 8); k++) {
      const u0 = (m.L * k) / Math.ceil(m.L / 8), u1 = (m.L * (k + 1)) / Math.ceil(m.L / 8), [x0, z0] = local((u0 + u1) / 2, side * (halfW - 1.8));
      b.box(x0, 0, z0, 3.6, 1.4, u1 - u0 + 0.1, { col: 0x4a4c56, kind: K.STONE });
    }
    for (let u = 6; u < m.L; u += 12) for (const side of [-1, 1]) { const [x, z] = local(u, side * (halfW - 2.6)); b.cyl(x, 1.4, z, 0.12, 0.12, 2.4, 5, { col: 0x2a1a10, kind: K.WOOD, caps: '' }); lantern(b, g, x, 4.2, z, { col: 0xffa850, r: 0.3 }); }
    if (r() < 0.5) { const u = rr(r, 15, m.L - 15), [x, z] = local(u, 0); b.pushTRS(x, 0, z, -0); b.arch(0, -2, 0, halfW * 1.6, 0.8, 3, 10, { col: 0xb02a22, kind: K.PLAIN, rise: 0.35 }); b.pop(); }
    for (let u = rr(r, 4, 14); u < m.L; u += rr(r, 14, 24)) { const side = r() < 0.5 ? -1 : 1, [x, z] = local(u, side * (halfW - 2)); blossom(b, x, 1.4, z, r, 2.4); }
  },
  backdrop(b, g, { rng: r }) {
    for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2, d = 980; b.blob(Math.sin(a) * d, -60, -Math.cos(a) * d, rr(r, 180, 300), 0.5, { col: 0x1e2244, kind: K.PLAIN }); }
    // the surrounding city: stacked timber / plaster towers with tile roofs on every tier, a few pagodas
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2 + rr(r, -0.02, 0.02), d = rr(r, 380, 760), x = Math.sin(a) * d, z = -Math.cos(a) * d;
      if (r() < 0.22) { keep(b, g, x, z, 0, rr(r, 14, 22), Math.floor(rr(r, 3, 6)), r, { rich: false }); continue; }
      const plaster = r() < 0.35, tile = pick(r, TILE);
      let y = 0, w = rr(r, 16, 28);
      for (let k = 0, n = Math.floor(rr(r, 2, 4)); k < n; k++) {
        const h = rr(r, 14, 30);
        b.box(x, y, z, w, h, w, plaster ? { col: PLASTER, kind: K.PLASTER, var: r() } : { col: 0x4a2e1e, kind: K.SHOJI, var: r() });
        b.hipRoof(x, y + h, z, w, w, k === n - 1 ? 4 + w * 0.12 : 1.2, 2, 0.8, { col: tile, kind: K.TILE });
        y += h + (k === n - 1 ? 0 : 1); w *= 0.8;
      }
    }
    // the castle on its hill ahead
    b.pushTRS(-30, 0, -560);
    b.frustum(0, 0, 0, 280, 210, 86, 130, 96, { col: 0x2a2c40, kind: K.STONE });
    b.frustum(0, 86, 0, 90, 80, 28, 74, 66, { col: STONE, kind: K.STONE });
    keep(b, g, 0, 0, 114, 60, 5, r);
    for (const sx of [-74, 74]) keep(b, g, sx, 20, 86, 26, 3, r);
    b.pop();
  },
};
