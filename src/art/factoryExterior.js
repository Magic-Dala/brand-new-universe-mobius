// Factory C exterior (達拉城): the abandoned Halloween factory at the end of the block after the right turn.
// Low-cost shell: 5 draw calls (brick walls, metal roof, steel/pipes decor, glow bits, breach
// parts). Purple-brown brick, dark-grey steel, warm-yellow high windows, roll-up loading door,
// exposed pipes, vents, metal roof, a few pumpkin lights, orange / purple lighting. No logo.
// The roof has ONE breakable section (directly under the blue circle) with intact / broken /
// netted states; under it a short dark shaft hides that the building is hollow.
// Collision stays the single C box (see cityWorld.js); the interior is a separate scene (factory.js).
import * as THREE from 'three';
import { FACTORY_EXT } from '../data/layout.js';
import { toonMaterial, canvasTexture, rng } from './toon.js';
import { Bucket, CYL, CONE } from './geom.js';

const TILE_W = 12; // metres of wall per brick texture tile

function brickTexture(h) {
  return canvasTexture(512, 512, (ctx, S) => {
    const r = rng(41), Y = (m) => (1 - m / h) * S, X = (m) => (m / TILE_W) * S;
    ctx.fillStyle = '#5b3a46'; ctx.fillRect(0, 0, S, S); // purple-brown brick
    for (let y = 0; y < S; y += 6) { // courses
      ctx.fillStyle = 'rgba(30,14,22,0.35)'; ctx.fillRect(0, y, S, 1);
      const off = (y / 6) % 2 ? 0 : 7;
      for (let x = off; x < S; x += 14) ctx.fillRect(x, y, 1, 6);
    }
    for (let k = 0; k < 1400; k++) { ctx.fillStyle = `rgba(${r() < 0.5 ? '150,90,100' : '40,20,30'},${0.12 + r() * 0.12})`; ctx.fillRect(r() * S, r() * S, 6 + r() * 8, 3); }
    ctx.fillStyle = '#2f2b33'; ctx.fillRect(0, Y(1.2), S, S - Y(1.2)); // dark plinth
    ctx.fillStyle = '#3a3640'; ctx.fillRect(0, Y(10.8), S, Y(10.2) - Y(10.8)); // steel string course
    for (const cx of [3, 9]) { // high windows (steel frames, amber glass)
      const x0 = X(cx - 1.9), x1 = X(cx + 1.9), y0 = Y(18.8), y1 = Y(12.2);
      ctx.fillStyle = '#26232c'; ctx.fillRect(x0 - 4, y0 - 4, x1 - x0 + 8, y1 - y0 + 8);
      const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, '#8a5a2a'); g.addColorStop(1, '#4a3020');
      ctx.fillStyle = g; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.fillStyle = '#26232c';
      for (let i = 1; i < 4; i++) ctx.fillRect(x0 + (x1 - x0) * i / 4 - 1.5, y0, 3, y1 - y0);
      for (let j = 1; j < 5; j++) ctx.fillRect(x0, y0 + (y1 - y0) * j / 5 - 1.5, x1 - x0, 3);
      ctx.fillStyle = '#6e4a3c'; ctx.fillRect(x0 - 6, y1 + 2, x1 - x0 + 12, 6); // sill
      ctx.fillStyle = '#6e4a3c'; ctx.beginPath(); ctx.moveTo(x0 - 6, y0 - 4); ctx.lineTo((x0 + x1) / 2, y0 - 22); ctx.lineTo(x1 + 6, y0 - 4); ctx.fill(); // brick arch
    }
    for (const cx of [2, 6, 10]) { // small lower windows, boarded
      const x0 = X(cx - 0.8), x1 = X(cx + 0.8), y0 = Y(5.2), y1 = Y(3.0);
      ctx.fillStyle = '#1c1820'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.fillStyle = '#6a4c38'; ctx.save(); ctx.translate((x0 + x1) / 2, (y0 + y1) / 2); ctx.rotate(0.35); ctx.fillRect(-(x1 - x0) * 0.6, -3, (x1 - x0) * 1.2, 6); ctx.rotate(-0.7); ctx.fillRect(-(x1 - x0) * 0.6, -3, (x1 - x0) * 1.2, 6); ctx.restore();
    }
  }, { repeat: true });
}
function brickEmissive(h) {
  return canvasTexture(256, 256, (ctx, S) => {
    const r = rng(43), Y = (m) => (1 - m / h) * S, X = (m) => (m / TILE_W) * S;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
    for (const cx of [3, 9]) {
      const x0 = X(cx - 1.9), x1 = X(cx + 1.9), y0 = Y(18.8), y1 = Y(12.2);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) {
        const k = r(); if (k < 0.18) continue; // some panes broken / dark
        ctx.fillStyle = k < 0.5 ? '#ffb24a' : k < 0.85 ? '#ffd27a' : '#ff8a3a';
        ctx.fillRect(x0 + (x1 - x0) * i / 4 + 2, y0 + (y1 - y0) * j / 5 + 2, (x1 - x0) / 4 - 4, (y1 - y0) / 5 - 4);
      }
    }
  }, { repeat: true });
}
function roofTexture() {
  return canvasTexture(256, 256, (ctx, S) => {
    const r = rng(47);
    ctx.fillStyle = '#4a4c58'; ctx.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 16) { ctx.fillStyle = '#5c5e6c'; ctx.fillRect(x, 0, 3, S); ctx.fillStyle = '#34353e'; ctx.fillRect(x + 3, 0, 2, S); } // standing seams
    for (let k = 0; k < 90; k++) { ctx.fillStyle = `rgba(${r() < 0.6 ? '120,70,50' : '20,20,26'},${0.15 + r() * 0.2})`; ctx.beginPath(); ctx.arc(r() * S, r() * S, 2 + r() * 10, 0, Math.PI * 2); ctx.fill(); } // rust / stains
  }, { repeat: true });
}
function radialTexture(stops) {
  return canvasTexture(128, 128, (ctx, S) => {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    for (const [k, c] of stops) g.addColorStop(k, c);
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  }, { mipmaps: true });
}

/** Wall quads in C's box frame with metre-based UVs. rects: [t0,t1,y0,y1] along face P→Q. */
function wallGeometry(C, faces) {
  const pos = [], uv = [], nrm = [];
  for (const { P, Q, rects, u0 } of faces) {
    const L = Math.hypot(Q[0] - P[0], Q[1] - P[1]), dx = (Q[0] - P[0]) / L, dz = (Q[1] - P[1]) / L, nx = dz, nz = -dx;
    for (const [t0, t1, y0, y1] of rects) {
      const pt = (t, y) => [P[0] + dx * t, y, P[1] + dz * t];
      const a = pt(t0, y0), b = pt(t1, y0), c = pt(t1, y1), d = pt(t0, y1);
      const ua = [(u0 + t0) / TILE_W, y0 / C.h], ub = [(u0 + t1) / TILE_W, y0 / C.h], uc = [(u0 + t1) / TILE_W, y1 / C.h], ud = [(u0 + t0) / TILE_W, y1 / C.h];
      for (const [p, w] of [[a, ua], [b, ub], [c, uc], [a, ua], [c, uc], [d, ud]]) { pos.push(...p); uv.push(...w); nrm.push(nx, 0, nz); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}
/** Horizontal roof rects (box frame) at height y; uv in metres / 8. */
function roofGeometry(rects, y) {
  const pos = [], uv = [], nrm = [];
  for (const [x0, x1, z0, z1] of rects) {
    const a = [x0, y, z1], b = [x1, y, z1], c = [x1, y, z0], d = [x0, y, z0];
    for (const p of [a, b, c, a, c, d]) { pos.push(...p); uv.push(p[0] / 8, -p[2] / 8); nrm.push(0, 1, 0); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

export function createFactoryExterior(C, { decorMat, glowMat }) {
  const root = new THREE.Group(); root.name = 'FactoryExterior';
  root.matrixAutoUpdate = false;
  root.matrix.makeRotationY(C.yaw).setPosition(C.x, 0, C.z); // C box frame → world
  root.updateMatrixWorld(true);
  const I = new THREE.Matrix4();
  const hw = C.hw, hd = C.hd, h = C.h;
  const E = FACTORY_EXT, B = E.breach;

  // ---------------------------------------------------------------- walls
  const door = E.door;
  const faces = [
    { P: [-hw, hd], Q: [hw, hd], rects: [[0, 2 * hw, 0, h]], u0: 0 }, // south
    { P: [hw, hd], Q: [hw, -hd], rects: [[0, 2 * hd, 0, h]], u0: 2 * hw }, // east
    { P: [hw, -hd], Q: [-hw, -hd], u0: 0, rects: [[0, hw - door.w / 2, 0, h], [hw + door.w / 2, 2 * hw, 0, h], [hw - door.w / 2, hw + door.w / 2, door.h, h]] }, // north (loading door hole)
    { P: [-hw, -hd], Q: [-hw, hd], rects: [[0, 2 * hd, 0, h]], u0: 2 * hw }, // west
  ];
  const wallMat = toonMaterial({ map: brickTexture(h), emissiveMap: brickEmissive(h), emissive: 0xffffff, emissiveIntensity: 1.0 }); wallMat.name = 'factory-brick';
  const walls = new THREE.Mesh(wallGeometry(C, faces), wallMat); walls.name = 'FactoryWalls';

  // ---------------------------------------------------------------- roof (with the breakable section cut out)
  const roofMat = toonMaterial({ map: roofTexture() }); roofMat.name = 'factory-roof';
  const bx0 = B.local[0] - B.hw, bx1 = B.local[0] + B.hw, bz0 = B.local[1] - B.hd, bz1 = B.local[1] + B.hd;
  const ry = h + 0.02;
  const roof = new THREE.Mesh(roofGeometry([[-hw, hw, -hd, bz0], [-hw, hw, bz1, hd], [-hw, bx0, bz0, bz1], [bx1, hw, bz0, bz1]], ry), roofMat); roof.name = 'FactoryRoof';
  const section = new THREE.Mesh(roofGeometry([[bx0, bx1, bz0, bz1]], ry), roofMat); section.name = 'RoofSectionIntact';
  // seam lines framing the section (reads as a separate panel even when intact)
  const bk = new Bucket(), glow = new Bucket(), broken = new Bucket(), brokenGlow = new Bucket();
  for (const [w, d, x, z] of [[bx1 - bx0, 0.12, B.local[0], bz0], [bx1 - bx0, 0.12, B.local[0], bz1], [0.12, bz1 - bz0, bx0, B.local[1]], [0.12, bz1 - bz0, bx1, B.local[1]]]) bk.box(I, w, 0.06, d, 0x2c2c34, x, ry + 0.03, z);

  // ---------------------------------------------------------------- steel frame, cornice, parapet
  const steel = 0x3b3c44, steel2 = 0x2b2c33, rust = 0x7a4434;
  for (const z of [-hd, hd]) for (let x = -hw; x <= hw + 0.01; x += 6) bk.box(I, 0.5, h + 0.4, 0.5, steel, x, h / 2, z + Math.sign(z) * 0.2); // pilasters N / S
  for (const x of [-hw, hw]) for (let z = -hd; z <= hd + 0.01; z += 6.33) bk.box(I, 0.5, h + 0.4, 0.5, steel, x + Math.sign(x) * 0.2, h / 2, z);
  bk.box(I, 2 * hw + 0.9, 0.7, 0.4, steel2, 0, h - 0.1, -hd - 0.15); bk.box(I, 2 * hw + 0.9, 0.7, 0.4, steel2, 0, h - 0.1, hd + 0.15);
  bk.box(I, 0.4, 0.7, 2 * hd + 0.9, steel2, -hw - 0.15, h - 0.1, 0); bk.box(I, 0.4, 0.7, 2 * hd + 0.9, steel2, hw + 0.15, h - 0.1, 0);
  // low steel parapet (0.8 m) with a gap-free rail
  for (const [w, d, x, z] of [[2 * hw, 0.2, 0, -hd + 0.1], [2 * hw, 0.2, 0, hd - 0.1], [0.2, 2 * hd, -hw + 0.1, 0], [0.2, 2 * hd, hw - 0.1, 0]]) { bk.box(I, w, 0.8, d, steel, x, h + 0.4, z); bk.box(I, w + 0.1, 0.08, d + 0.1, 0x5a5c66, x, h + 0.84, z); }

  // ---------------------------------------------------------------- north loading door + dock
  const dz = -hd - 0.05;
  const doorBk = new Bucket(), doorBroken = new Bucket();
  doorBk.box(I, door.w, door.h, 0.15, 0x45474f, 0, door.h / 2, dz + 0.3); // roll-up shutter (intact)
  for (let k = 0; k < 18; k++) doorBk.box(I, door.w - 0.1, 0.06, 0.08, 0x2a2b31, 0, 0.2 + k * (door.h - 0.4) / 17, dz + 0.2); // slats
  { // v0.20 broken state (Green Maniac burst out): torn shutter stubs, bent slats, debris on the dock / street, dark opening
    const r3 = rng(77);
    doorBroken.box(I, door.w + 0.2, door.h, 0.1, 0x0a080c, 0, door.h / 2, dz + 0.9); // the dark hall behind
    doorBroken.box(I, door.w, 1.3, 0.15, 0x45474f, 0, door.h - 0.65, dz + 0.3, 0, 0.35, 0); // top stub, bent outward
    for (const sx of [-1, 1]) doorBroken.box(I, 1.1, door.h * 0.55, 0.15, 0x3e4048, sx * (door.w / 2 - 0.55), door.h * 0.3, dz + 0.1, sx * 0.5, 0, sx * 0.08); // torn edges
    for (let k = 0; k < 9; k++) { const zz = dz - 1.2 - r3() * 6.5; doorBroken.box(I, 1.2 + r3() * 2.4, 0.06, 0.5 + r3() * 0.4, k % 2 ? 0x45474f : 0x2a2b31, (r3() - 0.5) * 8, zz > dz - 2.9 ? 1.14 : 0.05, zz, r3() * 3, (r3() - 0.5) * 0.3, 0); } // slats on the dock / street
  }
  bk.box(I, door.w + 0.6, 0.9, 0.9, steel2, 0, door.h + 0.45, dz - 0.2); // roller box
  for (const sx of [-1, 1]) { bk.box(I, 0.35, door.h + 0.4, 0.4, 0xb08a2a, sx * (door.w / 2 + 0.2), door.h / 2, dz - 0.05); for (let k = 0; k < 6; k++) bk.box(I, 0.36, 0.3, 0.41, 0x1a1a1e, sx * (door.w / 2 + 0.2), 0.5 + k * 1.05, dz - 0.05); } // hazard posts
  bk.box(I, door.w + 4, 1.1, 3, 0x45434a, 0, 0.55, dz - 1.5); // loading dock
  bk.box(I, door.w + 5, 0.25, 3.6, steel2, 0, door.h + 1.6, dz - 1.6); // canopy
  for (const sx of [-1, 1]) bk.box(I, 0.12, 1.4, 0.12, steel, sx * (door.w / 2 + 2.2), door.h + 0.9, dz - 3.2, 0, -0.5);
  for (const sx of [-1, 1]) { glow.box(I, 0.5, 0.35, 0.3, 0xff9a3c, sx * (door.w / 2 + 1.1), door.h + 1.2, dz - 0.2); } // orange lamps
  glow.box(I, 0.6, 0.6, 0.25, 0xff6a20, 0, door.h + 1.2, dz - 0.3); // warning beacon
  // small side door (east) + steps
  bk.box(I, 0.12, 2.3, 1.2, 0x3a3440, hw + 0.08, 1.15 + 1.1, 8); bk.box(I, 1.4, 1.1, 2, 0x45434a, hw + 0.7, 0.55, 8);

  // ---------------------------------------------------------------- exposed pipes (east wall + roof run)
  for (const [y, c] of [[3.2, rust], [4.0, steel], [7.5, 0x5a4a52]]) bk.geo(I, ...CYL(0.28, 0.28, 2 * hd - 2, 8), c, hw + 0.7, y, 0, Math.PI / 2, 0, 0);
  for (const z of [-12, -2, 9]) bk.geo(I, ...CYL(0.3, 0.3, h - 1, 8), steel, hw + 0.7, (h - 1) / 2, z);
  for (const z of [-12, -2, 9]) for (const y of [3.2, 7.5]) bk.box(I, 0.9, 0.3, 0.9, steel2, hw + 0.45, y, z);
  bk.geo(I, ...CYL(0.32, 0.32, 9, 8), rust, hw - 1.2, h + 1.0, 4, Math.PI / 2, 0, 0); // roof pipe toward the stack
  bk.geo(I, ...CYL(0.32, 0.32, 3.2, 8), rust, hw - 1.2, h + 0.4, -0.6); bk.geo(I, ...CYL(0.32, 0.32, 3.2, 8), rust, hw - 1.2, h + 0.4, 8.5);
  for (const z of [-11, -6, -1, 4]) bk.box(I, 0.6, 0.7, 0.6, steel2, hw - 1.2, h + 0.35, z);
  // wall vents / louvres
  for (const [x, z] of [[-hw - 0.1, -10], [-hw - 0.1, 2], [hw + 0.1, -16]]) { bk.box(I, 0.25, 1.6, 2.2, steel2, x, 8.6, z); for (let k = 0; k < 5; k++) bk.box(I, 0.3, 0.08, 2.1, 0x55565f, x, 7.95 + k * 0.32, z); }

  // ---------------------------------------------------------------- roof equipment (keep-out zones in FACTORY_EXT.equipment)
  const M = E.monitor; // raised clerestory with warm high windows
  bk.box(I, M.x1 - M.x0, M.h, M.z1 - M.z0, 0x4a3540, (M.x0 + M.x1) / 2, h + M.h / 2, (M.z0 + M.z1) / 2);
  bk.box(I, M.x1 - M.x0 + 0.8, 0.3, M.z1 - M.z0 + 0.8, 0x34353e, (M.x0 + M.x1) / 2, h + M.h + 0.15, (M.z0 + M.z1) / 2);
  for (let z = M.z0 + 1; z < M.z1 - 0.8; z += 1.6) for (const x of [M.x0 - 0.02, M.x1 + 0.02]) glow.box(I, 0.06, M.h * 0.45, 1.2, (Math.floor(z * 7) % 3) ? 0xffc35a : 0xff9a3c, x, h + M.h * 0.55, z + 0.6);
  for (let k = 0; k < 4; k++) { const z = -11 + k * 4.6; bk.box(I, 2.2, 1.3, 1.8, 0x7a7684, 10.3, h + 0.65, z); bk.geo(I, ...CYL(0.55, 0.55, 0.1, 10), 0x2a2830, 10.3, h + 1.35, z); } // AC units (east strip)
  for (const [x, z] of [[-8, -13.5], [-0.5, -14.5]]) { bk.geo(I, ...CYL(0.55, 0.65, 1.4, 8), 0x6a6474, x, h + 0.7, z); bk.geo(I, ...CONE(0.8, 0.5, 8), 0x55505e, x, h + 1.65, z); } // turbine vents (north)
  bk.box(I, 3.4, 1.6, 2.4, 0x5a5462, -8, h + 0.8, -13.5 + 0.0); // exhaust housing
  // smokestack (SE), anchor bracket on top
  const S = E.stack;
  bk.geo(I, ...CYL(S.radius * 0.85, S.radius, S.height, 12), 0x5b3a46, S.local[0], h + S.height / 2, S.local[1]);
  for (const y of [4, 9, 14, 19]) bk.geo(I, ...CYL(S.radius + 0.06, S.radius + 0.06, 0.35, 12), steel2, S.local[0], h + y, S.local[1]);
  bk.box(I, 3.6, 1.2, 3.6, 0x45434a, S.local[0], h + 0.6, S.local[1]);
  glow.geo(I, ...CYL(S.radius * 0.9, S.radius * 0.9, 0.18, 12), 0x6ae4ff, S.local[0], h + S.height + 0.12, S.local[1]);
  glow.geo(I, ...CYL(0.12, 0.12, 0.6, 6), 0xff3050, S.local[0] + 0.7, h + S.height + 0.4, S.local[1]); // aviation light
  // roof lamps on the parapet (warm), purple uplights on the walls
  for (const [x, z] of [[-hw + 0.3, -hd + 0.3], [hw - 0.3, -hd + 0.3], [-hw + 0.3, hd - 0.3], [hw - 0.3, hd - 0.3], [-hw + 0.3, 0]]) glow.box(I, 0.3, 0.25, 0.3, 0xffcf70, x, h + 1.0, z);
  for (const [x, z, rx] of [[-hw - 0.32, -15, 0], [-hw - 0.32, -3, 0], [-hw - 0.32, 13, 0], [hw + 0.32, 14, 0], [0, hd + 0.32, 1]]) glow.box(I, rx ? 2.0 : 0.15, 0.25, rx ? 0.15 : 2.0, 0xa064ff, x, 0.35, z);
  for (const [x, z] of [[-hw - 0.31, -15], [-hw - 0.31, -3], [-hw - 0.31, 13], [hw + 0.31, 14]]) glow.box(I, 0.06, 7, 0.4, 0x8a52e8, x, 4, z); // purple wash strips

  // ---------------------------------------------------------------- pumpkin lights (a few)
  const pumpkin = (x, y, z, s) => {
    glow.geo(I, 'pumpkin', () => new THREE.SphereGeometry(0.5, 10, 7).scale(1, 0.78, 1), 0xff8a1e, x, y + 0.39 * s, z, 0, 0, 0, s);
    bk.geo(I, ...CYL(0.06, 0.08, 0.22, 5), 0x3a5a2a, x, y + 0.86 * s, z);
  };
  pumpkin(-door.w / 2 - 1.2, 1.1, dz - 2.4, 1.1); pumpkin(door.w / 2 + 1.4, 1.1, dz - 2.6, 0.9); pumpkin(door.w / 2 + 0.6, 1.1, dz - 2.0, 0.6);
  pumpkin(-hw + 1.2, h, -hd + 1.2, 0.9); pumpkin(hw - 1.4, h, hd - 1.4, 1.0); pumpkin(hw + 1.2, 1.1, 9.4, 0.7);

  // ---------------------------------------------------------------- warm light pools (decals, no real lights)
  const poolMat = new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(255,170,80,0.55)'], [1, 'rgba(255,140,60,0)']]), transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  poolMat.name = 'factory-lightpool';
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(9, 6).rotateX(-Math.PI / 2).translate(0, 1.13, dz - 2.4), poolMat); pool.renderOrder = 3;

  // ---------------------------------------------------------------- breach: broken state, shaft, net
  const breachGroup = new THREE.Group(); breachGroup.name = 'RoofBreach'; breachGroup.visible = false;
  {
    const r2 = rng(53), cx = B.local[0], cz = B.local[1];
    const shape = new THREE.Shape(); shape.moveTo(bx0, bz0); shape.lineTo(bx1, bz0); shape.lineTo(bx1, bz1); shape.lineTo(bx0, bz1); shape.closePath();
    const hole = new THREE.Path(); const N = 14, holeR = Math.min(B.hw, B.hd) * 0.78;
    const jag = [];
    for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2, rr = holeR * (0.78 + r2() * 0.3); jag.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]); }
    jag.forEach(([x, z], i) => (i ? hole.lineTo(x, z) : hole.moveTo(x, z))); hole.closePath(); shape.holes.push(hole);
    const frameGeo = new THREE.ShapeGeometry(shape); frameGeo.rotateX(Math.PI / 2); // shape xy → xz (z = +y)
    { const p = frameGeo.attributes.position, uv = frameGeo.attributes.uv; for (let i = 0; i < p.count; i++) { p.setY(i, ry); uv.setXY(i, p.getX(i) / 8, -p.getZ(i) / 8); } frameGeo.computeVertexNormals(); }
    // ShapeGeometry after rotateX(+π/2) faces −Y; flip the index so the frame faces up
    { const ix = frameGeo.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i]; ix[i] = ix[i + 2]; ix[i + 2] = t; } const n = frameGeo.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0); }
    const frame = new THREE.Mesh(frameGeo, roofMat); frame.name = 'RoofSectionBroken';
    // bent panels hanging into the hole, scorched edge, glowing embers
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3, rr = holeR * 0.92;
      broken.box(I, 1.6 + r2(), 0.06, 1.0, i % 2 ? 0x3e4048 : 0x54565f, cx + Math.cos(a) * rr, ry - 0.45, cz + Math.sin(a) * rr, -a + Math.PI / 2, 0.9 + r2() * 0.4, 0);
    }
    for (let i = 0; i < N; i++) { const [x0, z0] = jag[i], [x1, z1] = jag[(i + 1) % N]; const L = Math.hypot(x1 - x0, z1 - z0); brokenGlow.box(I, L, 0.05, 0.08, i % 3 ? 0xff7a2a : 0xffc060, (x0 + x1) / 2, ry + 0.03, (z0 + z1) / 2, -Math.atan2(z1 - z0, x1 - x0)); }
    // scorch decal
    const scorchMat = new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(10,6,8,0.95)'], [0.55, 'rgba(20,10,10,0.6)'], [1, 'rgba(20,10,10,0)']]), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
    scorchMat.name = 'factory-scorch';
    const scorch = new THREE.Mesh(new THREE.PlaneGeometry(B.hw * 3.2, B.hd * 3.2).rotateX(-Math.PI / 2).translate(cx, ry + 0.01, cz), scorchMat); scorch.renderOrder = 4;
    // short occluded shaft (open top): inside of a dark box; the hollow building is never visible
    const shaftMat = new THREE.MeshBasicMaterial({ color: 0x07050a, side: THREE.BackSide, fog: false });
    const noTop = new THREE.MeshBasicMaterial({ visible: false });
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(B.hw * 2 + 0.2, 7, B.hd * 2 + 0.2), [shaftMat, shaftMat, noTop, shaftMat, shaftMat, shaftMat]);
    shaft.position.set(cx, h - 3.5 + 0.01, cz); shaft.name = 'BreachShaft';
    // glow at the bottom (fire light) so the hole reads as a hole, not a black decal
    const fireMat = new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(255,120,40,0.9)'], [1, 'rgba(255,80,20,0)']]), transparent: true, depthWrite: false, toneMapped: false, fog: false });
    const fire = new THREE.Mesh(new THREE.PlaneGeometry(B.hw * 1.6, B.hd * 1.6).rotateX(-Math.PI / 2).translate(cx, h - 6.9, cz), fireMat);
    breachGroup.add(frame, scorch, shaft, fire);
    breachGroup.userData = { frame, scorch, shaft, fire };
  }
  const brokenMesh = new THREE.Mesh(broken.build(), decorMat); breachGroup.add(brokenMesh);
  const brokenGlowMesh = new THREE.Mesh(brokenGlow.build(), glowMat); breachGroup.add(brokenGlowMesh);
  // Mobius' web net over the hole (after the boss fight: the roof stays walkable)
  const net = (() => {
    const pts = [], cx = B.local[0], cz = B.local[1], R = Math.min(B.hw, B.hd) * 0.95;
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI; pts.push(cx - Math.cos(a) * R, ry + 0.05, cz - Math.sin(a) * R, cx + Math.cos(a) * R, ry + 0.05, cz + Math.sin(a) * R); }
    for (const rr of [0.3, 0.55, 0.8, 1.0]) for (let k = 0; k < 16; k++) { const a0 = (k / 16) * Math.PI * 2, a1 = ((k + 1) / 16) * Math.PI * 2; pts.push(cx + Math.cos(a0) * R * rr, ry + 0.05, cz + Math.sin(a0) * R * rr, cx + Math.cos(a1) * R * rr, ry + 0.05, cz + Math.sin(a1) * R * rr); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x7ef0ff, toneMapped: false })); m.name = 'WebNet'; m.visible = false; return m;
  })();

  const decor = new THREE.Mesh(bk.build(), decorMat); decor.name = 'FactoryDecor';
  const glowMesh = new THREE.Mesh(glow.build(), glowMat); glowMesh.name = 'FactoryGlow';
  const doorMesh = new THREE.Mesh(doorBk.build(), decorMat); doorMesh.name = 'RollUpDoor';
  const doorBrokenMesh = new THREE.Mesh(doorBroken.build(), decorMat); doorBrokenMesh.name = 'RollUpDoorBroken'; doorBrokenMesh.visible = false;
  root.add(walls, roof, section, decor, glowMesh, pool, breachGroup, net, doorMesh, doorBrokenMesh);
  for (const o of [walls, roof, section, decor, glowMesh, pool, net, brokenMesh, brokenGlowMesh, doorMesh, doorBrokenMesh, ...Object.values(breachGroup.userData)]) { o.updateMatrix(); }

  const toWorld = (lx, y, lz) => new THREE.Vector3(lx, y, lz).applyMatrix4(root.matrix);
  let state = 'intact';
  const api = {
    root, section, breachGroup, net,
    get state() { return state; },
    /** 'intact' (normal roof) | 'broken' (hole + shaft) | 'netted' (hole covered by a web net, walkable) */
    setRoofState(s) {
      state = s;
      section.visible = s === 'intact';
      breachGroup.visible = s !== 'intact';
      net.visible = s === 'netted';
      breachGroup.userData.fire.visible = s === 'broken';
    },
    /** 'closed' | 'broken' (after the boss fight: Green Maniac crashed out through it) */
    doorState: 'closed',
    setDoorState(d) { this.doorState = d; doorMesh.visible = d !== 'broken'; doorBrokenMesh.visible = d === 'broken'; },
    breachCenter: () => toWorld(B.local[0], h, B.local[1]),
    impactPoint: () => toWorld(E.impact.local[0], h + 0.3, E.impact.local[1]),
    /** box-frame (x, y, z) → world */
    toWorld,
    stats: () => ({ tris: [walls, roof, section, decor, glowMesh].reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0) }),
  };
  api.setRoofState('intact');
  return api;
}
