// Neon Tech City / 霓虹科技城: cool lit windows, facade-mounted LED ads, layered towers, and a wet street.
// The signs and their small halos share the streamed architecture and glow meshes.
import { foliage } from '../../art/treeFoliage.js';
import * as THREE from 'three';
import { K, pick, rr, inward, faceX, drawTiers, band, railing } from './common.js';
import { GeoBuilder } from '../art/builder.js';
import { NEON_FACADE, NEON_POSTER_COUNT, NEON_SIGN } from '../art/neonAds.js';
import { NEON_PARTS, NEON_SLOTS } from '../art/neonKit.js';
import { mulberry32 } from '../../data/box.js';

const GLASS = [0x262a4a, 0x20243e, 0x2c2e52];
const METAL = 0x1e2028, CYAN = 0x30e8ff, MAG = 0xff3ad0, AMBER = 0xffb860, PLANT = [0x2e5a3a, 0x3a6a40, 0x6a2a5a];

// Blender parts (tools/blender/build_neon_kit.py): material slot → colour / surface kind.
const SLOT = {
  graphite: { col: 0x24262e, kind: K.METAL }, silver: { col: 0xc4cad6, kind: K.PLAIN }, steel: { col: 0x3a3c4c, kind: K.METAL },
  glass: { col: 0x2a2a3a, kind: K.GLASS, var: 0.9 }, tint: { col: 0x141a2a, kind: K.PLAIN }, cyan: { col: CYAN, kind: K.EMIS },
  violet: { col: 0x9187e0, kind: K.EMIS }, amber: { col: AMBER, kind: K.EMIS }, lamp: { col: 0xfff0d0, kind: K.EMIS },
};
const SLOT_LOOK = NEON_SLOTS.map((n) => ({ ...SLOT[n], col: new THREE.Color(SLOT[n].col), var: SLOT[n].var ?? 0 }));
/** Append Blender part `name` at (x, y, z) with yaw and per-axis scale; uv = planar metres along the dominant normal. */
function part(b, name, x, y, z, yaw = 0, sx = 1, sy = 1, sz = 1) {
  const P = NEON_PARTS[name], base = b.vcount, n = P.s.length;
  b.pushTRS(x, y, z, yaw, sx, sy, sz);
  for (let i = 0; i < n; i++) {
    const px = P.p[i * 3] / 1000, py = P.p[i * 3 + 1] / 1000, pz = P.p[i * 3 + 2] / 1000;
    const nx = P.n[i * 3] / 127, ny = P.n[i * 3 + 1] / 127, nz = P.n[i * 3 + 2] / 127, ax = Math.abs(nx), ay = Math.abs(ny);
    const u = ax > ay && ax > Math.abs(nz) ? pz * sz : px * sx, v = ay >= ax && ay >= Math.abs(nz) ? pz * sz : py * sy;
    const L = SLOT_LOOK[P.s[i]];
    b._vert(px, py, pz, nx, ny, nz, L.col, u, v, L.kind, L.var);
  }
  for (let i = 0; i < P.i.length; i += 3) b.I.push3(base + P.i[i], base + P.i[i + 1], base + P.i[i + 2]);
  b.pop();
}

function edgeStrips(b, s, t, col = CYAN) { // vertical light strips on the two corridor-facing corners
  const fx = faceX(s, t) + inward(s) * 0.06;
  for (const z of [-t.w / 2 + 0.2, t.w / 2 - 0.2]) b.box(fx, t.y0 + 3, -t.du + z, 0.16, t.y1 - t.y0 - 3, 0.16, { col, kind: K.EMIS });
}
const SPILL = [0x9a348c, 0x337db9, 0x7956c7, 0x9d4b75, 0x358b81, 0xa03c9d, 0x995e30, 0x4658a5];
function billboard(b, g, s, t, m, hero = false) {
  const r = mulberry32((s.seed ^ 0x4e5443) >>> 0);
  if (!hero && s.role !== 'inner' && s.role !== 'outer') return;
  if (!hero && r() > (s.role === 'inner' ? 0.78 : 0.23)) return;
  const end = r() < 0.44; // signs on end faces can be seen farther down the street
  const wide = r() < 0.54;
  const width = Math.min((end ? t.d : t.w) * 0.72, wide ? 16 : 8.5);
  const height = wide ? width * 0.67 : width * 1.5;
  const lo = t.y0 + 3, hi = t.y1 - height - 3;
  if (hi < lo) return;
  const y = [m.yIn + (hero ? 19 : rr(r, -18, 13)), m.yIn - 25, m.yIn + 24, t.y0 + 7]
    .map(h => Math.min(hi, Math.max(lo, h)))
    .find(h => !m.anchors.some(a => a.sid === s.id && a.y > h - 3 && a.y < h + height + 3));
  if (y === undefined) return;

  const alongRoute = m.s0 + Math.max(0, s.u);
  const index = (Math.floor(alongRoute / 13) + (s.side > 0 ? 4 : 0)) % NEON_POSTER_COUNT;
  const dir = inward(s), z = -t.du, x = faceX(s, t);
  const plane = (builder, w, h, offset, col, kind, variant) => {
    const point = (u, v) => end ? [t.dv + u, y + height / 2 + v, z + t.w / 2 + offset] :
      [x + dir * offset, y + height / 2 + v, z - dir * u];
    builder.quad(point(-w / 2, -h / 2), point(w / 2, -h / 2), point(w / 2, h / 2), point(-w / 2, h / 2),
      col, kind, variant, [0, 0, 1, 1]);
  };
  const housing = { col: 0x161522, kind: K.PLAIN };
  // The screen clears the facade's 22 cm trim. Its shallow housing connects it to the wall.
  if (end) b.box(t.dv, y, z + t.w / 2 + 0.15, width, height, 0.30, { ...housing, faces: 'xXtb' });
  else b.box(x + dir * 0.15, y, z, 0.30, height, width, { ...housing, faces: 'zZtb' });
  plane(b, width, height, 0.302, 0xffffff, NEON_SIGN, index);
  plane(g, width * 1.32, height + 4.2, 0.075, SPILL[index], 4, 0);
}

function roofline(b, top, r, near) { // near: the corridor row gets the Blender crown / plant, the outer row cheap primitives
  const x = top.dv, y = top.y1, z = -top.du, d = top.d, w = top.w;
  const style = r();
  if (style < 0.33) {
    if (near) part(b, 'roof_crown', x, y, z, 0, d * 0.094, 1, w * 0.094); // stepped octagonal crown, lit band + fins
    else {
      b.frustum(x, y, z, d * 0.94, w * 0.94, 7.5, d * 0.52, w * 0.60, { col: 0x393754, kind: K.METAL });
      b.box(x, y + 7.5, z, d * 0.52, 0.45, w * 0.6, { col: 0x9187e0, kind: K.EMIS });
    }
  } else if (style < 0.66) {
    b.box(x - d * 0.12, y, z, d * 0.66, 5, w * 0.65, { col: GLASS[1], kind: NEON_FACADE, var: r() });
    b.box(x - d * 0.17, y + 5, z, d * 0.35, 6, w * 0.40, { col: GLASS[2], kind: NEON_FACADE, var: r() });
  } else if (near) {
    const k = Math.min(d * 0.56 / 9, w * 0.62 / 8); // mechanical plant: round fan shrouds stay round
    part(b, 'roof_mech', x, y, z, 0, k, 1, k);
  } else {
    b.box(x, y, z, d * 0.56, 3.3, w * 0.62, { col: METAL, kind: K.METAL });
    b.box(x, y + 3.05, z, d * 0.6, 0.21, w * 0.66, { col: 0x8f61cb, kind: K.EMIS });
  }
}
function terrace(b, s, t, r, y0, m) { // a half-round terrace on wall brackets with a tree and an amber light channel
  const fx = faceX(s, t), dir = inward(s), cx = fx + dir * 1.6, z = -t.du + rr(r, -t.w / 4, t.w / 4), col = pick(r, PLANT), vr = r();
  // keep the swing anchors on this face readable: the terrace (brackets 2.9 m down, tree 4.7 m up) moves clear of them
  const y = [y0, y0 - 8, y0 - 16].find((h) => h > t.y0 + 8 && h < t.y1 - 6 && !m.anchors.some((a) => a.sid === s.id && a.y > h - 6 && a.y < h + 6));
  if (y === undefined) return;
  part(b, 'terrace_arc', fx, y, z, dir > 0 ? 0 : Math.PI);
  const bark = { col: 0x4a3830, kind: K.BARK, caps: '' };
  b.cyl(cx, y, z, 0.15, 0.075, 2.65, 5, bark);
  b.pipe([cx, y + 1.45, z], [cx + dir * 0.54, y + 2.55, z - 0.46], 0.082, 4, { ...bark, r1: 0.028 });
  foliage(b, cx, y + 3, z, 1.7, 0.8, { col, var: vr });
}
export const neon = {
  tower(b, s, { rng: r, glow: g, m }) {
    const c = pick(r, GLASS);
    drawTiers(b, s, () => ({ col: c, kind: NEON_FACADE, var: r(), top: { col: METAL, kind: K.METAL } }));
    for (const t of s.tiers) {
      band(b, t, t.y0, 4.5, 0.25, METAL, K.METAL);
      for (let y = t.y0 + 14; y < t.y1 - 2; y += rr(r, 16, 24)) band(b, t, y, 0.6, 0.22, METAL, K.METAL, 'xXzZ');
      band(b, t, t.y1 - 1.2, 1.2, 0.4, 0x2a2e38, K.METAL);
      if (r() < 0.38) edgeStrips(b, s, t, r() < 0.70 ? 0x829bfb : 0xd466bb);
    }
    const top = s.tiers.at(-1);
    if (!s.isPlatform) roofline(b, top, r, s.role !== 'outer');
    billboard(b, g, s, s.tiers[0], m);
    // terraces hang 10–18 m under the chase line: in view at chase height, below the swing arcs
    if (s.role === 'inner' && !s.isPlatform && r() < 0.5) terrace(b, s, s.tiers[0], r, m.yIn + rr(r, -18, -10), m);
    if (s.isPlatform) { const f = s.tiers[0]; railing(b, s, f, { col: 0x8ab0d0, kind: K.GLASS, h: 1.15, step: 0.8 }); b.box(faceX(s, f) + inward(s) * 0.2, f.y1 + 0.02, -f.du, 0.2, 0.1, f.w - 0.4, { col: CYAN, kind: K.EMIS }); }
  },
  tower2(b, s, { rng: r, glow: g, m }) {
    drawTiers(b, s, () => ({ col: 0x2e3442, kind: NEON_FACADE, var: r() + 0.5, top: { col: METAL, kind: K.METAL } }));
    for (const t of s.tiers) {
      for (let y = t.y0 + 8; y < t.y1 - 1; y += 12) band(b, t, y, 0.22, 0.06, 0x6865ae, K.EMIS, 'xXzZ');
      band(b, t, t.y0, 6, 0.3, METAL, K.METAL);
    }
    if (!s.isPlatform) roofline(b, s.tiers.at(-1), r, s.role !== 'outer');
    billboard(b, g, s, s.tiers[0], m);
    if (s.isPlatform) railing(b, s, s.tiers[0], { col: 0x8ab0d0, kind: K.GLASS, h: 1.15, step: 0.8 });
  },
  structure(b, s, ctx) { neon.tower(b, s, ctx); },
  pillar(b, s, ctx) { neon.tower(b, s, ctx); },
  bridgeHigh(b, s, { rng: r, halfW }) { // enclosed skybridge: layered Blender deck / cap / keel, lit truss bays, end collars
    const L = s.d, w = s.w, y0 = s.y0, H = s.h - s.y0, cs = (w / 2 + 0.3) / 3.3;
    part(b, 'skybridge_deck', 0, y0, 0, 0, L, 1, w / 6);
    b.box(0, y0 + 0.8, 0, L, H - 1.4, w * 0.94, { col: 0x5a4a3a, kind: K.GLASS, var: 0.9, faces: 'zZ' });
    part(b, 'skybridge_cap', 0, s.h, 0, 0, L, 1, cs);
    // Underside anchors hang at y0 - 0.45 m. Keep the central beam shallower than their mounting height.
    part(b, 'skybridge_keel', 0, y0, 0, 0, L * 0.98, 0.30, w / 6);
    const bays = Math.ceil(L / 6), bay = L / bays;
    for (const z of [-w * 0.48, w * 0.48]) for (let i = 0; i < bays; i++) {
      part(b, i % 2 ? 'skybridge_truss_b' : 'skybridge_truss_a', -L / 2 + bay * (i + 0.5), y0 + 0.8, z, 0, bay / 6, (H - 1.4) / 2.1, 1);
    }
    if (halfW + 1 < L / 2) for (const x of [-halfW - 0.5, halfW + 0.5]) part(b, 'skybridge_collar', x, y0, 0, 0, 1, H / 3.5, cs);
    void r;
  },
  bridgeLow(b, s, ctx) { // open deck with illuminated railings
    const { rng: r } = ctx, L = s.d, w = s.w;
    // the walking surface (s.h, full width) is the Blender deck; a recessed girder carries it down to s.y0
    part(b, 'skybridge_deck', 0, s.h - 0.8, 0, 0, L, 1, w / 6);
    b.box(0, s.y0, 0, L, s.h - s.y0 - 0.8, w * 0.86, { col: 0x24262e, kind: K.METAL, faces: 'xXzZb' });
    for (const z of [-w / 2 + 0.2, w / 2 - 0.2]) {
      b.box(0, s.h + 0.45, z, L, 0.07, 0.1, { col: 0x747691, kind: K.METAL });
      b.box(0, s.h + 1.1, z, L, 0.08, 0.14, { col: CYAN, kind: K.EMIS });
      for (let x = -L / 2 + 0.4; x < L / 2; x += 2.8) {
        b.box(x, s.h, z, 0.10, 1.1, 0.10, { col: 0x747691, kind: K.METAL });
      }
    }
    for (let x = -L / 2 + 3; x < L / 2; x += 6) b.box(x, s.y0 - 0.2, 0, 0.6, 0.2, w * 0.8, { col: AMBER, kind: K.EMIS });
    void r;
  },
  obstacle(b, s, { rng: r }) { // an elevated transit station across the canyon
    b.box(0, s.y0, 0, s.d, s.h - s.y0, s.w, { col: 0x343a48, kind: K.GLASS, var: 0.7, faces: 'xXzZtb', top: { col: METAL, kind: K.METAL } });
    for (const y of [s.y0, s.h - 0.8]) b.box(0, y, 0, s.d, 0.8, s.w + 0.4, { col: METAL, kind: K.METAL, faces: 'xXzZtb' });
    for (const z of [-s.w / 2 - 0.25, s.w / 2 + 0.25]) b.box(0, s.y0 + 0.6, z, s.d, 0.18, 0.12, { col: MAG, kind: K.EMIS });
    void r;
  },
  startPlatform(b, s, ctx) { neon.bridgeLow(b, s, ctx); },
  closure(b, s, ctx) { neon.tower(b, { ...s, side: 1 }, ctx); },
  landmarkTower(b, s, { rng: r, glow: g, m }) {
    const t = s.tiers[0];
    b.box(t.dv, 0, 0, t.d, t.y1, t.w, { col: 0x262e3e, kind: NEON_FACADE, var: r() });
    edgeStrips(b, s, t, 0xb3a0ff);
    for (let y = 20; y < t.y1; y += 24) band(b, t, y, 0.4, 0.13, 0x9778cc, K.EMIS, 'xXzZ');
    b.cyl(t.dv, t.y1, 0, t.d * 0.3, 0.3, 40, 8, { col: 0x8a9ab8, kind: K.METAL });
    billboard(b, g, s, t, m, true);
  },
  moduleDecor(b, ctx) {
    const { m, rng: r, local, glow: g, halfW } = ctx;
    // street trees + cyan lamps
    for (let u = rr(r, 4, 10); u < m.L; u += rr(r, 12, 18)) for (const side of [-1, 1]) {
      const [x, z] = local(u, side * (halfW - 2));
      b.cyl(x, 0, z, 0.2, 0.16, 3, 5, { col: 0x2a2220, kind: K.BARK, caps: '' }); foliage(b, x, 4.2, z, 2.0, 0.8, { col: pick(r, PLANT), var: r() });
    }
    for (let u = 8; u < m.L; u += 20) for (const side of [-1, 1]) { const [x, z] = local(u, side * (halfW - 0.8)); b.cyl(x, 0, z, 0.1, 0.08, 7, 5, { col: METAL, kind: K.METAL, caps: '' }); b.box(x, 7, z, 0.3, 0.2, 1.4, { col: CYAN, kind: K.EMIS }); g.blob(x, 6.8, z, 1.2, 0.6, { col: 0x0a4a5a, kind: 3, jitter: 0 }); }
    // the monorail guideway beside the corridor (outer row side), on pylons
    const side = m.idx % 4 < 2 ? 1 : -1, off = halfW + 24, y = Math.max(16, (m.yIn + m.yOut) / 2 - 10), n = Math.ceil(m.L / 8);
    for (let k = 0; k < n; k++) {
      const u0 = (m.L * k) / n, u1 = (m.L * (k + 1)) / n, [x0, z0] = local(u0, side * off), [x1, z1] = local(u1, side * off);
      b.pipe([x0, y, z0], [x1, y, z1], 1.1, 6, { col: 0x2a2c34, kind: K.METAL, caps: '' });
      b.pipe([x0, y - 1.05, z0], [x1, y - 1.05, z1], 0.12, 4, { col: CYAN, kind: K.EMIS, caps: '' });
      if (k % 3 === 0) b.box(x0, 0, z0, 1.6, y - 1, 1.6, { col: 0x24262e, kind: K.METAL });
    }
  },
  backdrop(b, g, { rng: r }) {
    // Three layers of clustered towers fill the skyline in every direction.
    for (const [count, min, max, maxHeight] of [[62, 265, 435, 166], [80, 460, 650, 272], [112, 660, 1010, 325]]) {
      for (let i = 0; i < count; i++) {
        const angle = i / count * Math.PI * 2 + rr(r, -0.028, 0.028);
        const dist = rr(r, min, max);
        const district = 0.65 + 0.35 * Math.sin(angle * 5 + 1.5) ** 2;
        const h = rr(r, 45, maxHeight) * district;
        const w = rr(r, 17, 38), d = w * rr(r, 0.78, 1.16);
        b.pushTRS(Math.sin(angle) * dist, 0, Math.cos(angle) * dist, angle + rr(r, -0.35, 0.35));
        b.box(0, 0, 0, w, h, d, { col: pick(r, GLASS), kind: NEON_FACADE, var: r() });
        if (i % 3 === 0) b.frustum(0, h, 0, w * 0.87, d * 0.86, rr(r, 8, 22), w * 0.48, d * 0.5, { col: GLASS[1], kind: K.METAL });
        if (i % 5 === 0) b.box(0, h * 0.72, 0, w * 1.01, 0.65, d * 1.02, { col: i % 2 ? 0x9973df : 0x83a1eb, kind: K.EMIS, faces: 'xXzZ' });
        if (min < 600 && i % 7 === 1) {
          const x = w * 0.37, z = -d / 2 - 0.12, y = h * 0.46;
          b.quad([x, y, z], [-x, y, z], [-x, y + 17, z], [x, y + 17, z],
            0xffffff, NEON_SIGN, (i + min) % NEON_POSTER_COUNT, [0, 0, 1, 1]);
        }
        b.pop();
        if (min === 460 && i % 12 === 2) {
          g.pushTRS(Math.sin(angle) * dist, h, Math.cos(angle) * dist, angle + Math.PI);
          g.quad([-1.3, 0, 0], [1.3, 0, 0], [19, 205, 0], [8, 205, 0], 0x8271ff, 5, 0, [0, 0, 1, 1]);
          g.pop();
        }
      }
    }
    // the needle spire with rings, ahead
    b.pushTRS(10, 0, -640);
    b.cyl(0, 0, 0, 22, 8, 260, 10, { col: 0x2a3446, kind: K.GLASS, var: 0.2 });
    b.cyl(0, 260, 0, 8, 0.4, 120, 8, { col: 0xc8d0ff, kind: K.EMIS });
    for (const [y, R] of [[150, 44], [205, 34], [248, 22]]) { b.cyl(0, y, 0, R, R, 2.5, 32, { col: 0xd0a8ff, kind: K.EMIS, caps: '' }); g.blob(0, y, 0, R * 1.2, 0.08, { col: 0x3a1a5a, kind: 3, jitter: 0 }); }
    g.blob(0, 300, 0, 60, 1.6, { col: 0x2a1a4a, kind: 3, jitter: 0 });
    b.pop();
  },
  /** The monorail train: a short articulated train gliding along the guideway (scenery). */
  animate(R, dt, t, cam) {
    const w = R.world; if (!w || !w.live.size) return;
    if (!R._train) {
      const tb = new GeoBuilder();
      // Blender cabs at both ends (the leading nose faces +z, the direction of travel) and a middle car
      part(tb, 'train_cab', 0, 0, 0, Math.PI); part(tb, 'train_car', 0, 0, 11); part(tb, 'train_cab', 0, 0, 22);
      R._train = new THREE.Mesh(tb.build(), R.mat); R._train.name = 'monorail-train'; R.root.add(R._train); R._trainS = 0;
    }
    const pr = w.progress(cam.x, cam.z), sTr = pr.s + 160 - ((t * 24) % 420);
    const m = w.moduleAtS(sTr); const side = m.idx % 4 < 2 ? 1 : -1, off = m.halfW + 24, y = Math.max(16, (m.yIn + m.yOut) / 2 - 10);
    const p = w.pointAt(sTr), a = w.headingAt(sTr), rx = Math.cos(a), rz = Math.sin(a);
    R._train.position.set(p.x + rx * side * off, y + 1.1, p.z + rz * side * off); R._train.rotation.y = -a;
    R._train.visible = w.live.has(m.idx);
  },
  disposeExtras(R) { R._train?.geometry.dispose(); },
};
