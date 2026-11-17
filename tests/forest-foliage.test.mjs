// Forest foliage correction (v0.44): the canopy / shrub / vine leaves are open, branch-supported spray cards on an
// original RGBA atlas instead of closed opaque lumps. Checks the REAL exported kit (GLTFLoader.parse in Node →
// kitGeometry), the atlas pixels (PNG decoded here), the loader's ownership of the atlas, the leaf material and the
// shader gating (alpha test only in the FOREST_LEAF program).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';

globalThis.localStorage = { getItem: () => null, setItem() {} };
const THREE = await import('three');
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const art = await import('../src/worlds/art/forestArt.js');
const { createWorldMaterial } = await import('../src/worlds/art/shaders.js');
const { mapById, MAPS } = await import('../src/worlds/maps.js');
const { ChaseWorld } = await import('../src/worlds/chaseWorld.js');
const { WorldRenderer } = await import('../src/worlds/worldRenderer.js');

const DIR = new URL('../public/models/forest/', import.meta.url);
const MANIFEST = JSON.parse(fs.readFileSync(new URL('forest_kit.json', DIR)));
const FOLIAGE = ['cn_canopy_a', 'cn_canopy_b', 'cn_canopy_c', 'fx_bush', 'vn_hang'];
const LEAFCARD = 28;

async function kitMeshes() {
  const buf = fs.readFileSync(new URL('forest_kit.glb', DIR));
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const out = new Map(); gltf.scene.traverse((o) => { if (o.isMesh) out.set(o.name, o.geometry); });
  return out;
}
/** Minimal PNG decoder (8-bit RGBA, non-interlaced) → { w, h, px } (row 0 = image top). */
function readPng(file) {
  const b = fs.readFileSync(file); let o = 8, w = 0, h = 0, ct = 0, depth = 0; const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o), type = b.toString('ascii', o + 4, o + 8), d = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ct = d[9]; }
    if (type === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  assert.equal(depth, 8); assert.equal(ct, 6, 'RGBA PNG');
  const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = 4, stride = w * bpp, px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0, up = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      px[y * stride + x] = v & 255;
    }
  }
  return { w, h, px };
}

test('foliage pieces: manifest flags alpha cards, canopy LOD0 lighter than the old lumps (1120 tris), LOD1 lighter still', () => {
  const by = Object.fromEntries(MANIFEST.pieces.map((p) => [p.name, p]));
  for (const n of FOLIAGE) assert.equal(by[n].alpha, true, n);
  for (const p of MANIFEST.pieces) if (!FOLIAGE.includes(p.name)) assert.ok(!p.alpha, `${p.name} must stay opaque`);
  for (const n of ['cn_canopy_a', 'cn_canopy_b']) { assert.ok(by[n].tris[0] < 1120 && by[n].tris[1] < 140, `${n} ${by[n].tris}`); }
  assert.equal(MANIFEST.leafAtlas.materialId, 8); assert.deepEqual(MANIFEST.leafAtlas.size, [1024, 1024]);
  assert.ok(MANIFEST.files['forest_leaf.png'] > 0);
});

test('real exported kit → kitGeometry: leaf cards get kind LEAFCARD + atlas uv inside one tile; no closed leaf lumps remain', async () => {
  const meshes = await kitMeshes();
  const tiles = Object.values(MANIFEST.leafAtlas.tiles); // [u0, v0, 0.5, 0.5] Blender uv; glTF v = 1 − v
  for (const n of FOLIAGE) for (const l of [0, 1]) {
    const src = meshes.get(`${n}_LOD${l}`); assert.ok(src, n);
    const g = art.kitGeometry(src), K = g.attributes.aMat, U = g.attributes.uv, I = g.index.array;
    let leaf = 0;
    const isLeaf = (i) => Math.round(K.getX(i)) === LEAFCARD;
    for (let i = 0; i < K.count; i++) {
      const k = Math.round(K.getX(i));
      if (n !== 'vn_hang') assert.notEqual(k, art.FK.LEAF, `${n}: opaque leaf-lump vertex left`); // (vine strands are leaf-shaded tubes)
      if (k !== LEAFCARD) continue;
      leaf++;
      const u = U.getX(i), v = 1 - U.getY(i);
      assert.ok(tiles.some(([u0, v0]) => u >= u0 - 1e-4 && u <= u0 + 0.5 + 1e-4 && v >= v0 - 1e-4 && v <= v0 + 0.5 + 1e-4), `${n} uv ${u},${v} outside every tile (metre-scaled?)`);
    }
    assert.ok(leaf > 0, `${n}_LOD${l} has leaf cards`);
    // open cards, not a skin: every connected leaf patch is one card (≤ 6 vertices, ≤ 4 triangles)
    const parent = new Int32Array(K.count).map((_, i) => i), find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
    for (let t = 0; t < I.length; t += 3) if (isLeaf(I[t])) for (const j of [1, 2]) parent[find(I[t + j])] = find(I[t]);
    const size = new Map(); for (let i = 0; i < K.count; i++) if (isLeaf(i)) size.set(find(i), (size.get(find(i)) || 0) + 1);
    assert.ok(Math.max(...size.values()) <= 6, `${n}_LOD${l}: leaf patch of ${Math.max(...size.values())} vertices`);
    g.dispose();
  }
  for (const g of meshes.values()) g.dispose();
});

test('leaf atlas: RGBA 1024², real cut-outs per tile, transparent texels carry dilated leaf colour (no dark halos)', () => {
  const { w, h, px } = readPng(new URL('forest_leaf.png', DIR));
  assert.equal(w, 1024); assert.equal(h, 1024);
  for (const [name, [u0, v0]] of Object.entries(MANIFEST.leafAtlas.tiles)) {
    const x0 = u0 * w, y0 = (1 - v0 - 0.5) * h; let solid = 0, clear = 0, dark = 0, n = 0;
    for (let y = y0; y < y0 + h / 2; y += 2) for (let x = x0; x < x0 + w / 2; x += 2) {
      const i = (y * w + x) * 4, a = px[i + 3]; n++;
      if (a > 200) solid++; else if (a === 0) { clear++; if (px[i] + px[i + 1] + px[i + 2] < 60) dark++; }
    }
    assert.ok(solid / n > 0.06 && solid / n < 0.6, `${name} coverage ${(solid / n).toFixed(3)}`);
    assert.ok(clear / n > 0.3, `${name} has gaps`);
    assert.ok(dark / Math.max(1, clear) < 0.01, `${name}: ${dark} transparent texels near black (halo risk)`);
    // the card spine: the twig base sits at the bottom centre of the tile (cards are attached to branches there)
    let base = 0; for (let x = x0 + w / 4 - 12; x < x0 + w / 4 + 12; x++) base = Math.max(base, px[((y0 + h / 2 - 14) * w + x) * 4 + 3]);
    assert.ok(base > 200, `${name}: no twig at the card base`);
  }
});

test('loader: the atlas is part of the transaction (configured, owned by the cache; missing atlas → whole bundle fails, frees all)', async () => {
  const hero = () => { const s = new THREE.Group(); for (const h of art.FOREST_ART.heroes) for (const l of [0, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); m.name = `${h}_LOD${l}`; s.add(m); } return { scene: s }; };
  const tex = () => { const t = new THREE.Texture(); let d = 0; t.addEventListener('dispose', () => d++); t.count = () => d; return t; };
  const ts = [tex(), tex(), tex(), tex()], leaf = tex();
  const a = await art.loadForestAssets([Promise.resolve({ pieces: [] }), Promise.resolve({ scene: new THREE.Group() }), Promise.resolve(hero()), ...ts.map((t) => Promise.resolve(t)), Promise.resolve(leaf)]);
  const L = a.tex.get('leaf');
  assert.equal(L, leaf); assert.equal(L.flipY, false); assert.equal(L.colorSpace, THREE.SRGBColorSpace); assert.equal(L.minFilter, THREE.LinearMipmapLinearFilter); assert.ok(L.generateMipmaps);
  assert.equal(leaf.count(), 0, 'atlas transferred to the cache, not freed');
  for (const lods of a.geo.values()) for (const g of lods) g.dispose(); for (const t of a.tex.values()) t.dispose();
  assert.equal(leaf.count(), 1);
  const ts2 = [tex(), tex(), tex(), tex()];
  await assert.rejects(art.loadForestAssets([Promise.resolve({ pieces: [] }), Promise.resolve({ scene: new THREE.Group() }), Promise.resolve(hero()), ...ts2.map((t) => Promise.resolve(t))]), /leaf atlas/);
  assert.deepEqual(ts2.map((t) => t.count()), [1, 1, 1, 1], 'hero maps freed when the atlas is missing');
  const late = tex(), gate = Promise.reject(new Error('atlas 404'));
  await assert.rejects(art.loadForestAssets([Promise.resolve({ pieces: [] }), Promise.resolve({ scene: new THREE.Group() }), Promise.resolve(hero()), ...[late, tex(), tex(), tex()].map((t) => Promise.resolve(t)), gate]), /atlas 404/);
  assert.equal(late.count(), 1);
});

test('renderer: foliage pools share ONE double-sided FOREST_LEAF material with the atlas; opaque pieces keep the kit material; disposed with the renderer', async () => {
  const names = [...MANIFEST.pieces.map((p) => p.name), ...art.FOREST_ART.heroes];
  const atlas = new THREE.Texture();
  art.setForestLoader(async () => ({ geo: new Map(names.map((n) => [n, [new THREE.BoxGeometry(), new THREE.BoxGeometry()]])), tex: new Map([...art.FOREST_ART.heroes.map((h) => [h, new THREE.Texture()]), ['leaf', atlas]]), manifest: MANIFEST }));
  try {
    const F = mapById('forest'), w = new ChaseWorld(F, { seed: 20261103 + 7919 }), r = new WorldRenderer(null, F, w);
    await r.extras.whenReady();
    w.update(w.pointAt(60), { x: 0, y: 0, z: 0 }, 1 / 60, { force: true }); r.pump(1e9); r.update(0, w.pointAt(60));
    const D = r.extras, lm = D.leafMat; let leafPools = 0, opaque = 0;
    assert.equal(lm.side, THREE.DoubleSide); assert.equal(lm.defines.FOREST_LEAF, 1); assert.equal(lm.defines.FOREST, 1); assert.equal(lm.uniforms.uLeafMap.value, atlas);
    assert.equal(lm.transparent, false, 'cut-out, never alpha blended'); assert.equal(lm.depthWrite, true);
    assert.equal(lm.uniforms.uSunDir, r.mat.uniforms.uSunDir, 'shared light / fog uniforms');
    for (const [key, p] of D.pools) {
      const n = key.split(':')[0];
      if (FOLIAGE.includes(n)) { assert.equal(p.mesh.material, lm, key); leafPools++; } else if (!art.FOREST_ART.heroes.includes(n)) { assert.equal(p.mesh.material, D.mat, key); opaque++; }
    }
    assert.ok(leafPools > 0 && opaque > 0);
    let freed = 0; lm.addEventListener('dispose', () => freed++);
    r.dispose(); assert.equal(freed, 1); assert.equal(art.forestCacheState().refs, 0);
  } finally { art.setForestLoader(null); }
});

test('shader: alpha test stays in dedicated leaf programs; forest atlas UVs retain their scale', () => {
  const m = createWorldMaterial(mapById('forest').look), fs_ = m.fragmentShader, vs = m.vertexShader;
  const outside = fs_.replace(/#ifdef (?:FOREST_LEAF|TREE_LEAVES)[\s\S]*?#endif/g, '');
  assert.ok(fs_.includes('discard') && !outside.includes('discard'), 'opaque programs skip alpha testing');
  assert.match(vs, /abs\(aMat\.x - 28\.0\) > 0\.5\) vUv = uv \* sqrt/);
  for (const map of MAPS) { const w = createWorldMaterial(map.look); assert.ok(!w.defines.FOREST_LEAF && !w.defines.TREE_LEAVES, map.id); w.dispose(); }
  m.dispose();
});
