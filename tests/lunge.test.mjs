// v0.46 Task 4 (revision 4): the fly-in hit (Lunge), what a web aimed at Green Maniac does (webAtBoss: the shield decides),
// and the contact push-back (rebound). Pure helpers in src/worlds/lunge.js.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const { Lunge, webAtBoss, rebound } = await import('../src/worlds/lunge.js');
const { CLOSE } = await import('../src/data/closeCombat.js');
const { CloseRange } = await import('../src/worlds/closeRange.js');
const { WORLD_CHASE, pursuitSpeed, chaseRefSpeed } = await import('../src/worlds/worldChase.js');

const H = 1 / 72;
test('CLOSE.lunge values (verbatim)', () => {
  assert.deepEqual(CLOSE.lunge, { speed: 24, comfortSpeed: 14, accel: 45, timeout: 1.0, contact: 1.6, rebound: 8, reboundUp: 3, cooldown: 0.8 });
  assert.deepEqual(CLOSE.punch, { interval: 0.5, flow: 2 });
  assert.deepEqual(CLOSE.fx, { minGap: 0.25 });
});

/** fly-in at 72 Hz: the boss moves away at bossV; returns { t, done, minGap, gap } */
function fly({ gap0 = 15, bossV = 6, v0 = 0, comfort = false, sec = 3 }) {
  const L = new Lunge(); L.start(0, { v0, comfort, away: 6 }); let gap = gap0, t = 0, done = null, minGap = gap0;
  while (t < sec && !done) { t += H; const r = L.update(H, { gap }); gap += bossV * H - r.step; minGap = Math.min(minGap, gap); done = r.done; }
  return { t, done, minGap, gap, active: L.active };
}
for (const v0 of [6, 12]) test(`lunge from 15 m at speed 24, boss moving away at 6 m/s, starting at ${v0} m/s toward him: contact before the timeout`, () => {
  const r = fly({ v0 }); console.log(`  v0 ${v0}: contact after ${r.t.toFixed(3)} s, min gap ${r.minGap.toFixed(3)} m`);
  assert.equal(r.done, 'contact'); assert.ok(r.t < CLOSE.lunge.timeout, `${r.t}`); assert.ok(r.minGap >= CLOSE.lunge.contact - 1e-9 && r.minGap <= CLOSE.lunge.contact + 1e-9 + 6 * H); assert.equal(r.active, false);
});
test('lunge: the step never carries the chest inside the contact distance (swept)', () => {
  for (const g of [1.7, 2, 3, 3.9]) { const L = new Lunge(); L.start(0, { v0: 24 }); const r = L.update(0.1, { gap: g }); /* (2.4 m per 0.1 s step) */ assert.equal(r.done, 'contact'); assert.ok(Math.abs(g - r.step - CLOSE.lunge.contact) < 1e-9); }
  const L = new Lunge(); L.start(0); const r = L.update(H, { gap: 1.5 }); assert.equal(r.done, 'contact'); assert.equal(r.step, 0);
});
test('lunge: accelerates at 45 m/s² up to 24 m/s', () => {
  const L = new Lunge(); L.start(0); let r; for (let i = 0; i < 36; i++) r = L.update(H, { gap: 100 }); assert.ok(Math.abs(r.speed - 22.5) < 1e-6, `${r.speed}`);
  for (let i = 0; i < 20; i++) r = L.update(H, { gap: 100 }); assert.equal(r.speed, 24);
});
test('lunge times out when the gap never closes (no contact, inactive after)', () => {
  const r = fly({ bossV: 30, v0: 0 }); assert.equal(r.done, 'timeout'); assert.ok(Math.abs(r.t - 1.0) < 2 * H, `${r.t}`); assert.equal(r.active, false);
});
test('lunge comfort: 14 m/s, the timeout scaled by the closing speeds (vs the 6 m/s stagger cap) so the same 15 m still connects', () => {
  const L = new Lunge(); L.start(0, { comfort: true }); let r; for (let i = 0; i < 72; i++) r = L.update(H, { gap: 100 }); assert.equal(r.speed, 14);
  const c = fly({ v0: 6, comfort: true }); console.log(`  comfort: ${c.done} after ${c.t.toFixed(3)} s`); assert.equal(c.done, 'contact');
  const n = new Lunge(); n.start(0, { away: 6 }); assert.equal(n.timeout, 1.0); const m = new Lunge(); m.start(0, { comfort: true, away: 6 }); assert.equal(m.timeout, 2.25);
});
test('lunge: inactive → nothing; reset', () => {
  const L = new Lunge(); assert.equal(L.active, false); const r = L.update(H, { gap: 10 }); assert.equal(r.step, 0); assert.equal(r.done, null);
  L.start(0); assert.equal(L.active, true); L.reset(); assert.equal(L.active, false);
});

test('webAtBoss: the revision-4 table', () => {
  const q = (o) => webAtBoss({ los: true, maxDist: 28, minDist: 4, ...o });
  for (const [dist, inClose] of [[5, true], [14, true], [20, false]]) assert.equal(q({ staggered: false, inClose, dist }), 'strike', `shield up ${dist}`);
  assert.equal(q({ staggered: true, inClose: false, dist: 20 }), 'attach');
  assert.equal(q({ staggered: true, inClose: true, dist: 14 }), 'lunge');
  assert.equal(q({ staggered: true, inClose: false, dist: 30 }), 'strike');
  assert.equal(q({ staggered: true, inClose: false, dist: 20, los: false }), 'strike');
  assert.equal(q({ staggered: true, inClose: true, dist: 14, los: false }), 'strike');
  assert.equal(webAtBoss({ staggered: true, inClose: false, los: true, dist: 20 }), 'attach'); // (default maxDist = the tether's 28 m)
});

test('webAtBoss (fix round 1, C1): a jet web already held — inside close range the next web is still the fly-in hit; beyond it a strike', () => {
  const q = (o) => webAtBoss({ los: true, maxDist: 28, minDist: 4, staggered: true, tethered: true, ...o });
  assert.equal(q({ inClose: true, dist: 12 }), 'lunge');
  assert.equal(q({ inClose: false, dist: 20 }), 'strike');
  assert.equal(q({ inClose: true, dist: 12, staggered: false }), 'strike');
  assert.equal(q({ inClose: true, dist: 12, los: false }), 'strike');
});
test('rebound: 22 m/s toward him → the toward-him component ≤ −8 m/s, + 3 m/s up, the sideways part kept', () => {
  const away = { x: 0, y: 0, z: 1 }; // (from him to the player)
  const out = rebound({ x: 2, y: 0, z: -22 }, away, CLOSE.lunge, { x: 0, y: 0, z: 0 });
  const toward = -(out.x * away.x + out.y * away.y + out.z * away.z);
  assert.ok(toward <= -8 + 1e-9, `${toward}`); assert.equal(out.y, 3); assert.equal(out.x, 2);
  const away2 = rebound({ x: 0, y: 0, z: 5 }, away); assert.equal(away2.z, 13); // (already moving away: kept, the push adds to it)
});

/**
 * 1-D World Chase at 72 Hz along the route: CloseRange + pursuitSpeed + holdS as in _updateBoss, plus the contact rule (R4.3):
 * gap ≤ contact → rebound (relative speed toward him dropped, 8 m/s away), cooldown 0.8 s; the player then swings back up
 * to `v` again at 12 m/s². Returns the min gap and the contact count.
 */
function contactSim({ v, stag, gap0 = 12, sec = 6 }) {
  const cr = new CloseRange(); let bossS = 1000 + gap0, playerS = 1000, bv = 6, pv = v, ps = v, min = Infinity, hits = 0, lastHit = -9;
  for (let k = 1; k <= Math.round(sec / H); k++) {
    const t = k * H; pv = Math.min(v, pv + 12 * H); playerS += pv * H; ps = chaseRefSpeed(ps, pv, 0, H);
    const gap = bossS - playerS, slow = stag ? 'stagger' : null;
    cr.update(H, gap, stag, true);
    bv = pursuitSpeed(bv, cr.pursuit({ gap, lead: slow ? WORLD_CHASE.leadOpening[slow] : WORLD_CHASE.lead, ps, psNow: pv, slow, tetherStuck: false, breakAway: false }), H, WORLD_CHASE);
    bossS = Math.max(bossS, bossS + bv * H); const c0 = cr.clamps; bossS = cr.holdS(bossS, playerS); if (cr.clamps > c0) bv = Math.max(bv, pv);
    const g = bossS - playerS; min = Math.min(min, g);
    if (g <= CLOSE.lunge.contact && t - lastHit >= CLOSE.lunge.cooldown) { lastHit = t; hits++; const r = rebound({ x: 0, y: 0, z: pv - bv }, { x: 0, y: 0, z: -1 }); pv = bv + r.z; /* (route axis: +s ahead; away from him = −s) */ }
  }
  return { min, hits };
}
for (const stag of [true, false]) for (const v of [12, 18, 22]) test(`contact at 72 Hz, ${stag ? 'staggered' : 'shield up'}, approach ${v} m/s: the gap never drops below 1.5 m`, () => {
  const r = contactSim({ v, stag }); console.log(`  ${stag ? 'staggered' : 'shield up'} ${v} m/s: min gap ${r.min.toFixed(3)} m, ${r.hits} contact(s)`);
  assert.ok(r.min >= 1.5 - 1e-9, `${r.min}`);
  if (stag && v > 6) assert.ok(r.hits >= 1, 'a staggered boss is reachable');
});
// fix round 1 (I2): the push back is horizontal; vertical speed = max(current, 0) + reboundUp — never a dive from below
for (const ay of [-0.3, -0.6, -0.9]) test(`rebound from below (awayDir.y ${ay}) at 18 m/s: vertical ≥ reboundUp, horizontal away ≥ rebound`, () => {
  const h = Math.sqrt(1 - ay * ay), away = { x: 0, y: ay, z: h }; // (from him to the player: player below and behind)
  for (const rel of [{ x: 0, y: 0, z: -18 }, { x: 0, y: 18 * -ay, z: -18 * h }, { x: 1, y: -4, z: -18 }]) { // (level, straight at him, falling)
    const out = rebound(rel, away);
    assert.ok(out.y >= CLOSE.lunge.reboundUp - 1e-9, `y ${out.y}`);
    assert.ok(out.z >= CLOSE.lunge.rebound - 1e-9, `horizontal away ${out.z}`); assert.equal(out.x, rel.x);
  }
  const up = rebound({ x: 0, y: 5, z: -18 }, away); assert.equal(up.y, 5 + CLOSE.lunge.reboundUp); // (already rising: kept + the push)
});
test('rebound: straight above / below him (no horizontal direction) → only the vertical push', () => {
  const out = rebound({ x: 0, y: -10, z: 0 }, { x: 0, y: -1, z: 0 }); assert.deepEqual([out.x, out.y, out.z], [0, CLOSE.lunge.reboundUp, 0]);
});
test('segPointDist: swept contact (a fast frame that passes through him still counts)', async () => {
  const { segPointDist } = await import('../src/worlds/lunge.js'); const O = { x: 0, y: 0, z: 0 };
  assert.equal(segPointDist({ x: 0, y: 0, z: 3 }, { x: 0, y: 0, z: -3 }, O), 0); // (3 m in front → 3 m behind: 0)
  assert.equal(segPointDist({ x: 1, y: 0, z: 3 }, { x: 1, y: 0, z: 2 }, O), Math.hypot(1, 2));
  assert.equal(segPointDist({ x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, O), 2);
});

// ---- v0.49: World Chase — he turns to face the player when the red ring comes on (once per stagger)
const { faceOnRing } = await import('../src/worlds/lunge.js');
test('faceOnRing: true the first time the red ring is on in a stagger; not again in that stagger; again in the next', () => {
  const st = { on: false };
  assert.equal(faceOnRing(st, false, false), false);
  assert.equal(faceOnRing(st, true, false), false); // staggered beyond the ring
  assert.equal(faceOnRing(st, true, true), true);
  assert.equal(faceOnRing(st, true, true), false); assert.equal(faceOnRing(st, true, false), false); assert.equal(st.on, true); // stays turned for the rest of the stagger
  assert.equal(faceOnRing(st, false, false), false); assert.equal(st.on, false); // the stagger ended
  assert.equal(faceOnRing(st, true, true), true);
});
test('faceOnRing does not depend on any stagger count (the fight can be reset mid-run and its counts start over)', () => {
  const st = { on: false }; faceOnRing(st, true, true); faceOnRing(st, false, false);
  assert.equal(faceOnRing(st, true, true), true);
});
