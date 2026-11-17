// v0.27 Dala City near-art layers (city quality stages 2 + 3) — renderer only, never imported by src/data.
//
// Every layer is pure decoration built from data the city already has (cell content, building tiers / faces / seeds)
// plus an INDEPENDENT integer hash of (cell i, j, building seed, slot) — no random draw anywhere in the data RNG, so
// routes, buildings, colliders, anchors, coins and story data cannot move (tests/citydata-golden.test.mjs).
// No layer has a collider; world.pointBlocked() is only READ to keep props / cars out of the home tower / factory
// footprints. Each layer can be switched off on its own (City feature in the dev menu, src/art/cityQuality.js).
//
// Layers (built per cell, ≤ 1 cell-layer per frame, nearest first, released with +30 m hysteresis):
//   ledge   sill courses (one stone strip per floor) + storefront belt + limestone pilasters   ≤ ledgeRange (70 m)
//   awning  slanted shop awnings matching the storefront texture's sign colours              ≤ 90 m
//   curb    raised sidewalks (0.13 m) with a real curb face, same street shader on top        ≤ 140 m
//   props   corner kits: traffic-signal pole + mast arm + heads, hydrant, trash can, news box  ≤ 120 m
//   signs   projecting blade signs over shops (one shared 1024×512 atlas, original names)     ≤ 90 m
//   cars    parked cars in the curb lanes                                                      ≤ 120 m
// Global (not per cell):
//   traffic a few cars driving the north–south streets: lights, car-following, stop for the player, despawn far away
//   signals traffic-light phases (north–south / east–west) shown on the signal heads, used by the traffic
//   trees   layered leaf cards and branches (same pool / instances)
//   skyline redrawn far silhouette (setbacks, spires, antennas, water towers, haze layers) — same single mesh
import * as THREE from 'three';
import { Bucket, CYL } from './geom.js';
import { canvasTexture, rng } from './toon.js';
import { Billboards } from './particles.js';
import { streetTreeGeometry } from './treeFoliage.js';

const FACE_N = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] };
/** Independent decoration hash → [0, 1). */
export function artHash(a, b = 0, c = 0, d = 0) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2246822519 | 0) + Math.imul(d | 0, 3266489917 | 0)) | 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507 | 0); h = Math.imul(h ^ (h >>> 13), 3266489909 | 0);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export const ART_RANGES = { ledge: null, awning: 80, curb: 140, props: 100, signs: 85, cars: 100 };
const AWNING_COLORS = [0x3a3a3a, 0x2e6a4a, 0x8a2a2a, 0x2a3e7a]; // = storefront texture awn[(k + 7) % 8], k = 0..3
const HOVER_COLORS = [0xe8ecf2, 0x1c1e26, 0x2a3e6a, 0x9a1e3a, 0xd8d2c8, 0x3a3f48]; // v0.30 hover cars: clean paint (neon does the colour)
const NEON = [0x22e8ff, 0xff2fd0, 0x7cff6a, 0xffb020, 0x8a6bff].map((c) => new THREE.Color(c).multiplyScalar(1.6)); // underglow / strips (unlit, bright)
const CAR_COLORS = [0xb8b4ae, 0x2a2c34, 0x8a1e22, 0x24406a, 0xd8d2c4, 0x5a5e66, 0xc8a23a, 0x3a5a3a, 0xe8e4dc, 0x6a2a4a];
const SIGN_NAMES = [['DALA DELI', '#f2d46a', '#3a1e14'], ['MOBIUS CAFÉ', '#7ef0ff', '#10243a'], ['PIZZA 72', '#ffffff', '#a8241e'], ['NOODLE BAR', '#ffd8a0', '#2a1a2e'],
  ['BOOKS', '#2a1a10', '#e8d8b0'], ['LAUNDRY', '#ffffff', '#2a5a8a'], ['PHARMACY', '#ffffff', '#1e7a4a'], ['BAGELS', '#3a2010', '#f0c070'],
  ['達拉麵館', '#ffe8b0', '#8a1e1e'], ['咖啡', '#f8f0e0', '#4a2e1e'], ['HARDWARE', '#ffd040', '#2a2a2e'], ['BODEGA', '#ffffff', '#c8402a'],
  ['DINER', '#ff8aa8', '#1a1a2a'], ['RAMEN', '#ffffff', '#2a2a2a'], ['FLOWERS', '#2a4a20', '#f0d0e0'], ['HOTEL', '#f6e0a0', '#1e2a4a']];

export function createCityArt({ root, mat, groundMat, makeInstGeo, SlotPool, world, cfg, STYLE_P, STYLE_CORNICE }) {
  const stats = { artMiss: 0, art: {}, traffic: 0 };
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpC = new THREE.Color();
  const vX = new THREE.Vector3(), vY = new THREE.Vector3(0, 1, 0), vZ = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const pools = {};
  const mk = (name, geo, material, cap, colors) => {
    const m = new THREE.InstancedMesh(geo, material, cap); m.name = name;
    if (colors) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    root.add(m); return (pools[name] = new SlotPool(m, cap));
  };
  const P = cfg.pools;

  // ---------------------------------------------------------------- pools
  // ledges + pilasters: the building shader (style 9 = plain stone, dark underside, same light / fog / AO)
  const ledgeGeo = makeInstGeo(P.ledges);
  const ledgePool = mk('ledges', ledgeGeo, mat, P.ledges);
  // awnings: slanted panel + valance (white → instance colour) + two dark arms
  {
    const b = new Bucket(), I = new THREE.Matrix4();
    b.box(I, 1, 0.05, 1.36, 0xffffff, 0, 0.32, 0.6, 0, 0.5, 0); // sloped panel (args ry, rx, rz): high at the wall, ~0.6 m drop to the front
    b.box(I, 1, 0.3, 0.04, 0xffffff, 0, -0.14, 1.22); // valance
    const m = new THREE.MeshLambertMaterial({ vertexColors: true }); m.name = 'awnings';
    mk('awnings', b.build(), m, P.awnings, true);
  }
  // raised sidewalks: unit box, the street shader (instanced variant) on top, curb face darkened in the shader
  mk('walks', new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), groundMat, P.walks);
  // corner kit: signal pole + mast arm + 2 heads, pedestrian head, hydrant, trash can, news box (one instance per corner)
  const SIG_HEADS = [[4.05, 5.05], [7.55, 5.05]]; // [x along the arm, y]: over the two travel lanes (pole at RH + 2.3 from the centre line)
  {
    const b = new Bucket(), I = new THREE.Matrix4(), POLE = 0x2c3034, HEAD = 0x2a2a20;
    b.geo(I, ...CYL(0.1, 0.13, 5.8, 6), POLE, 0, 2.9, 0);
    b.box(I, 8.1, 0.13, 0.13, POLE, 4.05, 5.7, 0); // mast arm over the road (to the centre line)
    b.box(I, 1.2, 0.06, 0.06, POLE, 0.6, 5.35, 0, 0, 0, 0.55); // brace
    for (const [x, y] of SIG_HEADS) { b.box(I, 0.36, 1.0, 0.3, HEAD, x, y, 0); b.box(I, 0.04, 0.45, 0.04, POLE, x, y + 0.7, 0); }
    b.box(I, 0.34, 0.5, 0.28, HEAD, 0.0, 2.75, 0.22); // pedestrian head on the pole
    b.box(I, 0.16, 0.22, 0.12, 0xd8c030, 0.14, 1.15, 0.0); // push button box
    // hydrant (red) at the curb, trash can (dark green), newspaper box (blue) along the sidewalk
    b.geo(I, ...CYL(0.17, 0.19, 0.62, 6), 0xa8241e, 0.6, 0.31, -2.4); b.geo(I, ...CYL(0.2, 0.2, 0.1, 6), 0x8a1e18, 0.6, 0.67, -2.4);
    b.box(I, 0.5, 0.1, 0.1, 0x8a1e18, 0.6, 0.42, -2.4);
    b.geo(I, ...CYL(0.29, 0.25, 0.92, 7), 0x2e4a34, 0.45, 0.46, -5.2); b.geo(I, ...CYL(0.31, 0.31, 0.06, 7), 0x24382a, 0.45, 0.95, -5.2);
    b.box(I, 0.48, 1.05, 0.42, 0x2a4a8a, -0.75, 0.53, -6.4); b.box(I, 0.5, 0.08, 0.44, 0x1e3460, -0.75, 1.08, -6.4);
    const m = new THREE.MeshLambertMaterial({ vertexColors: true }); m.name = 'corner-kits';
    mk('kits', b.build(), m, P.kits);
  }
  // signal lamps (unlit glow; colour = phase): 2 heads × 2 faces per kit
  { const m = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }); m.name = 'signal-lamps'; mk('signalLamps', new THREE.BoxGeometry(0.2, 0.2, 0.04), m, P.kits * 4 + Math.ceil(cfg.traffic.count * 1.75) * 7 + 8, true); }
  // blade signs: one atlas, per-instance atlas rect (aAtlas = offset.xy, scale.zw)
  const signTex = signAtlas();
  {
    const g = new THREE.BoxGeometry(0.08, 0.65, 1.3); // face 1.3 × 0.65 m = the 2:1 atlas tiles (no squashed text)
    g.setAttribute('aAtlas', new THREE.InstancedBufferAttribute(new Float32Array(P.signs * 4), 4));
    const m = new THREE.MeshBasicMaterial({ map: signTex, color: 0xe8e8e8 }); m.name = 'blade-signs';
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aAtlas;').replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = vMapUv * aAtlas.zw + aAtlas.xy;\n#endif');
    };
    m.customProgramCacheKey = () => 'blade-signs-atlas';
    mk('signs', g, m, P.signs);
  }
  // cars: body (white → instance colour), dark cabin glass, wheels, bumpers
  {
    const b = new Bucket(), I = new THREE.Matrix4();
    b.box(I, 1.82, 0.62, 4.4, 0xffffff, 0, 0.62, 0); // body
    b.box(I, 1.62, 0.56, 2.3, 0x9a9a9a, 0, 1.2, -0.15); // roof shell (tinted)
    b.box(I, 1.66, 0.46, 2.1, 0x1a1c22, 0, 1.17, -0.15); // glass band (stays dark)
    b.box(I, 1.86, 0.18, 0.22, 0x3a3a3a, 0, 0.42, 2.2); b.box(I, 1.86, 0.18, 0.22, 0x3a3a3a, 0, 0.42, -2.2); // bumpers
    for (const [x, z] of [[-0.84, 1.4], [0.84, 1.4], [-0.84, -1.4], [0.84, -1.4]]) b.box(I, 0.24, 0.6, 0.62, 0x141416, x, 0.32, z); // wheels (boxes: half the triangles of 10-sided cylinders, unreadable difference at street distance)
    const m = new THREE.MeshLambertMaterial({ vertexColors: true }); m.name = 'cars';
    mk('cars', b.build(), m, P.cars, true);
    // v0.30 traffic2: futuristic hover cars for the MOVING traffic (no wheels; hull + nose wedge + canopy + fins).
    // White parts take the instance colour; neon underglow / side strips / long light trails are signal-lamp instances.
    const h = new Bucket();
    h.box(I, 1.9, 0.42, 4.5, 0xffffff, 0, 0.36, 0.1);                 // hull
    h.box(I, 1.7, 0.2, 4.1, 0x16181e, 0, 0.1, 0.1);                   // dark skirt (the underglow shows around it)
    h.box(I, 1.8, 0.26, 1.3, 0xffffff, 0, 0.38, -2.35, 0, -0.32, 0);   // sloped nose
    h.box(I, 1.46, 0.42, 2.1, 0x14243a, 0, 0.74, 0.35, 0, 0.12, 0);    // glass canopy (stays dark blue)
    h.box(I, 2.05, 0.08, 0.55, 0xffffff, 0, 0.66, 2.25);               // rear wing
    h.box(I, 0.08, 0.3, 0.5, 0xffffff, -0.95, 0.8, 2.25); h.box(I, 0.08, 0.3, 0.5, 0xffffff, 0.95, 0.8, 2.25); // fins
    const hoverGeo = h.build();
    mk('hoverCars', hoverGeo, m, Math.ceil(cfg.traffic.count * 1.75) + 4, true);
    mk('hoverParked', hoverGeo.clone().translate(0, 0.32, 0), m, P.cars, true); // parked hover cars float 0.32 m over the curb lane
  }
  // v0.30c: grey-white thruster smoke under every hover car (one draw call; soft alpha puffs, short-lived, sinking + spreading)
  const smoke = new Billboards(560, { color: 0xe4e4e8, additive: false, gravity: -0.4, drag: 2.2, name: 'hover-smoke' });
  smoke.mesh.renderOrder = 9; smoke.mesh.visible = true; // visible once so the loader's shader compile covers it (update() hides it when empty)
  root.add(smoke.mesh);
  const parkedLive = new Set(); // { x, z, yaw } of parked hover cars (for their idle smoke)
  let smokeAcc = 0, srng = 777;
  const sr = () => { srng = (Math.imul(srng, 1103515245) + 12345) >>> 0; return srng / 4294967296; };
  function puff(x, y, z, strong = 0) {
    smoke.spawn(tmpP.set(x + (sr() - 0.5) * 0.3, y, z + (sr() - 0.5) * 0.3), tmpS.set((sr() - 0.5) * (2.2 + strong * 3), 0.05 + sr() * 0.25 - strong * 0.4, (sr() - 0.5) * (2.2 + strong * 3)),
      { life: 0.7 + sr() * 0.5 + strong * 0.6, size: [0.7 + strong * 0.4, 2.0 + sr() * 0.8 + strong * 1.4], alpha: 0.85 + strong * 0.15, spin: (sr() - 0.5) * 2 });
  }
  const THRUST = [[-0.62, 1.45], [0.62, 1.45], [-0.62, -1.3], [0.62, -1.3]]; // car-local thruster points (x, z)

  // ---------------------------------------------------------------- helpers (building faces, local → world)
  const wx = (b, ox, oz) => b.x + ox * b.cos + oz * b.sin, wz = (b, ox, oz) => b.z - ox * b.sin + oz * b.cos;
  /** Basis for a face: tangent (u increasing, as in the facade shader), up, outward normal — rotated to world. */
  function faceBasis(b, face, t) {
    const [nx, nz] = FACE_N[face.f];
    // u along the face in the facade shader: +z: u = x; +x: u = -z + sx; -z: u = -x + sx + sz; -x: u = z + 2 sx + sz
    const sx = t.hx * 2, sz = t.hz * 2;
    let tx, tz, uBase, half;
    if (nz > 0) { tx = 1; tz = 0; uBase = 0; half = t.hx; } else if (nx > 0) { tx = 0; tz = -1; uBase = sx; half = t.hz; } else if (nz < 0) { tx = -1; tz = 0; uBase = sx + sz; half = t.hx; } else { tx = 0; tz = 1; uBase = 2 * sx + sz; half = t.hz; }
    const off = nx ? t.hx : t.hz; // face plane distance from the centre
    return { nx, nz, tx, tz, uBase, half, off,
      // world point at face param s (= local coordinate along the tangent), outward distance d, height y
      at: (s, d, y, out) => out.set(wx(b, tx * s + nx * (off + d), tz * s + nz * (off + d)), y, wz(b, tx * s + nx * (off + d), tz * s + nz * (off + d))),
      // rotation: local x = tangent, z = outward normal (right-handed: x × y = z)
      quat: (out) => { vX.set(tx * b.cos + tz * b.sin, 0, -tx * b.sin + tz * b.cos); vZ.set(nx * b.cos + nz * b.sin, 0, -nx * b.sin + nz * b.cos); return out.setFromRotationMatrix(tmpM.makeBasis(vX, vY, vZ)); } };
  }
  const seedF = (b) => (b.seed % 1000) / 1000;

  // ---------------------------------------------------------------- per-cell builders → [[pool, handle], ...]
  const LEDGE = { sill: [0.12, 0.16], belt: [0.34, 0.3], sillF: 0.1, maxH: 72, masonry: new Set([0, 1, 2, 3, 6]), pil: [0.34, 0.14] };
  function stoneBox(out, b, ox, oz, y, sx, h, sz) {
    const p = ledgePool, hd = p.alloc(); if (!hd) { stats.artMiss = (stats.artMiss || 0) + 1; return; }
    tmpM.makeRotationY(b.yaw).setPosition(wx(b, ox, oz), y, wz(b, ox, oz)); p.set(hd, tmpM);
    const A = ledgeGeo.attributes, i = hd.i;
    A.aSize.setXYZ(i, sx, h, sz); A.aStyle.setX(i, STYLE_CORNICE); A.aSeed.setX(i, 0.3); A.aTint.setXYZ(i, b.tint[0] * 0.97, b.tint[1] * 0.97, b.tint[2] * 0.97); A.aParams.setXYZW(i, 0, 0, b.shadowLine, 0); A.aOff.setXY(i, 0, 0);
    out.push([p, hd]);
  }
  function buildLedge(c) {
    const out = [];
    for (const b of c.buildings) {
      if (b.role || !LEDGE.masonry.has(b.style) || !b.faces?.length) continue;
      const fh = STYLE_P[b.style][1], bx = STYLE_P[b.style][0];
      for (const t of b.tiers) for (const face of b.faces) {
        const [nx, nz] = FACE_N[face.f];
        const half = nx ? t.hz : t.hx, w = half * 2 - 0.3; if (w < 2) continue;
        const put = (y, [h, d]) => stoneBox(out, b, nx * ((nx ? t.hx : 0) + d / 2), nz * ((nz ? t.hz : 0) + d / 2), y, nx ? d : w, h, nx ? w : d);
        if (t.y0 === 0 && b.shops) put(4.6 - 0.05, LEDGE.belt);
        const j0 = Math.max(1, Math.ceil(t.y0 / fh) + (t.y0 === 0 && b.shops ? 1 : 0)), j1 = Math.floor(Math.min(t.y1 - 1.5, LEDGE.maxH) / fh);
        for (let j = j0; j <= j1; j++) put(j * fh + fh * LEDGE.sillF, LEDGE.sill);
        if (b.style === 3) { // limestone pilasters, on the texture's pilaster lines (every 2nd bay)
          const F = faceBasis(b, face, t), uOff8 = Math.floor(seedF(b) * 8);
          const y0 = t.y0 === 0 && b.shops ? 4.6 + 0.3 : t.y0, y1 = t.y1 - 1.05; if (y1 - y0 < 3) continue;
          const [pw, pd] = LEDGE.pil;
          for (let n = Math.floor((F.uBase - F.half) / (2 * bx)) - 1; ; n++) {
            const u = (2 * n - uOff8) * bx + 0.17, s = u - F.uBase; if (s > F.half - 0.4) break; if (s < -F.half + 0.4) continue;
            const ox = F.tx * s + F.nx * (F.off + pd / 2), oz = F.tz * s + F.nz * (F.off + pd / 2);
            stoneBox(out, b, ox, oz, y0, nx ? pd : pw, y1 - y0, nx ? pw : pd);
          }
        }
      }
    }
    return out;
  }
  function shopSlots(b, face, t, fn) { // every shop position of the storefront texture (4 shops / 12 m) on this face
    const F = faceBasis(b, face, t), s5 = seedF(b) * 5;
    for (let k = 0; k < 4; k++) {
      const q = (k + 66 / 128) / 4;
      for (let n = Math.floor((F.uBase - F.half) / 12 + s5) - 1; n < (F.uBase + F.half) / 12 + s5 + 1; n++) {
        const s = (n + q - s5) * 12 - F.uBase;
        if (s > -F.half + 1.5 && s < F.half - 1.5) fn(F, s, k, n);
      }
    }
  }
  function buildAwning(c) {
    const out = [], p = pools.awnings;
    for (const b of c.buildings) {
      if (b.role || !b.shops || !b.faces?.length) continue;
      const t = b.tiers[0];
      for (const face of b.faces) shopSlots(b, face, t, (F, s, k, n) => {
        if (artHash(c.i, c.j, b.seed, n * 8 + k) < 0.18) return; // a few shops without an awning
        const hd = p.alloc(); if (!hd) { stats.artMiss = (stats.artMiss || 0) + 1; return; }
        F.at(s, 0, 3.72, tmpP); F.quat(tmpQ); tmpM.compose(tmpP, tmpQ, tmpS.set(2.72, 1, 1)); p.set(hd, tmpM);
        p.mesh.setColorAt(hd.i, tmpC.set(AWNING_COLORS[k]).multiplyScalar(1.05));
        out.push([p, hd]);
      });
    }
    return out;
  }
  function buildSigns(c) {
    const out = [], p = pools.signs, A = p.mesh.geometry.attributes.aAtlas;
    for (const b of c.buildings) {
      if (b.role || !b.shops || !b.faces?.length) continue;
      const t = b.tiers[0];
      for (const face of b.faces) shopSlots(b, face, t, (F, s, k, n) => {
        const r = artHash(c.i, c.j, b.seed ^ 0x5157, n * 8 + k); if (r > 0.34) return; // about one shop in three
        const hd = p.alloc(); if (!hd) { stats.artMiss = (stats.artMiss || 0) + 1; return; }
        F.at(s + 1.45, 0.72, 5.3, tmpP); F.quat(tmpQ); tmpM.compose(tmpP, tmpQ, tmpS.set(1, 1, 1)); p.set(hd, tmpM);
        const id = Math.floor(artHash(c.i, c.j, b.seed, 991 + n * 8 + k) * 16), col = id % 4, row = id >> 2;
        A.setXYZW(hd.i, col / 4, 1 - (row + 1) / 4, 1 / 4, 1 / 4);
        out.push([p, hd]);
      });
    }
    return out;
  }
  // sidewalks: per quadrant an L (strip along x: 7…36 × 7…12, strip along z: 7…12 × 12…36), 12–14.5 m segments,
  // skipped where a building footprint (home tower / factory) covers the street
  const RH = cfg.road / 2, WH = cfg.street / 2, HALF = cfg.cell / 2, CURB_H = 0.13;
  function buildCurb(c) {
    const out = [], p = pools.walks, cx = c.T.cx, cz = c.T.cz;
    const seg = (x0, x1, z0, z1) => { // world-axis rectangle
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      for (const [x, z] of [[mx, mz], [x0 + 0.3, mz], [x1 - 0.3, mz], [mx, z0 + 0.3], [mx, z1 - 0.3]]) if (world.pointBlocked(x, 0.5, z, 0.05)) return;
      const hd = p.alloc(); if (!hd) { stats.artMiss = (stats.artMiss || 0) + 1; return; }
      tmpM.makeScale(x1 - x0, CURB_H, z1 - z0).setPosition(mx, 0, mz); p.set(hd, tmpM); out.push([p, hd]);
    };
    const e = 0.03; // stop short of the building faces (no coplanar z-fight at the base)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      for (let a = RH; a < HALF - 0.01; a += 14.5) { const b2 = Math.min(HALF, a + 14.5); const X0 = cx + sx * a, X1 = cx + sx * b2, Z0 = cz + sz * RH, Z1 = cz + sz * (WH - e); seg(Math.min(X0, X1), Math.max(X0, X1), Math.min(Z0, Z1), Math.max(Z0, Z1)); }
      for (let a = WH; a < HALF - 0.01; a += 12) { const b2 = Math.min(HALF, a + 12); const Z0 = cz + sz * a, Z1 = cz + sz * b2, X0 = cx + sx * RH, X1 = cx + sx * (WH - e); seg(Math.min(X0, X1), Math.max(X0, X1), Math.min(Z0, Z1), Math.max(Z0, Z1)); }
    }
    return out;
  }
  // corner kits: 4 per intersection; arm across the north–south street on the (+,+) / (−,−) corners, across the
  // east–west street on the others → .ns tells which traffic the heads face
  const kitsLive = new Set(); // { hd, lamps: [hd × 4], ns }
  function buildProps(c) {
    const out = [], p = pools.kits, L = pools.signalLamps, cx = c.T.cx, cz = c.T.cz;
    for (const [sx, sz] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const ax = sx === sz ? -sx : 0, az = sx === sz ? 0 : -sz; // arm direction (toward the road it spans)
      const yaw = Math.atan2(-az, ax), x = cx + sx * (RH + 2.3), z = cz + sz * (RH + 2.3);
      if (world.pointBlocked(x, 1, z, 0.6)) continue;
      // the whole kit must stay on the sidewalk: sample its far items too
      tmpQ.setFromAxisAngle(UP, yaw);
      let ok = true; for (const [lx, lz] of [[0.6, -2.4], [0.45, -5.2], [-0.75, -6.4], [8.0, 0]]) { tmpP.set(lx, 1, lz).applyQuaternion(tmpQ); if (world.pointBlocked(x + tmpP.x, 1, z + tmpP.z, 0.3)) ok = false; } if (!ok) continue;
      const hd = p.alloc(); if (!hd) { stats.artMiss = (stats.artMiss || 0) + 1; continue; }
      tmpM.compose(tmpP.set(x, CURB_H * curbOnF(), z), tmpQ, tmpS.set(1, 1, 1)); p.set(hd, tmpM); out.push([p, hd]);
      const kit = { hd, lamps: [], ns: sx === sz };
      for (const [hx, hy] of SIG_HEADS) for (const side of [-1, 1]) {
        const lh = L.alloc(); if (!lh) break;
        tmpP.set(hx, hy + 0.28, side * 0.17).applyQuaternion(tmpQ).add(tmpS.set(x, CURB_H * curbOnF(), z));
        tmpM.compose(tmpP, tmpQ, tmpS.set(1, 1, 1)); L.set(lh, tmpM); kit.lamps.push(lh); out.push([L, lh]);
      }
      kitsLive.add(kit); kit.cellKey = c.key; out.kits = (out.kits || []); out.kits.push(kit);
    }
    paintSignals(true);
    return out;
  }
  let curbOn = true, rebuildProps = false, rebuildCars = false; const curbOnF = () => (curbOn ? 1 : 0);
  // parked cars in the curb lanes (both streets), 6.5 m slots between the crosswalk zones
  function buildCars(c) {
    const hover = (api.trafficBoost || 1) > 1;
    const out = [], p = hover ? pools.hoverParked : pools.cars, cx = c.T.cx, cz = c.T.cz;
    if (hover) out.parked = [];
    for (const ns of [true, false]) for (const side of [-1, 1]) for (const dir of [-1, 1]) for (let k = 0; k < 3; k++) {
      const along = dir * (16.5 + k * 6.5), lane = side * (RH - 1.15);
      if (artHash(c.i, c.j, (ns ? 1 : 2) * 7 + side * 3 + dir, k) > 0.32) continue;
      const x = ns ? cx + lane : cx + along, z = ns ? cz + along : cz + lane;
      if (world.pointBlocked(x, 0.8, z, 2.4)) continue;
      const hd = p.alloc(); if (!hd) { stats.artMiss = (stats.artMiss || 0) + 1; continue; }
      const yaw = ns ? (side > 0 ? 0 : Math.PI) : (side > 0 ? -Math.PI / 2 : Math.PI / 2); // parked with the traffic flow
      tmpQ.setFromAxisAngle(UP, yaw + (artHash(c.i, c.j, k, 77) - 0.5) * 0.06);
      tmpM.compose(tmpP.set(x, 0, z), tmpQ, tmpS.set(1, 1, 1)); p.set(hd, tmpM);
      p.mesh.setColorAt(hd.i, tmpC.set((hover ? HOVER_COLORS : CAR_COLORS)[Math.floor(artHash(c.i, c.j, k * 13 + side, dir + 5) * (hover ? HOVER_COLORS.length : CAR_COLORS.length))]));
      out.push([p, hd]);
      if (hover) { const pk = { x, z, yaw }; parkedLive.add(pk); out.parked.push(pk); }
    }
    return out;
  }
  const BUILDERS = { ledge: buildLedge, awning: buildAwning, curb: buildCurb, props: buildProps, signs: buildSigns, cars: buildCars };
  const flags = { ledge: true, awning: true, curb: true, props: true, signs: true, cars: true, traffic: true, trees: true, skyline: true };

  // ---------------------------------------------------------------- per-cell streaming (called from city.pump)
  const rangeOf = (k) => (k === 'ledge' ? cfg.ledgeRange : ART_RANGES[k]);
  function release(v, k) {
    const list = v.art?.[k]; if (!list) return;
    if (list.kits) for (const kit of list.kits) kitsLive.delete(kit);
    if (list.parked) for (const pk of list.parked) parkedLive.delete(pk);
    for (const [pool, hd] of list) pool.release(hd);
    v.art[k] = null;
  }
  function releaseAll(v) { if (v.art) for (const k of Object.keys(v.art)) release(v, k); }
  /** visuals: Map(cell → v). One cell-layer is built per call (nearest first) unless unbounded. */
  function stream(visuals, cam, unbounded, allowBuild = true) {
    let best = null, bestD = Infinity, bestK = null;
    for (const [c, v] of visuals) {
      v.art = v.art || {};
      if (rebuildProps && v.art.props) release(v, 'props'); // kits sit on the curb height they were built with
      if (rebuildCars && v.art.cars) release(v, 'cars'); // hover ↔ classic parked cars
      const d = world.distToCell(c.i, c.j, cam.x, cam.z);
      for (const k in BUILDERS) {
        const on = flags[k], has = !!v.art[k];
        if (has && (!on || d > rangeOf(k) + 30)) release(v, k);
        else if (!has && on && d < rangeOf(k)) {
          if (unbounded) v.art[k] = BUILDERS[k](c);
          else if (d < bestD) { bestD = d; best = [c, v]; bestK = k; }
        }
      }
    }
    if (best && allowBuild) best[1].art[bestK] = BUILDERS[bestK](best[0]);
    rebuildProps = false; rebuildCars = false;
    for (const p of Object.values(pools)) p.flush();
    stats.art = Object.fromEntries(Object.entries(pools).map(([k, p]) => [k, p.used]));
  }

  // ---------------------------------------------------------------- traffic signals
  // phase over a 34 s cycle: N–S green 14 s, amber 3 s, all-red 0, E–W green 14 s, amber 3 s
  const SIG = { cycle: 34, green: 14, amber: 3 };
  const LIGHT_HEAD = new THREE.Color(1.0, 0.92, 0.75), LIGHT_TAIL = new THREE.Color(0.9, 0.06, 0.04);
  const COL = { red: new THREE.Color(1.0, 0.12, 0.08), amber: new THREE.Color(1.0, 0.62, 0.1), green: new THREE.Color(0.2, 1.0, 0.55) };
  let sigT = 0, lastPhase = '';
  function phaseOf(ns) { const t = sigT % SIG.cycle, half = SIG.cycle / 2, tt = ns ? t : (t + half) % SIG.cycle; return tt < SIG.green ? 'green' : tt < SIG.green + SIG.amber ? 'amber' : 'red'; }
  function paintSignals(force) {
    const key = phaseOf(true) + phaseOf(false); if (!force && key === lastPhase) return; lastPhase = key;
    const L = pools.signalLamps;
    for (const kit of kitsLive) { const c = COL[phaseOf(kit.ns)]; for (const lh of kit.lamps) if (lh.i >= 0) L.mesh.setColorAt(lh.i, c); }
    L.dirty = true;
  }

  // ---------------------------------------------------------------- traffic (north–south streets only: no crossing paths)
  const movers = []; // { hd, x, z, dir, v, vMax, stopT, col }
  let flyingNow = 0; const _pitchQ = new THREE.Quaternion(), _XAX = new THREE.Vector3(1, 0, 0);
  let spawnT = 0, rngS = 1234567;
  const rnd = () => { rngS = (Math.imul(rngS, 1103515245) + 12345) >>> 0; return rngS / 4294967296; }; // decoration only (frame-rate dependent anyway)
  function updateTraffic(dt, cam) {
    const p = pools.cars, [gx, gz] = world.cellCenter(0, 0), S = cfg.cell;
    const want = flags.traffic ? Math.round(cfg.traffic.count * (api.trafficBoost || 1)) : 0; // v0.30 traffic2: denser
    // despawn: too far, outside built cells, or stuck
    for (let k = movers.length - 1; k >= 0; k--) {
      const m = movers[k], far = Math.hypot(m.x - cam.x, m.z - cam.z);
      const cell = world.cellAt(m.x, m.z);
      if (movers.length > want || far > cfg.traffic.radius + 20 || !cell || !cell.ready || (m.stopT > 15 && far > 45) || m.stopT > 40) { m.pool.release(m.hd); for (const lh of m.lights) pools.signalLamps.release(lh); movers.splice(k, 1); }
    }
    // spawn (one per frame at most), on a street column near the player, out of the near view
    spawnT -= dt;
    if (movers.length < want && spawnT <= 0) {
      spawnT = 0.25;
      const col = Math.round((cam.x - gx) / S) + Math.floor(rnd() * 5) - 2, dir = rnd() < 0.5 ? -1 : 1;
      const lx = gx + col * S + (dir < 0 ? 1.75 : -1.75); // right-hand traffic: northbound (dir −1, toward −z) at +x
      const z = cam.z + (rnd() < 0.5 ? -1 : 1) * (60 + rnd() * (cfg.traffic.radius - 70));
      const cell = world.cellAt(lx, z);
      const clear = cell && cell.ready && !world.pointBlocked(lx, 1, z, 2.6) && !world.pointBlocked(lx, 1, z + dir * 8, 1) && movers.every((m) => Math.abs(m.x - lx) > 0.5 || Math.abs(m.z - z) > 12);
      if (clear) {
        const hover = (api.trafficBoost || 1) > 1, pool = hover ? pools.hoverCars : p;
        const hd = pool.alloc();
        if (hd) {
          pool.mesh.setColorAt(hd.i, tmpC.set(hover ? HOVER_COLORS[Math.floor(rnd() * HOVER_COLORS.length)] : CAR_COLORS[Math.floor(rnd() * CAR_COLORS.length)]));
          const lights = []; const L = pools.signalLamps, neon = NEON[Math.floor(rnd() * NEON.length)];
          for (let k = 0; k < (hover ? 7 : 4); k++) { const lh = L.alloc(); if (!lh) break; L.mesh.setColorAt(lh.i, k < 2 ? LIGHT_HEAD : k < 4 ? LIGHT_TAIL : neon); lights.push(lh); }
          const vMax = 7.5 + rnd() * 4;
          movers.push({ hd, pool, hover, lights, x: lx, z, dir, v: 6, vMax, stopT: 0, ph: rnd() * 6.28, flyer: hover && rnd() < 0.38 && vMax > 9, alt: 0, altT: 0, jumping: false });
        }
      }
    }
    // drive: car-following, red lights (stop line 10 m before the intersection centre), the player, blocked streets
    const feet = cam;
    for (const m of movers) {
      let vT = m.vMax;
      // the next intersection ahead
      const n = Math.round((m.z - gz) / S), zc = gz + n * S, ahead = (zc - m.z) * m.dir; // >0: centre still ahead
      const stopAt = ahead - 10; // distance from the car centre to its stop point
      const zcNext = zc + m.dir * S, stopNext = (zcNext - m.z) * m.dir - 10;
      const stop = stopAt > -0.5 ? stopAt : stopNext;
      // v0.30c flyers: a fast hover car that catches up with a slow / stopped one lifts off (~6 m), passes over it and lands
      let lead = null, leadGap = 1e9, under = false;
      for (const o of movers) { if (o === m || Math.abs(o.x - m.x) > 0.5) continue; const gap = (o.z - m.z) * m.dir; if (gap > 0 && gap < leadGap) { leadGap = gap; lead = o; } if (Math.abs(gap) < 7 && o.alt < 1.5) under = true; }
      if (m.flyer && !m.jumping && lead && leadGap < 24 && lead.v < m.vMax * 0.6 && lead.alt < 1 && flyingNow < 3) { m.jumping = true; m.altT = 6; flyingNow++; for (let q = 0; q < 10; q++) puff(m.x, 0.25, m.z, 1); }
      if (m.jumping && (!lead || leadGap > 14 || lead.alt > 1) && !under && m.alt > 4) { m.altT = 0; } // passed: come down where the lane is clear
      if (m.jumping && m.altT === 0 && m.alt < 0.1) { m.jumping = false; flyingNow = Math.max(0, flyingNow - 1); }
      if (!m.jumping) {
        if (phaseOf(true) !== 'green' && stop > -0.5 && stop < 30) vT = Math.min(vT, Math.max(0, stop) * 0.55);
        if (lead && leadGap < 30) vT = Math.min(vT, Math.max(0, leadGap - 7.5) * 0.9);
      } else vT = m.vMax * 1.15;
      m.alt += (m.altT - m.alt) * Math.min(1, dt * (m.altT > m.alt ? 1.6 : 1.1));
      const fx = (feet.x - m.x), fz = (feet.z - m.z) * m.dir; if (feet.y < 3 && Math.abs(fx) < 1.8 && fz > 0 && fz < 9) vT = 0; // never drive into the player
      if (world.pointBlocked(m.x, 1, m.z + m.dir * 3.4, 0.4)) vT = 0; // street ends at a building (home tower / factory)
      m.v += Math.max(-6 * dt, Math.min(2.6 * dt, vT - m.v)); if (m.v < 0.05 && vT < 0.05) m.v = 0;
      m.z += m.dir * m.v * dt;
      m.stopT = m.v < 0.2 ? m.stopT + dt : 0;
      tmpQ.setFromAxisAngle(UP, m.dir < 0 ? 0 : Math.PI);
      if (m.hover && Math.abs(m.altT - m.alt) > 0.2) tmpQ.multiply(_pitchQ.setFromAxisAngle(_XAX, (m.altT > m.alt ? 1 : -1) * 0.12)); // nose up on lift-off, down on landing
      const hy = m.hover ? 0.42 + 0.04 * Math.sin(sigT * 2.1 + m.ph) + m.alt : 0; // hover height + a gentle bob (+ jump altitude)
      tmpM.compose(tmpP.set(m.x, hy, m.z), tmpQ, tmpS.set(1, 1, 1)); m.pool.set(m.hd, tmpM);
      // lights: car local −z = forward (heads), +z = back (tails); lamp box is 0.2 × 0.2 × 0.04 → scale to 0.32 × 0.14
      m.lights.forEach((lh, k) => {
        if (k >= 4) { // v0.30 hover car neon: underglow (k 4) + two side strips (k 5, 6), lamp box 0.2 × 0.2 × 0.04
          if (k === 4) { tmpP.set(0, hy + 0.06, 0.1); tmpS.set(8.6, 0.4, 105); } else { tmpP.set(k === 5 ? -0.97 : 0.97, hy + 0.36, 0.1); tmpS.set(0.25, 0.3, 108); }
          tmpP.applyQuaternion(tmpQ); tmpP.x += m.x; tmpP.z += m.z; tmpM.compose(tmpP, tmpQ, tmpS); pools.signalLamps.set(lh, tmpM); return;
        }
        const fwd = k < 2 ? -1 : 1; tmpP.set((k % 2 ? (m.hover && k < 2 ? 0.42 : 0.62) : (m.hover && k < 2 ? -0.42 : -0.62)), (m.hover ? hy + 0.4 : 0.68), fwd * (m.hover ? 2.3 : 2.23)).applyQuaternion(tmpQ); tmpP.x += m.x; tmpP.z += m.z;
        const trail = k >= 2 && m.hover ? 1 + m.v * 6 : k >= 2 && (api.trafficBoost || 1) > 1 ? 1 + m.v * 9 : 1;
        if (trail > 1) tmpP.addScaledVector(tmpS.set(0, 0, fwd * 0.02 * trail).applyQuaternion(tmpQ), 1);
        tmpM.compose(tmpP, tmpQ, tmpS.set(m.hover ? (k >= 2 ? 0.55 : 3.4) : 1.6, m.hover ? (k >= 2 ? 0.28 : 0.3) : 0.7, trail)); pools.signalLamps.set(lh, tmpM); // hover: thin light trails, head light bar
      }); // v0.30 traffic2: neon hover cars, stretched tail-light trails
    }
    // v0.30c thruster smoke: moving hover cars (4 points under the hull) + parked ones near the camera (idle wisps)
    smokeAcc += dt;
    if (smokeAcc > 1 / 30) {
      const n = Math.floor(smokeAcc * 30); smokeAcc -= n / 30;
      for (const m of movers) {
        if (!m.hover || Math.hypot(m.x - cam.x, m.z - cam.z) > 90) continue;
        for (let k = 0; k < n; k++) { const t = THRUST[(k + Math.floor(sigT * 30)) & 3], s = m.dir < 0 ? 1 : -1; puff(m.x + t[0] * s, 0.3 + m.alt, m.z + t[1] * s, m.jumping ? 0.4 : 0); }
      }
      for (const pk of parkedLive) {
        if (Math.abs(pk.x - cam.x) > 40 || Math.abs(pk.z - cam.z) > 40 || sr() > 0.07 * n) continue;
        const t = THRUST[Math.floor(sr() * 4)], c = Math.cos(pk.yaw), s2 = Math.sin(pk.yaw);
        puff(pk.x + t[0] * c + t[1] * s2, 0.22, pk.z - t[0] * s2 + t[1] * c);
      }
    }
    smoke.update(dt);
    stats.traffic = movers.length;
  }
  let lastBoost = 1;
  function update(dt, cam) {
    sigT += dt;
    if ((api.trafficBoost || 1) !== lastBoost) { lastBoost = api.trafficBoost || 1; clearTraffic(); rebuildCars = true; } // hover ↔ classic cars: no mixed pools
    if (flags.props) paintSignals(false);
    if (cam) updateTraffic(dt, cam);
    pools.cars.flush(); pools.hoverCars.flush(); pools.signalLamps.flush();
  }
  /** Rebase: every world-space instance + the traffic shifts. */
  function shift(dx, dz) {
    for (const p of Object.values(pools)) { const a = p.mesh.instanceMatrix.array; for (let i = 0; i < p.used; i++) { a[i * 16 + 12] += dx; a[i * 16 + 14] += dz; } p.dirty = true; }
    for (const m of movers) { m.x += dx; m.z += dz; }
    for (const pk of parkedLive) { pk.x += dx; pk.z += dz; }
    for (const q of smoke.p) if (q.on) { q.pos.x += dx; q.pos.z += dz; }
  }
  function clearTraffic() { flyingNow = 0; for (const m of movers) { m.pool.release(m.hd); for (const lh of m.lights) pools.signalLamps.release(lh); } movers.length = 0; }

  // ---------------------------------------------------------------- trees v2 + skyline v2 (swapped in by setFlags)
  const treeGeoV2 = streetTreeGeometry(true);
  const skylineV2 = skylineTexture();
  skylineV2.wrapT = THREE.ClampToEdgeWrapping; // v0.30d: V wrap pulled the opaque bottom row onto the cylinder's top edge (thin dark line across the sky)
  function setFlags(q, { treesPool, skylineMesh, skylineV1 }) {
    for (const k of Object.keys(flags)) flags[k] = !!q[k];
    if (curbOn !== flags.curb) rebuildProps = true;
    curbOn = flags.curb;
    if (!flags.traffic) clearTraffic();
    if (treesPool) { if (!treesPool._v1) treesPool._v1 = treesPool.mesh.geometry; treesPool.mesh.geometry = flags.trees ? treeGeoV2 : treesPool._v1; }
    if (skylineMesh) { skylineMesh.material.map = flags.skyline ? skylineV2 : skylineV1; skylineMesh.material.needsUpdate = true; }
  }
  const api = { extraMeshes: [smoke.mesh], pools, stream, releaseAll, update, shift, setFlags, flags, clearTraffic, movers, stats, get kits() { return kitsLive.size; }, trafficBoost: 1 };
  return api;
}

// ---------------------------------------------------------------- blade-sign atlas (4 × 4, original names)
function signAtlas() {
  return canvasTexture(1024, 512, (ctx, W, H) => {
    const cw = W / 4, ch = H / 4;
    SIGN_NAMES.forEach(([name, fg, bg], id) => {
      const x = (id % 4) * cw, y = (id >> 2) * ch;
      ctx.fillStyle = '#1a1a1e'; ctx.fillRect(x, y, cw, ch);
      ctx.fillStyle = bg; ctx.fillRect(x + 8, y + 8, cw - 16, ch - 16);
      ctx.strokeStyle = fg; ctx.lineWidth = 4; ctx.strokeRect(x + 16, y + 16, cw - 32, ch - 32);
      ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      let fs = 46; ctx.font = `800 ${fs}px system-ui, "Noto Sans CJK TC", "PingFang TC", sans-serif`;
      while (ctx.measureText(name).width > cw - 48 && fs > 18) { fs -= 2; ctx.font = `800 ${fs}px system-ui, "Noto Sans CJK TC", "PingFang TC", sans-serif`; }
      ctx.fillText(name, x + cw / 2, y + ch / 2 + 2);
    });
  }, { mipmaps: true });
}

// ---------------------------------------------------------------- skyline v2: two haze layers, stepped towers, spires
function skylineTexture() {
  return canvasTexture(2048, 256, (ctx, W, H) => {
    const r = rng(9091); ctx.clearRect(0, 0, W, H);
    const tower = (x, w, h, col) => {
      ctx.fillStyle = col; ctx.fillRect(x, H - h, w, h);
      const tiers = r() < 0.55 ? 1 + Math.floor(r() * 3) : 0; let tw = w, th = h, tx = x; // setbacks
      for (let k = 0; k < tiers; k++) { const nw = tw * (0.55 + r() * 0.25), nh = th * (0.08 + r() * 0.14); tx += (tw - nw) / 2; ctx.fillRect(tx, H - th - nh, nw, nh + 1); tw = nw; th += nh; }
      if (r() < 0.22) { ctx.fillRect(tx + tw / 2 - 1, H - th - 22 - r() * 30, 2, 60); } // antenna
      else if (r() < 0.12) { ctx.beginPath(); ctx.moveTo(tx, H - th); ctx.lineTo(tx + tw / 2, H - th - tw * 1.2); ctx.lineTo(tx + tw, H - th); ctx.fill(); } // spire
      else if (h < 90 && r() < 0.35) { ctx.fillRect(tx + tw * 0.3, H - th - 7, 6, 7); ctx.fillRect(tx + tw * 0.3 - 1, H - th - 9, 8, 2); } // water tower
    };
    for (const [col, maxH, minH, wmin, gap] of [['rgb(196,170,200)', 210, 50, 12, 6], ['rgb(150,128,164)', 160, 28, 14, 3], ['rgb(112,94,130)', 96, 16, 10, 2]]  /* v0.30d: opaque, pre-hazed layers (no see-through overlaps) */) {
      let x = -10;
      while (x < W) { const w = wmin + r() * 26, h = minH + Math.pow(r(), 1.8) * maxH; tower(x, w, h, col); x += w + r() * gap; }
    }
    // a few warm lit windows on the nearest layer (very low contrast: averages away in the mipmaps, no sparkle)
    ctx.fillStyle = 'rgba(255,200,130,0.18)';
    for (let k = 0; k < 900; k++) ctx.fillRect(r() * W, H - 8 - r() * 70, 2, 2);
  }, { repeat: true, mipmaps: true });
}
