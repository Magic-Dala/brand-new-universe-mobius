// v0.46 close range (World Chase): inside 15 m Green Maniac lets the player close the gap (he holds 2.2 m) and turns to
// taunt; beyond 17 m he surfs again. Camping 5 s inside → he boosts away to 19 m (tauntOut + 2), then a 6 s lockout (the v0.45
// 8 m floor). Staggered: no camping count and (revision 4) no early-brake floor — only the 1.5 m last resort. And the pursuit
// floor (pursuitSpeed with q.minGap).
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const { CloseRange } = await import('../src/worlds/closeRange.js');
const { CLOSE } = await import('../src/data/closeCombat.js');
const { WORLD_CHASE, pursuitSpeed, chaseRefSpeed } = await import('../src/worlds/worldChase.js');

const DT = 1 / 60;
/** sec of updates at a constant gap; returns every event (copied: update() reuses its array) */
function run(c, sec, gap, staggered, enabled = true) {
  const ev = [];
  for (let k = 0; k < Math.round(sec / DT); k++) ev.push(...c.update(DT, gap, staggered, enabled));
  return ev;
}

test('CLOSE: the revised values (15 m / 17 m, boost to 19 m, 5 s camping, 6 s lockout, the red ring)', () => {
  assert.deepEqual([CLOSE.holdGap, CLOSE.tauntIn, CLOSE.tauntOut, CLOSE.campTime, CLOSE.lockout, CLOSE.brakeAccel], [2.2, 15, 17, 5, 6, 28]);
  assert.equal(CLOSE.boostOut, CLOSE.tauntOut + 2);
  assert.deepEqual(CLOSE.ring, { radius: 1.5, color: 0xff3b30, pulseHz: 1.6, opacity: [0.55, 0.95] });
  assert.equal(CLOSE.anim.hitIn, 0.2);
});
test('far → close inside 15 m, close → far beyond 17 m (hysteresis)', () => {
  const c = new CloseRange();
  assert.deepEqual(c.update(DT, 16, false, true), []);
  assert.deepEqual(c.update(DT, 14.9, false, true), [{ type: 'taunt' }]);
  assert.deepEqual(c.update(DT, 16.5, false, true), []);
  assert.deepEqual(c.update(DT, 17.1, false, true), [{ type: 'surf' }]);
});
test('floor: minGap 2.2 / noPass 1.5 in close range and the boost (far / lockout: null = the v0.45 8 m rule)', () => {
  const c = new CloseRange(); assert.equal(c.minGap, null); assert.equal(c.noPass, null);
  c.update(DT, 14.9, false, true); assert.equal(c.state, 'close'); assert.equal(c.minGap, 2.2); assert.equal(c.noPass, 1.5);
  run(c, 5.05, 8, false); assert.equal(c.state, 'boost'); assert.equal(c.minGap, 2.2); assert.equal(c.noPass, 1.5);
  run(c, 0.1, 20, false); assert.equal(c.state, 'lockout'); assert.equal(c.minGap, null); assert.equal(c.noPass, null);
});
test('camping: 5 s inside 17 m → boost (floor 2.2 m, last-resort 1.5 m: he can still not be flown through); breakAway', () => {
  const c = new CloseRange(); const ev = run(c, 5.05, 8, false);
  assert.ok(ev.some((e) => e.type === 'boost')); assert.ok(ev.some((e) => e.type === 'surf'));
  assert.equal(c.state, 'boost'); assert.equal(c.minGap, 2.2); assert.equal(c.noPass, 1.5); assert.equal(c.breakAway, true);
});
test('not yet camping at 4.9 s', () => { const c = new CloseRange(); run(c, 4.9, 8, false); assert.equal(c.state, 'close'); assert.equal(c.breakAway, false); });
test('boost ends at 19 m (not at 17 m = tauntOut: no instant re-entry), then 6 s lockout, then far', () => {
  const c = new CloseRange(); run(c, 5.05, 8, false); run(c, 0.1, 17.5, false); assert.equal(c.state, 'boost');
  run(c, 0.1, 18.9, false); assert.equal(c.state, 'boost'); run(c, 0.1, 19, false);
  assert.equal(c.state, 'lockout'); assert.equal(c.minGap, null); assert.equal(c.breakAway, false);
  assert.deepEqual(run(c, 5.9, 9, false), []); assert.equal(c.state, 'lockout'); // (no approach during the lockout, even at 9 m)
  const ev = run(c, 0.15, 20, false);
  assert.ok(ev.some((e) => e.type === 'lockoutEnd')); assert.equal(c.state, 'far'); assert.equal(c.minGap, null);
});
test('the boost ends beyond tauntOut (and beyond the pull rule\'s 17 m)', () => { assert.ok(CLOSE.boostOut > CLOSE.tauntOut); assert.ok(CLOSE.boostOut >= WORLD_CHASE.pull.minLead); });
test('leaving 17 m resets the camping timer', () => {
  const c = new CloseRange(); run(c, 4.5, 8, false); run(c, 0.1, 17.5, false); run(c, 4.5, 8, false); assert.equal(c.state, 'close');
});
test('staggered: no timer, no boost', () => { const c = new CloseRange(); run(c, 10, 8, true); assert.equal(c.state, 'close'); });
test('a stagger clears the camping count', () => {
  const c = new CloseRange(); run(c, 4.5, 8, false); run(c, 0.1, 8, true); run(c, 4.5, 8, false); assert.equal(c.state, 'close');
});
test('stagger during a boost cancels it', () => { const c = new CloseRange(); run(c, 5.05, 8, false); run(c, 0.1, 18, true); assert.equal(c.state, 'far'); assert.equal(c.breakAway, false); });
test('disabled: far, minGap null, one surf if it was close', () => {
  const c = new CloseRange(); run(c, 0.1, 8, false);
  assert.deepEqual(c.update(DT, 8, false, false), [{ type: 'surf' }]); assert.equal(c.state, 'far'); assert.equal(c.minGap, null); assert.equal(c.ring, false);
  assert.deepEqual(c.update(DT, 8, false, false), []);
  assert.deepEqual(c.update(DT, 8, false, true), [{ type: 'taunt' }]); assert.equal(c.minGap, 2.2);
});
test('ring: exactly in close', () => {
  const c = new CloseRange(); assert.equal(c.ring, false);
  run(c, 0.1, 8, false); assert.equal(c.ring, true);
  run(c, 5, 8, false); assert.equal(c.state, 'boost'); assert.equal(c.ring, false);
  run(c, 0.1, 20, false); assert.equal(c.state, 'lockout'); assert.equal(c.ring, false);
});
test('update(0) changes nothing (paused)', () => { const c = new CloseRange(); run(c, 4.5, 8, false); for (let i = 0; i < 600; i++) c.update(0, 8, false, true); run(c, 0.4, 8, false); assert.equal(c.state, 'close'); });
test('reset: far, no events', () => { const c = new CloseRange(); run(c, 5.05, 8, false); c.reset(); assert.equal(c.state, 'far'); assert.equal(c.breakAway, false); assert.equal(c.minGap, null); assert.equal(c.clamps, 0); });

test('pursuitSpeed: q.minGap unset is the v0.45 law (and null the same)', () => {
  for (const gap of [1, 3, 5, 7.9, 8.1, 12, 15.9, 16.1, 30, 70]) for (const slow of [null, 'stagger', 'heavy']) {
    const q = { gap, lead: slow ? WORLD_CHASE.leadOpening[slow] : 26, ps: 10, psNow: 16, slow, tetherStuck: false, breakAway: false };
    assert.equal(pursuitSpeed(9, { ...q, minGap: null }, 1 / 72, WORLD_CHASE), pursuitSpeed(9, q, 1 / 72, WORLD_CHASE));
  }
});
/**
 * 1-D World Chase at 72 Hz with the real exports, in _updateBoss order: CloseRange.update → pursuit query → pursuitSpeed →
 * route step → CloseRange.holdS (the last-resort clamp). pv(t) = the player's route speed; ps0 = his reference speed at t = 0;
 * surge = the player's pull surge (his reference lags, v0.44). Returns the min gap, when close range opened, clamp uses.
 */
const H = 1 / 72;
function chase({ gap0, bv0 = 12, pv, ps0 = null, surge = 0, stag = false, sec = 6, enabled = true, until = null }) {
  const cr = new CloseRange(); let bossS = 1000 + gap0, playerS = 1000, bv = bv0, ps = ps0 ?? pv(0, null), min = Infinity, enter = null, at3 = null, tb = null, minB = Infinity, gapB = null;
  const acc = [], gaps = [];
  for (let k = 1; k <= Math.round(sec / H); k++) {
    const t = k * H, v = pv(t, tb); playerS += v * H; ps = chaseRefSpeed(ps, v, surge, H);
    const gap = bossS - playerS, slow = stag ? 'stagger' : null;
    cr.update(H, gap, stag, enabled); if (cr.state === 'close' && enter == null) enter = t;
    if (cr.state === 'boost' && tb == null) { tb = t; gapB = gap; } // (pv sees the boost onset from the next frame: the player surges then)
    const b0 = bv;
    bv = pursuitSpeed(bv, cr.pursuit({ gap, lead: slow ? WORLD_CHASE.leadOpening[slow] : WORLD_CHASE.lead, ps, psNow: v, slow, tetherStuck: false, breakAway: false }), H, WORLD_CHASE);
    acc.push((bv - b0) / H);
    bossS = Math.max(bossS, bossS + bv * H); const c0 = cr.clamps; bossS = cr.holdS(bossS, playerS); if (cr.clamps > c0) bv = Math.max(bv, v);
    const g = bossS - playerS; min = Math.min(min, g); gaps.push(g); if (Math.abs(t - 3) < H / 2) at3 = g; if (tb != null) minB = Math.min(minB, g);
    if (until && until(cr)) break;
  }
  return { min, enter, clamps: cr.clamps, at3, tb, minB, gapB, acc, gaps, state: cr.state };
}
const fmt = (r) => `min ${r.min.toFixed(2)} m, close at ${r.enter?.toFixed(2)} s, clamps ${r.clamps}`;
// revision 4 (R4.3): while staggered the close-range brake floor is off — the stagger speed cap stands, the player reaches him
// (contact + rebound stop a pass-through); the 1.5 m last resort still holds
test('staggered in close range: no brake floor (minGap null, noFloor), the 1.5 m last resort stays; shield up: the 2.2 m hold', () => {
  const c = new CloseRange(); c.update(DT, 10, true, true); assert.equal(c.state, 'close');
  assert.equal(c.minGap, null); assert.equal(c.noFloor, true); assert.equal(c.noPass, 1.5);
  const q = c.pursuit({ gap: 10, lead: 14, ps: 10, psNow: 18, slow: 'stagger', tetherStuck: false, breakAway: false });
  assert.equal(q.noFloor, true); assert.equal(q.minGap, null); assert.equal(q.brakeAccel, undefined);
  c.update(DT, 10, false, true); assert.equal(c.minGap, 2.2); assert.equal(c.noFloor, false);
  const far = new CloseRange(); far.update(DT, 30, true, true); assert.equal(far.noFloor, false); assert.equal(far.minGap, null); // (far: the v0.45 rule)
});
test('pursuitSpeed: q.noFloor drops the floor (only the stagger cap)', () => {
  const q = { gap: 3, lead: 14, ps: 18, psNow: 18, slow: 'stagger', tetherStuck: false, breakAway: false, minGap: null };
  assert.ok(pursuitSpeed(6, q, 1 / 72, WORLD_CHASE) > 6); assert.ok(pursuitSpeed(6, { ...q, noFloor: true }, 1 / 72, WORLD_CHASE) <= 6);
});
test('(a) staggered boss, player at 12 m/s from 12 m: reaches contact range (≤ 1.6 m), never below 1.5 m', () => { const r = chase({ gap0: 12, bv0: 6, pv: () => 12, stag: true }); assert.ok(r.min <= 1.6 && r.min >= 1.5 - 1e-9 && r.enter != null, fmt(r)); });
test('staggered pursuit has no brake floor: player at 18 m/s from 12 m reaches 1.6 m within the 3 s break stagger', () => {
  const r = chase({ gap0: 12, bv0: 6, pv: () => 18, stag: true, sec: 3, until: () => false }); const i = r.gaps.findIndex((g) => g <= 1.6);
  console.log(`  reaches 1.6 m after ${((i + 1) * H).toFixed(2)} s; min ${r.min.toFixed(3)} m`); assert.ok(i >= 0 && (i + 1) * H < 3, fmt(r));
});
test('(b) staggered boss, player at 18 m/s from 12 m: never passed (≥ 1.5 m)', () => { const r = chase({ gap0: 12, bv0: 6, pv: () => 18, stag: true }); assert.ok(r.min >= 1.5, fmt(r)); });
test('(c) surge from 3 m at +6 m/s: the gap stays ≥ 2.0 m', () => { const r = chase({ gap0: 3, pv: (t) => (t < 0.5 ? 12 : 18) }); assert.ok(r.min >= 2.0, fmt(r)); });
test('(d) surge from 3 m at +10 m/s: never passed (≥ 1.5 m)', () => { const r = chase({ gap0: 3, pv: (t) => (t < 0.5 ? 12 : 22) }); assert.ok(r.min >= 1.5, fmt(r)); });
test('(e) matched speed at 6 m holds 6.0 m; a +10 m/s pull approach from 15 m enters close range and holds ≥ 2.0 m', () => {
  const m = chase({ gap0: 6, pv: () => 12, sec: 4.9 }); assert.ok(Math.abs(m.min - 6) < 0.1 && Math.abs(m.at3 - 6) < 0.1, fmt(m));
  const r = chase({ gap0: 15, pv: () => 22, ps0: 12, surge: 5 }); assert.ok(r.enter != null && r.min >= 2.0, fmt(r));
});
test('far is v0.45: +3 / +6 m/s approaches from 20 m keep the v0.45 minimum gaps (19.38 / 17.47 m)', () => {
  for (const [rel, want] of [[3, 19.38], [6, 17.47]]) {
    const on = chase({ gap0: 20, pv: () => 12 + rel, sec: 10 }), off = chase({ gap0: 20, pv: () => 12 + rel, sec: 10, enabled: false }); console.log(`  +${rel}: min ${on.min.toFixed(2)} m`);
    assert.ok(Math.abs(on.min - want) < 0.05 && Math.abs(on.min - off.min) < 1e-9 && on.enter == null, `+${rel}: ${fmt(on)} (v0.45 ${off.min.toFixed(2)})`);
  }
});
test('pursuit query: close range holds the gap (no flight); far keeps the v0.42 lead; boost = breakAway + the early floor (2.2 m)', () => {
  const c = new CloseRange(), q = () => ({ gap: 6, lead: 26, ps: 10, psNow: 11, slow: null, tetherStuck: false, breakAway: false });
  let r = c.pursuit(q()); assert.equal(r.lead, 26); assert.equal(r.minGap, null); assert.equal(r.ps, 10);
  c.update(DT, 6, false, true); r = c.pursuit(q()); assert.equal(r.lead, 6); assert.equal(r.ps, 11); assert.equal(r.breakAway, false); assert.equal(r.minGap, 2.2); assert.equal(r.brakeAccel, CLOSE.brakeAccel);
  run(c, 5.05, 6, false); r = c.pursuit(q()); assert.equal(r.lead, 26); assert.equal(r.minGap, 2.2); assert.equal(r.brakeAccel, CLOSE.brakeAccel); assert.equal(r.breakAway, true); assert.equal(r.ps, 10);
  run(c, 0.1, 20, false); r = c.pursuit(q()); assert.equal(c.state, 'lockout'); assert.equal(r.minGap, null); assert.equal(r.brakeAccel, undefined); assert.equal(r.brakeHold, undefined); assert.equal(r.breakAway, false);
  const off = chase({ gap0: 5, bv0: 0, pv: () => 0, sec: 3, enabled: false }); assert.ok(off.at3 >= 8, `switch off: back above 8 m (${off.at3.toFixed(1)})`);
});

// ---- fix round 2: the boost keeps the early floor and the last-resort clamp (a boost starts wherever camping ended, 2.2–12 m)
/** camping at v0 m/s (matched) with the frame gap (bossS − playerS after the player's step, as _updateBoss sees it) at g until
 * the boost, then the player at v1 m/s (a pull surge: his reference lags) */
const boostRun = (g, v0, v1) => chase({ gap0: g + v0 * H, bv0: v0, pv: (t, tb) => (tb == null ? v0 : v1), surge: v1 > v0 ? 5 : 0, sec: 9, until: (cr) => cr.state === 'lockout' });
const fmtB = (r) => `boost at ${r.tb?.toFixed(2)} s from ${r.gapB?.toFixed(2)} m: min ${r.minB.toFixed(3)} m (whole run ${r.min.toFixed(3)}), clamps ${r.clamps}, ends ${r.state}`;
for (const g of [3, 2.5, 2.2]) test(`boost onset from ${g} m, player surges 12 → 22 m/s: never passed, min gap ≥ 1.5 m`, () => {
  const r = boostRun(g, 12, 22); console.log(`  ${g} m: ${fmtB(r)}`);
  assert.ok(r.tb != null && Math.abs(r.gapB - g) < 1e-6, fmtB(r)); assert.ok(r.min >= 1.5 - 1e-9 && r.minB >= 1.5 - 1e-9, fmtB(r));
});
for (const v of [12, 18]) test(`boost from 4 m, player steady at ${v} m/s: the boost still opens the gap (min ≥ 3.99 m, reaches 19 m)`, () => {
  const r = boostRun(4, v, v); console.log(`  ${v} m/s: ${fmtB(r)}`);
  assert.ok(r.tb != null && Math.abs(r.gapB - 4) < 1e-6 && r.minB >= 4 - 0.01 && r.min >= 4 - 0.01 && r.state === 'lockout' && r.clamps === 0, fmtB(r));
});
test('staggered hold, player at 18 m/s: no acceleration chatter (≤ 4 sign flips over 2 s at 72 Hz once he holds the gap)', () => {
  const r = chase({ gap0: 12, bv0: 6, pv: () => 18, stag: true, sec: 6 });
  const i0 = r.gaps.findIndex((g) => g < 4); assert.ok(i0 >= 0 && r.min >= 1.5, fmt(r)); // (he has braked: the gap reached the floor zone)
  const w = r.acc.slice(i0 + 36, i0 + 36 + 144); let flips = 0, s0 = 0; // (2 s, from 0.5 s after the gap first fell below 4 m)
  for (const a of w) { const s = Math.abs(a) < 1e-6 ? 0 : Math.sign(a); if (s && s0 && s !== s0) flips++; if (s) s0 = s; }
  console.log(`  chatter: ${flips} flips; gap ${Math.min(...r.gaps.slice(i0 + 36, i0 + 180)).toFixed(2)} … ${Math.max(...r.gaps.slice(i0 + 36, i0 + 180)).toFixed(2)} m; min ${r.min.toFixed(2)} m`);
  assert.ok(flips <= 4, `${flips} sign flips of his commanded acceleration`);
});
test('holdS: the route-end limit wins over the last-resort clamp (never pushed past lim; never pulled back)', () => {
  const c = new CloseRange(); c.update(DT, 5, false, true); assert.equal(c.state, 'close');
  assert.equal(c.holdS(1001, 1000, 1010), 1001.5); assert.equal(c.clamps, 1); // (lim far ahead: the 1.5 m clamp)
  assert.equal(c.holdS(1001, 1000, 1001.2), 1001.2); assert.equal(c.clamps, 2); // capped at lim
  assert.equal(c.holdS(1001, 1000, 1000.5), 1001); assert.equal(c.clamps, 2); // lim behind him: stays put (no clamp counted)
  assert.equal(c.holdS(1001, 1000), 1001.5); // (no lim: unchanged behaviour)
  assert.equal(c.holdS(1003, 1000, 1001), 1003); // gap ≥ 1.5 m: untouched
});

// ---- v0.49: the last resort and the fly-in
test('holdS during a fly-in: no clamp and none counted (the fly-in stops at the contact distance by itself)', () => {
  const c = new CloseRange(); c.update(DT, 10, true, true);
  assert.equal(c.holdS(1001, 1000, 1010, true), 1001); assert.equal(c.clamps, 0);
  assert.equal(c.holdS(1001, 1000, 1010), 1001.5); assert.equal(c.clamps, 1); // (outside a fly-in: as before)
});
