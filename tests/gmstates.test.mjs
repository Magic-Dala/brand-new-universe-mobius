// v0.46 Green Maniac animated state machine: 'taunt' and 'hit' on a tiny synthetic Mixamo-named rig (no GLB needed):
// facing (which clip plays), the return to the base loop current when the hit ends, a hit never leaving him stuck, and
// an older model without the close-combat clips.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.window = globalThis.window || { addEventListener() {} };
const THREE = await import('three');
const { createGreenManiacAnimated } = await import('../src/art/greenManiacAnimated.js');

function model({ close = true } = {}) {
  const names = ['mixamorigHips', 'mixamorigSpine2', 'mixamorigRightHand', 'mixamorigRightHandMiddle1'];
  const bones = names.map((n) => Object.assign(new THREE.Bone(), { name: n }));
  for (let i = 1; i < bones.length; i++) { bones[i - 1].add(bones[i]); bones[i].position.y = 0.3; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0, 1, 0, 0], 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(12).fill(0), 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  const scene = new THREE.Group(); scene.add(bones[0]); scene.add(mesh); mesh.bind(new THREE.Skeleton(bones));
  const clip = (name, len, yaw = 0) => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).toArray();
    return new THREE.AnimationClip(name, len, [new THREE.QuaternionKeyframeTrack('mixamorigHips.quaternion', [0, len], [...q, ...q])]);
  };
  const yawed = (c, name) => { const y = c.clone(); y.name = name; const v = y.tracks[0].values, q = new THREE.Quaternion(); for (let i = 0; i < v.length; i += 4) { q.fromArray(v, i).premultiply(new THREE.Quaternion(0, 1, 0, 0)); q.toArray(v, i); } return y; };
  const clips = { wait: clip('wait', 2), surf: clip('surf', 2), throw: clip('throw', 1.5), turn: clip('turn', 1, Math.PI), stretch: clip('stretch', 2) };
  clips.throw2 = clips.throw.clone(); clips.throwBack = yawed(clips.throw, 'throwBack'); clips.stretchBack = yawed(clips.stretch, 'stretchBack'); clips.turnFwd = yawed(clips.turn, 'turnFwd');
  if (close) {
    clips.taunt = clip('taunt', 2.83); clips.tauntBack = yawed(clips.taunt, 'tauntBack');
    for (const [k, len] of [['headHit', 1.43], ['bodyHit', 1.17]]) {
      clips[k] = clip(k, len); clips[k + 'Back'] = yawed(clips[k], k + 'Back');
      for (const n of [k, k + 'Back']) { clips[n + '2'] = clips[n].clone(); clips[n + '2'].name = n + '2'; }
    }
  }
  return { scene, clips, scale: 1, offset: new THREE.Vector3(), material: mesh.material };
}
function rig(opts) {
  const m = createGreenManiacAnimated(model(opts)); let t = 0;
  const step = (sec, dt = 1 / 30) => { for (let k = 0; k < Math.round(sec / dt); k++) { t += dt; m.update(dt, t); } };
  const top = () => { let best = null, bw = -1; for (const a of m.mixer._actions) if (a.isRunning() && a.getEffectiveWeight() > bw) { bw = a.getEffectiveWeight(); best = a; } return best?.getClip().name; };
  return { m, step, top };
}

test('taunt: the turn, then the yawed taunt loop; faceFront turns him back to surf', () => {
  const { m, step, top } = rig();
  m.setState('ride'); step(1);
  m.setState('taunt'); assert.equal(m.state, 'taunt'); step(0.2); assert.equal(top(), 'turn');
  step(1.5); assert.equal(m.state, 'taunt'); assert.equal(top(), 'tauntBack');
  m.setState('faceFront'); step(0.2); assert.equal(top(), 'turnFwd');
  step(1.5); assert.equal(m.state, 'ride'); assert.equal(top(), 'surf');
});
test('hit while surfing: forward clip, back to ride by itself', () => {
  const { m, step, top } = rig();
  m.setState('ride'); step(1);
  m.setState('hit', 'body'); assert.equal(m.state, 'hit'); step(0.2); assert.match(top(), /^bodyHit2?$/);
  step(1.3); assert.equal(m.state, 'ride'); step(0.4); assert.equal(top(), 'surf');
});
test('hit while taunting: yawed clip (head by default), back to the taunt loop', () => {
  const { m, step, top } = rig();
  m.setState('ride'); step(1); m.setState('taunt'); step(2);
  m.setState('hit'); step(0.2); assert.match(top(), /^headHitBack2?$/);
  step(1.5); assert.equal(m.state, 'taunt'); step(0.4); assert.equal(top(), 'tauntBack');
});
test('a hit during a hit restarts on the other copy (crossfade)', () => {
  const { m, step, top } = rig();
  m.setState('ride'); step(1);
  m.setState('hit'); step(0.3); const first = top();
  m.setState('hit'); step(0.2); const second = top();
  assert.notEqual(first, second); assert.match(second, /^headHit2?$/); assert.equal(m.state, 'hit');
});
test('the base loop current when the hit ends wins; a stagger hurt during the hit is returned to', () => {
  const { m, step } = rig();
  m.setState('ride'); step(1); m.setState('hit'); step(0.2);
  m.setState('hurt'); assert.equal(m.state, 'hit'); // the reaction plays on…
  step(1.5); assert.equal(m.state, 'hurt'); // …then back to the stagger's hurt pose
});
test('ride / taunt / faceBack / throw during a hit win at once; nothing is left stuck on the hit clip', () => {
  for (const next of ['ride', 'taunt', 'faceBack', 'faceFront', 'throw', 'turn']) {
    const { m, step, top } = rig();
    m.setState('ride'); step(1); m.setState('taunt'); step(2); // facing back (taunt), then a hit
    m.setState('hit'); step(0.2);
    m.setState(next); step(4);
    assert.ok(!/Hit/.test(top()), `${next}: still on ${top()}`); assert.notEqual(m.state, 'hit', next);
  }
});
test('a hit never interrupts a throw or a turn', () => {
  const { m, step } = rig();
  m.setState('ride'); step(1); m.setState('throw'); step(0.1);
  assert.equal(m.setState('hit'), false); assert.equal(m.state, 'throw');
  m.setState('turn'); assert.equal(m.setState('hit'), false); assert.equal(m.state, 'turn');
  step(3); assert.equal(m.setState('hit'), true); assert.equal(m.state, 'hit'); // (reports whether the reaction played)
});
test('older model (no taunt / hit clips): taunt = faceBack, hit = the hurt shake; nothing throws', () => {
  const { m, step } = rig({ close: false });
  m.setState('ride'); step(1);
  m.setState('taunt'); assert.equal(m.state, 'faceBack'); step(2);
  assert.equal(m.setState('hit', 'body'), true); assert.equal(m.state, 'hurt'); step(0.5);
  m.setState('faceFront'); step(2); assert.equal(m.state, 'ride');
});
test('older model: the hurt shake while facing back ends with taunt (no turn, no snap to the front)', () => {
  const { m, step, top } = rig({ close: false });
  m.setState('ride'); step(1); m.setState('taunt'); step(2); assert.equal(top(), 'stretchBack');
  m.setState('hit', 'body'); assert.equal(m.state, 'hurt'); step(0.45);
  m.setState('taunt'); assert.equal(m.state, 'faceBack'); assert.equal(m.facingBack, true); step(0.2); assert.equal(top(), 'stretchBack');
});
test('facingBack: true only while a backwards loop is the base', () => {
  const { m, step } = rig();
  m.setState('ride'); step(1); assert.equal(m.facingBack, false);
  m.setState('taunt'); assert.equal(m.facingBack, true); step(2);
  m.setState('faceFront'); assert.equal(m.facingBack, false); step(2); assert.equal(m.state, 'ride');
});
