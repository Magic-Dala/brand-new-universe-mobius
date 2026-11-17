// Redrock Canyon art (v0.46): the user's four Tripo rocks + the Blender redrock kit at runtime.
//
// Asset split: the code (src/worlds/kits/redrock.js) draws the layered cliffs inside the route's collision tiers, the
// dwellings, rope bridges, river and far canyon, and PLACES instanced pieces through this module:
//   • public/models/redrock/redrock_heroes.glb + rr_*.jpg — the four Tripo sources (tools/blender/build_redrock_kit.py:
//     welded + collapse-decimated LOD0 / LOD1, 1024² base colour): natural arch, hoodoo A (mushroom), hoodoo B (split cap),
//     overhang alcove.
//   • public/models/redrock/redrock_kit.glb + redrock_kit.json — Blender hoodoo support shafts, caprock
//     crowns, talus aprons, boulders, anchor mounts, mid-distance spires and mesas.
//
// Ownership / lifecycle (the forest contract, but an independent cache: nothing is shared with forestArt.js)
//  • Geometries + the four hero textures are loaded ONCE through a ref-counted cache (acquireRedrock / releaseRedrock).
//    Every RedrockDetail holds one reference from construction to dispose; a load resolving after its renderer was
//    disposed attaches nothing; a load resolving after the last release disposes what it loaded. A failed / timed-out
//    load frees every request (also siblings that arrive later) and the kit draws the legacy procedural canyon.
//  • Placements: generated while a module builds (kit → ctx.extras.add), stored per cell in ROUTE space. The pools sit in
//    one group positioned at world.off, so a rebase — even with builds queued / half-done — only moves the group.
//  • Pools: one InstancedMesh per (piece key, LOD) sharing the cached geometry; kit pieces share ONE material (the
//    renderer's world shader with the REDROCK define + shared uniforms); each hero has its own material (same program,
//    own texture uniform). A piece may be placed under a class override ('far': the mid-distance heroes), which is its
//    own pool / range but the same geometry + material. Instance buffers grow by doubling and are disposed with the pool.
//  • LOD per placement from the camera distance and the class ranges (quality presets below), re-selected when the camera
//    crosses an 8 m grid step. Beyond the LOD1 range a piece is not drawn (fog / the far backdrop carry it).
//  • Quality per renderer (resolveRedrockQuality): an immersive session selects 'quest' (earlier LOD, shorter ranges,
//    thinned clutter, conservative two-eye view selection); the desktop keeps 'high'; ?redrockq=high|low|quest|off
//    overrides both. Nothing global is mutated. View selection (quest) tests each placement's transformed bounding box
//    against the camera's side planes widened by an angular margin and padded by the movement allowance; it re-selects
//    on 8 m grid steps, head turns (any axis), movement and projection changes. In XR app.camera carries three's both-eye
//    union frustum; no valid perspective camera → distance-only selection (conservative fallback).
//  • stats.assets: 'loading' | 'ready' | 'failed' | 'off'. The game waits (blockLoad) for the assets before streaming.
import * as THREE from 'three';

export const REDROCK_ART = {
  kitUrl: 'models/redrock/redrock_kit.glb', heroUrl: 'models/redrock/redrock_heroes.glb', manifestUrl: 'models/redrock/redrock_kit.json',
  heroes: ['rr_arch', 'rr_hoodoo_a', 'rr_hoodoo_b', 'rr_alcove'],
  quality: 'high', // requested (desktop) quality: 'high' | 'low' | 'quest' | 'off' (off = the legacy procedural canyon)
  xrQuality: 'quest',
  override: null, // ?redrockq=… diagnostic override (wins over both)
  // [LOD0 max distance, LOD1 max distance] (m, camera → piece origin) per class. Fog 160–1200 m; modules stream ≤ ~800 m.
  lod: {
    high: { hero: [150, 900], far: [260, 1100], shaft: [70, 700], cap: [70, 600], talus: [45, 360], boulder: [35, 220], mount: [45, 180], spire: [170, 1100], mesa: [190, 1100] },
    low: { hero: [90, 650], far: [160, 800], shaft: [40, 450], cap: [30, 360], talus: [0, 200], boulder: [0, 110], mount: [30, 120], spire: [90, 800], mesa: [100, 800] },
    // Quest 3: far LOD early (heroes 4–5× lighter, kit 2.5–4×), clutter only near; the Tripo heroes stay drawn to 560 m
    // (LOD1) so the landmarks never pop in the middle distance; anchor mounts as far as the anchors are useful.
    quest: { hero: [75, 560], far: [140, 720], shaft: [40, 480], cap: [34, 340], talus: [24, 190], boulder: [16, 100], mount: [30, 130], spire: [100, 720], mesa: [110, 720] },
  },
  profile: {
    quest: {
      view: { margin: 25, turn: 8, move: 4, pad: 2 }, // (same reasoning as the forest profile: margin ≥ √1.5·turn + one fast head snap)
      thin: { rk_boulder: [30, 0.5], rk_talus: [60, 0.6] }, // [distance, kept share] free-standing clutter only
    },
  },
  step: 8,
  loadTimeoutMs: 30000,
};
try { const q = new URLSearchParams(globalThis.location?.search || '').get('redrockq'); if (q && (REDROCK_ART.lod[q] || q === 'off')) REDROCK_ART.override = q; } catch { /* no location (Node) */ }
const validQ = (q) => q === 'off' || !!REDROCK_ART.lod[q];
/** Quality one renderer uses: override > immersive XR (→ xrQuality) > requested desktop quality. 'off' only on request. */
export function resolveRedrockQuality({ xr = false, override = REDROCK_ART.override, base = REDROCK_ART.quality } = {}) {
  if (override && validQ(override)) return { requested: override, resolved: override, reason: 'override' };
  const requested = validQ(base) ? base : 'high';
  if (xr && requested !== 'off') return { requested, resolved: REDROCK_ART.xrQuality, reason: 'xr' };
  return { requested, resolved: requested, reason: 'default' };
}
export const xrActiveOf = (app) => !!(app && (app.xrActive || app.renderer?.xr?.isPresenting));
// kinds handled by the REDROCK branch of the world shader (shaders.js)
export const RK = { SAND: 29, HERO: 30, KIT: 31 };
const MAT = [0xb9643e, 0x9c5b40, 0xd09468].map((c) => new THREE.Color(c)); // kit material ids: sandstone, talus, caprock

/** Fitted proportions of the unit-normalised Tripo sources (redrock_kit.json heroes.*.profile, checked by
 * tests/redrock-art.test.mjs): the kit composes with these before the assets arrive (deterministic placements). */
export const REDROCK_DIMS = {
  // arch: opening centre x, its half width at the feet / at mid height, crown underside at the centre and at ±0.08 / ±0.1,
  // crown top (max), depth (z) half extent
  arch: { cx: 0.02, halfFeet: 0.215, halfMid: 0.245, under: 0.307, underSide: 0.286, top: 0.403, height: 0.426, halfDepth: 0.225, halfWidth: 0.49 },
  // hoodoos: cap band (y), cap half extents x / z, corridor-side (−x for B: the stem) extent
  hoodoo_a: { capY0: 0.70, halfX: 0.39, halfZ: 0.45, height: 1.0 },
  hoodoo_b: { capY0: 0.56, stemMinX: -0.43, halfX: 0.48, halfZ: 0.49, height: 1.0 },
  // alcove: back wall (z) of the cavity, cavity floor / roof underside (y), roof lip reach (+z), half width, height
  alcove: { backZ: -0.26, floorY: 0.045, roofY: 0.27, lipZ: 0.43, halfX: 0.48, halfZ: 0.49, height: 0.534 },
};

// =============================================================================================== cache (ref-counted)
let _loader = null; // test hook: () => Promise<{ geo: Map<name, [g0, g1]>, tex: Map<hero, Texture|null>, manifest }>
export function setRedrockLoader(fn) { _loader = fn; }
const cache = { refs: 0, promise: null, assets: null, state: 'idle', loads: 0, disposals: 0 };
export function redrockCacheState() { return { refs: cache.refs, state: cache.state, loads: cache.loads, disposals: cache.disposals, loaded: !!cache.assets }; }
export function acquireRedrock() {
  cache.refs++;
  if (!cache.promise) {
    cache.state = 'loading'; cache.loads++;
    const p = Promise.resolve().then(() => _loader ? _loader() : loadRedrockAssets()).then((a) => {
      if (cache.promise !== p) { disposeAssets(a); return null; } // released (refs hit 0) while loading
      cache.assets = a; cache.state = 'ready'; return a;
    }).catch((e) => { console.warn('[redrock] assets failed to load — procedural canyon only', e); if (cache.promise === p) cache.state = 'failed'; return null; });
    cache.promise = p;
  }
  return cache.promise;
}
export function releaseRedrock() {
  if (cache.refs <= 0) return;
  if (--cache.refs > 0) return;
  if (cache.assets) disposeAssets(cache.assets);
  cache.assets = null; cache.promise = null; cache.state = 'idle';
}
function disposeAssets(a) {
  if (!a) return;
  for (const lods of a.geo.values()) for (const g of lods) g?.dispose();
  for (const t of a.tex.values()) t?.dispose();
  cache.disposals++;
}
function disposeGltf(gltf) {
  const owned = new Set();
  gltf?.scene?.traverse((o) => {
    if (o.geometry) owned.add(o.geometry);
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m) { for (const t of Object.values(m)) if (t?.isTexture) owned.add(t); owned.add(m); }
  });
  for (const r of owned) r.dispose();
}
/** Transactional load: a failure / timeout frees completed requests and siblings that arrive later.
 * Optional request promises (manifest, kit gltf, hero gltf, ...4 textures) let tests drive the real ownership path. */
export async function loadRedrockAssets(requests = null) {
  if (!requests) {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const L = new GLTFLoader();
    requests = [
      fetch(REDROCK_ART.manifestUrl).then((r) => { if (!r.ok) throw new Error(`manifest HTTP ${r.status}`); return r.json(); }),
      L.loadAsync(REDROCK_ART.kitUrl), L.loadAsync(REDROCK_ART.heroUrl),
      ...REDROCK_ART.heroes.map((h) => new THREE.TextureLoader().loadAsync(`models/redrock/${h}.jpg`)),
    ];
  }
  let aborted = false, timer;
  const receipts = [], geo = new Map();
  const tracked = requests.map((request, i) => Promise.resolve(request).then((value) => {
    const dispose = i === 0 ? () => {} : i < 3 ? () => disposeGltf(value) : () => value?.dispose();
    if (aborted) { dispose(); return null; }
    receipts.push({ i, dispose }); return value;
  }));
  try {
    const [manifest, kit, heroes, ...tex] = await Promise.race([
      Promise.all(tracked),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('redrock asset load timed out')), REDROCK_ART.loadTimeoutMs); }),
    ]);
    for (const [gltf, hero] of [[kit, false], [heroes, true]]) gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = /^(.*)_LOD([01])$/.exec(o.name); if (!m) return;
      const g = hero ? heroGeometry(o.geometry) : kitGeometry(o.geometry);
      if (!geo.has(m[1])) geo.set(m[1], [null, null]);
      geo.get(m[1])[+m[2]] = g;
    });
    for (const p of manifest.pieces) if (!geo.get(p.name)?.[0] || !geo.get(p.name)?.[1]) throw new Error(`redrock kit lacks ${p.name}`);
    for (const h of REDROCK_ART.heroes) if (!geo.get(h)?.[0] || !geo.get(h)?.[1]) throw new Error(`redrock heroes lack ${h}`);
    const texMap = new Map();
    REDROCK_ART.heroes.forEach((h, i) => {
      const t = tex[i]; if (!t) throw new Error(`redrock texture ${h} missing`);
      t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; // glTF uv convention
      t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true;
      texMap.set(h, t);
    });
    for (const r of receipts) if (r.i === 1 || r.i === 2) r.dispose(); // converted copies own the data; sources never reach the GPU
    return { geo, tex: texMap, manifest };
  } catch (error) {
    aborted = true;
    for (const lods of geo.values()) for (const g of lods) g?.dispose();
    for (const r of receipts) r.dispose();
    throw error;
  } finally { clearTimeout(timer); }
}
/** Blender kit primitive (COLOR_0 = AO / material id / variation) → world-shader attributes (kind KIT). */
export function kitGeometry(src) {
  const n = src.attributes.position.count, C = src.attributes.color, U = src.attributes.uv;
  const col = new Float32Array(n * 3), mat = new Float32Array(n * 2), uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const ao = C ? C.getX(i) : 1, id = C ? Math.round(C.getY(i) * 8) : 0, e = C ? C.getZ(i) : 0.5, c = MAT[id] || MAT[0];
    col[i * 3] = c.r * ao; col[i * 3 + 1] = c.g * ao; col[i * 3 + 2] = c.b * ao;
    mat[i * 2] = RK.KIT; mat[i * 2 + 1] = e;
    uv[i * 2] = U ? U.getX(i) : 0; uv[i * 2 + 1] = U ? U.getY(i) : 0;
  }
  return assemble(src, col, mat, uv);
}
/** Tripo hero primitive (POSITION / NORMAL / TEXCOORD_0) → world-shader attributes, kind HERO (textured). */
export function heroGeometry(src) {
  const n = src.attributes.position.count, col = new Float32Array(n * 3).fill(1), mat = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { mat[i * 2] = RK.HERO; mat[i * 2 + 1] = 0.5; }
  return assemble(src, col, mat, src.attributes.uv ? new Float32Array(src.attributes.uv.array) : new Float32Array(n * 2));
}
function assemble(src, col, mat, uv) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', src.attributes.position.clone());
  g.setAttribute('normal', src.attributes.normal.clone());
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aMat', new THREE.BufferAttribute(mat, 2));
  if (src.index) g.setIndex(src.index.clone());
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

// =============================================================================================== per-renderer detail
const _t = new THREE.Matrix4(), _c = new THREE.Color(), DEG = Math.PI / 180;
/** Stable [0, 1) rank of placement i (route-space position + index): which share of a thinned piece stays drawn. */
function rankOf(x, z, i) {
  let h = (Math.round(x * 8) * 73856093) ^ (Math.round(z * 8) * 19349663) ^ Math.imul(i + 1, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const newView = () => ({ ex: 0, ey: 0, ez: 0, xx: 0, xy: 0, xz: 0, yx: 0, yy: 0, yz: 0, zx: 0, zy: 0, zz: 0, tl: 0, tr: 0, tt: 0, tb: 0, pad: 0, np: 0, n: new Float64Array(12) });
export class RedrockDetail {
  constructor(wr) {
    this.wr = wr; this.world = wr.world; this.disposed = false; this.blockLoad = true;
    this.group = new THREE.Group(); this.group.name = 'RedrockDetail';
    this.mat = wr.mat.clone(); this.mat.uniforms = wr.mat.uniforms; this.mat.name = 'RedrockKitMat'; // same uniforms → same light / fog
    this.heroMats = new Map();
    this.cells = new Map(); this.pools = new Map(); this.dirty = true; this.camQ = null; this.cls = new Map();
    this.kinds = new Map(); // key (piece or piece@cls) → { name, cls, key0/1, l0/l1, box of both LODs }
    this._cur = newView(); this._sel = newView(); this._selView = false;
    this._override = REDROCK_ART.override; this._xr = xrActiveOf(wr.app);
    const q = resolveRedrockQuality({ xr: this._xr, override: this._override });
    this.stats = { assets: 'loading', instances: 0, drawn: 0, tris: 0, pools: 0, rebuilds: 0, rebuildMs: 0, maxRebuildMs: 0, quality: q.resolved, requested: q.requested, reason: q.reason, xr: this._xr,
      cull: 'off', culled: 0, thinned: 0, profileSwitches: 0, heroes: {}, byPool: {} };
    this._profile(q.resolved);
    this.assets = null;
    this.on = q.resolved !== 'off';
    if (this.on) {
      this._held = true;
      const pending = acquireRedrock().then((a) => this._attach(a));
      this.ready = Promise.race([pending, new Promise((resolve) => { this._loadTimer = setTimeout(() => { this.fallback(); resolve(null); }, REDROCK_ART.loadTimeoutMs); })]).finally(() => clearTimeout(this._loadTimer));
    } else { this.stats.assets = 'off'; this.ready = Promise.resolve(null); }
    wr.root.add(this.group);
  }
  whenReady() { return this.ready; }
  get loading() { return this.on && !this.disposed && this.stats.assets === 'loading'; }
  /** Kit pieces available (or still loading: placements made now are drawn once they arrive). */
  get usable() { return this.on && this.stats.assets !== 'failed'; }
  /** Expire a slow request before cells build, so the kit selects the procedural fallback consistently. */
  fallback() {
    if (!this.loading) return;
    this.stats.assets = 'failed';
    if (this._held) { this._held = false; releaseRedrock(); }
  }
  _attach(a) {
    if (this.disposed || !this._held) return null; // switched away / timed out: attach nothing
    if (!a) { this.stats.assets = 'failed'; return null; }
    this.assets = a; this.stats.assets = 'ready'; this.dirty = true;
    for (const p of a.manifest.pieces) this.cls.set(p.name, p.cls);
    for (const h of REDROCK_ART.heroes) {
      this.cls.set(h, 'hero');
      const m = this.wr.mat.clone(); m.name = `RedrockHero:${h}`; m.uniforms = { ...this.wr.mat.uniforms, uHeroMap: { value: a.tex.get(h) } };
      this.heroMats.set(h, m);
    }
    for (const [name, cls] of this.cls) this._kind(name, cls);
    for (const e of this.cells.values()) for (const key of e.pieces.keys()) { const [name, cls] = key.split('@'); if (!this.kinds.has(key)) this._kind(name, cls || this.cls.get(name), key); }
    return a;
  }
  /** Selection record of a pool key (the geometry box encloses both LODs, piece frame). */
  _kind(name, cls, key = name) {
    const lods = this.assets?.geo.get(name); if (!lods?.[0] || !cls) return null;
    const box = new THREE.Box3(); for (const g of lods) if (g) { if (!g.boundingBox) g.computeBoundingBox(); box.union(g.boundingBox); }
    const c = box.getCenter(new THREE.Vector3()), h = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const k = { key, name, cls, key0: `${key}:0`, key1: `${key}:1`, l0: [], l1: [], cx: c.x, cy: c.y, cz: c.z, hx: h.x, hy: h.y, hz: h.z };
    this.kinds.set(key, k); return k;
  }
  _profile(q) {
    const P = REDROCK_ART.profile[q] || null;
    this.ranges = REDROCK_ART.lod[q] || REDROCK_ART.lod.high;
    this.viewOpt = P?.view || null; this.thin = P?.thin || null;
    if (this.viewOpt) { const v = this.viewOpt; this._cosTurn = Math.cos(v.turn * DEG); this._move2 = v.move * v.move; this._margin = v.margin * DEG; this._pad = v.move + v.pad; }
    this.stats.cull = this.viewOpt ? 'fallback' : 'off';
  }
  /** Immersive session started / ended under this renderer (no override): switch the selection profile only. */
  _syncXR() {
    const xr = xrActiveOf(this.wr.app); if (xr === this._xr) return;
    this._xr = xr; this.stats.xr = xr;
    const q = resolveRedrockQuality({ xr, override: this._override });
    this.stats.requested = q.requested; this.stats.reason = q.reason;
    if (!this.on || q.resolved === 'off' || q.resolved === this.stats.quality) return;
    this.stats.quality = q.resolved; this.stats.profileSwitches++; this._profile(q.resolved); this._selView = false; this.dirty = true;
  }
  // ---------------------------------------------------------------- placements (called from the kit while a module builds)
  beginCell(cell, b, gx, gz) {
    const sink = { cell, b, gx, gz, list: new Map(), on: this.usable, quality: this.stats.quality, add: (name, M, tint, cls) => this._add(sink, name, M, tint, cls) };
    return sink;
  }
  /** Place piece `name` with matrix `M` (frame of the builder's current transform), tint (hex), optional class override. */
  _add(sk, name, M, tint = 0xffffff, cls = null) {
    if (!sk.on || this.disposed) return;
    _t.makeTranslation(sk.gx, 0, sk.gz).multiply(sk.b.mat).multiply(M);
    const key = cls ? `${name}@${cls}` : name;
    let L = sk.list.get(key); if (!L) sk.list.set(key, L = { m: [], c: [] });
    for (let i = 0; i < 16; i++) L.m.push(_t.elements[i]);
    _c.set(tint); L.c.push(_c.r, _c.g, _c.b);
  }
  endCell(cell, sink) {
    if (!sink || sink.cell !== cell || this.disposed) return;
    const pieces = new Map();
    for (const [key, L] of sink.list) {
      const m = new Float32Array(L.m), n = L.m.length / 16, k = new Float32Array(n);
      for (let i = 0; i < n; i++) k[i] = rankOf(m[i * 16 + 12], m[i * 16 + 14], i);
      pieces.set(key, { m, c: new Float32Array(L.c), n, k, b: null });
      if (this.assets && !this.kinds.has(key)) { const [name, cls] = key.split('@'); this._kind(name, cls || this.cls.get(name), key); }
    }
    this.cells.set(cell, { pieces });
    this.dirty = true;
  }
  rebased() { this.group.position.set(this.world.off[0], 0, this.world.off[1]); }
  releaseCell(cell) { if (this.cells.delete(cell)) this.dirty = true; }
  // ---------------------------------------------------------------- per frame
  update(cam, view = null) {
    if (this.disposed) return;
    this.group.position.set(this.world.off[0], 0, this.world.off[1]);
    for (const m of [this.wr.mat, this.wr.backMat]) m?.uniforms?.uOff?.value.set(this.world.off[0], this.world.off[1]); // route-space rock grain (rebase-stable; hero materials share the entry)
    if (this.wr.app) this._syncXR();
    if (!this.assets) return;
    // eye: the rendering camera's fresh world position (the `cam` vector may predate a rebase this frame)
    let ex = cam.x, ey = cam.y, ez = cam.z;
    if (view?.matrixWorld) {
      view.updateWorldMatrix?.(true, false);
      const e = view.matrixWorld.elements;
      if (Number.isFinite(e[12]) && Number.isFinite(e[13]) && Number.isFinite(e[14])) { ex = e[12]; ey = e[13]; ez = e[14]; }
    }
    const st = REDROCK_ART.step, qx = Math.round((ex - this.world.off[0]) / st), qy = Math.round(ey / st), qz = Math.round((ez - this.world.off[1]) / st);
    const q = this.camQ; if (!q || q[0] !== qx || q[1] !== qy || q[2] !== qz) { this.camQ = [qx, qy, qz]; this.dirty = true; }
    if (this.viewOpt) {
      const ok = this._readView(view, this._cur, false);
      if (ok !== this._selView) this.dirty = true;
      else if (ok && !this.dirty) {
        const a = this._cur, b = this._sel, c = this._cosTurn;
        if ((a.ex - b.ex) ** 2 + (a.ey - b.ey) ** 2 + (a.ez - b.ez) ** 2 > this._move2
          || a.xx * b.xx + a.xy * b.xy + a.xz * b.xz < c || a.yx * b.yx + a.yy * b.yy + a.yz * b.yz < c || a.zx * b.zx + a.zy * b.zy + a.zz * b.zz < c
          || Math.abs(a.tl - b.tl) + Math.abs(a.tr - b.tr) + Math.abs(a.tt - b.tt) + Math.abs(a.tb - b.tb) > 1e-3) this.dirty = true;
      }
      if (this.dirty) { this._selView = ok; if (ok) this._freeze(this._cur, this._sel); }
    }
    if (this.dirty) this._rebuild();
  }
  /** Camera → route-space snapshot v; false (→ distance-only fallback) for a missing / non-perspective / invalid camera. */
  _readView(view, v, refresh = true) {
    if (!view?.matrixWorld || !view.projectionMatrix) return false;
    if (refresh) view.updateWorldMatrix?.(true, false);
    const m = view.matrixWorld.elements, p = view.projectionMatrix.elements;
    if (p[11] !== -1 || p[15] !== 0 || !(p[0] > 0) || !(p[5] > 0) || !Number.isFinite(p[8]) || !Number.isFinite(p[9]) || !Number.isFinite(p[0] + p[5])) return false;
    for (let i = 0; i < 16; i++) if (!Number.isFinite(m[i])) return false;
    const lx = Math.hypot(m[0], m[1], m[2]), ly = Math.hypot(m[4], m[5], m[6]), lz = Math.hypot(m[8], m[9], m[10]);
    if (!(lx > 1e-6 && ly > 1e-6 && lz > 1e-6)) return false;
    v.ex = m[12] - this.world.off[0]; v.ey = m[13]; v.ez = m[14] - this.world.off[1];
    v.xx = m[0] / lx; v.xy = m[1] / lx; v.xz = m[2] / lx; v.yx = m[4] / ly; v.yy = m[5] / ly; v.yz = m[6] / ly; v.zx = m[8] / lz; v.zy = m[9] / lz; v.zz = m[10] / lz;
    v.tl = (1 - p[8]) / p[0]; v.tr = (1 + p[8]) / p[0]; v.tt = (1 + p[9]) / p[5]; v.tb = (1 - p[9]) / p[5]; // (side-plane tangents: asymmetric eye / union frusta included)
    return true;
  }
  _freeze(a, v) {
    const n = v.n; Object.assign(v, a); v.n = n; v.np = 0; v.pad = this._pad;
    const M = this._margin, lim = Math.PI / 2 - 1e-3, fx = -v.zx, fy = -v.zy, fz = -v.zz;
    const add = (t, ax, ay, az) => { const g = Math.atan(t) + M; if (g >= lim) return; const c = Math.cos(g), s = Math.sin(g), k = v.np++ * 3; n[k] = ax * c + fx * s; n[k + 1] = ay * c + fy * s; n[k + 2] = az * c + fz * s; };
    add(v.tl, v.xx, v.xy, v.xz); add(v.tr, -v.xx, -v.xy, -v.xz); add(v.tt, -v.yx, -v.yy, -v.yz); add(v.tb, v.yx, v.yy, v.yz);
  }
  _bounds(P, k) {
    const b = P.b = new Float32Array(P.n * 3), m = P.m;
    for (let i = 0; i < P.n; i++) {
      const o = i * 16;
      b[i * 3] = m[o] * k.cx + m[o + 4] * k.cy + m[o + 8] * k.cz + m[o + 12];
      b[i * 3 + 1] = m[o + 1] * k.cx + m[o + 5] * k.cy + m[o + 9] * k.cz + m[o + 13];
      b[i * 3 + 2] = m[o + 2] * k.cx + m[o + 6] * k.cy + m[o + 10] * k.cz + m[o + 14];
    }
  }
  /** Conservative oriented-box test (the transformed full-geometry box of both LODs, any rotation / scale): false only
   * when the padded box lies wholly outside a widened side plane. Planes pass through the eye → camera inside passes. */
  static sees(v, k, m, o, b, j) {
    const dx = b[j] - v.ex, dy = b[j + 1] - v.ey, dz = b[j + 2] - v.ez, n = v.n;
    for (let p = 0; p < v.np * 3; p += 3) {
      const nx = n[p], ny = n[p + 1], nz = n[p + 2];
      const e = k.hx * Math.abs(nx * m[o] + ny * m[o + 1] + nz * m[o + 2]) + k.hy * Math.abs(nx * m[o + 4] + ny * m[o + 5] + nz * m[o + 6]) + k.hz * Math.abs(nx * m[o + 8] + ny * m[o + 9] + nz * m[o + 10]);
      if (nx * dx + ny * dy + nz * dz < -(e + v.pad)) return false;
    }
    return true;
  }
  _pool(k, lod, need) {
    const key = lod ? k.key1 : k.key0; let p = this.pools.get(key);
    if (p && p.cap >= need) return p;
    let cap = p ? p.cap : 16; while (cap < need) cap *= 2;
    if (p) { this.group.remove(p.mesh); p.mesh.dispose(); }
    const geo = this.assets.geo.get(k.name)[lod];
    const mesh = new THREE.InstancedMesh(geo, this.heroMats.get(k.name) || this.mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.count = 0; mesh.visible = false; mesh.name = `rr:${key}`;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    p = { mesh, cap, tris: (geo.index?.count ?? 0) / 3 };
    this.pools.set(key, p); this.group.add(mesh);
    return p;
  }
  _rebuild() {
    const t0 = performance.now(), Q = this.ranges, TH = this.thin, st = REDROCK_ART.step, q = this.camQ;
    const cx = q ? q[0] * st : 0, cy = q ? q[1] * st : 0, cz = q ? q[2] * st : 0;
    const V = this.viewOpt && this._selView ? this._sel : null, sees = RedrockDetail.sees;
    for (const k of this.kinds.values()) { k.l0.length = 0; k.l1.length = 0; }
    let inst = 0, culled = 0, thinned = 0;
    for (const e of this.cells.values()) for (const [key, P] of e.pieces) {
      const k = this.kinds.get(key), R = k && Q[k.cls]; if (!R) continue;
      const r0 = R[0] ** 2, r1 = R[1] ** 2, T = TH && TH[k.name], t2 = T ? T[0] ** 2 : Infinity, keep = T ? T[1] : 1;
      if (V && !P.b) this._bounds(P, k);
      const m = P.m, b = P.b;
      for (let i = 0; i < P.n; i++) {
        const o = i * 16, d2 = (m[o + 12] - cx) ** 2 + (m[o + 13] - cy) ** 2 + (m[o + 14] - cz) ** 2;
        if (d2 >= r1) continue;
        if (d2 >= t2 && P.k[i] >= keep) { thinned++; continue; }
        if (V && !sees(V, k, m, o, b, i * 3)) { culled++; continue; }
        (d2 < r0 ? k.l0 : k.l1).push(P, i); inst++;
      }
    }
    let drawn = 0, tris = 0; const S = this.stats, by = S.byPool, H = S.heroes;
    for (const k of this.kinds.values()) for (let lod = 0; lod < 2; lod++) {
      const s = lod ? k.l1 : k.l0, key = lod ? k.key1 : k.key0, n = s.length / 2;
      if (!n) { const p = this.pools.get(key); if (p && p.mesh.visible) { p.mesh.count = 0; p.mesh.visible = false; } if (key in by) delete by[key]; continue; }
      const p = this._pool(k, lod, n), M = p.mesh.instanceMatrix.array, C = p.mesh.instanceColor.array;
      for (let j = 0; j < n; j++) { const P = s[j * 2], i = s[j * 2 + 1]; M.set(P.m.subarray(i * 16, i * 16 + 16), j * 16); C.set(P.c.subarray(i * 3, i * 3 + 3), j * 3); }
      p.mesh.count = n; p.mesh.visible = true; p.mesh.boundingSphere = null; p.mesh.boundingBox = null; // (raycasts recompute lazily: never stale)
      p.mesh.instanceMatrix.needsUpdate = true; p.mesh.instanceColor.needsUpdate = true;
      p.mesh.instanceMatrix.clearUpdateRanges?.(); p.mesh.instanceMatrix.addUpdateRange?.(0, n * 16);
      p.mesh.instanceColor.clearUpdateRanges?.(); p.mesh.instanceColor.addUpdateRange?.(0, n * 3);
      drawn++; tris += n * p.tris; by[key] = Math.round(n * p.tris);
    }
    this.dirty = false;
    const ms = performance.now() - t0;
    S.instances = inst; S.culled = culled; S.thinned = thinned; S.drawn = drawn; S.tris = Math.round(tris); S.pools = this.pools.size; S.rebuilds++;
    S.rebuildMs = +ms.toFixed(2); S.maxRebuildMs = Math.max(S.maxRebuildMs, S.rebuildMs);
    if (this.viewOpt) S.cull = V ? 'view' : 'fallback';
    for (const h of REDROCK_ART.heroes) H[h] = 0;
    for (const k of this.kinds.values()) if (k.cls === 'hero' || REDROCK_ART.heroes.includes(k.name)) H[k.name] = (H[k.name] || 0) + (k.l0.length + k.l1.length) / 2;
  }
  /** Visit the current selection: fn(key, lod, piece, index) (tests / diagnostics). */
  forEachSelected(fn) { for (const k of this.kinds.values()) for (let lod = 0; lod < 2; lod++) { const s = lod ? k.l1 : k.l0; for (let j = 0; j < s.length; j += 2) fn(k.key, lod, s[j], s[j + 1]); } }
  get placements() { let n = 0; for (const e of this.cells.values()) for (const P of e.pieces.values()) n += P.n; return n; }
  /** Placements of one piece (all classes) in all live cells. */
  count(name) { let n = 0; for (const e of this.cells.values()) for (const [key, P] of e.pieces) if (key === name || key.startsWith(name + '@')) n += P.n; return n; }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    clearTimeout(this._loadTimer);
    for (const p of this.pools.values()) { this.group.remove(p.mesh); p.mesh.dispose(); }
    this.pools.clear(); this.cells.clear(); this.kinds.clear();
    this.group.parent?.remove(this.group);
    this.mat.dispose(); for (const m of this.heroMats.values()) m.dispose(); this.heroMats.clear();
    if (this._held) { this._held = false; releaseRedrock(); }
    this.assets = null;
  }
}

// =============================================================================================== placement helpers (kit side)
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
/** Matrix: translate (x, y, z), yaw about +y, optional pitch / roll, scale (sx, sy, sz). */
export function trs(x, y, z, yaw = 0, sx = 1, sy = sx, sz = sx, pitch = 0, roll = 0, out = new THREE.Matrix4()) {
  _e.set(pitch, yaw, roll, 'YXZ'); _q.setFromEuler(_e);
  return out.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}
/** Yaw (about +y) that turns local +Z toward direction (dx, dz). */
export const yawTo = (dx, dz) => Math.atan2(dx, dz);
