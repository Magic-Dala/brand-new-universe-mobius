// Foldscape art upgrade (v0.41): kit lifecycle, rebase alignment, missing-kit fallback, anchor clearance and the
// foldscape-only gating of the shared renderer / shader hooks. Runs the real WorldRenderer + ChaseWorld in Node
// (no GPU: geometry / instance data only); the Blender kit is replaced by an injected loader.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const THREE = await import('three');
const { MAPS, mapById } = await import('../src/worlds/maps.js');
const { ChaseWorld } = await import('../src/worlds/chaseWorld.js');
const { WorldRenderer } = await import('../src/worlds/worldRenderer.js');
const { KITS } = await import('../src/worlds/kits/index.js');
const { createWorldMaterial } = await import('../src/worlds/art/shaders.js');
const { insideBox } = await import('../src/data/box.js');
const art = await import('../src/worlds/art/foldscapeArt.js');
const fs = await import('node:fs');

const FOLD = mapById('foldscape'), SEED = 20261103 + 7919;
const disposed = new Set();
function fakeKit({ delay = 0, fail = false } = {}) {
  let resolve; const gate = new Promise((r) => { resolve = r; });
  const loader = async () => {
    if (delay) await gate;
    if (fail) throw new Error('kit missing (test)');
    return new Map(art.PIECES.map((n) => [n, [0, 1].map(() => { const g = new THREE.BoxGeometry(); g.addEventListener('dispose', () => disposed.add(g)); return g; })]));
  };
  art.setKitLoader(loader);
  return { open: () => resolve() };
}
function make(seed = SEED) { const w = new ChaseWorld(FOLD, { seed }); const r = new WorldRenderer(null, FOLD, w); return { w, r }; }
const streamAll = (w, r, s = 10) => { w.update(w.pointAt(s), { x: 0, y: 0, z: 0 }, 1 / 60, { force: true }); r.pump(1e9); r.update(0, w.pointAt(s)); };
/** World positions of every placement (pool group offset + route-space instance translation), by piece. */
function placements(r) {
  const out = []; const o = r.extras.group.position;
  for (const e of r.extras.cells.values()) for (const [name, P] of e.pieces) for (let i = 0; i < P.n; i++) {
    const m = P.m.subarray(i * 16, i * 16 + 16);
    out.push({ name, x: m[12] + o.x, y: m[13], z: m[14] + o.z, ax: [m[0], m[1], m[2]], az: [m[8], m[9], m[10]] });
  }
  return out;
}

test('foldscape only: other maps keep the legacy material / no extras; foldscape gets the FOLDSCAPE branch', async () => {
  fakeKit();
  for (const map of MAPS) {
    const mat = createWorldMaterial(map.look);
    if (map.id === 'foldscape') { assert.equal(mat.defines.FOLDSCAPE, 1); assert.ok('uShade' in mat.uniforms); }
    else if (map.id === 'forest') { assert.deepEqual(mat.defines, { FOREST: 1 }); for (const k of ['uAlb', 'uNrm', 'uOrm', 'uShade', 'uPbrOn']) assert.ok(!(k in mat.uniforms), `${map.id} ${k}`); } // v0.43: its own branch (tests/forest-art.test.mjs)
    else if (map.id === 'redrock') { assert.deepEqual(mat.defines, { REDROCK: 1 }); for (const k of ['uAlb', 'uNrm', 'uOrm', 'uShade', 'uPbrOn']) assert.ok(!(k in mat.uniforms), `${map.id} ${k}`); } // v0.46: its own branch (tests/redrock-art.test.mjs)
    else {
      assert.deepEqual(mat.defines, map.id === 'neon' ? { NEON: 1 } : map.id === 'moonlit' ? { MOONLIT: 1 } : {}, map.id);
      for (const k of ['uAlb', 'uNrm', 'uOrm', 'uShade', 'uPbrOn']) assert.ok(!(k in mat.uniforms), `${map.id} ${k}`);
    }
    mat.dispose();
    if (map.id !== 'foldscape' && map.id !== 'forest' && map.id !== 'redrock') {
      assert.equal(KITS[map.id].createExtras, undefined, map.id);
      const w = new ChaseWorld(map, { seed: 7 }), r = new WorldRenderer(null, map, w);
      assert.equal(r.extras, null); streamAll(w, r); assert.ok(r.visuals.size > 0); r.dispose();
    }
  }
  assert.equal(art.kitCacheState().refs, 0);
});

test('lifecycle: switching away while the kit loads attaches nothing and releases the cache', async () => {
  const k = fakeKit({ delay: 1 });
  const { w, r } = make();
  streamAll(w, r);
  const group = r.extras.group, ex = r.extras;
  assert.equal(art.kitCacheState().refs, 1);
  r.dispose(); // the player switched maps before the kit arrived
  assert.equal(art.kitCacheState().refs, 0);
  k.open(); await ex.whenReady();
  ex.update(new THREE.Vector3());
  assert.equal(group.children.length, 0, 'no pools attached after dispose');
  assert.equal(group.parent, null);
  assert.equal(art.kitCacheState().loaded, false, 'the late kit is not kept by the cache');
});

test('repeated load / release: shared kit survives while any renderer holds it, freed with the last one', async () => {
  fakeKit();
  const a = make(), b = make(SEED + 1);
  await a.r.extras.whenReady(); await b.r.extras.whenReady();
  streamAll(a.w, a.r); streamAll(b.w, b.r);
  assert.equal(art.kitCacheState().refs, 2);
  const before = disposed.size;
  a.r.dispose();
  assert.equal(disposed.size, before, 'disposing one renderer must not dispose the shared kit geometries');
  assert.ok(b.r.extras.stats.drawn > 0);
  b.r.update(0, b.w.pointAt(40)); // still renders with the kit
  b.r.dispose();
  assert.equal(art.kitCacheState().refs, 0);
  assert.equal(disposed.size - before, art.PIECES.length * 2, 'all kit geometries disposed with the last holder');
  // load / release cycles do not leak references or loads
  const loads0 = art.kitCacheState().loads;
  for (let i = 0; i < 4; i++) { const x = make(SEED + i); await x.r.extras.whenReady(); streamAll(x.w, x.r); x.r.dispose(); }
  assert.equal(art.kitCacheState().refs, 0); assert.equal(art.kitCacheState().loads - loads0, 4);
});

test('rebase during queued creation keeps ornaments on their buildings', async () => {
  fakeKit();
  const A = make(), B = make();
  await A.r.extras.whenReady(); await B.r.extras.whenReady();
  // A: modules queued, a few build steps, then a floating-origin rebase in the middle of the builds, then finish
  A.w.update(A.w.pointAt(10), { x: 0, y: 0, z: 0 }, 1 / 60, { force: true });
  for (let i = 0; i < 25; i++) A.r.jobs[0]?.gen.next();
  const dx = -1234, dz = 777; A.w.rebase(dx, dz);
  A.r.pump(1e9); A.r.update(0, A.w.pointAt(10));
  streamAll(B.w, B.r);
  const pa = placements(A.r), pb = placements(B.r);
  assert.ok(pa.length > 500 && pa.length === pb.length, `${pa.length} vs ${pb.length}`);
  for (let i = 0; i < pa.length; i++) {
    assert.ok(Math.abs(pa[i].x - (pb[i].x + dx)) < 1e-3 && Math.abs(pa[i].z - (pb[i].z + dz)) < 1e-3 && Math.abs(pa[i].y - pb[i].y) < 1e-6, `placement ${i} drifted`);
  }
  // every facade piece origin lies on (or in) a collision tier of the rebased world
  const cols = []; for (const c of A.w.live.values()) cols.push(...c.colliders);
  for (const p of pa.filter((q) => /bay|quoin|store|fire_escape/.test(q.name))) {
    assert.ok(cols.some((c) => insideBox(c, p.x, Math.max(p.y, c.y0 + 0.01), p.z, 0.35)), `${p.name} at ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)} is not on a building`);
  }
  A.r.dispose(); B.r.dispose();
});

test('missing kit: graceful fallback (procedural masses, no pools), still renders and releases', async () => {
  fakeKit({ fail: true });
  const { w, r } = make();
  await r.extras.whenReady();
  streamAll(w, r);
  assert.equal(r.extras.stats.kit, 'failed');
  assert.equal(r.extras.group.children.length, 0);
  assert.ok(r.stats.tris > 1000 && r.visuals.size > 0 && [...w.live.values()].every((c) => c.ready));
  r.dispose();
  assert.equal(art.kitCacheState().refs, 0);
});

test('anchor clearance: no facade piece covers a swing anchor; fire escapes keep out of anchor columns', async () => {
  fakeKit();
  const { w, r } = make();
  await r.extras.whenReady();
  let checked = 0;
  for (let s = 10; s < 1500; s += 300) {
    streamAll(w, r, s);
    const P = placements(r), A = []; for (const c of w.live.values()) for (const a of c.anchors) if (a.valid && a.normal[1] === 0) A.push(a);
    for (const p of P) {
      const half = { fs_bay_rect: 1.5, fs_bay_arch: 1.5, fs_bay_stone: 1.5, fs_glass_bay: 1.6, fs_quoin: 0.31, fs_fire_escape: 3.0, fs_fire_escape_base: 3.0 }[p.name];
      if (!half) continue;
      const h = p.name.startsWith('fs_fire') ? [-3, 1.5] : p.name === 'fs_glass_bay' ? [0, 3.8] : [0, 3.3];
      for (const a of A) {
        const d = [a.p.x - p.x, a.p.y - p.y, a.p.z - p.z];
        const along = d[0] * p.ax[0] + d[2] * p.ax[2], off = d[0] * p.az[0] + d[2] * p.az[2];
        if (Math.abs(off) > 2) continue; // another face
        checked++;
        const inCol = Math.abs(along) < half + 0.5;
        if (p.name.startsWith('fs_fire')) assert.ok(!inCol, `fire escape in the column of anchor ${a.id}`);
        else assert.ok(!(inCol && d[1] > h[0] - 0.5 && d[1] < h[1] + 0.5), `${p.name} covers anchor ${a.id}`);
      }
    }
  }
  assert.ok(checked > 50, `checked ${checked}`);
  r.dispose();
});

test('streaming bounds: placements only for live cells, pools bounded, release drops them', async () => {
  fakeKit();
  const { w, r } = make();
  await r.extras.whenReady();
  let maxPools = 0, maxInst = 0;
  for (let s = 10; s < 4000; s += 60) {
    w.update(w.pointAt(s), { x: 0, y: 0, z: 0 }, 1 / 60, { force: true }); r.pump(1e9); r.update(1 / 60, w.pointAt(s));
    assert.equal(r.extras.cells.size, r.visuals.size);
    for (const c of r.extras.cells.keys()) assert.ok(w.live.get(c.idx) === c, 'placements of a recycled module survived');
    maxPools = Math.max(maxPools, r.extras.pools.size); maxInst = Math.max(maxInst, r.extras.stats.instances);
  }
  assert.ok(w.stats.rebases >= 1, 'the run crossed a floating-origin rebase');
  assert.ok(maxPools <= art.PIECES.length * 2, `pools ${maxPools}`);
  assert.ok(maxInst < 20000, `instances ${maxInst}`);
  r.dispose();
});

test('kit asset: manifest + glb exist, every runtime piece exported with LOD0/LOD1, legacy kit untouched', () => {
  const man = JSON.parse(fs.readFileSync(new URL('../public/models/foldscape/foldscape_kit.json', import.meta.url)));
  assert.equal(man.units, 'metres');
  const names = man.pieces.map((p) => p.name).sort();
  assert.deepEqual(names, [...art.PIECES].sort());
  for (const p of man.pieces) { assert.equal(p.tris.length, 2); assert.ok(p.tris[1] < p.tris[0], p.name); }
  assert.deepEqual(man.grid.bay, [art.FOLDSCAPE_ART.grid.bay, art.FOLDSCAPE_ART.grid.floor]);
  assert.ok(fs.statSync(new URL('../public/models/foldscape/foldscape_kit.glb', import.meta.url)).size > 10000);
  const legacy = JSON.parse(fs.readFileSync(new URL('../public/models/city_kit.json', import.meta.url)));
  assert.equal(legacy.generator, 'tools/blender/build_city_kit.py');
});

// ------------------------------------------------------------------------------------- v0.42 roof-edge anchors × trim
test('roof-edge anchors keep their cornice: trim stays above the device, never overlaps it', async () => {
  fakeKit();
  const { w, r } = make();
  await r.extras.whenReady();
  let roofA = 0, capped = 0;
  for (let s = 10; s < 1300; s += 300) {
    streamAll(w, r, s);
    const trim = placements(r).filter((p) => p.name === 'fs_cornice' || p.name === 'fs_parapet');
    const A = []; for (const c of w.live.values()) for (const a of c.anchors) if (a.valid && a.src.roof) A.push(a);
    for (const a of A) {
      // trim expected: brick cornices on every tier; limestone parapets except a crowned tower's top (glass: no kit trim)
      const st = w.route.modules[a.cell.idx].structures.find((x) => x.id === a.src.sid), top = Math.max(...st.tiers.map((t) => t.y1));
      const tierTop = st.tiers.find((t) => a.p.y >= t.y0 && a.p.y <= t.y1).y1;
      const wantTrim = st.kind === 'brick' || (st.kind === 'limestone' && !(tierTop === top && st.h > 70));
      let above = false;
      for (const p of trim) {
        const d = [a.p.x - p.x, a.p.y - p.y, a.p.z - p.z];
        const along = d[0] * p.ax[0] + d[2] * p.ax[2], off = d[0] * p.az[0] + d[2] * p.az[2];
        const half = Math.hypot(p.ax[0], p.ax[2]) * 1.5; // segment half width (scaled 3 m piece)
        if (Math.abs(off) > 2 || Math.abs(along) > half + 1.7) continue; // other face / not beside it
        const h = p.name === 'fs_cornice' ? 1.4 : 1.3;
        // device: disc / upper arms ≤ 1.0 m above the anchor point, ≤ 1.7 m to the side; trim band [p.y, p.y + h]
        assert.ok(a.p.y + 1.0 <= p.y + 1e-6 || a.p.y - 1.93 >= p.y + h, `${p.name} overlaps the device of ${a.id}`);
        if (Math.abs(along) < half && p.y > a.p.y && p.y - a.p.y < 3.2) above = true;
      }
      if (wantTrim) { roofA++; if (above) capped++; }
    }
  }
  if (process.env.WTRACE) console.log('roof anchors with trim above', capped, '/', roofA);
  assert.ok(roofA > 60, `roof anchors ${roofA}`);
  assert.ok(capped / roofA > 0.9, `only ${capped}/${roofA} roof anchors keep the cornice / parapet above them`);
  r.dispose();
});

// ------------------------------------------------------------------------------------- v0.42 remote sky districts
const sky = await import('../src/worlds/art/foldscapeSkyCards.js');
const pngSize = (url) => { const b = fs.readFileSync(new URL(`../public/${url}`, import.meta.url)); assert.equal(b.toString('ascii', 12, 16), 'IHDR'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('sky districts: three distinct transparent sources, non-overlapping crops, cards keep the source aspect', () => {
  const srcs = new Set(sky.SKY_CARDS.map((c) => c.src));
  assert.deepEqual([...srcs].sort(), ['canopy', 'district', 'skyline']);
  for (const [k, S] of Object.entries(sky.SKY_SOURCES)) assert.deepEqual(pngSize(S.url), S.px, `${k} pixel size`);
  for (const c of sky.SKY_CARDS) {
    const [u0, u1, v0, v1] = c.crop, S = sky.SKY_SOURCES[c.src];
    assert.ok(u0 >= 0 && u1 <= 1 && v0 >= 0 && v1 <= 1 && u1 > u0 && v1 > v0);
    const aspect = ((u1 - u0) * S.px[0]) / ((v1 - v0) * S.px[1]);
    assert.ok(Math.abs(c.w / sky.cardHeight(c) - aspect) < 1e-9, 'card aspect = crop pixel aspect');
  }
  // no part of a painting is shown twice (no duplicated silhouettes)
  for (let i = 0; i < sky.SKY_CARDS.length; i++) for (let j = i + 1; j < sky.SKY_CARDS.length; j++) {
    const a = sky.SKY_CARDS[i], b = sky.SKY_CARDS[j]; if (a.src !== b.src) continue;
    const ox = Math.min(a.crop[1], b.crop[1]) - Math.max(a.crop[0], b.crop[0]), oy = Math.min(a.crop[3], b.crop[3]) - Math.max(a.crop[2], b.crop[2]);
    assert.ok(ox <= 1e-9 || oy <= 1e-9, `cards ${i} and ${j} repeat part of ${a.src}`);
  }
});

test('sky districts: far-only (never in the playable corridor), inside the sky dome, every heading composed', () => {
  const L = sky.SKY_LIMITS, THREE_ = THREE;
  for (const src of Object.keys(sky.SKY_SOURCES)) {
    const g = sky.buildCardGeometry(src), P = g.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), hd = Math.hypot(x, z);
      assert.ok(hd >= L.minDist || y >= L.highY, `${src} vertex ${i} (${hd.toFixed(0)} m away, ${y.toFixed(0)} m up) could reach the play space`);
      for (let cy = L.camY[0]; cy <= L.camY[1]; cy += 20) {
        const d = Math.hypot(x, y - cy, z);
        assert.ok(d >= L.minRange && d <= L.skyRadius - 10, `${src} vertex ${i}: ${d.toFixed(0)} m from an eye at ${cy} m (sky dome ${L.skyRadius})`);
      }
    }
    g.dispose();
  }
  // heading coverage: the union of the cards' angular extents leaves no gap wider than 50° (8 headings all composed)
  const iv = sky.SKY_CARDS.map((c) => { const half = THREE_.MathUtils.radToDeg(Math.atan2(c.w / 2, Math.cos(THREE_.MathUtils.degToRad(c.e)) * c.R)); return [c.h - half, c.h + half]; });
  for (let h = -180; h < 180; h += 45) {
    const dist = Math.min(...iv.map(([a, b]) => { for (const k of [-360, 0, 360]) if (h >= a + k && h <= b + k) return 0; return Math.min(...[-360, 0, 360].flatMap((k) => [Math.abs(h - a - k), Math.abs(h - b - k)])); }));
    assert.ok(dist <= 25, `heading ${h}°: nearest sky district ${dist.toFixed(0)}° away`);
  }
  for (const want of [[0, 'district'], [180, 'canopy']]) assert.ok(sky.SKY_CARDS.some((c) => Math.abs(((c.h - want[0] + 540) % 360) - 180) < 15 && c.src === want[1]), `${want[1]} at ${want[0]}°`);
});

test('sky districts in the renderer: 3 alpha-tested depth-writing draws in the camera-following backdrop, disposed with it', async () => {
  fakeKit();
  const { w, r } = make();
  const art2 = r.backdropArt;
  assert.ok(art2 && art2.root.parent === r.backdrop, 'cards live in the far backdrop (follows the camera)');
  assert.equal(art2.meshes.length, 3); assert.equal(art2.stats.draws, 3); assert.equal(art2.stats.cards, sky.SKY_CARDS.length);
  assert.equal(new Set(art2.textures).size, 3);
  for (const m of art2.meshes) {
    const mt = m.material;
    assert.ok(mt.alphaToCoverage && mt.depthWrite && mt.depthTest && !mt.transparent, `${m.name} opaque alpha-tested`);
    assert.equal(mt.uniforms.map.value.colorSpace, THREE.SRGBColorSpace);
  }
  streamAll(w, r, 40);
  const cam = w.pointAt(40); r.update(0, cam);
  assert.ok(Math.abs(r.backdrop.position.x - cam.x) < 1e-9 && Math.abs(r.backdrop.position.z - cam.z) < 1e-9 && r.backdrop.position.y === 0);
  const gone = { geo: 0, mat: 0, tex: 0 };
  for (const m of art2.meshes) { m.geometry.addEventListener('dispose', () => gone.geo++); m.material.addEventListener('dispose', () => gone.mat++); }
  for (const t of art2.textures) t.addEventListener('dispose', () => gone.tex++);
  r.dispose();
  assert.deepEqual(gone, { geo: 3, mat: 3, tex: 3 });
  assert.equal(art2.root.parent, null);
  art2.dispose(); assert.deepEqual(gone, { geo: 3, mat: 3, tex: 3 }, 'idempotent');
  // other maps: no sky districts
  for (const map of MAPS) if (map.id !== 'foldscape') assert.equal(KITS[map.id].decorateBackdrop, undefined, map.id);
});
