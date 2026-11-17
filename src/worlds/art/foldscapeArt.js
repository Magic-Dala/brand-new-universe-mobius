// Foldscape City art (v0.41): the Blender near-detail kit at runtime + the facade helpers the foldscape kit uses.
//
// Asset split: the code (src/worlds/kits/foldscape.js) assembles the building masses, roads, painted window grids and
// the folded far city; the Blender kit (public/models/foldscape/foldscape_kit.glb, tools/blender/build_foldscape_kit.py)
// supplies the geometric detail — window surrounds + sashes, cornices, parapets, quoins, storefronts, open fire
// escapes, water tanks, roof units, tower crowns.
//
// Ownership / lifecycle
//  • Kit geometries: loaded ONCE through a ref-counted cache (acquireKit / releaseKit). Every FoldscapeDetail holds one
//    reference from construction to dispose; the geometries are disposed only when the last holder releases. A load
//    that resolves after its renderer was disposed attaches nothing (and the cache keeps no orphan reference).
//  • Placements: generated while a module builds (kit callbacks → add()), stored per cell in ROUTE space (world space
//    without the floating-origin offset). The pools sit in one group positioned at world.off, so a rebase — even one
//    that happens while a module is still queued / half-built — only moves the group: details never drift from their
//    building. Removing a cell drops its placements; the pools are rebuilt (bounded copy) when anything changes.
//  • Pools: one InstancedMesh per (piece, LOD) sharing the cached geometry and one material (the renderer's world
//    shader with the FOLDSCAPE define + shared uniforms) → ≤ 2 × pieces draw calls in total, independent of the number
//    of modules. Instance buffers grow by doubling and are disposed with the pool.
//  • LOD per placement and piece class from the camera distance (quality presets below), re-selected only when the
//    camera crosses an 8 m grid step (one bounded copy pass; no per-frame work otherwise).
//  • Missing / failed kit: the city still renders (painted windows, procedural masses); stats.kit = 'failed'.
import * as THREE from 'three';
import { K } from './builder.js';
import { toWorld, frameAt } from '../route.js';
import { CITY_SHARED } from '../../art/cityMaterials.js';

export const FOLDSCAPE_ART = {
  url: 'models/foldscape/foldscape_kit.glb',
  quality: 'high', // 'high' | 'low' | 'off' (off = no Blender detail; masses + painted windows only)
  // [LOD0 max distance, LOD1 max distance] (m, camera → piece origin) per class; beyond: not drawn (painted facade)
  lod: {
    high: { bay: [30, 115], store: [30, 90], trim: [42, 240], fe: [40, 170], roof: [80, 460], crown: [150, 1e9] },
    low: { bay: [0, 70], store: [0, 40], trim: [0, 130], fe: [0, 90], roof: [0, 240], crown: [0, 1e9] },
  },
  step: 8, // m: the LOD selection is redone when the camera crosses a grid step of this size (bounded CPU)
  grid: { bay: 3.0, floor: 3.3, base: 4.5, glassBay: 3.2, glassCell: 1.6, glassFloor: 3.8, glassBase: 6.0 },
};
// kinds handled by the FOLDSCAPE branch of the world shader (shaders.js)
export const FK = { BRICK_WIN: 18, BRICK_ARCH: 19, STONE_WIN: 20, BRICK: 21, STONE: 22 };
const MAT_KIND = [FK.BRICK, FK.STONE, K.METAL, K.PLAIN, K.WOOD, K.PLAIN, K.METAL, K.GLASS];
const MAT_COL = [0xffffff, 0xd8c8a6, 0x2b2d31, 0x3a302a, 0x7a5a3e, 0x3e3a38, 0x8c8e8e, 0x34404e].map((h) => new THREE.Color(h));
const PIECE_CLASS = { fs_bay_rect: 'bay', fs_bay_arch: 'bay', fs_bay_stone: 'bay', fs_glass_bay: 'bay', fs_store: 'store', fs_belt: 'trim', fs_cornice: 'trim', fs_parapet: 'trim', fs_quoin: 'trim', fs_fire_escape: 'fe', fs_fire_escape_base: 'fe', fs_water_tank: 'roof', fs_hvac: 'roof', fs_bulkhead: 'roof', fs_crown: 'crown' };
export const PIECES = Object.keys(PIECE_CLASS);

// =============================================================================================== kit cache (ref-counted)
let _loader = null; // test hook: () => Promise<Map<name, [geo0, geo1]>>
export function setKitLoader(fn) { _loader = fn; }
const cache = { refs: 0, promise: null, kit: null, state: 'idle', loads: 0, disposals: 0 };
export function kitCacheState() { return { refs: cache.refs, state: cache.state, loads: cache.loads, disposals: cache.disposals, loaded: !!cache.kit }; }
/** Take a reference; resolves to the kit (Map name → [LOD0 geometry, LOD1 geometry]) or null on failure. */
export function acquireKit() {
  cache.refs++;
  if (!cache.promise) {
    cache.state = 'loading'; cache.loads++;
    const p = (_loader ? _loader() : loadGLB(FOLDSCAPE_ART.url)).then((kit) => {
      if (cache.promise !== p) { disposeKit(kit); return null; } // released (refs hit 0) while loading
      cache.kit = kit; cache.state = 'ready'; return kit;
    }).catch((e) => { console.warn('[foldscape] kit failed to load — painted facades only', e); if (cache.promise === p) { cache.state = 'failed'; } return null; });
    cache.promise = p;
  }
  return cache.promise;
}
export function releaseKit() {
  if (cache.refs <= 0) return;
  if (--cache.refs > 0) return;
  if (cache.kit) disposeKit(cache.kit);
  cache.kit = null; cache.promise = null; cache.state = 'idle';
}
function disposeKit(kit) { if (!kit) return; for (const lods of kit.values()) for (const g of lods) g?.dispose(); cache.disposals++; }

async function loadGLB(url) {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  const kit = new Map();
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = /^(.*)_LOD([01])$/.exec(o.name); if (!m) return;
    const g = toWorldGeometry(o.geometry);
    o.geometry.dispose();
    if (!kit.has(m[1])) kit.set(m[1], [null, null]);
    kit.get(m[1])[+m[2]] = g;
  });
  for (const n of PIECES) if (!kit.get(n)?.[0] || !kit.get(n)?.[1]) throw new Error(`foldscape kit lacks ${n}`);
  return kit;
}
/**
 * glTF primitive (POSITION, NORMAL, TEXCOORD_0, COLOR_0 = AO / material id / edge) → the world shader's attributes:
 * colour = palette albedo × AO (+ edge wear), uv = metres, aMat = (surface kind, 0.5).
 */
export function toWorldGeometry(src) {
  const n = src.attributes.position.count, C = src.attributes.color, U = src.attributes.uv;
  const col = new Float32Array(n * 3), mat = new Float32Array(n * 2), uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const ao = C ? C.getX(i) : 1, id = C ? Math.round(C.getY(i) * 8) : 0, e = C ? C.getZ(i) : 0;
    const c = MAT_COL[id] || MAT_COL[0], k = ao * (1 + 0.12 * e);
    col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
    mat[i * 2] = MAT_KIND[id] ?? K.PLAIN; mat[i * 2 + 1] = 0.5;
    uv[i * 2] = U ? U.getX(i) : 0; uv[i * 2 + 1] = U ? U.getY(i) : 0;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', src.attributes.position.clone());
  g.setAttribute('normal', src.attributes.normal.clone());
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aMat', new THREE.BufferAttribute(mat, 2));
  if (src.index) g.setIndex(src.index.clone());
  g.computeBoundingSphere();
  return g;
}

// =============================================================================================== per-renderer detail
const _m = new THREE.Matrix4(), _t = new THREE.Matrix4(), _c = new THREE.Color(), _p = new THREE.Vector3();
export class FoldscapeDetail {
  constructor(wr) {
    this.wr = wr; this.world = wr.world; this.disposed = false;
    // the city's CC0 arrays (loaded at boot for Dala City; shared uniform objects — never disposed here)
    for (const m of [wr.mat, wr.backMat]) if (m?.defines?.FOLDSCAPE) for (const k of ['uAlb', 'uNrm', 'uOrm', 'uPbrOn']) m.uniforms[k] = CITY_SHARED[k];
    this.group = new THREE.Group(); this.group.name = 'FoldscapeDetail';
    // the renderer's world shader (same uniforms object → same lighting, fog, textures) compiled for instancing
    this.mat = wr.mat.clone(); this.mat.uniforms = wr.mat.uniforms; this.mat.name = 'FoldscapeKitMat';
    this.cells = new Map(); this.pools = new Map(); this.dirty = true; this.camQ = null;
    this.stats = { kit: 'loading', instances: 0, drawn: 0, tris: 0, pools: 0, rebuilds: 0, rebuildMs: 0, maxRebuildMs: 0 };
    this.kit = null;
    this.on = FOLDSCAPE_ART.quality !== 'off';
    this.ready = this.on ? acquireKit().then((kit) => this._attach(kit)) : Promise.resolve(null);
    if (this.on) this._held = true;
    wr.root.add(this.group);
  }
  whenReady() { return this.ready; }
  _attach(kit) {
    if (this.disposed) return null; // switched away while loading: attach nothing
    if (!kit) { this.stats.kit = 'failed'; return null; }
    this.kit = kit; this.stats.kit = 'ready'; this.dirty = true;
    return kit;
  }
  // ---------------------------------------------------------------- placements (called from the kit while a module builds)
  /** Start collecting a module's placements; returns the sink the kit calls (one per cell: safe if builds interleave). */
  beginCell(cell, b, gx, gz) {
    const sink = { cell, b, gx, gz, list: new Map(), on: this.on, add: (name, M, tint) => this._add(sink, name, M, tint) };
    return sink;
  }
  /** Place piece `name` with matrix `M` (frame of the builder's current transform = the structure), tint (hex). */
  _add(sk, name, M, tint = 0xffffff) {
    if (!sk.on || this.disposed) return;
    _t.makeTranslation(sk.gx, 0, sk.gz).multiply(sk.b.mat).multiply(M);
    let L = sk.list.get(name); if (!L) sk.list.set(name, L = { m: [], c: [] });
    for (let i = 0; i < 16; i++) L.m.push(_t.elements[i]);
    _c.set(tint); L.c.push(_c.r, _c.g, _c.b);
  }
  endCell(cell, sink) {
    if (!sink || sink.cell !== cell || this.disposed) return;
    const pieces = new Map();
    for (const [name, L] of sink.list) pieces.set(name, { m: new Float32Array(L.m), c: new Float32Array(L.c), n: L.m.length / 16 });
    this.cells.set(cell, { pieces });
    this.dirty = true;
  }
  rebased() { this.group.position.set(this.world.off[0], 0, this.world.off[1]); }
  releaseCell(cell) { if (this.cells.delete(cell)) this.dirty = true; }
  // ---------------------------------------------------------------- per frame
  update(cam) {
    if (this.disposed) return;
    this.group.position.set(this.world.off[0], 0, this.world.off[1]);
    if (!this.kit) return;
    const st = FOLDSCAPE_ART.step, qx = Math.round((cam.x - this.world.off[0]) / st), qy = Math.round(cam.y / st), qz = Math.round((cam.z - this.world.off[1]) / st);
    const q = this.camQ; if (!q || q[0] !== qx || q[1] !== qy || q[2] !== qz) { this.camQ = [qx, qy, qz]; this.dirty = true; } // (route space: a rebase is not a move)
    if (this.dirty) this._rebuild();
  }
  _pool(name, lod, need) {
    const key = `${name}:${lod}`; let p = this.pools.get(key);
    if (p && p.cap >= need) return p;
    let cap = p ? p.cap : 16; while (cap < need) cap *= 2;
    if (p) { this.group.remove(p.mesh); p.mesh.dispose(); }
    const mesh = new THREE.InstancedMesh(this.kit.get(name)[lod], this.mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.count = 0; mesh.visible = false; mesh.name = `fs:${key}`;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    p = { mesh, cap, tris: (this.kit.get(name)[lod].index?.count ?? 0) / 3 };
    this.pools.set(key, p); this.group.add(mesh);
    return p;
  }
  _rebuild() {
    const t0 = performance.now(), Q = FOLDSCAPE_ART.lod[FOLDSCAPE_ART.quality] || FOLDSCAPE_ART.lod.high, st = FOLDSCAPE_ART.step;
    const [cx, cy, cz] = (this.camQ || [0, 0, 0]).map((v) => v * st);
    const sel = new Map(); // key → [entry, index] lists
    let inst = 0;
    for (const e of this.cells.values()) for (const [name, P] of e.pieces) {
      const cls = PIECE_CLASS[name], r0 = Q[cls][0] ** 2, r1 = Q[cls][1] ** 2; if (!this.kit.has(name)) continue;
      for (let i = 0; i < P.n; i++) {
        const o = i * 16, d2 = (P.m[o + 12] - cx) ** 2 + (P.m[o + 13] - cy) ** 2 + (P.m[o + 14] - cz) ** 2;
        if (d2 >= r1) continue;
        const lod = d2 < r0 ? 0 : 1;
        const key = `${name}:${lod}`; let s = sel.get(key); if (!s) sel.set(key, s = []); s.push(P, i); inst++;
      }
    }
    let drawn = 0, tris = 0; const by = {};
    for (const [key, p] of this.pools) if (!sel.has(key)) { p.mesh.count = 0; p.mesh.visible = false; }
    for (const [key, s] of sel) {
      const [name, lod] = key.split(':'), n = s.length / 2, p = this._pool(name, +lod, n);
      const M = p.mesh.instanceMatrix.array, C = p.mesh.instanceColor.array;
      for (let j = 0; j < n; j++) { const P = s[j * 2], i = s[j * 2 + 1]; M.set(P.m.subarray(i * 16, i * 16 + 16), j * 16); C.set(P.c.subarray(i * 3, i * 3 + 3), j * 3); }
      p.mesh.count = n; p.mesh.visible = n > 0;
      p.mesh.instanceMatrix.needsUpdate = true; p.mesh.instanceColor.needsUpdate = true;
      p.mesh.instanceMatrix.clearUpdateRanges?.(); p.mesh.instanceMatrix.addUpdateRange?.(0, n * 16);
      p.mesh.instanceColor.clearUpdateRanges?.(); p.mesh.instanceColor.addUpdateRange?.(0, n * 3);
      drawn++; tris += n * p.tris; by[key] = Math.round(n * p.tris);
    }
    this.dirty = false;
    const ms = performance.now() - t0, S = this.stats;
    S.instances = inst; S.drawn = drawn; S.tris = Math.round(tris); S.pools = this.pools.size; S.rebuilds++; S.byPool = by; S.rebuildMs = +ms.toFixed(2); S.maxRebuildMs = Math.max(S.maxRebuildMs, S.rebuildMs);
  }
  /** Number of stored placements (all live cells). */
  get placements() { let n = 0; for (const e of this.cells.values()) for (const P of e.pieces.values()) n += P.n; return n; }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    for (const p of this.pools.values()) { this.group.remove(p.mesh); p.mesh.dispose(); }
    this.pools.clear(); this.cells.clear();
    this.group.parent?.remove(this.group);
    this.mat.dispose();
    if (this._held) { this._held = false; releaseKit(); }
    this.kit = null;
  }
}

// =============================================================================================== facade helpers (kit side)
const UP = [0, 1, 0];
/** The four faces of a tier box in the structure frame: out normal, right axis, centre on the face plane, width. */
export function tierFaces(t) {
  const cx = t.dv, cz = -t.du, hx = t.d / 2, hz = t.w / 2;
  return {
    X: { out: [1, 0, 0], right: [0, 0, -1], c: [cx + hx, cz], W: t.w },
    x: { out: [-1, 0, 0], right: [0, 0, 1], c: [cx - hx, cz], W: t.w },
    Z: { out: [0, 0, 1], right: [1, 0, 0], c: [cx, cz + hz], W: t.d },
    z: { out: [0, 0, -1], right: [-1, 0, 0], c: [cx, cz - hz], W: t.d },
  };
}
/** Bay grid across a face: n bays of width bw centred, xs = left edge of the first bay (face coordinate). */
export function bayGrid(W, bw, margin = 0.55) { const n = Math.max(0, Math.floor((W - 2 * margin) / bw)); return { n, xs: -n * bw / 2 }; }
/** Floors fully inside [y0, y1 − reserve] for floor height fh above base. */
export function floorRange(y0, y1, base, fh, reserve) {
  const k0 = Math.max(0, Math.ceil((Math.max(y0, base) - base) / fh - 1e-6)), k1 = Math.floor((y1 - reserve - base) / fh + 1e-6) - 1;
  return { k0, k1, n: Math.max(0, k1 - k0 + 1) };
}
/** Axis-aligned rect on a face (face coords x0..x1 along `right`, y0..y1), uv = (x − uOrigin, y − vOrigin). */
export function faceRect(b, F, x0, x1, y0, y1, col, kind, vr, uO = 0, vO = 0) {
  if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3) return;
  const P = (x, y) => [F.c[0] + F.right[0] * x, y, F.c[1] + F.right[2] * x];
  b.quad(P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1), col, kind, vr, [x0 - uO, y0 - vO, x1 - x0, y1 - y0]);
}
/** Facade-frame matrix for a piece on face F at face coordinate x, height y (z out of the wall). sx scales along x. */
export function faceMatrix(F, x, y, sx = 1, out = new THREE.Matrix4()) {
  const r = F.right, n = F.out;
  return out.set(r[0] * sx, UP[0], n[0], F.c[0] + r[0] * x, r[1] * sx, UP[1], n[1], y, r[2] * sx, UP[2], n[2], F.c[1] + r[2] * x, 0, 0, 0, 1);
}
/** Roof matrix: origin at (x, y, z) in the structure frame, yaw about +y, uniform scale. */
export function roofMatrix(x, y, z, yaw = 0, s = 1, out = new THREE.Matrix4()) {
  const c = Math.cos(yaw) * s, n = Math.sin(yaw) * s;
  return out.set(c, 0, n, x, 0, s, 0, y, -n, 0, c, z, 0, 0, 0, 1);
}
/**
 * Swing anchors near structure s, in its own frame: [{x, y, z}] (to keep details clear of the devices). Includes the
 * anchors of every structure of this module and of its neighbours (modules may overlap by a few metres at the seams).
 */
export function anchorsLocal(m, s, mods = [m], radius = 40) {
  const out = [], [sx, sz] = toWorld(m, s.u, s.v), yaw = -frameAt(m, s.u).a, c = Math.cos(yaw), n = Math.sin(yaw);
  for (const mm of mods) for (const a of mm.anchors) {
    const [ax, az] = toWorld(mm, a.u, a.v), dx = ax - sx, dz = az - sz;
    if (dx * dx + dz * dz > radius * radius) continue;
    out.push({ x: dx * c - dz * n, y: a.y, z: dx * n + dz * c, sid: a.sid }); // inverse of the builder's yaw rotation
  }
  return out;
}
/** Face coordinate (along `right`) of a structure-frame point; distance from the face plane. */
export function onFace(F, p) { return { x: (p.x - F.c[0]) * F.right[0] + (p.z - F.c[1]) * F.right[2], off: (p.x - F.c[0]) * F.out[0] + (p.z - F.c[1]) * F.out[2] }; }
export { _p as _tmpVec, _m as _tmpMat };
