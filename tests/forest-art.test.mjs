// Forest of Shadow Ruins art upgrade (v0.43): route preservation + decor safety, Tripo hero placement, asset-cache
// lifecycle (switch-away while loading, shared ownership, failure fallback, quality off), rebase alignment, anchor
// clearance, streaming bounds over kilometres, forest-only gating and the exported asset files. Runs the real
// WorldRenderer + ChaseWorld in Node (no GPU); the GLBs / textures are replaced by an injected loader.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const THREE = await import('three');
const { MAPS, mapById } = await import('../src/worlds/maps.js');
const { ChaseWorld } = await import('../src/worlds/chaseWorld.js');
const { WorldRenderer } = await import('../src/worlds/worldRenderer.js');
const { KITS } = await import('../src/worlds/kits/index.js');
const { RouteGen, pathY, validateModule } = await import('../src/worlds/route.js');
const { createWorldMaterial, createFloorMaterial } = await import('../src/worlds/art/shaders.js');
const art = await import('../src/worlds/art/forestArt.js');
const fs = await import('node:fs');
const crypto = await import('node:crypto');

const FOREST = mapById('forest'), SEED = 20261103 + 7919;
const MANIFEST = JSON.parse(fs.readFileSync(new URL('../public/models/forest/forest_kit.json', import.meta.url)));
const NAMES = [...MANIFEST.pieces.map((p) => p.name), ...art.FOREST_ART.heroes];
const disposed = new Set();
function fakeAssets({ delay = false, fail = false } = {}) {
  let open; const gate = new Promise((r) => { open = r; });
  art.setForestLoader(async () => {
    if (delay) await gate;
    if (fail) throw new Error('forest assets missing (test)');
    const geo = new Map(NAMES.map((n) => [n, [0, 1].map(() => { const g = new THREE.BoxGeometry(); g.addEventListener('dispose', () => disposed.add(g)); return g; })]));
    const tex = new Map([...art.FOREST_ART.heroes, 'leaf'].map((h) => { const t = new THREE.Texture(); t.addEventListener('dispose', () => disposed.add(t)); return [h, t]; })); // 4 hero maps + the leaf atlas
    return { geo, tex, manifest: MANIFEST };
  });
  return { open: () => open() };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
function make(seed = SEED) { const w = new ChaseWorld(FOREST, { seed }); const r = new WorldRenderer(null, FOREST, w); return { w, r }; }
const streamTo = (w, r, s) => { w.update(w.pointAt(s), { x: 0, y: 0, z: 0 }, 1 / 60, { force: true }); r.pump(1e9); r.update(0, w.pointAt(s)); };
function placements(r) {
  const out = []; const o = r.extras.group.position;
  for (const e of r.extras.cells.values()) for (const [name, P] of e.pieces) for (let i = 0; i < P.n; i++) {
    const m = P.m.subarray(i * 16, i * 16 + 16);
    out.push({ name, x: m[12] + o.x, y: m[13], z: m[14] + o.z, sy: Math.hypot(m[4], m[5], m[6]) });
  }
  return out;
}
const noDecorMap = () => ({ ...FOREST, gen: { ...FOREST.gen, forestDecor: undefined } });

test('forest only: FOREST shader branch + extras for the forest; the six other non-foldscape maps compile exactly as before', () => {
  for (const map of MAPS) {
    const mat = createWorldMaterial(map.look), floor = createFloorMaterial(map);
    if (map.id === 'redrock') { assert.ok(!mat.defines.FOREST && !floor.defines?.FOREST && !('uCanopy' in mat.uniforms) && !map.gen.forestDecor); assert.deepEqual(mat.defines, { REDROCK: 1 }); } // v0.46: its own branch (tests/redrock-art.test.mjs)
    else if (map.id === 'forest') { assert.deepEqual(mat.defines, { FOREST: 1 }); assert.deepEqual(floor.defines, { FOREST: 1 }); for (const k of ['uHeroMap', 'uCanopy', 'uOff']) assert.ok(k in mat.uniforms, k); assert.equal(typeof KITS.forest.createExtras, 'function'); }
    else {
      assert.ok(!mat.defines.FOREST && !floor.defines?.FOREST, map.id);
      for (const k of ['uHeroMap', 'uCanopy', 'uOff']) assert.ok(!(k in mat.uniforms) && !(k in floor.uniforms), `${map.id} ${k}`);
      assert.ok(!map.gen.forestDecor, map.id);
    }
    mat.dispose(); floor.dispose();
  }
});

test('route preserved: forest decor changes no corridor, anchor or structure of the pre-upgrade route (own RNG stream)', () => {
  for (const seed of [SEED, SEED + 7919, 99]) {
    const A = new RouteGen(FOREST, seed), B = new RouteGen(noDecorMap(), seed); A.ensure(60); B.ensure(60);
    for (let i = 0; i <= 60; i++) {
      const a = A.modules[i], b = B.modules[i];
      assert.equal(a.type, b.type); assert.equal(a.L, b.L); assert.equal(a.yIn, b.yIn); assert.equal(a.seed, b.seed);
      assert.deepEqual(a.anchors, b.anchors, `anchors of module ${i}`);
      const base = a.structures.filter((s) => s.role !== 'decor');
      assert.equal(base.length, b.structures.length);
      base.forEach((s, k) => { const o = b.structures[k]; assert.equal(s.id, o.id); assert.deepEqual(s.tiers.filter((t) => !t.roots), o.tiers); });
      const ids = new Set(b.coins.map((c) => c.id)); assert.ok(a.coins.every((c) => ids.has(c.id)), 'decor adds no coin');
      assert.ok(b.coins.length - a.coins.length <= 1, `module ${i}: decor removed ${b.coins.length - a.coins.length} coins`);
    }
  }
});

test('decor safety: heroes + plinths + root tiers stay below the swing space and inside the corridor edge; modules still validate', () => {
  const F = FOREST.gen.forestDecor, g = new RouteGen(FOREST, SEED); g.ensure(80);
  let decor = 0, roots = 0;
  for (const m of g.modules) {
    for (const s of m.structures) {
      if (s.role === 'decor') {
        decor++;
        const half = s.w / 2, top = Math.max(...s.tiers.map((t) => t.y1));
        for (const du of [-half, 0, half]) assert.ok(top <= pathY(m, Math.max(0, Math.min(m.L, s.u + du))) - F.clear + 1e-6, `${s.id} ${s.kind} top ${top.toFixed(1)}`);
        assert.ok(Math.abs(s.v) + s.d / 2 <= m.halfW + 1e-6, `${s.id} outside the corridor edge`);
        assert.ok(s.heroY <= F.maxPlinth + 1e-6 && s.heroY >= 0);
        for (const o of m.structures) if ((o.role === 'bridge' || o.role === 'platform' || o.role === 'obstacle') && Math.abs(o.u - s.u) < o.w / 2 + s.w / 2) assert.fail(`${s.id} under ${o.id}`);
      }
      for (const t of s.tiers) if (t.roots) { roots++; assert.ok(t.y1 <= pathY(m, s.u) - 20, `root tier ${s.id} at ${t.y1}`); }
    }
  }
  assert.ok(decor > 30 && roots > 300, `${decor} decor, ${roots} root tiers`);
  // the real validator with the decor's colliders live (neighbours instantiated: anchors at seams count), vs the same
  // route without decor: identical problem lists (none expected)
  const check = (map) => { const w = new ChaseWorld(map, { seed: SEED, autoReady: true }); w.route.ensure(42); for (let i = 0; i <= 41; i++) w._create(i); return w.route.modules.slice(0, 40).map((m) => validateModule(m, w).problems); };
  // decor / root colliders bury no anchor (street-recovery ones included), 60 modules × 3 seeds. (Seed 4242 has one
  // pre-existing seam overlap in the original route — module 13's anchor inside module 14's tower — identical without decor.)
  const buried = (map, seed) => { const w = new ChaseWorld(map, { seed, autoReady: true }); w.route.ensure(62); for (let i = 0; i <= 60; i++) w._create(i); const out = []; for (const c of w.live.values()) for (const a of c.anchors) if (w.pointBlocked(a.p.x, a.p.y, a.p.z, 0.2)) out.push(a.id); return out.sort(); };
  for (const seed of [SEED, SEED + 7919, 4242]) assert.deepEqual(buried(FOREST, seed), buried(noDecorMap(), seed), `seed ${seed}`);
  assert.deepEqual(buried(FOREST, SEED), []);
  const withDecor = check(FOREST), without = check(noDecorMap());
  assert.deepEqual(withDecor, without);
  assert.equal(withDecor.flat().length, 0, withDecor.flat().slice(0, 3).join('; '));
});

test('Tripo heroes: guardian + altar at the start, wrapped ruin right after it, all four recur along the route', () => {
  const g = new RouteGen(FOREST, SEED); g.ensure(60);
  const kinds = (i) => g.modules[i].structures.map((s) => s.kind);
  assert.ok(kinds(0).includes('heroStatue') && kinds(0).includes('heroAltar'), 'start showcase');
  assert.ok(kinds(1).includes('heroRuin'), 'wrapped ruin in module 1');
  const all = g.modules.flatMap((m) => m.structures);
  for (const k of ['heroStatue', 'heroAltar', 'heroRuin']) assert.ok(all.filter((s) => s.kind === k).length >= 4, k);
  assert.ok(g.modules.slice(0, 3).flatMap((m) => m.structures).some((s) => s.kind === 'tree' && s.roots === 'hero'), 'Tripo roots under the first trees');
});

test('placement: every hero and kit class is placed in the playable start; burls back every tree anchor', async () => {
  fakeAssets();
  const { w, r } = make(); await r.extras.whenReady(); streamTo(w, r, 60);
  const P = placements(r), n = (k) => P.filter((p) => p.name === k).length;
  for (const h of art.FOREST_ART.heroes) assert.ok(n(h) > 0, h);
  for (const k of ['tr_trunk_a', 'tr_crown_a', 'cn_canopy_a', 'rn_niche', 'rn_walltop', 'rt_wrap', 'rk_boulder', 'rn_arch']) assert.ok(n(k) > 0, k);
  let treeAnchors = 0;
  for (const c of w.live.values()) for (const a of c.anchors) { const s = c.structures.get(a.building)?.s; if (s?.kind === 'tree' && a.p.y < s.tiers[0].y1 - 0.5) treeAnchors++; }
  assert.equal(n('tr_mount'), treeAnchors);
  r.extras.update(w.pointAt(60)); assert.ok(r.extras.stats.heroes.hero_statue > 0 && r.extras.stats.heroes.hero_altar > 0 && r.extras.stats.heroes.hero_ruin > 0 && r.extras.stats.heroes.hero_roots > 0);
  r.dispose(); assert.equal(art.forestCacheState().refs, 0);
});

test('anchor clearance: no niche / wall root / vine / wall crown on a device, no anchor inside any collider', async () => {
  fakeAssets();
  const { w, r } = make(); await r.extras.whenReady();
  let checked = 0;
  for (let s = 10; s <= 2400; s += 50) { streamTo(w, r, s); if (s % 400 !== 210 && s !== 10) continue; // (stream continuously; check at 7 positions)
  const P = placements(r).filter((p) => ['rn_niche', 'rt_wrap', 'vn_hang'].includes(p.name));
  for (const c of w.live.values()) for (const a of c.anchors) {
    checked++;
    if (!a.valid) continue;
    assert.ok(!w.pointBlocked(a.p.x, a.p.y, a.p.z, 0.2), `anchor ${a.id} buried`);
    for (const p of P) {
      const dxz = Math.hypot(p.x - a.p.x, p.z - a.p.z);
      if (p.name === 'rn_niche') assert.ok(!(dxz < 2.2 && a.p.y > p.y - 1 && a.p.y < p.y + 3.7 * p.sy + 1), `niche on ${a.id}`);
      else if (p.name === 'vn_hang') assert.ok(!(dxz < 1.6 && a.p.y < p.y && a.p.y > p.y - 10 * p.sy), `vine over ${a.id}`);
      else if (p.name === 'rt_wrap' && a.side !== 0) assert.ok(!(dxz < 2.5 && a.p.y > p.y && a.p.y < p.y + 18.6 * p.sy), `wall root on ${a.id}`);
    }
  }
  }
  assert.ok(checked > 400, `${checked} anchors checked`);
  r.dispose();
});

test('lifecycle: switching away while the assets load attaches nothing, releases the cache and frees the late result', async () => {
  const gate = fakeAssets({ delay: true }); disposed.clear();
  const { w, r } = make(); streamTo(w, r, 10);
  assert.equal(r.extras.stats.assets, 'loading'); assert.ok(r.extras.loading); assert.equal(art.forestCacheState().refs, 1);
  r.dispose(); assert.equal(art.forestCacheState().refs, 0);
  gate.open(); await tick(); await tick();
  assert.equal(art.forestCacheState().loaded, false);
  assert.equal(disposed.size, NAMES.length * 2 + 5, 'every late geometry + texture disposed');
  assert.equal(r.extras, null);
});

test('shared ownership: two renderers share one load; resources survive until the last release', async () => {
  fakeAssets(); disposed.clear();
  const loads0 = art.forestCacheState().loads;
  const a = make(), b = make(SEED + 1);
  await a.r.extras.whenReady(); await b.r.extras.whenReady();
  assert.equal(art.forestCacheState().loads, loads0 + 1); assert.equal(art.forestCacheState().refs, 2);
  streamTo(a.w, a.r, 30); streamTo(b.w, b.r, 30);
  a.r.dispose(); assert.equal(disposed.size, 0, 'nothing freed while b holds the assets'); assert.equal(art.forestCacheState().refs, 1);
  b.r.update(0, b.w.pointAt(30)); // b still renders its pools
  assert.ok(b.r.extras.stats.drawn > 0);
  b.r.dispose(); assert.equal(art.forestCacheState().refs, 0); assert.equal(disposed.size, NAMES.length * 2 + 5);
});

test('failure + quality off: procedural forest fallback, no pools, still releases', async () => {
  fakeAssets({ fail: true });
  { const { w, r } = make(); await r.extras.whenReady(); streamTo(w, r, 20);
    assert.equal(r.extras.stats.assets, 'failed'); assert.equal(r.extras.pools.size, 0); assert.ok(r.visuals.size > 0); assert.ok(r.stats.tris > 20000, 'legacy trees drawn');
    r.dispose(); assert.equal(art.forestCacheState().refs, 0); }
  fakeAssets(); art.FOREST_ART.quality = 'off';
  try { const loads0 = art.forestCacheState().loads, { w, r } = make(); streamTo(w, r, 20);
    assert.equal(r.extras.stats.assets, 'off'); assert.equal(art.forestCacheState().loads, loads0); assert.ok(r.stats.tris > 20000); r.dispose(); }
  finally { art.FOREST_ART.quality = 'high'; }
});

test('rebase with queued builds: hero placements stay on their plinth colliders', async () => {
  fakeAssets();
  const { w, r } = make(); await r.extras.whenReady();
  w.update(w.pointAt(10), { x: 0, y: 0, z: 0 }, 1 / 60, { force: true }); // cells created, builds queued
  w.rebase(-777, 1234); r.pump(1e9); r.update(0, w.pointAt(10));
  const P = placements(r);
  for (const c of w.live.values()) for (const [, ws] of c.structures) {
    const s = ws.s; if (s.role !== 'decor') continue;
    const col = ws.cols[0], p = P.find((q) => q.name === s.hero && Math.hypot(q.x - col.x, q.z - col.z) < 0.6);
    assert.ok(p, `${s.hero} of ${s.id} on its plinth after the rebase`);
    assert.ok(Math.abs(p.y - s.heroY) < 0.1);
  }
  r.dispose();
});

test('streaming over 4 km: placements only for live cells, bounded pools, releases on dispose', async () => {
  fakeAssets();
  const { w, r } = make(); await r.extras.whenReady();
  let maxPools = 0, rebases0 = w.stats.rebases;
  for (let s = 10; s < 4000; s += 50) {
    streamTo(w, r, s);
    assert.ok(r.extras.cells.size <= w.live.size);
    for (const c of r.extras.cells.keys()) assert.ok(w.live.get(c.idx) === c, 'placements of a recycled cell');
    maxPools = Math.max(maxPools, r.extras.pools.size);
  }
  assert.ok(w.stats.rebases > rebases0, 'crossed a floating-origin rebase');
  assert.ok(maxPools <= NAMES.length * 2);
  r.dispose(); assert.equal(art.forestCacheState().refs, 0);
});

test('asset files: manifest + both glbs list every piece with LOD0/LOD1, hero textures 1024², user sources unchanged', () => {
  const dir = new URL('../public/models/forest/', import.meta.url);
  const glbNames = (f) => { const b = fs.readFileSync(new URL(f, dir)); const n = b.readUInt32LE(12); return JSON.parse(b.subarray(20, 20 + n).toString()).nodes.map((x) => x.name); };
  const kit = glbNames('forest_kit.glb'), heroes = glbNames('forest_heroes.glb');
  for (const p of MANIFEST.pieces) for (const l of [0, 1]) assert.ok(kit.includes(`${p.name}_LOD${l}`), p.name);
  for (const h of art.FOREST_ART.heroes) {
    for (const l of [0, 1]) assert.ok(heroes.includes(`${h}_LOD${l}`), h);
    const H = MANIFEST.heroes[h]; assert.deepEqual(H.textureSize, [1024, 1024]); assert.ok(H.tris[0] <= 8000 && H.tris[1] <= H.tris[0]);
    const src = new URL(`../3D_Models/Forest_of_Shadow_Ruins/${H.source}`, import.meta.url);
    if (fs.existsSync(src)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex'), H.sourceSha256, `${H.source} modified`);
    assert.ok(fs.statSync(new URL(`${h}.jpg`, dir)).size < 600e3);
  }
  assert.ok(fs.statSync(new URL('forest_kit.glb', dir)).size < 3e6 && fs.statSync(new URL('forest_heroes.glb', dir)).size < 3e6);
});
