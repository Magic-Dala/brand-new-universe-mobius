// v0.47 Story chase: the pure pressure / stall / break-away / tier state machine (src/game/stumble.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Stumble } from '../src/game/stumble.js';
import { STORY_CHASE } from '../src/data/storyChase.js';
import { mulberry32 } from '../src/data/box.js';

const P = STORY_CHASE.pressure, S = STORY_CHASE.stall;
const types = (ev) => ev.map((e) => e.type);
/** n pumpkin gains (not rate limited). */
const fill = (st, n) => { for (let i = 0; i < n; i++) st.gain('pumpkin', 0); };
const stalled = () => { const st = new Stumble(); fill(st, P.threshold); st.drain(); return st; };

test('STORY_CHASE: the numbers of the goal brief (threshold and the three stall times / speeds as tuned in stage S6)', () => {
  assert.deepEqual(STORY_CHASE.pressure, { web: 1, pumpkin: 1, lightBomb: 3, webInterval: 0.6, threshold: 6, decayDelay: 3, decayRate: 0.5, playerHit: -2 }); // (brief: threshold 8)
  assert.deepEqual(STORY_CHASE.stall, { time: 6, speedCap: 3, lockout: 5, ringRange: 15 }); // (brief: time 4, speedCap 8, lockout 6)
  assert.equal(S.ringRange, 15); assert.equal(STORY_CHASE.pacing.minGap, 14); assert.equal(STORY_CHASE.pacing.noPass, 1.5);
  assert.equal(STORY_CHASE.tiers.max, 3); assert.equal(STORY_CHASE.coinBurst, 8); assert.equal(STORY_CHASE.endless.startTier, 2); assert.equal(STORY_CHASE.summaryTime, 5);
  assert.deepEqual(STORY_CHASE.noThrow, { nearTurn: 45, beforeRoof: 25 }); assert.deepEqual(STORY_CHASE.player, { speedLoss: 0.4, push: 3 });
});

test('gains: web 1, pumpkin 1, Light Bomb 3; an unknown kind does nothing', () => {
  const st = new Stumble();
  assert.equal(st.state, 'chasing'); assert.equal(st.pressure, 0); assert.equal(st.frac, 0);
  assert.equal(st.gain('web', 0), true); assert.equal(st.pressure, 1);
  assert.equal(st.gain('pumpkin', 0), true); assert.equal(st.pressure, 2);
  assert.equal(st.gain('lightBomb', 0), true); assert.equal(st.pressure, 5);
  assert.equal(st.gain('fan', 0), false); assert.equal(st.gain(undefined, 0), false); assert.equal(st.pressure, 5);
  assert.equal(st.frac, 5 / P.threshold);
});

test('web strikes: at most one per 0.6 s; pumpkins and Light Bombs are not limited', () => {
  const st = new Stumble();
  assert.equal(st.gain('web', 0), true);
  assert.equal(st.gain('web', 0.59), false);
  assert.equal(st.gain('pumpkin', 0.59), true); assert.equal(st.gain('pumpkin', 0.59), true);
  assert.equal(st.gain('web', 0.6), true);
  assert.equal(st.pressure, 4);
});

test('web strikes without a time use the machine\'s own clock', () => {
  const st = new Stumble();
  assert.equal(st.gain('web'), true); assert.equal(st.gain('web'), false);
  st.update(0.3); assert.equal(st.gain('web'), false);
  st.update(0.31); assert.equal(st.gain('web'), true);
});

test('threshold: the 8th point stalls him, once', () => {
  const st = new Stumble(); fill(st, P.threshold - 1);
  assert.equal(st.state, 'chasing'); assert.deepEqual(st.drain(), []);
  assert.equal(st.gain('pumpkin', 0), true);
  assert.equal(st.state, 'stalled'); assert.equal(st.frac, 1); assert.equal(st.stalls, 1);
  assert.deepEqual(st.drain().map((e) => [e.type, e.cause]), [['stall', 'pressure']]);
  assert.equal(st.gain('pumpkin', 0), false, 'no gain while stalled');
  assert.deepEqual(st.drain(), []);
});

test('a Light Bomb that overshoots the threshold still stalls and pressure never exceeds it', () => {
  const st = new Stumble(); fill(st, 6); st.gain('lightBomb', 0);
  assert.equal(st.state, 'stalled'); assert.ok(st.pressure <= P.threshold);
});

test('decay: 0.5 / s after 3 s without a gain; a gain restarts the delay; never below 0', () => {
  const st = new Stumble(); fill(st, 4);
  st.update(3); assert.equal(st.pressure, 4);
  st.update(2); assert.equal(st.pressure, 3);
  st.gain('pumpkin', 0); assert.equal(st.pressure, 4);
  st.update(2.9); assert.equal(st.pressure, 4, 'the delay started again');
  st.update(0.1 + 1); assert.ok(Math.abs(st.pressure - 3.5) < 1e-9);
  st.update(100); assert.equal(st.pressure, 0);
  assert.equal(st.state, 'chasing');
});

test('decay only counts the part of a step past the delay', () => {
  const st = new Stumble(); fill(st, 4);
  st.update(4); assert.ok(Math.abs(st.pressure - 3.5) < 1e-9);
});

test('a stall lasts 4 s, then he breaks away with no punch and no reward', () => {
  const st = stalled();
  st.update(S.time - 0.01); assert.equal(st.state, 'stalled');
  st.update(0.02);
  assert.equal(st.state, 'lockout'); assert.equal(st.pressure, 0); assert.equal(st.punches, 0);
  assert.deepEqual(types(st.drain()), ['recover']);
});

test('punch: only while stalled; lockout, punches + 1', () => {
  const st = new Stumble();
  assert.equal(st.punch(), false, 'chasing');
  fill(st, P.threshold); st.drain();
  assert.equal(st.punch(), true);
  assert.equal(st.state, 'lockout'); assert.equal(st.punches, 1); assert.equal(st.pressure, 0);
  assert.deepEqual(st.drain(), [{ type: 'punch', punches: 1 }]);
  assert.equal(st.punch(), false, 'lockout'); assert.equal(st.punches, 1);
});

test('break-away: no pressure for 6 s, then chasing again', () => {
  const st = stalled(); st.punch(); st.drain();
  assert.equal(st.gain('pumpkin', 0), false); assert.equal(st.gain('lightBomb', 0), false); assert.equal(st.gain('web', 10), false);
  st.update(S.lockout - 0.01); assert.equal(st.state, 'lockout'); assert.equal(st.pressure, 0);
  st.update(0.02); assert.equal(st.state, 'chasing');
  assert.deepEqual(types(st.drain()), ['lockoutEnd']);
  assert.equal(st.gain('pumpkin', 0), true); assert.equal(st.pressure, 1);
});

test('a second stall can follow the first', () => {
  const st = stalled(); st.punch(); st.update(S.lockout + 0.1); st.drain();
  fill(st, P.threshold);
  assert.equal(st.state, 'stalled'); assert.equal(st.stalls, 2); assert.equal(st.punch(), true); assert.equal(st.punches, 2);
});

test('counter: a countered heavy pumpkin stalls him at once, only while chasing', () => {
  const st = new Stumble(); st.gain('pumpkin', 0);
  assert.equal(st.counter(), true);
  assert.equal(st.state, 'stalled'); assert.equal(st.frac, 1);
  assert.deepEqual(st.drain().map((e) => [e.type, e.cause]), [['stall', 'counter']]);
  assert.equal(st.counter(), false, 'already stalled');
  st.punch(); assert.equal(st.counter(), false, 'lockout');
});

test('tier: the higher of the segment tier and base + punches, at most 3', () => {
  const st = new Stumble();
  assert.equal(st.tier(1), 1); assert.equal(st.tier(2), 2); assert.equal(st.tier(3), 3); assert.equal(st.tier(7), 3);
  for (const want of [2, 3, 3]) { fill(st, P.threshold); st.punch(); st.update(S.lockout + 0.1); assert.equal(st.tier(1), want); }
  st.reset({ tier: 2 }); // the chase after the factory
  assert.equal(st.punches, 0); assert.equal(st.tier(1), 2); assert.equal(st.tier(2), 2);
  fill(st, P.threshold); st.punch();
  assert.equal(st.tier(2), 3);
  st.reset(); assert.equal(st.tier(1), 1);
});

test('player hit: pressure minus 2, never below 0, and never touches a stall', () => {
  const st = new Stumble(); fill(st, 5);
  st.playerHit(); assert.equal(st.pressure, 3);
  st.playerHit(); st.playerHit(); assert.equal(st.pressure, 0);
  st.playerHit(); assert.equal(st.pressure, 0);
  const s2 = stalled(); s2.playerHit(); assert.equal(s2.state, 'stalled'); assert.equal(s2.frac, 1);
});

test('cancel (respawn, the roof): chasing, pressure 0, nothing queued; punches stay', () => {
  const st = stalled(); st.punch(); st.update(S.lockout + 0.1); fill(st, P.threshold);
  assert.equal(st.cancel(), true);
  assert.equal(st.state, 'chasing'); assert.equal(st.pressure, 0); assert.equal(st.punches, 1);
  assert.deepEqual(st.drain(), []);
  const s2 = stalled(); s2.punch(); assert.equal(s2.cancel(), true); assert.equal(s2.state, 'chasing');
  const s3 = new Stumble(); assert.equal(s3.cancel(), false); s3.gain('pumpkin', 0); assert.equal(s3.cancel(), true); assert.equal(s3.pressure, 0);
  s3.update(0); assert.equal(s3.gain('pumpkin', 0), true, 'no lockout after a cancel');
});

test('drain returns each event once', () => {
  const st = stalled(); st.punch();
  assert.equal(st.drain().length, 1); assert.equal(st.drain().length, 0);
});

test('update(0) (paused) changes nothing', () => {
  const st = stalled(); for (let i = 0; i < 1000; i++) st.update(0);
  assert.equal(st.state, 'stalled');
});

test('no defeated state: random use never leaves the three states', () => {
  const rnd = mulberry32(47), st = new Stumble(), seen = new Set();
  const ops = [() => st.gain('web', rnd() * 100), () => st.gain('pumpkin'), () => st.gain('lightBomb'), () => st.playerHit(), () => st.counter(), () => st.punch(), () => st.cancel(), () => st.update(rnd() * 3), () => st.drain(), () => st.tier(1 + Math.floor(rnd() * 3)), () => st.reset({ tier: 1 + Math.floor(rnd() * 2) })];
  for (let i = 0; i < 5000; i++) {
    ops[Math.floor(rnd() * ops.length)]();
    seen.add(st.state);
    assert.ok(['chasing', 'stalled', 'lockout'].includes(st.state));
    assert.ok(st.pressure >= 0 && st.pressure <= P.threshold && st.frac >= 0 && st.frac <= 1);
    assert.ok(st.tier(1) >= 1 && st.tier(1) <= 3);
  }
  assert.deepEqual([...seen].sort(), ['chasing', 'lockout', 'stalled']);
  for (const k of Object.getOwnPropertyNames(Stumble.prototype)) assert.ok(!/defeat|dead|kill|hp/i.test(k), k);
});

// ---- v0.49: he turns to face the player when the red ring comes on
test('face: true once per stall, the first time the ring is on; false while chasing or with the ring off', () => {
  const st = new Stumble(); assert.equal(st.face(true), false); assert.equal(st.faced, false);
  fill(st, P.threshold); st.drain();
  assert.equal(st.face(false), false); assert.equal(st.faced, false);
  assert.equal(st.face(true), true); assert.equal(st.faced, true);
  assert.equal(st.face(true), false); assert.equal(st.face(false), false); assert.equal(st.faced, true); // he stays turned for the rest of the stall
});
test('face: the next stall turns him again; a punch, a timeout, a cancel and a reset all clear it', () => {
  let st = stalled(); st.face(true); st.punch(); assert.equal(st.faced, false); assert.equal(st.face(true), false);
  st = stalled(); st.face(true); st.update(S.time + 0.01); assert.equal(st.faced, false);
  st.update(S.lockout + 0.01); fill(st, P.threshold); assert.equal(st.face(true), true);
  st = stalled(); st.face(true); st.cancel(); assert.equal(st.faced, false);
  st = stalled(); st.face(true); st.reset(); assert.equal(st.faced, false);
});
