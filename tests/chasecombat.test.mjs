// v0.41 World Chase combat: aim assist (cone, enlarged volume, hysteresis, behind / walls / range), shot intent vs
// swing anchors, swept collisions (no tunnelling), health (once per hit, damage protection), the run lifecycle
// (single resolution, timer excludes intro + pauses, frozen after the end), Light Bomb flights / blasts, and the
// locomotion freeze (mid-air and mid-swing: no drift, no gravity, no pull, no recovery; unfreeze restores gravity).
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const THREE = await import('three');
const { CHASE_COMBAT, selectTarget, shotIntent, sweptHit, segPointDist, Health, ChaseRun, formatChaseTime } = await import('../src/worlds/chaseCombat.js');
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const A = CHASE_COMBAT.aim;
const dirTo = (from, to) => to.clone().sub(from).normalize();
const rot = (dir, deg) => dir.clone().applyAxisAngle(V(0, 1, 0), (deg * Math.PI) / 180); // yaw offset

test('aim assist: slightly off-centre shots still pick the intended pumpkin (cone + enlarged volume, documented units)', () => {
  const o = V(0, 1.4, 0), p = V(0, 3, -20), fwd = dirTo(o, p);
  for (const deg of [0, 4, 8, 10]) {
    const r = selectTarget(o, rot(fwd, deg), [{ pos: p, key: 'a' }], A);
    assert.ok(r, `${deg}° off at 20 m → hit (allowed ${A.coneDeg}° + atan(${A.hitRadius} / 20) ≈ ${(A.coneDeg + Math.atan(A.hitRadius / 20) * 180 / Math.PI).toFixed(1)}°)`);
    assert.ok(Math.abs(r.angle - deg) < 0.05);
  }
  assert.equal(selectTarget(o, rot(fwd, 14), [{ pos: p, key: 'a' }], A), null, '14° off → miss');
  // near pumpkins get a wider angle (the enlarged volume), far ones the cone
  const near = V(0, 1.4, -4), r = selectTarget(o, rot(dirTo(o, near), 20), [{ pos: near, key: 'n' }], A);
  assert.ok(r, '4 m away: 20° off still inside (9° + atan(0.95 / 4) ≈ 22.4°)');
});

test('aim assist: ignores pumpkins behind the player / hand, beyond range, through walls; picks threats first', () => {
  const o = V(0, 1.4, 0), head = V(0, 1.6, 0), headFwd = V(0, 0, -1), chest = V(0, 1.3, 0);
  const behind = V(0, 1.5, 12); // behind the hand ray AND the head
  assert.equal(selectTarget(o, V(0, 0, -1), [{ pos: behind }], { ...A, head, headFwd }), null);
  assert.equal(selectTarget(o, V(0, 0, 1), [{ pos: behind }], { ...A, head, headFwd }), null, 'aiming backward at a pumpkin outside the view: ignored');
  assert.equal(selectTarget(o, V(0, 0, -1), [{ pos: V(0, 1.4, -55) }], A), null, 'beyond 40 m');
  const wall = (from, to) => to.z < -10; // anything past z = -10 is behind a wall
  assert.equal(selectTarget(o, V(0, 0, -1), [{ pos: V(0, 1.4, -20) }], { ...A, occluded: wall }), null, 'never through a building');
  // two pumpkins in the cone: the incoming one (time to impact < 1.2 s) beats a slightly better-centred idle one
  const idle = { pos: V(0.4, 1.4, -15), vel: V(0, 0, 0), key: 'idle' }, inc = { pos: V(-1.2, 1.4, -12), vel: V(0.9, 0, 14), key: 'inc' };
  const r = selectTarget(o, V(0, 0, -1), [idle, inc], { ...A, chest });
  assert.equal(r.cand.key, 'inc'); assert.ok(r.tti < A.imminent);
});

test('aim assist: hysteresis keeps the lock (no flicker between neighbours) until another is clearly better', () => {
  const o = V(0, 1.4, 0), a = { pos: V(-0.6, 1.4, -20), key: 'a' }, b = { pos: V(0.6, 1.4, -20), key: 'b' };
  let lock = null, flips = 0;
  for (let i = 0; i <= 40; i++) { // aim sweeps slowly from a towards b and back across the midpoint
    const x = Math.sin(i / 40 * Math.PI * 2) * 0.25;
    const r = selectTarget(o, dirTo(o, V(x, 1.4, -20)), [a, b], { ...A, lock });
    const k = r?.cand.key ?? null; if (lock && k !== lock) flips++; lock = k;
  }
  assert.ok(flips <= 1, `lock changed ${flips}× while hovering between two pumpkins`);
  // clearly aiming at the other one switches
  const r = selectTarget(o, dirTo(o, b.pos), [a, b], { ...A, lock: 'a' });
  assert.equal(r.cand.key, 'b');
  // a held lock survives a few degrees past the normal cone (sticky), then lets go
  const far = { pos: V(0, 1.4, -30), key: 'f' }, base = dirTo(o, far.pos), edge = A.coneDeg + Math.atan(A.hitRadius / 30) * 180 / Math.PI;
  assert.equal(selectTarget(o, rot(base, edge + 2), [far], A), null);
  assert.ok(selectTarget(o, rot(base, edge + 2), [far], { ...A, lock: 'f' })?.sticky);
  assert.equal(selectTarget(o, rot(base, edge + A.stickyDeg + 1), [far], { ...A, lock: 'f' }), null);
});

test('shot intent: anchors keep winning deliberate swing shots; threats and shown locks win combat shots', () => {
  const calm = { norm: 0.8, tti: Infinity, sticky: false }, threat = { norm: 0.9, tti: 0.6, sticky: false }, locked = { norm: 0.9, tti: Infinity, sticky: true };
  assert.equal(shotIntent(calm, 0.2), 'anchor', 'aim much closer to an anchor → swing');
  assert.equal(shotIntent(calm, 0.6), 'pumpkin');
  assert.equal(shotIntent(threat, 0.05), 'pumpkin', 'an imminent pumpkin always wins');
  assert.equal(shotIntent(locked, 0.05), 'pumpkin', 'the highlighted lock wins (highlight = shot)');
  assert.equal(shotIntent(null, 0.3), 'anchor'); assert.equal(shotIntent(null, null), null);
});

test('swept collision: fast bombs and a fast player never tunnel through each other', () => {
  // bomb moves 3 m in one frame straight through the chest (point test at either end would miss with 1.1 m radius)
  assert.ok(sweptHit(V(0, 0, -1.5), V(0, 0, 1.5), V(0, 0, 0), V(0, 0, 0), 1.1) >= 0);
  assert.equal(sweptHit(V(3, 0, -1.5), V(3, 0, 1.5), V(0, 0, 0), V(0, 0, 0), 1.1), -1);
  // both moving: player 20 m/s forward, bomb 15 m/s back, 1/10 s frame (crossing)
  const k = sweptHit(V(0, 1.3, -2), V(0, 1.3, -0.5), V(0, 1.3, 0), V(0, 1.3, -2), 0.9);
  assert.ok(k >= 0 && k <= 1, 'relative motion crossing is detected');
  assert.ok(Math.abs(segPointDist(V(0, 0, -1), V(0, 0, 1), V(0.5, 0, 0)).dist - 0.5) < 1e-9);
  // first-contact fraction is at the sphere surface
  const t = sweptHit(V(0, 0, -5), V(0, 0, 5), V(0, 0, 0), V(0, 0, 0), 1);
  assert.ok(Math.abs(t - 0.4) < 1e-6);
});

test('health: each hit id counts once, damage protection blocks stacked blasts, never below zero', () => {
  const h = new Health(100, 1.2);
  assert.equal(h.damage(20, 0, 'pk1'), 20);
  assert.equal(h.damage(20, 0.1, 'pk1'), 0, 'same bomb id → ignored');
  assert.equal(h.damage(20, 0.5, 'pk2'), 0, 'inside damage protection');
  assert.equal(h.damage(20, 1.3, 'pk3'), 20);
  for (let i = 0; i < 10; i++) h.damage(20, 3 + i * 2, `x${i}`);
  assert.equal(h.hp, 0); assert.ok(h.dead); assert.equal(h.damage(20, 99, 'late'), 0);
  const boss = new Health(CHASE_COMBAT.boss.hp, 0);
  assert.equal(boss.damage(16, 1, 'lb1'), 16); assert.equal(boss.damage(16, 1, 'lb1'), 0, 'contact + explosion of one Light Bomb = one hit');
  assert.equal(boss.damage(4, 1), 4, 'web strike (no id, no protection for the boss)');
});

test('run lifecycle: timer excludes intro + pauses, stops at the resolution, resolves exactly once', () => {
  const r = new ChaseRun(), step = (n, dt = 1 / 72) => { for (let i = 0; i < n; i++) r.tick(dt); };
  step(72 * 5); assert.equal(r.time, 0, 'intro / loading not counted'); assert.ok(r.running);
  r.start(); step(72 * 10);
  r.pause(); step(72 * 30); r.resume(); // 30 s paused
  step(72 * 2);
  assert.ok(Math.abs(r.time - 12) < 1e-6, `time ${r.time}`);
  assert.equal(r.resolve('victory', { coins: 7 }), true);
  assert.equal(r.resolve('defeat'), false, 'second resolution ignored');
  assert.equal(r.resolve('victory'), false);
  step(72 * 20); assert.ok(Math.abs(r.final.time - 12) < 1e-6 && Math.abs(r.time - 12) < 1e-6, 'final time fixed after the end');
  assert.ok(r.over); assert.equal(r.outcome, 'victory'); assert.equal(r.final.coins, 7);
  r.pause(); assert.equal(r.paused, false, 'cannot pause a resolved run');
  assert.equal(r.showResults(), true); assert.equal(r.showResults(), false, 'one results panel');
  r.reset(); assert.ok(r.running && r.time === 0 && !r.outcome, 'a new run starts clean');
  assert.equal(formatChaseTime(0), '00:00'); assert.equal(formatChaseTime(65.99), '01:05'); assert.equal(formatChaseTime(3600 + 62), '1:01:02');
});

// ---------------------------------------------------------------------------------------------- locomotion freeze
const { mapById } = await import('../src/worlds/maps.js');
const { ChaseWorld } = await import('../src/worlds/chaseWorld.js');
const { Locomotion } = await import('../src/game/locomotion.js');
const { fakeApp } = await import('./route.test.mjs');

function airborneSetup(mapId) {
  const w = new ChaseWorld(mapById(mapId), { autoReady: true, seed: 11 });
  w.update(w.pointAt(0), { x: 0, y: 0, z: 0 }, 1 / 60, { force: true });
  const app = fakeApp(w), loco = new Locomotion(app); loco.world = w; loco.setCityMode([]);
  const p = w.pointAt(60); loco.placeAt(V(p.x, p.y - 3, p.z)); loco.grounded = false; loco.vel.set(4, -9, -16); // falling fast mid-route
  return { w, app, loco };
}
for (const mapId of ['molten', 'redrock', 'foldscape']) {
  test(`freeze: ${mapId} — mid-air at speed the rig stays exactly put (no gravity, drift, recovery or fall callback)`, () => {
    const { w, loco } = airborneSetup(mapId);
    let callbacks = 0; loco.onFall = loco.onStreet = loco.onOutOfBounds = () => { callbacks++; return true; };
    for (let i = 0; i < 10; i++) loco.update(1 / 72, i / 72); // moving
    const before = loco.rig.position.clone();
    assert.ok(loco.vel.length() > 5, 'was moving fast');
    loco.freeze();
    for (let i = 0; i < 72 * 8; i++) { loco.update(1 / 72, 1 + i / 72); w.update(loco.feet(), loco.vel, 1 / 72); }
    assert.ok(loco.rig.position.distanceTo(before) < 1e-9, `moved ${loco.rig.position.distanceTo(before)} m`);
    assert.equal(loco.vel.length(), 0); assert.equal(callbacks, 0, 'no fall / hazard / recovery while frozen');
    assert.equal(loco.vignette.visible, false);
    // the next run: gravity is back
    loco.unfreeze(); const y0 = loco.rig.position.y;
    for (let i = 0; i < 36; i++) loco.update(1 / 72, 10 + i / 72);
    assert.ok(loco.rig.position.y < y0 - 0.5, 'falls again after unfreeze');
  });
}

test('freeze: while swinging on a web (and with a pulling tether) — rope released, no pull afterwards', () => {
  const { w, loco, app } = airborneSetup('neon');
  const chest = loco.feet(V(0, 0, 0)).add(V(0, 1.3, 0));
  const a = [...w.live.values()].flatMap((c) => c.anchors || []).filter((x) => x.valid && x.p.distanceTo(chest) < 40 && x.p.y > chest.y)[0]
    || { id: 'T', p: chest.clone().add(V(4, 8, -10)), valid: true, building: null, cell: null };
  app.hub.aim.right = { origin: chest.clone(), dir: a.p.clone().sub(chest).normalize(), valid: true };
  assert.ok(loco.attachTo({ ...a, moving: true }, { hand: 'right', origin: chest.clone(), dir: app.hub.aim.right.dir }), 'attached');
  for (let i = 0; i < 20; i++) loco.update(1 / 72, i / 72);
  assert.ok(loco.ropes.length === 1);
  const before = loco.rig.position.clone();
  loco.freeze();
  assert.equal(loco.ropes.length, 0, 'web released when the run ends');
  loco.vel.set(0, 30, 0); // e.g. a late tether pull — must not move a frozen rig
  for (let i = 0; i < 72 * 3; i++) loco.update(1 / 72, 2 + i / 72);
  assert.ok(loco.rig.position.distanceTo(before) < 1e-9);
});
