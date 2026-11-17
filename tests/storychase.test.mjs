// v0.47 Story chase: the throw scheduler and the pacing / fairness helpers (src/game/storyAttacks.js), pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentTier, throwWindow, pacedSpeed, holdS, hitVelocity, StoryAttacks } from '../src/game/storyAttacks.js';
import { STORY_CHASE } from '../src/data/storyChase.js';
import { STORY_ROUTE } from '../src/data/layout.js';
import { FIGHT } from '../src/worlds/bossFight.js';

const DT = 1 / 60;
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

test('segmentTier: tier 1 on the first two tiles, 2 from the third, 3 once the turn is passed', () => {
  assert.equal(segmentTier({ tile: 0, afterTurn: false }), 1);
  assert.equal(segmentTier({ tile: 1, afterTurn: false }), 1);
  for (const tile of [2, 3, 4, 5, 6]) assert.equal(segmentTier({ tile, afterTurn: false }), 2, `tile ${tile}`);
  assert.equal(segmentTier({ tile: 6, afterTurn: true }), 3);
  assert.equal(segmentTier({ tile: 0, afterTurn: true }), 3);
});

test('throwWindow: nothing within 45 m of the turn or in the last 25 m before the roof (real route numbers)', () => {
  const R = { sTurn: STORY_ROUTE.sTurn, length: STORY_ROUTE.length };
  assert.ok(Math.abs(R.sTurn - 438.07) < 0.01 && Math.abs(R.length - 527.68) < 0.01, 'the route this was written against');
  assert.equal(throwWindow({ playerS: 300, bossS: 330, ...R }), true);
  assert.equal(throwWindow({ playerS: 392, bossS: 420, ...R }), true);
  assert.equal(throwWindow({ playerS: 400, bossS: 430, ...R }), false, 'before the turn');
  assert.equal(throwWindow({ playerS: 483, bossS: 500, ...R }), false, 'just past the turn');
  assert.equal(throwWindow({ playerS: 484, bossS: 500, ...R }), true);
  assert.equal(throwWindow({ playerS: 484, bossS: 503, ...R }), false, 'he is within 25 m of the roof');
});

test('pacedSpeed: a stall caps him, the floor matches a faster player, a break-away adds the boost', () => {
  assert.equal(pacedSpeed({ base: 18, gap: 10, playerSpeed: 20, state: 'stalled' }), STORY_CHASE.stall.speedCap);
  assert.equal(pacedSpeed({ base: 1, gap: 40, playerSpeed: 20, state: 'stalled' }), 1, 'a stall never speeds him up');
  assert.ok(pacedSpeed({ base: 18, gap: 10, playerSpeed: 20, state: 'chasing' }) >= 28);
  assert.equal(pacedSpeed({ base: 12, gap: 20, playerSpeed: 30, state: 'chasing' }), 12, 'above the floor: the v0.46 speed');
  assert.equal(pacedSpeed({ base: 18, gap: 13.99, playerSpeed: 2, state: 'chasing' }), 18, 'never slower than the v0.46 speed');
  assert.ok(pacedSpeed({ base: 12, gap: 20, playerSpeed: 15, state: 'lockout', boost: 6 }) >= 21);
  assert.equal(pacedSpeed({ base: 0, gap: 60, playerSpeed: 15, state: 'lockout', boost: 0 }), 0, 'he has his lead back: no more boost');
});

test('pacing floor: a 22 m/s player never gets inside 13.5 m outside a stall', () => {
  let bossS = 14, playerS = 0, v = 12, min = Infinity;
  for (let i = 0; i < 20 * 60; i++) {
    playerS += 22 * DT;
    const gap = bossS - playerS, base = gap < 14 ? 18 : gap < 30 ? 12 : gap < 46 ? 5 : 0; // the v0.46 pacing table
    const want = pacedSpeed({ base, gap, playerSpeed: 22, state: 'chasing' });
    v = want > v ? want : v + (want - v) * Math.min(1, DT * 2.5); // raises apply at once, drops are smoothed (chase.js)
    bossS += v * DT; min = Math.min(min, bossS - playerS);
  }
  assert.ok(min >= 13.5, `min gap ${min.toFixed(2)}`);
});

test('holdS: the 1.5 m last resort; never past the limit, never back', () => {
  assert.ok(near(holdS(100.5, 100), 101.5));
  assert.ok(near(holdS(70, 100), 101.5), 'the player is past him');
  assert.equal(holdS(105, 100), 105, 'far enough: untouched');
  assert.equal(holdS(100.5, 100, 101), 101, 'the limit wins');
  assert.equal(holdS(100.5, 100, 90), 100.5, 'never back');
});

test('hitVelocity: 40 % of horizontal speed lost, 3 m/s away from the blast, never downward', () => {
  const a = hitVelocity({ x: 10, y: -3, z: 0 }, { x: 0, y: 0, z: 1 });
  assert.ok(near(a.x, 6) && near(a.z, 3) && near(a.y, -3), JSON.stringify(a));
  const b = hitVelocity({ x: 0, y: 2, z: 0 }, { x: 0, y: -1, z: 0 }); // blast straight above: no horizontal push, y kept
  assert.ok(near(b.x, 0) && near(b.z, 0) && near(b.y, 2), JSON.stringify(b));
  const c = hitVelocity({ x: 0, y: -5, z: -10 }, { x: 3, y: -4, z: 0 }); // away points down: only its horizontal part is used
  assert.ok(near(c.x, 3) && near(c.z, -6) && near(c.y, -5), JSON.stringify(c));
  const out = { x: 9, y: 9, z: 9 }; assert.equal(hitVelocity({ x: 1, y: 1, z: 1 }, { x: 1, y: 0, z: 0 }, STORY_CHASE, out), out);
});

/** Run the scheduler for `sec`; returns its events with the time stamped. */
function run(A, sec, ctx, t0 = 0) {
  const out = []; let t = t0;
  for (let i = 0, n = Math.round(sec / DT); i < n; i++) { t += DT; for (const e of A.update(DT, typeof ctx === 'function' ? ctx(t) : ctx)) out.push({ ...e, at: t }); }
  return out;
}
const kinds = (ev, type) => ev.filter((e) => e.type === type).map((e) => e.attack);

test('StoryAttacks: tier 1 throws single pumpkins only', () => {
  const A = new StoryAttacks(); A.reset(3);
  const rel = kinds(run(A, 120, { tier: 1, allow: true, dist: 25, flying: 0 }), 'release');
  assert.ok(rel.length >= 15, `${rel.length} throws`); assert.ok(rel.every((k) => k === 'single'));
});

test('StoryAttacks: tier 2 adds the spread of three and never the heavy pumpkin', () => {
  const A = new StoryAttacks(); A.reset(3);
  const rel = kinds(run(A, 180, { tier: 2, allow: true, dist: 25, flying: 0 }), 'release');
  assert.ok(rel.includes('spread')); assert.ok(rel.includes('single')); assert.ok(!rel.includes('heavy'));
  for (let i = 1; i < rel.length; i++) assert.ok(!(rel[i] === 'spread' && rel[i - 1] === 'spread'), 'never two spreads in a row');
});

test('StoryAttacks: tier 3 adds the heavy pumpkin with its 2.4 s telegraph', () => {
  const A = new StoryAttacks(); A.reset(5);
  const ev = run(A, 180, { tier: 3, allow: true, dist: 25, flying: 0 });
  assert.ok(kinds(ev, 'release').includes('heavy'));
  const tele = ev.filter((e) => e.type === 'telegraph'), rel = ev.filter((e) => e.type === 'release');
  assert.equal(tele.length, rel.length);
  rel.forEach((r, i) => { assert.equal(r.attack, tele[i].attack); assert.ok(Math.abs(r.at - tele[i].at - FIGHT.telegraph[r.attack]) <= 2 * DT, `${r.attack}: ${(r.at - tele[i].at).toFixed(3)} s`); });
});

test('StoryAttacks: never inside 14 m, never beyond 60 m, never while throws are not allowed', () => {
  for (const ctx of [{ tier: 3, allow: true, dist: 13.9, flying: 0 }, { tier: 3, allow: true, dist: 61, flying: 0 }, { tier: 3, allow: false, dist: 25, flying: 0 }]) {
    const A = new StoryAttacks(); A.reset(1); assert.deepEqual(run(A, 60, ctx), [], JSON.stringify(ctx));
  }
});

test('StoryAttacks: throws that become unfair during the telegraph are cancelled, not released', () => {
  const A = new StoryAttacks(); A.reset(2);
  let seen = 0;
  const ev = run(A, 30, () => ({ tier: 1, allow: seen === 0, dist: 25, flying: 0, _: (A.state === 'telegraph' && seen++) }));
  assert.deepEqual(ev.map((e) => e.type), ['telegraph', 'cancel']);
  assert.equal(A.state, 'idle'); assert.equal(A.attack, null);
});

test('StoryAttacks: cancel() drops a telegraph in progress once and waits before the next decision', () => {
  const A = new StoryAttacks(); A.reset(2);
  const ctx = { tier: 1, allow: true, dist: 25, flying: 0 };
  while (A.state !== 'telegraph') A.update(DT, ctx);
  A.cancel(); const ev = A.update(DT, ctx);
  assert.deepEqual(ev.map((e) => e.type), ['cancel']);
  A.cancel(); assert.deepEqual(A.update(DT, ctx), [], 'nothing to cancel');
  assert.deepEqual(run(A, 1.4, ctx), [], 'at least 1.5 s before he tries again');
  assert.ok(run(A, 6, ctx).some((e) => e.type === 'release'));
});

test('StoryAttacks: at most two singles in the air; a spread only with none flying', () => {
  const A = new StoryAttacks(); A.reset(4);
  assert.deepEqual(run(A, 60, { tier: 1, allow: true, dist: 25, flying: 2 }), []);
  const B = new StoryAttacks(); B.reset(4);
  assert.ok(!kinds(run(B, 120, { tier: 2, allow: true, dist: 25, flying: 1 }), 'telegraph').includes('spread'));
});

test('StoryAttacks: same seed, same sequence; update(0) does nothing', () => {
  const seq = (seed) => { const A = new StoryAttacks(); A.reset(seed); return run(A, 90, { tier: 3, allow: true, dist: 25, flying: 0 }).map((e) => `${e.type}:${e.attack}@${e.at.toFixed(2)}`).join(' '); };
  assert.equal(seq(9), seq(9)); assert.notEqual(seq(9), seq(10));
  const A = new StoryAttacks(); A.reset(1); for (let i = 0; i < 1000; i++) assert.deepEqual(A.update(0, { tier: 3, allow: true, dist: 25, flying: 0 }), []);
});

test('StoryAttacks: the gaps between throws follow the tier (tier 3 throws more often than tier 1)', () => {
  const n = (tier) => { const A = new StoryAttacks(); A.reset(7); return run(A, 300, { tier, allow: true, dist: 25, flying: 0 }).filter((e) => e.type === 'release').length; };
  assert.ok(n(3) > n(1), `${n(3)} vs ${n(1)}`);
});

test('Coins.burst: the punch reward — 8 Bitcoins beside him fly to the player and are counted; nothing without a coin run', async () => {
  const THREE = await import('three');
  const { Coins } = await import('../src/game/coins.js');
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), player = new THREE.Group(); player.add(camera); scene.add(player);
  const hud = { n: 0, setCoins(n) { this.n = n; } };
  const app = { scene, camera, hud, fx: { boom() {} }, hub: { haptic() {} }, locomotion: { feet: (o) => o.set(player.position.x, player.position.y, player.position.z) } };
  const coins = new Coins(app);
  assert.equal(coins.burst(new THREE.Vector3(0, 10, -12), STORY_CHASE.coinBurst), 0, 'no coin run: no coins');
  coins.startWorld({});
  const before = coins.count, at = new THREE.Vector3(0, 10, -12); // (a punch 12 m away: far outside the normal magnet range)
  assert.equal(coins.burst(at, STORY_CHASE.coinBurst), 8);
  const made = coins.items.filter((it) => it.burst);
  assert.equal(made.length, 8);
  for (const it of made) { assert.ok(it.pos.distanceTo(at) < 3, 'scattered close to the hit'); assert.ok(it.mag, 'already flying to the player'); }
  let frames = 0; while (coins.items.some((it) => it.burst && it.state === 'live') && frames < 600) { coins.update(DT, frames * DT); frames++; }
  assert.equal(coins.count - before, 8, `all eight collected (${frames} frames)`);
  assert.equal(hud.n, coins.count);
  assert.ok(frames < 240, `inside 4 s (${frames} frames)`);
  assert.equal(coins.burst(at, 0), 0);
});

// ---- v0.49: the last resort and the fly-in
test('holdS during a fly-in: he is never pushed ahead (the fly-in stops at the contact distance by itself)', () => {
  assert.equal(holdS(100.5, 100, Infinity, undefined, true), 100.5);
  assert.equal(holdS(70, 100, Infinity, undefined, true), 70);
  assert.ok(near(holdS(100.5, 100, Infinity, undefined, false), 101.5), 'outside a fly-in: as before');
});
