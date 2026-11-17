// Gesture recognizer tests using the procedural hand skeleton (WebXR joint conventions).
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
const THREE = await import('three');
const { generateHandPose } = await import('../src/art/mobius.js');
const { HandFeatures, HandGestureMachine, PalmButton } = await import('../src/input/gestures.js');

const POSES = {
  open: [0.1, 0, 0, 0, 0],
  web: [0.2, 0, 1, 1, 0], // middle + ring curled, index + pinky extended
  fist: [0.8, 1, 1, 1, 1],
  point: [0.6, 0, 1, 1, 1],
  half: [0.3, 0.5, 0.5, 0.5, 0.5],
  webLoose: [0.7, 0.35, 1, 1, 0.35], // v0.24: index / pinky / thumb relaxed, middle + ring fully curled
  webHalf: [0.2, 0, 0.6, 0.6, 0], // middle + ring only half curled
  webOneCurl: [0.2, 0, 1, 0.35, 0], // ring not curled
};
/** Make world-ish joints: wrist at `at`, hand rotated by `rot` (palm facing forward for web aim). */
function joints(pose, { at = new THREE.Vector3(0.2, 1.2, -0.4), rot = new THREE.Quaternion() } = {}) {
  const p = new Float32Array(75), q = new Float32Array(100);
  generateHandPose('right', POSES[pose], p, q);
  const v = new THREE.Vector3(), jq = new THREE.Quaternion();
  for (let i = 0; i < 25; i++) {
    v.fromArray(p, i * 3).applyQuaternion(rot).add(at); v.toArray(p, i * 3);
    jq.fromArray(q, i * 4).premultiply(rot); jq.toArray(q, i * 4);
  }
  return { p, q };
}
const FWD = new THREE.Vector3(0, 0, -1);
function run(seq, { allow = true } = {}) {
  const f = new HandFeatures('right'), m = new HandGestureMachine('right');
  const events = []; let t = 0;
  for (const step of seq) {
    for (let i = 0; i < (step.frames || 1); i++) {
      t += 1 / 72;
      if (step.lost) f.setTracked(false, t);
      else { const at = step.move ? step.move(t) : undefined; const j = joints(step.pose, { at, rot: step.rot }); f.setJoints(j.p, j.q, t); }
      for (const e of m.update(f, { t, allowWeb: allow, allowBomb: allow, headForward: FWD })) events.push({ ...e, t });
    }
  }
  return { events, f, m };
}

test('classifier: web pose vs fist vs open are distinct', () => {
  const f = new HandFeatures('right');
  for (const [name, expWeb, expFist] of [['web', true, false], ['fist', false, true], ['open', false, false], ['point', false, false]]) {
    const j = joints(name); f.setJoints(j.p, j.q, 0);
    assert.equal(f.webConfidence() > 0.62, expWeb, `${name} web=${f.webConfidence().toFixed(2)}`);
    assert.equal(f.fistConfidence() > 0.62, expFist, `${name} fist=${f.fistConfidence().toFixed(2)}`);
  }
});
test('web fires once per pose entry; holding does not auto-repeat; re-arm needs exit', () => {
  const { events } = run([{ pose: 'open', frames: 20 }, { pose: 'web', frames: 60 }, { pose: 'open', frames: 10 }, { pose: 'web', frames: 10 }]);
  assert.equal(events.filter((e) => e.type === 'web').length, 2);
});
test('debounce: single-frame pose flicker does not fire', () => {
  const seq = [{ pose: 'open', frames: 20 }];
  for (let i = 0; i < 6; i++) seq.push({ pose: 'web', frames: 1 }, { pose: 'open', frames: 3 });
  assert.equal(run(seq).events.filter((e) => e.type === 'web').length, 0);
});
test('tracking loss + recovery inside the pose does not misfire', () => {
  const { events } = run([{ pose: 'open', frames: 20 }, { pose: 'web', frames: 10 }, { lost: true, frames: 20 }, { pose: 'web', frames: 40 }]);
  assert.equal(events.filter((e) => e.type === 'web').length, 1, 'only the original entry');
});
test('hand appearing already in web pose does not fire until re-armed', () => {
  const { events } = run([{ pose: 'web', frames: 40 }, { pose: 'open', frames: 10 }, { pose: 'web', frames: 10 }]);
  assert.equal(events.filter((e) => e.type === 'web').length, 1);
});
test('light bomb: fist → forward throw → open releases; opening without motion fizzles', () => {
  const still = run([{ pose: 'open', frames: 20 }, { pose: 'fist', frames: 40 }, { pose: 'open', frames: 10 }]).events;
  assert.ok(still.some((e) => e.type === 'bombCharge'));
  assert.equal(still.filter((e) => e.type === 'bombThrow').length, 0);
  assert.ok(still.some((e) => e.type === 'bombFizzle'));
  // throw: move forward at ~2.5 m/s during the last frames and open while moving
  let t0 = null;
  const move = (t) => { t0 ??= t; return new THREE.Vector3(0.2, 1.2, -0.3 - Math.max(0, t - t0) * 2.5); };
  const thrown = run([{ pose: 'open', frames: 20 }, { pose: 'fist', frames: 40 }, { pose: 'fist', frames: 12, move }, { pose: 'open', frames: 4, move }]).events;
  const th = thrown.filter((e) => e.type === 'bombThrow');
  assert.equal(th.length, 1);
  assert.ok(th[0].velocity.z < -1.5, `vz ${th[0].velocity.z}`);
});
test('backward motion is not a throw', () => {
  let t0 = null;
  const move = (t) => { t0 ??= t; return new THREE.Vector3(0.2, 1.2, -0.3 + Math.max(0, t - t0) * 2.5); };
  const ev = run([{ pose: 'open', frames: 20 }, { pose: 'fist', frames: 40 }, { pose: 'fist', frames: 12, move }, { pose: 'open', frames: 4, move }]).events;
  assert.equal(ev.filter((e) => e.type === 'bombThrow').length, 0);
});
test('attacks blocked (menu open) produce no web/bomb events', () => {
  const ev = run([{ pose: 'open', frames: 20 }, { pose: 'web', frames: 20 }, { pose: 'open', frames: 10 }, { pose: 'fist', frames: 30 }], { allow: false }).events;
  assert.equal(ev.filter((e) => e.type === 'web' || e.type === 'bombCharge').length, 0);
});
test('palm button: hover, press on penetration, no repeat until withdrawn', () => {
  const L = new HandFeatures('left'), R = new HandFeatures('right');
  // left palm facing the head: palm normal toward +Z (head at z=+0.4)
  const lp = new Float32Array(75), lq = new Float32Array(100);
  generateHandPose('left', POSES.open, lp, lq);
  L.setJoints(lp, lq, 0);
  const pb = new PalmButton();
  // rotate left hand so palm normal faces head
  const rot = new THREE.Quaternion().setFromUnitVectors(L.palmNormal.clone(), new THREE.Vector3(0, 0, 1));
  const v = new THREE.Vector3(), jq = new THREE.Quaternion();
  for (let i = 0; i < 25; i++) { v.fromArray(lp, i * 3).applyQuaternion(rot); v.toArray(lp, i * 3); jq.fromArray(lq, i * 4).premultiply(rot); jq.toArray(lq, i * 4); }
  L.setJoints(lp, lq, 0);
  const head = new THREE.Vector3(0, 0, 0.4);
  const centre = L.palm.clone().addScaledVector(L.palmNormal, 0.015);
  const placeTip = (d, t) => {
    const p = new Float32Array(75), q = new Float32Array(100); generateHandPose('right', POSES.point, p, q);
    const tip = new THREE.Vector3().fromArray(p, 9 * 3);
    const want = centre.clone().addScaledVector(L.palmNormal, d);
    const off = want.sub(tip);
    for (let i = 0; i < 25; i++) { v.fromArray(p, i * 3).add(off); v.toArray(p, i * 3); }
    R.setJoints(p, q, t);
  };
  let presses = 0, t = 0;
  for (let i = 0; i < 10; i++) { placeTip(0.06, (t += 0.014)); L.setJoints(lp, lq, t); pb.update(L, R, head, t); }
  assert.ok(pb.visible, 'visible when palm faces head');
  for (const d of [0.04, 0.02, 0.0, -0.01, -0.012, -0.012, -0.012]) { placeTip(d, (t += 0.014)); if (pb.update(L, R, head, t)) presses++; }
  assert.equal(presses, 1);
  for (const d of [-0.012, -0.01, -0.012]) { placeTip(d, (t += 0.5)); if (pb.update(L, R, head, t)) presses++; }
  assert.equal(presses, 1, 'no repeat while still pressed');
  for (const d of [0.05, 0.0, -0.012]) { placeTip(d, (t += 0.5)); if (pb.update(L, R, head, t)) presses++; }
  assert.equal(presses, 2, 're-armed after withdrawing');
});

test('web aims along the hand forward (wrist → middle knuckle) and leaves from the wrist', () => {
  const f = new HandFeatures('right');
  // arbitrary hand orientations: the web direction must track the two extended fingers
  for (const rot of [new THREE.Quaternion(), new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.2, 0.4, 0.3)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, -2.0, 1.1))]) {
    const j = joints('web', { rot }); f.setJoints(j.p, j.q, 0);
    const P = (i) => new THREE.Vector3().fromArray(j.p, i * 3);
    const expected = P(11).sub(P(0)).normalize(); // middle proximal − wrist
    assert.ok(f.webDir.angleTo(expected) < 1e-4, 'matches hand forward');
    // independent of finger curl: same hand in fist pose gives the same direction
    const jf = joints('fist', { rot }); const g = new HandFeatures('right'); g.setJoints(jf.p, jf.q, 0);
    assert.ok(g.webDir.angleTo(f.webDir) < THREE.MathUtils.degToRad(3), 'curl-independent');
    assert.ok(f.webDir.angleTo(f.palmNormal) > THREE.MathUtils.degToRad(45), 'not the palm normal');
    assert.ok(f.webOrigin.distanceTo(f.wrist) < 0.03, 'origin at the inner wrist');
    assert.ok(f.webOrigin.distanceTo(f.palm) > 0.03, 'origin is not the palm centre');
  }
});

test('flick re-fire: holding the web pose, a forward jab fires again; holding still does not', () => {
  let t0 = null;
  const jab = (t) => { t0 ??= t; const k = Math.max(0, t - t0); return new THREE.Vector3(0.2, 1.2, -0.3 - Math.min(0.2, k * 2.2)); };
  // web pose palm-forward so hand-forward ≈ -Z: rotate so fingers point forward (default skeleton already points -Z)
  const still = run([{ pose: 'open', frames: 20 }, { pose: 'web', frames: 80 }]).events.filter((e) => e.type === 'web').length;
  assert.equal(still, 1);
  const flicked = run([{ pose: 'open', frames: 20 }, { pose: 'web', frames: 40 }, { pose: 'web', frames: 10, move: jab }]).events.filter((e) => e.type === 'web');
  assert.equal(flicked.length, 2);
  assert.ok(flicked[1].flick);
});

test('v0.24 web pose: middle + ring must be fully curled; index / pinky / thumb need not be fully open', () => {
  const f = new HandFeatures('right');
  const conf = (n) => { const j = joints(n); f.setJoints(j.p, j.q, 0); return f.webConfidence(); };
  assert.ok(conf('webLoose') > 0.62, `loose ${conf('webLoose').toFixed(2)}`);
  assert.ok(conf('webHalf') < 0.4, `half ${conf('webHalf').toFixed(2)}`);
  assert.ok(conf('webOneCurl') < 0.4, `one ${conf('webOneCurl').toFixed(2)}`);
  assert.equal(run([{ pose: 'open', frames: 20 }, { pose: 'webHalf', frames: 40 }]).events.filter((e) => e.type === 'web').length, 0);
  assert.equal(run([{ pose: 'open', frames: 20 }, { pose: 'webLoose', frames: 40 }]).events.filter((e) => e.type === 'web').length, 1);
});
