// v0.20 modular Dala City: route generation, module seams, streaming / recycling rules, rebasing.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const THREE = await import('three');
const { CityWorld } = await import('../src/data/cityWorld.js');
const { RouteGen, STORY_TILE_COUNT, FACTORY_TILE, EXIT_TILE } = await import('../src/data/route.js');
const { STEP } = await import('../src/data/blocks.js');
const { CITY_CFG } = await import('../src/data/cityConfig.js');
const L = await import('../src/data/layout.js');

const ckey = (c) => c.join(',');
/** World + renderer stand-in: a cell becomes ready `delay` frames after it was added. */
function sim({ delay = 4, mode = 'story' } = {}) {
  const w = new CityWorld(); w.reset({ mode });
  const pend = []; w.on({ cellAdded: (c) => pend.push([c, delay]) });
  const tick = () => { for (let k = pend.length - 1; k >= 0; k--) if (--pend[k][1] <= 0) { w.markReady(pend[k][0]); pend.splice(k, 1); } };
  return { w, tick };
}
const chooseAll = (w, f) => { const pd = w.route.pending; if (pd && w.curTile >= pd.idx - 1) { const ex = pd.allowed || pd.exits; w.choose(ex[f % ex.length]); } };

test('story route: start + 5 straight blocks + right turn + factory block, then the factory exit', () => {
  const r = new RouteGen({ seed: CITY_CFG.seed, storySeed: CITY_CFG.storySeed });
  r.ensure(EXIT_TILE + 1);
  const kinds = r.tiles.slice(0, STORY_TILE_COUNT).map((t) => t.kind);
  assert.equal(STORY_TILE_COUNT, 8);
  assert.equal(kinds[0], 'start');
  assert.equal(kinds.slice(1, 6).filter((k) => k.startsWith('straight')).length, 5, kinds.join());
  assert.equal(kinds[6], 'turnR'); assert.equal(kinds[FACTORY_TILE], 'factory'); assert.equal(r.tiles[EXIT_TILE].kind, 'factoryExit');
  // the turn really is a right turn: heading N (0) → E (1)
  assert.equal(r.tiles[6].heading, 0); assert.equal(r.tiles[FACTORY_TILE].heading, 1);
  assert.ok(Math.abs(L.STORY_ROUTE.sTurn - 438) < 2 && L.STORY_ROUTE.turn[0] === 0, 'turn after 5 blocks');
});

test('module seams: each tile is one grid step after the previous exit; paths connect; turns point the right way', () => {
  const r = new RouteGen({ seed: CITY_CFG.seed, storySeed: CITY_CFG.storySeed });
  let f = 0; for (let n = 10; n < 600; n += 3) { if (!r.ensure(n)) { const p = r.pending; r.choose(p.idx, (p.allowed || p.exits)[f++ % (p.allowed || p.exits).length]); } }
  const seen = new Set();
  for (let k = 1; k < r.tiles.length; k++) {
    const a = r.tiles[k - 1], b = r.tiles[k];
    if (!a.exit) break;
    const st = STEP[a.exitHeading];
    assert.deepEqual(b.cell, [a.cell[0] + st[0], a.cell[1] + st[1]], `tile ${k} not adjacent to the exit of ${k - 1}`);
    assert.equal(b.heading, a.exitHeading, `tile ${k} heading`);
    const turn = (a.exitHeading - a.heading + 4) % 4;
    if (a.kind === 'turnR') assert.equal(turn, 1); else if (a.kind === 'turnL') assert.equal(turn, 3);
    else if (a.kind !== 'cross') assert.equal(turn, 0, `${a.kind} must go straight`);
    assert.notEqual(turn, 2, 'never reverses');
    assert.ok(!seen.has(ckey(a.cell)), `cell ${a.cell} used twice`); seen.add(ckey(a.cell));
  }
  // world paths: consecutive tile paths connect (gaps only at the start window / factory exit)
  const w = new CityWorld({ autoReady: true }); w.reset({ mode: 'endless' }); w.route.ensure(30); w._ensurePaths();
  for (let k = 1; k < w.paths.length; k++) {
    const a = w.paths[k - 1].pts.at(-1), b = w.paths[k].pts[0];
    const gap = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (w.paths[k].idx === EXIT_TILE) continue; // interior → street door exit
    assert.ok(gap < 0.01, `seam gap ${gap.toFixed(2)} m between tiles ${w.paths[k - 1].idx} / ${w.paths[k].idx}`);
  }
});

test('deterministic: same seed → same route, same buildings and anchors; crossroads choices stable', () => {
  const mk = () => { const w = new CityWorld({ autoReady: true }); w.reset({ mode: 'endless' }); w.route.ensure(40); w.update({ x: 6, y: 76, z: -10 }, undefined, 1 / 60, { force: true }); return w; };
  const a = mk(), b = mk();
  assert.deepEqual(a.route.tiles.map((t) => [t.kind, t.variant, ckey(t.cell), t.exit]), b.route.tiles.map((t) => [t.kind, t.variant, ckey(t.cell), t.exit]));
  const sig = (w) => [...w.cells.values()].map((c) => c.key + ':' + c.buildings.map((x) => x.h.toFixed(2)).join('/') + ':' + c.anchors.map((x) => x.id).join('/')).sort().join('|');
  assert.equal(sig(a), sig(b));
  const ca = a.route.candidates(a.route.tiles.length - 1, 3), cb = b.route.candidates(b.route.tiles.length - 1, 3);
  assert.deepEqual(ca.map((x) => x.tiles.map((t) => ckey(t.cell))), cb.map((x) => x.tiles.map((t) => ckey(t.cell))));
});

test('high speed (30 m/s, 4-frame build delay): never inside an empty or unbuilt block; objects stay bounded', () => {
  const { w, tick } = sim();
  const pos = new THREE.Vector3(6, 76, -10), vel = new THREE.Vector3();
  w.on({ rebased: (dx, dz) => { pos.x += dx; pos.z += dz; } });
  w.update(pos, vel, 1 / 60, { force: true }); for (let i = 0; i < 6; i++) tick();
  let s = 0, maxCells = 0, maxAnch = 0, bad = 0;
  for (let f = 0; f < 60 * 240; f++) {
    s += 30 / 60; const p = w.pointAt(s); pos.set(p.x, p.y, p.z); vel.set(30, 0, 0);
    if (f === 600) w.mode = 'endless'; // story → factory exit → endless city
    chooseAll(w, f);
    w.update(pos, vel, 1 / 60); tick();
    const c = w.cellAt(pos.x, pos.z); if (!c || !c.ready) bad++;
    maxCells = Math.max(maxCells, w.cells.size); maxAnch = Math.max(maxAnch, w.stats.anchors);
  }
  assert.equal(bad, 0, 'frames inside an empty block');
  assert.ok(s > 7000, 'ran ' + s);
  assert.ok(maxCells <= 64, `max cells ${maxCells} (pool ${CITY_CFG.pools.cells})`);
  assert.ok(maxAnch < 2500, `max anchors ${maxAnch}`);
  assert.ok(w.contentCache.size <= 700, 'content cache bounded');
  let cols = 0; for (const c of w.cells.values()) cols += c.colliders.length;
  assert.equal(w.cols.count, cols, 'spatial hash holds exactly the live colliders (no leaks)');
  assert.ok(w.stats.rebases > 0, 'origin rebased on the long run');
  assert.ok(Math.abs(pos.x) < CITY_CFG.rebaseDist + 80 && Math.abs(pos.z) < CITY_CFG.rebaseDist + 120, 'coordinates stay small');
});

test('speed cap: approaching an unbuilt block slows the player', () => {
  const { w } = sim({ delay: 1e9 });
  w.update({ x: 6, y: 76, z: -10 }, undefined, 1 / 60, { force: true });
  for (const c of w.cells.values()) if (c.tile && c.tile.idx <= 1) w.markReady(c);
  const p = w.pointAt(w.route.tiles[1].s1 - 10);
  w.update(p, { x: 0, y: 0, z: -20 });
  assert.ok(w.speedCapAt(p) <= 5, `cap ${w.speedCapAt(p)}`);
});

test('recycling rules: never the block in use / near / pinned / holding the attached anchor; cleanup on recycle', () => {
  const { w, tick } = sim({ delay: 1 }); w.reset({ mode: 'endless' });
  const pos = new THREE.Vector3(6, 76, -10);
  w.update(pos, undefined, 1 / 60, { force: true }); tick();
  const startCell = w.tileCell(0), a = startCell.anchors[0];
  w.setAttached(a); w.pin('event', 1);
  const removed = []; w.on({ cellRemoved: (c) => removed.push(c) });
  // look-back rule: whatever leaves, it is never within keepRadius of the player
  const nearViolations = []; w.on({ cellRemoved: (c) => { if (w.distToCell(c.i, c.j, pos.x, pos.z) < CITY_CFG.keepRadius) nearViolations.push(c.key); } });
  let s = 0;
  for (let f = 0; f < 60 * 25; f++) { s += 20 / 60; const p = w.pointAt(s); pos.set(p.x, p.y, p.z); chooseAll(w, f); w.update(pos, { x: 20, y: 0, z: 0 }); tick(); }
  assert.ok(w.distToCell(startCell.i, startCell.j, pos.x, pos.z) > 300, 'player far away');
  assert.ok(w.cells.get(startCell.key) === startCell && a.valid, 'attached anchor block kept');
  assert.ok(w.tileCell(1), 'pinned block kept');
  assert.deepEqual(nearViolations, [], 'a block near the player was recycled');
  assert.ok(removed.length > 0);
  w.setAttached(null); w.pin('event', null); w.update(pos, { x: 0, y: 0, z: 0 });
  assert.equal(w.cells.get(startCell.key), undefined, 'released block recycled');
  assert.equal(a.valid, false, 'its anchors invalidated');
  assert.equal(startCell.colliders.length + startCell.anchors.length, 0, 'colliders / anchors cleaned');
  assert.ok(!w.anchorsNear(a.p.x, a.p.z, 5).includes(a) && !w.collidersNear(a.p.x, a.p.z, 5).some((c) => c.cell === startCell), 'not queryable any more');
  assert.equal(w.anchorById(a.id), null);
});

test('anchors: only those of built (ready) blocks are selectable', () => {
  const { w } = sim({ delay: 1e9 });
  w.update({ x: 6, y: 76, z: -10 }, undefined, 1 / 60, { force: true });
  assert.equal(w.activeAnchors.length, 0);
  assert.equal(w.anchorsNear(0, -40, 80).length, 0);
  w.markReady(w.tileCell(0));
  assert.ok(w.anchorsNear(0, -40, 80).length > 0 && w.anchorsNear(0, -40, 80).every((x) => x.cell.ready && x.valid));
});

test('checkpoints: only on built, kept blocks; story checkpoints in order, one per tile', () => {
  const { w } = sim({ delay: 1e9 });
  w.update({ x: 6, y: 76, z: -10 }, undefined, 1 / 60, { force: true });
  assert.equal(w.checkpointFor(1), null, 'not built yet');
  w.markReady(w.tileCell(1));
  const cp = w.checkpointFor(1); assert.ok(cp && cp.tile === 1);
  assert.equal(w.checkpointFor(40), null, 'unloaded tile');
  const C = L.CHECKPOINTS; assert.ok(C.every((c, i) => i === 0 || (c.s > C[i - 1].s && c.tile === i)));
});

test('rebase: everything shifts together (colliders, anchors, paths, queries)', () => {
  const w = new CityWorld({ autoReady: true }); w.reset({ mode: 'endless' });
  w.update({ x: 6, y: 76, z: -10 }, undefined, 1 / 60, { force: true });
  const a = w.tileCell(1).anchors[3], ap = a.p.clone(), p100 = w.pointAt(100);
  let ev = null; w.on({ rebased: (dx, dz) => { ev = [dx, dz]; } });
  w.rebase(w.oi + 2, w.oj - 1);
  assert.deepEqual(ev, [-144, 72]);
  assert.ok(a.p.distanceTo(ap.clone().add(new THREE.Vector3(-144, 0, 72))) < 1e-9);
  assert.ok(w.anchorsNear(a.p.x, a.p.z, 2).includes(a), 'spatial hash rebuilt');
  assert.ok(w.pointAt(100).distanceTo(p100.clone().add(new THREE.Vector3(-144, 0, 72))) < 1e-9, 'route moved');
  const c = w.tileCell(1); assert.equal(w.cellAt(c.T.cx, c.T.cz), c, 'cell lookup consistent');
});

test('restart: reset() removes every block and clears pins / attached / hashes (no leftovers)', () => {
  const w = new CityWorld({ autoReady: true }); w.reset({ mode: 'endless' });
  w.update({ x: 6, y: 76, z: -10 }, undefined, 1 / 60, { force: true }); w.pin('boss', 3); w.setAttached(w.activeAnchors[0]);
  const live = w.cells.size; let removed = 0; w.on({ cellRemoved: () => removed++ });
  w.reset({ mode: 'story' });
  assert.equal(removed, live); assert.equal(w.cells.size, 0); assert.equal(w.cols.count, 0); assert.equal(w.anch.count, 0);
  assert.equal(w.pins.size, 0); assert.equal(w.attached, null); assert.equal(w.oi, 0); assert.equal(w.mode, 'story');
  assert.equal(w.route.tiles[0].kind, 'start');
});

test('story mode: streaming never builds beyond the factory exit', () => {
  const { w, tick } = sim({ delay: 1 });
  const pos = new THREE.Vector3();
  for (let s = 0; s < L.STORY_ROUTE.length; s += 2) { const p = w.pointAt(s); pos.set(p.x, p.y, p.z); w.update(pos, { x: 0, y: 0, z: -25 }); tick(); }
  for (const c of w.cells.values()) if (c.role === 'route') assert.ok(c.tile.idx <= EXIT_TILE + 1, `route tile ${c.tile.idx} built in story mode`);
  assert.ok(w.tileCell(FACTORY_TILE)?.buildings.some((b) => b.id === 'C'), 'factory block with C');
});
