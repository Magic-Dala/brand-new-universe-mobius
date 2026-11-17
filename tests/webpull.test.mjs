// v0.44 web pull: the stroke detector (travel, tolerance, reset, re-arm, tracking), its effect on the swing (direction,
// caps, rope constraints, release momentum, freezes), what must never pull (stationary hands, rig motion, tracking
// recovery, the jet hook), and Green Maniac's pursuit vs a pull surge.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const THREE = await import('three');
const { WebPullDetector, pullStrength } = await import('../src/input/webPull.js');
const { PULL } = await import('../src/data/handCombat.js');
const { Locomotion, isEnvAnchor, swingTuning } = await import('../src/game/locomotion.js');
const { settings } = await import('../src/core/settings.js');
const { CityWorld } = await import('../src/data/cityWorld.js');
const { WORLD_CHASE, pursuitSpeed, chaseRefSpeed, pullLeadCut } = await import('../src/worlds/worldChase.js');

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const DT = 1 / 72;
const BODY = V(0, 1.35, 0), OUT = V(0.3, 0, -1).normalize(); // chest point, direction the arm is stretched in (player-local)
const at = (reach, side = 0) => BODY.clone().addScaledVector(OUT, reach).add(V(side, 0, 0));

// ------------------------------------------------------------------------------------------- detector
/** Feed a detector: steps = [{ to (reach) | pos (fn k→Vector3), dur, held, tracked }] from the previous reach. Returns total strength + log. */
function drive(steps, det = new WebPullDetector(), st = { t: 0, r: 0.6 }) {
  let sum = 0, started = 0; const perStep = [];
  for (const s of steps) {
    const n = Math.max(1, Math.round((s.dur ?? 0.3) / DT)), r0 = st.r, r1 = s.to ?? st.r; let got = 0;
    for (let i = 1; i <= n; i++) {
      st.t += DT; const k = i / n, e = k * k * (3 - 2 * k);
      const hand = s.pos ? s.pos(k) : at(r0 + (r1 - r0) * e);
      const df = det.update({ t: st.t, dt: DT, held: s.held ?? true, tracked: s.tracked ?? true, hand, body: BODY });
      assert.ok(df >= 0, 'never negative'); got += df; if (det.justStarted) started++;
    }
    st.r = r1; sum += got; perStep.push(got);
  }
  return { sum, perStep, started, det, st };
}
const STROKE = { to: 0.3, dur: 0.3 }, RESET = { to: 0.6, dur: 0.3 };

test('strength: travel decides (comfortable distance), speed is a capped bonus, tiny strokes count for almost nothing', () => {
  assert.equal(pullStrength(PULL.minTravel, 5), 0, 'below the minimum travel: nothing');
  assert.ok(Math.abs(pullStrength(PULL.fullTravel, PULL.speedHi) - 1) < 1e-9, 'full travel at a brisk speed = 1');
  assert.ok(Math.abs(pullStrength(PULL.fullTravel, 0) - (1 - PULL.speedShare)) < 1e-9, 'a slow full stroke still gives most of it');
  assert.equal(pullStrength(2, 50), 1, 'violent / huge strokes are capped at 1');
  assert.ok(pullStrength(0.11, 5) < 0.12, 'a 4 cm-over-minimum twitch is tiny');
  let prev = -1; for (let x = 0; x <= 0.6; x += 0.01) { const s = pullStrength(x, 1); assert.ok(s >= prev - 1e-12); prev = s; }
});

test('detector: a comfortable backward stroke counts once; the strength arrives during the stroke, none while holding', () => {
  const r = drive([{ dur: 0.2 }, STROKE, { dur: 2 }]);
  assert.equal(r.perStep[0], 0, 'web held, hand out in front and still: nothing');
  assert.ok(r.perStep[1] > 0.85 && r.perStep[1] <= 1, `full 30 cm stroke ≈ full strength (${r.perStep[1].toFixed(2)})`);
  assert.equal(r.perStep[2], 0, 'holding the hand at the chest afterwards gives nothing more');
  assert.equal(r.started, 1); assert.equal(r.det.strokes, 1);
  const slow = drive([{ dur: 0.2 }, { to: 0.3, dur: 1.6 }]); // ≈ 0.19 m/s: no flick needed
  assert.ok(slow.sum > 0.7 && slow.sum < r.sum, `a slow stroke works too (${slow.sum.toFixed(2)})`);
  const short = drive([{ dur: 0.2 }, { to: 0.47, dur: 0.25 }]);
  assert.ok(short.sum > 0.1 && short.sum < 0.55, `a half stroke gives part (${short.sum.toFixed(2)})`);
});

test('detector: no thrust from a stationary hand — out in front, at the chest, or jittering', () => {
  assert.equal(drive([{ dur: 6 }]).sum, 0, 'extended and still');
  assert.equal(drive([{ dur: 6 }], undefined, { t: 0, r: 0.25 }).sum, 0, 'held at the chest from the start');
  let k = 0; const jitter = drive([{ dur: 6, pos: () => at(0.55 + 0.012 * Math.sin((k += 1) * 1.7), 0.006 * Math.cos(k * 2.3)) }]);
  assert.equal(jitter.sum, 0, 'centimetre tracking jitter'); assert.equal(jitter.det.strokes, 0);
  let j = 0; const sway = drive([{ dur: 6, pos: () => at(0.55 + 0.03 * Math.sin((j += 1) * 0.12)) }]); // ±3 cm sway at ~1.4 Hz
  assert.equal(sway.sum, 0, 'small oscillations stay below the minimum travel');
  // a slow drift toward the body that never becomes a stroke does not "spend" the hand: a real stroke right after works
  const drift = drive([{ to: 0.56, dur: 1.5 }, { dur: 0.5 }, STROKE], undefined, { t: 0, r: 0.6 });
  assert.ok(drift.perStep[2] > 0.6, `stroke after a drift (${drift.perStep[2].toFixed(2)})`);
});

test('detector: a clear forward reset is required; repeated deliberate strokes each count; small oscillations cannot farm boosts', () => {
  // stroke, then wiggle near the chest (2–8 cm) — nothing more
  const w = drive([{ dur: 0.2 }, STROKE, { to: 0.36, dur: 0.15 }, { to: 0.3, dur: 0.15 }, { to: 0.38, dur: 0.15 }, { to: 0.3, dur: 0.15 }, { to: 0.37, dur: 0.15 }, { to: 0.29, dur: 0.15 }]);
  assert.equal(w.det.strokes, 1); assert.ok(w.sum <= 1, 'wiggling after a stroke adds nothing');
  for (let i = 2; i < w.perStep.length; i++) assert.equal(w.perStep[i], 0);
  // three deliberate strokes with full resets
  const three = drive([{ dur: 0.2 }, STROKE, RESET, STROKE, RESET, STROKE]);
  assert.equal(three.det.strokes, 3); assert.ok(three.perStep[1] > 0.85 && three.perStep[3] > 0.85 && three.perStep[5] > 0.85);
  assert.equal(three.perStep[2] + three.perStep[4], 0, 'the forward reset itself never pulls');
  // a reset that is too short does not re-arm
  const half = drive([{ dur: 0.2 }, STROKE, { to: 0.38, dur: 0.2 }, { to: 0.26, dur: 0.2 }]);
  assert.equal(half.det.strokes, 1, 'an 8 cm reset is not a reset');
  // rapid 12 cm pumping for 5 s: each mini-stroke is worth little
  const seq = [{ dur: 0.2 }]; for (let i = 0; i < 25; i++) seq.push({ to: 0.46, dur: 0.1 }, { to: 0.6, dur: 0.1 });
  const pump = drive(seq), full = drive([{ dur: 0.2 }, STROKE, RESET, STROKE, RESET, STROKE, RESET, STROKE, RESET, STROKE]); // 5 full strokes in ~3 s
  const pumpRate = pump.sum / pump.st.t, fullRate = full.sum / full.st.t;
  assert.ok(pumpRate < fullRate * 0.35, `pumping (${pumpRate.toFixed(2)}/s) is far worse than deliberate strokes (${fullRate.toFixed(2)}/s)`);
  assert.ok(pump.det.strokes <= 14, `the cooldown skips pumps (${pump.det.strokes} of 25 counted)`);
});

test('detector: direction tolerance — toward the body within ~50°, not sideways / up / around the body', () => {
  const dir = (deg) => { const a = THREE.MathUtils.degToRad(deg), side = V(-OUT.z, 0, OUT.x); return (k) => at(0.6).addScaledVector(OUT, -0.3 * k * Math.cos(a)).addScaledVector(side, 0.3 * k * Math.sin(a)); };
  assert.ok(drive([{ dur: 0.2 }, { pos: dir(0), dur: 0.3 }]).sum > 0.85, 'straight back');
  assert.ok(drive([{ dur: 0.2 }, { pos: dir(30), dur: 0.3 }]).sum > 0.5, '30° off still pulls');
  assert.equal(drive([{ dur: 0.2 }, { pos: dir(90), dur: 0.3 }]).sum, 0, 'a sideways sweep');
  assert.equal(drive([{ dur: 0.2 }, { pos: (k) => at(0.6).add(V(0, 0.3 * k, 0)), dur: 0.3 }]).sum, 0, 'raising the hand');
  const arc = (k) => BODY.clone().addScaledVector(OUT.clone().applyAxisAngle(V(0, 1, 0), k * 1.2), 0.6); // swinging the arm around at constant reach
  assert.equal(drive([{ dur: 0.2 }, { pos: arc, dur: 0.4 }]).sum, 0, 'an arc around the body');
  assert.equal(drive([{ dur: 0.2 }, { to: 0.9, dur: 0.3 }], undefined, { t: 0, r: 0.6 }).sum, 0, 'pushing forward');
});

test('detector: tracking loss / recovery / glitches never pull; the web must be held; a fresh web is ready at once', () => {
  // the hand "teleports" 30 cm closer in one frame (tracking correction)
  const g = drive([{ dur: 0.2 }, { pos: () => at(0.3), dur: DT }, { dur: 1 }]); assert.equal(g.sum, 0, 'a one-frame jump');
  // lost during the pull-back, comes back at the chest
  const l = drive([{ dur: 0.2 }, { to: 0.5, dur: 0.05 }, { to: 0.3, dur: 0.3, tracked: false }, { dur: 0.5 }]);
  assert.ok(l.sum < 0.12, `only what was seen before the loss (${l.sum.toFixed(2)})`); assert.equal(l.perStep[2] + l.perStep[3], 0);
  // lost while extended, reappears at the chest, then moves a little: nothing — and a reset is required first
  const r = drive([{ dur: 0.2 }, { dur: 0.3, tracked: false }, { to: 0.3, dur: DT * 2 }, { to: 0.27, dur: 0.3 }]);
  assert.equal(r.sum, 0, 'recovery is not a stroke');
  const r2 = drive([RESET, STROKE], r.det, r.st); assert.ok(r2.perStep[1] > 0.85, 'after a forward reset it works again');
  // uneven frame times (a 3 ms frame right after a long one) are not a glitch: the stroke still counts in full
  { const det = new WebPullDetector(); let t = 0, sum = 0, r = 0.6; const step = (dt, to) => { t += dt; r = to; sum += det.update({ t, dt, held: true, tracked: true, hand: at(r), body: BODY }); };
    for (let i = 0; i < 10; i++) step(DT, 0.6);
    for (let i = 1; i <= 12; i++) step(i % 3 === 0 ? 0.003 : 0.03, 0.6 - 0.025 * i);
    assert.ok(sum > 0.85, `frame-time jitter does not abort a stroke (${sum.toFixed(2)})`); }
  // not holding the web pose / no web
  assert.equal(drive([{ dur: 0.2, held: false }, { ...STROKE, held: false }]).sum, 0);
  // re-grab: pose released mid-way and re-formed → state starts over, the leftover motion is not a stroke from thin air
  const re = drive([{ dur: 0.2 }, { to: 0.45, dur: 0.15 }, { to: 0.44, dur: 0.05, held: false }, { to: 0.3, dur: 0.15 }]);
  assert.ok(re.perStep[3] <= pullStrength(0.14, 9) + 1e-9, `only the 14 cm after the new web count, not the 30 cm in total (${re.perStep[3].toFixed(2)})`);
  // a web fired with the arm out is ready immediately (Shoot → attach → pull back)
  assert.ok(drive([STROKE]).sum > 0.85);
});

test('detector: the frame of reference does not matter — moving / turning the whole tracking space with the body is never a pull', () => {
  const det = new WebPullDetector(); let sum = 0, t = 0;
  for (let i = 0; i < 400; i++) {
    t += DT;
    const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), i * 0.11), off = V(Math.sin(i * 0.3) * 4 + i * 0.25, Math.cos(i * 0.2), i % 50 === 0 ? 300 : -i * 0.3); // snap turns, locomotion, rebases
    sum += det.update({ t, dt: DT, held: true, tracked: true, hand: at(0.55).applyQuaternion(q).add(off), body: BODY.clone().applyQuaternion(q).add(off) });
  }
  assert.equal(sum, 0); assert.equal(det.strokes, 0);
});

test('flick guard: busy during a stroke and its forward reset (no web re-fire from that hand), free otherwise', () => {
  const det = new WebPullDetector(), st = { t: 0, r: 0.6 };
  drive([{ dur: 0.2 }], det, st); assert.equal(det.busy(st.t), false, 'idle hold: the web flick still works');
  drive([{ to: 0.4, dur: 0.15 }], det, st); assert.equal(det.busy(st.t), true, 'mid-stroke');
  drive([{ to: 0.3, dur: 0.1 }, { dur: 0.4 }], det, st); assert.equal(det.busy(st.t), true, 'spent: waiting for the reset');
  drive([{ to: 0.5, dur: 0.15 }], det, st); assert.equal(det.busy(st.t), true, 'during / right after the forward reset');
  drive([{ dur: PULL.flickGuard + 0.1 }], det, st); assert.equal(det.busy(st.t), false, 'released again');
  // a web fired with the hand near the chest: extending it (a flick) is not blocked — there was no stroke
  const near = new WebPullDetector(), s2 = { t: 0, r: 0.25 };
  drive([{ dur: 0.2 }, { to: 0.6, dur: 0.12 }], near, s2); assert.equal(near.busy(s2.t), false);
});

// ------------------------------------------------------------------------------------------- locomotion
const W = new CityWorld({ autoReady: true }); W.reset({ mode: 'story' });
W.update({ x: 0, y: 70, z: -100 }, undefined, 1 / 60, { force: true });
const tile1 = W.tileCell(1);
const ANCHOR = tile1.anchors.find((a) => a.kind === 'roof' && a.normal[0] < -0.9 && W.building(a.building).tiers.length === 1 && W.building(a.building).h > 50) || tile1.anchors.find((a) => a.kind === 'roof' && a.normal[0] < -0.9);

function rig() {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), player = new THREE.Group();
  player.add(camera); scene.add(player); camera.position.set(0, 1.6, 0);
  const hl = () => ({ valid: true, pos: at(0.6) });
  const hub = { grip: { left: { valid: false }, right: { valid: false } }, haptic() {}, aim: { left: { valid: false }, right: { valid: false } }, mode: { left: 'hand', right: 'hand' }, machines: { left: { web: { conf: 0 } }, right: { web: { conf: 0 } } },
    webHeld: { left: false, right: true }, trackingLost: { left: false, right: false }, ctx: { menuOpen: false }, events: [], teleport: { hand: 'right' }, pointers: { left: { valid: false }, right: { valid: false } },
    handLocal: { left: hl(), right: hl() }, pullBusy: { left: false, right: false }, aimOriginNow: (h, o) => o.copy(player.position).add(V(0, 1.3, 0)) };
  const beams = [];
  const app = { scene, camera, world: { player }, city: {}, cityWorld: W, hub, fx: { web: () => { const b = { pulse: 0 }; beams.push(b); return b; }, releaseBeam() {} } };
  const loco = new Locomotion(app); loco.setCityMode([]); loco.grounded = false;
  const S = { t: 0, reach: { left: 0.6, right: 0.6 } };
  const chest = () => loco.feet().add(V(0, 1.3, 0));
  const put = (dx = -10, dy = -30, dz = 0) => { player.position.set(ANCHOR.p.x + dx, ANCHOR.p.y + dy - 1.3, ANCHOR.p.z + dz); player.updateMatrixWorld(true); };
  const attach = (h = 'right', a = ANCHOR) => { hub.webHeld[h] = true; const o = chest(); return a === ANCHOR ? loco.tryAttach({ hand: h, origin: o, dir: a.p.clone().sub(o).normalize() }) : loco.attachTo(a, { hand: h, origin: o, dir: a.p.clone().sub(o).normalize() }); };
  /** Advance the real swing for `dur` s while the given hands move their reach (eased). hands = { right: 0.3, left: 0.6 } */
  const run = (dur, hands = {}, each = null) => {
    const n = Math.max(1, Math.round(dur / DT)), from = { ...S.reach };
    for (let i = 1; i <= n; i++) {
      S.t += DT; const k = i / n, e = k * k * (3 - 2 * k);
      for (const h of ['left', 'right']) if (hands[h] != null) { S.reach[h] = from[h] + (hands[h] - from[h]) * e; hub.handLocal[h].pos.copy(at(S.reach[h])); }
      loco._updateSwing(DT, S.t, hub); each?.(i);
    }
  };
  return { app, hub, loco, player, camera, S, chest, put, attach, run, beams };
}
const stroke = (R, h = 'right') => { R.run(0.3, { [h]: 0.3 }); };
const reset = (R, h = 'right') => { R.run(0.3, { [h]: 0.6 }); };

test('anchor filter: only fixed environmental anchors can be pulled', () => {
  assert.equal(isEnvAnchor(ANCHOR), true);
  assert.equal(isEnvAnchor({ id: 'JET-HOOK', p: V(0, 0, 0), valid: true, moving: true, kind: 'jet' }), false, 'the Green Bat Jet hook');
  assert.equal(isEnvAnchor({ p: V(0, 0, 0), valid: true, moving: true }), false, 'any moving target');
  assert.equal(isEnvAnchor({ ...ANCHOR, valid: false }), false); assert.equal(isEnvAnchor(null), false);
});

test('pull direction: the speed is added toward THAT hand\'s anchor — ahead, to the side (redirect) or behind (brake)', () => {
  for (const [name, off, v0, check] of [
    ['anchor ahead + above', [0, -25, 14], V(0, 0, -6), (dv) => assert.ok(dv.z < -1 && dv.y > 1, 'forward and up')],
    ['anchor to the side', [-22, -8, 0], V(0, 0, -8), (dv, v) => { assert.ok(dv.x > 3, 'pulled sideways toward it'); assert.ok(Math.abs(dv.z) < 0.5, 'no generic forward boost'); assert.ok(v.x > 3 && v.z < -7, 'existing momentum kept'); }],
    ['anchor behind', [0, -10, -20], V(0, 0, -10), (dv, v) => { assert.ok(dv.z > 2, 'pulled back toward it'); assert.ok(v.z > -9 && v.z < 0, `forward speed reduced (brake): ${v.z.toFixed(1)}`); }],
  ]) {
    const R = rig(); R.put(...off); assert.ok(R.attach(), name);
    const a = R.loco.attach, body = R.chest(), to = ANCHOR.p.clone().sub(body).normalize();
    R.loco.vel.copy(v0); a.len = 80; // (slack rope: the constraint does not interfere with the measurement)
    const before = R.loco.vel.clone(); let t = 0;
    const pull = (reach) => { t += DT; R.hub.handLocal.right.pos.copy(at(reach)); R.loco._pullDecay(DT); R.loco._updatePull(DT, t, R.hub, body); };
    pull(0.6); for (let i = 1; i <= 22; i++) pull(0.6 - 0.3 * (i / 22)); for (let i = 0; i < 40; i++) pull(0.3);
    const dv = R.loco.vel.clone().sub(before);
    assert.ok(dv.length() > PULL.boost * 0.8 && dv.length() <= PULL.boost + 1e-6, `${name}: one stroke adds ${dv.length().toFixed(2)} m/s (≤ ${PULL.boost})`);
    assert.ok(dv.clone().normalize().dot(to) > 0.999, `${name}: exactly toward the anchor`);
    check(dv, R.loco.vel);
    assert.equal(R.loco.stats.pulls, 1); assert.ok(Math.abs(R.loco.stats.pullDv - dv.length()) < 1e-6);
  }
});

test('pull is an acceleration, not a step: the speed arrives over the stroke; the cue fires once', () => {
  const R = rig(); R.put(0, -25, 14); R.attach(); R.loco.attach.len = 80; R.loco.vel.set(0, 0, 0);
  const body = R.chest(); let t = 0, maxStep = 0, prev = 0;
  const pull = (reach) => { t += DT; R.hub.handLocal.right.pos.copy(at(reach)); R.loco._pullDecay(DT); R.loco._updatePull(DT, t, R.hub, body); const s = R.loco.vel.length(); maxStep = Math.max(maxStep, s - prev); prev = s; };
  pull(0.6); for (let i = 1; i <= 22; i++) pull(0.6 - 0.3 * (i / 22)); for (let i = 0; i < 40; i++) pull(0.3);
  assert.ok(maxStep < PULL.boost * 0.12, `largest per-frame change ${maxStep.toFixed(2)} m/s (≈ ${(maxStep / DT).toFixed(0)} m/s²)`);
  assert.equal(R.loco.stats.pulls, 1); assert.equal(R.beams.filter((b) => b.pulse > 0).length, 1, 'the strand pulses once');
  assert.equal(R.hub.pullBusy.right, true, 'the hub is told (no flick re-fire during the reset)');
});

test('real swing: a pull makes the player clearly faster toward the anchor than the same swing without it; speed limits hold', () => {
  // a taut rope under automatic retraction (the normal swing): the pull must still be felt
  const sim = (pull, after = 0.1) => { const R = rig(); R.put(-14, -32, 10); R.attach(); R.loco.vel.set(0, 0, -6); R.run(0.4); if (pull) stroke(R); else R.run(0.3); R.run(after); return R; };
  const A = sim(true), B = sim(false);
  const toA = ANCHOR.p.clone().sub(A.chest()).normalize();
  const gain = A.loco.vel.dot(toA) - B.loco.vel.dot(toA);
  assert.ok(gain > 2, `≥ 2 m/s more toward the anchor right after one stroke (${gain.toFixed(2)})`);
  assert.ok(A.loco.vel.length() > B.loco.vel.length() + 0.5, `and faster overall (${A.loco.vel.length().toFixed(1)} vs ${B.loco.vel.length().toFixed(1)} m/s)`);
  const A2 = sim(true, 1.0), B2 = sim(false, 1.0), closer = B2.chest().distanceTo(ANCHOR.p) - A2.chest().distanceTo(ANCHOR.p), took = B2.loco.attach.len - A2.loco.attach.len;
  assert.ok(closer > 1.2, `it actually closed distance to the anchor (${closer.toFixed(2)} m closer than without the pull)`);
  assert.ok(took > 1 && took <= PULL.boost * PULL.hold * 1.25, `limited extra rope take-in (${took.toFixed(2)} m)`);
  { // no snap: the body's position changes smoothly through the stroke (never more per frame than its speed allows)
    const R = rig(); R.put(-14, -32, 10); R.attach(); R.loco.vel.set(0, 0, -6); R.run(0.4); let prev = R.chest(), worst = 0;
    R.run(0.3, { right: 0.3 }, () => { const c = R.chest(); worst = Math.max(worst, c.distanceTo(prev) / DT); prev = c; });
    assert.ok(worst < swingTuning().maxSpeed + PULL.overMax + settings.swingReelSpeed + 0.5, `largest per-frame move ≙ ${worst.toFixed(1)} m/s`); }
  // many strokes: never past limit + over-limit; rope never shorter than the minimum; the rope constraint holds
  const R = rig(); R.put(-14, -32, 10); R.attach(); R.loco.vel.set(0, 0, -6);
  const lim = swingTuning().maxSpeed + PULL.overMax;
  for (let k = 0; k < 8 && R.loco.attach; k++) {
    for (const reach of [0.3, 0.6]) R.run(0.3, { right: reach }, () => {
      assert.ok(R.loco.vel.length() <= lim + 1e-6, `speed ${R.loco.vel.length().toFixed(1)} ≤ ${lim}`);
      const r = R.loco.attach; if (r) { assert.ok(r.len >= settings.swingMinRope - 1e-9); assert.ok(R.chest().distanceTo(r.anchor.p) <= r.len + 0.35, 'rope constraint'); }
    });
  }
  assert.ok(R.loco.stats.pulls >= 3);
});

test('capped strength: rapid pumping and long sessions are bounded by the shared budget', () => {
  const R = rig(); R.put(0, -25, 14); R.attach(); R.loco.attach.len = 80;
  const body = R.chest(); let t = 0;
  const pull = (reach) => { t += DT; R.hub.handLocal.right.pos.copy(at(reach)); R.loco._pullDecay(DT); R.loco._updatePull(DT, t, R.hub, body); };
  pull(0.6);
  for (let k = 0; k < 12; k++) { for (let i = 1; i <= 8; i++) pull(0.6 - 0.3 * (i / 8)); for (let i = 1; i <= 8; i++) pull(0.3 + 0.3 * (i / 8)); } // 12 violent full strokes in ~2.7 s
  const bound = (PULL.budgetMax + PULL.budgetRefill * t) * PULL.boost;
  assert.ok(R.loco.stats.pullDv <= bound + 1e-6, `${R.loco.stats.pullDv.toFixed(1)} m/s ≤ budget bound ${bound.toFixed(1)}`);
  assert.ok(R.loco.stats.pullDv < 12 * PULL.boost * 0.45, 'far less than 12 full strokes');
  assert.ok(R.loco.pull.over <= PULL.overMax + 1e-9);
});

test('no thrust: stationary hands, virtual movement + snap turns, tracking loss / recovery, menu open, pull switched off', () => {
  const idle = rig(); idle.put(-14, -32, 10); idle.attach(); idle.loco.vel.set(0, 0, -6);
  idle.run(1.5, {}, (i) => { if (i % 30 === 0) idle.loco.snapTurn(i % 60 ? 1 : -1); }); // swinging + snap turns, hands still in player space
  assert.equal(idle.loco.stats.pulls, 0); assert.equal(idle.loco.stats.pullDv, 0);
  const chestHold = rig(); chestHold.put(-14, -32, 10); chestHold.S.reach.right = 0.25; chestHold.hub.handLocal.right.pos.copy(at(0.25)); chestHold.attach(); chestHold.run(2);
  assert.equal(chestHold.loco.stats.pullDv, 0, 'hand resting at the chest');
  // the whole tracking space jumps (recentre): head and hands move together
  const rc = rig(); rc.put(-14, -32, 10); rc.attach();
  rc.run(1.2, {}, (i) => { if (i === 30) { rc.camera.position.add(V(0.4, 0, 0.5)); for (const h of ['left', 'right']) rc.hub.handLocal[h].pos.add(V(0.4, 0, 0.5)); } });
  assert.equal(rc.loco.stats.pullDv, 0, 'tracking-space correction');
  // the head alone bobs / leans a few centimetres
  const hb = rig(); hb.put(-14, -32, 10); hb.attach(); const y0 = hb.camera.position.y;
  hb.run(2, {}, (i) => { hb.camera.position.y = y0 + 0.03 * Math.sin(i * 0.5); hb.camera.position.z = 0.03 * Math.sin(i * 0.31); });
  assert.equal(hb.loco.stats.pullDv, 0, 'head bob');
  // tracking lost while extended, back at the chest
  const tl = rig(); tl.put(-14, -32, 10); tl.attach(); tl.run(0.3);
  tl.hub.trackingLost.right = true; tl.hub.handLocal.right.valid = false; tl.run(0.2);
  tl.hub.trackingLost.right = false; tl.hub.handLocal.right.valid = true; tl.S.reach.right = 0.3; tl.hub.handLocal.right.pos.copy(at(0.3)); tl.run(0.6);
  assert.equal(tl.loco.stats.pullDv, 0, 'tracking recovery');
  // menu open / setting off
  const menu = rig(); menu.put(-14, -32, 10); menu.attach(); menu.hub.ctx.menuOpen = true; menu.run(0.3); stroke(menu); assert.equal(menu.loco.stats.pullDv, 0, 'menu open');
  const off = rig(); off.put(-14, -32, 10); off.attach(); settings.webPull = false; try { off.run(0.3); stroke(off); } finally { settings.webPull = true; } assert.equal(off.loco.stats.pullDv, 0, 'webPull off');
  // not holding the pose any more (letting go) is a release, not a pull
  const rel = rig(); rel.put(-14, -32, 10); rel.attach(); rel.run(0.2); rel.hub.webHeld.right = false; stroke(rel); assert.equal(rel.loco.stats.pullDv, 0); assert.equal(rel.loco.attach, null);
});

test('non-environmental attachments: the jet hook (moving anchor) is never pulled toward, with either hand', () => {
  const R = rig(); R.put(-14, -32, 10);
  const jet = { id: 'JET-HOOK', p: ANCHOR.p.clone().add(V(-4, -6, 6)), valid: true, moving: true, building: null, cell: null, kind: 'jet' };
  assert.ok(R.attach('right', jet)); R.loco.attach.len = 80; R.run(0.3);
  const v0 = R.loco.stats.pullDv; stroke(R); reset(R); stroke(R);
  assert.equal(R.loco.stats.pullDv, v0); assert.equal(R.loco.stats.pulls, 0); assert.equal(R.hub.pullBusy.right, false);
  // the other hand on a building anchor still pulls — toward the BUILDING anchor only
  assert.ok(R.attach('left')); R.loco.ropeOf('left').len = 80;
  const body = R.chest(), before = R.loco.vel.clone(); let t = 100;
  const pull = (reach) => { t += DT; for (const h of ['left', 'right']) R.hub.handLocal[h].pos.copy(at(reach)); R.loco._pullDecay(DT); R.loco._updatePull(DT, t, R.hub, body); };
  pull(0.6); pull(0.6); for (let i = 1; i <= 22; i++) pull(0.6 - 0.3 * (i / 22)); for (let i = 0; i < 40; i++) pull(0.3);
  const dv = R.loco.vel.clone().sub(before);
  assert.ok(dv.length() > 3 && dv.clone().normalize().dot(ANCHOR.p.clone().sub(body).normalize()) > 0.999, 'only toward the fixed anchor');
});

test('two webs: both rope constraints hold while pulling with both hands, and the combined strength is capped', () => {
  const R = rig(); R.put(-12, -25, 0); R.hub.webHeld.left = true;
  const body0 = R.chest();
  const second = W.anchorsNear(body0.x, body0.z, settings.anchorMaxDist, []).find((a) => a !== ANCHOR && a.valid && a.p.y > body0.y + 8 && a.p.distanceTo(body0) < 40 && !R.loco.occluded(body0, a.p, a.building));
  assert.ok(second && R.attach('right') && R.attach('left', second)); assert.equal(R.loco.ropes.length, 2);
  for (let k = 0; k < 4; k++) for (const reach of [0.3, 0.6]) R.run(0.3, { left: reach, right: reach }, () => {
    const c = R.chest(); for (const r of R.loco.ropes) { assert.ok(c.distanceTo(r.anchor.p) <= r.len + 0.35, `rope ${r.hand} stretched ${(c.distanceTo(r.anchor.p) - r.len).toFixed(2)}`); assert.ok(r.len >= settings.swingMinRope - 1e-9); }
    if (R.loco.ropes.length === 2) assert.ok(R.loco.ropes[0].len + R.loco.ropes[1].len >= R.loco.ropes[0].anchor.p.distanceTo(R.loco.ropes[1].anchor.p), 'the two ropes still span the gap between their anchors');
  });
  assert.equal(R.loco.ropes.length, 2, 'both still held');
  // one simultaneous stroke with both hands vs the same stroke with one hand
  const one = (hands) => { const Q = rig(); Q.put(-12, -25, 0); Q.hub.webHeld.left = true; Q.attach('right'); Q.attach('left', second); for (const r of Q.loco.ropes) r.len = 90; const body = Q.chest(); let t = 0;
    const pull = (reach) => { t += DT; for (const h of hands) Q.hub.handLocal[h].pos.copy(at(reach)); Q.loco._pullDecay(DT); Q.loco._updatePull(DT, t, Q.hub, body); };
    pull(0.6); for (let i = 1; i <= 22; i++) pull(0.6 - 0.3 * (i / 22)); for (let i = 0; i < 30; i++) pull(0.3); return Q.loco.stats.pullDv; };
  const single = one(['right']), both = one(['left', 'right']);
  assert.ok(both > single * 1.05, 'two hands help a little');
  assert.ok(both < single * 1.45, `…but far from double: ${both.toFixed(2)} vs ${single.toFixed(2)} m/s`);
});

test('release: the pulled momentum is kept through the release (with the release boost) and coasts into the next swing', () => {
  const R = rig(); R.put(-14, -32, 10); R.attach(); R.loco.vel.set(0, 0, -15); R.run(0.2);
  stroke(R); const vPull = R.loco.vel.length();
  assert.ok(R.loco.pull.over > 1, 'a pull at speed opens the over-limit');
  R.hub.webHeld.right = false; R.run(0.2); // 150 ms grace, then released (not silent → release boost)
  assert.equal(R.loco.attach, null); assert.equal(R.loco.stats.releases, 1);
  const vRel = R.loco.vel.length(), lim = swingTuning().maxSpeed;
  assert.ok(vRel >= Math.min(vPull, lim) - 2.5, `momentum kept: ${vPull.toFixed(1)} → ${vRel.toFixed(1)} m/s`);
  assert.ok(vRel <= lim + PULL.overMax + 1e-6, 'release boost + pull never exceed limit + over-limit');
  R.run(PULL.overMax / PULL.overDecay + 0.3); assert.ok(R.loco.vel.length() <= lim + 1e-6, 'back under the normal limit after the over-limit decayed');
  assert.equal(R.loco.pull.over, 0); assert.equal(R.loco.pull.pending.right, 0, 'nothing queued after the release');
  // comfort mode: gentler, never over the (lower) limit
  settings.comfortMode = true;
  try { const C = rig(); C.put(0, -25, 14); C.attach(); C.loco.attach.len = 80; C.loco.vel.set(0, 0, 0); const body = C.chest(); let t = 0;
    const pull = (reach) => { t += DT; C.hub.handLocal.right.pos.copy(at(reach)); C.loco._pullDecay(DT); C.loco._updatePull(DT, t, C.hub, body); };
    pull(0.6); for (let i = 1; i <= 22; i++) pull(0.6 - 0.3 * (i / 22)); for (let i = 0; i < 40; i++) pull(0.3);
    assert.ok(Math.abs(C.loco.stats.pullDv - PULL.boost * PULL.comfortScale) < PULL.boost * 0.12, `comfort pull ${C.loco.stats.pullDv.toFixed(2)} m/s`); assert.equal(C.loco.pull.over, 0);
  } finally { settings.comfortMode = false; }
});

test('minimum rope: no pull into the anchor\'s wall — the force fades out near the minimum rope length', () => {
  const R = rig(); R.put(0, -(settings.swingMinRope + 0.3), 0); assert.ok(R.loco.attachTo(ANCHOR, { hand: 'right', origin: R.chest(), dir: V(0, 1, 0) }));
  const body = R.chest(); let t = 0; R.loco.vel.set(0, 0, 0);
  const pull = (reach) => { t += DT; R.hub.handLocal.right.pos.copy(at(reach)); R.loco._pullDecay(DT); R.loco._updatePull(DT, t, R.hub, body); };
  pull(0.6); for (let i = 1; i <= 22; i++) pull(0.6 - 0.3 * (i / 22)); for (let i = 0; i < 40; i++) pull(0.3);
  assert.equal(R.loco.stats.pullDv, 0); assert.ok(R.loco.attach.len >= settings.swingMinRope);
});

test('pause / freeze / scripted motion / restart placement: no pull happens and none carries over', () => {
  // end-of-run freeze mid-stroke
  const F = rig(); F.put(-14, -32, 10); F.attach(); F.run(0.3); F.run(0.12, { right: 0.45 });
  assert.ok(F.loco.pull.pending.right > 0 || F.loco.stats.pullDv > 0, 'a stroke was under way');
  F.loco.freeze(); const p = F.player.position.clone(), dv = F.loco.stats.pullDv;
  for (let i = 0; i < 60; i++) { F.S.t += DT; F.hub.handLocal.right.pos.copy(at(0.45 - 0.2 * (i / 60))); F.loco.update(DT, F.S.t); }
  assert.ok(F.player.position.equals(p), 'frozen in place'); assert.equal(F.loco.vel.length(), 0); assert.equal(F.loco.stats.pullDv, dv);
  assert.equal(F.loco.pull.pending.right, 0); assert.equal(F.loco.pull.over, 0); assert.equal(F.loco.pull.surge, 0); assert.equal(F.hub.pullBusy.right, false);
  F.loco.unfreeze(); assert.equal(F.loco.pull.right.state, 'idle');
  // scripted motion (story web dash / landing)
  const S = rig(); S.put(-14, -32, 10); S.attach(); S.run(0.3); S.run(0.12, { right: 0.45 }); S.loco.scripted = true; const dv2 = S.loco.stats.pullDv;
  for (let i = 0; i < 40; i++) { S.S.t += DT; S.hub.handLocal.right.pos.copy(at(0.45 - 0.15 * (i / 40))); S.loco.update(DT, S.S.t); }
  assert.equal(S.loco.stats.pullDv, dv2); assert.equal(S.loco.pull.pending.right, 0);
  // restart / checkpoint / scene transition: placeAt and off() clear everything
  const P = rig(); P.put(-14, -32, 10); P.attach(); P.loco.vel.set(0, 0, -15); P.run(0.2); stroke(P);
  assert.ok(P.loco.pull.over > 0 && P.loco.pull.surge > 0);
  P.loco.detach(true); P.loco.placeAt(V(0, 80, -100));
  assert.equal(P.loco.pull.over, 0); assert.equal(P.loco.pull.surge, 0); assert.equal(P.loco.pull.budget, PULL.budgetMax); assert.equal(P.loco.vel.length(), 0);
  const O = rig(); O.put(-14, -32, 10); O.attach(); O.run(0.3); O.run(0.12, { right: 0.45 }); O.loco.off();
  assert.equal(O.loco.ropes.length, 0); assert.equal(O.loco.pull.pending.right, 0); assert.equal(O.loco.pull.right.state, 'idle');
  // a paused world chase / open menu simply does not call update(): nothing accumulates while the hands move
  const Z = rig(); Z.put(-14, -32, 10); Z.attach(); Z.run(0.3); const st = Z.loco.pull.right.state, dv3 = Z.loco.stats.pullDv;
  Z.hub.handLocal.right.pos.copy(at(0.3)); // (the player pulls their hand in while paused)
  assert.equal(Z.loco.pull.right.state, st); assert.equal(Z.loco.stats.pullDv, dv3);
  Z.S.reach.right = 0.3; Z.run(0.5); assert.ok(Z.loco.stats.pullDv - dv3 < 0.01, 'the jump on resume is treated as a tracking jump, not a stroke');
});

// ------------------------------------------------------------------------------------------- Green Maniac's pursuit
/** 1-D chase along the route: the player cruises at `cruise`, pulls add a decaying burst; Green Maniac follows the v0.42 pursuit + the v0.44 pull rules. */
function chase({ pulls = [], cruise = 13, T = 14, P = WORLD_CHASE.pull, slow = null } = {}) {
  const C = { ...WORLD_CHASE, pull: P };
  let ps = 0, pv = cruise, bossS = C.lead, playerS = 0, bv = cruise, ref = cruise, surge = 0, dvSum = 0, extra = 0;
  const st = { dv: 0, cut: 0, hold: 0 }, log = [];
  for (let t = 0; t < T; t += DT) {
    for (const [tp, dv] of pulls) if (t >= tp && t - DT < tp) { extra += dv; surge += dv; dvSum += dv; }
    extra = Math.min(PULL.overMax + 2, Math.max(0, extra - PULL.overDecay * DT * 1.2)); surge *= Math.exp(-DT / PULL.surgeTau); // the burst is given back (speed limit / drag), like the real swing
    pv = cruise + extra; playerS += pv * DT;
    ref = chaseRefSpeed(ref, pv, surge, DT, P);
    const cut = pullLeadCut(st, dvSum, DT, P), gap = bossS - playerS;
    const lead = slow ? C.leadOpening[slow] : Math.max(P.minLead, C.lead - cut);
    bv = pursuitSpeed(bv, { gap, lead, ps: ref, psNow: pv, slow, tetherStuck: false, breakAway: false }, DT, C);
    bossS += bv * DT; log.push({ t, gap: bossS - playerS, bv, lead });
    void ps;
  }
  const gapAt = (t) => log[Math.min(log.length - 1, Math.round(t / DT))].gap;
  return { log, gapAt, min: Math.min(...log.map((x) => x.gap)), minLead: Math.min(...log.map((x) => x.lead)) };
}
const OLD = { ...WORLD_CHASE.pull, surgeFollow: 1, leadPerMps: 0 }; // v0.42 behaviour: he matches the speed at once, gives no ground

test('pursuit: without pulls nothing changed — he holds the lead band exactly as before', () => {
  const a = chase(), b = chase({ P: OLD });
  assert.ok(Math.abs(a.gapAt(10) - WORLD_CHASE.lead) < 0.5 && Math.abs(a.min - b.min) < 1e-9, `steady gap ${a.gapAt(10).toFixed(1)} m`);
});

test('pursuit: one short pull visibly closes distance (not cancelled by his speed matching); fairness limits hold', () => {
  const now = chase({ pulls: [[4, PULL.boost]] }), old = chase({ pulls: [[4, PULL.boost]], P: OLD });
  const closed = WORLD_CHASE.lead - now.min, closedOld = WORLD_CHASE.lead - old.min;
  assert.ok(closed >= 2.5, `closes ${closed.toFixed(1)} m with one stroke`);
  assert.ok(closed > closedOld * 1.6, `clearly more than with instant speed matching (${closedOld.toFixed(1)} m)`);
  assert.ok(WORLD_CHASE.lead - now.gapAt(4 + 2.5) >= 1.5, 'and the ground is still held 2.5 s later');
  assert.ok(Math.abs(now.gapAt(13.5) - WORLD_CHASE.lead) < 1.5, 'he eases back to his lead afterwards (no permanent drift)');
  for (const x of now.log) assert.ok(x.bv <= WORLD_CHASE.vMax + 1e-9 && x.bv >= 0);
});

test('pursuit: chained pulls give a real but bounded chase advantage — never inside his minimum lead / separation', () => {
  const pulls = []; for (let k = 0; k < 9; k++) pulls.push([3 + k * 0.9, PULL.boost]);
  const r = chase({ pulls, T: 20 });
  assert.ok(WORLD_CHASE.lead - r.min >= 6, `chained pulls close ${(WORLD_CHASE.lead - r.min).toFixed(1)} m`);
  assert.ok(r.minLead >= WORLD_CHASE.pull.minLead - 1e-9, 'the preferred lead never drops below minLead');
  assert.ok(WORLD_CHASE.pull.minLead >= 14 + 2, 'minLead stays outside his minimum throw range (14 m): attacks remain fair');
  assert.ok(r.min > WORLD_CHASE.minGap + 2, `never overtaken, well outside minGap (closest ${r.min.toFixed(1)} m)`);
  assert.ok(WORLD_CHASE.lead - WORLD_CHASE.pull.leadMax >= WORLD_CHASE.pull.minLead, 'the lead cut alone cannot break minLead');
  // an extreme surge right on top of him: he still keeps the separation
  const rush = chase({ pulls: [[2, 9], [2.3, 9], [2.6, 9], [2.9, 9]], cruise: 17, T: 10 });
  assert.ok(rush.min > WORLD_CHASE.minGap - 1.5, `separation held under a rush (${rush.min.toFixed(1)} m)`);
});

test('pursuit: openings (stagger / heavy) keep their own short leads — pulls do not stack on top of them', () => {
  const st = { dv: 0, cut: 0, hold: 0 };
  assert.equal(pullLeadCut(st, 50, DT), WORLD_CHASE.pull.leadMax, 'capped');
  let t = 0; while (st.cut > 0 && t < 30) { pullLeadCut(st, 50, DT); t += DT; }
  assert.ok(Math.abs(t - (WORLD_CHASE.pull.leadHold + WORLD_CHASE.pull.leadMax / WORLD_CHASE.pull.leadRecover)) < 0.2, `held ${WORLD_CHASE.pull.leadHold} s, then eased back (${t.toFixed(1)} s)`);
  const s = chase({ pulls: [[4, PULL.boost]], slow: 'stagger', T: 9 });
  assert.ok(s.log.every((x) => x.lead === WORLD_CHASE.leadOpening.stagger));
});

// ------------------------------------------------------------------------------------------- wind (World Chase + pull gust)
test('wind: on in the World Chase (not paused / resolved), and a pull makes it clearly stronger, then it settles', async () => {
  const { WindFx, WIND } = await import('../src/game/windFx.js');
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(); scene.add(camera);
  const loco = { mode: 'city', grounded: false, cling: null, vel: V(0, 0, -11), pull: { surge: 0 } };
  const app = { scene, camera, locomotion: loco, state: 'world', worldChase: { running: true, paused: false }, menus: { open: false }, story: { inRoom: false } };
  const wind = new WindFx(app); const run = (sec) => { for (let i = 0; i < sec * 72; i++) wind.update(DT); };
  run(2); const base = wind.level;
  assert.ok(base > 0.2 && wind.mesh.visible, `wind while swinging in the World Chase (level ${base.toFixed(2)})`);
  loco.pull.surge = 5; run(0.25);
  assert.ok(wind.level > base + 0.5, `a pull gust is clearly stronger within 0.25 s (${base.toFixed(2)} → ${wind.level.toFixed(2)})`);
  loco.pull.surge = 0; run(2); assert.ok(Math.abs(wind.level - base) < 0.03, 'back to the normal wind once the surge is gone');
  loco.vel.set(0, 0, -3); loco.pull.surge = 5; run(0.5); assert.ok(wind.level > WIND.pullFloor, 'a pull is felt even at low speed'); loco.pull.surge = 0; loco.vel.set(0, 0, -11);
  settings.comfortMode = true; try { loco.pull.surge = 5; run(1); assert.ok(wind.level <= (1 + WIND.pullGust) * WIND.comfort + 1e-6, 'comfort mode halves it'); } finally { settings.comfortMode = false; loco.pull.surge = 0; }
  app.worldChase.paused = true; run(2); assert.ok(wind.level < 0.01 && !wind.mesh.visible, 'off while paused');
  app.worldChase.paused = false; app.worldChase.running = false; run(1); assert.ok(wind.level < 0.01, 'off after the run is resolved');
  app.worldChase.running = true; app.state = 'arcade'; run(1); assert.ok(wind.level < 0.01, 'never in the Arcade');
});
