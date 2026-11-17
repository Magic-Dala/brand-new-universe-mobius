// v0.48 energy wave gesture: both hands open, palms forward, brought together side by side. Fires once on the first
// joined frame. Synthetic WebXR hands from the procedural skeleton (default = palm DOWN, fingers −Z).
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.window = globalThis.window || { addEventListener() {} };
const THREE = await import('three');
const { generateHandPose } = await import('../src/art/mobius.js');
const { HandFeatures } = await import('../src/input/gestures.js');
const { EnergyWaveDetector, WAVE_TUNING, wavePose } = await import('../src/input/energyWave.js');
const { FanWebDetector } = await import('../src/input/fanWeb.js');

const CURL = { open: [0.1, 0, 0, 0, 0], fist: [0.8, 1, 1, 1, 1] };
const XA = new THREE.Vector3(1, 0, 0), ZA = new THREE.Vector3(0, 0, 1);
const HEAD = new THREE.Vector3(0, 1.6, 0), FWD = new THREE.Vector3(0, 0, -1);
const Q = { forward: new THREE.Quaternion().setFromAxisAngle(XA, Math.PI / 2), // palm normal −Y → −Z (facing forward), fingers up
  down: new THREE.Quaternion(), up: new THREE.Quaternion().setFromAxisAngle(ZA, Math.PI),
  back: new THREE.Quaternion().setFromAxisAngle(XA, -Math.PI / 2) };
/** Joints of hand h with its PALM CENTRE at `palmAt`. */
function joints(h, curl, rot, palmAt) {
  const p = new Float32Array(75), q = new Float32Array(100), v = new THREE.Vector3(), jq = new THREE.Quaternion();
  generateHandPose(h, CURL[curl], p, q);
  for (let i = 0; i < 25; i++) { v.fromArray(p, i * 3).applyQuaternion(rot); v.toArray(p, i * 3); jq.fromArray(q, i * 4).premultiply(rot); jq.toArray(q, i * 4); }
  const f = new HandFeatures(h); f.setJoints(p, q, 0); const d = palmAt.clone().sub(f.palm);
  for (let i = 0; i < 25; i++) { v.fromArray(p, i * 3).add(d); v.toArray(p, i * 3); }
  return { p, q };
}
const C = new THREE.Vector3(0, 1.35, -0.4); // in front of the chest
const at = (h, sep, dy = 0) => new THREE.Vector3((h === 'left' ? -1 : 1) * sep / 2, C.y + (h === 'left' ? dy : 0), C.z);
/** steps: [{ sep, frames, L?, R?, rotL?, rotR?, lostL?, lostR?, dy? }] (sep = distance between the palm centres) */
function run(steps, { allow = true, det = new EnergyWaveDetector(), fan = null } = {}) {
  const fL = new HandFeatures('left'), fR = new HandFeatures('right'), ev = [], fanEv = []; let t = 0, engaged = false;
  for (const s of steps) for (let i = 0; i < (s.frames || 1); i++) {
    t += 1 / 72;
    const sep = typeof s.sep === 'function' ? s.sep(i, s.frames) : s.sep;
    if (s.lostL) fL.setTracked(false, t); else { const j = joints('left', s.L || 'open', s.rotL || Q.forward, at('left', sep, s.dy || 0)); fL.setJoints(j.p, j.q, t); }
    if (s.lostR) fR.setTracked(false, t); else { const j = joints('right', s.R || 'open', s.rotR || Q.forward, at('right', sep)); fR.setJoints(j.p, j.q, t); }
    const e = det.update(fL, fR, { t, headPos: HEAD, headFwd: FWD, allow }); if (e) ev.push({ ...e, frameT: t });
    engaged = engaged || det.engaged;
    if (fan) { const f = fan.update(fL, fR, { t, allow: true }); if (f) fanEv.push(f); }
  }
  return { ev, det, engaged, fanEv, fL, fR };
}
const close = (frames = 20, from = 0.4, to = 0.06) => ({ sep: (i, n) => from + (to - from) * (i / (n - 1)), frames });

test('the pose: open, palm forward, raised in front', () => {
  const { fL } = run([{ sep: 0.4, frames: 4 }]);
  const p = wavePose(fL, HEAD, FWD);
  assert.ok(p.open && p.raised && p.ok, JSON.stringify(p)); assert.ok(p.faceDeg < 15, `palm faces forward (${p.faceDeg.toFixed(1)}°)`);
});
test('accepts: both hands open, palms forward, brought together: fires ONCE, on the first joined frame', () => {
  const { ev, det } = run([{ sep: 0.4, frames: 6 }, close(), { sep: 0.06, frames: 30 }]);
  assert.equal(ev.length, 1, 'holding the palms together never fires again');
  assert.equal(ev[0].tContact, ev[0].frameT, 'the contact time is the frame the palms joined');
  assert.ok(Math.abs(ev[0].origin.x) < 0.01 && Math.abs(ev[0].origin.z - C.z) < 0.05, 'origin = between the palms');
  assert.equal(det.state, 'waitRelease');
});
test('fires again only after the palms part by releaseDist', () => {
  const part = (to) => [{ sep: 0.4, frames: 6 }, close(), { sep: to, frames: 6 }, { sep: 0.06, frames: 6 }];
  assert.equal(run(part(0.20)).ev.length, 1, '0.20 m apart is not released (releaseDist 0.24)');
  assert.equal(run([...part(0.30), { sep: 0.30, frames: 20 }, close(10, 0.3, 0.06)]).ev.length >= 2, true);
  assert.equal(run([{ sep: 0.4, frames: 6 }, close(), { sep: 0.3, frames: 30 }, close(10, 0.3, 0.06)]).ev.length, 2);
});
test('rejects: one hand', () => {
  assert.equal(run([{ sep: 0.4, frames: 6, lostL: true }, { ...close(), lostL: true }, { sep: 0.06, frames: 10, lostL: true }]).ev.length, 0);
  assert.equal(run([{ sep: 0.4, frames: 6, lostR: true }, { ...close(), lostR: true }]).ev.length, 0);
});
test('rejects: two fists, and one fist with one open hand', () => {
  assert.equal(run([{ sep: 0.4, frames: 6, L: 'fist', R: 'fist' }, { ...close(), L: 'fist', R: 'fist' }, { sep: 0.06, frames: 10, L: 'fist', R: 'fist' }]).ev.length, 0);
  assert.equal(run([{ sep: 0.4, frames: 6, R: 'fist' }, { ...close(), R: 'fist' }, { sep: 0.06, frames: 10, R: 'fist' }]).ev.length, 0);
});
test('rejects: the Fan Web pose (a palm-up hand and an upright fist), and the wave pose does not fire the Fan Web', () => {
  const up = Q.up, upright = new THREE.Quaternion().setFromAxisAngle(ZA, -Math.PI / 2);
  const fanPose = (sep, frames) => ({ sep, frames, rotL: up, R: 'fist', rotR: upright });
  const r = run([fanPose(0.4, 6), { ...close(), rotL: up, R: 'fist', rotR: upright }, fanPose(0.06, 10)]);
  assert.equal(r.ev.length, 0); assert.equal(r.engaged, false, 'the Fan Web pose does not even engage the wave');
  const w = run([{ sep: 0.4, frames: 6 }, close(), { sep: 0.06, frames: 10 }], { fan: new FanWebDetector() });
  assert.equal(w.ev.length, 1); assert.equal(w.fanEv.length, 0, 'two open palms never fire the Fan Web');
});
test('accepts palms touching each other (a clap) as well as palms forward; rejects palms turned back toward the player', () => {
  const inL = new THREE.Quaternion().setFromAxisAngle(ZA, Math.PI / 2), inR = new THREE.Quaternion().setFromAxisAngle(ZA, -Math.PI / 2); // palm normals toward each other
  assert.equal(run([{ sep: 0.4, frames: 6, rotL: inL, rotR: inR }, { ...close(20, 0.4, 0.04), rotL: inL, rotR: inR }, { sep: 0.04, frames: 10, rotL: inL, rotR: inR }]).ev.length, 1, 'palms pressed together fire');
  for (const rot of [Q.back]) assert.equal(run([{ sep: 0.4, frames: 6, rotL: rot, rotR: rot }, { ...close(), rotL: rot, rotR: rot }, { sep: 0.06, frames: 10, rotL: rot, rotR: rot }]).ev.length, 0);
});
test('rejects: palms further apart than joinDist, however long they are held', () => {
  assert.ok(WAVE_TUNING.joinDist === 0.16);
  assert.equal(run([{ sep: 0.4, frames: 6 }, close(20, 0.4, 0.18), { sep: 0.18, frames: 60 }]).ev.length, 0);
  assert.equal(run([{ sep: 0.4, frames: 6 }, close(20, 0.4, 0.15), { sep: 0.15, frames: 5 }]).ev.length, 1, 'just inside joins');
});
test('rejects: stacked palms (one above the other)', () => {
  assert.equal(run([{ sep: 0.4, frames: 6, dy: 0.13 }, { ...close(20, 0.4, 0.02), dy: 0.13 }, { sep: 0.02, frames: 10, dy: 0.13 }]).ev.length, 0);
});
test('a tracking gap: hands that come back already together fire; dropping far apart never does', () => {
  // a short gap (under lostTolerance) while apart, then join: still fires
  assert.equal(run([{ sep: 0.4, frames: 6 }, { sep: 0.4, frames: 5, lostL: true }, close(), { sep: 0.06, frames: 5 }]).ev.length, 1);
  // tracking lost while the hands come together, back already joined: it fires on the first frame they are seen together (2026-11-15)
  const r = run([{ sep: 0.4, frames: 6 }, { sep: 0.4, frames: 30, lostL: true, lostR: true }, { sep: 0.06, frames: 30 }]);
  assert.equal(r.ev.length, 1, 'hands that reappear already joined fire once');
  // hands together from the very first frame they are seen: fires at once, no "seen apart first" needed
  assert.equal(run([{ sep: 0.06, frames: 10 }]).ev.length, 1);
  // fist to open as the hands meet (no open frames apart beforehand): fires on the first open, joined frame
  assert.equal(run([{ sep: 0.4, frames: 6, L: 'fist', R: 'fist' }, { ...close(8, 0.4, 0.06), L: 'fist', R: 'fist' }, { sep: 0.06, frames: 3 }]).ev.length, 1);
  // tracking drops exactly as the palms meet (ready, closing, under 0.24 m): that IS the join, once
  const g = run([{ sep: 0.4, frames: 6 }, close(10, 0.4, 0.2), { sep: 0.06, frames: 3, lostR: true }, { sep: 0.06, frames: 10 }]); assert.equal(g.ev.length, 1); assert.equal(g.ev[0].onLoss, true);
  // dropping while still far apart, or while the hands move apart, is never a fire
  assert.equal(run([{ sep: 0.4, frames: 6 }, close(10, 0.4, 0.3), { sep: 0.3, frames: 3, lostR: true }]).ev.length, 0);
  assert.equal(run([{ sep: 0.2, frames: 6 }, close(10, 0.2, 0.23), { sep: 0.3, frames: 3, lostR: true }]).ev.length, 0);
});
test('not allowed (outside the Arcade): nothing fires, and it does not fire late when allowed again', () => {
  const det = new EnergyWaveDetector();
  assert.equal(run([{ sep: 0.4, frames: 6 }, close(), { sep: 0.06, frames: 10 }], { allow: false, det }).ev.length, 0);
  assert.equal(det.state, 'waitRelease');
});
test('engaged: both hands in the pose within engageDist (one-hand webs and Light Bomb charging are suppressed then)', () => {
  assert.equal(run([{ sep: 0.4, frames: 10 }]).engaged, false);
  assert.equal(run([{ sep: 0.26, frames: 10 }]).det.engaged, true);
  assert.equal(run([{ sep: 0.26, frames: 10, L: 'fist' }]).det.engaged, false);
});
test('cooldown: two joins closer than the cooldown give one wave', () => {
  const quick = [{ sep: 0.4, frames: 6 }, close(6), { sep: 0.3, frames: 3 }, close(4, 0.3, 0.06), { sep: 0.06, frames: 2 }];
  assert.equal(run(quick).ev.length, 1);
});
