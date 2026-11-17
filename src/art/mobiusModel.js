// Mobius / 小莫 — character model from public/models/mobius.glb (user-provided Tripo model, v2 2026-10:
// New_Mobius_3d_model_2k_rigged.glb optimised to 95k triangles, 2048² colour + normal / 1024² metal-rough WebP,
// quantised — see docs/ASSETS.md). v2 is rigged: its own joints + skin weights are used (loadMobiusModel).
// v1 fallback (a static A-pose with no skeleton) is auto-rigged at load time:
// a simple humanoid skeleton is placed from the body proportions and every vertex gets
// skin weights from its distance to the bone "capsules" (blending only between connected
// bones, so arms never stick to the torso). The rig is then driven like the old procedural
// mirror avatar: head = headset, torso follows head yaw, two-bone IK for arms and legs.
import * as THREE from 'three';
import { reflectionEnv } from './city.js';
import { loadBakedGLB } from './autorig.js';

const HEIGHT = 1.8; // metres (old procedural Mobius was the same)
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _Y = new THREE.Vector3(0, 1, 0);

let _model = null;
/**
 * Load + bake the model once (front → −Z, height 1.8 m, float attributes).
 * v2 (2026-10, New_Mobius_3d_model_2k_rigged.glb): the file is RIGGED (UE-style skeleton: pelvis / spine_01-03 /
 * clavicle / upperarm / lowerarm / hand + fingers / neck_01 / Head / thigh / calf / foot / ball). Its bind-pose
 * joints set the rig proportions (J below) and its skin weights are kept, summed onto our small bone set.
 * A static (unrigged) file still works: it falls back to the capsule auto-skin.
 */
export async function loadMobiusModel(url) {
  if (_model) return _model;
  const b = await loadBakedGLB(url || 'models/mobius.glb', { rotate: new THREE.Matrix4().makeRotationY(Math.PI), height: HEIGHT, center: 'xz' });
  const geo = b.geometry, mat = b.material;
  // metallic armour needs something to reflect (no scene environment): reuse the sunset reflection
  mat.envMap = reflectionEnv(); mat.envMapIntensity = 0.9;
  mat.metalness = Math.min(mat.metalness, 0.85);
  mat.name = 'mobius-armor';
  if (b.joints) applyJoints(b.joints);
  _model = { geometry: geo, material: mat, joints: b.joints };
  return _model;
}
/** Rig proportions from the file's bind pose (normalised by HEIGHT; right side = +X after the 180° turn). */
function applyJoints(joints) {
  const P = Object.fromEntries(joints.map((j) => [j.name, j.pos]));
  const has = (...n) => n.every((k) => P[k]);
  if (!has('pelvis', 'spine_01', 'spine_02', 'neck_01', 'Head', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'thigh_r', 'calf_r', 'foot_r', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'thigh_l', 'calf_l', 'foot_l')) return;
  const mid = (n) => [0, P[n].y / HEIGHT, P[n].z / HEIGHT];
  const side = (r, l) => { const R = P[r], L = P[l]; return [(Math.abs(R.x) + Math.abs(L.x)) / 2 / HEIGHT, (R.y + L.y) / 2 / HEIGHT, (R.z + L.z) / 2 / HEIGHT]; };
  Object.assign(J, {
    hips: mid('pelvis'), spine: mid('spine_01'), chest: mid('spine_02'), neck: mid('neck_01'), head: mid('Head'),
    clav: side('clavicle_r', 'clavicle_l'), shoulder: side('upperarm_r', 'upperarm_l'), elbow: side('lowerarm_r', 'lowerarm_l'), wrist: side('hand_r', 'hand_l'),
    tip: P.middle_04_leaf_r ? side('middle_04_leaf_r', 'middle_04_leaf_l') : side('hand_r', 'hand_l').map((v, i) => (i === 1 ? v - 0.08 : v)),
    hip: side('thigh_r', 'thigh_l'), knee: side('calf_r', 'calf_l'), ankle: side('foot_r', 'foot_l'),
    toe: P.ball_leaf_r ? side('ball_leaf_r', 'ball_leaf_l') : side('foot_r', 'foot_l').map((v, i) => (i === 2 ? v - 0.08 : v)),
  });
  J.clav[0] = Math.min(J.clav[0], J.shoulder[0] * 0.5); // clavicle starts near the sternum
  J.top = [0, Math.min(1, J.head[1] + 0.12), J.head[2]];
  J._fromFile = true;
}
// source joint → our bone (the file's clavicles drive our clavicle bones, fingers ride on the hand)
const JOINT_MAP = [
  [/^(root|ik_|socket|pelvis)/, 'hips'], [/^spine_01/, 'spine'], [/^spine_0[23]/, 'chest'], [/^clavicle_(l|r)/, 'clav'],
  [/^neck/, 'neck'], [/^head/i, 'head'],
  [/^upperarm_(l|r)/, 'upper'], [/^lowerarm_(l|r)/, 'fore'], [/^(hand|index|middle|ring|pinky|thumb).*_(l|r)$/, 'hand'],
  [/^thigh_(l|r)/, 'thigh'], [/^calf_(l|r)/, 'shin'], [/^(foot|ball).*_(l|r)$/, 'foot'],
];
export function mapMobiusJoint(name) {
  for (const [re, bone] of JOINT_MAP) if (re.test(name)) {
    if (['hips', 'spine', 'chest', 'neck', 'head'].includes(bone)) return bone;
    return bone + (/_l$/.test(name) ? 'L' : 'R'); // file left (_l) = our L (−X after the turn)
  }
  return 'hips';
}

/** Static A-pose suit for the armor rack. Origin = floor centre, front = local +Z. */
export function createMobiusModelDisplay(model) {
  const m = new THREE.Mesh(model.geometry, model.material);
  m.rotation.y = Math.PI; // baked front is −Z → face +Z (into the room on the rack mount)
  m.name = 'mobius-suit-display';
  const root = new THREE.Group(); root.name = 'mobius-suit-display-root'; root.add(m);
  return { root, mesh: m };
}

// ------------------------------------------------------------------ auto rig
// Joint positions measured on the model (normalised height 0..1, model front −Z, right = +X).
// x is mirrored for the left side.
const J = {
  hips: [0, 0.505, 0], spine: [0, 0.62, 0], chest: [0, 0.72, 0], neck: [0, 0.835, 0], head: [0, 0.87, 0], top: [0, 1.0, 0],
  clav: [0.035, 0.785, 0], shoulder: [0.15, 0.78, 0], elbow: [0.198, 0.625, 0], wrist: [0.232, 0.505, 0], tip: [0.245, 0.425, 0],
  hip: [0.068, 0.5, 0], knee: [0.07, 0.285, 0], ankle: [0.076, 0.062, 0], toe: [0.08, 0.012, -0.075],
};
const BONES = [ // name, parent, from-joint, to-joint, capsule radius (normalised), side
  ['hips', null, 'hips', 'spine', 0.105, 0], ['spine', 'hips', 'spine', 'chest', 0.11, 0], ['chest', 'spine', 'chest', 'neck', 0.12, 0],
  ['neck', 'chest', 'neck', 'head', 0.045, 0], ['head', 'neck', 'head', 'top', 0.065, 0],
  ...[1, -1].flatMap((s) => {
    const k = s > 0 ? 'R' : 'L';
    return [
      [`clav${k}`, 'chest', 'clav', 'shoulder', 0.05, s], [`upper${k}`, `clav${k}`, 'shoulder', 'elbow', 0.04, s], [`fore${k}`, `upper${k}`, 'elbow', 'wrist', 0.034, s], [`hand${k}`, `fore${k}`, 'wrist', 'tip', 0.03, s],
      [`thigh${k}`, 'hips', 'hip', 'knee', 0.06, s], [`shin${k}`, `thigh${k}`, 'knee', 'ankle', 0.045, s], [`foot${k}`, `shin${k}`, 'ankle', 'toe', 0.04, s],
    ];
  }),
];
const jp = (name, s, out = new THREE.Vector3()) => { const j = J[name]; return out.set(j[0] * (s || 1), j[1], j[2]).multiplyScalar(HEIGHT); };

function distToSeg(p, a, b) {
  const ab = _w.subVectors(b, a), t = THREE.MathUtils.clamp(_v.subVectors(p, a).dot(ab) / ab.lengthSq(), 0, 1);
  return _v.copy(a).addScaledVector(ab, t).distanceTo(p);
}

/** Skinned, IK-driven Mobius for the mirror. Same API as the old createMobiusBody(). */
export function createMobiusModelBody(model) {
  const geo = model.geometry.clone();
  // refine joint depth (z) from the mesh: average z of vertices around each limb joint (static files only —
  // a rigged file already gives the real joint positions)
  const P = geo.attributes.position, n = P.count, p = new THREE.Vector3();
  if (!J._fromFile) for (const key of ['shoulder', 'elbow', 'wrist', 'tip', 'knee', 'ankle']) {
    let sz = 0, c = 0;
    for (let i = 0; i < n; i += 3) { p.fromBufferAttribute(P, i); const x = Math.abs(p.x) / HEIGHT, y = p.y / HEIGHT; if (Math.abs(y - J[key][1]) < 0.02 && Math.abs(x - J[key][0]) < 0.035) { sz += p.z / HEIGHT; c++; } }
    if (c > 10) J[key][2] = sz / c;
  }
  // skeleton
  const bones = {}, list = [];
  for (const [name, parent, from, , , s] of BONES) {
    const b = new THREE.Bone(); b.name = name;
    const pos = jp(from, s);
    if (parent) { const pb = BONES.find((x) => x[0] === parent); pos.sub(jp(pb[2], pb[5])); bones[parent].add(b); }
    b.position.copy(pos); bones[name] = b; list.push(b);
  }
  const segs = BONES.map(([name, parent, from, to, rad, s], i) => ({ i, name, parent, a: jp(from, s), b: jp(to, s), r: rad * HEIGHT, s }));
  // graph distance between bones (parent links); blending allowed up to 2 hops (e.g. chest–clavicle–upper
  // arm across the shoulder pad) so joints deform smoothly instead of tearing
  const idx = Object.fromEntries(segs.map((x) => [x.name, x]));
  const hops = (x, y) => { const up = (q) => { const r = []; let c = q; while (c) { r.push(c.name); c = c.parent ? idx[c.parent] : null; } return r; }; const ax = up(x), ay = up(y); for (let i = 0; i < ax.length; i++) { const j = ay.indexOf(ax[i]); if (j >= 0) return i + j; } return 99; };
  const H2 = segs.map((x) => segs.map((y) => hops(x, y)));
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const ds = new Float32Array(segs.length);
  if (model.joints && geo.attributes.skinIndex) { // rigged file: keep its weights, summed per bone of our set
    const jm = model.joints.map((j) => idx[mapMobiusJoint(j.name)]?.i ?? 0), SI = geo.attributes.skinIndex, SW = geo.attributes.skinWeight;
    const acc = new Float32Array(segs.length), order = [...segs.keys()];
    for (let i = 0; i < n; i++) {
      acc.fill(0); for (let c = 0; c < 4; c++) acc[jm[SI.getComponent(i, c)]] += SW.getComponent(i, c);
      order.sort((x, y) => acc[y] - acc[x]);
      let tot = 0; for (let c = 0; c < 4; c++) tot += acc[order[c]];
      for (let c = 0; c < 4; c++) { si[i * 4 + c] = order[c]; sw[i * 4 + c] = tot > 0 ? acc[order[c]] / tot : c === 0 ? 1 : 0; }
    }
  } else for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(P, i);
    let best = -1;
    for (const sg of segs) {
      if (sg.s && Math.sign(p.x) !== sg.s && Math.abs(p.x) > 0.02) { ds[sg.i] = 1e9; continue; } // limbs only take their own side
      ds[sg.i] = Math.max(0.004, distToSeg(p, sg.a, sg.b) - sg.r);
      if (best < 0 || ds[sg.i] < ds[best]) best = sg.i;
    }
    const cand = [];
    for (const sg of segs) if (H2[best][sg.i] <= 2 && ds[sg.i] < ds[best] * 2.5 + 0.015) cand.push(sg.i);
    cand.sort((x, y) => ds[x] - ds[y]); cand.length = Math.min(3, cand.length);
    let tot = 0; const w = cand.map((c) => { const v = 1 / (ds[c] + 0.01) ** 2; tot += v; return v; });
    cand.forEach((c, k) => { si[i * 4 + k] = c; sw[i * 4 + k] = w[k] / tot; });
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const mesh = new THREE.SkinnedMesh(geo, model.material);
  mesh.name = 'mobius-body'; mesh.frustumCulled = false;
  mesh.add(bones.hips);
  mesh.bind(new THREE.Skeleton(list));
  const root = new THREE.Group(); root.name = 'mobius-body-root'; root.add(mesh);

  // rest frames (bind pose = identity rotations): bone axis and a "back" reference (+Z)
  const restAxis = {};
  for (const sg of segs) restAxis[sg.name] = sg.b.clone().sub(sg.a).normalize();
  const basis = (axis, ref, out) => { // columns: x = ref×axis, y = axis, z = x×axis … built so y = bone axis
    const y = _v.copy(axis).normalize(), x = _w.crossVectors(y, ref); if (x.lengthSq() < 1e-8) x.set(1, 0, 0); x.normalize();
    const z = new THREE.Vector3().crossVectors(x, y);
    return out.makeBasis(x, y, z);
  };
  const restBack = new THREE.Vector3(0, 0, 1), mR = new THREE.Matrix4(), mT = new THREE.Matrix4(), qR = new THREE.Quaternion(), qT = new THREE.Quaternion();
  const worldQ = new THREE.Quaternion(), parentQ = new THREE.Quaternion();
  /** Rotate `bone` so its axis points along dirWorld (with `back` as twist reference). */
  const aimBone = (name, dirWorld, back) => {
    basis(restAxis[name], restBack, mR); qR.setFromRotationMatrix(mR);
    basis(dirWorld, back, mT); qT.setFromRotationMatrix(mT);
    setWorldQ(name, worldQ.copy(qT).multiply(qR.invert()));
  };
  const setWorldQ = (name, q) => {
    const b = bones[name]; b.parent.updateWorldMatrix(true, false); b.parent.getWorldQuaternion(parentQ);
    b.quaternion.copy(parentQ.invert()).multiply(q); b.updateMatrixWorld(true);
  };
  const worldPos = (name, out) => bones[name].getWorldPosition(out);
  const L = { upper: jp('shoulder', 1).distanceTo(jp('elbow', 1)), fore: jp('elbow', 1).distanceTo(jp('wrist', 1)), thigh: jp('hip', 1).distanceTo(jp('knee', 1)), shin: jp('knee', 1).distanceTo(jp('ankle', 1)) };
  const headOffset = new THREE.Vector3(0, -(0.935 - J.head[1]) * HEIGHT, 0.045); // headset (eyes) → head pivot
  const hipsFromHead = jp('head').sub(jp('hips'));
  const fingers = { 1: jp('tip', 1).sub(jp('wrist', 1)).normalize(), '-1': jp('tip', -1).sub(jp('wrist', -1)).normalize() };

  let bodyYaw = null;
  const yawQ = new THREE.Quaternion(), fwd = new THREE.Vector3(), back = new THREE.Vector3();
  const headPivot = new THREE.Vector3(), S = new THREE.Vector3(), T = new THREE.Vector3(), E = new THREE.Vector3(), Tc = new THREE.Vector3(), pole = new THREE.Vector3(), tmp = new THREE.Vector3();
  const tq = new THREE.Quaternion(), hm = new THREE.Matrix4(), rm = new THREE.Matrix4();

  function setPose({ head: h, left = null, right = null, floorY = 0 }) {
    // body yaw lags behind head yaw (±35°)
    fwd.set(0, 0, -1).applyQuaternion(h.quaternion);
    if (fwd.x * fwd.x + fwd.z * fwd.z > 1e-4) {
      const hy = Math.atan2(-fwd.x, -fwd.z);
      if (bodyYaw === null) bodyYaw = hy;
      let d = Math.atan2(Math.sin(hy - bodyYaw), Math.cos(hy - bodyYaw));
      if (d > 0.6) { bodyYaw = hy - 0.6; d = 0.6; } else if (d < -0.6) { bodyYaw = hy + 0.6; d = -0.6; }
      bodyYaw += d * 0.08;
    }
    if (bodyYaw === null) bodyYaw = 0;
    yawQ.setFromAxisAngle(_Y, bodyYaw); back.set(0, 0, 1).applyQuaternion(yawQ);
    // torso: hang from the head pivot, stay upright, never sink the hips through the floor
    headPivot.copy(h.position).add(tmp.copy(headOffset).applyQuaternion(yawQ));
    const hips = bones.hips;
    hips.position.copy(headPivot).sub(tmp.copy(hipsFromHead).applyQuaternion(yawQ));
    hips.position.y = Math.max(hips.position.y, floorY + 0.55);
    hips.quaternion.copy(yawQ); hips.updateMatrixWorld(true);
    for (const nme of ['spine', 'chest', 'neck']) { bones[nme].quaternion.identity(); bones[nme].updateMatrixWorld(true); }
    setWorldQ('head', h.quaternion);
    for (const s of [1, -1]) {
      const k = s > 0 ? 'R' : 'L', tgt = s > 0 ? right : left;
      bones[`clav${k}`].quaternion.identity(); bones[`clav${k}`].updateMatrixWorld(true);
      if (tgt) T.copy(tgt.position);
      else T.copy(jp('wrist', s)).sub(jp('hips')).applyQuaternion(yawQ).add(hips.position); // relaxed A-pose
      // shoulder follows the arm a little (shrug) so the shoulder pad bends instead of tearing
      worldPos(`upper${k}`, S);
      {
        const restDir = restAxis[`upper${k}`].clone().applyQuaternion(yawQ), want = tmp.subVectors(T, S).normalize();
        const full = new THREE.Quaternion().setFromUnitVectors(restDir, want);
        setWorldQ(`clav${k}`, worldQ.identity().slerp(full, 0.3).multiply(yawQ));
      }
      worldPos(`upper${k}`, S);
      pole.copy(S).add(tmp.set(s * 0.35, -0.4, 0.35).applyQuaternion(yawQ));
      solveTwoBone(S, T, L.upper, L.fore, pole, E, Tc);
      aimBone(`upper${k}`, tmp.subVectors(E, S), back);
      aimBone(`fore${k}`, tmp.subVectors(Tc, E), back);
      // hand: WebXR wrist frame (−Z toward the fingers, +Y = back of the hand) ← model rest frame
      if (tgt) {
        const restBackHand = _w.set(s, 0, 0); // A-pose: palms face the body, back of hand outward
        const fr = fingers[s];
        const xR = new THREE.Vector3().crossVectors(restBackHand, tmp.copy(fr).negate()).normalize();
        rm.makeBasis(xR, new THREE.Vector3().crossVectors(tmp.copy(fr).negate(), xR), tmp.copy(fr).negate());
        hm.makeRotationFromQuaternion(tgt.quaternion);
        tq.setFromRotationMatrix(hm.multiply(rm.invert()));
        setWorldQ(`hand${k}`, tq);
      } else setWorldQ(`hand${k}`, worldQ.copy(yawQ));
      // legs: ankles on the floor, knees bend forward
      worldPos(`thigh${k}`, S);
      T.set(S.x, floorY + J.ankle[1] * HEIGHT, S.z).add(tmp.set(s * 0.012, 0, 0).applyQuaternion(yawQ));
      pole.copy(S).add(tmp.set(s * 0.05, -0.3, -0.6).applyQuaternion(yawQ));
      solveTwoBone(S, T, L.thigh, L.shin, pole, E, Tc);
      aimBone(`thigh${k}`, tmp.subVectors(E, S), back);
      aimBone(`shin${k}`, tmp.subVectors(Tc, E), back);
      setWorldQ(`foot${k}`, worldQ.copy(yawQ));
    }
  }
  setPose({ head: { position: new THREE.Vector3(0, 1.68, 0), quaternion: new THREE.Quaternion() }, floorY: 0 });
  return {
    root, mesh, bones, setPose,
    setVisible(v) { root.visible = !!v; },
    setHeadVisible() {},
  };
}

function solveTwoBone(S, T, a, b, pole, outE, outT) {
  const d = new THREE.Vector3().subVectors(T, S);
  let dist = d.length();
  if (dist < 1e-5) { d.set(0, -1, 0); dist = 1e-5; } else d.divideScalar(dist);
  dist = THREE.MathUtils.clamp(dist, Math.abs(a - b) + 1e-3, a + b - 1e-4);
  outT.copy(S).addScaledVector(d, dist);
  const cosA = THREE.MathUtils.clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const bend = new THREE.Vector3().subVectors(pole, S); bend.addScaledVector(d, -bend.dot(d));
  if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1); else bend.normalize();
  outE.copy(S).addScaledVector(d, a * cosA).addScaledVector(bend, a * sinA);
}
void _q; void _m;
