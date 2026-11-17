// Forest of Shadow Ruins / 森影遺跡 (v0.43 art upgrade) — giant old-growth trees with buttress roots, heavy limbs and
// layered canopy; root-wrapped, broken temple towers with niches and crowns of trees; mossy arch bridges over a
// turquoise stream; guardian statues and altars on stone plinths; a deep forest valley with a terraced temple and falls.
//
// Asset split (see src/worlds/art/forestArt.js): THIS file draws the code masses inside the route's collision tiers
// (tower masonry, bridge decks, plinths, piers) and PLACES instanced pieces through ctx.extras.add():
//   Tripo (user): hero_roots (tree bases), hero_ruin / hero_statue / hero_altar (route decor structures, real colliders)
//   Blender (tools/blender/build_forest_kit.py): trunks, crowns, canopy, roots, anchor burls, vines, strangler roots,
//   arches, broken bridge ends, columns, wall crowns, niches, rubble, boulders, ferns, shrubs.
// Frame: structure-local, +x = route right, −z = route forward; the corridor side of a structure is x · inward(s) > 0.
// Kit pieces face +Z toward the corridor → yaw = yawTo(inward, 0). Legacy procedural drawing (below, `legacy`) is used
// when the forest assets are off (quality 'off') or failed to load.
import { foliage } from '../../art/treeFoliage.js';
import { K, pick, rr, inward, faceX, drawTiers, railing, mulC } from './common.js';
import { ForestDetail, trs, yawTo } from '../art/forestArt.js';
import { toWorld, frameAt, pathY } from '../route.js';

const STONE = [0x928f80, 0x88877a, 0x9a978a, 0x8c8a78];
const BARK = [0x5a4232, 0x4e3a2c, 0x664a36];
const LEAF = [0x4e7a2e, 0x5a8a34, 0x3e6a28, 0x6a9a3a, 0x48742c];
const MOSS = 0x56782e, VINE = 0x2e4a1e;
const TRUNKS = ['tr_trunk_a', 'tr_trunk_b', 'tr_trunk_c'], CROWNS = ['tr_crown_a', 'tr_crown_b', 'tr_crown_c'], CANOPY = ['cn_canopy_a', 'cn_canopy_b'];
const TRUNK_H = 16; // Blender trunk height in trunk radii (forest_kit.json frame)
const STUMP_TOP = 0.105; // Tripo stump: cut-top radius of the unit-normalised source
const FALLBACK_TIPS = [[-7, 3, 0], [6, 3, -1], [0, 3.5, -6.5], [-4, 5, -4], [4, 5, -4], [1, 9, 3]];
const kitOn = (ctx) => !!ctx.extras?.on;
const tint = (r, a = 0.88, b = 1.08) => { const k = rr(r, a, b), g = rr(r, 0.96, 1.04); return (Math.round(255 * Math.min(1, k)) << 16) | (Math.round(255 * Math.min(1, k * g)) << 8) | Math.round(255 * Math.min(1, k * 0.98)); };
/** Swing anchors of structure s (or every anchor of the module within `rad` m) in the structure's local frame. */
function anchorsLocal(m, s, all = false, rad = 40) {
  const out = [], [sx, sz] = toWorld(m, s.u, s.v), yaw = -frameAt(m, s.u).a, c = Math.cos(yaw), n = Math.sin(yaw);
  for (const a of m.anchors) {
    if (!all && a.sid !== s.id) continue;
    const [ax, az] = toWorld(m, a.u, a.v), dx = ax - sx, dz = az - sz; if (dx * dx + dz * dz > rad * rad) continue;
    out.push({ x: dx * c - dz * n, y: a.y, z: dx * n + dz * c, side: a.side });
  }
  return out;
}
/** Stream centre-line offset (m across) at route arc length s — identical to the FOREST floor shader. */
export const streamOff = (s) => Math.sin(s * 0.011) * 4 + Math.sin(s * 0.031 + 1.3) * 1.6;
export const streamHalf = (s) => 9 + 2.2 * Math.sin(s * 0.017 + 0.7);

// =============================================================================================== kit-piece assemblies
/** Foliage clumps on the crown tips (transformed by the crown's placement). v0.44: the clumps are open leaf sprays
 * (sky gaps are in the clumps themselves), so EVERY limb end carries leaves — no bare cut limb stubs; the side-branch
 * tips take the small clump. nMax only limits the main limbs. */
function canopyOnCrown(X, r, crown, x, y, z, yaw, sc, size, nMax = 7) {
  const tips = X.tips(crown) || FALLBACK_TIPS, c = Math.cos(yaw), s = Math.sin(yaw);
  let n = 0;
  for (let i = 0; i < tips.length; i++) {
    const [tx, ty, tz] = tips[i], main = i < 5 || tips.length <= 6;
    if (main && n >= nMax) continue;
    const wx = x + (tx * c + tz * s) * sc, wz = z + (-tx * s + tz * c) * sc, wy = y + ty * sc;
    const k = sc * size * (main ? rr(r, 1.0, 1.3) : rr(r, 0.55, 0.75));
    X.add(main ? pick(r, CANOPY) : 'cn_canopy_c', trs(wx, wy - k * 0.35, wz, rr(r, 0, 6.28), k, k * rr(r, 0.8, 1.05), k), tint(r, 0.85, 1.1)); if (main) n++;
  }
}
/** One giant tree: roots (Tripo stump or Blender plank roots), Blender trunk to the collider top, crown, canopy. */
function kitTree(X, r, { x, z, R, h, yaw, roots, outer = false, crownScale = 1 }) {
  const tTint = tint(r, 0.85, 1.05);
  if (roots === 'hero') { const k = (0.75 * R) / STUMP_TOP * rr(r, 0.95, 1.05); X.add('hero_roots', trs(x, -0.25, z, rr(r, 0, 6.28), k, k * rr(r, 0.85, 1.0), k), tint(r, 0.92, 1.04)); }
  else X.add('tr_roots', trs(x, -0.2, z, yaw + rr(r, -0.4, 0.4), R, R * rr(r, 0.95, 1.25), R), tTint);
  X.add(pick(r, TRUNKS), trs(x, 0, z, yaw, R, h / TRUNK_H, R), tTint);
  const crown = pick(r, CROWNS), cs = Math.max(2.4, Math.min(4.2, R * 0.85)) * crownScale, cy = h - 0.4 * R;
  X.add(crown, trs(x, cy, z, yaw, cs), tTint);
  canopyOnCrown(X, r, crown, x, cy, z, yaw, cs, outer ? 2.5 : 2.35, outer ? 4 : 5);
  X.add(pick(r, CANOPY), trs(x - Math.sin(yaw) * cs * 2, cy + cs * 4.5, z - Math.cos(yaw) * cs * 2, r() * 6, cs * 2.6, cs * 2.0, cs * 2.6), tint(r, 0.85, 1.05)); // the crown's central mass (behind the trunk, away from the corridor)
  return { crown, cs, cy };
}

// =============================================================================================== the kit
export const forest = {
  createExtras(wr) { return new ForestDetail(wr); },
  animate(wr) { // route-space noise origin (rebase-stable dapples) — also when the assets are off
    const o = wr.world.off; for (const m of [wr.mat, wr.floorMat]) m.uniforms.uOff?.value.set(o[0], o[1]);
  },
  tree(b, s, ctx) {
    if (!kitOn(ctx)) return legacy.tree(b, s, ctx);
    const r = ctx.rng, X = ctx.extras, t = s.tiers[0], R = t.d / 2, x = t.dv, z = -t.du, h = t.y1, dir = inward(s), yaw = yawTo(dir, 0);
    const outer = s.role !== 'inner';
    kitTree(X, r, { x, z, R, h, yaw, roots: s.roots || 'kit', outer });
    if (!outer) { // bark burls behind the swing anchors (the device sits on a knot, never floating off the round trunk)
      const own = anchorsLocal(ctx.m, s);
      for (const a of own) {
        if (a.y > h - 0.5) continue;
        const dz = a.z - z, bark = Math.sqrt(Math.max(0, R * R - dz * dz)), g = Math.abs(a.x - x) - bark, sz = Math.max(0.45, Math.min(2.6, (g + 0.4) / 2.0));
        X.add('tr_mount', trs(a.x - dir * (0.5 + 0.6 * sz), a.y, a.z, yaw, 1.1, 1.15, sz), tint(r, 0.85, 1.0));
      }
      const vz = z + (r() < 0.5 ? -1 : 1) * R * 0.9, vx = x - dir * R * 0.4, vy = h - R * 0.3, vl = rr(r, 1.4, 2.4);
      if (r() < 0.55 && own.every((a) => Math.hypot(a.x - vx, a.z - vz) > 3.5 || a.y > vy || a.y < vy - 10.2 * vl)) X.add('vn_hang', trs(vx, vy, vz, yaw + Math.PI / 2, 1.2, vl, 1.2), tint(r));
    }
  },
  ruin(b, s, ctx) {
    if (!kitOn(ctx)) return legacy.ruin(b, s, ctx);
    const r = ctx.rng, X = ctx.extras, c = pick(r, STONE), dir = inward(s), yaw = yawTo(dir, 0), lite = s.role !== 'inner';
    drawTiers(b, s, () => ({ col: c, kind: K.STONE, var: r(), top: { col: MOSS, kind: K.LEAF } }));
    const near = lite ? [] : anchorsLocal(ctx.m, s, true, 45);
    const clearOf = (fx, y, z, rad) => !near.some((a) => Math.abs(a.y - y) < rad + 1.5 && Math.abs(a.z - z) < rad && Math.abs(a.x - fx) < 4);
    for (const t of s.tiers) {
      const fx = faceX(s, t), cz = -t.du, top = t.y1;
      // a few deep string courses (code: ledges the moss collects on)
      for (let y = rr(r, 9, 14); y < top - 4; y += rr(r, 12, 18)) b.box(t.dv, y, cz, t.d + 0.7, 0.8, t.w + 0.7, { col: mulC(c, 0.9), kind: K.STONE, var: r() });
      // broken crown along the top edges (Blender wall tops), corridor edge kept below the anchors' clearance
      const edges = [[t.dv + dir * (t.d / 2 - 0.6), cz, t.w, yaw + Math.PI / 2], [t.dv - dir * (t.d / 2 - 0.6), cz, t.w, yaw + Math.PI / 2], [t.dv, cz - t.w / 2 + 0.6, t.d, 0], [t.dv, cz + t.w / 2 - 0.6, t.d, 0]];
      for (const [ex, ez, len, ey] of edges) {
        const n = Math.max(1, Math.round(len / 6)), ca = Math.cos(ey), sa = Math.sin(ey);
        for (let i = 0; i < n; i++) { if (r() < 0.4) continue; const o = (i + 0.5 - n / 2) * (len / n); X.add('rn_walltop', trs(ex + o * ca, top, ez - o * sa, ey + (r() < 0.5 ? 0 : Math.PI), len / n / 6 * 1.02, rr(r, 0.8, 1.6), 1), tint(r)); }
      }
      if (!lite) {
        // niches (arched openings with dark recesses) in rows on the corridor face, clear of the anchors
        const cols = Math.max(1, Math.floor((t.w - 2) / 4.6));
        for (let y = rr(r, 10, 16); y < top - 7; y += rr(r, 13, 19)) for (let i = 0; i < cols; i++) {
          if (r() < 0.5) continue; const z = cz + (i + 0.5 - cols / 2) * ((t.w - 2) / cols), sc = rr(r, 1.0, 1.3);
          if (!clearOf(fx, y + 2 * sc, z, 2.6)) continue;
          X.add('rn_niche', trs(fx, y, z, yaw, sc), tint(r));
        }
        // a great doorway at the foot (the corridor face), strangler roots down the side / corridor faces
        if (t.y0 < 1 && t.w > 8) X.add('rn_niche', trs(fx, 0, cz + rr(r, -1, 1), yaw, rr(r, 2.2, 2.7)), tint(r));
        const nw = 2 + (r() < 0.5 ? 1 : 0);
        for (let k = 0; k < nw; k++) {
          const side = r() < 0.5, sc = (top - t.y0) / 18.5, along = side ? 0 : rr(r, -t.w / 2 + 3, t.w / 2 - 3);
          if (side) { const zz = cz + (r() < 0.5 ? -1 : 1) * t.w / 2, sg = Math.sign(zz - cz); X.add('rt_wrap', trs(t.dv + rr(r, -t.d / 4, t.d / 4), t.y0, zz, sg > 0 ? 0 : Math.PI, rr(r, 1.0, 1.4), sc, 1.1), tint(r)); }
          else if (clearOf(fx, (top + t.y0) / 2, cz + along, 4) && near.every((a) => Math.abs(a.z - cz - along) > 4)) X.add('rt_wrap', trs(fx, t.y0, cz + along, yaw, rr(r, 1.0, 1.3), sc, 0.9), tint(r));
        }
        for (let k = 0, nv = 1 + Math.floor(r() * 2.2); k < nv; k++) { // vines down the corridor face, never across a device (whole hanging length)
          const z = cz + rr(r, -t.w / 2.4, t.w / 2.4), sx = rr(r, 1.0, 1.4), len = rr(r, 0.9, 1.8);
          if (near.every((a) => Math.abs(a.z - z) > 2.2 * sx + 1.2 || a.y > top + 1 || a.y < top - 10.2 * len - 1.5 || Math.abs(a.x - fx) > 4)) X.add('vn_hang', trs(fx + dir * 0.3, top, z, yaw, sx, len, 1), tint(r));
        }
      }
    }
    // a tree growing out of the ruin top
    const tt = s.tiers.reduce((a, t) => (t.y1 > a.y1 ? t : a), s.tiers[0]);
    if (r() < (lite ? 0.75 : 0.6)) {
      const crown = pick(r, CROWNS), cs = Math.min(tt.d, tt.w) * rr(r, 0.2, 0.28), x = tt.dv - dir * tt.d * 0.15, z = -tt.du;
      X.add('tr_trunk_c', trs(x, tt.y1 - 2, z, yaw, cs * 0.55, (cs * 2.2) / TRUNK_H, cs * 0.55), tint(r));
      X.add(crown, trs(x, tt.y1 + cs * 1.4, z, yaw, cs), tint(r));
      canopyOnCrown(X, r, crown, x, tt.y1 + cs * 1.4, z, yaw, cs, 2.4, 5);
    } else X.add('cn_canopy_c', trs(tt.dv, tt.y1 + 0.3, -tt.du, r() * 6, Math.min(tt.d, tt.w) * 0.32, Math.min(tt.d, tt.w) * 0.22, Math.min(tt.d, tt.w) * 0.32), tint(r));
    if (s.isPlatform) railing(b, s, s.tiers[0], { col: 0x7a7a66, kind: K.STONE, post: 0.4, step: 1.4, h: 0.9 });
    if (!lite) X.add('rn_rubble', trs(faceX(s, s.tiers[0]) + dir * 2.2, 0, -s.tiers[0].du + rr(r, -3, 3), r() * 6, rr(r, 0.9, 1.3)), tint(r));
  },
  structure(b, s, ctx) { forest.ruin(b, s, ctx); },
  bridgeHigh(b, s, ctx) {
    if (!kitOn(ctx)) return legacy.bridgeHigh(b, s, ctx);
    const r = ctx.rng, X = ctx.extras, L = s.d, w = s.w, hw = ctx.m.halfW;
    b.box(0, s.y0, 0, L, s.h - s.y0, w, { col: 0x8a8a74, kind: K.STONE, faces: 'xXzZtb', top: { col: MOSS, kind: K.LEAF } });
    for (const z of [-w / 2 + 0.38, w / 2 - 0.38]) for (let x = -L / 2 + 2.2; x < L / 2 - 2; x += 4.05) if (r() > 0.18) X.add('rn_parapet', trs(x, s.h, z, z < 0 ? 0 : Math.PI, 1, rr(r, 0.8, 1.1), 1), tint(r));
    for (const sx of [-1, 1]) { // vines only beyond the corridor edge (never in the swing space under the deck)
      X.add('vn_hang', trs(sx * (hw + rr(r, 1.5, 4)), s.y0, rr(r, -w / 4, w / 4), r() * 6, 1, rr(r, 0.5, 0.9), 1), tint(r));
      X.add('rn_walltop', trs(sx * (L / 2 - 2.5), s.h, 0, Math.PI / 2, w / 6, rr(r, 1, 1.6), 1), tint(r));
    }
  },
  bridgeLow(b, s, ctx) { // the big mossy arch bridge over the stream (the deck is the collider; the arch is below it, open under)
    if (!kitOn(ctx)) return legacy.bridgeLow(b, s, ctx);
    const r = ctx.rng, X = ctx.extras, L = s.d, w = s.w, y0 = s.y0, hw = ctx.m.halfW;
    b.box(0, y0, 0, L, s.h - y0, w, { col: 0x8a8a74, kind: K.STONE, faces: 'xXzZtb', top: { col: 0x8e8b7c, kind: K.STONE } });
    const sx = (2 * (hw - 0.6)) / 10 / 1.13, sy = y0 / (3.98 + 6.3), oy = 3.98 * sy; // inner span ≈ the corridor; crown under the deck
    X.add('rn_arch', trs(0, oy, 0, 0, sx, sy, w / 2.6), tint(r, 0.9, 1.05));
    for (const z of [-w / 2 + 0.38, w / 2 - 0.38]) for (let x = -L / 2 + 2.2; x < L / 2 - 2; x += 4.05) {
      const p = r() > 0.15, sy = rr(r, 0.8, 1.1);
      if (p && !(s.role === 'platform' && z < 0)) X.add('rn_parapet', trs(x, s.h, z, z < 0 ? 0 : Math.PI, 1, sy, 1), tint(r)); // (start platform: the forward edge stays open — the showcase below is in view)
    }
    for (let k = 0; k < 3; k++) X.add('vn_hang', trs(rr(r, -L / 2 + 3, L / 2 - 3), y0, (r() < 0.5 ? -1 : 1) * w * 0.48, r() < 0.5 ? 0 : Math.PI, 1, rr(r, 0.4, 0.9), 1), tint(r));
  },
  obstacle(b, s, ctx) { // a fallen ancient span: carved stone wrapped in roots (kit: crown teeth + roots + vines)
    legacy.obstacle(b, s, ctx);
    if (!kitOn(ctx)) return;
    const r = ctx.rng, X = ctx.extras;
    for (let x = -s.d / 2 + 3; x < s.d / 2 - 2; x += 6) if (r() < 0.7) X.add('rn_walltop', trs(x, s.h, rr(r, -s.w / 4, s.w / 4), 0, 1, rr(r, 0.6, 1.2), s.w / 1.4), tint(r));
  },
  startPlatform(b, s, ctx) { forest.bridgeLow(b, s, ctx); },
  closure(b, s, ctx) {
    if (!kitOn(ctx)) return legacy.closure(b, s, ctx);
    const r = ctx.rng, X = ctx.extras;
    b.box(0, 0, 0, s.d, s.h, s.w, { col: 0x7e806a, kind: K.STONE, var: r(), top: { col: MOSS, kind: K.LEAF } });
    for (let x = -s.d / 2 + 3; x < s.d / 2 - 2; x += 6.2) X.add('rn_walltop', trs(x, s.h, -s.w / 2 + 0.7, 0, 1.03, rr(r, 0.8, 1.8), 1), tint(r));
    for (let x = -s.d / 2 + 8; x < s.d / 2 - 4; x += rr(r, 14, 20)) kitTree(X, r, { x, z: 2, R: rr(r, 3.2, 4.2), h: s.h + rr(r, 10, 22), yaw: Math.PI, roots: 'kit', outer: true });
  },
  landmarkArch(b, s, ctx) { // the giant broken arch of the concept, spanning the stream high above (the collider = its crown)
    if (!kitOn(ctx)) return legacy.landmarkArch(b, s, ctx);
    const r = ctx.rng, X = ctx.extras, sx = (s.d / 2 - 2) / 5, sy = sx * 0.78, oy = s.h - 6.3 * sy, pierX = 5.65 * sx;
    b.box(0, s.y0, 0, s.d - 4, s.h - s.y0, s.w, { col: 0x8a8a74, kind: K.STONE, faces: 'xXzZtb', top: { col: MOSS, kind: K.LEAF } });
    X.add('rn_arch', trs(0, oy, 0, 0, sx, sy, s.w / 2.6), tint(r, 0.9, 1.0));
    for (const px of [-pierX, pierX]) { b.box(px, 0, 0, 1.9 * sx * 0.9, Math.max(1, oy - 3.98 * sy + 0.5), s.w + 1, { col: 0x7a7c68, kind: K.STONE, var: r() }); X.add('rt_wrap', trs(px, 0, s.w / 2 + 0.6, 0, 1.4, Math.max(0.5, (oy - 3.98 * sy) / 18.5), 1.2), tint(r)); }
    for (let x = -s.d / 2 + 4; x < s.d / 2 - 4; x += 6.2) if (r() < 0.75) X.add('rn_walltop', trs(x, s.h, rr(r, -1, 1), 0, 1.03, rr(r, 1, 2.2), s.w / 1.25), tint(r));
    for (let i = 0; i < 3; i++) X.add('cn_canopy_c', trs(rr(r, -s.d / 3, s.d / 3), s.h + 0.3, rr(r, -2, 2), r() * 6, rr(r, 3.5, 5), rr(r, 2.2, 3), rr(r, 3.5, 5)), tint(r));
    for (const sgn of [-1, 1]) X.add('vn_hang', trs(sgn * rr(r, ctx.m.halfW + 2, s.d / 2 - 4), s.y0, rr(r, -2, 2), r() * 6, 1.3, rr(r, 1.0, 1.8), 1.3), tint(r));
  },
  // ------------------------------------------------------------------ the Tripo heroes on their plinths (route decor)
  heroStatue(b, s, ctx) { heroOnPlinth(b, s, ctx, 'hero_statue'); },
  heroAltar(b, s, ctx) { heroOnPlinth(b, s, ctx, 'hero_altar'); },
  heroRuin(b, s, ctx) { heroOnPlinth(b, s, ctx, 'hero_ruin'); },
  moduleDecor(b, ctx) {
    if (!kitOn(ctx)) return legacy.moduleDecor(b, ctx);
    const { m, rng: r, local, glow: g, halfW } = ctx, X = ctx.extras;
    const at = (u, v, y, yaw, sx, sy = sx, sz = sx) => { const [x, z] = local(u, v), a = frameAt(m, u).a; return trs(x, y, z, -a + yaw, sx, sy, sz); };
    // stream: boulders along both banks and a few in the water, ferns / shrubs on the banks
    for (let u = rr(r, 2, 6); u < m.L; u += rr(r, 5, 9)) {
      const s = m.s0 + u, off = streamOff(s), hw = streamHalf(s), sd = r() < 0.5 ? -1 : 1, inWater = r() < 0.18;
      const v = off + sd * (inWater ? rr(r, 0, hw * 0.7) : hw + rr(r, -0.8, 2.5));
      X.add(r() < 0.55 ? 'rk_boulder' : 'rk_boulder_b', at(u, v, -0.25, r() * 6, rr(r, 0.9, 2.2), rr(r, 0.7, 1.4)), tint(r, 0.85, 1.05));
      if (r() < 0.6) { const v2 = off + sd * (hw + rr(r, 2.5, 9)); X.add(r() < 0.6 ? 'fx_fern' : 'fx_bush', at(u + rr(r, -2, 2), v2, 0, r() * 6, rr(r, 1.1, 2.0)), tint(r, 0.8, 1.1)); }
    }
    // the middle distance (|v| 58..150 m, never reachable: the corridor pull-back starts at halfW + 34): giant trees,
    // broken arches / bridge ends and ruined columns → forest depth to the left / right between the route and the far valley
    for (const sd of [-1, 1]) {
      for (let u = rr(r, 0, 22); u < m.L; u += rr(r, 28, 44)) {
        const v = sd * rr(r, 58, 150), R = rr(r, 4, 7), h = rr(r, 70, 125), [x, z] = local(u, v), yaw = -frameAt(m, u).a + (sd > 0 ? -Math.PI / 2 : Math.PI / 2);
        kitTree(X, r, { x, z, R, h, yaw, roots: 'kit', outer: true, crownScale: 1.15 });
        if (r() < 0.22) X.add(pick(r, ['rn_arch_broken', 'rn_arch', 'rn_column', 'rn_bridge_end']), at(u + rr(r, 6, 12), sd * rr(r, 45, 70), rr(r, 0, 4), r() * 6, rr(r, 1.4, 2.4)), tint(r));
      }
    }
    for (let k = 0; k < 2; k++) { // god rays through the canopy gaps (additive, faint, outside the swing line)
      const u = rr(r, 10, m.L - 10), side = r() < 0.5 ? -1 : 1, [x, z] = local(u, side * (halfW + 3)), y = rr(r, 18, 40);
      g.quad([x - 4, y - 30, z], [x + 4, y - 30, z], [x + 8, y + 18, z - 4], [x, y + 18, z - 4], 0x5a5430, 2, 0, [0, 0, 1, 1]);
    }
  },
  backdrop(b, g, ctx) { forestBackdrop(b, g, ctx); },
};

/** A Tripo hero on a stone plinth (decor structure: tiers[0] = plinth, tiers[1] = the hero's collider). */
function heroOnPlinth(b, s, ctx, hero) {
  const r = ctx.rng, X = ctx.extras, p = s.tiers[0], y = s.heroY, side = s.side || 1;
  if (y > 0.4) { // stepped plinth: a broad mossy base course, the shaft, a cornice under the hero
    b.box(0, 0, 0, p.d + 1.6, Math.min(2.2, y * 0.3), p.w + 1.6, { col: 0x7e7c66, kind: K.STONE, var: r(), top: { col: MOSS, kind: K.LEAF } });
    b.box(0, 0, 0, p.d, y - 0.6, p.w, { col: pick(r, STONE), kind: K.STONE, var: r() });
    b.box(0, y - 0.7, 0, p.d + 0.7, 0.7, p.w + 0.7, { col: 0x9a9680, kind: K.STONE, var: r(), top: { col: 0x8a8a70, kind: K.STONE } });
  }
  if (!kitOn(ctx)) { const t = s.tiers[1]; b.box(0, y, 0, t.d, t.y1 - t.y0, t.w, { col: 0x8a8670, kind: K.STONE, var: r() }); return; }
  X.add(hero, trs(0, y - 0.02, 0, s.heroYaw || 0, s.heroH), tint(r, 0.96, 1.04));
  if (y > 4) { // roots and vines claim the plinth (back / side faces: the corridor face stays readable)
    X.add('rt_wrap', trs(-side * 0.0 + (r() < 0.5 ? -1 : 1) * p.d * 0.1, 0, p.w / 2, 0, Math.min(1.3, p.d / 6), y / 18.5, 1), tint(r));
    if (r() < 0.6) X.add('vn_hang', trs(side * (p.d / 2 + 0.2), y, rr(r, -p.w / 4, p.w / 4), -side * Math.PI / 2, 0.9, Math.min(1, y / 12), 1), tint(r));
  }
  for (let k = 0; k < 3; k++) X.add(k ? 'fx_fern' : 'rn_rubble', trs(rr(r, -p.d / 2 - 2, p.d / 2 + 2), 0, (k % 2 ? -1 : 1) * (p.w / 2 + rr(r, 0.5, 2.5)), r() * 6, k ? rr(r, 1.2, 1.8) : rr(r, 0.6, 0.9)), tint(r));
}

/** The far valley (follows the camera, faces the route's main heading): layered canopy ridges, emergent giants, misty
 * hills, and the terraced temple with waterfalls ahead (code geometry: one merged mesh + one glow mesh). */
function forestBackdrop(b, g, { rng: r }) {
  const canopyCol = [0x41612e, 0x4b6c34, 0x3a5a2c, 0x56763a];
  // three rings of canopy ridges (near → far: darker → hazier), emergent giant trees poking out of them
  for (const [d0, d1, n, yb] of [[300, 380, 60, 34], [460, 600, 54, 48], [700, 880, 44, 70]]) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rr(r, -0.03, 0.03), d = rr(r, d0, d1), x = Math.sin(a) * d, z = -Math.cos(a) * d;
      if (Math.abs(a) < 0.12 && d > 600) continue; // keep the temple vista open
      foliage(b, x, yb * rr(r, 0.6, 1.0), z, rr(r, 34, 56) * (d / 400), 0.42, { col: pick(r, canopyCol), var: r(), seed: i });
      if (r() < 0.32) {
        const h = rr(r, 90, 150) * (d / 420), tr = rr(r, 4, 7) * (d / 420);
        b.cyl(x, 0, z, tr * 1.4, tr * 0.8, h, 7, { col: 0x4a3c2c, kind: K.BARK });
        for (let k = 0; k < 3; k++) { const aa = r() * 6.28, L = rr(r, 14, 24) * (d / 420); b.pipe([x, h * 0.85, z], [x + Math.cos(aa) * L, h + L * 0.4, z + Math.sin(aa) * L], tr * 0.35, 5, { col: 0x4a3c2c, kind: K.BARK, r1: tr * 0.12 }); foliage(b, x + Math.cos(aa) * L, h + L * 0.55, z + Math.sin(aa) * L, rr(r, 16, 26) * (d / 420), 0.5, { col: pick(r, canopyCol), var: r() }); }
        foliage(b, x, h + 6, z, rr(r, 22, 34) * (d / 420), 0.55, { col: pick(r, canopyCol), var: r() });
      }
    }
  }
  for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2, d = 980; b.blob(Math.sin(a) * d, -40, -Math.cos(a) * d, rr(r, 170, 260), 0.6, { col: 0x6e8f84, kind: K.PLAIN }); } // misty ridges
  // the ruined temple ahead: stepped terraces with stairs, a crowning arch gate with towers, trees on the terraces
  b.pushTRS(30, 0, -640);
  for (let k = 0; k < 7; k++) {
    const W = 230 - k * 28, D = 130 - k * 14, y = k * 17;
    b.box(0, y, -k * 13, W, 17, D, { col: 0x8f8d74, kind: K.STONE, var: k / 7, top: { col: 0x56763a, kind: K.LEAF } });
    for (const sx of [-1, 1]) if (k < 6) foliage(b, sx * (W / 2 - 14), y + 19, -k * 13 + D / 2 - 10, rr(r, 12, 18), 0.6, { col: pick(r, canopyCol), var: r() });
  }
  for (let k = 0; k < 7; k++) b.box(0, k * 17, -k * 13 + 65 - k * 7 + 6, 22, 17.5, 8, { col: 0x9c9a82, kind: K.STONE, var: 0.5 }); // the central stair
  b.arch(0, 119, -92, 40, 7, 10, 12, { col: 0x9a9a84, kind: K.STONE, rise: 1 });
  for (const sx of [-1, 1]) { b.box(sx * 24, 119, -92, 7, 34, 10, { col: 0x8a8a74, kind: K.STONE }); b.box(sx * 56, 102, -78, 12, 40, 12, { col: 0x8a8a74, kind: K.STONE }); b.box(sx * 56, 142, -78, 15, 3, 15, { col: 0x9a9a84, kind: K.STONE }); }
  // waterfalls (scrolling glow strips) off the terraces + mist pools at their feet
  for (const [sx, y0, y1, w] of [[-78, 0, 68, 9], [-40, 0, 52, 7], [36, 0, 86, 10], [74, 0, 60, 8], [12, 34, 118, 5]]) {
    g.quad([sx - w, y0, 68], [sx + w, y0, 68], [sx + w * 0.8, y1, 66], [sx - w * 0.8, y1, 66], 0xa8e2ee, 2, 0, [0, 0, 1, 1]);
    g.blob(sx, y0 + 4, 70, w * 1.8, 0.5, { col: 0x4a6a6a, kind: 3, jitter: 0.2 });
  }
  b.pop();
}

// =============================================================================================== legacy (assets off / failed)
function canopy(b, x, y, z, R, r, n, outward) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rr(r, -0.3, 0.3), d = rr(r, 0.2, 0.75) * R;
    const cx = x + Math.cos(a) * d + outward * R * 0.35, cz = z + Math.sin(a) * d, cy = y + rr(r, -0.25, 0.35) * R;
    foliage(b, cx, cy, cz, rr(r, 0.45, 0.7) * R, rr(r, 0.55, 0.8), { col: pick(r, LEAF), var: r(), seed: i * 3.1 + x });
  }
}
function vines(b, x, y0, z, len, r, n = 3) { for (let i = 0; i < n; i++) b.box(x + rr(r, -1.2, 1.2), y0 - len * rr(r, 0.4, 1), z + rr(r, -1.2, 1.2), 0.14, len * rr(r, 0.4, 1), 0.14, { col: VINE, kind: K.LEAF, var: r() }); }
function arches(b, s, t, r, step = 7) { // dark arched openings on the corridor face
  const fx = faceX(s, t), dir = inward(s);
  for (let y = 8; y < t.y1 - 6; y += step) for (let z = -t.w / 2 + 2.5; z < t.w / 2 - 2; z += 4.2) {
    if (r() < 0.35) continue;
    b.box(fx + dir * 0.02, y, -t.du + z, 0.1, 2.6, 1.5, { col: 0x141812, kind: K.PLAIN, faces: dir < 0 ? 'x' : 'X' });
    b.pushTRS(fx + dir * 0.04, y + 2.6, -t.du + z, dir < 0 ? Math.PI / 2 : -Math.PI / 2); b.arch(0, 0, 0, 1.5, 0.35, 0.3, 6, { col: 0x6a6a58, kind: K.STONE }); b.pop();
  }
}
function crenels(b, t, r, col) {
  const y = t.y1, n = Math.max(2, Math.round(t.w / 2.4));
  for (let i = 0; i < n; i++) { if (r() < 0.25) continue; const z = -t.w / 2 + (i + 0.5) * (t.w / n); for (const sx of [-1, 1]) b.box(t.dv + sx * (t.d / 2 - 0.5), y, -t.du + z, 1.0, rr(r, 0.8, 1.8), 1.2, { col, kind: K.STONE }); }
  const m = Math.max(2, Math.round(t.d / 2.4));
  for (let i = 0; i < m; i++) { if (r() < 0.25) continue; const x = -t.d / 2 + (i + 0.5) * (t.d / m); for (const sz of [-1, 1]) b.box(t.dv + x, y, -t.du + sz * (t.w / 2 - 0.5), 1.2, rr(r, 0.8, 1.8), 1.0, { col, kind: K.STONE }); }
}
export const legacy = {
  tree(b, s, { rng: r }) {
    const t = s.tiers[0], tr = t.d / 2, x = t.dv, h = t.y1, dir = inward(s);
    b.cyl(x, 0, 0, tr * 1.25, tr * 0.95, h * 0.35, 12, { col: pick(r, BARK), kind: K.BARK, var: r(), caps: '' });
    b.cyl(x, h * 0.35, 0, tr * 0.95, tr * 0.7, h * 0.65 + 2, 12, { col: pick(r, BARK), kind: K.BARK, var: r(), caps: 't', uvY0: h * 0.35 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rr(r, -0.25, 0.25), L = tr * rr(r, 1.5, 2.3), ax = Math.cos(a), az = Math.sin(a);
      if (ax * dir > 0.3) continue; // no roots into the stream corridor
      b.pipe([x + ax * tr * 0.6, rr(r, 5, 9), az * tr * 0.6], [x + ax * L, -0.3, az * L], tr * 0.32, 6, { col: pick(r, BARK), kind: K.BARK, r1: tr * 0.12 });
    }
    for (let i = 0; i < 4; i++) {
      const y = h * rr(r, 0.62, 0.95), a = rr(r, -1.3, 1.3), out = -dir;
      const ex = x + out * Math.cos(a) * rr(r, 6, 12), ez = Math.sin(a) * rr(r, 6, 14);
      b.pipe([x, y, 0], [ex, y + rr(r, 4, 9), ez], tr * rr(r, 0.22, 0.32), 6, { col: pick(r, BARK), kind: K.BARK, r1: tr * 0.08 });
      foliage(b, ex, y + rr(r, 6, 10), ez, rr(r, 5, 7.5), 0.6, { col: pick(r, LEAF), var: r(), seed: i + h });
    }
    canopy(b, x - dir * 2, h + 3, 0, rr(r, 12, 17), r, 8, -dir);
    if (r() < 0.45) {
      const y = h * rr(r, 0.82, 0.95), ex = x + dir * rr(r, 10, 16), ez = rr(r, -6, 6);
      b.pipe([x, y, 0], [ex, y + rr(r, 10, 16), ez], tr * 0.28, 6, { col: pick(r, BARK), kind: K.BARK, r1: tr * 0.1 });
      foliage(b, ex, y + rr(r, 15, 20), ez, rr(r, 6, 9), 0.55, { col: pick(r, LEAF), var: r() });
    }
    vines(b, x + dir * tr * 0.9, h * 0.9, 0, h * 0.35, r, 3);
    b.cyl(x, h * 0.3, 0, tr * 1.0, tr * 0.98, 1.2, 12, { col: MOSS, kind: K.LEAF, caps: '' });
  },
  ruin(b, s, { rng: r }) {
    const c = pick(r, STONE);
    drawTiers(b, s, () => ({ col: c, kind: K.STONE, var: r(), top: { col: MOSS, kind: K.LEAF } }));
    for (const t of s.tiers) {
      for (let y = 10; y < t.y1 - 3; y += rr(r, 9, 14)) b.box(t.dv, y, -t.du, t.d + 0.6, 0.7, t.w + 0.6, { col: mulC(c, 0.9), kind: K.STONE });
      const lite = s.role === 'outer';
      if (!lite) arches(b, s, t, r);
      crenels(b, t, r, c);
      if (!lite && r() < 0.6) { const fx = faceX(s, t); b.box(fx + inward(s) * 0.15, t.y1 * rr(r, 0.4, 0.7), -t.du + rr(r, -2, 2), 0.3, 3.2, 3.2, { col: 0x6a6a52, kind: K.STONE }); }
      if (!lite) vines(b, faceX(s, t) + inward(s) * 0.2, t.y1, -t.du, rr(r, 6, 14), r, 4);
      if (!lite && r() < 0.55) for (let k = 0; k < 2; k++) { const z = rr(r, -t.w / 2, t.w / 2); b.pipe([faceX(s, t) + inward(s) * 0.3, t.y1 * rr(r, 0.5, 0.9), -t.du + z], [faceX(s, t) + inward(s) * 0.4, 0, -t.du + z + rr(r, -5, 5)], 0.5, 5, { col: pick(r, BARK), kind: K.BARK, r1: 0.9 }); }
      foliage(b, t.dv, t.y1 + 0.6, -t.du, Math.min(t.d, t.w) * 0.45, 0.35, { col: pick(r, LEAF), var: r(), seed: t.y1 });
    }
    if (s.isPlatform) railing(b, s, s.tiers[0], { col: 0x7a7a66, kind: K.STONE, post: 0.4, step: 1.4, h: 0.9 });
  },
  bridgeHigh(b, s, { rng: r }) {
    const L = s.d, w = s.w;
    b.box(0, s.y0, 0, L, s.h - s.y0, w, { col: 0x8a8a74, kind: K.STONE, faces: 'xXzZtb', top: { col: MOSS, kind: K.LEAF } });
    for (const z of [-w / 2 + 0.3, w / 2 - 0.3]) for (let x = -L / 2 + 1; x < L / 2; x += 2.2) if (r() > 0.2) b.box(x, s.h, z, 1.6, rr(r, 0.6, 1.1), 0.5, { col: 0x9a9a82, kind: K.STONE });
    for (let x = -L / 2 + 2; x < L / 2; x += rr(r, 2.5, 4.5)) vines(b, x, s.y0, rr(r, -w / 3, w / 3), rr(r, 2, 5.5), r, 1);
    const side = r() < 0.5 ? -1 : 1; b.pushTRS(side * (L / 2 - 6), s.y0 - 6, 0); b.arch(0, 0, 0, 8, 1.6, w * 0.8, 6, { col: 0x7a7a66, kind: K.STONE, rise: 0.7 }); b.pop();
  },
  bridgeLow(b, s, { rng: r }) {
    const L = s.d, w = s.w, R = L / 2 - 3, y0 = s.y0;
    b.box(0, y0, 0, L, s.h - y0, w, { col: 0x8a8a74, kind: K.STONE, faces: 'xXzZtb', top: { col: 0x6a7a4a, kind: K.STONE } });
    b.arch(0, y0 - R * 0.55, 0, R * 2, 2.4, w * 0.92, 14, { col: 0x7e806a, kind: K.STONE, rise: 0.55 });
    for (const sx of [-1, 1]) b.box(sx * (R + 1.2), 0, 0, 3.6, y0 - R * 0.55 + 0.1, w * 0.9, { col: 0x76786a, kind: K.STONE });
    for (const z of [-w / 2 + 0.3, w / 2 - 0.3]) b.box(0, s.h, z, L, 0.9, 0.5, { col: 0x9a9a82, kind: K.STONE });
    for (let x = -L / 2 + 2; x < L / 2; x += 3) vines(b, x, y0, rr(r, -w / 3, w / 3), rr(r, 2, 6), r, 1);
  },
  obstacle(b, s, { rng: r }) {
    b.box(0, s.y0, 0, s.d, s.h - s.y0, s.w, { col: 0x84846e, kind: K.STONE, var: r(), faces: 'xXzZtb', top: { col: MOSS, kind: K.LEAF } });
    for (let x = -s.d / 2 + 3; x < s.d / 2; x += 5) b.pipe([x, s.h + 0.3, -s.w / 2 - 0.3], [x + rr(r, -2, 2), s.y0 - 0.3, s.w / 2 + 0.3], 0.7, 5, { col: pick(r, BARK), kind: K.BARK });
    for (let x = -s.d / 2 + 2; x < s.d / 2; x += 3) vines(b, x, s.y0, rr(r, -s.w / 3, s.w / 3), rr(r, 2, 5), r, 1);
  },
  closure(b, s, { rng: r }) {
    b.box(0, 0, 0, s.d, s.h, s.w, { col: 0x7e806a, kind: K.STONE, var: r(), top: { col: MOSS, kind: K.LEAF } });
    for (let x = -s.d / 2 + 6; x < s.d / 2; x += 12) canopy(b, x, s.h + 3, 0, 9, r, 4, 0);
  },
  landmarkArch(b, s, { rng: r }) {
    const R = s.d / 2 - 2, sy = s.y0 - R * 0.62;
    b.arch(0, sy, 0, R * 2, s.h - s.y0 + 1, s.w, 18, { col: 0x8a8a74, kind: K.STONE, rise: 0.62 });
    for (const sx of [-1, 1]) b.box(sx * (R + 3), 0, 0, 7, sy + 0.5, s.w + 1, { col: 0x7a7c68, kind: K.STONE });
    for (let i = 0; i < 9; i++) { const x = rr(r, -R, R); vines(b, x, s.y0 - 1, rr(r, -s.w / 3, s.w / 3), rr(r, 3, 9), r, 1); }
    foliage(b, 0, s.h + 0.8, 0, 9, 0.3, { col: MOSS, var: r() });
  },
  moduleDecor(b, ctx) {
    const { m, rng: r, local, glow: g, halfW } = ctx;
    for (let u = rr(r, 2, 6); u < m.L; u += rr(r, 5, 9)) {
      const v = (r() < 0.5 ? -1 : 1) * rr(r, halfW * 0.45, halfW + 1), [x, z] = local(u, v);
      b.blob(x, 0.2, z, rr(r, 1.2, 3.2), 0.6, { col: pick(r, [0x7a7a68, 0x6a6c5a, 0x8a8a72]), kind: K.STONE, var: r(), seed: u });
      if (r() < 0.5) foliage(b, x + rr(r, -1, 1), 1.4, z, rr(r, 1, 1.8), 0.6, { col: pick(r, LEAF), var: r(), seed: u + 2 });
    }
    for (let k = 0; k < 2; k++) {
      const u = rr(r, 10, m.L - 10), side = r() < 0.5 ? -1 : 1, [x, z] = local(u, side * (halfW + 3)), y = rr(r, 20, 50);
      g.quad([x - 3, y - 26, z], [x + 3, y - 26, z], [x + 6, y + 14, z - 3], [x, y + 14, z - 3], 0x6a6236, 2, 0, [0, 0, 1, 1]);
    }
  },
};
export { pathY };
