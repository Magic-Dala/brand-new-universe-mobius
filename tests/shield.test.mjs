// v0.44 palm-facing light-web shield: gesture (three conditions, hysteresis, re-arm, tracking loss), arbitration with
// the other gestures in the InputHub, swept collision direction, single-hit processing, energy limits, pause / restart,
// and that the Arcade (rhythm notes) never gets a shield.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.window = globalThis.window || { addEventListener() {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const THREE = await import('three');
const { generateHandPose } = await import('../src/art/mobius.js');
const { HandFeatures } = await import('../src/input/gestures.js');
const { PalmShieldDetector, measurePalm } = await import('../src/input/palmShield.js');
const { InputHub } = await import('../src/input/hub.js');
const { SHIELD } = await import('../src/data/handCombat.js');
const { LightShield, ShieldEnergy, shieldIntercept } = await import('../src/game/lightShield.js');
const { ChaseBombs } = await import('../src/game/chaseBombs.js');
const { STORY_COMBAT } = await import('../src/data/storyCombat.js');

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const X = V(1, 0, 0), Y = V(0, 1, 0);
const CURL = { open: [0.1, 0, 0, 0, 0], fist: [0.8, 1, 1, 1, 1], web: [0.2, 0, 1, 1, 0], relaxed: [0.3, 0.45, 0.5, 0.5, 0.45], point: [0.6, 0, 1, 1, 1] };
const HEAD = V(0, 1.6, 0), FWD = V(0, 0, -1), DT = 1 / 72;
// default skeleton: palm DOWN, fingers −Z. Rotating +90° about X = palm FORWARD (−Z), fingers UP.
const PALM_FWD = new THREE.Quaternion().setFromAxisAngle(X, Math.PI / 2);
const yaw = (deg) => new THREE.Quaternion().setFromAxisAngle(Y, THREE.MathUtils.degToRad(deg));
const pitch = (deg) => new THREE.Quaternion().setFromAxisAngle(X, THREE.MathUtils.degToRad(deg));
/** Joints with the PALM CENTRE at `at` (default: raised in front of the right shoulder). */
function joints(h, curl, { rot = PALM_FWD, at = V(0.2, 1.4, -0.45) } = {}) {
  const p = new Float32Array(75), q = new Float32Array(100);
  generateHandPose(h, CURL[curl], p, q);
  const v = new THREE.Vector3(), jq = new THREE.Quaternion();
  for (let i = 0; i < 25; i++) { v.fromArray(p, i * 3).applyQuaternion(rot); v.toArray(p, i * 3); jq.fromArray(q, i * 4).premultiply(rot); jq.toArray(q, i * 4); }
  const f = new HandFeatures(h); f.setJoints(p, q, 0);
  const off = at.clone().sub(f.palm);
  for (let i = 0; i < 25; i++) { v.fromArray(p, i * 3).add(off); v.toArray(p, i * 3); }
  return { p, q };
}
/** Drive one detector: steps = [{ curl, rot, at, frames, lost, allow, blocked }]. Returns the transitions. */
function run(steps, det = new PalmShieldDetector('right'), f = new HandFeatures('right'), t0 = 0) {
  const out = []; let t = t0;
  for (const s of steps) for (let i = 0; i < (s.frames || 1); i++) {
    t += DT;
    if (s.lost) f.setTracked(false, t); else { const j = joints('right', s.curl || 'open', s); f.setJoints(j.p, j.q, t); }
    const tr = det.update(f, { t, dt: DT, headPos: HEAD, headFwd: FWD, allow: s.allow ?? true, blocked: !!s.blocked });
    if (tr) out.push({ tr, t });
  }
  return { out, det, f, t };
}
const ons = (r) => r.out.filter((e) => e.tr === 'on').length, offs = (r) => r.out.filter((e) => e.tr === 'off').length;

test('pose sanity: the synthetic raised palm really faces forward, is open and in front of the head', () => {
  const j = joints('right', 'open'), f = new HandFeatures('right'); f.setJoints(j.p, j.q, 0);
  const m = measurePalm(f, HEAD, FWD);
  assert.ok(m.faceDeg < 5, `palm faces forward (${m.faceDeg.toFixed(1)}°)`);
  assert.ok(m.maxCurl < SHIELD.openEnter && m.forward > 0.4 && Math.abs(m.height + 0.2) < 0.01);
  for (const h of ['left', 'right']) { const k = joints(h, 'open'), g = new HandFeatures(h); g.setJoints(k.p, k.q, 0); assert.ok(measurePalm(g, HEAD, FWD).faceDeg < 5, `${h} hand`); }
});

test('gesture: open + palm forward + raised together raise the shield (after a dwell); each one missing does not', () => {
  assert.equal(ons(run([{ frames: 40 }])), 1, 'the full pose');
  const first = run([{ frames: 40 }]).out[0].t;
  assert.ok(first >= SHIELD.enterDwell && first < SHIELD.enterDwell + 0.1, `needs the dwell, not longer (${first.toFixed(3)} s)`);
  assert.equal(ons(run([{ frames: 6 }])), 0, 'a few frames are not enough');
  // a casually open hand: hanging at the hip, palm toward the thigh / backward / forward — never
  assert.equal(ons(run([{ at: V(0.25, 0.9, -0.05), rot: new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), Math.PI / 2), frames: 60 }])), 0, 'open hand at the hip');
  assert.equal(ons(run([{ at: V(0.25, 0.95, -0.3), frames: 60 }])), 0, 'palm forward but low (below the chest)');
  assert.equal(ons(run([{ rot: new THREE.Quaternion(), frames: 60 }])), 0, 'raised, open, palm DOWN (reaching / resting)');
  assert.equal(ons(run([{ rot: pitch(180), frames: 60 }])), 0, 'raised, open, palm UP (the Fan Web tray)');
  assert.equal(ons(run([{ rot: yaw(180).multiply(PALM_FWD), frames: 60 }])), 0, 'palm toward the face (the palm menu)');
  assert.equal(ons(run([{ at: V(0.2, 1.4, -0.08), frames: 60 }])), 0, 'palm forward but held at the chest, not out in front');
  assert.equal(ons(run([{ curl: 'fist', frames: 60 }])), 0, 'a fist');
  assert.equal(ons(run([{ curl: 'web', frames: 60 }])), 0, 'the web pose');
  assert.equal(ons(run([{ curl: 'relaxed', frames: 60 }])), 0, 'a relaxed half-curled hand');
  assert.equal(ons(run([{ allow: false, frames: 60 }])), 0, 'not allowed (mode / energy)');
});

test('comfort: forgiving thresholds — a tilted palm, a slightly bent hand and either side of the body still work', () => {
  for (const [name, o] of [['40° yaw', { rot: yaw(40).multiply(PALM_FWD) }], ['35° tilted up', { rot: pitch(35).multiply(PALM_FWD) }], ['head height', { at: V(0.15, 1.65, -0.4) }], ['chest height', { at: V(0.2, 1.2, -0.4) }], ['across the body', { at: V(-0.15, 1.4, -0.4) }]])
    assert.equal(ons(run([{ ...o, frames: 40 }])), 1, name);
});

test('hysteresis: wobbling between the enter and exit thresholds keeps the shield; brief flicker never drops it; leaving does', () => {
  const tilted = yaw(60).multiply(PALM_FWD); // outside the 50° enter cone, inside the 68° exit cone
  assert.equal(ons(run([{ rot: tilted, frames: 60 }])), 0, 'cannot be raised at 60°');
  const r = run([{ frames: 30 }, { rot: tilted, frames: 60 }, { at: V(0.2, 1.05, -0.4), frames: 40 }]);
  assert.equal(ons(r), 1); assert.equal(offs(r), 0, 'kept at 60° and at −0.55 m (inside the exit thresholds)');
  const seq = [{ frames: 30 }]; for (let i = 0; i < 8; i++) seq.push({ curl: 'fist', frames: 3 }, { frames: 6 }); // 3-frame tracking flicker
  const fl = run(seq); assert.equal(offs(fl), 0, 'flicker shorter than the exit dwell'); assert.ok(fl.det.active);
  const leave = run([{ frames: 30 }, { rot: yaw(80).multiply(PALM_FWD), frames: 30 }]);
  assert.equal(offs(leave), 1, 'turned away → drops'); assert.equal(leave.det.active, false);
  const lower = run([{ frames: 30 }, { at: V(0.2, 0.9, -0.3), frames: 30 }, { frames: 30 }]);
  assert.deepEqual(lower.out.map((e) => e.tr), ['on', 'off', 'on'], 'lowering drops it, raising again re-arms it');
});

test('a hand still moving fast (throw follow-through, a wave) does not raise the shield', () => {
  let k = 0; const steps = [];
  for (let i = 0; i < 40; i++) steps.push({ at: V(0.2, 1.4, -0.3 - (k += 2.5 * DT)), frames: 1 }); // 2.5 m/s forward, perfect pose
  assert.equal(ons(run(steps)), 0);
});

test('tracking loss: a short gap keeps the shield but it cannot block; a long gap drops it; reacquisition never pops a shield', () => {
  const a = run([{ frames: 30 }, { lost: true, frames: 10 }]); // 0.14 s < lostGrace
  assert.ok(a.det.active, 'still up'); assert.equal(a.det.blocking, false, 'never blocks while the hand is not tracked');
  const a2 = run([{ frames: 3 }], a.det, a.f, a.t); assert.equal(offs(a2), 0); assert.ok(a.det.blocking, 'blocks again once tracked for 2 frames');
  const b = run([{ frames: 30 }, { lost: true, frames: 30 }]);
  assert.equal(offs(b), 1, 'gap longer than the grace'); assert.equal(b.det.active, false);
  // the hand reappears already in the pose: no shield on the first frames (recover frames + full dwell)
  const c = run([{ lost: true, frames: 20 }, { frames: SHIELD.recoverFrames + 3 }]);
  assert.equal(ons(c), 0, 'not within the recovery frames'); assert.equal(c.det.blocking, false);
  const c2 = run([{ frames: 30 }], c.det, c.f, c.t); assert.equal(ons(c2), 1, 'rises normally afterwards');
  // one garbage frame during a loss does not create a shield
  assert.equal(ons(run([{ curl: 'fist', frames: 20 }, { lost: true, frames: 5 }, { frames: 1 }, { lost: true, frames: 5 }, { curl: 'fist', frames: 20 }])), 0);
});

test('re-arm after an overload: the hand must leave the pose before the next shield', () => {
  const r = run([{ frames: 30 }]); assert.ok(r.det.active);
  assert.equal(r.det.drop(true), 'off');
  const still = run([{ frames: 80 }], r.det, r.f, r.t); assert.equal(ons(still), 0, 'holding the palm up does nothing');
  const again = run([{ at: V(0.2, 0.9, -0.2), frames: 15 }, { frames: 30 }], r.det, r.f, still.t); assert.equal(ons(again), 1, 'lowered, raised again');
});

// ------------------------------------------------------------------------------------------- arbitration (InputHub)
function hubRig() {
  const player = new THREE.Object3D(), camera = new THREE.Object3D(); camera.position.copy(HEAD); player.add(camera);
  const hub = new InputHub({ renderer: null, player, camera });
  hub.mode.left = hub.mode.right = 'hand'; hub.ctx.shield = true; hub.ctx.shieldReady = true;
  hub.headPosLocal.copy(HEAD); hub.headFwdLocal.copy(FWD);
  let t = 0; const log = [];
  const frame = (o = {}) => {
    t += DT; hub.events.length = 0; hub._dt = DT;
    for (const h of ['left', 'right']) {
      const s = o[h] || { curl: 'relaxed', at: V(h === 'left' ? -0.25 : 0.25, 0.95, -0.1), rot: new THREE.Quaternion() }; // default: resting
      if (s.lost) hub.features[h].setTracked(false, t);
      else { const j = joints(h, s.curl || 'open', { rot: s.rot ?? PALM_FWD, at: s.at ?? V(h === 'left' ? -0.2 : 0.2, 1.4, -0.45) }); hub.features[h].setJoints(j.p, j.q, t); }
      if (o.machines !== false) hub.events.push(...hub.machines[h].update(hub.features[h], { t, allowWeb: true, allowBomb: true, headForward: FWD }));
      hub.webHeld[h] = hub.machines[h].web.held;
    }
    hub._shields(t);
    for (const e of hub.events) log.push({ ...e, t });
    return hub.events;
  };
  const frames = (n, o) => { for (let i = 0; i < n; i++) frame(o); };
  return { hub, frame, frames, log, now: () => t };
}
const UP = {}; // marker: the raised palm-forward open hand (the defaults in hubRig.frame)

test('hub: either hand independently; shieldOn / shieldOff events; the pose in world space follows the palm direction', () => {
  const { hub, frames, log } = hubRig();
  frames(30, { right: UP });
  assert.ok(hub.shieldDet.right.active && !hub.shieldDet.left.active);
  frames(30, { left: UP });
  assert.ok(hub.shieldDet.left.active && !hub.shieldDet.right.active);
  frames(30, { left: UP, right: UP });
  assert.ok(hub.shieldDet.left.active && hub.shieldDet.right.active, 'both at once');
  assert.deepEqual(log.filter((e) => e.type.startsWith('shield')).map((e) => `${e.type}:${e.hand}`), ['shieldOn:right', 'shieldOff:right', 'shieldOn:left', 'shieldOn:right']);
  hub.world.player.rotation.y = Math.PI / 2; hub.world.player.position.set(10, 0, 5); hub.world.player.updateMatrixWorld(true); // rig turned left + moved
  const p = V(0, 0, 0), n = V(0, 0, 0); assert.ok(hub.shieldPose('right', p, n));
  assert.ok(n.distanceTo(V(-1, 0, 0)) < 0.05, `normal follows the palm through the rig (${n.toArray().map((x) => x.toFixed(2))})`);
  const palmW = hub.features.right.palm.clone().applyMatrix4(hub.world.player.matrixWorld);
  assert.ok(Math.abs(p.distanceTo(palmW) - SHIELD.offset) < 1e-6, 'in front of the palm');
});

test('conflict: a hand holding a swing web must release it first; the other hand keeps swinging while the shield is up', () => {
  const { hub, frames } = hubRig();
  hub.ctx.shieldRope.right = true; // (locomotion: the rope is still attached during its release grace)
  frames(40, { right: UP });
  assert.equal(hub.shieldDet.right.active, false, 'rope attached → no shield, however long the palm is up');
  hub.ctx.shieldRope.right = false;
  frames(Math.round((SHIELD.webLock + SHIELD.enterDwell) / DT) - 4, { right: UP }); assert.equal(hub.shieldDet.right.active, false, 'the opening hand of a release is not a shield (web lock + dwell)');
  frames(20, { right: UP }); assert.ok(hub.shieldDet.right.active, 'a palm deliberately held up afterwards is');
  // the other hand fires / holds a web the whole time
  const web = { curl: 'web', at: V(-0.2, 1.3, -0.5), rot: new THREE.Quaternion() };
  const { hub: h2, frames: f2, log } = hubRig();
  // letting go of a web with the hand up and the palm forward (aiming at a high anchor): no shield pops up during the release
  const rl = hubRig(); rl.frames(10, { right: { curl: 'open', rot: pitch(60) } }); rl.frames(30, { right: { curl: 'web', rot: pitch(60) } });
  assert.ok(rl.hub.webHeld.right); rl.frames(Math.round(0.35 / DT), { right: UP });
  assert.equal(rl.hub.shieldDet.right.active, false, 'release → open hand for 0.35 s: no shield'); assert.equal(rl.log.filter((e) => e.type === 'shieldOn').length, 0);
  f2(10, { left: { curl: 'open', at: V(-0.2, 1.3, -0.5), rot: new THREE.Quaternion() } });
  f2(40, { right: UP, left: web });
  assert.ok(h2.shieldDet.right.active, 'right shield'); assert.ok(h2.webHeld.left, 'left web still held');
  assert.equal(log.filter((e) => e.type === 'web' && e.hand === 'left').length, 1, 'the web fired normally');
  h2.ctx.shieldRope.left = true; f2(20, { right: UP, left: web }); assert.ok(h2.shieldDet.right.active, 'a rope on the OTHER hand does not matter');
  // the shield hand itself forming the web pose drops the shield at once
  f2(6, { right: { curl: 'web' }, left: web }); assert.equal(h2.shieldDet.right.active, false);
});

test('conflict: opening the hand after a Light Bomb throw / fizzle is not a shield; the lock expires', () => {
  const { hub, frame, frames, log } = hubRig();
  frames(20, { right: { curl: 'open', rot: new THREE.Quaternion() } });
  frames(40, { right: { curl: 'fist' } }); // charging (palm forward, raised — the worst case)
  assert.ok(log.some((e) => e.type === 'bombCharge')); assert.equal(hub.shieldDet.right.active, false, 'never while charging');
  let z = -0.45; for (let i = 0; i < 12; i++) frame({ right: { curl: 'fist', at: V(0.2, 1.4, (z -= 2.5 * DT)) } });
  const tOpen = log.length; for (let i = 0; i < 4; i++) frame({ right: { at: V(0.2, 1.4, (z -= 2.5 * DT)) } }); // opens while moving → throw
  assert.ok(log.slice(tOpen).some((e) => e.type === 'bombThrow'), 'thrown');
  frames(Math.round((SHIELD.bombLock - 0.1) / DT), { right: { at: V(0.2, 1.4, z) } }); // hand stays open, palm forward, out in front
  assert.equal(hub.shieldDet.right.active, false, `no shield within ${SHIELD.bombLock} s of the throw`);
  frames(30, { right: { at: V(0.2, 1.4, z) } }); assert.ok(hub.shieldDet.right.active, 'a deliberate hold afterwards works');
  // fizzle (opened without a throw)
  const b = hubRig(); b.frames(20, { right: { curl: 'open', rot: new THREE.Quaternion() } }); b.frames(40, { right: { curl: 'fist' } }); b.frames(12, { right: UP });
  assert.ok(b.log.some((e) => e.type === 'bombFizzle')); assert.equal(b.hub.shieldDet.right.active, false);
});

test('conflict: palm menu, Fan Web, UI hover / pinch, teleport aim, open menu, climbing / scripted motion never raise it — and drop a raised one', () => {
  const cases = {
    'palm menu button under the fingertip': (hub) => { hub.palmButton.visible = true; hub.palmButton.hover = 0.5; },
    'Fan Web poses engaged': (hub) => { hub.fan.engaged = true; },
    'right after a Fan Web': (hub, t) => { hub.fan.lastFire = t; },
    'hovering a panel': (hub) => { hub.ctx.uiHover.right = true; },
    'pinch select held': (hub) => { hub.pointers.right.selectHeld = true; },
    'teleport aiming': (hub) => { hub.teleport.aiming = true; hub.teleport.hand = 'right'; },
    'menu open': (hub) => { hub.ctx.menuOpen = true; },
    'climbing / scripted / frozen': (hub) => { hub.ctx.shieldHold = true; },
    'shield not allowed in this mode': (hub) => { hub.ctx.shield = false; },
    'no energy': (hub) => { hub.ctx.shieldReady = false; },
  };
  for (const [name, set] of Object.entries(cases)) {
    const a = hubRig(); a.frame(); set(a.hub, a.now()); for (let i = 0; i < 25; i++) { if (name.startsWith('right after')) a.hub.fan.lastFire = a.now(); a.frame({ right: UP }); }
    assert.equal(a.hub.shieldDet.right.active, false, `never raised: ${name}`);
    const b = hubRig(); b.frames(30, { right: UP }); assert.ok(b.hub.shieldDet.right.active);
    set(b.hub, b.now()); b.frame({ right: UP });
    assert.equal(b.hub.shieldDet.right.active, false, `dropped at once: ${name}`);
    assert.ok(b.log.some((e) => e.type === 'shieldOff'), `${name}: off event`);
  }
  // the left palm turned toward the face shows the menu button: that hand is the menu, not a shield
  const m = hubRig(); m.hub.palmButton.visible = true; m.frames(40, { left: UP }); assert.equal(m.hub.shieldDet.left.active, false);
  // a pinch (thumb on the index tip) with the other fingers open
  const p = hubRig(); const orig = Object.getOwnPropertyDescriptor(HandFeatures.prototype, 'pinchDistance');
  Object.defineProperty(p.hub.features.right, 'pinchDistance', { get: () => 0.01 }); p.frames(40, { right: UP }); assert.equal(p.hub.shieldDet.right.active, false, 'pinching'); void orig;
  // controllers: no shield gesture at all
  const c = hubRig(); c.frames(30, { right: UP }); c.hub.mode.right = 'controller'; c.frame({ right: UP }); assert.equal(c.hub.shieldDet.right.active, false);
});

// ------------------------------------------------------------------------------------------- collision
const C0 = V(0, 1.4, -0.5), N = V(0, 0, -1), R = SHIELD.radius + 0.1;
test('swept collision: only paths that cross the front of the disc are blocked', () => {
  const hit = (prev, pos, c0 = C0, c1 = C0, n0 = N, n1 = N) => shieldIntercept(prev, pos, c0, c1, n0, n1, R);
  assert.ok(hit(V(0, 1.4, -1.0), V(0, 1.4, -0.7)), 'straight into the palm');
  assert.ok(hit(V(0.3, 1.6, -1.0), V(0.25, 1.55, -0.7)), 'off-centre but inside the disc');
  assert.equal(hit(V(0.9, 1.4, -1.0), V(0.9, 1.4, -0.7)), false, 'passes beside the disc');
  assert.equal(hit(V(0, 2.3, -1.0), V(0, 2.3, -0.7)), false, 'passes above it');
  assert.equal(hit(V(0, 1.4, -6), V(0, 1.4, -5.5)), false, 'still far away (outside the standoff)');
  assert.equal(hit(V(0, 1.4, 0.4), V(0, 1.4, 0.1)), false, 'from BEHIND the shield (the back of the hand) → never');
  assert.equal(hit(V(0, 1.4, -0.3), V(0, 1.4, 0.1)), false, 'already behind the disc and leaving');
  assert.equal(hit(V(0, 1.4, -0.7), V(0, 1.4, -1.0)), false, 'moving away from the front');
  assert.equal(hit(V(-2, 1.4, -0.55), V(-1.6, 1.4, -0.54)), false, 'grazing along the disc plane');
  assert.ok(hit(V(-0.6, 1.4, -1.1), V(-0.45, 1.4, -0.95)), 'a 45° approach that ends on the disc');
  assert.equal(hit(V(-1.6, 1.4, -1.1), V(-1.45, 1.4, -0.95)), false, 'a 45° approach that ends beside it');
  // the shield turned sideways no longer covers a frontal path
  assert.equal(hit(V(0, 1.4, -1.0), V(0, 1.4, -0.7), C0, C0, V(1, 0, 0), V(1, 0, 0)), false);
});

test('swept collision: fast projectiles and a fast-moving player cannot tunnel', () => {
  const out = { front: 0, point: V(0, 0, 0) };
  // 60 m/s pumpkin, 30 fps: 2 m per step, from 1.2 m in front to 0.8 m behind
  assert.ok(shieldIntercept(V(0.1, 1.45, -1.7), V(0.1, 1.45, 0.3), C0, C0, N, N, R, SHIELD, out), 'crossed inside one step');
  assert.ok(out.front < 0, 'reported as crossed'); assert.ok(out.point.distanceTo(V(0.1, 1.45, -0.5)) < 1e-6, 'contact point on the disc');
  assert.equal(shieldIntercept(V(1.5, 1.45, -1.7), V(1.5, 1.45, 0.3), C0, C0, N, N, R), false, 'the same step beside the disc');
  // the player (and the shield) flies 0.6 m per frame toward a slow pumpkin: relative motion decides
  const c0 = V(0, 1.4, -0.5), c1 = V(0, 1.4, -1.1);
  assert.ok(shieldIntercept(V(0, 1.4, -1.0), V(0, 1.4, -0.98), c0, c1, N, N, R, SHIELD, out), 'the shield ran into it'); assert.ok(out.front <= 0.13);
  // … and a pumpkin overtaken from behind by the moving player is not "blocked"
  assert.equal(shieldIntercept(V(0, 1.4, 0.2), V(0, 1.4, 0.25), c0, V(0, 1.4, -0.4), N, N, R), false);
});

// ------------------------------------------------------------------------------------------- energy
test('energy: drains while raised, costs per block, recharges after a delay, overload locks until recharged', () => {
  const E = new ShieldEnergy(); assert.ok(E.canRaise); assert.equal(E.frac, 1);
  for (let i = 0; i < 72; i++) E.tick(DT, 1);
  assert.ok(Math.abs(E.value - (SHIELD.energyMax - SHIELD.holdDrain)) < 0.01, 'one shield, one second');
  for (let i = 0; i < 72; i++) E.tick(DT, 2);
  assert.ok(Math.abs(E.value - (SHIELD.energyMax - SHIELD.holdDrain * 3)) < 0.01, 'two shields drain twice as fast (one pool)');
  assert.equal(E.hit(SHIELD.blockCost), null); const v = E.value;
  for (let i = 0; i < 36; i++) E.tick(DT, 0); assert.equal(E.value, v, 'no recharge during the delay');
  for (let i = 0; i < 72 * 2; i++) E.tick(DT, 0); assert.ok(E.value > v + SHIELD.regen * 1.4, 'then it recharges');
  // permanently holding the palm up: it runs empty, overloads and stays down
  const P = new ShieldEnergy(); let broke = 0, tUp = 0;
  while (!broke && tUp < 60) { if (P.tick(DT, 1) === 'break') broke = tUp; tUp += DT; }
  assert.ok(broke > 4 && broke < 12, `holds ${broke.toFixed(1)} s from full`); assert.equal(P.canRaise, false);
  for (let i = 0; i < 72 * SHIELD.breakLock; i++) P.tick(DT, 0); assert.equal(P.canRaise, false, 'still locked right after the lock time (not recharged)');
  let tDown = SHIELD.breakLock; while (!P.canRaise && tDown < 30) { P.tick(DT, 0); tDown += DT; }
  assert.ok(P.value >= SHIELD.rearmEnergy && tDown < 6, `usable again after ${tDown.toFixed(1)} s`);
  // a block that costs more than what is left still counts — and overloads
  const H = new ShieldEnergy(); H.value = 30; assert.equal(H.hit(SHIELD.heavyCost), 'break'); assert.equal(H.value, 0);
  // too little energy: cannot be raised
  const L = new ShieldEnergy(); L.value = SHIELD.minRaise - 1; assert.equal(L.canRaise, false);
});

// ------------------------------------------------------------------------------------------- bombs × shield (the real modules)
function world({ swept = true } = {}) {
  const scene = new THREE.Scene();
  const fxLog = { boom: 0, net: 0, popup: [] }, hits = [];
  const det = () => ({ active: false, blocking: false, drops: 0, drop(need) { this.drops++; this.need = need; const was = this.active; this.active = this.blocking = false; return was ? 'off' : null; }, reset() { this.active = this.blocking = false; } });
  const pose = { left: { p: V(-0.2, 51.5, -0.5), n: V(0, 0, -1) }, right: { p: V(0.2, 51.5, -0.5), n: V(0, 0, -1) } };
  const hub = { ctx: { shield: true, shieldReady: true }, shieldDet: { left: det(), right: det() }, haptic() {}, shieldPose(h, p, n) { p.copy(pose[h].p); n.copy(pose[h].n); return true; } };
  const app = { scene, hub, cityWorld: null, flashes: 0, flashDamage() { this.flashes++; }, fx: { boom: () => { fxLog.boom++; }, net: () => { fxLog.net++; }, web() {}, popup: (k) => fxLog.popup.push(k) } };
  app.shield = new LightShield(app);
  const bpos = V(0, 60, -40);
  const boss = { root: { position: bpos }, throwPoint: (o) => o.copy(bpos), throw() {} };
  const bombs = new ChaseBombs(app, { ...STORY_COMBAT.bombs, swept, giantScale: 2.6 });
  bombs.onPlayerHit = (it) => hits.push(it.id);
  const chest = V(0, 51.3, 0), vel = V(0, 0, 0);
  const raise = (h, on = true) => { hub.shieldDet[h].active = hub.shieldDet[h].blocking = on; };
  const step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) { app.shield.update(dt, 0); bombs.update(dt, { allow: false, boss, chest, playerVel: vel }); } };
  const throwAt = (kind = 'normal', from = bpos, T) => { const it = bombs._get(kind); it.pos.copy(from); bombs._launch(it, chest, vel, T ? { T } : {}); return it; };
  return { app, hub, bombs, chest, vel, pose, raise, step, throwAt, fxLog, hits, shield: app.shield };
}
const flyOut = (w, max = 400) => { for (let i = 0; i < max && w.bombs.flying.length; i++) w.step(); };

test('blocking: a pumpkin whose path meets the raised shield bursts on it — once, no explosion, no player damage', () => {
  const w = world(); w.pose.right.p.set(0, 51.6, -0.5); w.raise('right'); w.step(2);
  const it = w.throwAt(); const e0 = w.shield.energy.value;
  let frames = 0; for (; frames < 400 && w.bombs.flying.length; frames++) w.step();
  assert.equal(w.bombs.stats.blocked, 1); assert.equal(w.shield.stats.blocked, 1);
  assert.equal(w.bombs.stats.exploded, 0, 'no explosion'); assert.equal(w.bombs.stats.hits, 0); assert.equal(w.hits.length, 0, 'no damage callback'); assert.equal(w.app.flashes, 0, 'no damage flash');
  assert.equal(w.bombs.stats.destroyed, 0, 'a block is not a kill (no score / counter)');
  assert.equal(it.active, false, 'recycled');
  const spent = e0 - w.shield.energy.value, drain = SHIELD.holdDrain * frames / 60;
  assert.ok(Math.abs(spent - SHIELD.blockCost - drain) < 0.5, `one block cost + the hold drain of the flight (${spent.toFixed(1)} = ${SHIELD.blockCost} + ${drain.toFixed(1)})`);
  w.step(120); assert.equal(w.bombs.stats.blocked, 1, 'never processed twice'); assert.equal(w.fxLog.popup.filter((k) => k === 'shield.block').length, 1);
  // the same throw without a shield hits (the control)
  const c = world(); c.throwAt(); flyOut(c);
  assert.equal(c.bombs.stats.blocked, 0); assert.equal(c.bombs.stats.hits, 1); assert.equal(c.hits.length, 1);
});

test('blocking needs the FRONT of the shield in the path: turned away, held aside, or raised too late on the far side → the pumpkin still hits', () => {
  const back = world(); back.pose.right.p.set(0, 51.6, -0.5); back.pose.right.n.set(0, 0, 1); back.raise('right'); back.step(2); back.throwAt(); flyOut(back);
  assert.equal(back.bombs.stats.blocked, 0, 'palm facing the player, back of the hand to the pumpkin'); assert.equal(back.bombs.stats.hits, 1);
  const aside = world(); aside.pose.right.p.set(1.6, 51.6, -0.5); aside.raise('right'); aside.step(2); aside.throwAt(); flyOut(aside);
  assert.equal(aside.bombs.stats.blocked, 0, 'held 1.6 m to the side'); assert.equal(aside.bombs.stats.hits, 1);
  const side = world(); side.pose.right.p.set(0.5, 51.5, 0); side.pose.right.n.set(1, 0, 0); side.raise('right'); side.step(2); side.throwAt(); flyOut(side);
  assert.equal(side.bombs.stats.blocked, 0, 'facing sideways'); assert.equal(side.bombs.stats.hits, 1);
  // a pumpkin from the side is blocked by a shield facing that side
  const sw = world(); sw.pose.left.p.set(-0.5, 51.5, 0); sw.pose.left.n.set(-1, 0, 0); sw.raise('left'); sw.step(2); sw.throwAt('normal', V(-40, 58, 0)); flyOut(sw);
  assert.equal(sw.bombs.stats.blocked, 1, 'the shield is oriented by the palm'); assert.equal(sw.bombs.stats.hits, 0);
});

test('blocking: fast pumpkins / low frame rates / the non-swept story bombs / either hand — none tunnels, each is processed once', () => {
  for (const swept of [true, false]) for (const hand of ['left', 'right']) for (const dt of [1 / 72, 1 / 30]) for (const T of [1.6, 0.35]) { // T 0.35 s ≈ 120 m/s
    const w = world({ swept }); w.pose[hand].p.set(0, 51.7, -0.55); w.raise(hand); w.step(2, dt);
    for (let k = 0; k < 3; k++) { w.throwAt('normal', V(0, 60, -40), T); for (let i = 0; i < 400 && w.bombs.flying.length; i++) w.step(1, dt); w.shield.energy.reset(); }
    assert.equal(w.bombs.stats.blocked, 3, `swept=${swept} ${hand} dt=${dt.toFixed(3)} T=${T}`); assert.equal(w.bombs.stats.hits, 0); assert.equal(w.bombs.stats.exploded, 0);
  }
});

test('tracking loss while raised: no phantom block — the pumpkin goes through and hits', () => {
  const w = world(); w.pose.right.p.set(0, 51.6, -0.5); w.raise('right'); w.step(2);
  w.hub.shieldDet.right.blocking = false; // (the detector's grace: still shown, not tracked)
  w.throwAt(); flyOut(w);
  assert.equal(w.bombs.stats.blocked, 0); assert.equal(w.bombs.stats.hits, 1);
});

test('heavy pumpkin: blocked for a higher cost; a block is never the heavy counter (no shot-down callback)', () => {
  const w = world(); let down = 0; w.bombs.onShotDown = () => down++;
  w.pose.right.p.set(0, 51.6, -0.5); w.raise('right'); w.step(2);
  w.throwAt('giant'); const e0 = w.shield.energy.value; flyOut(w);
  assert.equal(w.bombs.stats.blocked, 1); assert.equal(w.shield.stats.heavyBlocked, 1); assert.equal(down, 0); assert.equal(w.hits.length, 0);
  assert.ok(e0 - w.shield.energy.value >= SHIELD.heavyCost, 'the heavy cost');
  // a second heavy on the weakened shield: still blocked, but it overloads → both detectors told to drop + re-arm
  w.shield.energy.value = 50; w.throwAt('giant'); flyOut(w);
  assert.equal(w.bombs.stats.blocked, 2); assert.equal(w.shield.stats.breaks, 1); assert.equal(w.hits.length, 0);
  assert.equal(w.hub.shieldDet.right.need, true, 'must leave the pose'); assert.equal(w.hub.ctx.shieldReady, false);
  assert.ok(w.fxLog.popup.includes('shield.break'));
});

test('resource limit: a palm held up forever stops protecting — the shield overloads and later pumpkins hit', () => {
  const w = world(); w.pose.right.p.set(0, 51.6, -0.5); w.raise('right');
  let t = 0; while (!w.shield.stats.breaks && t < 30) { w.step(); t += 1 / 60; }
  assert.ok(t > 4 && t < 12, `overload after ${t.toFixed(1)} s`); assert.equal(w.hub.shieldDet.right.active, false);
  w.throwAt(); flyOut(w); assert.equal(w.bombs.stats.hits, 1, 'no protection while overloaded');
  assert.equal(w.hub.ctx.shieldReady, false);
  w.step(60 * 6); assert.equal(w.hub.ctx.shieldReady, true, 'recovers on its own');
});

test('pause / mode off: energy neither drains nor recharges, raised shields come down, nothing blocks; restart = full and clean', () => {
  const w = world(); w.pose.right.p.set(0, 51.6, -0.5); w.raise('right'); w.step(120);
  const e = w.shield.energy.value; assert.ok(e < SHIELD.energyMax);
  w.hub.ctx.shield = false; // paused / menu / Arcade / results (the hub also drops its detectors there)
  w.step(600); assert.equal(w.shield.energy.value, e, 'frozen during the pause'); assert.equal(w.shield.anyActive, false);
  w.throwAt(); flyOut(w); assert.equal(w.bombs.stats.blocked, 0, 'a disabled shield never blocks');
  w.hub.ctx.shield = true; w.step(1); assert.ok(w.shield.anyActive, 'resumes');
  w.shield.reset(); // restart / scene change
  assert.equal(w.shield.energy.value, SHIELD.energyMax); assert.equal(w.shield.anyActive, false); assert.equal(w.shield.stats.blocked, 0); assert.equal(w.hub.ctx.shieldReady, true);
});

test('floating-origin rebase between frames does not fake or lose a block', () => {
  const w = world(); w.pose.right.p.set(0, 51.6, -0.5); w.raise('right'); w.step(2);
  w.throwAt();
  for (let i = 0; i < 400 && w.bombs.flying.length; i++) {
    if (i % 7 === 3) { const dx = 500, dz = -300; w.shield.shift(dx, dz); w.bombs.shift(dx, dz); w.chest.x += dx; w.chest.z += dz; w.bombs._chest0.x += dx; w.bombs._chest0.z += dz; for (const h of ['left', 'right']) { w.pose[h].p.x += dx; w.pose[h].p.z += dz; } }
    w.step();
  }
  assert.equal(w.bombs.stats.blocked, 1); assert.equal(w.bombs.stats.hits, 0);
});

test('Arcade is untouched: no shield in its context, web / Fan Web / bomb events pass unchanged, the Arcade code has no shield path', () => {
  const { hub, frames, log } = hubRig(); hub.ctx.shield = false; hub.ctx.fanWeb = true; // main.js: shield only in Story chase / World Chase
  frames(60, { right: UP, left: UP });
  assert.equal(hub.shieldDet.right.active || hub.shieldDet.left.active, false);
  assert.equal(log.filter((e) => e.type.startsWith('shield')).length, 0);
  frames(10, { right: { curl: 'open', rot: new THREE.Quaternion() } }); frames(20, { right: { curl: 'web', rot: new THREE.Quaternion() } });
  assert.equal(log.filter((e) => e.type === 'web').length, 1, 'webs fire as before');
  const src = readFileSync(new URL('../src/game/arcade.js', import.meta.url), 'utf8') + readFileSync(new URL('../src/game/judge.js', import.meta.url), 'utf8');
  assert.equal(/tryBlock|LightShield|shieldDet|blockAt|handCombat/.test(src), false, 'the Arcade / judge never consult the palm shield');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /const shieldMode = [^;]*inWorld[^;]*this\.state === 'story'[^;]*;/); assert.equal(/shieldMode = [^;]*arcade/.test(main), false, 'the shield context never includes the Arcade');
});
