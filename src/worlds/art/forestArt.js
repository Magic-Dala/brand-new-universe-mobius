// Forest of Shadow Ruins art (v0.43): the user's Tripo hero models + the Blender forest kit at runtime.
//
// Asset split: the code (src/worlds/kits/forest.js) assembles each module inside the route's collision tiers — masonry
// masses, decks, stream rocks, light shafts, the far valley — and PLACES pieces through this module:
//   • public/models/forest/forest_heroes.glb + hero_*.jpg — the four Tripo sources (tools/blender/build_forest_kit.py:
//     decimated LOD0/LOD1, 1024² base colour): buttress roots, root-wrapped ruin, spider-guardian statue, royal altar.
//   • public/models/forest/forest_kit.glb + forest_kit.json — Blender trunks, crowns, canopy masses, roots, burls,
//     vines, strangler roots, arches, broken bridge ends, columns, wall crowns, niches, rubble, boulders, ferns, shrubs.
//   • public/models/forest/forest_leaf.png — the kit's original RGBA leaf / twig atlas (v0.44 foliage): canopy clumps,
//     shrubs and vine leaves are branch-supported spray cards (material id 8 → kind LEAFCARD, atlas uv kept unscaled),
//     drawn by ONE extra material per renderer (FOREST_LEAF define: alpha test with discard, double sided, depth write).
//
// Ownership / lifecycle (same contract as foldscapeArt.js, separate cache)
//  • Geometries + the four hero textures + the leaf atlas are loaded ONCE through a ref-counted cache (acquireForest / releaseForest). Every
//    ForestDetail holds one reference from construction to dispose; resources are disposed only when the last holder
//    releases. A load that resolves after its renderer was disposed attaches nothing; a load that resolves after the
//    last release disposes what it loaded (no orphan GPU resources).
//  • Placements: generated while a module builds (kit → ctx.extras.add), stored per cell in ROUTE space. The pools sit in
//    one group positioned at world.off, so a rebase — even with builds queued / half-done — only moves the group.
//    Removing a cell drops its placements; pools are rebuilt (bounded copy) when anything changes.
//  • Pools: one InstancedMesh per (piece, LOD) sharing the cached geometry; kit pieces share ONE material (the renderer's
//    world shader with the FOREST define + shared uniforms); each hero has its own material (same program, own texture
//    uniform). Instance buffers grow by doubling and are disposed with the pool.
//  • LOD per placement from the camera distance and the piece class (quality presets below), re-selected only when the
//    camera crosses an 8 m grid step. Beyond the LOD1 range a piece is not drawn (fog hides it).
//  • v0.45 Quest profile: the quality is resolved PER RENDERER (resolveForestQuality): an immersive session selects
//    'quest' (earlier far LOD, shorter ranges, thinned cosmetic pieces beyond a distance, conservative view selection);
//    the desktop keeps 'high' exactly as before; ?forestq= overrides both. Nothing global is mutated. View selection
//    (quest only) tests each placement's transformed bounding box against the camera's side planes widened by an
//    angular margin and padded by the movement allowance; it re-selects on 8 m grid steps, heading/roll changes,
//    movement and projection changes. The XR camera (app.camera) carries three's both-eye union frustum; no valid
//    perspective camera → distance-only selection (conservative fallback).
//  • stats.assets: 'loading' | 'ready' | 'failed' | 'off'. The kit draws its legacy procedural trees / ruins when the
//    assets are off or failed; the game waits (blockLoad) for the assets before streaming the start, so nothing pops in.
import * as THREE from 'three';
import { K } from './builder.js';

export const FOREST_ART = {
  kitUrl: 'models/forest/forest_kit.glb', heroUrl: 'models/forest/forest_heroes.glb', manifestUrl: 'models/forest/forest_kit.json',
  heroes: ['hero_roots', 'hero_ruin', 'hero_statue', 'hero_altar'],
  leafUrl: 'models/forest/forest_leaf.png', // (tex map key 'leaf'; a missing atlas fails the whole bundle → procedural fallback)
  quality: 'high', // requested (desktop) quality: 'high' | 'low' | 'quest' | 'off' (off = the legacy procedural forest)
  xrQuality: 'quest', // what an immersive session resolves to (per renderer, see resolveForestQuality)
  override: null, // ?forestq=… diagnostic override (wins over both)
  // [LOD0 max distance, LOD1 max distance] (m, camera → piece origin) per class. LOD1 ends near the fog's far distance
  // (500 m: fully fogged beyond); the camera-following valley backdrop carries the silhouettes further out.
  lod: {
    high: { trunk: [65, 520], crown: [70, 520], canopy: [75, 540], roots: [38, 300], mount: [45, 150], vine: [40, 130], wrap: [55, 240], masonry: [60, 420], rock: [45, 180], plant: [35, 110], hero: [80, 480] },
    low: { trunk: [45, 380], crown: [40, 380], canopy: [45, 400], roots: [25, 200], mount: [0, 110], vine: [0, 80], wrap: [0, 150], masonry: [30, 280], rock: [0, 110], plant: [0, 55], hero: [55, 360] },
    // Quest 3: far LOD early (the LOD1 crowns / canopy cards are 4–8× lighter), trunks + crowns to 320 m (forest
    // silhouette, fog 45–500 m); the leaf clumps reach at least as far as the crowns they sit on (never bare limbs);
    // mounts keep the 'high' range (the anchor burls). Tuned on the measured views.
    quest: { trunk: [32, 320], crown: [30, 320], canopy: [26, 320], roots: [18, 170], mount: [24, 150], vine: [18, 80], wrap: [24, 160], masonry: [28, 210], rock: [14, 90], plant: [10, 45], hero: [36, 300] },
  },
  // per quality: view selection + cosmetic thinning (absent = the original distance-only selection, e.g. high / low)
  profile: {
    quest: {
      // side planes widened by `margin`° and boxes padded by `move` + `pad` m; re-select after `turn`° of any axis or
      // `move` m. margin ≥ √1.5·turn (basis-vector test bound) + one frame of a fast head snap (≈ 11° at 72 Hz).
      view: { margin: 25, turn: 8, move: 4, pad: 1.5 },
      // per-piece [LOD0, LOD1] ranges over the class: the Tripo statue's LOD1 IS its LOD0 (8k — lighter collapses smear its
      // UV seams, forest-art-upgrade D3), so far LOD saves nothing; it is drawn to 200 m (≈ 34 % fog) instead of 300.
      piece: { hero_statue: [36, 200] },
      // [distance m, kept fraction]: beyond the distance only that (stable, hashed) share of a cosmetic piece is drawn.
      // Free-standing clutter only — never a canopy clump (every limb tip keeps its leaves), crown, trunk, hero, mount
      // or masonry piece; near pieces are never thinned.
      thin: { vn_hang: [30, 0.5], fx_fern: [16, 0.5], fx_bush: [16, 0.5], rk_boulder: [30, 0.6], rk_boulder_b: [30, 0.6], rn_rubble: [28, 0.5] },
    },
  },
  step: 8,
  loadTimeoutMs: 30000,
};
// headset A/B without a rebuild: ?forestq=quest|high|low|off on the game URL (a diagnostic override: XR or not)
try { const q = new URLSearchParams(globalThis.location?.search || '').get('forestq'); if (q && (FOREST_ART.lod[q] || q === 'off')) FOREST_ART.override = q; } catch { /* no location (Node) */ }
const validQ = (q) => q === 'off' || !!FOREST_ART.lod[q];
/** The forest quality one renderer uses: override > immersive XR (→ xrQuality) > the requested desktop quality.
 * 'off' is only ever the result of an explicit request (never chosen automatically). */
export function resolveForestQuality({ xr = false, override = FOREST_ART.override, base = FOREST_ART.quality } = {}) {
  if (override && validQ(override)) return { requested: override, resolved: override, reason: 'override' };
  const requested = validQ(base) ? base : 'high';
  if (xr && requested !== 'off') return { requested, resolved: FOREST_ART.xrQuality, reason: 'xr' };
  return { requested, resolved: requested, reason: 'default' };
}
/** Immersive session state of the production app (WorldRenderer's app; null in tests / previews). */
export const xrActiveOf = (app) => !!(app && (app.xrActive || app.renderer?.xr?.isPresenting));
// kinds handled by the FOREST branch of the world shader (shaders.js)
export const FK = { BARK: 23, STONE: 24, LEAF: 25, HERO: 26, ROCK: 27, LEAFCARD: 28 };
// kit material ids (COLOR_0.g × 8) → [shader kind, albedo]
const MAT = [[FK.BARK, 0x634a36], [FK.STONE, 0x9c9a8a], [FK.LEAF, 0x4f8030], [FK.LEAF, 0x566f2a], [K.PLAIN, 0x141510], [FK.LEAF, 0x3a5c24], [FK.ROCK, 0x86887a], [FK.LEAF, 0x4c8a2c], [FK.LEAFCARD, 0xffffff]]
  .map(([k, c]) => [k, new THREE.Color(c)]);

// =============================================================================================== cache (ref-counted)
let _loader = null; // test hook: () => Promise<{ geo: Map<name, [g0, g1]>, tex: Map<hero, Texture|null>, manifest }>
export function setForestLoader(fn) { _loader = fn; }
const cache = { refs: 0, promise: null, assets: null, state: 'idle', loads: 0, disposals: 0 };
export function forestCacheState() { return { refs: cache.refs, state: cache.state, loads: cache.loads, disposals: cache.disposals, loaded: !!cache.assets }; }
export function acquireForest() {
  cache.refs++;
  if (!cache.promise) {
    cache.state = 'loading'; cache.loads++;
    const p = Promise.resolve().then(() => _loader ? _loader() : loadForestAssets()).then((a) => {
      if (cache.promise !== p) { disposeAssets(a); return null; } // released (refs hit 0) while loading
      cache.assets = a; cache.state = 'ready'; return a;
    }).catch((e) => { console.warn('[forest] assets failed to load — procedural forest only', e); if (cache.promise === p) cache.state = 'failed'; return null; });
    cache.promise = p;
  }
  return cache.promise;
}
export function releaseForest() {
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
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m) {
      for (const t of Object.values(m)) if (t?.isTexture) owned.add(t);
      owned.add(m);
    }
  });
  for (const resource of owned) resource.dispose();
}
/** Transactional load: a failure/timeout frees both completed requests and siblings that arrive later.
 * Optional request promises let tests exercise the real ownership path without a browser/network.
 */
export async function loadForestAssets(requests = null) {
  if (!requests) {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const L = new GLTFLoader();
    requests = [
      fetch(FOREST_ART.manifestUrl).then((r) => { if (!r.ok) throw new Error(`manifest HTTP ${r.status}`); return r.json(); }),
      L.loadAsync(FOREST_ART.kitUrl), L.loadAsync(FOREST_ART.heroUrl),
      ...FOREST_ART.heroes.map((h) => new THREE.TextureLoader().loadAsync(`models/forest/${h}.jpg`)),
      new THREE.TextureLoader().loadAsync(FOREST_ART.leafUrl),
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
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('forest asset load timed out')), FOREST_ART.loadTimeoutMs); }),
  ]);
  for (const [gltf, hero] of [[kit, false], [heroes, true]]) gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = /^(.*)_LOD([01])$/.exec(o.name); if (!m) return;
    const g = hero ? heroGeometry(o.geometry) : kitGeometry(o.geometry);
    if (!geo.has(m[1])) geo.set(m[1], [null, null]);
    geo.get(m[1])[+m[2]] = g;
  });
  for (const p of manifest.pieces) if (!geo.get(p.name)?.[0] || !geo.get(p.name)?.[1]) throw new Error(`forest kit lacks ${p.name}`);
  for (const h of FOREST_ART.heroes) if (!geo.get(h)?.[0] || !geo.get(h)?.[1]) throw new Error(`forest heroes lack ${h}`);
  const texMap = new Map();
  FOREST_ART.heroes.forEach((h, i) => {
    const t = tex[i]; t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; // glTF uv convention
    t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true;
    texMap.set(h, t);
  });
  const leaf = tex[FOREST_ART.heroes.length]; if (!leaf) throw new Error('forest leaf atlas missing');
  leaf.colorSpace = THREE.SRGBColorSpace; leaf.flipY = false; leaf.premultiplyAlpha = false; // (glTF v: the kit's leaf uvs index the atlas top-down)
  leaf.wrapS = leaf.wrapT = THREE.ClampToEdgeWrapping; leaf.anisotropy = 4; leaf.generateMipmaps = true; leaf.minFilter = THREE.LinearMipmapLinearFilter; leaf.needsUpdate = true;
  texMap.set('leaf', leaf);
  // Converted geometry and standalone textures transfer to the ref-counted cache; source scenes never reach the GPU.
  for (const r of receipts) if (r.i === 1 || r.i === 2) r.dispose();
  return { geo, tex: texMap, manifest };
  } catch (error) {
    aborted = true;
    for (const lods of geo.values()) for (const g of lods) g?.dispose();
    for (const r of receipts) r.dispose();
    throw error;
  } finally { clearTimeout(timer); }
}
/** Blender kit primitive (COLOR_0 = AO / material id / mask) → world-shader attributes. */
export function kitGeometry(src) {
  const n = src.attributes.position.count, C = src.attributes.color, U = src.attributes.uv;
  const col = new Float32Array(n * 3), mat = new Float32Array(n * 2), uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const ao = C ? C.getX(i) : 1, id = C ? Math.round(C.getY(i) * 8) : 0, e = C ? C.getZ(i) : 0.5;
    const [kind, c] = MAT[id] || MAT[0];
    col[i * 3] = c.r * ao; col[i * 3 + 1] = c.g * ao; col[i * 3 + 2] = c.b * ao;
    mat[i * 2] = kind; mat[i * 2 + 1] = e;
    uv[i * 2] = U ? U.getX(i) : 0; uv[i * 2 + 1] = U ? U.getY(i) : 0;
  }
  return assemble(src, col, mat, uv);
}
/** Tripo hero primitive (POSITION / NORMAL / TEXCOORD_0) → world-shader attributes, kind HERO (textured). */
export function heroGeometry(src) {
  const n = src.attributes.position.count;
  const col = new Float32Array(n * 3).fill(1), mat = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { mat[i * 2] = FK.HERO; mat[i * 2 + 1] = 0.5; }
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
  g.computeBoundingSphere();
  return g;
}

// =============================================================================================== per-renderer detail
const _t = new THREE.Matrix4(), _c = new THREE.Color();
const CLASS_OF_HERO = 'hero', DEG = Math.PI / 180;
/** Stable [0, 1) rank of placement i (route-space position + index): which share of a thinned piece stays drawn. */
function rankOf(x, z, i) {
  let h = (Math.round(x * 8) * 73856093) ^ (Math.round(z * 8) * 19349663) ^ Math.imul(i + 1, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/** View snapshot (route space): eye, unit basis (x right, y up, z back), side-plane tangents of the projection;
 * frozen for a selection: the inward normals of the enabled widened side planes (n: [nx, ny, nz] × count). */
const newView = () => ({ ex: 0, ey: 0, ez: 0, xx: 0, xy: 0, xz: 0, yx: 0, yy: 0, yz: 0, zx: 0, zy: 0, zz: 0, tl: 0, tr: 0, tt: 0, tb: 0,
  pad: 0, np: 0, n: new Float64Array(12) });
export class ForestDetail {
  constructor(wr) {
    this.wr = wr; this.world = wr.world; this.disposed = false; this.blockLoad = true;
    this.group = new THREE.Group(); this.group.name = 'ForestDetail';
    this.mat = wr.mat.clone(); this.mat.uniforms = wr.mat.uniforms; this.mat.name = 'ForestKitMat'; // same uniforms → same light / fog
    this.heroMats = new Map(); this.leafMat = null; this.alpha = new Set();
    this.cells = new Map(); this.pools = new Map(); this.dirty = true; this.camQ = null; this.cls = new Map(); this.tips = new Map();
    this.kinds = new Map(); // piece → { cls, key0/1, l0/l1 (selection scratch), box of both LODs }
    this._cur = newView(); this._sel = newView(); this._selView = false;
    this._override = FOREST_ART.override; this._xr = xrActiveOf(wr.app);
    const q = resolveForestQuality({ xr: this._xr, override: this._override });
    this.stats = { assets: 'loading', instances: 0, drawn: 0, tris: 0, pools: 0, rebuilds: 0, rebuildMs: 0, maxRebuildMs: 0, quality: q.resolved, requested: q.requested, reason: q.reason, xr: this._xr,
      cull: 'off', culled: 0, thinned: 0, profileSwitches: 0 };
    this._profile(q.resolved);
    this.assets = null;
    this.on = q.resolved !== 'off';
    if (this.on) {
      this._held = true;
      const pending = acquireForest().then((a) => this._attach(a));
      this.ready = Promise.race([pending, new Promise((resolve) => {
        this._loadTimer = setTimeout(() => { this.fallback(); resolve(null); }, FOREST_ART.loadTimeoutMs);
      })]).finally(() => clearTimeout(this._loadTimer));
    } else { this.stats.assets = 'off'; this.ready = Promise.resolve(null); }
    wr.root.add(this.group);
  }
  whenReady() { return this.ready; }
  /** Still waiting for the assets (the game's loader keeps the black screen up meanwhile). */
  get loading() { return this.on && !this.disposed && this.stats.assets === 'loading'; }
  /** Kit pieces available (or still loading: placements made now are drawn once they arrive). */
  get usable() { return this.on && this.stats.assets !== 'failed'; }
  /** Expire a slow request before cells build, so the kit selects the procedural fallback consistently. */
  fallback() {
    if (!this.loading) return;
    this.stats.assets = 'failed';
    if (this._held) { this._held = false; releaseForest(); }
  }
  _attach(a) {
    if (this.disposed || !this._held) return null; // switched away / timed out: attach nothing
    if (!a) { this.stats.assets = 'failed'; return null; }
    this.assets = a; this.stats.assets = 'ready'; this.dirty = true;
    for (const p of a.manifest.pieces) { this.cls.set(p.name, p.cls); if (p.tips) this.tips.set(p.name, p.tips); if (p.alpha) this.alpha.add(p.name); }
    // leaf cards: the same world shader + FOREST_LEAF (atlas alpha test → discard only in this program), both sides
    this.leafMat = this.wr.mat.clone(); this.leafMat.name = 'ForestLeafMat'; this.leafMat.side = THREE.DoubleSide;
    this.leafMat.defines = { ...this.wr.mat.defines, FOREST_LEAF: 1 }; this.leafMat.uniforms = { ...this.wr.mat.uniforms, uLeafMap: { value: a.tex.get('leaf') ?? null } };
    for (const h of FOREST_ART.heroes) {
      this.cls.set(h, CLASS_OF_HERO);
      const m = this.wr.mat.clone(); m.name = `ForestHero:${h}`; m.uniforms = { ...this.wr.mat.uniforms, uHeroMap: { value: a.tex.get(h) } }; // (shared entries, own texture)
      this.heroMats.set(h, m);
    }
    for (const [name, cls] of this.cls) { // one box enclosing both LODs (piece frame) for the view test
      const lods = a.geo.get(name); if (!lods?.[0]) continue;
      const box = new THREE.Box3(); for (const g of lods) if (g) { if (!g.boundingBox) g.computeBoundingBox(); box.union(g.boundingBox); }
      const c = box.getCenter(new THREE.Vector3()), h = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      this.kinds.set(name, { name, cls, key0: `${name}:0`, key1: `${name}:1`, l0: [], l1: [], cx: c.x, cy: c.y, cz: c.z, hx: h.x, hy: h.y, hz: h.z });
    }
    return a;
  }
  /** Ranges / view options / thinning of quality q (this renderer only). */
  _profile(q) {
    const P = FOREST_ART.profile[q] || null;
    this.ranges = FOREST_ART.lod[q] || FOREST_ART.lod.high;
    this.viewOpt = P?.view || null; this.thin = P?.thin || null; this.pieceRanges = P?.piece || null;
    if (this.viewOpt) {
      const v = this.viewOpt;
      this._cosTurn = Math.cos(v.turn * DEG); this._move2 = v.move * v.move; this._margin = v.margin * DEG; this._pad = v.move + v.pad;
    }
    this.stats.cull = this.viewOpt ? 'fallback' : 'off';
  }
  /** Immersive session started / ended under this renderer (no override): switch the selection profile only — the
   * placements are profile-independent, so nothing is rebuilt but the pools' selection. */
  _syncXR() {
    const xr = xrActiveOf(this.wr.app); if (xr === this._xr) return;
    this._xr = xr; this.stats.xr = xr;
    const q = resolveForestQuality({ xr, override: this._override });
    this.stats.requested = q.requested; this.stats.reason = q.reason;
    if (!this.on || q.resolved === 'off' || q.resolved === this.stats.quality) return;
    this.stats.quality = q.resolved; this.stats.profileSwitches++; this._profile(q.resolved); this._selView = false; this.dirty = true;
  }
  /** Crown limb tips (normalised piece frame) — canopy attachment points. Static fallback before the manifest arrives. */
  tipsOf(name) { return this.tips.get(name) || null; }
  // ---------------------------------------------------------------- placements (called from the kit while a module builds)
  beginCell(cell, b, gx, gz) {
    const sink = { cell, b, gx, gz, list: new Map(), on: this.usable, quality: this.stats.quality, add: (name, M, tint) => this._add(sink, name, M, tint), tips: (n) => this.tipsOf(n) };
    return sink;
  }
  /** Place piece `name` with matrix `M` (in the frame of the builder's current transform), tint (hex). */
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
    for (const [name, L] of sink.list) {
      const m = new Float32Array(L.m), n = L.m.length / 16, k = new Float32Array(n);
      for (let i = 0; i < n; i++) k[i] = rankOf(m[i * 16 + 12], m[i * 16 + 14], i);
      pieces.set(name, { m, c: new Float32Array(L.c), n, k, b: null }); // (k: thinning rank; b: route-space box centres, made on the first view test)
    }
    this.cells.set(cell, { pieces });
    this.dirty = true;
  }
  rebased() { this.group.position.set(this.world.off[0], 0, this.world.off[1]); }
  releaseCell(cell) { if (this.cells.delete(cell)) this.dirty = true; }
  // ---------------------------------------------------------------- per frame
  /** cam: camera world position; view (optional): the rendering camera (game: app.camera — in XR three keeps the
   * both-eye union frustum + head pose on it). Without a usable view the selection is distance-only. */
  update(cam, view = null) {
    if (this.disposed) return;
    this.group.position.set(this.world.off[0], 0, this.world.off[1]);
    for (const m of [this.wr.mat, this.wr.floorMat]) m?.uniforms.uOff?.value.set(this.world.off[0], this.world.off[1]); // route-space noise (rebase-stable dapples)
    if (this.wr.app) this._syncXR();
    if (!this.assets) return;
    // eye: the rendering camera's fresh world position when there is one. (WorldChase captures `cam` BEFORE the route
    // update, which may rebase the origin and shift the rig: the stale vector against the new world.off would select
    // the forest around a point a whole rebase away for one frame.)
    let ex = cam.x, ey = cam.y, ez = cam.z;
    if (view?.matrixWorld) {
      view.updateWorldMatrix?.(true, false);
      const e = view.matrixWorld.elements;
      if (Number.isFinite(e[12]) && Number.isFinite(e[13]) && Number.isFinite(e[14])) { ex = e[12]; ey = e[13]; ez = e[14]; }
    }
    const st = FOREST_ART.step, qx = Math.round((ex - this.world.off[0]) / st), qy = Math.round(ey / st), qz = Math.round((ez - this.world.off[1]) / st);
    const q = this.camQ; if (!q || q[0] !== qx || q[1] !== qy || q[2] !== qz) { this.camQ = [qx, qy, qz]; this.dirty = true; }
    if (this.viewOpt) { // re-select when the view left the margins of the last selection (or became (un)usable)
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
    v.tl = (1 - p[8]) / p[0]; v.tr = (1 + p[8]) / p[0]; v.tt = (1 + p[9]) / p[5]; v.tb = (1 - p[9]) / p[5]; // (tangents of the 4 side planes)
    return true;
  }
  /** Copy the snapshot used for a selection and derive its widened side planes (≥ 90° → that side is not tested). */
  _freeze(a, v) {
    const n = v.n; Object.assign(v, a); v.n = n; v.np = 0; v.pad = this._pad;
    const M = this._margin, lim = Math.PI / 2 - 1e-3, fx = -v.zx, fy = -v.zy, fz = -v.zz; // (forward)
    // inward normal of a side plane widened to angle g from forward, toward axis (ax, ay, az) = the opposite side
    const add = (t, ax, ay, az) => { const g = Math.atan(t) + M; if (g >= lim) return; const c = Math.cos(g), s = Math.sin(g), k = v.np++ * 3; n[k] = ax * c + fx * s; n[k + 1] = ay * c + fy * s; n[k + 2] = az * c + fz * s; };
    add(v.tl, v.xx, v.xy, v.xz); add(v.tr, -v.xx, -v.xy, -v.xz); add(v.tt, -v.yx, -v.yy, -v.yz); add(v.tb, v.yx, v.yy, v.yz);
  }
  /** Route-space centres of a piece's placement boxes (piece box centre × the placement matrix). */
  _bounds(P, k) {
    const b = P.b = new Float32Array(P.n * 3), m = P.m;
    for (let i = 0; i < P.n; i++) {
      const o = i * 16;
      b[i * 3] = m[o] * k.cx + m[o + 4] * k.cy + m[o + 8] * k.cz + m[o + 12];
      b[i * 3 + 1] = m[o + 1] * k.cx + m[o + 5] * k.cy + m[o + 9] * k.cz + m[o + 13];
      b[i * 3 + 2] = m[o + 2] * k.cx + m[o + 6] * k.cy + m[o + 10] * k.cz + m[o + 14];
    }
  }
  /** Conservative oriented-box test (exact for the transformed piece box, any rotation / nonuniform scale): false only
   * when the box, padded, lies wholly outside a widened side plane. The planes pass through the eye, so a box that
   * contains the eye (camera inside a crown / trunk) always passes. m/o: placement matrix, b/j: its box centre. */
  static sees(v, k, m, o, b, j) {
    const dx = b[j] - v.ex, dy = b[j + 1] - v.ey, dz = b[j + 2] - v.ez, n = v.n;
    for (let p = 0; p < v.np * 3; p += 3) {
      const nx = n[p], ny = n[p + 1], nz = n[p + 2];
      const e = k.hx * Math.abs(nx * m[o] + ny * m[o + 1] + nz * m[o + 2]) + k.hy * Math.abs(nx * m[o + 4] + ny * m[o + 5] + nz * m[o + 6]) + k.hz * Math.abs(nx * m[o + 8] + ny * m[o + 9] + nz * m[o + 10]);
      if (nx * dx + ny * dy + nz * dz < -(e + v.pad)) return false;
    }
    return true;
  }
  _pool(name, lod, need) {
    const key = `${name}:${lod}`; let p = this.pools.get(key);
    if (p && p.cap >= need) return p;
    let cap = p ? p.cap : 16; while (cap < need) cap *= 2;
    if (p) { this.group.remove(p.mesh); p.mesh.dispose(); }
    const geo = this.assets.geo.get(name)[lod];
    const mesh = new THREE.InstancedMesh(geo, this.heroMats.get(name) || (this.alpha.has(name) ? this.leafMat : this.mat), cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.count = 0; mesh.visible = false; mesh.name = `fr:${key}`;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    p = { mesh, cap, tris: (geo.index?.count ?? 0) / 3 };
    this.pools.set(key, p); this.group.add(mesh);
    return p;
  }
  _rebuild() {
    const t0 = performance.now(), Q = this.ranges, TH = this.thin, st = FOREST_ART.step, q = this.camQ;
    const cx = q ? q[0] * st : 0, cy = q ? q[1] * st : 0, cz = q ? q[2] * st : 0;
    const V = this.viewOpt && this._selView ? this._sel : null, sees = ForestDetail.sees;
    for (const k of this.kinds.values()) { k.l0.length = 0; k.l1.length = 0; }
    let inst = 0, culled = 0, thinned = 0;
    for (const e of this.cells.values()) for (const [name, P] of e.pieces) {
      const k = this.kinds.get(name), R = k && ((this.pieceRanges && this.pieceRanges[name]) || Q[k.cls]); if (!R) continue;
      const r0 = R[0] ** 2, r1 = R[1] ** 2, T = TH && TH[name], t2 = T ? T[0] ** 2 : Infinity, keep = T ? T[1] : 1;
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
    let drawn = 0, tris = 0; const S = this.stats, by = S.byPool || (S.byPool = {}), H = S.heroes || (S.heroes = {});
    for (const k of this.kinds.values()) for (let lod = 0; lod < 2; lod++) {
      const s = lod ? k.l1 : k.l0, key = lod ? k.key1 : k.key0, n = s.length / 2;
      if (!n) { const p = this.pools.get(key); if (p && p.mesh.visible) { p.mesh.count = 0; p.mesh.visible = false; } if (key in by) delete by[key]; continue; }
      const p = this._pool(k.name, lod, n), M = p.mesh.instanceMatrix.array, C = p.mesh.instanceColor.array;
      for (let j = 0; j < n; j++) { const P = s[j * 2], i = s[j * 2 + 1]; M.set(P.m.subarray(i * 16, i * 16 + 16), j * 16); C.set(P.c.subarray(i * 3, i * 3 + 3), j * 3); }
      p.mesh.count = n; p.mesh.visible = true;
      p.mesh.instanceMatrix.needsUpdate = true; p.mesh.instanceColor.needsUpdate = true;
      p.mesh.instanceMatrix.clearUpdateRanges?.(); p.mesh.instanceMatrix.addUpdateRange?.(0, n * 16); // (upload only the selected prefix)
      p.mesh.instanceColor.clearUpdateRanges?.(); p.mesh.instanceColor.addUpdateRange?.(0, n * 3);
      drawn++; tris += n * p.tris; by[key] = Math.round(n * p.tris);
    }
    this.dirty = false;
    const ms = performance.now() - t0;
    S.instances = inst; S.culled = culled; S.thinned = thinned; S.drawn = drawn; S.tris = Math.round(tris); S.pools = this.pools.size; S.rebuilds++;
    S.rebuildMs = +ms.toFixed(2); S.maxRebuildMs = Math.max(S.maxRebuildMs, S.rebuildMs);
    if (this.viewOpt) S.cull = V ? 'view' : 'fallback';
    for (const h of FOREST_ART.heroes) { const k = this.kinds.get(h); H[h] = k ? (k.l0.length + k.l1.length) / 2 : 0; }
  }
  /** Visit the current selection: fn(name, lod, piece, index) (tests / diagnostics). */
  forEachSelected(fn) {
    for (const k of this.kinds.values()) for (let lod = 0; lod < 2; lod++) { const s = lod ? k.l1 : k.l0; for (let j = 0; j < s.length; j += 2) fn(k.name, lod, s[j], s[j + 1]); }
  }
  get placements() { let n = 0; for (const e of this.cells.values()) for (const P of e.pieces.values()) n += P.n; return n; }
  /** Placements of one piece in all live cells (tests / preview). */
  count(name) { let n = 0; for (const e of this.cells.values()) n += e.pieces.get(name)?.n ?? 0; return n; }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    clearTimeout(this._loadTimer);
    for (const p of this.pools.values()) { this.group.remove(p.mesh); p.mesh.dispose(); }
    this.pools.clear(); this.cells.clear(); this.kinds.clear();
    this.group.parent?.remove(this.group);
    this.mat.dispose(); for (const m of this.heroMats.values()) m.dispose(); this.heroMats.clear(); this.leafMat?.dispose(); this.leafMat = null;
    if (this._held) { this._held = false; releaseForest(); }
    this.assets = null;
  }
}

// =============================================================================================== placement helpers (kit side)
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
/** Matrix: translate (x, y, z), yaw about +y, optional pitch/roll, scale (sx, sy, sz). */
export function trs(x, y, z, yaw = 0, sx = 1, sy = sx, sz = sx, pitch = 0, roll = 0, out = new THREE.Matrix4()) {
  _e.set(pitch, yaw, roll, 'YXZ'); _q.setFromEuler(_e);
  return out.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}
/** Yaw (about +y) that turns local +Z toward direction (dx, dz). */
export const yawTo = (dx, dz) => Math.atan2(dx, dz);
