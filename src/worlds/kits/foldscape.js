import { foliage } from '../../art/treeFoliage.js';
import { drawFoldOverhead } from '../art/foldscapeOverhead.js';
import { createFoldscapeSkyCards } from '../art/foldscapeSkyCards.js';
// Foldscape City / 折境都市 (v0.41 art upgrade) — golden-hour New York: red / dark brick walk-ups with fire escapes
// and rooftop water tanks, limestone towers with setbacks and tiered crowns, dark blue / charcoal glass towers; a wide
// avenue with trees and lamps; far ahead the whole city folds up into the sky (backdrop).
//
// Asset split (see src/worlds/art/foldscapeArt.js): THIS file draws the masses inside the route's collision tiers with
// facades on a 3.0 × 3.3 m bay grid (windows painted by the FOLDSCAPE shader branch exactly where the Blender bays
// go), roofs, street furniture and the far city; it then PLACES Blender kit pieces (ctx.extras.add) on that grid —
// window surrounds, storefronts, quoins, belts, cornices, parapets, fire escapes, water tanks, roof units, crowns.
// Without the kit (quality 'off' / load failure) the old procedural roof props are drawn instead.
//
// Gameplay clearance: no piece within ANCHOR_PAD of a swing anchor on the same face (bays, quoins, belts, cornice
// segments, fire-escape columns); facade pieces stay ≤ 0.24 m proud of the collision face except cornices (0.92 m, only
// at the roof line, cleared around anchors) and fire escapes (1.25 m, open lattice, never in an anchor's column — no
// collision proxy: they are inside the 14 m corridor half-width, below the anchor heights' visual line and see-through;
// documented in docs/goals/foldscape-art-upgrade.md). Nothing is placed on recovery terraces (landing surfaces).
import { K, pick, rr, inward, faceX, band, railing, lantern } from './common.js';
import { FoldscapeDetail, FK, FOLDSCAPE_ART, tierFaces, bayGrid, floorRange, faceRect, faceMatrix, roofMatrix, anchorsLocal, onFace } from '../art/foldscapeArt.js';
import * as THREE from 'three';

const BRICK = [0x8a3c2c, 0x9c4a34, 0x7a3428, 0xa65a40, 0x6e3226, 0x5e2e24, 0x8e4a36];
const STONE = [0xe2cba0, 0xd6bc8e, 0xe8d4ac, 0xcfb488];
const GLASS = [0x3a4a62, 0x2e3a4e, 0x464e5c, 0x34445a];
const METAL = 0x26282c, TRIM = 0xe6d8bc;
// anchor device extent on the wall around its point (instance scale 1.35): up = mount disc 0.74 → 1.0 m (the two upper
// arm tips reach 0.97 m); sideways = upper arm tips 1.67 m
const G = FOLDSCAPE_ART.grid, ANCHOR_PAD = 1.1, DEVICE = { up: 1.0, half: 1.7 };
export const FOLDSCAPE_DEVICE = DEVICE;
const _M = new THREE.Matrix4();

// ------------------------------------------------------------------------------------------- facade assembly
/**
 * Draw tier t as a box whose faces carry the bay grid. st: { win, plain, col, vr, glass }. Returns, per face key,
 * { F, grid, floors, base, fh, bw } for the placement pass.
 */
function massTier(b, s, t, st) {
  const F = tierFaces(t), out = {}, back = inward(s) < 0 ? 'X' : 'x';
  const bw = st.glass ? G.glassBay : G.bay, fh = st.glass ? G.glassFloor : G.floor, base = st.glass ? G.glassBase : G.base;
  for (const key of ['x', 'X', 'z', 'Z']) {
    const f = F[key], W = f.W, h0 = t.y0, h1 = t.y1;
    if (key === back && s.role !== 'outer') { faceRect(b, f, -W / 2, W / 2, h0, h1, st.col, st.plain, st.vr); continue; } // (faces the outer row)
    const grid = bayGrid(W, bw), floors = floorRange(h0, h1, base, fh, st.glass ? 0.6 : 1.6);
    if (!grid.n || !floors.n) { faceRect(b, f, -W / 2, W / 2, h0, h1, st.col, st.plain, st.vr, grid.xs, 0); out[key] = { F: f, grid, floors, base, fh, bw }; continue; }
    const xa = grid.xs, xb = -grid.xs, ya = base + floors.k0 * fh, yb = base + (floors.k1 + 1) * fh;
    faceRect(b, f, xa, xb, ya, yb, st.col, st.win, st.vr, xa, base);
    faceRect(b, f, -W / 2, xa, h0, h1, st.col, st.plain, st.vr, xa, 0); faceRect(b, f, xb, W / 2, h0, h1, st.col, st.plain, st.vr, xa, 0);
    faceRect(b, f, xa, xb, h0, ya, st.col, st.plain, st.vr, xa, 0); faceRect(b, f, xa, xb, yb, h1, st.col, st.plain, st.vr, xa, 0);
    out[key] = { F: f, grid, floors, base, fh, bw };
  }
  b.box(t.dv, t.y1 - 0.02, -t.du, t.d, 0.02, t.w, { col: st.roof ?? 0x4a4440, kind: K.PLAIN, faces: 't' });
  return out;
}
/** Anchors on face F (face coordinate x, height y). */
function faceAnchors(F, A) { const out = []; for (const a of A) { const o = onFace(F, a); if (Math.abs(o.off) < 2) out.push({ x: o.x, y: a.y }); } return out; }
const clear = (FA, x0, x1, y0, y1) => !FA.some((a) => a.x > x0 - ANCHOR_PAD && a.x < x1 + ANCHOR_PAD && a.y > y0 - ANCHOR_PAD && a.y < y1 + ANCHOR_PAD);
/** Roof-line trim [y0, y1] vs the anchor device (its extent above / beside the anchor point + 0.1 m margin). */
const trimClear = (FA, x0, x1, y0, y1) => !FA.some((a) => a.x > x0 - DEVICE.half - 0.1 && a.x < x1 + DEVICE.half + 0.1 && a.y + DEVICE.up > y0 - 0.1 && a.y - 2 < y1);

/** Kit placements on one face: window bays (+ storefronts, quoins, belts) and the roof-line trim. */
function dressFace(X, s, t, info, st, FA, { bays = true, store = false, quoins = false, belts = 0, cornice = false, parapet = false }) {
  const { F, grid, floors, base, fh, bw } = info, W = F.W;
  if (bays && grid.n && floors.n) {
    for (let k = floors.k0; k <= floors.k1; k++) for (let i = 0; i < grid.n; i++) {
      const x = grid.xs + bw * (i + 0.5), y = base + k * fh;
      if (!clear(FA, x - bw / 2, x + bw / 2, y, y + fh)) continue;
      X.add(st.bay, faceMatrix(F, x, y, 1, _M), st.col);
    }
  }
  if (store && t.y0 === 0 && grid.n) for (let i = 0; i < grid.n; i++) { const x = grid.xs + bw * (i + 0.5); X.add('fs_store', faceMatrix(F, x, 0, 1, _M), st.col); }
  if (quoins && floors.n) for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - 0.31);
    for (let k = floors.k0; k <= floors.k1; k++) { const y = base + k * fh; if (clear(FA, x - 0.3, x + 0.3, y, y + fh)) X.add('fs_quoin', faceMatrix(F, x, y, 1, _M), st.col); }
  }
  if (belts && floors.n) for (let k = floors.k0 + 1; k <= floors.k1; k += belts) {
    const y = base + k * fh, n = Math.max(1, Math.round(W / 3)), sx = W / (n * 3);
    for (let i = 0; i < n; i++) { const x = -W / 2 + (i + 0.5) * 3 * sx; if (clear(FA, x - 1.5 * sx, x + 1.5 * sx, y, y + 0.4)) X.add('fs_belt', faceMatrix(F, x, y, sx, _M), st.col); }
  }
  if (cornice || parapet) {
    const n = Math.max(1, Math.round(W / 3)), sx = W / (n * 3), h = cornice ? 1.4 : 0, y = t.y1 - h;
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + (i + 0.5) * 3 * sx;
      // roof-edge anchors mount 2.5–3 m under the roof: the cornice stays above them (no notch) unless the device's
      // disc / arms (DEVICE) would reach into the trim band
      if (!trimClear(FA, x - 1.5 * sx, x + 1.5 * sx, y, t.y1 + 1.3)) continue;
      X.add(cornice ? 'fs_cornice' : 'fs_parapet', faceMatrix(F, x, y, sx, _M), st.col);
    }
  }
}
/** A fire-escape stack on the corridor face, in a two-bay column free of anchors. */
function fireEscape(X, info, FA, r) {
  const { F, grid, floors, base, fh } = info; if (grid.n < 2 || floors.n < 3) return false;
  const cols = []; for (let j = 0; j + 1 < grid.n; j++) cols.push(j);
  cols.sort(() => r() - 0.5);
  for (const j of cols) {
    const x = grid.xs + G.bay * (j + 1);
    if (FA.some((a) => Math.abs(a.x - x) < 3 + ANCHOR_PAD + 0.6)) continue;
    const k0 = Math.max(floors.k0, 1);
    for (let k = k0; k <= floors.k1; k++) X.add(k === k0 ? 'fs_fire_escape_base' : 'fs_fire_escape', faceMatrix(F, x, base + k * fh, 1, _M));
    return true;
  }
  return false;
}
/** Roof pieces (kit) or the old procedural props (fallback). */
function roofDress(b, X, s, t, r, { tank = 0.65, crown = false } = {}) {
  const y = t.y1, cx = t.dv, cz = -t.du;
  if (crown) { const sc = Math.min(t.d, t.w) / 16.4; X.add('fs_crown', roofMatrix(cx, y, cz, 0, sc, _M)); return; }
  const ix = Math.max(0, t.d / 2 - 3.6), iz = Math.max(0, t.w / 2 - 3.6);
  if (r() < tank) X.add('fs_water_tank', roofMatrix(cx + rr(r, -ix, ix), y, cz + rr(r, -iz, iz), rr(r, 0, 6.28), rr(r, 0.85, 1.12), _M));
  if (r() < 0.55) X.add('fs_bulkhead', roofMatrix(cx + rr(r, -ix, ix), y, cz + rr(r, -iz, iz), Math.floor(r() * 4) * Math.PI / 2, 1, _M));
  for (let k = 0, n = Math.floor(rr(r, 0, 3)); k < n; k++) X.add('fs_hvac', roofMatrix(cx + rr(r, -ix, ix), y, cz + rr(r, -iz, iz), Math.floor(r() * 4) * Math.PI / 2, 1, _M));
}
function waterTower(b, x, y, z, r) { // procedural fallback (no kit)
  const h = 4.2;
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(x + dx * r * 0.65, y, z + dz * r * 0.65, 0.22, 3.2, 0.22, { col: METAL, kind: K.METAL });
  b.cyl(x, y + 3.2, z, r, r, h, 12, { col: 0x6a4a34, kind: K.WOOD, caps: '' });
  b.cyl(x, y + 3.2 + h, z, r * 1.05, 0.15, 1.9, 12, { col: 0x3a3634, kind: K.TILE, caps: '' });
}
function roofPropsProc(b, t, r) {
  const y = t.y1;
  if (r() < 0.65) waterTower(b, t.dv + rr(r, -t.d * 0.25, t.d * 0.25), y, -t.du + rr(r, -t.w * 0.25, t.w * 0.25), rr(r, 1.7, 2.3));
  if (r() < 0.7) b.box(t.dv + rr(r, -2, 2), y, -t.du + rr(r, -3, 3), rr(r, 2.5, 4), rr(r, 2, 3.2), rr(r, 2.5, 4), { col: 0x8a7a6a, kind: K.PLAIN });
}
const kitOn = (ctx) => !!ctx.extras?.on;
/** Anchors around s from this module and its neighbours (route data is generated ahead: neighbours exist). */
const nearAnchors = (ctx, s) => { const M = ctx.world?.route?.modules || [], i = ctx.m.idx; return anchorsLocal(ctx.m, s, [M[i - 1], ctx.m, M[i + 1]].filter(Boolean)); };

export const foldscape = {
  decorateBackdrop(parent) { return createFoldscapeSkyCards(parent); },
  /** WorldRenderer extras: the Blender detail pools (ref-counted kit, route-space placements). */
  createExtras(wr) { return new FoldscapeDetail(wr); },
  brick(b, s, ctx) {
    const r = ctx.rng, X = ctx.extras, kit = kitOn(ctx), c = pick(r, BRICK), arch = r() < 0.38;
    const st = { col: c, vr: r(), win: arch ? FK.BRICK_ARCH : FK.BRICK_WIN, plain: FK.BRICK, bay: arch ? 'fs_bay_arch' : 'fs_bay_rect', roof: 0x4e4844 };
    const A = kit ? nearAnchors(ctx, s) : [], corr = inward(s) < 0 ? 'x' : 'X', top = s.tiers.length - 1;
    s.tiers.forEach((t, i) => {
      const faces = massTier(b, s, t, st);
      const terrace = s.isPlatform && i === 0;
      if (!kit) { band(b, t, t.y1 - 1.4, 1.4, 0.55, TRIM, K.PLAIN); if (!terrace) roofPropsProc(b, t, r); return; }
      const inner = s.role === 'inner';
      for (const key of ['x', 'X', 'z', 'Z']) {
        const info = faces[key]; if (!info) continue;
        const FA = faceAnchors(info.F, A), isCorr = key === corr;
        dressFace(X, s, t, info, st, FA, { bays: isCorr && inner, store: isCorr && inner, quoins: isCorr && inner && r() < 0.5, belts: isCorr && inner ? 6 : 0, cornice: !terrace && (isCorr || inner) });
        if (isCorr && inner && !s.isPlatform && i === 0 && r() < 0.8) fireEscape(X, info, FA, r);
      }
      if (!terrace && (i === top || t.y1 > s.tiers[top].y1 - 1)) roofDress(b, X, s, t, r);
    });
    if (s.isPlatform) railing(b, s, s.tiers[0]);
  },
  limestone(b, s, ctx) {
    const r = ctx.rng, X = ctx.extras, kit = kitOn(ctx), c = pick(r, STONE);
    const st = { col: c, vr: r(), win: FK.STONE_WIN, plain: FK.STONE, bay: 'fs_bay_stone', roof: 0x7a7266 };
    const A = kit ? nearAnchors(ctx, s) : [], corr = inward(s) < 0 ? 'x' : 'X', top = s.tiers.at(-1);
    s.tiers.forEach((t, i) => {
      const faces = massTier(b, s, t, st), terrace = s.isPlatform && i === 0, last = t === top;
      if (!kit) { band(b, t, t.y1 - 2.2, 2.2, 0.4, 0xefe4cc); return; }
      for (const key of ['x', 'X', 'z', 'Z']) {
        const info = faces[key]; if (!info) continue;
        const FA = faceAnchors(info.F, A), isCorr = key === corr, inner = s.role === 'inner';
        dressFace(X, s, t, info, st, FA, { bays: isCorr && inner, quoins: isCorr && inner, belts: isCorr && inner ? 5 : 0, parapet: !terrace && (isCorr || inner) && !(last && s.h > 70) });
      }
    });
    if (!kit) {
      if (s.h > 70) { // deco crown + spire (fallback)
        b.frustum(top.dv, top.y1, -top.du, top.d * 0.7, top.w * 0.7, 6, top.d * 0.45, top.w * 0.45, { col: 0xefe4cc, kind: K.STONE });
        b.cyl(top.dv, top.y1 + 6, -top.du, 0.6, 0.05, 12, 6, { col: 0xc8c0b0, kind: K.METAL });
      } else roofPropsProc(b, top, r);
    } else roofDress(b, X, s, top, r, { crown: s.h > 70, tank: 0.45 });
    if (s.isPlatform) railing(b, s, s.tiers[0], { col: 0xd8ccb0, kind: K.STONE, post: 0.25, step: 1.1 });
  },
  glass(b, s, ctx) {
    const r = ctx.rng, X = ctx.extras, kit = kitOn(ctx), c = pick(r, GLASS);
    const st = { col: c, vr: r(), win: K.GLASS, plain: K.METAL, glass: true, bay: 'fs_glass_bay', roof: 0x3a3e46 };
    const A = kit ? nearAnchors(ctx, s) : [], corr = inward(s) < 0 ? 'x' : 'X';
    for (const t of s.tiers) {
      const faces = massTier(b, s, t, { ...st, col: 0x2a2e36 });
      band(b, t, 0, 6, 0.2, 0x2a2e36, K.METAL); band(b, t, t.y1, 1.2, -0.3, 0x2a2e36, K.METAL);
      if (kit) for (const key of ['x', 'X', 'z', 'Z']) { const info = faces[key]; if (info && key === corr && s.role === 'inner') dressFace(X, s, t, info, st, faceAnchors(info.F, A), { bays: true }); }
    }
    const top = s.tiers.at(-1);
    b.box(top.dv, top.y1, -top.du, top.d * 0.4, 4, top.w * 0.4, { col: 0x3a3e46, kind: K.METAL });
    b.cyl(top.dv, top.y1 + 4, -top.du, 0.35, 0.1, 9, 5, { col: 0x8a8a90, kind: K.METAL });
    if (kit && r() < 0.5) X.add('fs_hvac', roofMatrix(top.dv + top.d * 0.3, top.y1, -top.du, 0, 1, _M));
    if (s.isPlatform) railing(b, s, s.tiers[0], { col: 0x9ab0c8, kind: K.GLASS, h: 1.2, step: 0.9 });
  },
  pillar(b, s, ctx) { foldscape.limestone(b, s, ctx); },
  bridgeHigh(b, s, { glow: g }) { // enclosed steel + glass skybridge
    const L = s.d, y0 = s.y0, H = s.h - s.y0, w = s.w;
    b.box(0, y0, 0, L, 0.7, w, { col: 0x3a3c40, kind: K.METAL, faces: 'xXzZtb' });
    b.box(0, y0 + 0.7, 0, L, H - 1.2, w * 0.92, { col: 0x8aa0b8, kind: K.GLASS, faces: 'zZ' });
    b.box(0, s.h - 0.5, 0, L, 0.5, w, { col: 0x3a3c40, kind: K.METAL, faces: 'xXzZtb' });
    for (let x = -L / 2 + 2; x < L / 2; x += 3.2) b.box(x, y0 + 0.7, 0, 0.18, H - 1.2, w + 0.1, { col: 0x2a2c30, kind: K.METAL });
    b.truss(-L / 2, L / 2, y0 - 2.2, 0, 2.2, w * 0.8, 0.22, { col: 0x2e3034 });
    for (let x = -L / 2 + 4; x < L / 2; x += 7) lantern(b, g, x, y0 - 0.4, 0, { col: 0xffc070, r: 0.2, body: 0x2a2a2a });
  },
  bridgeLow(b, s) { // masonry viaduct (walkable top)
    const L = s.d, w = s.w;
    b.box(0, s.y0, 0, L, s.h - s.y0, w, { col: 0xb8a68a, kind: FK.STONE, faces: 'xXzZtb', top: { col: 0x6a6460, kind: K.PLAIN } });
    b.box(0, s.h, 0, L, 1.1, 0.35, { col: 0xc8b89a, kind: K.STONE, faces: 'xXzZt' });
    b.box(0, s.h, w / 2 - 0.2, L, 1.1, 0.35, { col: 0xc8b89a, kind: K.STONE }); b.box(0, s.h, -w / 2 + 0.2, L, 1.1, 0.35, { col: 0xc8b89a, kind: K.STONE });
    b.arch(0, s.y0 - 6, 0, L * 0.6, 2.2, w * 0.9, 12, { col: 0xa8967a, kind: K.STONE, rise: 0.35 });
  },
  obstacle(b, s, { rng: r }) { // an elevated station block across the avenue (go over or under it)
    b.box(0, s.y0, 0, s.d, s.h - s.y0, s.w, { col: 0x8a5a44, kind: K.FACADE, var: r(), faces: 'xXzZtb', top: { col: 0x4a4a4e } });
    band(b, { dv: 0, du: 0, d: s.d, w: s.w }, s.h - 1, 1, 0.5, TRIM);
    b.box(0, s.y0 - 0.6, 0, s.d, 0.6, s.w + 1.2, { col: 0x2a2a2e, kind: K.METAL, faces: 'xXzZb' });
    for (const z of [-s.w / 2 + 1, s.w / 2 - 1]) b.box(0, s.h, z, s.d, 1.1, 0.3, { col: TRIM });
  },
  startPlatform(b, s, ctx) { foldscape.bridgeLow(b, s, ctx); },
  closure(b, s, { rng: r }) {
    const t = { y0: 0, y1: s.h, w: s.w, d: s.d, du: 0, dv: 0 }, c = pick(r, BRICK);
    massTier(b, { ...s, role: 'outer' }, t, { col: c, vr: r(), win: FK.BRICK_WIN, plain: FK.BRICK });
    band(b, t, s.h - 1.6, 1.6, 0.6, TRIM);
  },
  /** Six streamed inverted architectural families, with collision tiers matched to their silhouettes. */
  foldBlock(b, s, ctx) { drawFoldOverhead(b, s, ctx); },
  landmarkTower(b, s, ctx) { foldscape.limestone(b, s, ctx); },
  landmarkArch(b, s, ctx) { foldscape.bridgeHigh(b, s, ctx); },
  structure(b, s, ctx) { foldscape.brick(b, s, ctx); },
  /** Street furniture along the avenue: trees on both sidewalks, lamps with warm glow. */
  moduleDecor(b, ctx) {
    const { m, rng: r, local, glow: g, halfW } = ctx;
    for (let u = rr(r, 3, 9); u < m.L - 2; u += rr(r, 11, 15)) for (const side of [-1, 1]) {
      const [x, z] = local(u, side * (halfW - 2.2));
      b.cyl(x, 0, z, 0.22, 0.18, 3.2, 5, { col: 0x4a3426, kind: K.BARK, caps: '' });
      foliage(b, x, 4.6, z, 2.4, 0.9, { col: rng2col(r), var: r(), seed: u });
      foliage(b, x + 0.8, 5.6, z - 0.5, 1.6, 0.9, { col: 0x5a8a3a, var: r(), seed: u + 1 });
    }
    for (let u = rr(r, 5, 12); u < m.L - 2; u += 22) for (const side of [-1, 1]) {
      const [x, z] = local(u, side * (halfW - 1.2));
      b.cyl(x, 0, z, 0.12, 0.09, 6.5, 5, { col: 0x1e2022, kind: K.METAL, caps: '' });
      b.box(x, 6.5, z, 0.5, 0.35, 0.8, { col: 0x1e2022, kind: K.METAL });
      b.box(x, 6.35, z, 0.36, 0.16, 0.6, { col: 0xffd090, kind: K.EMIS });
      g.blob(x, 6.2, z, 1.4, 0.8, { col: 0x5a4020, kind: 3, jitter: 0 });
    }
  },
  /**
   * Far city (follows the camera — the one far-only compromise; near / mid modules keep full parallax): skyline ring
   * and the signature FOLD's lower sweep — the avenue ahead bends up a curve and leans right as it rises, an ORDERED
   * street grid on it (avenue + lanes, cross streets, rigid blocks rotating with the surface, golden edge seams). The
   * remote sky districts around it are textured cards (decorateBackdrop → foldscapeSkyCards.js).
   */
  backdrop(b, g, { rng: r }) {
    for (let i = 0; i < 150; i++) {
      const a = (i / 150) * Math.PI * 2 + rr(r, -0.01, 0.01), d = rr(r, 540, 840), x = Math.sin(a) * d, z = -Math.cos(a) * d;
      if (Math.abs(a) < 0.32 || Math.abs(a - Math.PI * 2) < 0.32) continue; // keep the fold's foot clear
      const h = rr(r, 30, 140) * (Math.abs(Math.sin(a * 3)) * 0.5 + 0.6), w = rr(r, 18, 40);
      b.pushTRS(x, 0, z, -a); b.box(0, 0, 0, w, h, w * rr(r, 0.7, 1.2), { col: pick(r, [...BRICK, ...STONE, 0x6a7a90]), kind: K.FACADE, var: r() }); b.pop();
      if (r() < 0.12) { b.pushTRS(x, h, z, -a); b.cyl(0, 0, 0, w * 0.3, 0.3, h * 0.3, 6, { col: 0xd8c8a8, kind: K.STONE }); b.pop(); }
    }
    // the fold: from D ahead the ground bends up (radius R) and drifts right as it rises. v0.42: drawn only to TH (the
    // lower ~65 % of the original 1.78 rad sweep) — the painted folded district (foldscapeSkyCards) carries the rise on
    // into the sky, so the 3D fold is the connective ramp, not a big plain slab in the sky.
    const R = 430, D = 430, TH_SHAPE = 1.78, TH = 1.15, half = 170;
    const lean = (th) => 230 * Math.pow(th / TH_SHAPE, 1.5);
    const P = (th, sx) => [sx + lean(th), R - R * Math.cos(th), -D - R * Math.sin(th)];
    const steps = 96, street = (t0, t1) => { const sm = R * (t0 + t1) / 2; return (sm % 70) < 9; };
    const strips = [[-half, -118, 0x7a6c62], [-118, -102, 0x55524f], [-102, -18, 0x7a6c62], [-18, -14, 0xa89c8e], [-14, 14, 0x5a5658], [14, 18, 0xa89c8e], [18, 102, 0x7a6c62], [102, 118, 0x55524f], [118, half, 0x7a6c62]];
    for (let k = 0; k < steps; k++) {
      const t0 = (k / steps) * TH, t1 = ((k + 1) / steps) * TH;
      const cross = street(t0, t1);
      for (const [a, c, col] of strips) b.quad(P(t0, a), P(t0, c), P(t1, c), P(t1, a), cross && col === 0x7a6c62 ? 0x55524f : col, K.PLAIN);
      b.quad(P(t0, -0.25), P(t0, 0.25), P(t1, 0.25), P(t1, -0.25), 0xc8a040, K.PLAIN); // centre line
      g.quad(P(t0, -14.5), P(t0, -13.5), P(t1, -13.5), P(t1, -14.5), 0x6a4418, 2); g.quad(P(t0, 13.5), P(t0, 14.5), P(t1, 14.5), P(t1, 13.5), 0x6a4418, 2); // golden kerb seams
    }
    // blocks: cross streets every ~70 m of arc, rigid buildings along the frontages, rotating with the surface
    const arc = R * TH;
    for (let s0 = 10; s0 < arc - 30; s0 += 70) {
      for (const [a, c] of [[-102, -20], [20, 102], [-half + 2, -120], [120, half - 2]]) {
        for (let sAlong = s0 + 4; sAlong < s0 + 58; ) {
          const len = rr(r, 12, 20), th = (sAlong + len / 2) / R;
          if (th > TH - 0.02) break;
          const front = a < 0 ? c : a, dir = a < 0 ? -1 : 1, dep = rr(r, 14, Math.min(34, Math.abs(c - a) - 2));
          const x = front + dir * dep / 2, h = rr(r, 14, 52) * (Math.abs(a) > 110 ? 1.3 : 1), p = P(th, x);
          const lim = r() < 0.25, col = lim ? pick(r, STONE) : r() < 0.15 ? pick(r, GLASS) : pick(r, BRICK);
          b.pushTRS(p[0], p[1], p[2], 0, 1, 1, 1, th);
          b.box(0, 0, 0, dep, h, len - 1.5, { col, kind: lim ? K.FACADE : K.FACADE, var: r() });
          b.box(0, h, 0, dep + 0.8, 1.0, len - 0.7, { col: lim ? 0xefe4cc : 0x6a5a50, kind: K.PLAIN });
          if (!lim && r() < 0.4) b.cyl(rr(r, -dep / 4, dep / 4), h + 1, 0, 1.6, 1.6, 3.5, 6, { col: 0x6a4a34, kind: K.WOOD });
          b.pop();
          sAlong += len;
        }
      }
    }
    g.quad([-half, 2, -D - 2], [half, 2, -D - 2], [half, 14, -D - 4], [-half, 14, -D - 4], 0x6a4422, 2); // sunlit seam at the foot
    // the flat city leading into the fold's foot (same street grid: the avenue stays open, cross streets every 70 m)
    for (let d0 = D - 288; d0 < D - 10; d0 += 70) for (const [a, c] of [[-102, -20], [20, 102], [-half + 2, -120], [120, half - 2]]) {
      for (let d = d0; d < Math.min(d0 + 56, D - 6); ) {
        const len = Math.min(rr(r, 12, 20), D - 4 - d), dep = rr(r, 14, 30), front = a < 0 ? c : a, dir = a < 0 ? -1 : 1, x = front + dir * dep / 2, h = rr(r, 12, 40);
        const lim = r() < 0.25, col = lim ? pick(r, STONE) : pick(r, BRICK);
        if (len > 4) { b.box(x, 0, -(d + len / 2), dep, h, len - 1.5, { col, kind: K.FACADE, var: r() }); b.box(x, h, -(d + len / 2), dep + 0.8, 1.0, len - 0.7, { col: lim ? 0xefe4cc : 0x6a5a50, kind: K.PLAIN }); }
        d += len;
      }
    }
    // the avenue on the flat ground up to the foot (y −0.2: under the streamed modules' floor ribbons, shows beyond them)
    for (const [x0, x1, col] of [[-half, -18, 0x7a6c62], [-18, -14, 0xa89c8e], [-14, 14, 0x5a5658], [14, 18, 0xa89c8e], [18, half, 0x7a6c62]]) b.quad([x0, -0.2, -D + 300], [x1, -0.2, -D + 300], [x1, -0.2, -D], [x0, -0.2, -D], col, K.PLAIN);
    b.quad([-0.25, -0.15, -D + 300], [0.25, -0.15, -D + 300], [0.25, -0.15, -D], [-0.25, -0.15, -D], 0xc8a040, K.PLAIN);
    // (v0.42: the plain inverted strip on the left and the box 'needle' are gone — the textured sky districts and the
    // painted Empire / Chrysler crops take those roles; see src/worlds/art/foldscapeSkyCards.js)
  },
};
function rng2col(r) { return [0x5a8a3a, 0x6a9a3a, 0x4a7a32, 0x7a9a42][Math.floor(r() * 4)]; }
export { faceX };
