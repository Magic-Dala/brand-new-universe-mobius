// Mobius / 小莫 v3 (2026-10-26): the user's "New Mobius 3d model (smart_mesh) rigged" (Tripo, Mixamo-named
// skeleton with finger bones). The Tripo export was broken the same way as Green Maniac's (skeleton turned 90°, no
// rest pose on the nodes, ~65 % of the vertices 100 % on Hips), so public/models/mobius_rigged.glb is a rebuilt copy:
// same 53 joints (names, hierarchy, joint positions), rest frames turned into the standard Mixamo orientation, new
// bone-heat skin weights for the whole body INCLUDING every finger phalanx, texture 8192² → 2048² JPEG
// (tools/mobius/*.py; 3D_Models/Mobius/New Mobius 3d model (smart_mesh) rigged fixed.glb).
//
// One avatar drives everything Mobius in first person:
//   * the full body for the mirror (MIRROR_LAYER only): head = headset, torso hangs from the head and follows its
//     yaw (lagging), two-bone IK arms to the tracked wrists, wrists = XR wrist rotation, every finger bone aimed
//     along the tracked XR finger joints (hand tracking) or the synthetic controller hand (trigger / grip curls),
//     legs: ankles on the floor;
//   * the player's own hands in first person: the SAME skinned hands (left / right sub-meshes of the body — hand,
//     fingers and the wrist end of the forearm — bound to the same skeleton), so what you see on your hands and in
//     the mirror is one model. The hand bone sits exactly on the tracked wrist (the forearm stretches a little when
//     your real arm is longer than the model's) so the first-person hands always cover your real hands.
// v3b (same day): the first-person hands are the procedural armored glove again (mobius.js createArmoredHand, restyled
// after this model); the skinned first-person copies below are kept but switched off (setFirstPersonVisible(false)).
// Conventions as before (mobius.js): body faces −Z, +Y up, metres; pose inputs in world space; WebXR hand joints
// (25, XRHand order): −Z along the bone toward the tip, +Y = back of the hand.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { reflectionEnv } from './city.js';
import { generateHandPose, gripFromHandMatrix } from './mobius.js';

export const MOBIUS_RIG = {
  path: 'models/mobius_rigged.glb',
  height: 1.8, // m
  eyeToHead: [0, -0.085, 0.075], // headset (eyes) → head bone, in the body's yaw frame (+Z = backwards)
  fpForearm: 0.14, // m of forearm (from the wrist) kept in the first-person hands
  clavShrug: 0.3, // shoulder follows the arm a little (pad bends instead of tearing)
  yawLag: 0.6, yawFollow: 0.08, // torso yaw: max lag behind the head (rad) / follow rate per update
};

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0);
const FINGERS = [ // [Mixamo finger, XR joint indices for bones 1..3 (from, to)]
  ['Thumb', [[1, 2], [2, 3], [3, 4]]],
  ['Index', [[6, 7], [7, 8], [8, 9]]],
  ['Middle', [[11, 12], [12, 13], [13, 14]]],
  ['Ring', [[16, 17], [17, 18], [18, 19]]],
  ['Pinky', [[21, 22], [22, 23], [23, 24]]],
];

let _model = null;
/** Load the rigged GLB once (instances are cloned in createMobiusAvatar / createMobiusRigDisplay). */
export async function loadMobiusRig(path = MOBIUS_RIG.path) {
  if (_model) return _model;
  const base = (import.meta.env && import.meta.env.BASE_URL) || './';
  const href = new URL(path.startsWith('/') ? path : base + path, document.baseURI).href;
  const gltf = await new GLTFLoader().loadAsync(href);
  let mesh = null; gltf.scene.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
  if (!mesh) throw new Error(`${path}: no skinned mesh`);
  const mat = mesh.material;
  mat.envMap = reflectionEnv(); mat.envMapIntensity = 0.6; // something to reflect (no scene environment)
  mat.name = 'mobius-armor';
  gltf.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position);
  _model = { scene: gltf.scene, scale: MOBIUS_RIG.height / (box.max.y - box.min.y), minY: box.min.y, material: mat };
  return _model;
}

/** Cloned instance: feet on y = 0, hips over the origin; front = +Z (glTF), or −Z with faceNegZ. */
function instance(model, faceNegZ) {
  const inner = cloneSkinned(model.scene);
  inner.scale.setScalar(model.scale);
  if (faceNegZ) inner.rotation.y = Math.PI;
  inner.updateMatrixWorld(true);
  const hips = inner.getObjectByName('mixamorigHips'), hp = hips.getWorldPosition(new THREE.Vector3());
  inner.position.set(-hp.x, -model.minY * model.scale, -hp.z);
  inner.updateMatrixWorld(true);
  let mesh = null; inner.traverse((o) => { if (o.isSkinnedMesh) { mesh ??= o; o.frustumCulled = false; } });
  return { inner, mesh };
}

/** Static rest-pose (A-pose) suit for the armor rack. Origin = floor centre, front = local +Z. */
export function createMobiusRigDisplay(model) {
  const { inner, mesh } = instance(model, false);
  const root = new THREE.Group(); root.name = 'mobius-suit-display-root'; root.add(inner);
  return { root, mesh };
}

/** The first-person Mobius: mirror body + the player's own hands (one skeleton). */
export function createMobiusAvatar(model, cfg = MOBIUS_RIG) {
  const root = new THREE.Group(); root.name = 'mobius-avatar';
  const { inner, mesh } = instance(model, true);
  root.add(inner); mesh.name = 'mobius-body';
  root.updateMatrixWorld(true);
  const B = {}; inner.traverse((o) => { if (o.isBone) B[o.name.replace(/^mixamorig:?/, '')] = o; });
  const restQ = {}, restP = {}, restL = {};
  for (const [k, b] of Object.entries(B)) { restQ[k] = b.getWorldQuaternion(new THREE.Quaternion()); restP[k] = b.getWorldPosition(new THREE.Vector3()); restL[k] = b.quaternion.clone(); }
  const has = (k) => !!B[k];

  // ---- rest reference vectors (root space == world: root stays identity)
  const dir0 = (a, b) => restP[b].clone().sub(restP[a]).normalize();
  const back0 = new THREE.Vector3(0, 0, 1); // body faces −Z
  const armRef0 = back0.clone().addScaledVector(Y, 0.6).normalize();
  const H = {};
  for (const S of ['Left', 'Right']) {
    const f0 = dir0(`${S}Hand`, `${S}HandMiddle1`);
    const across = restP[`${S}HandIndex1`].clone().sub(restP[`${S}HandPinky1`]);
    const n = new THREE.Vector3().crossVectors(across, f0).normalize();
    const outward = Math.sign(restP[`${S}Hand`].x - restP.Hips.x) || (S === 'Left' ? -1 : 1);
    if (n.x * outward < 0) n.negate(); // back of the hand: outward in the A-pose (palms face the thighs)
    const b0 = n.clone().addScaledVector(f0, -n.dot(f0)).normalize();
    // the hand's rest frame written like a WebXR wrist (−Z = fingers, +Y = back of the hand)
    const z = f0.clone().negate(), x = new THREE.Vector3().crossVectors(b0, z).normalize();
    const restXR = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, b0, z));
    const fingers = {};
    for (const [F] of FINGERS) for (let k = 1; k <= 3; k++) {
      const nm = `${S}Hand${F}${k}`; if (!has(nm)) continue;
      const nx = `${S}Hand${F}${k + 1}`;
      fingers[nm] = has(nx) ? dir0(nm, nx) : dir0(`${S}Hand${F}${k - 1}`, nm);
    }
    H[S] = { f0, b0, restXR, fingers, foreRef0: armRef0.clone().add(b0).normalize() };
  }
  const len = (a, b) => restP[a].distanceTo(restP[b]);
  const L = {};
  for (const S of ['Left', 'Right']) L[S] = { upper: len(`${S}Arm`, `${S}ForeArm`), fore: len(`${S}ForeArm`, `${S}Hand`), thigh: len(`${S}UpLeg`, `${S}Leg`), shin: len(`${S}Leg`, `${S}Foot`) };
  const hipsFromHead = restP.Head.clone().sub(restP.Hips);
  const ankleH = restP.LeftFoot.y;

  // ---- first-person hands: sub-meshes of the body (same geometry attributes, own index), same skeleton
  const fp = {};
  {
    const geo = mesh.geometry, SI = geo.attributes.skinIndex, SW = geo.attributes.skinWeight, P = geo.attributes.position, bones = mesh.skeleton.bones;
    const n = P.count, sel = { Left: new Uint8Array(n), Right: new Uint8Array(n) };
    const bindPos = bones.map((b, i) => new THREE.Vector3().setFromMatrixPosition(_m.copy(mesh.skeleton.boneInverses[i]).invert()));
    const handI = { Left: bones.findIndex((b) => /LeftHand$/.test(b.name)), Right: bones.findIndex((b) => /RightHand$/.test(b.name)) };
    const reach = cfg.fpForearm / model.scale; // geometry units
    for (let i = 0; i < n; i++) {
      let bi = 0, bw = -1; for (let c = 0; c < 4; c++) { const w = SW.getComponent(i, c); if (w > bw) { bw = w; bi = SI.getComponent(i, c); } }
      const nm = bones[bi].name;
      for (const S of ['Left', 'Right']) {
        if (!nm.includes(S)) continue;
        if (nm.includes(`${S}Hand`)) sel[S][i] = 1;
        else if (nm.endsWith(`${S}ForeArm`) && _v.fromBufferAttribute(P, i).distanceTo(bindPos[handI[S]]) < reach) sel[S][i] = 1;
      }
    }
    const idx = geo.index.array;
    for (const S of ['Left', 'Right']) {
      const out = [];
      for (let t = 0; t < idx.length; t += 3) if (sel[S][idx[t]] && sel[S][idx[t + 1]] && sel[S][idx[t + 2]]) out.push(idx[t], idx[t + 1], idx[t + 2]);
      const g = new THREE.BufferGeometry();
      for (const [k, a] of Object.entries(geo.attributes)) g.setAttribute(k, a);
      g.setIndex(out);
      const m = new THREE.SkinnedMesh(g, mesh.material); m.name = `mobius-fp-hand-${S.toLowerCase()}`; m.frustumCulled = false;
      m.position.copy(mesh.position); m.quaternion.copy(mesh.quaternion); m.scale.copy(mesh.scale);
      mesh.parent.add(m); m.bind(mesh.skeleton, mesh.bindMatrix);
      m.visible = false; fp[S] = m;
    }
  }

  // ---- bone helpers (world == root space)
  const setWorldQ = (k, q) => { const b = B[k]; b.parent.getWorldQuaternion(_q2); b.quaternion.copy(_q2.invert()).multiply(q); b.updateMatrixWorld(true); };
  const wpos = (k, out) => B[k].getWorldPosition(out);
  const basisQ = (dir, ref, out) => {
    const y = _u.copy(dir).normalize(); const z = _w.copy(ref).addScaledVector(y, -ref.dot(y));
    if (z.lengthSq() < 1e-8) { z.set(0, 0, 1).addScaledVector(y, -y.z); if (z.lengthSq() < 1e-8) z.set(1, 0, 0); }
    z.normalize(); const x = _v.crossVectors(y, z);
    return out.setFromRotationMatrix(_m2.makeBasis(x, y, z));
  };
  const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), qW = new THREE.Quaternion();
  /** Rotate bone k so its rest direction d0 (rest twist ref r0) points along dir (twist ref ref). */
  const aim = (k, dir, ref, d0, r0) => {
    basisQ(dir, ref, qA); basisQ(d0, r0, qB);
    setWorldQ(k, qW.copy(qA).multiply(qB.invert()).multiply(restQ[k]));
  };

  // ---- inputs: per hand, 25 XR joints in the PLAYER (rig) space (hand tracking or the synthetic controller hand)
  const inp = {};
  const makeHand = (handedness) => {
    const S = handedness === 'left' ? 'Left' : 'Right';
    const st = inp[S] = { on: false, pos: new Float32Array(75), quat: new Float32Array(100), local: { p: new Float32Array(75), q: new Float32Array(100) }, curls: [0, 0, 0, 0, 0], grip: gripFromHandMatrix(handedness) };
    return {
      root: new THREE.Group(), handedness,
      setJoints(pos, quat) { st.pos.set(pos); st.quat.set(quat); st.on = true; },
      setControllerPose(matrix, gripValue = 0, triggerValue = 0) {
        const g = THREE.MathUtils.clamp(gripValue, 0, 1), t = THREE.MathUtils.clamp(triggerValue, 0, 1), c = st.curls;
        c[0] = 0.25 + g * 0.55; c[1] = 0.12 + t * 0.78; c[2] = c[3] = 0.15 + g * 0.8; c[4] = 0.2 + g * 0.78;
        generateHandPose(handedness, c, st.local.p, st.local.q);
        _m.multiplyMatrices(matrix, st.grip); _m.decompose(_v, _q, _w);
        for (let i = 0; i < 25; i++) {
          _w.set(st.local.p[i * 3], st.local.p[i * 3 + 1], st.local.p[i * 3 + 2]).applyMatrix4(_m);
          st.pos[i * 3] = _w.x; st.pos[i * 3 + 1] = _w.y; st.pos[i * 3 + 2] = _w.z;
          _q2.set(st.local.q[i * 4], st.local.q[i * 4 + 1], st.local.q[i * 4 + 2], st.local.q[i * 4 + 3]).premultiply(_q);
          st.quat[i * 4] = _q2.x; st.quat[i * 4 + 1] = _q2.y; st.quat[i * 4 + 2] = _q2.z; st.quat[i * 4 + 3] = _q2.w;
        }
        st.on = true;
      },
      setArmored(v) { armored = !!v; },
      setVisible(v) { if (!v) st.on = false; },
    };
  };
  let armored = true;
  const hands = { left: makeHand('left'), right: makeHand('right') };

  // ---- pose
  let bodyYaw = null;
  const yawQ = new THREE.Quaternion(), fwd = new THREE.Vector3(), back = new THREE.Vector3(), armRef = new THREE.Vector3();
  const headPivot = new THREE.Vector3(), Sx = new THREE.Vector3(), T = new THREE.Vector3(), E = new THREE.Vector3(), Tc = new THREE.Vector3(), pole = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const J = Array.from({ length: 25 }, () => new THREE.Vector3()), wristQ = new THREE.Quaternion(), handBack = new THREE.Vector3(), pq = new THREE.Quaternion();

  /**
   * head: { position, quaternion } (world); player: the XR rig (Object3D, joints are in its space); floorY.
   * Hands come from the per-hand inputs above (setJoints / setControllerPose, cleared by setVisible(false)).
   */
  function update({ head, player = null, floorY = 0 }) {
    fwd.set(0, 0, -1).applyQuaternion(head.quaternion);
    if (fwd.x * fwd.x + fwd.z * fwd.z > 1e-4) {
      const hy = Math.atan2(-fwd.x, -fwd.z);
      if (bodyYaw === null) bodyYaw = hy;
      let d = Math.atan2(Math.sin(hy - bodyYaw), Math.cos(hy - bodyYaw));
      if (d > cfg.yawLag) { bodyYaw = hy - cfg.yawLag; d = cfg.yawLag; } else if (d < -cfg.yawLag) { bodyYaw = hy + cfg.yawLag; d = -cfg.yawLag; }
      bodyYaw += d * cfg.yawFollow;
    }
    if (bodyYaw === null) bodyYaw = 0;
    yawQ.setFromAxisAngle(Y, bodyYaw); back.copy(back0).applyQuaternion(yawQ); armRef.copy(armRef0).applyQuaternion(yawQ);
    // torso hangs from the head; hips never below the floor
    headPivot.copy(head.position).add(tmp.fromArray(cfg.eyeToHead).applyQuaternion(yawQ));
    const hipsW = tmp2.copy(headPivot).sub(tmp.copy(hipsFromHead).applyQuaternion(yawQ));
    hipsW.y = Math.max(hipsW.y, floorY + restP.Hips.y * 0.6);
    B.Hips.parent.updateWorldMatrix(true, false);
    B.Hips.position.copy(B.Hips.parent.worldToLocal(hipsW));
    setWorldQ('Hips', qW.copy(yawQ).multiply(restQ.Hips));
    for (const k of ['Spine', 'Spine1', 'Spine2', 'Neck']) if (has(k)) { B[k].quaternion.copy(restL[k]); B[k].updateMatrixWorld(true); }
    setWorldQ('Head', qW.copy(head.quaternion).multiply(restQ.Head));
    const pm = player ? player.matrixWorld : null, pqW = player ? player.getWorldQuaternion(pq) : pq.identity();
    for (const S of ['Left', 'Right']) {
      const st = inp[S], h = H[S], side = S === 'Left' ? -1 : 1;
      // relaxed shoulder, then the IK target (tracked wrist, or the A-pose hand)
      if (has(`${S}Shoulder`)) { B[`${S}Shoulder`].quaternion.copy(restL[`${S}Shoulder`]); B[`${S}Shoulder`].updateMatrixWorld(true); }
      if (st.on) {
        for (let i = 0; i < 25; i++) { J[i].set(st.pos[i * 3], st.pos[i * 3 + 1], st.pos[i * 3 + 2]); if (pm) J[i].applyMatrix4(pm); }
        wristQ.set(st.quat[0], st.quat[1], st.quat[2], st.quat[3]).premultiply(pqW);
        T.copy(J[0]);
      } else T.copy(restP[`${S}Hand`]).sub(restP.Hips).applyQuaternion(yawQ).add(hipsW);
      if (has(`${S}Shoulder`)) { // shrug toward the target
        wpos(`${S}Arm`, Sx);
        const restDir = tmp.copy(dir0(`${S}Arm`, `${S}ForeArm`)).applyQuaternion(yawQ), want = E.subVectors(T, Sx).normalize();
        const full = _q.setFromUnitVectors(restDir, want);
        setWorldQ(`${S}Shoulder`, qW.identity().slerp(full, cfg.clavShrug).multiply(yawQ).multiply(restQ[`${S}Shoulder`]));
      }
      wpos(`${S}Arm`, Sx);
      pole.copy(Sx).add(tmp.set(side * 0.35, -0.4, 0.35).applyQuaternion(yawQ));
      solveTwoBone(Sx, T, L[S].upper, L[S].fore, pole, E, Tc);
      aim(`${S}Arm`, tmp.subVectors(E, Sx), armRef, dir0(`${S}Arm`, `${S}ForeArm`), armRef0);
      if (st.on) handBack.set(0, 1, 0).applyQuaternion(wristQ); else handBack.copy(h.b0).applyQuaternion(yawQ);
      aim(`${S}ForeArm`, tmp.subVectors(Tc, E), tmp2.copy(armRef).add(handBack).normalize(), dir0(`${S}ForeArm`, `${S}Hand`), h.foreRef0);
      // hand: exactly on the tracked wrist (first-person hands cover the real ones), rotation = XR wrist
      if (st.on) {
        const hb = B[`${S}Hand`]; hb.parent.updateWorldMatrix(true, false);
        hb.position.copy(hb.parent.worldToLocal(tmp.copy(T)));
        setWorldQ(`${S}Hand`, qW.copy(wristQ).multiply(_q.copy(h.restXR).invert()).multiply(restQ[`${S}Hand`]));
        // fingers: each phalanx along the tracked joints, twist from the back of the hand
        for (const [F, segs] of FINGERS) for (let k = 1; k <= 3; k++) {
          const nm = `${S}Hand${F}${k}`; if (!has(nm)) continue;
          const [a, b] = segs[k - 1];
          tmp.subVectors(J[b], J[a]); if (tmp.lengthSq() < 1e-10) continue;
          aim(nm, tmp, handBack, h.fingers[nm], h.b0);
        }
      } else {
        B[`${S}Hand`].position.copy(restLocalPos[`${S}Hand`]);
        setWorldQ(`${S}Hand`, qW.copy(yawQ).multiply(restQ[`${S}Hand`]));
        for (const [F] of FINGERS) for (let k = 1; k <= 3; k++) { const nm = `${S}Hand${F}${k}`; if (has(nm)) { B[nm].quaternion.copy(restL[nm]); B[nm].updateMatrixWorld(true); } }
      }
      // legs: ankles on the floor, knees bend forward
      const U = `${S}UpLeg`, K = `${S}Leg`, Ft = `${S}Foot`;
      wpos(U, Sx);
      T.set(Sx.x, floorY + ankleH, Sx.z).add(tmp.set(side * 0.012, 0, 0).applyQuaternion(yawQ));
      pole.copy(Sx).add(tmp.set(side * 0.05, -0.3, -0.6).applyQuaternion(yawQ));
      solveTwoBone(Sx, T, L[S].thigh, L[S].shin, pole, E, Tc);
      aim(U, tmp.subVectors(E, Sx), back, dir0(U, K), back0);
      aim(K, tmp.subVectors(Tc, E), back, dir0(K, Ft), back0);
      setWorldQ(Ft, qW.copy(yawQ).multiply(restQ[Ft]));
      // first-person hand visible: tracked / controller, and only once Mobius wears the suit
      fp[S].visible = st.on && armored && fpOn;
    }
  }
  const restLocalPos = {}; for (const [k, b] of Object.entries(B)) restLocalPos[k] = b.position.clone();
  let fpOn = true;
  update({ head: { position: new THREE.Vector3(0, 1.68, 0), quaternion: new THREE.Quaternion() } });

  return {
    root, mesh, bones: B, hands, update, fpHands: fp,
    /** The mirror body (mirror layer only); the first-person hands stay on the default layer. */
    setBodyLayer(layer) { mesh.layers.set(layer); },
    setVisible(v) { mesh.visible = !!v; }, // mirror body
    setFirstPersonVisible(v) { fpOn = !!v; if (!v) { fp.Left.visible = fp.Right.visible = false; } },
    hideFirstPersonForMirror(hide) { // the mirror camera also sees layer 0: hide the fp hands while it renders
      if (hide) { this._fpWas = [fp.Left.visible, fp.Right.visible]; fp.Left.visible = fp.Right.visible = false; } else if (this._fpWas) { [fp.Left.visible, fp.Right.visible] = this._fpWas; }
    },
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
