// v0.40 World Chase: map registry, route generation (all eight maps), validation against the real movement limits,
// streaming / recycling safety, floating origin, and a physics swing bot through every map.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const THREE = await import('three');
const { MAPS, mapById, MAP_IDS } = await import('../src/worlds/maps.js');
const { RouteGen, validateModule, pathY, toWorld, DEMANDING, ROUTE_CFG } = await import('../src/worlds/route.js');
const { ChaseWorld } = await import('../src/worlds/chaseWorld.js');
const { Locomotion } = await import('../src/game/locomotion.js');
const { fakeApp } = await import('./route.test.mjs');
const { settings } = await import('../src/core/settings.js');

test('registry: eight maps with localized names / descriptions, reference + thumbnail', () => {
  assert.equal(MAPS.length, 8);
  assert.deepEqual(MAP_IDS, ['foldscape', 'forest', 'redrock', 'neon', 'moonlit', 'cloudpalace', 'aurora', 'molten']);
  for (const m of MAPS) {
    for (const l of ['en', 'zh-Hant']) { assert.ok(m.name[l]?.length > 2, `${m.id} name ${l}`); assert.ok(m.desc[l]?.length > 8, `${m.id} desc ${l}`); }
    assert.ok(m.ref.endsWith('.png'));
    assert.ok(m.gen.halfW >= 10 && m.gen.yRange[0] < m.gen.yBase && m.gen.yBase < m.gen.yRange[1]);
  }
  assert.equal(mapById('moonlit').ref, 'moonlit-japanese-city-concept-v2.png', 'Moonlit uses the approved tall v2 concept');
});

test('route grammar: deterministic, demanding modules followed by calm ones, heading + height bounded', () => {
  for (const map of MAPS) {
    const a = new RouteGen(map, 7), b = new RouteGen(map, 7); a.ensure(150); b.ensure(150);
    assert.deepEqual(a.modules.map((m) => m.type), b.modules.map((m) => m.type), 'same seed → same route');
    const a0 = a.modules[0].a0;
    for (let i = 1; i < a.modules.length; i++) {
      const p = a.modules[i - 1], m = a.modules[i];
      if (DEMANDING.has(p.type)) assert.ok(!DEMANDING.has(m.type), `${map.id}: ${p.type} → ${m.type}`);
      assert.ok(Math.abs(m.a0 - a0) <= ROUTE_CFG.maxHeading + 1e-6, `${map.id} heading`);
      assert.ok(m.yIn >= map.gen.yRange[0] - 1e-6 && m.yOut <= map.gen.yRange[1] + 1e-6, `${map.id} height ${m.yOut}`);
      const pe = toWorld(p, p.L, 0), ms = toWorld(m, 0, 0); assert.ok(Math.hypot(pe[0] - ms[0], pe[1] - ms[1]) < 1e-6, 'modules chain');
      assert.ok(m.checkpoints.length >= 1, 'every module has a recovery point');
    }
    const types = new Set(a.modules.map((m) => m.type));
    for (const k of ['straight', 'turnL', 'turnR', 'bridgeHigh', 'bridgeLow', 'recovery', 'landmark']) assert.ok(types.has(k), `${map.id} uses ${k}`);
  }
});

test('validation: 60 modules per map — corridor clear, an anchor ahead everywhere, coins outside geometry', () => {
  for (const map of MAPS) {
    const w = new ChaseWorld(map, { autoReady: true }); w.route.ensure(62);
    for (let i = 0; i <= 61; i++) w._create(i);
    for (let i = 0; i < 60; i++) { const v = validateModule(w.route.modules[i], w); assert.ok(v.ok, `${map.id} #${i} ${w.route.modules[i].type}: ${v.problems.slice(0, 3).join('; ')}`); }
    for (const c of w.live.values()) for (const a of c.anchors) {
      const col = w.colliderOf(a.building); assert.ok(col, `${a.id} attached to a structure`);
      // the anchor sits on (≤ 1 m from) its own structure: no floating anchors
      let near = Infinity; for (const k of c.colliders) if (k.id === a.building) { const [bx, bz] = THREE ? [0, 0] : [0, 0]; void bx; void bz; const dx = Math.max(0, Math.abs((a.p.x - k.x) * k.cos - (a.p.z - k.z) * k.sin) - k.hw), dz = Math.max(0, Math.abs((a.p.x - k.x) * k.sin + (a.p.z - k.z) * k.cos) - k.hd), dy = a.p.y < k.y0 ? k.y0 - a.p.y : a.p.y > k.y1 ? a.p.y - k.y1 : 0; near = Math.min(near, Math.hypot(dx, dy, dz)); }
      assert.ok(near < 1.0, `${map.id} ${a.id} is ${near.toFixed(2)} m from its structure`);
    }
  }
});

test('streaming: protected while attached / pinned / near; recycled behind; floating origin keeps everything aligned', () => {
  const w = new ChaseWorld(mapById('neon'), { autoReady: true });
  const p = w.pointAt(30); w.update(p, { x: 0, y: 0, z: 0 }, 1 / 60, { force: true });
  const first = w.live.get(0); const a = first.anchors[0];
  w.setAttached([a]); w.pin('boss', 1);
  for (let s = 30; s < 900; s += 10) w.update(w.pointAt(s), { x: 0, y: 0, z: 18 }, 1 / 60, { force: true });
  assert.ok(w.live.has(0) && a.valid, 'module with the held anchor kept');
  assert.ok(w.live.has(1), 'pinned module kept');
  w.setAttached([]); w.pin('boss', null);
  w.update(w.pointAt(900), { x: 0, y: 0, z: 0 }, 1 / 60, { force: true });
  assert.ok(!w.live.has(0) && !a.valid, 'released → recycled, anchor invalidated');
  // rebase: shift by a large offset, the route + colliders + anchors move together
  const s = 600, before = w.pointAt(s).clone(), anyA = [...w.live.values()].at(-1).anchors[0], ap = anyA.p.clone();
  const evt = []; w.on({ rebased: (dx, dz) => evt.push([dx, dz]) });
  w.rebase(-1000, 500);
  const after = w.pointAt(s);
  assert.ok(Math.abs(after.x - before.x + 1000) < 1e-6 && Math.abs(after.z - before.z - 500) < 1e-6);
  assert.ok(Math.abs(anyA.p.x - ap.x + 1000) < 1e-6 && evt.length === 1);
  assert.ok(w.anchorsNear(anyA.p.x, anyA.p.z, 2).includes(anyA), 'spatial index rebuilt');
  // automatic rebase far from the origin when not on a web
  const w2 = new ChaseWorld(mapById('redrock'), { autoReady: true }); let rb = 0; w2.on({ rebased: () => rb++ });
  for (let s2 = 0; s2 < 2400; s2 += 12) w2.update(w2.pointAt(s2), { x: 0, y: 0, z: 0 }, 1 / 60, { force: true });
  assert.ok(rb >= 1 && w2.stats.rebases >= 1, 'rebased on a long run');
  const pp = w2.pointAt(w2._hintS); assert.ok(Math.abs(pp.x) < 1600 && Math.abs(pp.z) < 1600);
});

/** Swing bot: real Locomotion physics through the streamed world (like the story route bot). */
function swingBot(map, seconds = 120) {
  const w = new ChaseWorld(map, { autoReady: true });
  const app = fakeApp(w), loco = new Locomotion(app), hub = app.hub;
  loco.setCityMode([]); loco.ignoreColliders = new Set();
  const cp = w.route.modules[0].checkpoints[0];
  w.update(w.pointAt(0), { x: 0, y: 0, z: 0 }, 1 / 72, { force: true });
  const sp = w.live.get(0).checkpoints[0].pos;
  loco.placeAt(new THREE.Vector3(sp[0], sp[1], sp[2]), 0); void cp;
  let t = 0, s = w.progress(sp[0], sp[2], 0).s, maxS = s, attachedAt = 0, attaches = 0, falls = 0, blocked = 0, street = 0, grounds = 0, rebases = 0;
  w.on({ rebased: (dx, dz) => { loco.shift(dx, dz); rebases++; } });
  loco.onWebBlocked = () => { blocked++; }; loco.onFall = () => { falls++; };
  let respawns = 0;
  const respawn = () => { const c = w.checkpointBefore(maxS); if (!c) return; respawns++; loco.detach(true); loco.placeAt(new THREE.Vector3(...c.pos), null); if (c.kind !== 'roof') loco.grounded = false; };
  loco.onStreet = () => { street++; if (map.gen.lethalFloor) respawn(); }; // the game: lethal floors → recovery fade to the last checkpoint
  const hand = () => (attaches % 2 ? 'left' : 'right');
  for (let i = 0; i < 72 * seconds; i++) {
    t += 1 / 72;
    const feet = loco.feet(new THREE.Vector3());
    w.update(feet, loco.vel, 1 / 72);
    s = w.progress(feet.x, feet.z, s).s; maxS = Math.max(maxS, s);
    const body = feet.clone().add(new THREE.Vector3(0, 1.3, 0));
    if (loco.grounded) grounds++;
    if (loco.attach) { const as = loco.attach.anchor.s; if ((s > as + 2 && loco.vel.y > 2.5) || s > as + 14 || t - attachedAt > 3.5) hub.webHeld[loco.attach.hand] = false; }
    if (!loco.attach && t - attachedAt > 0.3) {
      let best = null; const py = w.pointAt(s).y;
      for (const a of w.anchorsNear(body.x, body.z, 56)) {
        const d = a.p.distanceTo(body);
        if (a.s < s + 8 || a.s > s + 45 || d > 55 || d < 6 || a.low || loco.occluded(body, a.p, a.building)) continue;
        const score = (a.s - s) * 0.4 - Math.abs(d - 26) * 0.5 + Math.min(14, a.p.y - body.y) * 0.6 - Math.abs(body.y - py) * 0.3;
        if (!best || score > best.score) best = { a, score };
      }
      if (best) { const h = hand(); hub.webHeld[h] = true; if (loco.tryAttach({ hand: h, origin: body, dir: best.a.p.clone().sub(body).normalize() })) { attaches++; attachedAt = t; } }
    }
    { const ahead = w.pointAt(s + 25); app.camera.rotation.set(0, Math.atan2(-(ahead.x - feet.x), -(ahead.z - feet.z)), 0); app.camera.updateMatrixWorld(true); }
    loco.update(1 / 72, t);
  }
  return { maxS, attaches, falls, blocked, street, respawns, rebases, maxSpeed: loco.stats.maxSpeed, cells: w.live.size, grounds };
}

for (const map of MAPS) {
  test(`swing bot: ${map.id} — real swing physics keeps moving forward through the streamed modules`, () => {
    settings.swingSpeedLimit = 18;
    const r = swingBot(map, 100);
    if (process.env.WTRACE) console.log(map.id, JSON.stringify(r));
    assert.ok(r.maxS > 900, `${map.id}: progressed ${r.maxS.toFixed(0)} m (attaches ${r.attaches}, falls ${r.falls}, street ${r.street}, blocked ${r.blocked})`);
    assert.ok(r.street <= 3, `${map.id}: reached the floor ${r.street}×`);
    assert.ok(r.cells <= 14, `${map.id}: bounded active world (${r.cells} modules)`);
  });
}

test('coins: module coins are added once, collected ids never pay out again, recycled modules drop their coins', async () => {
  const { Coins } = await import('../src/game/coins.js');
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), player = new THREE.Group(); player.add(camera); scene.add(player);
  const hud = { n: 0, setCoins(n) { this.n = n; } };
  const app = { scene, camera, hud, fx: { boom() {} }, hub: { haptic() {} }, locomotion: { feet: (o) => o.set(player.position.x, player.position.y, player.position.z) } };
  const coins = new Coins(app);
  const w = new ChaseWorld(mapById('aurora'), { autoReady: true }); w.update(w.pointAt(0), { x: 0, y: 0, z: 0 }, 1 / 60, { force: true });
  coins.startWorld({});
  const cell = [...w.live.values()].find((c) => c.coins.length >= 3);
  coins.addCell(cell); coins.addCell(cell);
  assert.equal(coins.items.length, cell.coins.length, 'no duplicates when a cell is announced twice');
  // fly the chest through the first coin
  const c0 = cell.coins[0];
  player.position.set(c0.pos.x, c0.pos.y - 1.3, c0.pos.z - 3); coins.update(1 / 60, 0);
  player.position.set(c0.pos.x, c0.pos.y - 1.3, c0.pos.z); coins.update(1 / 60, 0.02);
  assert.ok(coins.count >= 1 && coins.collected.has(c0.id), 'collected');
  const n = coins.count;
  coins.removeCell(cell); assert.equal(coins.items.filter((i) => i.cell === cell.idx).length, 0, 'recycled → dropped');
  coins.addCell(cell); // (a module is never regenerated, but even if it were announced again…)
  player.position.set(c0.pos.x, c0.pos.y - 1.3, c0.pos.z); coins.update(1 / 60, 0.04); coins.update(1 / 60, 0.06);
  assert.ok(!coins.items.some((i) => i.id === c0.id), 'a collected coin is not re-added');
  assert.ok(coins.count >= n);
});
