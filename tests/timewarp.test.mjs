// v0.45 impact time warp: scale curve, overlap, comfort mode, holds, pause (pure — no scene).
import test from 'node:test';
import assert from 'node:assert/strict';
import { TimeWarp } from '../src/game/timeWarp.js';

const DT = 1 / 60;
/** Step the warp for `sec` seconds of real time (whole frames); returns the last scale. */
function run(w, sec) { let s = w.scale; for (let i = 0, n = Math.round(sec / DT); i < n; i++) s = w.update(DT); return s; }

test('idle scale is 1 and not active', () => { const w = new TimeWarp(); assert.equal(w.update(DT), 1); assert.equal(w.active, false); });
test('counter: 0.25 for 0.25 s, back to 1 after a further 0.20 s', () => {
  const w = new TimeWarp(); w.request('counter');
  assert.equal(run(w, 0.24), 0.25); const mid = run(w, 0.11); assert.ok(mid > 0.25 && mid < 1);
  assert.equal(run(w, 0.12), 1); assert.equal(w.active, false);
});
test('overlap: the slowest request wins', () => { const w = new TimeWarp(); w.request('counter'); w.request('break'); assert.equal(run(w, 0.1), 0.25); });
test('comfort: half the hold, never below 0.5', () => { const w = new TimeWarp(); w.request('counter', { comfort: true }); assert.equal(run(w, 0.1), 0.5); assert.ok(run(w, 0.05) > 0.5); });
test('hold persists until release, then eases over the given time', () => {
  const w = new TimeWarp(); w.hold(0.2); assert.equal(run(w, 10), 0.2); w.release(0.4); assert.ok(run(w, 0.2) < 1); assert.equal(run(w, 0.25), 1);
});
test('hold in comfort mode is limited to 0.5', () => { const w = new TimeWarp(); w.hold(0.2, { comfort: true }); assert.equal(run(w, 1), 0.5); });
test('update(0) changes nothing (paused)', () => { const w = new TimeWarp(); w.request('break'); for (let i = 0; i < 600; i++) w.update(0); assert.equal(w.scale, 0.4); });
test('reset returns to 1 immediately, also from a hold', () => { const w = new TimeWarp(); w.hold(0.2); w.reset(); assert.equal(w.update(DT), 1); });
test('unknown kind is ignored', () => { const w = new TimeWarp(); w.request('nope'); assert.equal(w.update(DT), 1); });

// ---- v0.49 the punch moment: slow motion on the fly-in's last metres (approach), then the hit (impact)
import { FEEL } from '../src/data/feel.js';
import { Lunge } from '../src/worlds/lunge.js';
import { CLOSE } from '../src/data/closeCombat.js';
const AP = FEEL.warp.approach, PU = FEEL.warp.punch;

test('v0.49 numbers: approach 5 m at quarter speed; the punch is a 0.15 s near-freeze, 0.3 s back to full speed', () => {
  assert.deepEqual(AP, { dist: 5, scale: 0.25, ease: 0.2 });
  assert.deepEqual(PU, { scale: 0.1, hold: 0.15, ease: 0.3 });
});
test('approach: nothing beyond its distance; inside it the slow scale holds for as long as the fly-in lasts; it starts once', () => {
  const w = new TimeWarp();
  assert.equal(w.approach(AP.dist + 0.5), false); assert.equal(w.update(DT), 1);
  assert.equal(w.approach(AP.dist - 0.1), true); assert.equal(run(w, 3), AP.scale);
  assert.equal(w.approach(2), false); assert.equal(w.scale, AP.scale);
});
test('impact after an approach: the punch scale for its hold, then back to 1 over its ease', () => {
  const w = new TimeWarp(); w.approach(4); run(w, 0.4); w.impact('punch');
  assert.equal(run(w, PU.hold - 0.02), PU.scale);
  const mid = run(w, 0.15); assert.ok(mid > PU.scale && mid < 1, `${mid}`);
  assert.equal(run(w, PU.ease), 1); assert.equal(w.active, false);
});
test('impact with no approach before it (a body contact) is the plain punch warp', () => {
  const w = new TimeWarp(); w.impact('punch'); assert.equal(run(w, PU.hold - 0.02), PU.scale); assert.equal(run(w, PU.hold + PU.ease), 1);
});
test('cancelApproach: the fly-in ended with no hit, so time returns over the approach ease; nothing to do otherwise', () => {
  const w = new TimeWarp(); assert.equal(w.cancelApproach(), false);
  w.approach(3); run(w, 0.3); assert.equal(w.cancelApproach(), true);
  const mid = run(w, AP.ease / 2); assert.ok(mid > AP.scale && mid < 1, `${mid}`); assert.equal(run(w, AP.ease), 1);
  assert.equal(w.cancelApproach(), false);
});
test('a new approach can start after the last one ended (the next punch)', () => {
  const w = new TimeWarp(); w.approach(3); w.impact('punch'); run(w, 1); assert.equal(w.scale, 1);
  assert.equal(w.approach(3), true); assert.equal(w.scale, AP.scale);
});
test('approach in comfort mode: never below 0.5, and the punch hold is halved', () => {
  const w = new TimeWarp(); w.approach(3, { comfort: true }); assert.equal(run(w, 1), 0.5);
  w.impact('punch', { comfort: true }); assert.equal(run(w, PU.hold * 0.5 - 0.02), 0.5); assert.ok(run(w, 0.05) > 0.5);
});
test('approach never takes over the finisher hold, and cancelApproach never releases it', () => {
  const w = new TimeWarp(); w.hold(0.2); assert.equal(w.approach(3), false); assert.equal(w.cancelApproach(), false); assert.equal(run(w, 1), 0.2);
});
test('a finisher hold during an approach takes it over: a late impact or cancel changes nothing', () => {
  const w = new TimeWarp(); w.approach(3); w.hold(0.2); w.impact('punch'); assert.equal(w.cancelApproach(), false); assert.equal(run(w, 1), 0.2);
});
test('reset ends an approach', () => { const w = new TimeWarp(); w.approach(3); w.reset(); assert.equal(w.update(DT), 1); assert.equal(w.approach(3), true); });

/** A whole fly-in at 72 Hz with the time warp in the loop: returns the real seconds spent in slow motion before contact. */
function flyIn({ gap0, bossV = 0, v0 = 0, comfort = false }) {
  const H = 1 / 72, w = new TimeWarp(), L = new Lunge(); L.start(0, { v0, comfort, away: bossV });
  let gap = gap0, slow = 0, real = 0, done = null;
  while (!done && real < 5) {
    const sim = H * w.update(H); real += H;
    const r = L.update(sim, { gap }); gap += bossV * sim - r.step; done = r.done;
    if (!done) { w.approach(gap, { comfort }); if (w.approaching) slow += H; }
  }
  return { done, slow, real, w };
}
test('Story (he hangs in place): from 15 m the fly-in connects after about 0.6 s of slow motion', () => {
  const r = flyIn({ gap0: 15, v0: 8 }); console.log(`  story: ${r.slow.toFixed(2)} s slow, ${r.real.toFixed(2)} s in all`);
  assert.equal(r.done, 'contact'); assert.ok(r.slow > 0.45 && r.slow < 0.75, `${r.slow}`);
});
test('World Chase (he drifts away at the stagger speed): still connects, with under 1 s of slow motion', () => {
  const r = flyIn({ gap0: 15, v0: 8, bossV: 6 }); console.log(`  world: ${r.slow.toFixed(2)} s slow, ${r.real.toFixed(2)} s in all`);
  assert.equal(r.done, 'contact'); assert.ok(r.slow > 0.5 && r.slow < 1.0, `${r.slow}`);
});
test('comfort mode: the gentler fly-in still connects from 15 m', () => {
  const r = flyIn({ gap0: 15, v0: 8, bossV: 6, comfort: true }); assert.equal(r.done, 'contact'); assert.ok(CLOSE.lunge.comfortSpeed < CLOSE.lunge.speed);
});

// ---- v0.49: a fly-in from below, in slow motion, against the "never flown through" rule (found in the browser test:
// the rule pushed him ahead by exactly the fly-in's small slow-motion steps, so the hit never landed)
import { holdS } from '../src/game/storyAttacks.js';
import { CloseRange } from '../src/worlds/closeRange.js';
/** Player 3 m below him and 12 m back along the route; his body point (what the fly-in aims at) sits 0.3 m ahead of his route position (what the rule moves). hold(bossS, playerS, flying) is the mode's last-resort rule. */
function flyInFromBelow(hold, flying) {
  const H = 1 / 72, w = new TimeWarp(), L = new Lunge(); L.start(0, { v0: 0 });
  let ps = 0, py = 0, bs = 12, real = 0, done = null; const by = 3, AHEAD = 0.3;
  while (!done && real < 6) {
    const sim = H * w.update(H); real += H;
    const dx = bs + AHEAD - ps, dy = by - py, gap = Math.hypot(dx, dy), r = L.update(sim, { gap });
    ps += r.step * dx / gap; py += r.step * dy / gap; done = r.done;
    if (!done) { w.approach(gap); bs = hold(bs, ps, flying); } // (after the contact the fly-in is over: the rule is the mode's business again)
  }
  return done;
}
test('Story: the fly-in from below connects in slow motion because the last resort stands down during it', () => {
  assert.equal(flyInFromBelow((b, p, f) => holdS(b, p, Infinity, undefined, f), true), 'contact');
  assert.equal(flyInFromBelow((b, p) => holdS(b, p), false), 'timeout', 'the rule applied during the fly-in keeps him out of reach (why it must stand down)');
});
test('World Chase: the same with CloseRange.holdS', () => {
  const mk = () => { const c = new CloseRange(); c.update(1 / 72, 10, true, true); return c; };
  const a = mk(); assert.equal(flyInFromBelow((b, p, f) => a.holdS(b, p, Infinity, f), true), 'contact'); assert.equal(a.clamps, 0);
  const z = mk(); assert.equal(flyInFromBelow((b, p) => z.holdS(b, p), false), 'timeout');
});
