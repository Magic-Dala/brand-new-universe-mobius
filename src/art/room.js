// Mobius' bedroom on floor 22 of Home Tower A. Room-local coordinates
// (origin = floor centre, axes == world axes): x∈[-2.5,2.5], z∈[-3,3], y∈[0,2.8].
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ROOM, ROOM_BLOCKERS } from '../data/layout.js';
import { toonMaterial, canvasTexture, rng, GeoBucket } from './toon.js';

const W = ROOM.size.w, D = ROOM.size.d, H = ROOM.size.h;
const X0 = -W / 2, X1 = W / 2, Z0 = -D / 2, Z1 = D / 2;
const WIN = ROOM.window;
const F = ROOM.furniture;

// fake low-sun beam direction used for the baked floor / rug light pattern
const BEAM_KX = 0.4, BEAM_KZ = 1.93; // floor hit = (x + KX*y, -3 + KZ*y)
const BEAM_PANES = [
  [WIN.xMin + 0.04, -0.04, WIN.yMin + 0.04, 1.6], [0.04, WIN.xMax - 0.04, WIN.yMin + 0.04, 1.6],
  [WIN.xMin + 0.04, -0.04, 1.68, WIN.yMax - 0.04], [0.04, WIN.xMax - 0.04, 1.68, WIN.yMax - 0.04],
];
function drawBeam(ctx, toPx, alpha = 0.5) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.filter = 'blur(5px)';
  ctx.fillStyle = `rgba(255,170,90,${alpha})`;
  for (const [xa, xb, ya, yb] of BEAM_PANES) {
    const p = (x, y) => toPx(x + BEAM_KX * y, Z0 + BEAM_KZ * y);
    ctx.beginPath();
    ctx.moveTo(...p(xa, ya)); ctx.lineTo(...p(xb, ya)); ctx.lineTo(...p(xb, yb)); ctx.lineTo(...p(xa, yb));
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

const C = (hex) => new THREE.Color(hex);
/** colour fn with height-based ambient occlusion + optional warm window bias */
function shade(hex, { ao = 0.25, aoH = 0.45, warm = 0 } = {}) {
  const base = C(hex), tmp = new THREE.Color(), warmC = C(0xffb070);
  return (x, y, z) => {
    tmp.copy(base);
    const k = 1 - ao * (1 - Math.min(1, Math.max(0, y / aoH)));
    tmp.multiplyScalar(k);
    if (warm) tmp.lerp(warmC, warm * Math.max(0, 1 - (z - Z0) / 4) * 0.5);
    return tmp;
  };
}

// ---------------------------------------------------------------------------
// Canvas textures
// ---------------------------------------------------------------------------
function floorTexture() {
  const ppm = 160;
  return canvasTexture(W * ppm, D * ppm, (ctx, w, h) => {
    const r = rng(11);
    const pw = 0.18 * ppm;
    for (let x = 0, i = 0; x < w; x += pw, i++) {
      let y = -r() * 300;
      while (y < h) {
        const len = 180 + r() * 340;
        const l = 38 + r() * 10;
        ctx.fillStyle = `hsl(${24 + r() * 6},${52 + r() * 10}%,${l}%)`;
        ctx.fillRect(x, y, pw, len);
        for (let k = 0; k < 8; k++) { ctx.fillStyle = `rgba(80,40,20,${0.08 + r() * 0.08})`; ctx.fillRect(x + r() * pw, y, 1, len); }
        ctx.fillStyle = 'rgba(255,220,180,0.10)'; ctx.fillRect(x + 2, y, pw * 0.3, len);
        ctx.fillStyle = 'rgba(40,20,10,0.6)'; ctx.fillRect(x, y, pw, 2);
        y += len;
      }
      ctx.fillStyle = 'rgba(40,20,10,0.55)'; ctx.fillRect(x, 0, 2, h);
    }
    // gloss streak toward the window
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,190,120,0.25)'); g.addColorStop(0.5, 'rgba(255,190,120,0.0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    drawBeam(ctx, (x, z) => [(x - X0) * ppm, (z - Z0) * ppm], 0.55);
  });
}

function rugTexture() {
  const [rw, rd] = F.rug.size; const ppm = 200;
  const rx0 = F.rug.center[0] - rw / 2, rz0 = F.rug.center[2] - rd / 2;
  return canvasTexture(Math.round(rw * ppm), Math.round(rd * ppm), (ctx, w, h) => {
    const r = rng(3);
    ctx.fillStyle = '#e2e0ea'; ctx.fillRect(0, 0, w, h);
    for (let k = 0; k < 26000; k++) {
      const v = r();
      ctx.fillStyle = v < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(120,100,130,0.22)';
      const x = r() * w, y = r() * h;
      ctx.fillRect(x, y, 1 + r() * 3, 1 + r() * 2);
    }
    ctx.strokeStyle = 'rgba(150,130,150,0.55)'; ctx.lineWidth = 6; ctx.strokeRect(14, 14, w - 28, h - 28);
    drawBeam(ctx, (x, z) => [(x - rx0) * ppm, (z - rz0) * ppm], 0.6);
  });
}

function posterAtlas() {
  return canvasTexture(1536, 768, (ctx) => {
    const r = rng(21);
    const shard = (cx, cy, s, color) => {
      ctx.fillStyle = color; ctx.beginPath();
      const n = 3 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) { const a = r() * Math.PI * 2; ctx.lineTo(cx + Math.cos(a) * s * (0.4 + r()), cy + Math.sin(a) * s * (0.4 + r())); }
      ctx.fill();
    };
    const halftone = (x0, y0, w, h, color, step = 14) => {
      ctx.fillStyle = color;
      for (let y = y0; y < y0 + h; y += step) for (let x = x0; x < x0 + w; x += step) {
        const rr = (1 - (y - y0) / h) * step * 0.45;
        ctx.beginPath(); ctx.arc(x, y, Math.max(0.5, rr), 0, 7); ctx.fill();
      }
    };
    // 1: white with red slashes
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 512, 768); ctx.clip();
    ctx.fillStyle = '#f2ece4'; ctx.fillRect(0, 0, 512, 768);
    halftone(0, 0, 512, 400, '#e0c8c0');
    for (let k = 0; k < 9; k++) shard(80 + r() * 360, 120 + r() * 520, 60 + r() * 90, k % 3 ? '#d42a2a' : '#141018');
    ctx.strokeStyle = '#141018'; ctx.lineWidth = 14; ctx.beginPath(); ctx.moveTo(40, 700); ctx.lineTo(480, 80); ctx.stroke();
    ctx.restore();
    // 2: black with red mask shapes
    ctx.save(); ctx.translate(512, 0); ctx.beginPath(); ctx.rect(0, 0, 512, 768); ctx.clip();
    ctx.fillStyle = '#16121a'; ctx.fillRect(0, 0, 512, 768);
    halftone(0, 368, 512, 400, '#5a1a22', 16);
    ctx.fillStyle = '#e03030'; ctx.beginPath(); ctx.moveTo(256, 120); ctx.lineTo(430, 330); ctx.lineTo(256, 640); ctx.lineTo(82, 330); ctx.fill();
    ctx.fillStyle = '#f4ede4'; ctx.beginPath(); ctx.moveTo(150, 320); ctx.lineTo(240, 300); ctx.lineTo(225, 345); ctx.fill();
    ctx.beginPath(); ctx.moveTo(362, 320); ctx.lineTo(272, 300); ctx.lineTo(287, 345); ctx.fill();
    ctx.strokeStyle = '#f4ede4'; ctx.lineWidth = 4;
    for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.moveTo(256, 380); ctx.lineTo(256 + (r() - 0.5) * 400, 380 + r() * 360); ctx.stroke(); }
    ctx.restore();
    // 3: red with black / white shards
    ctx.save(); ctx.translate(1024, 0); ctx.beginPath(); ctx.rect(0, 0, 512, 768); ctx.clip();
    ctx.fillStyle = '#c8282c'; ctx.fillRect(0, 0, 512, 768);
    for (let k = 0; k < 14; k++) shard(r() * 512, r() * 768, 50 + r() * 110, k % 2 ? '#141018' : '#f2ece4');
    halftone(0, 0, 512, 768, 'rgba(20,10,20,0.25)', 18);
    ctx.restore();
    // borders
    ctx.strokeStyle = '#f8f4ee'; ctx.lineWidth = 18;
    for (let i = 0; i < 3; i++) ctx.strokeRect(i * 512 + 9, 9, 494, 750);
  });
}

function leafTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const r = rng(8);
    ctx.clearRect(0, 0, w, h);
    for (let k = 0; k < 15; k++) {
      const a = -Math.PI / 2 + (r() - 0.5) * 2.4;
      const len = 120 + r() * 120;
      const bx = w / 2, by = h - 4;
      const tx = bx + Math.cos(a) * len, ty = by + Math.sin(a) * len;
      const nx = -Math.sin(a) * (14 + r() * 10), ny = Math.cos(a) * (14 + r() * 10);
      const mx = (bx + tx) / 2, my = (by + ty) / 2;
      const g = ctx.createLinearGradient(bx, by, tx, ty);
      g.addColorStop(0, '#2e5e2c'); g.addColorStop(1, r() < 0.5 ? '#8cc44c' : '#6aac44');
      ctx.fillStyle = g; ctx.strokeStyle = '#173018'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(mx + nx, my + ny, tx, ty);
      ctx.quadraticCurveTo(mx - nx, my - ny, bx, by);
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(20,50,20,0.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
    }
  }, { anisotropy: 1 });
}

function monitorTexture() {
  return canvasTexture(512, 288, (ctx, w, h) => {
    const r = rng(5);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1a1f5a'); g.addColorStop(0.6, '#6a3c90'); g.addColorStop(1, '#f08a6a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffe0a0'; ctx.beginPath(); ctx.arc(330, 215, 20, 0, 7); ctx.fill();
    for (let x = 0; x < w;) {
      const bw = 14 + r() * 30, bh = 40 + r() * 140;
      ctx.fillStyle = '#20204a'; ctx.fillRect(x, h - bh, bw, bh);
      ctx.fillStyle = 'rgba(255,220,140,0.8)';
      for (let k = 0; k < bh / 6; k++) if (r() < 0.4) ctx.fillRect(x + 3 + r() * (bw - 6), h - bh + 4 + r() * (bh - 6), 2, 2);
      x += bw + 2;
    }
    ctx.fillStyle = '#2a2a5c'; ctx.fillRect(230, 30, 22, 258); ctx.fillRect(238, 4, 6, 30);
    ctx.fillStyle = 'rgba(80,220,255,0.9)'; ctx.fillRect(0, 0, w, 14);
    ctx.fillStyle = '#0a0c20'; ctx.font = 'bold 10px sans-serif'; ctx.fillText('DALA CITY CAM 22', 8, 11);
  });
}

function musicScreenTexture() {
  return canvasTexture(256, 176, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0c1a4a'); g.addColorStop(1, '#1c3c8a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#5ad8ff'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(w / 2, 78, 40, 0, 7); ctx.stroke();
    ctx.fillStyle = '#e8f8ff'; ctx.beginPath(); ctx.moveTo(w / 2 - 12, 58); ctx.lineTo(w / 2 + 20, 78); ctx.lineTo(w / 2 - 12, 98); ctx.fill();
    ctx.fillStyle = 'rgba(90,216,255,0.35)'; ctx.fillRect(30, 140, w - 60, 6);
    ctx.fillStyle = '#5ad8ff'; ctx.fillRect(30, 140, (w - 60) * 0.4, 6);
    ctx.fillStyle = '#a8c8ff'; ctx.font = 'bold 13px sans-serif'; ctx.fillText('MOBIUS MIX', 30, 132);
    for (let i = 0; i < 12; i++) { ctx.fillStyle = 'rgba(90,216,255,0.6)'; ctx.fillRect(28 + i * 17, 168 - (4 + (i * 37) % 14), 10, 4 + (i * 37) % 14); }
  });
}

function mirrorPlaceholderTexture() {
  return canvasTexture(128, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#d8d4e4'); g.addColorStop(0.5, '#a49cb8'); g.addColorStop(1, '#c8b0a8');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.moveTo(10, 60); ctx.lineTo(50, 20); ctx.lineTo(70, 20); ctx.lineTo(10, 90); ctx.fill();
    ctx.beginPath(); ctx.moveTo(40, 200); ctx.lineTo(110, 120); ctx.lineTo(118, 130); ctx.lineTo(50, 210); ctx.fill();
  });
}

// ---------------------------------------------------------------------------
export function createRoom() {
  const root = new THREE.Group();
  root.name = 'Room';
  root.position.set(...ROOM.origin);

  const matVC = toonMaterial({ vertexColors: true }); matVC.name = 'room-vc';
  const matGlow = new THREE.MeshBasicMaterial({ vertexColors: true }); matGlow.name = 'room-glow';
  const S = new GeoBucket(); // static solid
  const G = new GeoBucket(); // static emissive
  const rackGlow = new GeoBucket();
  const leaves = new GeoBucket();
  const colliders = [];
  const parts = {};
  const box3 = (x0, y0, z0, x1, y1, z1) => colliders.push(new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)));

  // --- shell: walls / ceiling ------------------------------------------------
  const wallC = 0xa8a2b4;
  const wallFn = shade(wallC, { ao: 0.18, aoH: 0.6, warm: 0.5 });
  const plane = (w, h) => new THREE.PlaneGeometry(w, h);
  // west wall (normal +X)
  S.add(plane(D, H), wallFn, { pos: [X0, H / 2, 0], rot: [0, Math.PI / 2, 0] });
  // east wall (normal -X)
  S.add(plane(D, H), wallFn, { pos: [X1, H / 2, 0], rot: [0, -Math.PI / 2, 0] });
  // south wall (normal -Z)
  S.add(plane(W, H), wallFn, { pos: [0, H / 2, Z1], rot: [0, Math.PI, 0] });
  // north wall (normal +Z) around the opening; slightly darker (back-lit)
  const nFn = shade(0xa89aa4, { ao: 0.15, aoH: 0.6 });
  S.add(plane(W, WIN.yMin), nFn, { pos: [0, WIN.yMin / 2, Z0] });
  S.add(plane(W, H - WIN.yMax), nFn, { pos: [0, (H + WIN.yMax) / 2, Z0] });
  S.add(plane(WIN.xMin - X0, WIN.yMax - WIN.yMin), nFn, { pos: [(X0 + WIN.xMin) / 2, (WIN.yMin + WIN.yMax) / 2, Z0] });
  S.add(plane(X1 - WIN.xMax, WIN.yMax - WIN.yMin), nFn, { pos: [(X1 + WIN.xMax) / 2, (WIN.yMin + WIN.yMax) / 2, Z0] });
  // ceiling
  S.add(plane(W, D), 0xd4d0e0, { pos: [0, H, 0], rot: [Math.PI / 2, 0, 0] });
  // crown moulding + baseboards
  const trim = 0x8a6a58, base = 0x5a3a2a;
  S.box(W, 0.08, 0.06, trim, [0, H - 0.04, Z1 - 0.03]); S.box(W, 0.08, 0.06, trim, [0, H - 0.04, Z0 + 0.03]);
  S.box(0.06, 0.08, D, trim, [X0 + 0.03, H - 0.04, 0]); S.box(0.06, 0.08, D, trim, [X1 - 0.03, H - 0.04, 0]);
  S.box(W, 0.1, 0.02, base, [0, 0.05, Z1 - 0.01]); S.box(0.02, 0.1, D, base, [X0 + 0.01, 0.05, 0]); S.box(0.02, 0.1, D, base, [X1 - 0.01, 0.05, 0]);
  S.box(WIN.xMin - X0, 0.1, 0.02, base, [(X0 + WIN.xMin) / 2, 0.05, Z0 + 0.01]);
  S.box(X1 - WIN.xMax, 0.1, 0.02, base, [(X1 + WIN.xMax) / 2, 0.05, Z0 + 0.01]);
  S.box(WIN.xMax - WIN.xMin, 0.1, 0.02, base, [0, 0.05, Z0 + 0.01]);
  // ceiling soffit over the window + recessed lights
  S.box(W, 0.12, 0.35, 0x9a888c, [0, H - 0.06, Z0 + 0.175]);
  for (const [lx, lz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.4], [1.2, 1.4]]) {
    S.add(new THREE.CylinderGeometry(0.11, 0.11, 0.01, 16), 0x6a6068, { pos: [lx, H - 0.004, lz] });
    G.add(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 16), 0xfff0d6, { pos: [lx, H - 0.008, lz] });
  }
  // wall colliders (north split around the window so players can go out)
  const T = 0.3;
  box3(X0 - T, 0, Z0, X0, H, Z1); box3(X1, 0, Z0, X1 + T, H, Z1); box3(X0, 0, Z1, X1, H, Z1 + T);
  box3(X0, 0, Z0 - T, X1, WIN.yMin, Z0); box3(X0, WIN.yMax, Z0 - T, X1, H, Z0);
  box3(X0, WIN.yMin, Z0 - T, WIN.xMin, WIN.yMax, Z0); box3(WIN.xMax, WIN.yMin, Z0 - T, X1, WIN.yMax, Z0);
  box3(X0, H, Z0, X1, H + T, Z1);

  // outward shell (hidden inside tower A; makes the room a closed box standalone)
  const shell = new GeoBucket();
  const SO = 0.2, shellC = 0x3a3040;
  shell.add(plane(D + 2 * SO, H + 2 * SO), shellC, { pos: [X0 - SO, H / 2, 0], rot: [0, -Math.PI / 2, 0] });
  shell.add(plane(D + 2 * SO, H + 2 * SO), shellC, { pos: [X1 + SO, H / 2, 0], rot: [0, Math.PI / 2, 0] });
  shell.add(plane(W + 2 * SO, H + 2 * SO), shellC, { pos: [0, H / 2, Z1 + SO] });
  shell.add(plane(W + 2 * SO, D + 2 * SO), shellC, { pos: [0, H + SO, 0], rot: [-Math.PI / 2, 0, 0] });
  shell.add(plane(W + 2 * SO, D + 2 * SO), shellC, { pos: [0, -SO, 0], rot: [Math.PI / 2, 0, 0] });
  const shellMesh = shell.mesh(matVC, 'RoomShell');
  root.add(shellMesh);
  parts.shell = shellMesh;

  // --- floor + rug -----------------------------------------------------------
  const floorGeo = new THREE.PlaneGeometry(W, D); floorGeo.rotateX(-Math.PI / 2);
  const floorMat = toonMaterial({ map: floorTexture() }); floorMat.name = 'room-floor';
  const floorMesh = new THREE.Mesh(floorGeo, floorMat); floorMesh.name = 'RoomFloor';
  root.add(floorMesh);
  const [rw, rd] = F.rug.size;
  const rugGeo = new THREE.PlaneGeometry(rw, rd); rugGeo.rotateX(-Math.PI / 2);
  const rugMat = toonMaterial({ map: rugTexture() }); rugMat.name = 'room-rug';
  const rug = new THREE.Mesh(rugGeo, rugMat); rug.position.set(F.rug.center[0], 0.016, F.rug.center[2]); rug.name = 'Rug';
  root.add(rug);
  S.box(rw + 0.02, 0.012, rd + 0.02, 0xb8acb4, [F.rug.center[0], 0.006, F.rug.center[2]]);

  // --- window: frame, sill, trim, sashes, curtains ---------------------------
  const ww = WIN.xMax - WIN.xMin, wh = WIN.yMax - WIN.yMin, wcx = (WIN.xMin + WIN.xMax) / 2, wcy = (WIN.yMin + WIN.yMax) / 2;
  const blk = 0x1c1a22, ft = 0.06;
  S.box(ww + 2 * ft, ft, 0.14, blk, [wcx, WIN.yMax + ft / 2, Z0]);
  S.box(ft, wh, 0.14, blk, [WIN.xMin - ft / 2, wcy, Z0]);
  S.box(ft, wh, 0.14, blk, [WIN.xMax + ft / 2, wcy, Z0]);
  S.box(ww + 2 * ft, ft, 0.14, blk, [wcx, WIN.yMin - ft / 2, Z0]);
  // interior sill (wood/stone) and exterior trim + sill
  S.box(ww + 0.3, 0.04, 0.22, 0xd8c8b4, [wcx, WIN.yMin - 0.02, Z0 + 0.11]);
  S.box(ww + 0.2, 0.05, 0.25, 0xcab8a0, [wcx, WIN.yMin - 0.06, Z0 - 0.12]);
  const trimC = 0xe6d6c0;
  S.box(ww + 0.5, 0.14, 0.05, trimC, [wcx, WIN.yMax + 0.13, Z0 - 0.035]);
  S.box(0.13, wh + 0.4, 0.05, trimC, [WIN.xMin - 0.125, wcy, Z0 - 0.035]);
  S.box(0.13, wh + 0.4, 0.05, trimC, [WIN.xMax + 0.125, wcy, Z0 - 0.035]);

  const glassMat = new THREE.MeshBasicMaterial({ color: 0xc8d8ff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
  glassMat.name = 'room-glass';
  const windowSashes = []; const windowGlassMeshes = [];
  const sashW = ww / 2 - 0.01, sashH = wh - 0.02, sf = 0.045;
  for (const side of [-1, 1]) { // -1 = west sash hinged at xMin, +1 = east sash hinged at xMax
    const hingeX = side < 0 ? WIN.xMin : WIN.xMax;
    const pivot = new THREE.Group(); pivot.name = side < 0 ? 'SashWest' : 'SashEast';
    pivot.position.set(hingeX, WIN.yMin + 0.01, Z0);
    const dir = -side; // sash extends from hinge toward the window centre
    const sb = new GeoBucket();
    const cx = dir * sashW / 2;
    sb.box(sashW, sf, 0.04, 0x15141a, [cx, sf / 2, 0]);
    sb.box(sashW, sf, 0.04, 0x15141a, [cx, sashH - sf / 2, 0]);
    sb.box(sf, sashH, 0.04, 0x15141a, [dir * sf / 2, sashH / 2, 0]);
    sb.box(sf, sashH, 0.04, 0x15141a, [dir * (sashW - sf / 2), sashH / 2, 0]);
    sb.box(sashW, 0.03, 0.03, 0x15141a, [cx, sashH * 0.62, 0]);
    sb.box(0.02, 0.14, 0.04, 0x8a8a96, [dir * (sashW - 0.05), sashH * 0.45, 0.04]);
    const frame = sb.mesh(matVC, 'SashFrame');
    frame.matrixAutoUpdate = true;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(sashW - 2 * sf, sashH - 2 * sf), glassMat);
    glass.position.set(cx, sashH / 2, 0); glass.name = 'SashGlass';
    glass.renderOrder = 10;
    pivot.add(frame, glass);
    root.add(pivot);
    windowGlassMeshes.push(glass);
    const maxAngle = THREE.MathUtils.degToRad(105);
    const sash = {
      pivot, maxAngle, hingeX, side: side < 0 ? 'west' : 'east', angle: 0,
      setOpen(a) { this.angle = THREE.MathUtils.clamp(a, 0, maxAngle); pivot.rotation.y = side < 0 ? this.angle : -this.angle; },
    };
    windowSashes.push(sash);
  }
  // curtain rod + curtains (opaque, back-lit via emissive)
  S.add(new THREE.CylinderGeometry(0.015, 0.015, W - 0.2, 8), 0x2a2228, { pos: [0, H - 0.17, Z0 + 0.12], rot: [0, 0, Math.PI / 2] });
  const curtainGeo = (w, h) => {
    const g = new THREE.PlaneGeometry(w, h, 24, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) / w) * Math.PI * 7) * 0.05 + 0.03);
    g.computeVertexNormals();
    return g;
  };
  const curtainMat = toonMaterial({ color: 0xfff0dc, emissive: 0xb07848, side: THREE.DoubleSide }); curtainMat.name = 'room-curtain';
  const cb = new GeoBucket();
  const cTop = H - 0.17, cBot = 0.22, cw = 0.72;
  cb.add(curtainGeo(cw, cTop - cBot), 0xffffff, { pos: [WIN.xMin - cw / 2 + 0.12, (cTop + cBot) / 2, Z0 + 0.12] });
  cb.add(curtainGeo(cw, cTop - cBot), 0xffffff, { pos: [WIN.xMax + cw / 2 - 0.12, (cTop + cBot) / 2, Z0 + 0.12] });
  const curtainMesh = cb.mesh(curtainMat, 'Curtains');
  root.add(curtainMesh);

  // --- bed (headboard west) --------------------------------------------------
  {
    const [bx, , bz] = F.bed.center; const [bw, , bd] = F.bed.size;
    const bx0 = bx - bw / 2, bx1 = bx + bw / 2;
    const wood = 0x7a4a2e, woodD = 0x5a3420;
    S.box(bw, 0.22, bd, shade(wood, { ao: 0.3, aoH: 0.25 }), [bx, 0.2, bz]);
    for (const lx of [bx0 + 0.05, bx1 - 0.05]) for (const lz of [bz - bd / 2 + 0.05, bz + bd / 2 - 0.05]) S.box(0.08, 0.1, 0.08, woodD, [lx, 0.05, lz]);
    S.box(0.6, 0.16, 0.5, 0x34303a, [bx + 0.3, 0.08, bz + bd / 2 - 0.27]); // under-bed box
    S.box(0.1, 1.05, bd + 0.06, woodD, [bx0 + 0.05, 0.52, bz]);
    S.add(new RoundedBoxGeometry(0.06, 0.6, bd - 0.08, 2, 0.025), 0x8a7a8a, { pos: [bx0 + 0.12, 0.72, bz] });
    S.add(new RoundedBoxGeometry(bw - 0.12, 0.22, bd - 0.06, 2, 0.05), 0xe8e2ea, { pos: [bx + 0.03, 0.42, bz] });
    const duvet = shade(0xa898c4, { ao: 0.25, aoH: 0.62 });
    S.add(new RoundedBoxGeometry(bw - 0.42, 0.16, bd + 0.08, 3, 0.07), duvet, { pos: [bx + 0.22, 0.56, bz] });
    S.add(new RoundedBoxGeometry(0.42, 0.13, bd + 0.06, 3, 0.06), 0xb8aad0, { pos: [bx0 + 0.6, 0.6, bz], rot: [0, 0, 0.12] });
    S.add(new RoundedBoxGeometry(0.34, 0.2, bd + 0.1, 3, 0.07), 0x9888b6, { pos: [bx1 - 0.25, 0.51, bz] }); // drape over foot
    for (const pz of [bz - 0.36, bz + 0.36]) S.add(new RoundedBoxGeometry(0.42, 0.15, 0.64, 3, 0.07), 0xd2cade, { pos: [bx0 + 0.32, 0.64, pz], rot: [0, 0, 0.25] });
    box3(bx0, 0, bz - bd / 2, bx1, 0.65, bz + bd / 2);
    parts.bed = { center: new THREE.Vector3(bx, 0.6, bz) };
  }

  // --- nightstand + music player + police radio -----------------------------
  {
    const [nx, , nz] = F.nightstand.center; const [nw, nh, nd] = F.nightstand.size;
    S.box(nw, nh, nd, shade(0x7a4a2e, { ao: 0.25, aoH: 0.3 }), [nx, nh / 2, nz]);
    S.box(0.01, 0.2, nd - 0.08, 0x5a3420, [nx + nw / 2 + 0.004, nh - 0.18, nz]);
    S.box(0.02, 0.03, 0.12, 0xc8b070, [nx + nw / 2 + 0.015, nh - 0.18, nz]);
    S.box(nw + 0.02, 0.025, nd + 0.02, 0x8a5634, [nx, nh + 0.0125 - 0.02, nz]);
    box3(nx - nw / 2, 0, nz - nd / 2, nx + nw / 2, nh, nz + nd / 2);

    const mp = new THREE.Group(); mp.name = 'MusicPlayer';
    mp.position.set(...F.musicPlayer.pos); mp.rotation.y = Math.PI / 2 - 0.35; // faces east / into room
    const mpb = new GeoBucket();
    mpb.box(0.07, 0.03, 0.09, 0x1a1a22, [0, 0.015, -0.02]);
    mpb.box(0.26, 0.18, 0.014, 0x16161e, [0, 0.11, 0], [-0.25, 0, 0]);
    mp.add(mpb.mesh(matVC, 'MusicPlayerBody'));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.16), new THREE.MeshBasicMaterial({ map: musicScreenTexture() }));
    scr.position.set(0, 0.11, 0.009); scr.rotation.x = -0.25; scr.position.y += 0.002; scr.position.z += 0.002;
    scr.name = 'MusicPlayerScreen';
    mp.add(scr);
    root.add(mp);
    parts.musicPlayer = mp;
    parts.musicPlayerScreen = scr;

    const radio = new THREE.Group(); radio.name = 'PoliceRadio';
    radio.position.set(...F.policeRadio.pos); radio.rotation.y = Math.PI / 2 - 0.2;
    const rb = new GeoBucket();
    rb.add(new RoundedBoxGeometry(0.075, 0.2, 0.045, 2, 0.01), 0x22232c, { pos: [0, 0.1, 0] });
    rb.box(0.06, 0.07, 0.005, 0x3a3e4a, [0, 0.07, 0.024]);
    for (let k = 0; k < 4; k++) rb.box(0.05, 0.004, 0.003, 0x14141a, [0, 0.05 + k * 0.012, 0.027]);
    rb.box(0.05, 0.03, 0.004, 0x2a6a5a, [0, 0.15, 0.024]);
    rb.add(new THREE.CylinderGeometry(0.006, 0.008, 0.16, 6), 0x15151a, { pos: [-0.022, 0.28, 0] });
    rb.add(new THREE.CylinderGeometry(0.012, 0.012, 0.025, 8), 0x3a3a44, { pos: [0.018, 0.212, 0] });
    radio.add(rb.mesh(matVC, 'RadioBody'));
    const ledR = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.01, 0.014), new THREE.MeshBasicMaterial({ color: 0xff2030 }));
    const ledB = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.01, 0.014), new THREE.MeshBasicMaterial({ color: 0x2060ff }));
    ledR.position.set(-0.005, 0.205, 0.008); ledB.position.set(0.012, 0.205, -0.01);
    ledR.name = 'RadioLedRed'; ledB.name = 'RadioLedBlue';
    radio.add(ledR, ledB);
    root.add(radio);
    parts.radio = radio;
    let radioActive = true;
    const offR = new THREE.Color(0x401018), offB = new THREE.Color(0x101840), onR = new THREE.Color(0xff2030), onB = new THREE.Color(0x3070ff);
    parts.radioCtl = {
      get active() { return radioActive; },
      setActive(v) { radioActive = !!v; if (!radioActive) { ledR.material.color.copy(offR); ledB.material.color.copy(offB); } },
      update(t) {
        if (!radioActive) return;
        const ph = Math.floor(t * 4) % 2;
        ledR.material.color.copy(ph ? onR : offR); ledB.material.color.copy(ph ? offB : onB);
      },
    };
  }

  // --- armor rack (NE corner, against east wall, facing west) ----------------
  {
    const [ax, , az] = F.armorRack.center; const [aw, ah, ad] = F.armorRack.size;
    const ax0 = ax - aw / 2, ax1 = ax + aw / 2, az0 = az - ad / 2, az1 = az + ad / 2;
    const rack = new THREE.Group(); rack.name = 'ArmorRack';
    const metal = 0x26262e, metalL = 0x3c3c48;
    const rb = new GeoBucket();
    rb.box(aw, 0.08, ad, metal, [ax, 0.04, az]);
    rb.box(aw - 0.12, 0.012, ad - 0.12, 0x1a2a44, [ax, 0.086, az]);
    const p = 0.07;
    for (const px of [ax0 + p / 2, ax1 - p / 2]) for (const pz of [az0 + p / 2, az1 - p / 2]) rb.box(p, ah - 0.08, p, metalL, [px, 0.08 + (ah - 0.08) / 2, pz]);
    rb.box(aw, 0.1, p, metal, [ax, ah - 0.05, az0 + p / 2]); rb.box(aw, 0.1, p, metal, [ax, ah - 0.05, az1 - p / 2]);
    rb.box(p, 0.1, ad, metal, [ax0 + p / 2, ah - 0.05, az]); rb.box(p, 0.1, ad, metal, [ax1 - p / 2, ah - 0.05, az]);
    rb.box(0.04, ah - 0.3, ad - 0.14, 0x1c1c24, [ax1 - 0.04, ah / 2, az]); // back panel
    for (const y of [0.9, 1.5, 2.05]) rb.box(aw - 0.1, 0.05, 0.05, metal, [ax, y, az0 + 0.06]), rb.box(aw - 0.1, 0.05, 0.05, metal, [ax, y, az1 - 0.06]);
    // shoulder clamps
    for (const s of [-1, 1]) {
      rb.box(0.22, 0.07, 0.07, metalL, [ax + 0.12, 1.55, az + s * 0.3]);
      rb.add(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 10), 0x50505c, { pos: [ax - 0.0, 1.55, az + s * 0.3], rot: [Math.PI / 2, 0, 0] });
    }
    // top pistons
    for (const s of [-1, 1]) rb.add(new THREE.CylinderGeometry(0.035, 0.035, aw - 0.1, 8), 0x50505c, { pos: [ax, ah - 0.16, az + s * 0.2], rot: [0, 0, Math.PI / 2] });
    rack.add(rb.mesh(matVC, 'RackFrame'));
    // cyan LED tubes
    for (const pz of [az0 + 0.075, az1 - 0.075]) {
      rackGlow.box(0.025, 1.7, 0.025, 0x40e0ff, [ax0 + 0.06, 1.05, pz]);
      rackGlow.box(0.025, 1.7, 0.025, 0x40c8ff, [ax1 - 0.08, 1.15, pz]);
    }
    rackGlow.box(0.02, 0.02, ad - 0.2, 0x60e8ff, [ax0 + 0.04, ah - 0.11, az]);
    rackGlow.box(0.012, 0.012, ad - 0.18, 0x3aa0ff, [ax0 + 0.02, 0.07, az]);
    rackGlow.box(aw - 0.18, 0.012, 0.012, 0x3aa0ff, [ax, 0.07, az0 + 0.02]);
    rackGlow.box(aw - 0.18, 0.012, 0.012, 0x3aa0ff, [ax, 0.07, az1 - 0.02]);
    rackGlow.add(new THREE.RingGeometry(0.22, 0.3, 24), 0x2a7cff, { pos: [ax, 0.094, az], rot: [-Math.PI / 2, 0, 0] });
    rackGlow.box(0.05, 0.012, 0.05, 0xffb040, [ax0 + 0.12, 0.085, az1 - 0.12]);
    const rackGlowMat = new THREE.MeshBasicMaterial({ vertexColors: true }); rackGlowMat.name = 'rack-glow';
    rack.add(rackGlow.mesh(rackGlowMat, 'RackGlow'));
    parts.rackGlowMaterial = rackGlowMat;
    const suitMount = new THREE.Group(); suitMount.name = 'SuitMount';
    suitMount.position.set(ax, 0.094, az); suitMount.rotation.y = -Math.PI / 2; // local +Z faces west (into room)
    rack.add(suitMount);
    const grab = new THREE.Object3D(); grab.name = 'ArmorRackGrabPoint';
    grab.position.set(ax - 0.08, 1.32, az);
    rack.add(grab);
    root.add(rack);
    parts.armorRack = rack; parts.suitMount = suitMount; parts.armorRackGrabPoint = grab;
    box3(ax0, 0, az0, ax1, ah, az1);
    // placeholder suit (game may hide/replace): same transform as suitMount
    const suitMat = toonMaterial({ vertexColors: true, emissive: 0x2a3448 }); suitMat.name = 'suit-placeholder';
    parts.suitPlaceholder = buildSuitPlaceholder(suitMat);
    parts.suitPlaceholder.position.copy(suitMount.position);
    parts.suitPlaceholder.rotation.copy(suitMount.rotation);
    rack.add(parts.suitPlaceholder);
  }

  // --- mirror (east wall, south of rack) --------------------------------------
  {
    const [mx, my, mz] = F.mirror.center; const [mw, mh] = F.mirror.size;
    const mRoot = new THREE.Object3D(); mRoot.name = 'Mirror';
    mRoot.position.set(X1 - 0.045, my, mz); mRoot.rotation.y = -Math.PI / 2; // +Z -> -X (into room)
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(mw, mh), new THREE.MeshBasicMaterial({ map: mirrorPlaceholderTexture() }));
    surface.name = 'MirrorSurface';
    mRoot.add(surface);
    root.add(mRoot);
    const fw = 0.05, frameC = 0x6a4a30;
    S.box(0.04, mh + 2 * fw, fw, frameC, [X1 - 0.03, my, mz - mw / 2 - fw / 2]);
    S.box(0.04, mh + 2 * fw, fw, frameC, [X1 - 0.03, my, mz + mw / 2 + fw / 2]);
    S.box(0.04, fw, mw, frameC, [X1 - 0.03, my + mh / 2 + fw / 2, mz]);
    S.box(0.04, fw, mw, frameC, [X1 - 0.03, my - mh / 2 - fw / 2, mz]);
    S.box(0.02, mh, mw, 0x2a2228, [X1 - 0.012, my, mz]);
    void mx;
    parts.mirror = { root: mRoot, width: mw, height: mh, surface };
  }

  // --- desk, monitor, lamp, chair, basketball --------------------------------
  {
    const [dx, , dz] = F.desk.center; const [dw, dh, dd] = F.desk.size;
    const dx0 = dx - dw / 2, dx1 = dx + dw / 2, dz0 = dz - dd / 2, dz1 = dz + dd / 2;
    const wood = 0x9a6a40, dark = 0x2a262e;
    S.box(dw, 0.04, dd, wood, [dx, dh - 0.02, dz]);
    S.box(dw - 0.04, dh - 0.04, 0.035, shade(dark, { ao: 0.2 }), [dx, (dh - 0.04) / 2, dz0 + 0.02]);
    S.box(dw - 0.04, dh - 0.04, 0.4, shade(0x34303a, { ao: 0.2 }), [dx, (dh - 0.04) / 2, dz1 - 0.2]); // drawer unit
    for (let k = 0; k < 3; k++) S.box(0.01, 0.18, 0.34, 0x46404c, [dx0 + 0.015, 0.14 + k * 0.23, dz1 - 0.2]);
    S.box(0.02, 0.3, dd - 0.45, dark, [dx1 - 0.03, dh - 0.25, dz - 0.2]);
    // monitor
    S.box(0.18, 0.012, 0.22, 0x1a1a20, [dx1 - 0.18, dh + 0.006, dz]);
    S.box(0.03, 0.22, 0.04, 0x1a1a20, [dx1 - 0.16, dh + 0.11, dz]);
    S.box(0.03, 0.4, 0.68, 0x141418, [dx1 - 0.19, dh + 0.33, dz]);
    const mon = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.36), new THREE.MeshBasicMaterial({ map: monitorTexture() }));
    mon.position.set(dx1 - 0.21, dh + 0.33, dz); mon.rotation.y = -Math.PI / 2; mon.name = 'MonitorScreen';
    root.add(mon); parts.monitorScreen = mon;
    // keyboard, mouse, books, mug
    S.box(0.16, 0.02, 0.44, 0x2c2c34, [dx0 + 0.2, dh + 0.01, dz]);
    G.box(0.13, 0.004, 0.4, 0x5ad0ff, [dx0 + 0.2, dh + 0.021, dz]);
    S.add(new THREE.SphereGeometry(0.03, 8, 6), 0x2c2c34, { pos: [dx0 + 0.2, dh + 0.012, dz + 0.32], scale: [1, 0.5, 1.4] });
    const bookC = [0xc83a3a, 0x3a5aa8, 0xe8d8b0, 0x2a2a34, 0x5a8a5a];
    for (let k = 0; k < 4; k++) S.box(0.22, 0.04, 0.3, bookC[k], [dx1 - 0.2, dh + 0.02 + k * 0.04, dz1 - 0.25], [0, k * 0.08, 0]);
    S.add(new THREE.CylinderGeometry(0.04, 0.035, 0.09, 12), 0xf0ece4, { pos: [dx0 + 0.2, dh + 0.045, dz - 0.4] });
    // desk lamp
    const lamp = new THREE.Group(); lamp.name = 'DeskLamp';
    lamp.position.set(dx1 - 0.15, dh, dz0 + 0.18);
    const lb = new GeoBucket();
    lb.add(new THREE.CylinderGeometry(0.08, 0.09, 0.025, 16), 0x22222a, { pos: [0, 0.0125, 0] });
    lb.add(new THREE.CylinderGeometry(0.012, 0.012, 0.38, 6), 0x22222a, { pos: [-0.05, 0.19, 0], rot: [0, 0, 0.3] });
    lb.add(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 6), 0x22222a, { pos: [-0.2, 0.39, 0], rot: [0, 0, -1.1] });
    lb.add(new THREE.ConeGeometry(0.09, 0.14, 16, 1, true), 0x22222a, { pos: [-0.34, 0.42, 0], rot: [0, 0, -0.6] });
    lamp.add(lb.mesh(matVC, 'LampBody'));
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd890 }));
    bulb.position.set(-0.36, 0.385, 0); bulb.name = 'LampBulb';
    lamp.add(bulb);
    root.add(lamp); parts.lamp = lamp;
    G.add(new THREE.CircleGeometry(0.26, 20), 0xd89a5a, { pos: [dx - 0.05, dh + 0.002, dz0 + 0.22], rot: [-Math.PI / 2, 0, 0], scale: [1, 1.3, 1] });
    parts.desk = { center: new THREE.Vector3(dx, dh, dz) };
    box3(dx0, 0, dz0, dx1, dh, dz1);

    // office chair (faces east)
    const [cx, , cz] = F.chair.center;
    const ch = 0x26262e;
    S.add(new RoundedBoxGeometry(0.48, 0.08, 0.48, 2, 0.03), ch, { pos: [cx, 0.48, cz] });
    S.add(new RoundedBoxGeometry(0.07, 0.62, 0.46, 2, 0.03), ch, { pos: [cx - 0.26, 0.86, cz], rot: [0, 0, 0.12] });
    S.add(new THREE.CylinderGeometry(0.03, 0.03, 0.36, 8), 0x50505a, { pos: [cx, 0.27, cz] });
    for (let k = 0; k < 5; k++) {
      const a = k / 5 * Math.PI * 2;
      S.box(0.3, 0.03, 0.04, 0x1c1c22, [cx + Math.cos(a) * 0.15, 0.08, cz + Math.sin(a) * 0.15], [0, -a, 0]);
      S.add(new THREE.SphereGeometry(0.03, 6, 4), 0x101014, { pos: [cx + Math.cos(a) * 0.29, 0.03, cz + Math.sin(a) * 0.29] });
    }
    for (const s of [-1, 1]) { S.box(0.3, 0.03, 0.05, ch, [cx + 0.02, 0.68, cz + s * 0.26]); S.box(0.03, 0.18, 0.03, ch, [cx - 0.05, 0.59, cz + s * 0.26]); }
    box3(cx - 0.3, 0, cz - 0.3, cx + 0.3, 1.1, cz + 0.3);

    // basketball
    const ballFn = (x, y, z, nx, ny, nz) => (Math.abs(nx) < 0.07 || Math.abs(ny) < 0.07 || Math.abs(nz - nx * 0.3) < 0.06) ? C(0x2a1a14) : C(0xd8642a);
    const ball = new THREE.SphereGeometry(0.12, 28, 16);
    S.add(ball, ballFn, { pos: [dx - 0.1, 0.12, dz1 + 0.35] });
    parts.basketball = new THREE.Vector3(dx - 0.1, 0.12, dz1 + 0.35);
  }

  // --- bookshelf (west wall) ------------------------------------------------
  {
    const [bx, , bz] = F.bookshelf.center; const [bw, bh, bd] = F.bookshelf.size;
    const wood = 0x7a4a2e;
    S.box(bw, bh, 0.03, wood, [bx, bh / 2, bz - bd / 2 + 0.015]);
    S.box(bw, bh, 0.03, wood, [bx, bh / 2, bz + bd / 2 - 0.015]);
    S.box(0.02, bh, bd, 0x4a2c1c, [bx - bw / 2 + 0.01, bh / 2, bz]);
    const r = rng(31);
    const bookC = [0xc83a3a, 0x3a5aa8, 0xe8d8b0, 0x2a2a34, 0x5a8a5a, 0xd8a040, 0x7a4a8a, 0xf0ece4];
    for (let k = 0; k < 5; k++) {
      const y = 0.02 + k * (bh - 0.04) / 4;
      S.box(bw, 0.025, bd - 0.04, wood, [bx, y, bz]);
      if (k === 4) break;
      let z = bz - bd / 2 + 0.05;
      while (z < bz + bd / 2 - 0.1) {
        const t = 0.025 + r() * 0.035, hgt = 0.2 + r() * 0.12;
        if (r() < 0.12) { z += 0.06; continue; }
        S.box(bw * (0.7 + r() * 0.2), hgt, t, bookC[Math.floor(r() * bookC.length)], [bx - 0.02, y + 0.0125 + hgt / 2, z + t / 2], [r() < 0.1 ? 0.15 : 0, 0, 0]);
        z += t + 0.004;
      }
    }
    box3(bx - bw / 2, 0, bz - bd / 2, bx + bw / 2, bh, bz + bd / 2);
  }

  // --- door (south wall) ------------------------------------------------------
  {
    const [ddx, , ddz] = F.door.center; const [dw, dh] = F.door.size;
    S.box(dw, dh, 0.04, 0x8a5a38, [ddx, dh / 2, ddz - 0.02]);
    S.box(dw - 0.2, dh * 0.38, 0.01, 0x7a4a2e, [ddx, dh * 0.72, ddz - 0.045]);
    S.box(dw - 0.2, dh * 0.38, 0.01, 0x7a4a2e, [ddx, dh * 0.27, ddz - 0.045]);
    S.box(dw + 0.16, 0.08, 0.06, 0xd8c8b4, [ddx, dh + 0.04, ddz - 0.03]);
    S.box(0.08, dh, 0.06, 0xd8c8b4, [ddx - dw / 2 - 0.04, dh / 2, ddz - 0.03]);
    S.box(0.08, dh, 0.06, 0xd8c8b4, [ddx + dw / 2 + 0.04, dh / 2, ddz - 0.03]);
    S.add(new THREE.SphereGeometry(0.03, 8, 6), 0xd8b860, { pos: [ddx + dw / 2 - 0.1, 1.0, ddz - 0.07] });
    S.box(0.6, 0.012, 0.45, 0x5a5060, [ddx, 0.006, ddz - 0.4]); // door mat
  }

  // --- posters ---------------------------------------------------------------
  {
    const pm = toonMaterial({ map: posterAtlas() }); pm.name = 'room-posters';
    const pb = new GeoBucket();
    const poster = (i, pos, rotY, w = 0.62, h = 0.93) => {
      const g = new THREE.PlaneGeometry(w, h);
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / 3);
      pb.add(g, 0xffffff, { pos, rot: [0, rotY, 0] });
    };
    poster(0, [X1 - 0.01, 1.72, 1.25], -Math.PI / 2);
    poster(1, [X0 + 0.01, 1.72, -1.55], Math.PI / 2, 0.56, 0.84);
    poster(2, [0.9, 1.6, Z1 - 0.01], Math.PI, 0.7, 1.05);
    poster(0, [X0 + 0.01, 1.85, 2.1], Math.PI / 2, 0.5, 0.75);
    root.add(pb.mesh(pm, 'Posters'));
  }

  // --- plants (crossed alpha-tested planes) -----------------------------------
  {
    const potFn = (c) => shade(c, { ao: 0.2, aoH: 0.1 });
    const plant = (x, y, z, size, potH = 0.3, potR = 0.14, potC = 0xe8e2da) => {
      S.add(new THREE.CylinderGeometry(potR, potR * 0.78, potH, 14), potFn(potC), { pos: [x, y + potH / 2, z] });
      S.add(new THREE.CylinderGeometry(potR * 0.92, potR * 0.92, 0.01, 14), 0x3a2a20, { pos: [x, y + potH - 0.02, z] });
      const n = 4;
      for (let k = 0; k < n; k++) {
        const g = new THREE.PlaneGeometry(size, size);
        g.translate(0, size / 2, 0);
        leaves.add(g, 0xffffff, { pos: [x, y + potH - 0.04, z], rot: [0, (k / n) * Math.PI + 0.3, 0], order: 'YXZ' });
      }
      // a tilted pair for volume
      for (const tilt of [-0.5, 0.5]) {
        const g = new THREE.PlaneGeometry(size * 0.8, size * 0.8); g.translate(0, size * 0.4, 0);
        leaves.add(g, 0xe0f0d0, { pos: [x, y + potH - 0.04, z], rot: [tilt, tilt * 2, 0], order: 'YXZ' });
      }
    };
    plant(1.3, 0, -2.68, 1.0, 0.38, 0.17, 0xe8e2da);
    plant(-0.22, 0, -2.72, 0.75, 0.32, 0.14, 0xd8d2ca);
    plant(-1.35, WIN.yMin, -2.9, 0.38, 0.13, 0.07, 0xc85a3a);
    plant(1.4, WIN.yMin, -2.9, 0.34, 0.12, 0.065, 0xe8e2da);
    plant(2.3, F.desk.size[1], 1.8, 0.4, 0.14, 0.07, 0xe8e2da);
    plant(-2.32, F.bookshelf.size[1], 0.45, 0.42, 0.14, 0.07, 0xc85a3a);
    plant(-2.32, 0, 2.55, 0.9, 0.36, 0.16, 0x2a2a30);
    const leafMat = toonMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true }); leafMat.name = 'room-leaves';
    root.add(leaves.mesh(leafMat, 'PlantLeaves'));
  }

  // --- merge statics ---------------------------------------------------------
  root.add(S.mesh(matVC, 'RoomStatic'));
  root.add(G.mesh(matGlow, 'RoomGlow'));

  parts.windowSashes = windowSashes;
  parts.windowGlassMeshes = windowGlassMeshes;
  parts.floorMesh = floorMesh;
  parts.rug = rug;
  parts.curtains = curtainMesh;

  void ROOM_BLOCKERS;
  root.updateMatrixWorld(true);

  const update = (t) => {
    parts.radioCtl.update(t);
    const pulse = 0.85 + 0.15 * Math.sin(t * 2.2);
    parts.rackGlowMaterial.color.setScalar(pulse);
  };

  return { root, parts, floorMesh, colliders, update };
}

// ---------------------------------------------------------------------------
// Stylised placeholder Mobius suit (white armour, dark joints, cyan accents).
// Built in mount-local space: feet at y=0, facing +Z.
// ---------------------------------------------------------------------------
function buildSuitPlaceholder(matVC) {
  const g = new THREE.Group(); g.name = 'SuitPlaceholder';
  const b = new GeoBucket(); const glow = new GeoBucket();
  const white = 0xeef0f6, dark = 0x22242e, grey = 0xb8bccc;
  const cap = (r, l, c, pos, rot) => b.add(new THREE.CapsuleGeometry(r, l, 3, 10), c, { pos, rot });
  for (const s of [-1, 1]) {
    // legs
    b.add(new RoundedBoxGeometry(0.13, 0.08, 0.24, 2, 0.03), white, { pos: [s * 0.11, 0.04, 0.03] });
    cap(0.065, 0.32, white, [s * 0.11, 0.3, 0]);
    b.add(new THREE.SphereGeometry(0.06, 10, 8), dark, { pos: [s * 0.11, 0.52, 0.01] });
    cap(0.08, 0.3, white, [s * 0.1, 0.74, 0]);
    glow.box(0.015, 0.22, 0.012, 0x40e0ff, [s * 0.155, 0.3, 0.05]);
    glow.box(0.015, 0.2, 0.012, 0x40e0ff, [s * 0.16, 0.74, 0.06]);
    // arms
    b.add(new THREE.SphereGeometry(0.1, 12, 8), white, { pos: [s * 0.27, 1.42, 0], scale: [1.1, 0.9, 1] });
    cap(0.052, 0.24, white, [s * 0.31, 1.2, 0], [0, 0, s * 0.1]);
    b.add(new THREE.SphereGeometry(0.045, 8, 6), dark, { pos: [s * 0.33, 1.04, 0] });
    cap(0.048, 0.22, grey, [s * 0.34, 0.86, 0.02], [0, 0, s * 0.05]);
    b.add(new THREE.SphereGeometry(0.05, 8, 6), dark, { pos: [s * 0.35, 0.68, 0.03] });
    glow.box(0.012, 0.14, 0.012, 0x40e0ff, [s * 0.37, 0.86, 0.06]);
  }
  b.add(new RoundedBoxGeometry(0.34, 0.16, 0.2, 2, 0.05), dark, { pos: [0, 0.95, 0] });
  b.add(new RoundedBoxGeometry(0.3, 0.2, 0.19, 2, 0.06), grey, { pos: [0, 1.1, 0] });
  b.add(new RoundedBoxGeometry(0.44, 0.3, 0.24, 3, 0.09), white, { pos: [0, 1.32, 0] });
  b.add(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 10), dark, { pos: [0, 1.5, 0] });
  b.add(new THREE.SphereGeometry(0.12, 16, 12), white, { pos: [0, 1.64, 0], scale: [0.95, 1.1, 1.05] });
  b.add(new THREE.SphereGeometry(0.1, 14, 10, -0.9, 1.8, 0.9, 0.8), 0x101018, { pos: [0, 1.64, 0.035], scale: [1, 1, 1.05] });
  glow.box(0.12, 0.012, 0.012, 0x60f0ff, [0, 1.655, 0.125]);
  glow.add(new THREE.TorusGeometry(0.035, 0.009, 6, 16), 0x50e8ff, { pos: [-0.034, 1.34, 0.123] });
  glow.add(new THREE.TorusGeometry(0.035, 0.009, 6, 16), 0x50e8ff, { pos: [0.034, 1.34, 0.123] });
  glow.box(0.3, 0.012, 0.01, 0x40c8ff, [0, 1.2, 0.1]);
  g.add(b.mesh(matVC, 'SuitBody'));
  g.add(glow.mesh(new THREE.MeshBasicMaterial({ vertexColors: true }), 'SuitGlow'));
  return g;
}
