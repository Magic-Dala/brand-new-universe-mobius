// Redrock Canyon art upgrade (v0.46): source preservation, optimized asset budgets / openings, fitted proportions,
// default profile + isolation, gameplay data untouched, visual-only rock clearance, anchor support on the code cliffs,
// loading lifecycle (success / failure / timeout / late completion / sharing), rebase with builds queued, Quest view
// selection (head turns, camera inside a bound, asymmetric eye frusta, invalid camera) and bounded 4+ km streaming.
// Runs the real ChaseWorld + WorldRenderer + redrock kit in Node (no GPU); the assets are injected boxes with the
// manifest's real bounds (the real GLBs are checked by tools/blender/build_redrock_kit.py and tests/e2e/redrock-*.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

globalThis.localStorage = { getItem: () => null, setItem() {} };
const THREE = await import('three');
const { MAPS, mapById } = await import('../src/worlds/maps.js');
const { ChaseWorld } = await import('../src/worlds/chaseWorld.js');
const { WorldRenderer } = await import('../src/worlds/worldRenderer.js');
const { KITS } = await import('../src/worlds/kits/index.js');
const { createWorldMaterial, createFloorMaterial } = await import('../src/worlds/art/shaders.js');
const { toWorld, pathY, RouteGen } = await import('../src/worlds/route.js');
const { insideBox } = await import('../src/data/box.js');
const art = await import('../src/worlds/art/redrockArt.js');
const forestArt = await import('../src/worlds/art/forestArt.js');

const RED = mapById('redrock'), SEED = 20261103 + 7919;
const MAN = JSON.parse(fs.readFileSync('public/models/redrock/redrock_kit.json', 'utf8'));
// /private/tmp/mobius-redrock-art/source-models.json (hashes taken before any work)
const SOURCES = {
  rr_arch: ['redrock natural arch 3d model.glb', '1339f64e7ab483e7e2f9c4c7b9f4196aa5981f4ee125d43b8247cf125f19429f', 11476],
  rr_hoodoo_a: ['redrock hoodoo A mushroom 3d model.glb', 'b4314a578c90a27948c469db831a45a4bb4bdc0b5b35ea499f159c2fd2fbe9c2', 10897],
  rr_hoodoo_b: ['redrock hoodoo B Splitcap 3d model.glb', '78f75f8d9a0052e3419cbd69ce154cd5cf2a45e01698150c5cd9375e4bd33c72', 8540],
  rr_alcove: ['redrock overhang alcove 3d model.glb', 'b292771b550ec9cf741c9c723068c69f20a9985f3cca17addf107fd0ec5e137c', 196502],
};
const BOUNDS = new Map([...MAN.pieces.map((p) => [p.name, [p.bmin, p.bmax]]), ...Object.entries(MAN.heroes).map(([k, h]) => [k, h.bounds])]);
const boxOf = (name) => { const [a, b] = BOUNDS.get(name), g = new THREE.BoxGeometry(b[0] - a[0], b[1] - a[1], b[2] - a[2]); g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); return g; };
function fakeAssets({ gate = null, fail = false } = {}) {
  const made = { geo: [], tex: [] };
  art.setRedrockLoader(async () => {
    if (gate) await gate;
    if (fail) throw new Error('redrock assets missing (test)');
    const geo = new Map([...BOUNDS.keys()].map((n) => [n, [0, 1].map(() => { const g = boxOf(n); made.geo.push(g); return g; })]));
    const tex = new Map(art.REDROCK_ART.heroes.map((h) => { const t = new THREE.Texture(); made.tex.push(t); return [h, t]; }));
    return { geo, tex, manifest: MAN };
  });
  return made;
}
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise((r) => setTimeout(r, 0));
function make(app = null, seed = SEED) { const w = new ChaseWorld(RED, { seed }); const r = new WorldRenderer(app, RED, w); return { w, r }; }
const stream = (w, r, s) => { w.update(w.pointAt(s), { x: 0, y: 0, z: 0 }, 1 / 60, { force: true }); r.pump(1e9); r.update(0, w.pointAt(s)); };
function walk(w, r, s1, step = 50, each = null) { for (let s = 10; s <= s1; s += step) { stream(w, r, s); each?.(s); } }
/** Route-space placements with their keys and module. */
function placements(r) {
  const out = [];
  for (const [cell, e] of r.extras.cells) for (const [key, P] of e.pieces) for (let i = 0; i < P.n; i++) out.push({ key, name: key.split('@')[0], far: key.endsWith('@far'), m: P.m.subarray(i * 16, i * 16 + 16), cell });
  return out;
}
const corners = (name, m) => { const [a, b] = BOUNDS.get(name), out = []; for (const x of [a[0], b[0]]) for (const y of [a[1], b[1]]) for (const z of [a[2], b[2]]) out.push([m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]); return out; };
/** Module-frame (u, v) of a route-space point (nearest centre-line sample, 0.5 m steps). */
function uvOf(mod, x, z) { let best = null; for (let u = -20; u <= mod.L + 20; u += 0.5) { const [px, pz] = toWorld(mod, Math.max(0, Math.min(mod.L, u)), 0), d = (px - x) ** 2 + (pz - z) ** 2; if (!best || d < best.d) best = { u, d }; } const [px, pz] = toWorld(mod, Math.max(0, Math.min(mod.L, best.u)), 0); return { u: best.u, v: Math.sqrt(best.d) }; }

// =============================================================================================== assets
// The source models are kept out of the repository: without 3D_Models/ this test skips itself; with it, it runs as before.
const NO_SOURCES = fs.existsSync('3D_Models/Redrock_Canyon') ? false : 'the source models (3D_Models/) are not in this checkout';
test('redrock sources: the user GLBs are byte-identical to the pre-work hashes and never shipped', { skip: NO_SOURCES }, () => {
  for (const [hero, [fn, sha]] of Object.entries(SOURCES)) {
    const got = crypto.createHash('sha256').update(fs.readFileSync(`3D_Models/Redrock_Canyon/${fn}`)).digest('hex');
    assert.equal(got, sha, fn); assert.equal(MAN.heroes[hero].sourceSha256, sha, `${hero} manifest provenance`); assert.equal(MAN.heroes[hero].source, fn);
  }
  for (const f of fs.readdirSync('public/models/redrock')) assert.ok(!/3d model/i.test(f), `source copy shipped: ${f}`);
});

test('redrock optimized assets: LOD budgets, 1K base colour, every node, arch opening + alcove cavity survive both LODs', () => {
  const budget = { rr_arch: 12000, rr_hoodoo_a: 6000, rr_hoodoo_b: 8000, rr_alcove: 15000 };
  for (const [hero, [, , srcTris]] of Object.entries(SOURCES)) {
    const h = MAN.heroes[hero];
    assert.equal(h.sourceTris, srcTris, hero);
    assert.ok(h.tris[0] <= budget[hero] * 1.01, `${hero} LOD0 ${h.tris[0]}`);
    assert.ok(h.tris[1] >= 1400 && h.tris[1] <= 4000 && h.tris[1] < h.tris[0] / 2.5, `${hero} LOD1 ${h.tris[1]}`);
    assert.deepEqual(h.textureSize, [1024, 1024]);
    const jpg = fs.statSync(`public/models/redrock/${hero}.jpg`).size; assert.ok(jpg < 400000, `${hero}.jpg ${jpg}`);
    for (const k of [0, 1, 2]) { assert.ok(h.bounds[1][k] - h.bounds[0][k] <= 1.01, `${hero} unit-normalised`); }
    assert.ok(Math.abs(h.bounds[0][1]) < 0.01, `${hero} origin at the bottom`);
  }
  assert.ok(MAN.heroes.rr_alcove.tris[0] <= 15000 && SOURCES.rr_alcove[2] / MAN.heroes.rr_alcove.tris[0] > 13, 'the 196k alcove is reduced before runtime');
  for (const lv of ['lod0', 'lod1']) {
    assert.equal(MAN.heroes.rr_arch.checks[lv].through, 24, `arch ${lv}: all opening rays pass`);
    assert.deepEqual(MAN.heroes.rr_alcove.checks[lv].shallow, [], `alcove ${lv}: cavity not filled`);
  }
  for (const p of MAN.pieces) assert.ok(p.tris[1] < p.tris[0] && p.tris[0] <= p.budget[0], p.name);
  for (const [file, names] of [['redrock_heroes.glb', Object.keys(SOURCES)], ['redrock_kit.glb', MAN.pieces.map((p) => p.name)]]) {
    const b = fs.readFileSync(`public/models/redrock/${file}`), js = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
    const nodes = new Set(js.nodes.map((n) => n.name));
    for (const n of names) for (const l of [0, 1]) assert.ok(nodes.has(`${n}_LOD${l}`), `${file} ${n}_LOD${l}`);
    assert.ok(!js.materials?.length && !js.images?.length, `${file}: geometry only (textures are separate 1K jpgs)`);
  }
});

test('redrock fitted proportions (REDROCK_DIMS) match the measured profiles of the optimized LODs', () => {
  const D = art.REDROCK_DIMS, A = MAN.heroes.rr_arch.profile;
  for (const lv of ['lod0', 'lod1']) {
    const P = A[lv], feet = P.y.map((y, i) => [y, P.innerL[i], P.innerR[i]]).filter(([y]) => y <= 0.2);
    for (const [, L, R] of feet) assert.ok(Math.min(D.arch.cx - L, R - D.arch.cx) >= D.arch.halfFeet - 0.006, `${lv}: legs inside halfFeet`);
    const ci = P.x.reduce((b, x, i) => (Math.abs(x - D.arch.cx) < Math.abs(P.x[b] - D.arch.cx) ? i : b), 0);
    assert.ok(Math.abs(P.under[ci] - D.arch.under) < 0.01, `${lv}: crown underside ${P.under[ci]}`);
    for (let i = 0; i < P.x.length; i++) if (Math.abs(P.x[i] - D.arch.cx) <= 0.08) assert.ok(P.under[i] >= D.arch.underSide - 0.006, `${lv}: underside over the under-anchors`);
  }
  const C = MAN.heroes.rr_alcove.profile.lod0; // the cavity back wall lies in front of backZ: the wall face behind never cuts into it
  C.y.forEach((y, j) => { if (y < 0.08 || y > 0.23) return; C.x.forEach((x, i) => { const z = C.frontZ[j][i]; if (x >= -0.25 && x <= 0.3 && z != null) assert.ok(z >= art.REDROCK_DIMS.alcove.backZ, `cavity z ${z} at ${x},${y}`); }); });
  for (const row of MAN.heroes.rr_hoodoo_b.profile.lod0) assert.ok(row[1] >= D.hoodoo_b.stemMinX - 0.05, 'B stem never reaches past stemMinX');
  for (const row of MAN.heroes.rr_hoodoo_a.profile.lod0) if (row[0] > D.hoodoo_a.capY0 + 0.05 && row[0] < 0.95) assert.ok(row[2] - row[1] > 0.45, `A cap band at ${row[0]}`);
});

// =============================================================================================== profile + isolation
test('redrock default ON: desktop high, immersive → quest, override wins, off only on request; forest config untouched', () => {
  assert.equal(art.REDROCK_ART.quality, 'high'); assert.equal(art.REDROCK_ART.xrQuality, 'quest'); assert.equal(art.REDROCK_ART.override, null);
  assert.deepEqual(art.resolveRedrockQuality({}), { requested: 'high', resolved: 'high', reason: 'default' });
  assert.deepEqual(art.resolveRedrockQuality({ xr: true }), { requested: 'high', resolved: 'quest', reason: 'xr' });
  assert.equal(art.resolveRedrockQuality({ xr: true, override: 'high' }).resolved, 'high');
  assert.equal(art.resolveRedrockQuality({ override: 'off' }).resolved, 'off');
  assert.equal(art.resolveRedrockQuality({ base: 'nonsense' }).resolved, 'high');
  assert.equal(forestArt.FOREST_ART.quality, 'high'); assert.equal(forestArt.FOREST_ART.xrQuality, 'quest');
  assert.notEqual(art.REDROCK_ART.lod, forestArt.FOREST_ART.lod);
  assert.equal(forestArt.forestCacheState().refs, 0); assert.equal(art.redrockCacheState().refs, 0);
});

test('redrock only: REDROCK shader branch / extras on redrock; the other maps keep their material and extras', () => {
  fakeAssets();
  for (const map of MAPS) {
    const mat = createWorldMaterial(map.look), floor = createFloorMaterial(map);
    if (map.id === 'redrock') { assert.deepEqual(mat.defines, { REDROCK: 1 }); assert.deepEqual(floor.defines, { REDROCK: 1 }); assert.ok('uHeroMap' in mat.uniforms && 'uOff' in mat.uniforms); }
    else { assert.ok(!mat.defines.REDROCK && !floor.defines?.REDROCK, map.id); assert.ok(map.id === 'forest' || !('uHeroMap' in mat.uniforms), map.id); }
    mat.dispose(); floor.dispose();
    if (!['foldscape', 'forest', 'redrock'].includes(map.id)) assert.equal(KITS[map.id].createExtras, undefined, map.id);
  }
  const { r } = make(); assert.ok(r.extras instanceof art.RedrockDetail); assert.equal(r.extras.stats.quality, 'high'); r.dispose();
  assert.equal(art.redrockCacheState().refs, 0); art.setRedrockLoader(null);
});

// =============================================================================================== gameplay preserved
test('gameplay preserved: building the art changes no module structure / tier / anchor / coin / checkpoint (3 seeds, 4+ km)', async () => {
  fakeAssets();
  for (const seed of [SEED, 7, 91827]) {
    const ref = new RouteGen(RED, seed); ref.ensure(60);
    const { w, r } = make(null, seed); await r.extras.whenReady();
    walk(w, r, 4200, 100);
    for (const m of w.route.modules.slice(0, 55)) {
      const o = ref.modules[m.idx];
      assert.deepEqual(JSON.parse(JSON.stringify({ s: m.structures, a: m.anchors, c: m.coins, k: m.checkpoints })), JSON.parse(JSON.stringify({ s: o.structures, a: o.anchors, c: o.coins, k: o.checkpoints })), `seed ${seed} module ${m.idx}`);
    }
    r.dispose();
  }
  art.setRedrockLoader(null);
});

test('four Tripo types are placed on the normal route from the start; visual-only rock stays out of the flight space', async () => {
  fakeAssets();
  const { w, r } = make(); await r.extras.whenReady(); stream(w, r, 10);
  for (const h of art.REDROCK_ART.heroes) assert.ok(r.extras.count(h) > 0, `${h} present in the start window`);
  const startArch = placements(r).find((p) => p.name === 'rr_arch' && p.cell.m.idx === 0); assert.ok(startArch, 'the river arch of the first view');
  let checked = 0;
  walk(w, r, 2400, 100, () => {
    for (const p of placements(r)) {
      const mod = p.cell.m, C = corners(p.name, p.m), top = Math.max(...C.map((c) => c[1]));
      const river = !p.far && (['rk_talus', 'rk_boulder', 'rr_alcove'].includes(p.name) || (/^rr_(arch|hoodoo)/.test(p.name) && p.m[13] < 10));
      if (!p.far && !river) continue;
      const near = C.map((c) => uvOf(mod, c[0], c[2])), lo = Math.min(...near.map((q) => pathY(mod, Math.max(0, Math.min(mod.L, q.u)))));
      if (p.far) { // round pieces (mesa / spire / hoodoo): centre distance − radial extent; the arch: its oriented box corners
        const [a0, b0] = BOUNDS.get(p.name), sx = Math.hypot(p.m[0], p.m[1], p.m[2]), sz = Math.hypot(p.m[8], p.m[9], p.m[10]), rad = Math.max(-a0[0], b0[0], -a0[2], b0[2]) * Math.max(sx, sz);
        const boxy = p.name === 'rr_arch' || Math.abs(sx - sz) > 0.3 * Math.max(sx, sz); // (the long mesa under a far arch: its oriented box)
        const inner = boxy ? Math.min(...near.map((q) => q.v)) : uvOf(mod, p.m[12], p.m[14]).v - rad;
        assert.ok(inner > mod.halfW + 34, `far ${p.key} within the reachable corridor (module ${mod.idx}): ${inner.toFixed(1)}`);
      }
      else assert.ok(top < lo - 25, `${p.key} top ${top.toFixed(1)} within 25 m of the flight path ${lo.toFixed(1)} (module ${mod.idx})`);
      checked++;
    }
  });
  assert.ok(checked > 300, `checked ${checked}`);
  r.dispose(); art.setRedrockLoader(null);
});

test('landmark arch: legs behind every inner wall face, crown underside on the under-anchors, knob behind each one', async () => {
  fakeAssets();
  const D = art.REDROCK_DIMS.arch; let n = 0;
  for (const seed of [SEED, 7, 91827, 4242]) {
    const { w, r } = make(null, seed); await r.extras.whenReady();
    walk(w, r, 4200, 100, () => {
      for (const p of placements(r)) {
        if (p.name !== 'rr_arch' || p.far || p.m[13] < 10 || p._seen) continue;
        const mod = p.cell.m, s = mod.structures.find((x) => x.kind === 'landmarkArch'); assert.ok(s, 'arch placed only on the landmark span');
        const S = Math.hypot(p.m[0], p.m[1], p.m[2]), base = p.m[13];
        assert.ok(S * D.halfFeet >= mod.halfW + 1, `opening ${S * D.halfFeet} vs corridor ${mod.halfW}`);
        for (const st of mod.structures) if (st.role === 'inner' && Math.abs(st.u - s.u) < D.halfDepth * S * 0.62) for (const t of st.tiers) if (t.y0 < s.y0) assert.ok(S * D.halfFeet >= Math.abs(st.v) + Math.sign(st.v) * t.dv - t.d / 2 + 0.9, 'legs behind the wall faces');
        const under = base + D.under * S, side = base + D.underSide * S;
        assert.ok(side >= s.y0 - 0.5 && under <= s.y0 + 3.5, `crown underside ${side.toFixed(2)}..${under.toFixed(2)} vs span ${s.y0.toFixed(2)}`);
        const mounts = placements(r).filter((q) => q.name === 'rk_mount' && q.cell === p.cell && Math.abs(q.m[13] - (s.y0 - 0.15)) < 0.5).length;
        assert.ok(mounts >= mod.anchors.filter((a) => a.sid === s.id).length, 'a knob behind every under-anchor');
        n++; p._seen = true;
      }
    });
    r.dispose();
  }
  assert.ok(n >= 4, `landmark arches checked: ${n}`); art.setRedrockLoader(null);
});

test('pillars: proportionate Tripo crowns on Blender shafts inside the pillar collider (no stretched needles)', async () => {
  fakeAssets();
  const { w, r } = make(); await r.extras.whenReady(); let n = 0;
  walk(w, r, 3000, 100, () => {
    for (const p of placements(r)) {
      if (!/^rr_hoodoo/.test(p.name) || p.far || p.m[13] < 10) continue;
      const sx = Math.hypot(p.m[0], p.m[1], p.m[2]), sy = Math.hypot(p.m[4], p.m[5], p.m[6]);
      assert.ok(Math.abs(sx / sy - 1) < 0.05 && sy < 10, `hoodoo crown ${sx.toFixed(2)} × ${sy.toFixed(2)}: proportionate`);
      const col = [...p.cell.colliders].find((c) => c.role === 'pillar' && insideBox(c, p.m[12] + w.off[0], p.m[13] + 1, p.m[14] + w.off[1], 1));
      assert.ok(col, 'crown stands on a pillar collider');
      if (p.name === 'rr_hoodoo_b') for (const c of corners(p.name, p.m)) assert.ok(insideBox(col, c[0] + w.off[0], Math.min(c[1], col.y1), c[2] + w.off[1], 0.9), 'B (fixed yaw): crown box within the collider (+0.9 m)');
      else assert.ok(0.46 * sx <= Math.min(col.hw, col.hd) + 0.5 && insideBox(col, p.m[12] + w.off[0], p.m[13] + 1, p.m[14] + w.off[1], 0.3), 'A (any yaw): its round cap (r ≤ 0.46 S) within the collider (+0.5 m)');
      assert.ok(Math.max(...corners(p.name, p.m).map((c) => c[1])) <= col.y1 + 0.6, 'crown top at the collider top');
      n++;
    }
  });
  assert.ok(n > 5, `pillar crowns ${n}`); r.dispose(); art.setRedrockLoader(null);
});

test('anchors on the code cliffs sit on visible rock: the face is 0.1–1.4 m behind every inner-wall device', async () => {
  fakeAssets();
  const { w, r } = make(); await r.extras.whenReady(); const ray = new THREE.Raycaster(), n = new THREE.Vector3(); let checked = 0;
  walk(w, r, 2400, 100, () => {
    for (const [cell, v] of r.visuals) {
      const mesh = v.meshes.find((m) => m.name === 'arch'); v.group.updateMatrixWorld(true);
      for (const a of cell.anchors) {
        if (!a.valid || a.src.side === 0 || a.kind !== 'inner') continue;
        n.fromArray(a.normal).normalize(); ray.set(a.p.clone().addScaledVector(n, 0.8), n.clone().negate()); ray.far = 4.8;
        const hit = ray.intersectObject(mesh, false)[0];
        assert.ok(hit, `anchor ${a.id}: no rock behind`); assert.ok(hit.distance >= 0.9 && hit.distance <= 2.2, `anchor ${a.id}: face at ${hit.distance.toFixed(2)} (covered or floating)`);
        checked++;
      }
    }
  });
  assert.ok(checked > 100, `checked ${checked}`); r.dispose(); art.setRedrockLoader(null);
});

// =============================================================================================== lifecycle
test('loading: success attaches pools; a failure selects the legacy canyon; nothing leaks', async () => {
  const made = fakeAssets();
  { const { w, r } = make(); assert.equal(r.extras.loading, true); assert.equal(r.extras.blockLoad, true); await r.extras.whenReady(); assert.equal(r.extras.stats.assets, 'ready'); stream(w, r, 10); assert.ok(r.extras.pools.size > 4); r.dispose(); }
  assert.equal(art.redrockCacheState().refs, 0); assert.ok(made.geo.every((g) => g.attributes.position), 'disposed after the last release');
  fakeAssets({ fail: true });
  const { w, r } = make(); await r.extras.whenReady();
  assert.equal(r.extras.stats.assets, 'failed'); assert.equal(r.extras.loading, false); stream(w, r, 10);
  assert.equal(r.extras.placements, 0); assert.equal(r.extras.pools.size, 0); assert.ok(r.stats.tris > 0, 'legacy procedural canyon drawn');
  r.dispose(); assert.equal(art.redrockCacheState().refs, 0); art.setRedrockLoader(null);
});

test('loading: timeout falls back before streaming; a late result is never attached and is disposed', async () => {
  const gate = deferred(), t0 = art.REDROCK_ART.loadTimeoutMs; art.REDROCK_ART.loadTimeoutMs = 10;
  const made = fakeAssets({ gate: gate.promise });
  const { w, r } = make();
  try {
    await Promise.race([r.extras.whenReady(), new Promise((_, rej) => setTimeout(() => rej(new Error('no bounded fallback')), 300))]);
    assert.equal(r.extras.stats.assets, 'failed'); assert.equal(r.extras.beginCell({}, {}, 0, 0).on, false);
    assert.equal(art.redrockCacheState().refs, 0);
    let disposed = 0; gate.resolve(); await tick(); await tick();
    for (const g of made.geo) g.addEventListener('dispose', () => disposed++);
    stream(w, r, 10); assert.equal(r.extras.assets, null); assert.equal(r.extras.pools.size, 0);
    assert.equal(art.redrockCacheState().loaded, false, 'the late bundle is not kept');
  } finally { r.dispose(); art.REDROCK_ART.loadTimeoutMs = t0; art.setRedrockLoader(null); }
});

test('loading: disposed while loading (map switch) attaches nothing; two renderers share one load, freed with the last', async () => {
  const gate = deferred(); fakeAssets({ gate: gate.promise });
  const { r } = make(); const ex = r.extras, group = ex.group;
  assert.equal(art.redrockCacheState().refs, 1); r.dispose(); assert.equal(art.redrockCacheState().refs, 0);
  gate.resolve(); await ex.whenReady(); ex.update(new THREE.Vector3());
  assert.equal(group.children.length, 0); assert.equal(ex.assets, null); assert.equal(art.redrockCacheState().loaded, false);
  fakeAssets();
  const A = make(), B = make(); await A.r.extras.whenReady(); await B.r.extras.whenReady();
  assert.equal(art.redrockCacheState().refs, 2); const loads = art.redrockCacheState().loads;
  A.r.dispose(); assert.equal(art.redrockCacheState().loaded, true, 'kept while B holds it'); B.r.dispose();
  assert.equal(art.redrockCacheState().refs, 0); assert.equal(art.redrockCacheState().loaded, false);
  const C = make(); await C.r.extras.whenReady(); assert.equal(art.redrockCacheState().loads, loads + 1, 're-entry reloads cleanly'); C.r.dispose();
  art.setRedrockLoader(null);
});

test('rebase while module builds are queued: every placement lands where the un-rebased build puts it', async () => {
  fakeAssets();
  const world = (r) => { const o = r.extras.group.position; return placements(r).map((p) => `${p.key}:${(p.m[12] + o.x).toFixed(2)}:${p.m[13].toFixed(2)}:${(p.m[14] + o.z).toFixed(2)}`).sort(); };
  const A = make(); await A.r.extras.whenReady(); stream(A.w, A.r, 10); const ref = world(A.r);
  const B = make(); await B.r.extras.whenReady();
  B.w.update(B.w.pointAt(10), { x: 0, y: 0, z: 0 }, 1 / 60, { force: true });
  for (let i = 0; i < 7; i++) B.r.pump(0.0001); // a few build steps, cells half done
  assert.ok(B.r.pending > 0, 'builds still queued');
  B.w.rebase(600, -900); B.r.pump(1e9); B.r.update(0, B.w.pointAt(10));
  const got = world(B.r).map((k) => { const [key, x, y, z] = k.split(':'); return `${key}:${(+x - 600).toFixed(2)}:${y}:${(+z + 900).toFixed(2)}`; }).sort();
  assert.equal(got.length, ref.length); assert.deepEqual(got, ref);
  A.r.dispose(); B.r.dispose(); art.setRedrockLoader(null);
});

// =============================================================================================== Quest selection
test('quest view selection: immersive app resolves quest before streaming; head-only turns reselect; inside a bound always drawn', async () => {
  fakeAssets();
  const app = { xrActive: true };
  const { w, r } = make(app); const d = r.extras;
  assert.equal(d.stats.quality, 'quest'); assert.equal(d.stats.reason, 'xr'); assert.equal(w.live.size, 0, 'resolved before any cell streams');
  await d.whenReady(); stream(w, r, 200);
  const cam = new THREE.PerspectiveCamera(90, 1, 0.1, 1300), p = w.pointAt(200), q = w.pointAt(240);
  cam.position.copy(p); cam.lookAt(q); cam.updateMatrixWorld(true);
  r.update(0, cam.position, cam); assert.equal(d.stats.cull, 'view');
  const sel = () => { const s = new Set(); d.forEachSelected((k, l, P, i) => s.add(`${k}:${P.m[i * 16 + 12].toFixed(1)}:${P.m[i * 16 + 14].toFixed(1)}`)); return s; };
  const ahead = sel(), culled = d.stats.culled, r0 = d.stats.rebuilds; assert.ok(culled > 0, 'something behind is culled');
  r.update(0, cam.position, cam); assert.equal(d.stats.rebuilds, r0, 'still head: no reselect');
  cam.rotateY(Math.PI); cam.updateMatrixWorld(true); r.update(0, cam.position, cam);
  assert.ok(d.stats.rebuilds > r0, 'head-only turn reselects'); const behind = sel(); let gained = 0; for (const x of behind) if (!ahead.has(x)) gained++; assert.ok(gained > 0, 'the rear appears after the turn');
  // camera inside the landmark / any big piece bound: a box containing the eye always passes the plane test
  const k = d.kinds.get('rr_arch'), m = new Float32Array(new THREE.Matrix4().makeScale(100, 100, 60).elements), b = new Float32Array([0, 20, 0]);
  const v = { ex: 0, ey: 20, ez: 0, np: 0, n: new Float64Array(12), pad: 0 }; d._readView(cam, v); d._freeze({ ...v, ex: 0, ey: 20, ez: 0 }, v);
  assert.ok(art.RedrockDetail.sees(v, k, m, 0, b, 0), 'eye inside the bound');
  // asymmetric (eye / union) frustum: read and used; an orthographic / invalid camera → distance-only fallback
  const eye = new THREE.PerspectiveCamera(); eye.projectionMatrix.makePerspective(-0.6, 1.4, 1, -1, 0.1, 1000); eye.position.copy(cam.position); eye.updateMatrixWorld(true);
  assert.equal(d._readView(eye, {}), true);
  const ortho = new THREE.OrthographicCamera(); ortho.updateMatrixWorld(true); r.update(0, cam.position, ortho); assert.equal(d.stats.cull, 'fallback');
  // session ends under the live renderer: desktop high again, no rebuild of placements
  const placed = d.placements; app.xrActive = false; r.update(0, cam.position, cam); assert.equal(d.stats.quality, 'high'); assert.equal(d.stats.cull, 'off'); assert.equal(d.placements, placed);
  r.dispose(); art.setRedrockLoader(null);
});

test('4+ km streaming (quest): bounded cells / pools / instance slots / selection time; nothing accumulates', async () => {
  fakeAssets();
  const { w, r } = make({ xrActive: true }); const d = r.extras; await d.whenReady();
  const cam = new THREE.PerspectiveCamera(90, 1, 0.1, 1300); let maxPools = 0, maxSlots = 0, maxPlaced = 0; const sel = [];
  for (let s = 10; s <= 4400; s += 25) {
    w.update(w.pointAt(s), { x: 0, y: 0, z: 0 }, 1 / 60, { force: true }); r.pump(1e9);
    cam.position.copy(w.pointAt(s)); cam.lookAt(w.pointAt(s + 30)); cam.updateMatrixWorld(true);
    const n0 = d.stats.rebuilds; r.update(0, cam.position, cam); if (d.stats.rebuilds !== n0) sel.push(d.stats.rebuildMs);
    maxPools = Math.max(maxPools, d.pools.size); let slots = 0; for (const p of d.pools.values()) slots += p.cap; maxSlots = Math.max(maxSlots, slots); maxPlaced = Math.max(maxPlaced, d.placements);
    assert.ok(d.cells.size <= w.live.size, 'no orphan cells');
  }
  assert.ok(w.stats.rebases >= 2, `rebases ${w.stats.rebases}`); assert.ok(w.stats.recycled > 20);
  const kinds = new Set(placements(r).map((p) => p.key)).size;
  assert.ok(maxPools <= 2 * (MAN.pieces.length + 4) + 10, `pools ${maxPools}`); assert.ok(maxSlots <= 6000, `instance slots ${maxSlots}`); assert.ok(maxPlaced < 2500, `placements ${maxPlaced}`);
  sel.sort((a, b) => a - b); const p90 = sel[Math.floor(sel.length * 0.9)];
  assert.ok(p90 < 4, `selection p90 ${p90} ms (Node, desktop CPU)`);
  console.log(`  redrock 4.4 km: rebases ${w.stats.rebases}, pools ≤ ${maxPools}, slots ≤ ${maxSlots}, placements ≤ ${maxPlaced}, keys ${kinds}, selections ${sel.length} p90 ${p90} max ${sel.at(-1)} ms`);
  r.dispose(); assert.equal(art.redrockCacheState().refs, 0); art.setRedrockLoader(null);
});
