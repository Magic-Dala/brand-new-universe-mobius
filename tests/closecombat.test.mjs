// v0.46 Task 4: the punch rows of the boss fight (a fly-in hit / body contact = src 'punch'), its own 0.5 s limiter, and the
// v0.46 data (FEEL.warp.punch, FEEL.flow.gains.punch). Existing rows stay exactly as they were.
import test from 'node:test';
import assert from 'node:assert/strict';
const { BossFight, FIGHT } = await import('../src/worlds/bossFight.js');
const { FEEL } = await import('../src/data/feel.js');

const step = (f, s) => f.update(s, { fair: false, dist: 30, flying: 0, heavyOk: false, bossHpFrac: 1 });

test('FIGHT: the punch rows and limiter (added keys)', () => {
  assert.deepEqual(FIGHT.dmg.protected.punch, { hp: 0.5, st: 14 });
  assert.deepEqual(FIGHT.dmg.staggered.punch, { hp: 10 });
  assert.equal(FIGHT.punchInterval, 0.5);
});
test('FIGHT: existing rows unchanged', () => {
  assert.deepEqual(FIGHT.dmg.protected.web, { hp: 0.1, st: 4 }); assert.deepEqual(FIGHT.dmg.protected.lightBomb, { hp: 0.5, st: 12 });
  assert.deepEqual(FIGHT.dmg.protected.tether, { hp: 0.5, st: 14 }); assert.deepEqual(FIGHT.dmg.protected.fan, { hp: 0, st: 3 });
  assert.deepEqual(FIGHT.dmg.staggered.web, { hp: 4 }); assert.deepEqual(FIGHT.dmg.staggered.tether, { hp: 6 }); assert.deepEqual(FIGHT.dmg.staggered.lightBomb, { hp: 12 });
  assert.deepEqual(FIGHT.webInterval, { protected: 0.6, staggered: 0.45 }); assert.deepEqual(FIGHT.openingCap, { counter: 30, break: 10 });
  assert.deepEqual(FIGHT.stagger, { counter: 6.0, break: 3.0 }); assert.equal(FIGHT.shield.max, 60);
});
test('FEEL: punch warp and Flow gain', () => {
  assert.deepEqual(FEEL.warp.punch, { scale: 0.1, hold: 0.15, ease: 0.3 }); // (v0.49: was 0.5 / 0.08 / 0.12)
  assert.equal(FEEL.flow.gains.punch, 2);
  assert.deepEqual(FEEL.warp.counter, { scale: 0.25, hold: 0.25, ease: 0.20 }); assert.equal(FEEL.flow.gains.counter, 3);
});
test('protected punch: 0.5 hp, 14 stability', () => {
  const f = new BossFight(); const r = f.hit('punch', 'body');
  assert.deepEqual([r.hp, r.st, r.kind], [0.5, 14, 'shield']); assert.equal(f.stability, 46);
});
test('five punches 0.6 s apart break a full shield → staggered (break)', () => {
  const f = new BossFight(); const kinds = [];
  for (let i = 0; i < 5; i++) { kinds.push(f.hit('punch', 'body').kind); step(f, 0.6); }
  assert.deepEqual(kinds, ['shield', 'shield', 'shield', 'shield', 'break']); assert.equal(f.state, 'staggered'); assert.equal(f.staggerCause, 'break');
});
test('staggered punch: 10 hp; the break cap (10) ends the stagger, the counter cap (30) takes three', () => {
  const f = new BossFight(); f.forceStagger('break'); const r = f.hit('punch', 'body');
  assert.deepEqual([r.hp, r.kind], [10, 'capped']); assert.equal(f.state, 'recovering');
  const g = new BossFight(); g.forceStagger('counter'); const hs = [];
  for (let i = 0; i < 4; i++) { const q = g.hit('punch', 'body'); hs.push([q.hp, q.kind]); step(g, 0.5); }
  assert.deepEqual(hs.slice(0, 3), [[10, 'weak'], [10, 'weak'], [10, 'capped']]); assert.equal(g.openingDamage, 30);
});
test('the opening cap is respected with earlier damage (web 4 + punch capped at the rest)', () => {
  const f = new BossFight(); f.forceStagger('break'); f.hit('web', 'body'); step(f, 0.5); const r = f.hit('punch', 'body');
  assert.equal(r.hp, 6); assert.equal(r.kind, 'capped');
});
test('punch limiter: 0.5 s, independent of the web limiter', () => {
  const f = new BossFight(); f.forceStagger('counter');
  assert.equal(f.hit('punch').hp, 10); step(f, 0.4);
  const r = f.hit('punch'); assert.equal(r.kind, 'blocked'); assert.equal(r.limited, true); assert.equal(r.hp, 0);
  assert.equal(f.hit('web').hp, 4); // (a web right after a punch: its own limiter)
  step(f, 0.1); assert.equal(f.hit('punch').hp, 10);
  const g = new BossFight(); g.forceStagger('counter'); g.hit('web'); assert.equal(g.hit('punch').hp, 10); // (and the other way round)
});
test('recovering / vent: a punch follows the existing rule (blocked, half hp, no shield progress)', () => {
  const f = new BossFight(); f.forceStagger('counter'); step(f, 6.1); assert.equal(f.state, 'recovering');
  const r = f.hit('punch'); assert.deepEqual([r.hp, r.st, r.kind], [0.25, 0, 'blocked']);
  const g = new BossFight(); g.fightT = 20; g.forceAttack('heavy'); step(g, FIGHT.telegraph.heavy + 0.01); assert.equal(g.state, 'vent');
  const q = g.hit('punch', 'body'); assert.deepEqual([q.hp, q.st, q.kind], [0.25, 0, 'blocked']);
});
