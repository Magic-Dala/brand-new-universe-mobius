// v0.21 story chase combat: thrown pumpkin bombs (aim once, limited lead, pool caps), swept dash contact.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const THREE = await import('three');
const { ChaseBombs, bombAimPoint, launchVelocity, flightTimeFor } = await import('../src/game/chaseBombs.js');
const { segPointDist } = await import('../src/game/chase.js');
const { STORY_COMBAT } = await import('../src/data/storyCombat.js');
const BB = STORY_COMBAT.bombs;

function fake() {
  const scene = new THREE.Scene();
  const fxLog = { boom: 0, web: 0, net: 0 };
  const app = { scene, cityWorld: null, flashes: 0, flashDamage() { this.flashes++; }, hub: { haptic() {} }, fx: { boom: () => fxLog.boom++, web: () => fxLog.web++, net: () => fxLog.net++ } };
  const pos = new THREE.Vector3(0, 60, -40);
  const boss = { root: { position: pos }, throwPoint: (out) => out.copy(pos).add(new THREE.Vector3(0.3, 1.2, 0)), throws: 0, throw() { this.throws++; } };
  return { app, boss, fxLog, bombs: new ChaseBombs(app) };
}

test('aim: limited prediction (≤ maxLead), ballistic launch reaches the aim point after T, flight time clamped', () => {
  const chest = new THREE.Vector3(0, 50, 0);
  const p = bombAimPoint(chest, new THREE.Vector3(30, 0, 0), 2, BB);
  assert.ok(p.distanceTo(chest) <= BB.maxLead + 1e-9, 'lead capped');
  const from = new THREE.Vector3(0, 60, -40), T = 1.7, g = BB.gravity, v = launchVelocity(from, p, T, g);
  const at = from.clone().addScaledVector(v, T).add(new THREE.Vector3(0, -0.5 * g * T * T, 0));
  assert.ok(at.distanceTo(p) < 1e-9, 'hits the aim point');
  assert.equal(flightTimeFor(1), BB.flightTime[0]); assert.equal(flightTimeFor(1e4), BB.flightTime[1]);
});

test('bombs: windup tell, then thrown; a standing player is hit; a player swinging sideways avoids it (no homing)', () => {
  for (const [vx, expectHit] of [[0, true], [16, false]]) {
    const { app, boss, bombs } = fake();
    bombs.reset(7); bombs.timer = 0;
    const chest = new THREE.Vector3(0, 52, 0), vel = new THREE.Vector3(0, 0, 0);
    let held = 0, launchedVel = null;
    for (let i = 0; i < 60 * 8 && bombs.stats.exploded + bombs.stats.fizzled === 0; i++) {
      if (vx && bombs.stats.thrown) { vel.set(vx, 0, 0); chest.x += vx / 60; } // dodge after the release
      bombs.update(1 / 60, { allow: bombs.stats.thrown === 0, boss, chest, playerVel: vel });
      if (bombs.windup) held++;
      const f = bombs.flying[0]; if (f && !launchedVel) launchedVel = f.vel.clone();
      if (f) assert.ok(Math.abs(f.vel.x - launchedVel.x) < 1e-9 && Math.abs(f.vel.z - launchedVel.z) < 1e-9, 'never steers toward the player');
    }
    assert.ok(held >= Math.round(BB.windup * 60) - 1, `wind-up shown ${held} frames`);
    assert.equal(boss.throws, 1); assert.equal(bombs.stats.thrown, 1);
    assert.equal(bombs.stats.hits > 0, expectHit, `vx=${vx}: hits ${bombs.stats.hits}`);
    assert.equal(app.flashes > 0, expectHit, 'damage feedback = arcade flash');
    assert.equal(bombs.activeCount, 0, 'recycled after exploding');
  }
});

test('bombs: at most maxActive alive; no new throws while paused (turn / tether / roof); flying bombs finish', () => {
  const { boss, bombs } = fake();
  bombs.reset(3); bombs.timer = 0;
  const chest = new THREE.Vector3(0, 52, 0), vel = new THREE.Vector3(0, 0, -6);
  let max = 0;
  for (let i = 0; i < 60 * 60; i++) { chest.z = Math.sin(i / 90) * 10; bombs.update(1 / 60, { allow: true, boss, chest, playerVel: vel }); max = Math.max(max, bombs.activeCount); }
  assert.ok(max <= BB.maxActive, `max alive ${max}`);
  assert.ok(bombs.stats.thrown >= 8, `thrown ${bombs.stats.thrown}`);
  assert.ok(bombs.items.length <= BB.maxActive + 1, 'pool bounded');
  const before = bombs.stats.thrown;
  for (let i = 0; i < 60 * 30; i++) bombs.update(1 / 60, { allow: false, boss, chest, playerVel: vel });
  assert.equal(bombs.stats.thrown, before, 'paused: no new throws');
  assert.equal(bombs.activeCount, 0, 'everything already in the air resolved');
});

test('bombs: a wrist web destroys the flying bomb it is aimed at; out-of-range bombs are recycled', () => {
  const { boss, bombs, fxLog } = fake();
  bombs.reset(5); bombs.timer = 0;
  const chest = new THREE.Vector3(0, 52, 0), vel = new THREE.Vector3();
  while (!bombs.flying.length) bombs.update(1 / 60, { allow: true, boss, chest, playerVel: vel });
  for (let i = 0; i < 20; i++) bombs.update(1 / 60, { allow: false, boss, chest, playerVel: vel });
  const b = bombs.flying[0], origin = chest.clone();
  assert.equal(bombs.tryShoot({ origin, dir: new THREE.Vector3(1, 0, 0) }), null, 'aimed away: miss');
  assert.ok(bombs.tryShoot({ origin, dir: b.pos.clone().sub(origin).normalize() }), 'aimed: destroyed');
  assert.equal(bombs.stats.destroyed, 1); assert.equal(bombs.activeCount, 0); assert.ok(fxLog.boom > 0);
  // far away → recycled silently
  bombs.timer = 0; while (!bombs.flying.length) bombs.update(1 / 60, { allow: true, boss, chest, playerVel: vel });
  bombs.update(1 / 60, { allow: false, boss, chest: chest.clone().set(0, 52, 500), playerVel: vel });
  assert.equal(bombs.stats.recycled, 1);
});

test('dash contact is swept: a fast step that passes THROUGH the contact sphere still counts', () => {
  const c = new THREE.Vector3(0, 10, 0);
  const a = new THREE.Vector3(0, 10, 5), b = new THREE.Vector3(0, 10, -5); // 10 m step, both ends far outside r 1.5
  assert.ok(a.distanceTo(c) > 1.5 && b.distanceTo(c) > 1.5);
  assert.ok(segPointDist(a, b, c) < 1e-9);
  assert.ok(segPointDist(a, new THREE.Vector3(4, 10, 5), c) > 1.5, 'a step beside him does not');
});
