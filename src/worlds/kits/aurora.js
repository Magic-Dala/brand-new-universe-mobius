// Aurora Ice City / 極光冰城 — tall snow-covered stone castles (blue-grey ashlar, warm gothic windows, battlements,
// snow caps, icicles, conical slate roofs), round towers, ice-clad crystal spires (restrained: opaque ice shader with
// fresnel glow, no transparency stacks), arched stone bridges under snow, a frozen canal with cracks reflecting the
// aurora, snowy pines on the banks and the ice palace ahead. Anchor devices keep dark mounts + bright cyan centres.
import * as THREE from 'three';
import { foliage } from '../../art/treeFoliage.js';
import { K, pick, rr, inward, faceX, drawTiers, railing, lantern, mulC } from './common.js';
import { AURORA_PARTS, AURORA_SLOTS } from '../art/auroraKit.js';
import { toWorld, frameAt, pathY } from '../route.js';

const STONE = [0x5a6680, 0x52607a, 0x626e88, 0x4c5872];
const ICE = [0x8ad0ff, 0x9adcff, 0x7ac4f4], SNOW = 0xf2f6ff, SLATE = 0x2e3650, WARM = 0xffb860;

// Blender parts (tools/blender/build_aurora_kit.py): slot → surface kind; stone / ice / glass colours are set per call.
const SLOT = { stone: { col: STONE[0], kind: K.STONE }, snow: { col: SNOW, kind: K.SNOW }, ice: { col: ICE[0], kind: K.ICE }, glass: { col: WARM, kind: K.EMIS } };
const SLOT_LOOK = AURORA_SLOTS.map((n) => ({ ...SLOT[n], col: new THREE.Color(SLOT[n].col) }));
const _c = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
/** Append Blender part `name` at (x, y, z) (yaw / scale / pitch / roll); o = { stone, ice, glass (hex), dark: unlit window }. */
function part(b, name, x, y, z, yaw = 0, sx = 1, sy = 1, sz = 1, pitch = 0, roll = 0, o = {}) {
  const P = AURORA_PARTS[name], base = b.vcount, n = P.s.length;
  if (o.stone != null) _c[0].set(o.stone);
  if (o.ice != null) _c[1].set(o.ice);
  if (o.glass != null) _c[2].set(o.glass);
  b.pushTRS(x, y, z, yaw, sx, sy, sz, pitch, roll);
  for (let i = 0; i < n; i++) {
    const L = SLOT_LOOK[P.s[i]], sl = P.s[i];
    const col = sl === 0 && o.stone != null ? _c[0] : sl === 2 && o.ice != null ? _c[1] : sl === 3 && o.glass != null ? _c[2] : L.col;
    const px = P.p[i * 3] / 1000, py = P.p[i * 3 + 1] / 1000, pz = P.p[i * 3 + 2] / 1000;
    b._vert(px, py, pz, P.n[i * 3] / 127, P.n[i * 3 + 1] / 127, P.n[i * 3 + 2] / 127, col, px * sx + pz * sz, py * sy, sl === 3 && o.dark ? K.PLAIN : L.kind, o.v ?? 0);
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
const faceAnchors = (ctx, s, fx, y0, y1) => anchorsOn(ctx.m, s).filter((a) => Math.abs(a.x - fx) < 1.6 && a.y > y0 - 2 && a.y < y1 + 3);
/** True when no device on the face sits within the box z ± half, y - down .. y + up (a device is ~1.9 m in radius). */
const clearAt = (face, z, y, down, up, half = 2.2) => !face.some((a) => Math.abs(a.z - z) < half && a.y > y - down - 1.9 && a.y < y + up + 1.9);

/** A distant pointed window with the same warm/dark silhouette as the modeled lancet. */
function windowInset(b, x, y, z, yaw, sx, sy, lit) {
  const col = lit ? WARM : 0x1a2034, kind = lit ? K.EMIS : K.PLAIN;
  b.pushTRS(x, y, z, yaw, sx, sy, 1);
  const a = [-0.64, 3.05, 0.035], c = [0.64, 3.05, 0.035], tip = [0, 4.35, 0.035];
  b.quad([-0.64, 0, 0.035], [0.64, 0, 0.035], c, a, col, kind);
  b.tri(a, c, tip, col, kind);
  b.pop();
}

/** Modeled jambs near chase height, with thin insets on the other floors. */
function windows(b, s, t, r, anchors, near, target) {
  const dir = inward(s), fx = faceX(s, t), yaw = yawTo(dir, 0), step = near ? 11 : 24, dz = near ? 5.4 : 9;
  const start = Math.max(9, t.y0 + 3), featured = start + Math.max(0, Math.round((target - 2.5 - start) / step)) * step;
  for (let y = start; y < t.y1 - 7; y += step) for (let z = -t.w / 2 + 2.4; z < t.w / 2 - 2; z += dz) {
    if (r() < (near ? 0.26 : 0.5)) continue;
    const tall = near && r() < 0.3, sy = tall ? rr(r, 1.35, 1.6) : 1, lit = r() < 0.64;
    const zz = -t.du + z, sx = tall ? 1.1 : 1;
    if (y + 4.7 * sy > t.y1 - 2 || !clearAt(anchors, zz, y, 0, 4.7 * sy + 0.4, 2.5)) continue;
    if (near && y === featured) part(b, 'window', fx, y, zz, yaw, sx, sy, 1, 0, 0, { glass: lit ? WARM : 0x1a2034, dark: !lit });
    else windowInset(b, fx, y, zz, yaw, sx, sy, lit);
  }
}
function snowCap(b, t, r) { b.box(t.dv, t.y1, -t.du, t.d + 0.3, rr(r, 0.4, 0.8), t.w + 0.3, { col: SNOW, kind: K.SNOW }); }
/** Snow-capped parapet bays on the two long sides of a tier top (the corridor side keeps clear of devices). */
function parapets(b, s, t, anchors, near = true) {
  const dir = inward(s), n = Math.max(1, Math.round(t.w / 6.5)), bay = t.w / n;
  for (const side of [-1, 1]) {
    const x = t.dv + dir * side * (t.d / 2 - 0.4);
    for (let i = 0; i < n; i++) {
      const z = -t.du - t.w / 2 + bay * (i + 0.5);
      if (side === -1 && !near) continue;
      if (side === 1 && !clearAt(anchors, z, t.y1, 0, 1.4, bay / 2 + 1)) continue;
      part(b, 'parapet', x, t.y1 + 0.2, z, Math.PI / 2, bay / 2, 1, 1);
    }
  }
}
/** A flat dressed stone face over the corridor side of a tier (the mounting surface for devices) with a snow cap. */
function dressedFace(b, s, t, col, depth) {
  const dir = inward(s), dd = Math.min(depth, t.d * 0.6);
  b.box(faceX(s, t) - dir * dd / 2, t.y0, -t.du, dd, t.y1 - t.y0, t.w, { col, kind: K.STONE, var: 0.5, top: { col: SNOW, kind: K.SNOW } });
}
/** Ice spires sprout behind the parapet, leaning away from the playable corridor. */
function shardGroup(b, s, t, r, n) {
  const dir = inward(s), fx = faceX(s, t);
  for (let k = 0; k < n; k++) {
    const scale = rr(r, 1.9, 3.8), back = rr(r, 2.4, Math.max(2.6, t.d * 0.45));
    const x = fx - dir * back, z = -t.du + rr(r, -t.w / 2 + 2, t.w / 2 - 2);
    const yaw = yawTo(-dir, 0) + rr(r, -0.9, 0.9);
    part(b, k % 3 === 2 ? 'shard_b' : 'shard_a', x, t.y1 - 0.2, z, yaw, scale * 0.8, scale * rr(r, 0.9, 1.35), scale * 0.73,
      rr(r, 0.1, 0.3), 0, { ice: pick(r, ICE), v: r() });
  }
}

/** A broad, wall-rooted ice formation below the nearest row of Anchor devices. */
function wallIce(b, s, t, r, anchors, target) {
  const dir = inward(s), x = faceX(s, t) - dir * 0.32;
  const y = Math.max(t.y0 + 2, target - 13.5), z = -t.du + (r() < 0.5 ? -1 : 1) * t.w * 0.23;
  if (y + 10 > t.y1 - 1 || !clearAt(anchors, z, y, 0.6, 10, 3.4)) return;
  const yaw = yawTo(dir, 0) + rr(r, -0.22, 0.22), col = pick(r, ICE);
  part(b, 'shard_a', x, y, z, yaw, 2.7, 1.83, 1.6, 0.24, 0, { ice: col, v: r() });
  part(b, 'shard_b', x, y - 0.25, z + 1.1, yaw - 0.28, 1.4, 1.65, 1.2, 0.31, 0, { ice: col, v: r() });
}
/** Lip cornice pieces (4 m each) along a face at height y: layered snow + asymmetric icicles. */
function lips(b, fx, dir, zc, w, y, anchors, r, sy = 1) {
  const yaw = yawTo(dir, 0), n = Math.max(1, Math.round(w / 4));
  for (let i = 0; i < n; i++) {
    const z = zc - w / 2 + (w / n) * (i + 0.5);
    if (r() < 0.4 || !clearAt(anchors, z, y, 3.2 * sy + 0.5, 1.4, 2.6)) continue;
    part(b, 'snow_lip', fx, y, z, yaw, 1, sy, 1);
  }
}
function coneRoof(b, x, y, z, R, h, r) { b.cyl(x, y, z, R, 0.15, h, 12, { col: SLATE, kind: K.TILE, caps: '' }); b.cyl(x, y + h * 0.05, z, R * 1.02, R * 0.4, h * 0.55, 12, { col: SNOW, kind: K.SNOW, caps: '' }); b.cyl(x, y + h, z, 0.12, 0.02, 3, 4, { col: 0x9aa8c0, kind: K.METAL }); void r; }
function pine(b, x, y, z, h) {
  b.cyl(x, y, z, 0.2, 0.12, h * 0.31, 5, { col: 0x3a2a22, kind: K.BARK, caps: '' });
  foliage(b, x, y + h * 0.56, z, h * 0.34, 1.43, { col: 0xffffff, seed: x + z, variant: 'pine', cards: 3 });
}

export const aurora = {
  castle(b, s, ctx) {
    const { rng: r, glow: g } = ctx, near = s.role === 'inner', c = pick(r, STONE);
    const target = pathY(ctx.m, s.u) + 3;
    drawTiers(b, s, () => ({ col: c, kind: K.STONE, var: r(), top: { col: SNOW, kind: K.SNOW } }));
    s.tiers.forEach((t, ti) => {
      const anchors = near ? faceAnchors(ctx, s, faceX(s, t), t.y0, t.y1) : [];
      windows(b, s, t, r, anchors, near, target);
      for (let y = Math.max(12, t.y0 + 5); y < t.y1 - 3; y += 14) {
        b.box(t.dv, y, -t.du, t.d + 0.6, 0.5, t.w + 0.6, { col: mulC(c, 1.1), kind: K.STONE });
        if (near && y < t.y1 - 8) lips(b, faceX(s, t) + inward(s) * 0.3, inward(s), -t.du, t.w, y + 0.4, anchors, r);
        else b.box(t.dv, y + 0.5, -t.du, t.d + 0.7, 0.3, t.w + 0.7, { col: SNOW, kind: K.SNOW });
      }
      snowCap(b, t, r);
      parapets(b, s, t, anchors, near);
      if (ti === s.tiers.length - 1 && !s.isPlatform && near) shardGroup(b, s, t, r, r() < 0.35 ? 2 : 1);
      if (near && ti === 0 && r() < 0.32) wallIce(b, s, t, r, anchors, target);
    });
    const top = s.tiers.at(-1);
    if (r() < 0.45) { const R = Math.min(top.d, top.w) * 0.3, zz = -top.du + (r() < 0.5 ? -1 : 1) * top.w * 0.28, xx = top.dv - inward(s) * top.d * 0.12; b.cyl(xx, top.y1, zz, R, R, 6, 10, { col: c, kind: K.STONE }); coneRoof(b, xx, top.y1 + 6, zz, R * 1.15, R * 3, r); }
    if (s.isPlatform) { railing(b, s, s.tiers[0], { col: c, kind: K.STONE, post: 0.4, step: 1.3, h: 0.9 }); lantern(b, g, faceX(s, s.tiers[0]) + inward(s) * 1.2, s.tiers[0].y1 + 2.4, -s.tiers[0].du, { col: WARM, r: 0.3, body: 0x2a2a34 }); }
  },
  round(b, s, ctx) { // round tower behind a flat dressed face on every tier (devices mount on the face, not on the curve)
    const { rng: r, m } = ctx, near = s.role === 'inner', c = pick(r, STONE), dir = inward(s);
    const target = pathY(m, s.u) + 3;
    s.tiers.forEach((t, ti) => {
      const anchors = near ? faceAnchors(ctx, s, faceX(s, t), t.y0, t.y1) : [], R = Math.min(t.d, t.w) / 2;
      dressedFace(b, s, t, c, 2.6);
      b.cyl(t.dv, t.y0, -t.du, R, R * 0.96, t.y1 - t.y0, 12, { col: c, kind: K.STONE, var: r(), caps: '' });
      windows(b, s, t, r, anchors, near, target);
      for (let y = Math.max(10, t.y0 + 4); y < t.y1 - 6; y += 12) {
        const a = rr(r, 0, 6.28);
        const aa = Math.cos(a) * dir <= 0 ? a : a + Math.PI, radius = R * 0.98;
        windowInset(b, t.dv + Math.cos(aa) * radius, y, -t.du + Math.sin(aa) * radius,
          yawTo(Math.cos(aa), Math.sin(aa)), 0.8, 0.8, r() < 0.6);
        b.cyl(t.dv, y + 5.5, -t.du, R + 0.3, R + 0.3, 0.4, 12, { col: SNOW, kind: K.SNOW });
      }
      parapets(b, s, t, anchors, near);
      if (ti === s.tiers.length - 1 && !s.isPlatform) coneRoof(b, t.dv - dir * t.d * 0.1, t.y1, -t.du, R * 1.1, R * 2.4, r);
    });
  },
  crystal(b, s, ctx) { // ice spire cluster behind a dressed stone face on every tier
    const { rng: r, m } = ctx, near = s.role === 'inner', c = pick(r, STONE), dir = inward(s);
    const target = pathY(m, s.u) + 3;
    s.tiers.forEach((t, ti) => {
      const anchors = near ? faceAnchors(ctx, s, faceX(s, t), t.y0, t.y1) : [];
      dressedFace(b, s, t, c, 3.2);
      b.box(t.dv, t.y0, -t.du, t.d, Math.min(10, (t.y1 - t.y0) * 0.2), t.w, { col: c, kind: K.STONE });
      windows(b, s, t, r, anchors, near, target);
      if (near) wallIce(b, s, t, r, anchors, target);
      if (ti < s.tiers.length - 1) return;
      if (near) shardGroup(b, s, t, r, 2);
      const h = t.y1 - t.y0, back = faceX(s, t) - dir * Math.max(4.5, t.d * 0.5);
      for (let k = 0; k < (near ? 4 : 3); k++) { // one tall main shard, the rest uneven and leaning away from the face
        const main = k === 0, sc = main ? Math.min(t.d, t.w) * 0.16 : rr(r, 1.4, 3.2), len = (main ? h * 0.78 : rr(r, h * 0.25, h * 0.6)) / 4.7;
        const x = main ? back : back - dir * rr(r, -1, Math.max(0, t.d * 0.4 - 4)), z = -t.du + (main ? 0 : rr(r, -t.w / 2 + 3, t.w / 2 - 3));
        part(b, k % 3 === 1 ? 'shard_b' : 'shard_a', x, t.y0 + 1, z, main ? rr(r, 0, 6) : yawTo(-dir, 0) + rr(r, -1, 1), sc * rr(r, 0.9, 1.2), len, sc * rr(r, 0.9, 1.2), main ? 0.04 : rr(r, 0.1, 0.38), 0, { ice: pick(r, ICE), v: r() });
      }
    });
  },
  structure(b, s, ctx) { aurora.castle(b, s, ctx); },
  pillar(b, s, ctx) { aurora.round(b, s, ctx); },
  bridgeHigh(b, s, { rng: r, glow: g, halfW }) { // snowy stone bridge: flat underside where the anchors hang, lipped fascia, snow parapets
    const L = s.d, w = s.w, th = s.h - s.y0, X = Math.min(L / 2, halfW + 3);
    b.box(0, s.y0, 0, L, th, w, { col: STONE[1], kind: K.STONE, faces: 'xXzZtb', top: { col: SNOW, kind: K.SNOW } });
    for (const e of [-1, 1]) {
      const n = Math.max(1, Math.round(X * 2 / 6.5));
      for (let i = 0; i < n; i++) part(b, 'parapet', -X + (2 * X / n) * (i + 0.5), s.h, e * (w / 2 - 0.4), 0, X / n, 1, 1);
      if (th >= 4) for (let x = -X + 2; x < X - 1; x += 7) if (r() < 0.8) part(b, 'snow_lip', x, s.h - 0.5, e * w / 2, yawTo(0, e), 1, Math.min(1, (th - 1) / 2.9), 1);
    }
    for (let x = -L / 2 + 5; x < L / 2; x += 9) lantern(b, g, x, s.h + 2.2, w / 2 - 0.3, { col: WARM, r: 0.26, body: 0x2a2a34 });
  },
  bridgeLow(b, s, { rng: r, halfW }) { // big arched bridge over the frozen canal
    const L = s.d, w = s.w, R = L / 2 - 3, X = Math.min(L / 2, halfW + 3);
    b.box(0, s.y0, 0, L, s.h - s.y0, w, { col: STONE[0], kind: K.STONE, faces: 'xXzZtb', top: { col: SNOW, kind: K.SNOW } });
    b.arch(0, s.y0 - R * 0.6, 0, R * 2, 2.2, w * 0.92, 14, { col: STONE[2], kind: K.STONE, rise: 0.6 });
    for (const sx of [-1, 1]) b.box(sx * (R + 1.1), 0, 0, 3.4, s.y0 - R * 0.6 + 0.1, w * 0.9, { col: STONE[3], kind: K.STONE });
    for (const e of [-1, 1]) {
      const n = Math.max(1, Math.round(X * 2 / 6.5));
      for (let i = 0; i < n; i++) part(b, 'parapet', -X + (2 * X / n) * (i + 0.5), s.h, e * (w / 2 - 0.4), 0, X / n, 1, 1);
    }
    void r;
  },
  obstacle(b, s, { rng: r, halfW }) { // hall carried across the canyon: flat underside (nothing hangs below y0)
    const th = s.h - s.y0, X = Math.min(s.d / 2, halfW + 3);
    b.box(0, s.y0, 0, s.d, th, s.w, { col: STONE[1], kind: K.STONE, var: r(), faces: 'xXzZtb', top: { col: SNOW, kind: K.SNOW } });
    for (const e of [-1, 1]) {
      if (th > 7) for (let x = -X + 3; x < X - 2; x += 6.5) if (r() < 0.75) part(b, 'window', x, s.y0 + 1.2, e * s.w / 2, yawTo(0, e), 1, Math.min(1, (th - 3) / 4.7), 1, 0, 0, { glass: r() < 0.7 ? WARM : 0x1a2034, dark: false });
      if (th >= 5) for (let x = -X + 2; x < X - 1; x += 7) part(b, 'snow_lip', x, s.h - 0.5, e * s.w / 2, yawTo(0, e), 1, Math.min(1, (th - 1.5) / 2.9), 1);
    }
  },
  startPlatform(b, s, ctx) { aurora.bridgeLow(b, s, ctx); },
  closure(b, s, ctx) { aurora.castle(b, { ...s, side: 1, tiers: [{ y0: 0, y1: s.h, w: s.w, d: s.d, du: 0, dv: 0 }] }, ctx); },
  landmarkArch(b, s, { rng: r, halfW }) { // the great high bridge: one dressed arch on each fascia, flat soffit above the 3 devices
    const R = halfW + 3, X = Math.min(s.d / 2, R + 1);
    b.box(0, s.y0, 0, s.d, s.h - s.y0, s.w, { col: STONE[1], kind: K.STONE, faces: 'xXzZtb', top: { col: SNOW, kind: K.SNOW } });
    for (const e of [-1, 1]) {
      b.arch(0, s.y0 + 0.5, e * (s.w / 2 + 0.2), R * 2, 1.4, 0.5, 14, { col: STONE[2], kind: K.STONE, rise: 0.34 });   // blind arch relief inside the fascia
      b.box(0, s.h - 1.4, e * (s.w / 2 + 0.2), s.d - 2, 0.5, 0.5, { col: mulC(STONE[2], 1.1), kind: K.STONE });
      const n = Math.round(X * 2 / 6.5);
      for (let i = 0; i < n; i++) part(b, 'parapet', -X + (2 * X / n) * (i + 0.5), s.h, e * (s.w / 2 - 0.4), 0, X / n, 1, 1);
      for (let x = -X + 2; x < X - 1; x += 7) if (r() < 0.85) part(b, 'snow_lip', x, s.h - 0.5, e * (s.w / 2 + 0.05), yawTo(0, e), 1, 1, 1);
    }
  },
  moduleDecor(b, ctx) { // snowy banks, pines, ice shards, warm lamps along the frozen canal
    const { m, rng: r, local, glow: g, halfW } = ctx;
    for (const side of [-1, 1]) for (let k = 0, n = Math.ceil(m.L / 9); k < n; k++) { const u = (m.L * (k + 0.5)) / n, [x, z] = local(u, side * (halfW + 0.5)); b.box(x, 0, z, 5, rr(r, 0.8, 1.6), m.L / n + 0.2, { col: SNOW, kind: K.SNOW }); }
    for (let u = rr(r, 3, 9); u < m.L; u += rr(r, 9, 15)) { const side = r() < 0.5 ? -1 : 1, [x, z] = local(u, side * (halfW - 0.5)); pine(b, x, 1, z, rr(r, 5, 9)); }
    for (let u = rr(r, 14, 30); u < m.L; u += rr(r, 28, 44)) { const side = r() < 0.5 ? -1 : 1, [x, z] = local(u, side * (halfW + 1.6)), sc = rr(r, 0.8, 1.5); part(b, r() < 0.5 ? 'shard_a' : 'shard_b', x, 1.2, z, rr(r, 0, 6.28), sc, sc * rr(r, 0.9, 1.4), sc, rr(r, 0.1, 0.3), 0, { ice: pick(r, ICE), v: r() }); }
    for (let u = 10; u < m.L; u += 18) for (const side of [-1, 1]) { const [x, z] = local(u, side * (halfW - 2.2)); b.cyl(x, 1, z, 0.1, 0.08, 4.5, 5, { col: 0x2a2a34, kind: K.METAL, caps: '' }); lantern(b, g, x, 5.6, z, { col: WARM, r: 0.28, body: 0x2a2a34 }); }
  },
  backdrop(b, g, { rng: r }) {
    for (let i = 0; i < 22; i++) { const a = (i / 22) * Math.PI * 2, d = rr(r, 820, 980); b.cyl(Math.sin(a) * d, -10, -Math.cos(a) * d, rr(r, 120, 220), 6, rr(r, 160, 300), 6, { col: 0xc8d4ee, kind: K.SNOW, a0: r() * 6 }); }
    for (let i = 0; i < 16; i++) { // nearer snow peaks with icy summits, all around
      const a = (i / 16) * Math.PI * 2 + rr(r, -0.1, 0.1), d = rr(r, 520, 760), x = Math.sin(a) * d, z = -Math.cos(a) * d, h = rr(r, 70, 150);
      if (Math.abs(a - Math.PI) < 0.28 || a < 0.28 || a > 6.0) { if (Math.abs(x) < 120 && z < -480) continue; } // keep the palace axis clear
      b.cyl(x, -10, z, rr(r, 70, 110), 6, h, 7, { col: 0xd6e0f2, kind: K.SNOW, a0: r() * 6 });
      if (r() < 0.55) { const sc = rr(r, 4, 9); part(b, 'shard_a', x, h - 14, z, rr(r, 0, 6.28), sc, sc * rr(r, 1.4, 2.4), sc, rr(r, 0.05, 0.2), 0, { ice: pick(r, ICE), v: r() }); }
    }
    for (let i = 0; i < 34; i++) { // distant stone towers / keeps (fewer, varied)
      const a = (i / 34) * Math.PI * 2 + rr(r, -0.05, 0.05), d = rr(r, 380, 760), x = Math.sin(a) * d, z = -Math.cos(a) * d, h = rr(r, 40, 120), R = rr(r, 7, 14);
      if (z < -420 && Math.abs(x) < 190) continue; // the palace's glacier
      const c = pick(r, STONE);
      if (i % 3 === 2) { b.box(x, 0, z, R * 2.6, h * 0.55, R * 1.8, { col: c, kind: K.STONE }); b.box(x, h * 0.55, z, R * 2.8, 1.2, R * 2, { col: SNOW, kind: K.SNOW }); part(b, 'parapet', x, h * 0.55 + 1.2, z + R * 0.9, 0, R * 1.3, 2, 2); }
      else { b.cyl(x, 0, z, R, R, h, 8, { col: c, kind: K.STONE }); coneRoof(b, x, h, z, R * 1.2, R * 2.4, r); }
      if (r() < 0.4) part(b, 'window', x, h * 0.55, z + R + 0.1, 0, 1.2, 1.2, 1.2, 0, 0, { glass: WARM });
    }
    // the ice palace ahead: a layered stone keep on a glacier under a tall icy summit
    b.pushTRS(0, 0, -620);
    b.cyl(0, -10, 0, 260, 90, 80, 10, { col: 0xd8e2f4, kind: K.SNOW });
    b.cyl(0, 68, 0, 170, 120, 40, 10, { col: 0xc6d6f0, kind: K.SNOW, a0: 2 });
    const tiers = [[160, 70, 38], [122, 56, 34], [84, 42, 34], [52, 30, 30]];
    let y = 106;
    tiers.forEach(([w, d, h], k) => {
      const c = STONE[k % STONE.length];
      b.box(0, y, 0, w, h, d, { col: c, kind: K.STONE, top: { col: SNOW, kind: K.SNOW } });
      b.box(0, y + h, 0, w + 2, 1.6, d + 2, { col: SNOW, kind: K.SNOW });
      const cols = Math.max(3, Math.round(w / 22)), wy = y + h * 0.2;
      for (let i = 0; i < cols; i++) part(b, 'window', -w / 2 + (w / cols) * (i + 0.5), wy, d / 2, 0, 2.2, 2.2, 2.2, 0, 0, { glass: i % 3 === 1 ? 0x1a2034 : WARM, dark: i % 3 === 1 });
      for (let i = 0; i < Math.round(w / 12); i++) part(b, 'parapet', -w / 2 + 6 + i * 12, y + h + 1.2, d / 2 - 1, 0, 3, 2.2, 2.2);
      if (k < 2) for (const sx of [-1, 1]) { const tx = sx * (w / 2 - 3), tr = 8 - k * 1.5, th = h + 34 - k * 8; b.cyl(tx, y, d / 2 - 3, tr, tr, th, 10, { col: c, kind: K.STONE }); coneRoof(b, tx, y + th, d / 2 - 3, tr * 1.15, tr * 3, r); }
      y += h + 1.6;
    });
    const top = y;
    const spires = [[0, 0, 0, 15, 44, 0.04, 'shard_a'], [-20, -4, 0.7, 9, 30, 0.22, 'shard_b'], [19, -3, -0.6, 9.5, 34, -0.2, 'shard_a'], [-8, 8, 2.6, 6, 24, 0.3, 'shard_b'],
      [9, 9, -2.4, 6.5, 26, -0.28, 'shard_a'], [-30, 2, 1.2, 5.5, 20, 0.35, 'shard_a'], [30, 3, -1.2, 6, 22, -0.32, 'shard_b'], [0, -12, 3.1, 8, 28, 0.2, 'shard_a']];
    for (const [x, z, yaw, sx, sy, pitch, name] of spires) part(b, name, x, top - 1, z, yaw, sx, sy, sx, pitch, 0, { ice: pick(r, ICE), v: r() });
    g.blob(0, 210, 0, 120, 1, { col: 0x0a3a5a, kind: 3, jitter: 0 });
    b.pop();
  },
};
