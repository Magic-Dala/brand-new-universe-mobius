// v0.22 two-hand Fan Web (扇形光網): pose geometry, single-fire state machine, tracking gaps, arbitration.
// Synthetic WebXR hands from the procedural skeleton (generateHandPose): default = palm DOWN, fingers −Z.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.window = globalThis.window || { addEventListener() {} };
const THREE = await import('three');
const { generateHandPose } = await import('../src/art/mobius.js');
const { HandFeatures, HandGestureMachine, PalmButton } = await import('../src/input/gestures.js');
const { FanWebDetector, FAN_TUNING, evaluatePair, fistEdgePoint, palmZone } = await import('../src/input/fanWeb.js');

const CURL = { open: [0.1, 0, 0, 0, 0], fist: [0.8, 1, 1, 1, 1] };
const Z = new THREE.Vector3(0, 0, 1), X = new THREE.Vector3(1, 0, 0);
/** Joints for a hand: curl preset, roll about the finger axis (deg), optional extra rotation, wrist at `at`. */
function joints(h, curl, { roll = 0, extra = null, at = new THREE.Vector3() } = {}) {
  const p = new Float32Array(75), q = new Float32Array(100);
  generateHandPose(h, CURL[curl], p, q);
  const rot = new THREE.Quaternion().setFromAxisAngle(Z, THREE.MathUtils.degToRad(roll)); if (extra) rot.premultiply(extra);
  const v = new THREE.Vector3(), jq = new THREE.Quaternion();
  for (let i = 0; i < 25; i++) { v.fromArray(p, i * 3).applyQuaternion(rot).add(at); v.toArray(p, i * 3); jq.fromArray(q, i * 4).premultiply(rot); jq.toArray(q, i * 4); }
  return { p, q };
}
const feat = (h, j, t = 0) => { const f = new HandFeatures(h); for (let k = 0; k < 4; k++) f.setJoints(j.p, j.q, t + k / 72); return f; };
const ROLL = { palmUp: 180, uprightR: -90, uprightL: 90 }; // right thumb −X → +Y needs −90°, left +X → +Y needs +90°

/** Place the fist so its little-finger edge sits `lift` above the open palm centre (+ lateral offset). */
function scene(openH, opts = {}) {
  const fistH = openH === 'left' ? 'right' : 'left';
  const O = joints(openH, opts.openCurl || 'open', { roll: opts.openRoll ?? ROLL.palmUp, extra: opts.openExtra, at: new THREE.Vector3(openH === 'left' ? -0.05 : 0.05, 1.05, -0.35) });
  const fo = feat(openH, O), zone = palmZone(fo, new THREE.Vector3());
  const fistRoll = opts.fistRoll ?? (fistH === 'right' ? ROLL.uprightR : ROLL.uprightL);
  const F0 = joints(fistH, opts.fistCurl || 'fist', { roll: fistRoll, extra: opts.fistExtra });
  const edge0 = fistEdgePoint(feat(fistH, F0), new THREE.Vector3());
  const fistAt = (lift, lat = 0) => zone.clone().add(new THREE.Vector3(lat, lift, 0)).sub(edge0);
  return { openH, fistH, O, fistAt, fistRoll, fistJ: (lift, lat) => joints(fistH, opts.fistCurl || 'fist', { roll: fistRoll, extra: opts.fistExtra, at: fistAt(lift, lat) }) };
}
/** Run frames: steps = [{ lift, frames, lostOpen?, lostFist?, lat? }] → events. */
function run(sc, steps, { allow = true } = {}) {
  const fO = new HandFeatures(sc.openH), fF = new HandFeatures(sc.fistH), det = new FanWebDetector(), ev = [];
  let t = 0;
  for (const s of steps) for (let i = 0; i < (s.frames || 1); i++) {
    t += 1 / 72;
    const lift = typeof s.lift === 'function' ? s.lift(i, s.frames) : s.lift;
    if (s.lostOpen) fO.setTracked(false, t); else fO.setJoints(sc.O.p, sc.O.q, t);
    if (s.lostFist) fF.setTracked(false, t); else { const j = sc.fistJ(lift, s.lat || 0); fF.setJoints(j.p, j.q, t); }
    const L = sc.openH === 'left' ? fO : fF, R = sc.openH === 'left' ? fF : fO;
    const e = det.update(L, R, { t, allow }); if (e) ev.push(e);
  }
  return { ev, det };
}
const approach = (from, to) => (i, n) => from + (to - from) * Math.min(1, i / Math.max(1, n - 1));
const TOUCH = 0.005, APART = 0.13;

test('upright fist (thumb up, little-finger edge down) on an upward palm: valid + contact, both hand assignments', () => {
  for (const openH of ['left', 'right']) {
    const sc = scene(openH), O = feat(sc.openH, sc.O), F = feat(sc.fistH, sc.fistJ(TOUCH));
    const e = evaluatePair(O, F);
    assert.ok(e.open && e.fist, `${openH}: open ${e.open} fist ${e.fist}`);
    assert.ok(e.palmUpDeg < 10, `palm up ${e.palmUpDeg}`); assert.ok(e.uprightDeg < 15, `upright ${e.uprightDeg}`);
    assert.ok(e.valid && e.contact, `${openH} open: valid ${e.valid} contact ${e.contact} h ${e.height}`);
    const far = evaluatePair(O, feat(sc.fistH, sc.fistJ(APART)));
    assert.ok(far.valid && !far.contact, 'apart: valid pose, no contact');
  }
});

test('fires ONCE on contact; holding never repeats; separating and touching again re-fires (both assignments)', () => {
  for (const openH of ['left', 'right']) {
    const sc = scene(openH);
    const { ev } = run(sc, [{ lift: APART, frames: 20 }, { lift: approach(APART, TOUCH), frames: 10 }, { lift: TOUCH, frames: 60 },
      { lift: approach(TOUCH, APART), frames: 10 }, { lift: APART, frames: 10 }, { lift: approach(APART, TOUCH), frames: 10 }, { lift: TOUCH, frames: 20 }]);
    assert.equal(ev.length, 2, `${openH}: ${ev.length} fires`);
    assert.equal(ev[0].open, openH); assert.equal(ev[0].fist, openH === 'left' ? 'right' : 'left');
  }
});

test('contact time = the FIRST contact frame (no confirmation delay in the timestamp)', () => {
  const sc = scene('left');
  const prev = FAN_TUNING.contactFrames; FAN_TUNING.contactFrames = 3;
  try {
    const { ev } = run(sc, [{ lift: APART, frames: 20 }, { lift: approach(APART, TOUCH), frames: 8 }, { lift: TOUCH, frames: 20 }]);
    assert.equal(ev.length, 1);
    assert.ok(ev[0].t - ev[0].tContact > 1.5 / 72 && ev[0].t - ev[0].tContact < 2.5 / 72, `confirm delay ${(ev[0].t - ev[0].tContact) * 1000} ms is not in tContact`);
  } finally { FAN_TUNING.contactFrames = prev; }
});

test('rejected look-alikes: flat fist pressed on the palm, knuckles down, fist on the back of a hand, two fists, two palms', () => {
  const cases = {
    flatFist: { fistRoll: 0 }, // palm-down fist, thumb side horizontal
    flatFistOther: { fistRoll: 180 },
    knucklesDown: { fistExtra: new THREE.Quaternion().setFromAxisAngle(X, -Math.PI / 2) }, // fist face (knuckles) pointing down
    backOfHand: { openRoll: 0 }, // open hand palm DOWN: the fist lands on its back
    twoFists: { openCurl: 'fist' },
    twoPalms: { fistCurl: 'open' },
    sidewaysFist: { fistRoll: -40 }, // 50° off upright (tolerance 40°)
  };
  for (const [name, o] of Object.entries(cases)) for (const openH of ['left', 'right']) {
    const oo = { ...o }; if (name === 'sidewaysFist' && openH === 'right') oo.fistRoll = 40; // mirror for the left fist
    const sc = scene(openH, oo);
    const { ev } = run(sc, [{ lift: APART, frames: 20 }, { lift: approach(APART, TOUCH), frames: 10 }, { lift: TOUCH, frames: 30 }]);
    assert.equal(ev.length, 0, `${name} (${openH} open) must not fire`);
  }
});

test('natural tolerance: palm tilted 25°, fist 25° off upright, 3 cm off-centre → still fires', () => {
  for (const openH of ['left', 'right']) {
    const tilt = new THREE.Quaternion().setFromAxisAngle(X, THREE.MathUtils.degToRad(25));
    const fr = openH === 'left' ? ROLL.uprightR + 25 : ROLL.uprightL - 25;
    const sc = scene(openH, { openExtra: tilt, fistRoll: fr });
    const { ev } = run(sc, [{ lift: APART, frames: 20 }, { lift: approach(APART, TOUCH), frames: 10, lat: 0.03 }, { lift: TOUCH, frames: 10, lat: 0.03 }]);
    assert.equal(ev.length, 1, `${openH}`);
  }
});

test('tracking: loss + recovery while still touching never fires again; already touching when hands appear never fires', () => {
  const sc = scene('right');
  // fired, then a short gap and a long gap while touching → no new contact event
  const a = run(sc, [{ lift: APART, frames: 20 }, { lift: approach(APART, TOUCH), frames: 10 }, { lift: TOUCH, frames: 10 },
    { lift: TOUCH, frames: 5, lostFist: true }, { lift: TOUCH, frames: 30 }, { lift: TOUCH, frames: 40, lostOpen: true }, { lift: TOUCH, frames: 30 }]);
  assert.equal(a.ev.length, 1, 'only the real contact');
  // the hands appear already touching (e.g. after occlusion longer than the tolerance) → must separate first
  const b = run(sc, [{ lift: TOUCH, frames: 40 }]);
  assert.equal(b.ev.length, 0);
  const c = run(sc, [{ lift: APART, frames: 20 }, { lift: approach(APART, 0.05), frames: 5 }, { lift: 0.05, frames: 20, lostFist: true }, { lift: TOUCH, frames: 30 }]);
  assert.equal(c.ev.length, 0, 'contact "appearing" after a long gap is not a new touch');
  // blocked context (menu / pause): the contact is consumed, nothing fires, and holding after unblocking does not fire
  const d = run(sc, [{ lift: APART, frames: 20 }, { lift: approach(APART, TOUCH), frames: 10 }, { lift: TOUCH, frames: 20 }], { allow: false });
  assert.equal(d.ev.length, 0);
});

test('arbitration: fan pose suppresses one-hand web / light bomb; releasing the fist after a fan web is never a throw; palm menu untouched', async () => {
  const { InputHub } = await import('../src/input/hub.js');
  const hub = new InputHub({ renderer: null, player: new THREE.Object3D(), camera: new THREE.Object3D() });
  const sc = scene('left'); let t = 0; const evAll = [];
  const frame = (lift, { fistCurl = 'fist', move = null } = {}) => {
    t += 1 / 72; hub.events.length = 0;
    const fo = hub.features.left, ff = hub.features.right;
    fo.setJoints(sc.O.p, sc.O.q, t);
    const j = joints('right', fistCurl, { roll: sc.fistRoll, at: sc.fistAt(lift).add(move ? move(t) : new THREE.Vector3()) });
    ff.setJoints(j.p, j.q, t);
    for (const h of ['left', 'right']) hub.events.push(...hub.machines[h].update(hub.features[h], { t, allowWeb: true, allowBomb: true, headForward: new THREE.Vector3(0, 0, -1) }));
    hub._fanWeb(t, true);
    evAll.push(...hub.events.map((e) => ({ ...e, t })));
    return hub.events;
  };
  hub.ctx.fanWeb = true;
  for (let i = 0; i < 10; i++) frame(0.25, { fistCurl: 'open' });
  for (let i = 0; i < 30; i++) frame(0.25); // fist made far away → the bomb machine starts charging (normal)
  assert.ok(evAll.some((e) => e.type === 'bombCharge'), 'a lone fist still charges a light bomb');
  for (let i = 0; i < 12; i++) frame(0.25 + (0.005 - 0.25) * (i / 11));
  for (let i = 0; i < 10; i++) frame(0.005);
  assert.equal(evAll.filter((e) => e.type === 'fanWeb').length, 1, 'one fan web');
  assert.ok(evAll.some((e) => e.type === 'bombCancel' && e.reason === 'fanWeb'), 'the started charge was cancelled');
  const after = evAll.length;
  // open the fist while moving it forward fast (looks like a throw) → no bombThrow / web
  let t0 = null;
  for (let i = 0; i < 12; i++) frame(0.005, { fistCurl: 'open', move: (tt) => { t0 ??= tt; return new THREE.Vector3(0, 0, -(tt - t0) * 3); } });
  assert.equal(evAll.slice(after).filter((e) => ['bombThrow', 'web', 'bombCharge', 'fanWeb'].includes(e.type)).length, 0, JSON.stringify(evAll.slice(after).map((e) => e.type)));
  // palm button: a fist on the palm never presses it (needs the index fingertip)
  const pb = new PalmButton(), L = feat('left', joints('left', 'open', { roll: 0, extra: new THREE.Quaternion().setFromAxisAngle(X, Math.PI / 2), at: new THREE.Vector3(-0.1, 1.2, -0.3) }));
  const fist = feat('right', joints('right', 'fist', { roll: ROLL.uprightR, at: L.palm.clone() }));
  let pressed = 0; for (let i = 0; i < 30; i++) if (pb.update(L, fist, new THREE.Vector3(0, 1.6, 0), i / 72)) pressed++;
  assert.equal(pressed, 0);
  void HandGestureMachine;
});
