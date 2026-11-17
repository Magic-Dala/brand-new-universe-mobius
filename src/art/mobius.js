// Mobius (hero) models: first-person armored hands, full-body mirror avatar,
// and the static suit on the armor rack.
//
// Conventions (all of them follow WebXR):
//  * Hand joints: XRHand order (25 joints). In a joint's local frame -Z points
//    along the bone toward the fingertips and +Y points out of the back of the
//    hand (dorsal); the palm normal is -Y.
//  * Body: faces -Z (like the XR viewer), +Y up, metres. root stays identity;
//    every pose input is given in root's parent space.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  PALETTE, MAT, GEO, PartBuilder, outline, toon, lemniscateGeometry, frustum, smoothHullGeometry,
} from './materials.js';
import { canvasTexture } from './toon.js';

// ----------------------------------------------------------------- constants
export const HAND_JOINTS = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];

const FINGER_WIDTH = [0.023, 0.0195, 0.0200, 0.0185, 0.0165]; // thumb, index, middle, ring, pinky
const PHALANX_TAPER = [1.0, 0.92, 0.85];
// [jointA, jointB, fingerIdx, phalanxIdx]
const SEGMENTS = [];
SEGMENTS.push([1, 2, 0, 0], [2, 3, 0, 1], [3, 4, 0, 2]);
for (let f = 0; f < 4; f++) {
  const b = 5 + f * 5;
  SEGMENTS.push([b + 1, b + 2, f + 1, 0], [b + 2, b + 3, f + 1, 1], [b + 3, b + 4, f + 1, 2]);
}
// [joint, fingerIdx]
const KNUCKLES = [[2, 0], [3, 0]];
for (let f = 0; f < 4; f++) { const b = 5 + f * 5; KNUCKLES.push([b + 1, f + 1], [b + 2, f + 1], [b + 3, f + 1]); }

// Shared geometry
const RBOX = new RoundedBoxGeometry(1, 1, 1, 2, 0.22);
const CAPSULE_Z = (() => { // unit-length capsule along Z, radius 0.5 (overlaps joints a bit)
  const g = new THREE.CapsuleGeometry(0.5, 0.45, 3, 10, 1);
  g.rotateX(Math.PI / 2);
  return g;
})();
const KNUCKLE_GEO = new THREE.SphereGeometry(1, 10, 8);
const LED_GEO = new THREE.BoxGeometry(1, 1, 1);

// --------------------------------------------------------------- math temps
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _s1 = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);
const _AX = new THREE.Vector3(1, 0, 0);
const _AY = new THREE.Vector3(0, 1, 0);

function quatLookDir(dir, up, out) {
  const z = _v4.copy(dir).negate().normalize();
  const x = _v5.crossVectors(up, z);
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0); else x.normalize();
  const y = _v3.crossVectors(z, x);
  _m2.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_m2);
}

// ------------------------------------------------- procedural hand skeleton
const FINGER_DEF = [ // right hand; thumb side is -X
  { meta: [-0.011, 0.000, -0.026], prox: [-0.025, 0.002, -0.090], len: [0.040, 0.024, 0.021], splay: 0.10 },
  { meta: [0.000, 0.001, -0.027], prox: [-0.004, 0.004, -0.094], len: [0.044, 0.028, 0.023], splay: 0.0 },
  { meta: [0.010, 0.000, -0.026], prox: [0.016, 0.002, -0.089], len: [0.041, 0.026, 0.022], splay: -0.08 },
  { meta: [0.019, -0.002, -0.024], prox: [0.034, -0.003, -0.079], len: [0.032, 0.019, 0.019], splay: -0.18 },
];
const CURL_ANGLES = [1.45, 1.65, 1.0];

/**
 * Generates a hand pose in wrist-local space (WebXR conventions).
 * curls: [thumb, index, middle, ring, pinky] in 0..1.
 */
export function generateHandPose(handedness, curls, outPos, outQuat) {
  const s = handedness === 'left' ? -1 : 1;
  const setJ = (i, p, q) => {
    outPos[i * 3] = p.x; outPos[i * 3 + 1] = p.y; outPos[i * 3 + 2] = p.z;
    outQuat[i * 4] = q.x; outQuat[i * 4 + 1] = q.y; outQuat[i * 4 + 2] = q.z; outQuat[i * 4 + 3] = q.w;
  };
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), r = new THREE.Quaternion();
  const dir = new THREE.Vector3();
  setJ(0, p.set(0, 0, 0), q.identity());

  // thumb
  const ct = curls[0];
  p.set(-0.021 * s, -0.012, -0.020);
  dir.set(-0.62 * s, -0.22 - 0.25 * ct, -0.75).normalize();
  quatLookDir(dir, new THREE.Vector3(-0.75 * s, 0.66, 0).normalize(), q);
  q.multiply(r.setFromAxisAngle(_AY, -ct * 0.55 * s)); // opposition toward palm
  setJ(1, p, q);
  const tl = [0.044, 0.032, 0.027], ta = [0.25, 0.75, 0.85];
  for (let k = 0; k < 3; k++) {
    p.add(dir.set(0, 0, -tl[k]).applyQuaternion(q));
    if (k < 2) q.multiply(r.setFromAxisAngle(_AX, -(0.08 + ct * ta[k + 1])));
    setJ(2 + k, p, q);
  }

  // fingers
  for (let f = 0; f < 4; f++) {
    const d = FINGER_DEF[f], c = curls[f + 1];
    const base = 5 + f * 5;
    const m = new THREE.Vector3(d.meta[0] * s, d.meta[1], d.meta[2]);
    const pr = new THREE.Vector3(d.prox[0] * s, d.prox[1], d.prox[2]);
    quatLookDir(dir.subVectors(pr, m), _Y, q);
    setJ(base, m, q);
    p.copy(pr);
    q.multiply(r.setFromAxisAngle(_AY, d.splay * s * (1 - c * 0.7)));
    for (let k = 0; k < 3; k++) {
      q.multiply(r.setFromAxisAngle(_AX, -(0.06 + c * CURL_ANGLES[k])));
      setJ(base + 1 + k, p, q);
      p.add(dir.set(0, 0, -d.len[k]).applyQuaternion(q));
    }
    setJ(base + 4, p, q);
  }
}

// grip-space mapping (hand-local -> grip). Grip convention: origin at the palm
// centre (inside the fist), -Z = finger direction when gripping, +Y up (thumb
// side up, handshake pose). Right palm faces -X, left palm faces +X.
export function gripFromHandMatrix(handedness) {
  const s = handedness === 'left' ? -1 : 1;
  const basis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, -s, 0), // hand +X (pinky side for right) -> down
    new THREE.Vector3(s, 0, 0), // hand +Y (back of hand) -> outward
    new THREE.Vector3(0, 0, 1), // hand +Z (toward forearm) -> back
  );
  const toPalm = new THREE.Matrix4().makeTranslation(0.004 * s, 0.024, 0.055);
  return basis.multiply(toPalm);
}

// --------------------------------------------------------- gauntlet / cuff
function buildGauntlet() {
  const b = new PartBuilder();
  const W = MAT.heroWhite, G = MAT.graphite, C = MAT.cyanLED;
  // white shell along +Z (toward elbow)
  b.add(frustum(0.043, 0.052, 0.15, 14), W, [0, 0.002, 0.115], [Math.PI / 2, 0, 0], [1, 1, 0.82], { outline: true });
  // dorsal armor plate
  b.add(RBOX, W, [0, 0.036, 0.11], [0.04, 0, 0], [0.06, 0.018, 0.14], { outline: true });
  // graphite cuff band + inner sleeve rim
  b.add(GEO.cyl, G, [0, 0, 0.032], [Math.PI / 2, 0, 0], [0.045, 0.03, 0.037]);
  b.add(GEO.cyl, G, [0, 0, 0.19], [Math.PI / 2, 0, 0], [0.051, 0.02, 0.043]);
  // glowing cyan wrist ring (web shooter)
  b.add(new THREE.TorusGeometry(0.047, 0.0055, 6, 28), C, [0, 0, 0.047], [0, 0, 0], [1, 0.83, 1]);
  // LED stripes on top of forearm
  b.add(GEO.box, C, [0, 0.0465, 0.11], [0.04, 0, 0], [0.008, 0.003, 0.11]);
  b.add(GEO.box, C, [0.03, 0.03, 0.12], [0, 0, -0.6], [0.004, 0.003, 0.09]);
  b.add(GEO.box, C, [-0.03, 0.03, 0.12], [0, 0, 0.6], [0.004, 0.003, 0.09]);
  // emitter pod on the inner wrist (palm side, -Y)
  b.add(GEO.cyl, G, [0, -0.04, 0.06], [0, 0, 0], [0.019, 0.016, 0.019]);
  b.add(new THREE.TorusGeometry(0.014, 0.0035, 6, 20), C, [0, -0.049, 0.06], [Math.PI / 2, 0, 0]);
  b.add(GEO.sphereLo, C, [0, -0.049, 0.06], [0, 0, 0], [0.006, 0.003, 0.006]);
  return b;
}
const GAUNTLET_BUILDER = buildGauntlet();
const GAUNTLET_GEOS = new Map([...GAUNTLET_BUILDER.lists.keys()].map((m) => [m, GAUNTLET_BUILDER.geometryFor(m)]));

const SLEEVE_GEO = (() => {
  const g = new THREE.CylinderGeometry(0.046, 0.05, 0.2, 12, 1, true);
  g.rotateX(Math.PI / 2); g.translate(0, 0, 0.13);
  return g;
})();
const RING_GEO = new THREE.TorusGeometry(0.011, 0.0028, 6, 20);

// v3 look (2026-10-26): the first-person glove copies the New Mobius model — white armour plates with dark joint gaps,
// a black palm, glossy navy-blue knuckle balls, small cyan accents at each finger joint, rivets on the back plate, and
// a short black wrist cuff with the glowing blue star disc on its outer (pinky) side.
const HAND_LOOK = {
  white: 0xf2f5f8, palm: 0x16191f, joint: 0x15171c, knuckle: 0x3f8cf0, rivet: 0x1c1f25,
  segLen: 0.86, // white plate length / phalanx (the rest shows the dark joint)
};
const HAND_KN_MAT = toon(0xffffff); // instance-coloured: navy knuckle balls, black joints (cel-shaded like the glove)
const DISC_GEO = new THREE.CylinderGeometry(0.0165, 0.0165, 0.004, 28).rotateX(Math.PI / 2); // face +Z
const DISC_RIM_GEO = new THREE.TorusGeometry(0.0172, 0.0028, 6, 28);
let _discMat = null;
const discMaterial = () => _discMat ??= new THREE.MeshBasicMaterial({ toneMapped: false, map: canvasTexture(128, 128, (g, w, h) => {
  const c = w / 2; g.fillStyle = '#071a33'; g.fillRect(0, 0, w, h);
  const grd = g.createRadialGradient(c, c, 4, c, c, c); grd.addColorStop(0, '#9ff3ff'); grd.addColorStop(0.45, '#1fa8ff'); grd.addColorStop(1, '#0a3a7a');
  g.fillStyle = grd; g.beginPath(); g.arc(c, c, c - 3, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#d9fbff'; g.lineWidth = 3; g.beginPath(); // radial star
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2, r = k % 2 ? c * 0.45 : c * 0.82; g.moveTo(c, c); g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); }
  g.stroke(); g.strokeStyle = '#7fe6ff'; g.lineWidth = 2; g.beginPath(); g.arc(c, c, c * 0.62, 0, Math.PI * 2); g.stroke();
}) });

// ================================================================ HANDS
/**
 * createArmoredHand(handedness) – first-person hand.
 * See module header for conventions. root must stay identity; joint data and
 * controller matrices are in root's parent space.
 */
export function createArmoredHand(handedness = 'right') {
  const s = handedness === 'left' ? -1 : 1;
  const root = new THREE.Group();
  root.name = `mobius-hand-${handedness}`;

  const NSEG = SEGMENTS.length + 2; // + palm + dorsal plate
  const segMesh = new THREE.InstancedMesh(RBOX, MAT.heroWhite, NSEG);
  segMesh.frustumCulled = false;
  segMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const segOutline = outline(segMesh, 0.0016);
  const NKN = KNUCKLES.length + 1 + 4; // joints + wrist cuff + 4 rivets
  const knMesh = new THREE.InstancedMesh(KNUCKLE_GEO, HAND_KN_MAT, NKN);
  knMesh.frustumCulled = false;
  knMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const NLED = SEGMENTS.length + 3;
  const ledMesh = new THREE.InstancedMesh(LED_GEO, MAT.cyanLED, NLED);
  ledMesh.frustumCulled = false;
  ledMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(segMesh, knMesh, ledMesh);

  const ring = new THREE.Mesh(RING_GEO, MAT.cyanLED); // (pre-v3 ring on the back of the hand: not used by the v3 look)
  ring.frustumCulled = false; ring.visible = false;
  root.add(ring);
  // v3: wrist star disc (outer side) + dark rim
  const disc = new THREE.Group(); disc.name = 'wrist-disc';
  { const d = new THREE.Mesh(DISC_GEO, discMaterial()), r = new THREE.Mesh(DISC_RIM_GEO, MAT.graphite); d.frustumCulled = r.frustumCulled = false; disc.add(d, r); }
  root.add(disc);
  // instance colours (white plates / black palm; navy MCP knuckles, black joints)
  const _c = new THREE.Color();
  const KN_COLORS = [...KNUCKLES.map(([j, f]) => (f > 0 && (j - 5) % 5 === 1 ? HAND_LOOK.knuckle : HAND_LOOK.joint)), HAND_LOOK.joint, ...Array(4).fill(HAND_LOOK.rivet)];
  function paint() {
    for (let i = 0; i < NSEG; i++) segMesh.setColorAt(i, _c.set(armored && i === SEGMENTS.length ? HAND_LOOK.palm : 0xffffff));
    for (let i = 0; i < NKN; i++) knMesh.setColorAt(i, _c.set(armored ? KN_COLORS[i] : 0xffffff));
    segMesh.instanceColor.needsUpdate = true; knMesh.instanceColor.needsUpdate = true;
  }

  const gauntlet = new THREE.Group();
  gauntlet.name = 'gauntlet';
  for (const [mat, g] of GAUNTLET_GEOS) { const m = new THREE.Mesh(g, mat); m.frustumCulled = false; gauntlet.add(m); }
  if (GAUNTLET_BUILDER.hull.length) {
    const h = new PartBuilder(); h.hull = GAUNTLET_BUILDER.hull; h.lists = new Map();
    const res = h.build(gauntlet, { outlineThickness: 0.0018, name: 'gauntlet' });
    if (res.outline) res.outline.frustumCulled = false;
  }
  const sleeve = new THREE.Mesh(SLEEVE_GEO, toon(PALETTE.fabric, { side: THREE.DoubleSide }));
  sleeve.visible = false;
  sleeve.frustumCulled = false;
  gauntlet.add(sleeve);
  root.add(gauntlet);
  // v0.2: forearm gauntlet / wrist web-shooter hidden — the forearm isn't tracked, so a
  // wrist-locked cuff looked glued to the hand. Glove only. (wristEmitter stays as an anchor.)
  gauntlet.visible = false;

  const wristEmitter = new THREE.Object3D();
  wristEmitter.name = 'wristEmitter';
  wristEmitter.position.set(0, -0.05, 0.06);
  gauntlet.add(wristEmitter);

  const palmButtonAnchor = new THREE.Object3D();
  palmButtonAnchor.name = 'palmButtonAnchor';
  root.add(palmButtonAnchor);

  let armored = true;
  paint();
  const pos = new Float32Array(75), quat = new Float32Array(100);
  const localPos = new Float32Array(75), localQuat = new Float32Array(100);
  const gripFromHand = gripFromHandMatrix(handedness);
  const curls = [0, 0, 0, 0, 0];

  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), mid = new THREE.Vector3();
  const q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const getP = (P, i, out) => out.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
  const getQ = (Q, i, out) => out.set(Q[i * 4], Q[i * 4 + 1], Q[i * 4 + 2], Q[i * 4 + 3]);

  function render(P, Q) {
    const wf = armored ? 1 : 0.86;
    let led = 0;
    for (let k = 0; k < SEGMENTS.length; k++) {
      const [a, b, f, ph] = SEGMENTS[k];
      getP(P, a, pa); getP(P, b, pb); getQ(Q, a, q);
      const len = pa.distanceTo(pb);
      mid.addVectors(pa, pb).multiplyScalar(0.5);
      const w = FINGER_WIDTH[f] * PHALANX_TAPER[ph] * wf;
      const h = w * 0.86;
      const l = armored ? len * HAND_LOOK.segLen : len * 0.8;
      segMesh.setMatrixAt(k, m4.compose(mid, q, sc.set(w, h, l)));
      if (armored) { // small cyan accent across the top, at the base of the plate (like the model's joint lights)
        up.set(0, 1, 0).applyQuaternion(q);
        const lp = _v1.copy(pa).lerp(pb, 0.16).addScaledVector(up, h * 0.5 + 0.0004);
        ledMesh.setMatrixAt(led++, m4.compose(lp, q, sc.set(w * 0.62, 0.0022, len * 0.09)));
      }
    }
    // palm plate: oriented by middle metacarpal
    const wrist = getP(P, 0, _v2);
    const knA = getP(P, 6, pa), knB = getP(P, 21, pb);
    const knMid = _v3.addVectors(knA, knB).multiplyScalar(0.5);
    const palmW = knA.distanceTo(knB) + 0.022 * wf;
    const palmL = wrist.distanceTo(knMid);
    getQ(Q, 10, q);
    mid.addVectors(wrist, knMid).multiplyScalar(0.5);
    up.set(0, 1, 0).applyQuaternion(q);
    const palmT = 0.03 * wf;
    segMesh.setMatrixAt(SEGMENTS.length, m4.compose(mid, q, sc.set(palmW, palmT, palmL * 1.02)));
    // raised dorsal plate
    const dorsal = _v1.copy(mid).addScaledVector(up, palmT * 0.45);
    _v4.set(0, 0, 1).applyQuaternion(q);
    dorsal.addScaledVector(_v4, armored ? 0.009 : 0.004); // (v3: plate ends before the knuckle balls)
    segMesh.setMatrixAt(SEGMENTS.length + 1, m4.compose(dorsal, q,
      armored ? sc.set(palmW * 0.94, palmT * 0.55, palmL * 0.8) : sc.set(1e-5, 1e-5, 1e-5)));
    segMesh.count = SEGMENTS.length + 2;
    segMesh.instanceMatrix.needsUpdate = true;

    // palm anchor: palm centre, 1.5 cm out of the palm, +Z = palm normal
    palmButtonAnchor.position.copy(mid).addScaledVector(up, -(palmT * 0.5 + 0.015));
    palmButtonAnchor.quaternion.copy(q).multiply(_q1.setFromAxisAngle(_AX, Math.PI / 2));

    // v3: rivets on the back plate (row near the knuckles) — placed with the knuckles below
    const top = _v1.copy(mid).addScaledVector(up, palmT * 0.75 + 0.0005), side = _v5.set(1, 0, 0).applyQuaternion(q);
    const rivets = [-0.3, -0.1, 0.1, 0.3].map((f) => new THREE.Vector3().copy(top).addScaledVector(side, palmW * f).addScaledVector(_v4, -palmL * 0.16));
    const plateQ = q.clone();
    ledMesh.count = led;
    ledMesh.instanceMatrix.needsUpdate = true;

    // knuckles
    let kn = 0;
    for (const [j, f] of KNUCKLES) {
      getP(P, j, pa); getQ(Q, j, q);
      const mcp = armored && f > 0 && (j - 5) % 5 === 1; // v3: big glossy navy balls on the knuckle row, slim black joints elsewhere
      const r = FINGER_WIDTH[f] * (mcp ? 0.82 : armored ? 0.5 : 0.56) * wf;
      if (mcp) pa.addScaledVector(_v3.set(0, 1, 0).applyQuaternion(q), r * 0.45); // sits proud of the back plate (like the model)
      knMesh.setMatrixAt(kn++, m4.compose(pa, q, sc.set(r, r * 0.9, r)));
    }
    getP(P, 0, pa); getQ(Q, 0, q);
    // wrist: black cuff band (v3: wider, short) …
    _v4.set(0, 0, 1).applyQuaternion(q);
    knMesh.setMatrixAt(kn++, m4.compose(_v3.copy(pa).addScaledVector(_v4, 0.014), q, armored ? sc.set(0.031, 0.024, 0.02) : sc.set(0.03 * wf, 0.022 * wf, 0.026 * wf)));
    for (const r of rivets) knMesh.setMatrixAt(kn++, m4.compose(r, plateQ, armored ? sc.set(0.0022, 0.0012, 0.0022) : sc.set(1e-5, 1e-5, 1e-5)));
    knMesh.count = kn;
    knMesh.instanceMatrix.needsUpdate = true;
    // … with the glowing star disc on its outer (pinky) side
    disc.visible = armored;
    if (armored) {
      const n = _v5.set(s * 0.85, 0.55, 0).normalize().applyQuaternion(q);
      disc.position.copy(pa).addScaledVector(_v4, 0.016).addScaledVector(n, 0.027);
      disc.quaternion.setFromUnitVectors(_v2.set(0, 0, 1), n);
    }

    // gauntlet follows the wrist
    getQ(Q, 0, gauntlet.quaternion);
    gauntlet.position.copy(getP(P, 0, pa));
  }

  function setArmored(v) {
    armored = !!v;
    segMesh.material = armored ? MAT.heroWhite : MAT.skin;
    segMesh.geometry = armored ? RBOX : CAPSULE_Z;
    segOutline.geometry = armored ? HULL_RBOX : HULL_CAPSULE;
    knMesh.material = armored ? MAT.graphite : MAT.skin;
    ledMesh.visible = armored;
    paint();
    for (const c of gauntlet.children) if (c !== sleeve && c.isMesh) c.visible = armored;
    sleeve.visible = !armored;
  }

  function setJoints(positions, quaternions) {
    render(positions, quaternions);
  }

  function setControllerPose(matrix, gripValue = 0, triggerValue = 0) {
    const g = THREE.MathUtils.clamp(gripValue, 0, 1);
    const t = THREE.MathUtils.clamp(triggerValue, 0, 1);
    curls[0] = 0.25 + g * 0.55;
    curls[1] = 0.12 + t * 0.78;
    curls[2] = curls[3] = 0.15 + g * 0.8;
    curls[4] = 0.2 + g * 0.78;
    generateHandPose(handedness, curls, localPos, localQuat);
    m4.multiplyMatrices(matrix, gripFromHand);
    m4.decompose(_v1, _q2, _s1);
    for (let i = 0; i < 25; i++) {
      getP(localPos, i, pa).applyMatrix4(m4);
      pos[i * 3] = pa.x; pos[i * 3 + 1] = pa.y; pos[i * 3 + 2] = pa.z;
      getQ(localQuat, i, q).premultiply(_q2);
      quat[i * 4] = q.x; quat[i * 4 + 1] = q.y; quat[i * 4 + 2] = q.z; quat[i * 4 + 3] = q.w;
    }
    render(pos, quat);
  }

  // initial pose so it never renders garbage
  generateHandPose(handedness, [0.2, 0.15, 0.15, 0.15, 0.2], pos, quat);
  render(pos, quat);

  return {
    root,
    handedness,
    setJoints,
    setControllerPose,
    setArmored,
    setVisible(v) { root.visible = !!v; },
    wristEmitter,
    palmButtonAnchor,
    get armored() { return armored; },
  };
}

const HULL_RBOX = smoothHullGeometry(RBOX);
const HULL_CAPSULE = smoothHullGeometry(CAPSULE_Z);

// ================================================================ BODY
const UPPER_ARM = 0.29, FOREARM = 0.27, THIGH = 0.46, SHIN = 0.44, ANKLE_H = 0.085;

function addSeg(b, geom, mat, a, c, w, d, opts) {
  // unit Y-aligned geometry stretched from a to c
  const dir = _v1.subVectors(c, a);
  const len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(_Y, dir.normalize());
  const mid = new THREE.Vector3().addVectors(a, c).multiplyScalar(0.5);
  b.add(geom, mat, [mid.x, mid.y, mid.z], q, [w, len, d], opts);
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const O = { outline: true };

function buildHead() {
  const b = new PartBuilder();
  const W = MAT.heroWhite, G = MAT.graphite, C = MAT.cyanLED;
  b.add(GEO.sphere, W, [0, 0.035, 0.055], [0, 0, 0], [0.104, 0.13, 0.124], O);
  b.add(GEO.sphere, G, [0, 0.005, 0.0], [0, 0, 0], [0.093, 0.05, 0.088]);
  b.add(GEO.sphere, W, [0, -0.04, -0.008], [0.15, 0, 0], [0.07, 0.07, 0.08], O);
  b.add(GEO.cone, W, [0, -0.085, -0.055], [Math.PI - 0.5, 0, 0], [0.03, 0.06, 0.022], O);
  const arc = 1.35;
  b.add(new THREE.TorusGeometry(0.106, 0.0085, 6, 32, arc), C, [0, 0.008, 0.02],
    [-Math.PI / 2, 0, Math.PI / 2 - arc / 2], [1, 1, 1.25]);
  for (const s of [-1, 1]) {
    b.add(GEO.cyl, W, [s * 0.1, 0.0, 0.07], [0, 0, Math.PI / 2], [0.036, 0.034, 0.036], O);
    b.add(new THREE.TorusGeometry(0.022, 0.005, 6, 20), C, [s * 0.118, 0.0, 0.07], [0, Math.PI / 2, 0]);
    b.add(GEO.cyl, G, [s * 0.119, 0.0, 0.07], [0, 0, Math.PI / 2], [0.012, 0.004, 0.012]);
  }
  b.add(RBOX, G, [0, 0.155, 0.07], [0.2, 0, 0], [0.028, 0.03, 0.2]);
  b.add(GEO.box, C, [0, 0.171, 0.075], [0.2, 0, 0], [0.008, 0.004, 0.17]);
  b.add(GEO.cyl, G, [0, -0.115, 0.06], [0, 0, 0], [0.05, 0.12, 0.05]);
  return b;
}

function buildTorso() {
  const b = new PartBuilder();
  const W = MAT.heroWhite, G = MAT.graphite, C = MAT.cyanLED;
  b.add(GEO.cyl, G, [0, -0.01, 0.01], [0, 0, 0], [0.075, 0.06, 0.07]);
  b.add(GEO.sphere, W, [0, -0.145, -0.005], [0, 0, 0], [0.205, 0.15, 0.125], O); // chest
  b.add(GEO.sphere, W, [0, -0.06, 0.0], [0, 0, 0], [0.16, 0.06, 0.1], O); // trapezius
  for (const s of [-1, 1]) {
    b.add(GEO.sphere, W, [s * 0.1, -0.2, 0.05], [0, 0, s * 0.15], [0.1, 0.13, 0.08], O); // lats
    addSeg(b, GEO.box, C, V(s * 0.125, -0.22, -0.088), V(s * 0.05, -0.43, -0.084), 0.009, 0.006);
    addSeg(b, GEO.box, C, V(s * 0.17, -0.1, -0.06), V(s * 0.15, -0.24, -0.04), 0.007, 0.006);
    addSeg(b, GEO.box, C, V(s * 0.04, -0.1, 0.123), V(s * 0.12, -0.32, 0.095), 0.008, 0.006);
  }
  b.add(GEO.sphere, G, [0, -0.33, 0.012], [0, 0, 0], [0.135, 0.17, 0.098]); // abdomen
  for (let i = 0; i < 3; i++) b.add(RBOX, G, [0, -0.27 - i * 0.055, -0.08 + i * 0.002], [0, 0, 0], [0.11 - i * 0.012, 0.042, 0.03]);
  b.add(GEO.sphere, W, [0, -0.49, 0.005], [0, 0, 0], [0.15, 0.045, 0.11], O); // belt
  b.add(GEO.box, C, [0, -0.215, 0.118], [0.0, 0, 0], [0.016, 0.3, 0.008]); // spine
  b.add(GEO.cyl, W, [0, -0.11, -0.112], [Math.PI / 2, 0, 0], [0.07, 0.02, 0.048]);
  b.add(lemniscateGeometry(0.066, 0.0065), C, [0, -0.11, -0.126], [0, 0, 0], [1, 1.25, 1]);
  return b;
}

function buildPelvis() {
  const b = new PartBuilder();
  const W = MAT.heroWhite, G = MAT.graphite, C = MAT.cyanLED;
  b.add(GEO.sphere, G, [0, 0, 0.005], [0, 0, 0], [0.155, 0.1, 0.105]);
  b.add(GEO.cone, W, [0, -0.045, -0.08], [Math.PI + 0.15, 0, 0], [0.085, 0.17, 0.035], O);
  for (const s of [-1, 1]) {
    b.add(GEO.sphere, W, [s * 0.07, -0.025, 0.065], [0, 0, 0], [0.08, 0.09, 0.06], O);
    b.add(GEO.sphere, W, [s * 0.135, 0.0, 0.0], [0, 0, 0], [0.04, 0.07, 0.07], O);
  }
  b.add(GEO.box, C, [0, 0.02, -0.105], [0, 0, 0], [0.12, 0.008, 0.006]);
  return b;
}

function buildUpperArm(s) {
  const b = new PartBuilder();
  const W = MAT.heroWhite, G = MAT.graphite, C = MAT.cyanLED;
  b.add(GEO.sphere, G, [0, 0, 0], [0, 0, 0], 0.055);
  b.add(GEO.sphere, W, [s * 0.03, 0.02, 0], [0, 0, -s * 0.25], [0.095, 0.075, 0.09], O);
  b.add(GEO.box, C, [s * 0.06, -0.02, -0.05], [0, 0, -s * 0.5], [0.006, 0.07, 0.006]);
  b.add(frustum(0.045, 0.038, 0.26), G, [0, -0.15, 0]);
  b.add(GEO.sphere, W, [s * 0.008, -0.16, -0.005], [0, 0, 0], [0.052, 0.1, 0.054], O);
  b.add(GEO.box, C, [s * 0.056, -0.16, 0], [0, 0, 0], [0.006, 0.13, 0.008]);
  return b;
}

function buildForearm(s) {
  const b = new PartBuilder();
  const W = MAT.heroWhite, G = MAT.graphite, C = MAT.cyanLED;
  b.add(GEO.sphere, G, [0, 0, 0], [0, 0, 0], 0.044);
  b.add(frustum(0.05, 0.04, 0.2, 12), W, [0, -0.125, 0], [0, 0, 0], [1, 1, 0.92], O);
  b.add(GEO.box, C, [s * 0.047, -0.12, 0], [0, 0, s * 0.04], [0.006, 0.15, 0.008]);
  b.add(new THREE.TorusGeometry(0.043, 0.006, 6, 24), C, [0, -0.235, 0], [Math.PI / 2, 0, 0]);
  b.add(GEO.cyl, G, [0, -0.255, 0], [0, 0, 0], [0.036, 0.04, 0.032]);
  return b;
}

function buildStaticHand(handedness) {
  const b = new PartBuilder();
  const P = new Float32Array(75), Q = new Float32Array(100);
  generateHandPose(handedness, [0.3, 0.3, 0.38, 0.45, 0.5], P, Q);
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), q = new THREE.Quaternion();
  for (const [a, c, f, ph] of SEGMENTS) {
    pa.fromArray(P, a * 3); pb.fromArray(P, c * 3); q.fromArray(Q, a * 4);
    const mid = pa.clone().add(pb).multiplyScalar(0.5);
    const w = FINGER_WIDTH[f] * PHALANX_TAPER[ph];
    b.add(RBOX, MAT.heroWhite, [mid.x, mid.y, mid.z], q.clone(), [w, w * 0.86, pa.distanceTo(pb) * 0.94]);
  }
  for (const [j, f] of KNUCKLES) {
    pa.fromArray(P, j * 3);
    b.add(GEO.sphereLo, f > 0 && j % 5 === 2 ? MAT.cyanLED : MAT.graphite, [pa.x, pa.y, pa.z], [0, 0, 0], FINGER_WIDTH[f] * 0.56);
  }
  pa.fromArray(P, 6 * 3); pb.fromArray(P, 21 * 3);
  const kn = pa.clone().add(pb).multiplyScalar(0.5);
  q.fromArray(Q, 10 * 4);
  const mid = kn.clone().multiplyScalar(0.5);
  b.add(RBOX, MAT.heroWhite, [mid.x, mid.y, mid.z], q.clone(), [pa.distanceTo(pb) + 0.022, 0.03, kn.length()], O);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const r = mid.clone().addScaledVector(up, 0.016);
  b.add(RING_GEO, MAT.cyanLED, [r.x, r.y, r.z], q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(_AX, Math.PI / 2)));
  return b;
}

function buildThigh(s) {
  const b = new PartBuilder();
  const W = MAT.heroWhite, G = MAT.graphite, C = MAT.cyanLED;
  b.add(frustum(0.078, 0.055, 0.44), G, [0, -0.22, 0.005]);
  b.add(GEO.sphere, W, [s * 0.008, -0.2, -0.03], [0, 0, 0], [0.075, 0.2, 0.062], O);
  b.add(GEO.sphere, W, [s * 0.05, -0.16, 0.0], [0, 0, 0], [0.04, 0.15, 0.06], O);
  b.add(GEO.box, C, [s * 0.065, -0.22, -0.035], [0, 0, -s * 0.05], [0.007, 0.25, 0.007]);
  return b;
}

function buildShin(s) {
  const b = new PartBuilder();
  const W = MAT.heroWhite, G = MAT.graphite, C = MAT.cyanLED;
  b.add(GEO.sphere, W, [0, 0, -0.035], [0, 0, 0], [0.055, 0.06, 0.045], O);
  b.add(new THREE.TorusGeometry(0.026, 0.0055, 6, 20), C, [s * 0.062, 0, 0], [0, Math.PI / 2, 0]);
  b.add(GEO.cyl, G, [s * 0.058, 0, 0], [0, 0, Math.PI / 2], [0.03, 0.015, 0.03]);
  b.add(frustum(0.056, 0.04, 0.4), G, [0, -0.21, 0.012]);
  b.add(GEO.sphere, W, [0, -0.21, -0.012], [0, 0, 0], [0.06, 0.19, 0.062], O);
  b.add(GEO.box, C, [s * 0.025, -0.22, -0.07], [0, 0, 0], [0.007, 0.22, 0.006]);
  return b;
}

function buildFoot(s) {
  const b = new PartBuilder();
  const W = MAT.heroWhite, G = MAT.graphite, C = MAT.cyanLED;
  b.add(GEO.sphere, G, [0, 0, 0], [0, 0, 0], 0.045);
  b.add(RBOX, W, [0, -0.035, -0.055], [0, 0, 0], [0.1, 0.085, 0.25], O);
  b.add(RBOX, W, [0, 0.02, -0.0], [0, 0, 0], [0.09, 0.07, 0.11], O);
  b.add(RBOX, G, [0, -0.076, -0.058], [0, 0, 0], [0.106, 0.02, 0.262]);
  b.add(new THREE.TorusGeometry(0.048, 0.005, 6, 24), C, [0, 0.03, 0], [Math.PI / 2, 0, 0]);
  b.add(GEO.box, C, [s * 0.051, -0.04, -0.07], [0, 0, 0], [0.004, 0.006, 0.12]);
  return b;
}

// geometry is built once per module, meshes created per body
let BODY_PARTS = null;
function bodyParts() {
  if (BODY_PARTS) return BODY_PARTS;
  BODY_PARTS = {
    head: buildHead(), torso: buildTorso(), pelvis: buildPelvis(),
    upperArm: { 1: buildUpperArm(1), [-1]: buildUpperArm(-1) },
    forearm: { 1: buildForearm(1), [-1]: buildForearm(-1) },
    hand: { 1: buildStaticHand('right'), [-1]: buildStaticHand('left') },
    thigh: { 1: buildThigh(1), [-1]: buildThigh(-1) },
    shin: { 1: buildShin(1), [-1]: buildShin(-1) },
    foot: { 1: buildFoot(1), [-1]: buildFoot(-1) },
  };
  // merge once, then each body instance just creates Meshes sharing these.
  for (const k of Object.keys(BODY_PARTS)) {
    const v = BODY_PARTS[k];
    if (v instanceof PartBuilder) BODY_PARTS[k] = bake(v);
    else for (const s of [1, -1]) v[s] = bake(v[s]);
  }
  return BODY_PARTS;
}
function bake(builder) {
  const tmp = new THREE.Group();
  const res = builder.build(tmp, { outlineThickness: 0.0045 });
  return { meshes: [...res.meshes.values(), ...(res.outline ? [res.outline] : [])] };
}
function instantiate(baked, name) {
  const g = new THREE.Group();
  g.name = name;
  for (const m of baked.meshes) { const c = new THREE.Mesh(m.geometry, m.material); c.name = m.name; g.add(c); }
  return g;
}

function setBoneBetween(obj, from, to, backHint) {
  const y = _v1.subVectors(from, to);
  if (y.lengthSq() < 1e-10) return;
  y.normalize();
  const x = _v2.crossVectors(y, backHint);
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0); else x.normalize();
  const z = _v3.crossVectors(x, y);
  _m1.makeBasis(x, y, z);
  obj.quaternion.setFromRotationMatrix(_m1);
  obj.position.copy(from);
}

function solveTwoBone(S, T, a, b, pole, outE, outT) {
  const d = _v1.subVectors(T, S);
  let dist = d.length();
  if (dist < 1e-5) { d.set(0, -1, 0); dist = 1e-5; } else d.divideScalar(dist);
  dist = THREE.MathUtils.clamp(dist, Math.abs(a - b) + 1e-3, a + b - 1e-4);
  outT.copy(S).addScaledVector(d, dist);
  const cosA = THREE.MathUtils.clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const bend = _v2.subVectors(pole, S);
  bend.addScaledVector(d, -bend.dot(d));
  if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1); else bend.normalize();
  outE.copy(S).addScaledVector(d, a * cosA).addScaledVector(bend, a * sinA);
}

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * createMobiusBody() – full-body armored avatar (~1.8 m) for the mirror.
 * setPose({head:{position,quaternion}, left, right, floorY}) – inputs in
 * root-parent space; hand targets are WRIST poses with WebXR wrist-joint
 * orientation (-Z toward fingers, +Y back of hand). null → relaxed arm.
 */
export function createMobiusBody() {
  const P = bodyParts();
  const root = new THREE.Group();
  root.name = 'mobius-body';
  const head = instantiate(P.head, 'head');
  const torso = instantiate(P.torso, 'torso');
  const pelvis = instantiate(P.pelvis, 'pelvis');
  root.add(head, torso, pelvis);
  const limbs = {};
  for (const s of [1, -1]) {
    const L = {
      upper: instantiate(P.upperArm[s], 'upperArm'), fore: instantiate(P.forearm[s], 'forearm'),
      hand: instantiate(P.hand[s], 'hand'), thigh: instantiate(P.thigh[s], 'thigh'),
      shin: instantiate(P.shin[s], 'shin'), foot: instantiate(P.foot[s], 'foot'),
    };
    root.add(L.upper, L.fore, L.hand, L.thigh, L.shin, L.foot);
    limbs[s] = L;
  }
  const wristEmitters = { left: new THREE.Object3D(), right: new THREE.Object3D() };
  limbs[-1].fore.add(wristEmitters.left); wristEmitters.left.position.set(0, -0.235, 0);
  limbs[1].fore.add(wristEmitters.right); wristEmitters.right.position.set(0, -0.235, 0);

  let bodyYaw = null;
  const yawQ = new THREE.Quaternion();
  const fwd = new THREE.Vector3(), back = new THREE.Vector3();
  const neck = new THREE.Vector3(), hip = new THREE.Vector3();
  const S = new THREE.Vector3(), T = new THREE.Vector3(), E = new THREE.Vector3(), Tc = new THREE.Vector3();
  const pole = new THREE.Vector3(), tmp = new THREE.Vector3();
  const handQ = new THREE.Quaternion(), relaxM = new THREE.Matrix4();

  function setPose({ head: h, left = null, right = null, floorY = 0 }) {
    // body yaw lags behind head yaw, clamped to ±35°
    fwd.set(0, 0, -1).applyQuaternion(h.quaternion);
    if (fwd.x * fwd.x + fwd.z * fwd.z > 1e-4) {
      const hy = Math.atan2(-fwd.x, -fwd.z);
      if (bodyYaw === null) bodyYaw = hy;
      let d = wrapAngle(hy - bodyYaw);
      const lim = 0.6;
      if (d > lim) { bodyYaw = hy - lim; d = lim; } else if (d < -lim) { bodyYaw = hy + lim; d = -lim; }
      bodyYaw = wrapAngle(bodyYaw + d * 0.08);
    }
    if (bodyYaw === null) bodyYaw = 0;
    yawQ.setFromAxisAngle(_Y, bodyYaw);
    back.set(0, 0, 1).applyQuaternion(yawQ);

    head.position.copy(h.position);
    head.quaternion.copy(h.quaternion);
    neck.copy(h.position).add(tmp.set(0, -0.12, 0.075).applyQuaternion(yawQ));
    torso.position.copy(neck);
    torso.quaternion.copy(yawQ);
    hip.copy(neck).add(tmp.set(0, -0.535, 0.005).applyQuaternion(yawQ));
    // keep hips from sinking through the floor when crouching
    hip.y = Math.max(hip.y, floorY + 0.35);
    pelvis.position.copy(hip);
    pelvis.quaternion.copy(yawQ);

    for (const s of [1, -1]) {
      const L = limbs[s];
      const tgt = s === 1 ? right : left;
      S.copy(neck).add(tmp.set(s * 0.19, -0.075, 0.0).applyQuaternion(yawQ));
      if (tgt) {
        T.copy(tgt.position);
        handQ.copy(tgt.quaternion);
      } else {
        T.copy(S).add(tmp.set(s * 0.07, -0.55, 0.03).applyQuaternion(yawQ));
        relaxM.makeBasis(_v1.set(0, 0, s), _v2.set(s, 0, 0), _v3.set(0, 1, 0));
        handQ.setFromRotationMatrix(relaxM).premultiply(yawQ);
      }
      // elbow pole: down, back and outward
      pole.copy(S).add(tmp.set(s * 0.35, -0.4, 0.35).applyQuaternion(yawQ));
      solveTwoBone(S, T, UPPER_ARM, FOREARM, pole, E, Tc);
      setBoneBetween(L.upper, S, E, back);
      setBoneBetween(L.fore, E, Tc, back);
      L.hand.position.copy(Tc);
      L.hand.quaternion.copy(handQ);

      // legs
      S.copy(hip).add(tmp.set(s * 0.095, -0.055, 0).applyQuaternion(yawQ));
      T.set(S.x, floorY + ANKLE_H, S.z).add(tmp.set(s * 0.025, 0, 0.0).applyQuaternion(yawQ));
      pole.copy(S).add(tmp.set(s * 0.05, -0.3, -0.6).applyQuaternion(yawQ));
      solveTwoBone(S, T, THIGH, SHIN, pole, E, Tc);
      setBoneBetween(L.thigh, S, E, back);
      setBoneBetween(L.shin, E, Tc, back);
      L.foot.position.copy(Tc);
      L.foot.quaternion.copy(yawQ).multiply(_q1.setFromAxisAngle(_Y, -s * 0.12));
    }
  }

  setPose({ head: { position: new THREE.Vector3(0, 1.68, 0), quaternion: new THREE.Quaternion() }, floorY: 0 });

  return {
    root,
    setPose,
    setVisible(v) { root.visible = !!v; },
    /** Hide the helmet for the first-person viewer while the mirror shows it via layers. */
    setHeadVisible(v) { head.visible = !!v; },
    head,
    wristEmitters,
  };
}

/** createMobiusSuitDisplay() – static A-pose suit for the armor rack. Origin = floor centre, faces -Z. */
export function createMobiusSuitDisplay() {
  const body = createMobiusBody();
  const headPose = { position: new THREE.Vector3(0, 1.68, 0), quaternion: new THREE.Quaternion() };
  const mk = (s) => {
    const m = new THREE.Matrix4().makeBasis(V(0, 0, s), V(s, 0, 0), V(0, 1, 0));
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), s * 0.38));
    return { position: new THREE.Vector3(s * 0.43, 1.0, 0.02), quaternion: q };
  };
  for (let i = 0; i < 3; i++) body.setPose({ head: headPose, left: mk(-1), right: mk(1), floorY: 0 });
  body.root.name = 'mobius-suit-display';
  const display = { root: body.root, body };
  return display;
}

export function setSuitVisible(display, visible) {
  display.root.visible = !!visible;
}
