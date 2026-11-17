// Enemy + projectile models: Green Maniac, Green Bat Jet, pumpkin tech bomb,
// and the player's blue light bomb.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  PALETTE, MAT, GEO, PartBuilder, toon, glow, metal, additive, frustum, outlineMaterial,
} from './materials.js';
import { createGreenManiacAnimated, gmThrowRelease } from './greenManiacAnimated.js';

const RBOX = new RoundedBoxGeometry(1, 1, 1, 2, 0.2);
const O = { outline: true };
const _Y = new THREE.Vector3(0, 1, 0);
const _t1 = new THREE.Vector3();

/** Adds unit Y-aligned geometry stretched between points a and b. half=true for radius-1 primitives. */
function seg(b, geom, mat, a, c, w, d, opts, half = false) {
  const dir = _t1.subVectors(c, a);
  const len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(_Y, dir.normalize());
  b.add(geom, mat, [(a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2], q, [w, half ? len / 2 : len, d], opts);
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function bake(builder, thickness = 0.006) {
  const tmp = new THREE.Group();
  const res = builder.build(tmp, { outlineThickness: thickness });
  return [...res.meshes.values(), ...(res.outline ? [res.outline] : [])];
}
function inst(meshes, group) {
  for (const m of meshes) { const c = new THREE.Mesh(m.geometry, m.material); c.name = m.name; group.add(c); }
  return group;
}

// ======================================================== GREEN MANIAC
// seconds from setState('throw') to the bomb leaving his hand. Live binding: setBossModels() switches it to the
// Mixamo throw clip's release (greenManiacAnimated.js) when that model is loaded; 0.3 = procedural / v2 clip.
export let GREEN_MANIAC_THROW_RELEASE = 0.3;
export const GREEN_MANIAC_THROW_DURATION = 0.45;

const GM = { L_UP: 0.3, L_FORE: 0.28, L_THIGH: 0.46, L_SHIN: 0.44, HIP_Y: 0.98 };
const WHISKER = toon(0x9fae4a);

function gmHead() {
  const b = new PartBuilder();
  const E = MAT.emerald, D = MAT.emeraldDark, K = MAT.black, A = MAT.amberGlow;
  b.add(GEO.sphere, E, [0, 0.005, -0.02], [0, 0, 0], [0.068, 0.095, 0.1], O);
  b.add(GEO.cone4, E, [0, 0.06, 0.03], [0.5, Math.PI / 4, 0], [0.05, 0.12, 0.05], O); // brow wedge
  b.add(GEO.cone, E, [0, -0.025, 0.14], [Math.PI / 2 - 0.18, 0, 0], [0.05, 0.22, 0.042], O); // snout
  b.add(GEO.cone, K, [0, -0.07, 0.1], [Math.PI / 2 + 0.2, 0, 0], [0.04, 0.16, 0.022], O); // jaw
  for (const s of [-1, 1]) {
    b.add(GEO.box, A, [s * 0.034, 0.012, 0.088], [0, s * 0.5, s * 0.42], [0.04, 0.011, 0.008]); // eyes
    b.add(GEO.box, A, [s * 0.03, -0.055, 0.1], [0, -s * 1.3, -0.25], [0.07, 0.004, 0.004]); // mouth slit
    b.add(GEO.octa, D, [s * 0.058, -0.035, 0.03], [0, s * 0.3, 0], [0.022, 0.05, 0.075], O); // cheek plate
    b.add(GEO.cone4, E, [s * 0.05, 0.03, 0.06], [0.3, 0, -s * 0.2], [0.02, 0.07, 0.015]); // brow
    // side horns (ear fins) up and back
    b.add(GEO.cone, D, [s * 0.065, 0.085, -0.04], [-0.55, 0, -s * 0.35], [0.022, 0.17, 0.016], O);
    b.add(GEO.cyl, K, [s * 0.075, -0.01, 0.0], [0, 0, Math.PI / 2], [0.02, 0.02, 0.02]);
    b.add(GEO.cyl, MAT.purple, [s * 0.085, -0.01, 0.0], [0, 0, Math.PI / 2], [0.012, 0.01, 0.012]);
    // antenna whiskers curving back
    const curve = new THREE.CatmullRomCurve3([
      V(s * 0.08, -0.01, 0.0), V(s * 0.14, 0.03, -0.06), V(s * 0.19, 0.0, -0.18),
      V(s * 0.21, -0.12, -0.27), V(s * 0.2, -0.26, -0.3),
    ]);
    b.add(new THREE.TubeGeometry(curve, 24, 0.0035, 4, false), WHISKER);
  }
  // crest spines along the midline
  const crest = [[0.07, 0.07, 0.06], [0.1, 0.03, 0.1], [0.1, -0.02, 0.14], [0.08, -0.07, 0.13], [0.04, -0.11, 0.1], [-0.02, -0.13, 0.07]];
  crest.forEach(([y, z, h], i) => {
    b.add(GEO.cone4, i % 2 ? D : E, [0, y + h * 0.3, z], [-0.7 - i * 0.1, Math.PI / 4, 0], [0.014, h, 0.03], O);
  });
  return b;
}

function gmChest() {
  const b = new PartBuilder();
  const E = MAT.emerald, D = MAT.emeraldDark, K = MAT.black, A = MAT.amberGlow, Pp = MAT.purple;
  b.add(GEO.sphere, K, [0, 0.1, 0], [0, 0, 0], [0.145, 0.16, 0.095]);
  for (const s of [-1, 1]) {
    b.add(RBOX, E, [s * 0.075, 0.125, 0.064], [0.1, -s * 0.38, -s * 0.42], [0.125, 0.24, 0.035], O); // V plates
    b.add(GEO.octa, D, [s * 0.11, 0.06, 0.05], [0, -s * 0.5, -s * 0.3], [0.04, 0.09, 0.03], O); // rib plates
    b.add(RBOX, E, [s * 0.06, 0.13, -0.07], [-0.1, s * 0.3, s * 0.45], [0.1, 0.19, 0.03], O); // back plates
    for (let i = 0; i < 3; i++) {
      b.add(GEO.box, A, [s * (0.05 + i * 0.012), 0.17 - i * 0.045, 0.087 - i * 0.003], [0, -s * 0.35, -s * 0.5], [0.06, 0.004, 0.004]);
    }
    // angular shoulder pads with spikes
    b.add(GEO.octa, E, [s * 0.19, 0.2, 0], [0, 0, -s * 0.35], [0.085, 0.05, 0.075], O);
    b.add(GEO.cone4, D, [s * 0.255, 0.235, 0], [0, 0, -s * 1.1], [0.02, 0.09, 0.03], O);
    b.add(GEO.box, A, [s * 0.19, 0.218, 0.04], [0, 0, -s * 0.35], [0.08, 0.004, 0.004]);
    b.add(GEO.box, Pp, [s * 0.07, 0.22, 0.05], [0, 0, s * 0.6], [0.05, 0.012, 0.012]);
  }
  b.add(GEO.cone, E, [0, 0.05, 0.085], [Math.PI, 0, 0], [0.045, 0.16, 0.022], O); // sternum point
  b.add(GEO.box, A, [0, 0.06, 0.096], [0, 0, 0], [0.004, 0.09, 0.004]);
  b.add(GEO.box, A, [0, 0.12, -0.1], [0, 0, 0], [0.006, 0.18, 0.006]); // spine glow
  return b;
}

function gmSpine() {
  const b = new PartBuilder();
  b.add(GEO.sphere, MAT.black, [0, 0.1, 0], [0, 0, 0], [0.115, 0.14, 0.085]);
  for (let i = 0; i < 3; i++) {
    b.add(RBOX, MAT.emeraldDark, [0, 0.05 + i * 0.06, 0.07], [0, 0, 0], [0.1 - i * 0.004, 0.045, 0.025], O);
    b.add(GEO.box, MAT.amberGlow, [0, 0.05 + i * 0.06, 0.084], [0, 0, 0], [0.03, 0.004, 0.003]);
  }
  return b;
}

function gmHips() {
  const b = new PartBuilder();
  b.add(GEO.sphere, MAT.black, [0, 0, 0], [0, 0, 0], [0.14, 0.1, 0.1]);
  b.add(GEO.cone, MAT.emerald, [0, -0.06, 0.085], [Math.PI, 0, 0], [0.075, 0.2, 0.025], O);
  for (const s of [-1, 1]) b.add(GEO.octa, MAT.emerald, [s * 0.13, -0.02, 0], [0, 0, 0], [0.04, 0.09, 0.07], O);
  b.add(GEO.box, MAT.purple, [0, 0.03, 0.095], [0, 0, 0], [0.14, 0.012, 0.01]);
  return b;
}

function gmUpperArm(s) {
  const b = new PartBuilder();
  b.add(GEO.sphere, MAT.black, [0, 0, 0], [0, 0, 0], 0.045);
  b.add(frustum(0.042, 0.032, 0.28), MAT.scaleGreen, [0, -0.15, 0], [0, 0, 0], 1, O);
  b.add(GEO.octa, MAT.emerald, [s * 0.03, -0.1, 0], [0, 0, 0], [0.03, 0.12, 0.045], O);
  return b;
}

function gmForearm(s) {
  const b = new PartBuilder();
  b.add(GEO.sphere, MAT.black, [0, 0, 0], [0, 0, 0], 0.036);
  b.add(frustum(0.033, 0.027, 0.27), MAT.black, [0, -0.14, 0]);
  b.add(RBOX, MAT.emerald, [s * 0.006, -0.14, 0.0], [0, 0, 0], [0.065, 0.2, 0.068], O);
  b.add(GEO.cone4, MAT.emeraldDark, [s * 0.04, -0.06, -0.02], [-2.3, 0, -s * 0.5], [0.015, 0.11, 0.02], O); // elbow fin
  b.add(GEO.cone4, MAT.emeraldDark, [s * 0.04, -0.14, -0.03], [-2.4, 0, -s * 0.5], [0.012, 0.08, 0.016], O);
  b.add(GEO.box, MAT.amberGlow, [s * 0.034, -0.15, 0.02], [0, 0, 0], [0.004, 0.13, 0.004]);
  b.add(new THREE.TorusGeometry(0.03, 0.006, 5, 16), MAT.purple, [0, -0.255, 0], [Math.PI / 2, 0, 0]);
  return b;
}

function gmHand(s) {
  const b = new PartBuilder();
  b.add(RBOX, MAT.scaleGreen, [0, -0.045, 0.005], [0, 0, 0], [0.03, 0.08, 0.07], O);
  for (let i = 0; i < 4; i++) {
    const z = 0.03 - i * 0.02;
    const a = V(0, -0.08, z), c = V(s * 0.005, -0.14, z + 0.012), e = V(-s * 0.01, -0.185, z + 0.02);
    seg(b, GEO.cylLo, MAT.scaleGreen, a, c, 0.008, 0.008);
    seg(b, GEO.cone, MAT.black, c, e, 0.008, 0.008, O);
  }
  const t0 = V(0, -0.03, 0.04), t1 = V(-s * 0.02, -0.08, 0.07), t2 = V(-s * 0.03, -0.12, 0.08);
  seg(b, GEO.cylLo, MAT.scaleGreen, t0, t1, 0.009, 0.009);
  seg(b, GEO.cone, MAT.black, t1, t2, 0.009, 0.009, O);
  return b;
}

function gmThigh(s) {
  const b = new PartBuilder();
  b.add(frustum(0.07, 0.05, 0.44), MAT.black, [0, -0.22, 0]);
  b.add(GEO.octa, MAT.emerald, [s * 0.01, -0.2, 0.03], [0, 0, 0], [0.055, 0.2, 0.05], O);
  b.add(GEO.box, MAT.amberGlow, [s * 0.04, -0.2, 0.05], [0, 0, 0], [0.004, 0.12, 0.004]);
  return b;
}

function gmShin(s) {
  const b = new PartBuilder();
  b.add(frustum(0.05, 0.035, 0.42), MAT.black, [0, -0.21, -0.01]);
  b.add(GEO.cone4, MAT.emerald, [0, 0.03, 0.06], [0.5, Math.PI / 4, 0], [0.04, 0.12, 0.04], O); // knee spike
  b.add(RBOX, MAT.emerald, [0, -0.22, 0.02], [0, 0, 0], [0.085, 0.32, 0.075], O); // greave
  b.add(GEO.cone4, MAT.emeraldDark, [s * 0.05, -0.13, -0.01], [0, 0, -s * 0.5], [0.015, 0.1, 0.02], O);
  for (const k of [-1, 1]) b.add(GEO.box, MAT.amberGlow, [k * 0.022, -0.2, 0.059], [0, 0, k * 0.12], [0.004, 0.16, 0.004]);
  b.add(new THREE.TorusGeometry(0.036, 0.006, 5, 16), MAT.purple, [0, -0.41, 0], [Math.PI / 2, 0, 0]);
  return b;
}

function gmFoot() {
  const b = new PartBuilder();
  b.add(RBOX, MAT.emerald, [0, -0.045, 0.04], [0.1, 0, 0], [0.09, 0.07, 0.17], O);
  for (let i = -1; i <= 1; i++) {
    const a = V(i * 0.03, -0.05, 0.12), c = V(i * 0.045, -0.075, 0.2);
    seg(b, GEO.cone, MAT.black, a, c, 0.014, 0.012, O);
  }
  seg(b, GEO.cone, MAT.black, V(0, -0.05, -0.03), V(0, -0.075, -0.09), 0.012, 0.012, O);
  return b;
}

const TAIL_N = 10;
// User-provided GLB models (set by bossModels.js before the Boss is created). null → procedural.
let BOSS_MODELS = null;
export function setBossModels(m) { BOSS_MODELS = m; GREEN_MANIAC_THROW_RELEASE = m?.maniac?.animated ? gmThrowRelease() : 0.3; }
function gmTailSeg(i) {
  const b = new PartBuilder();
  const L = gmTailLen(i);
  const r0 = 0.075 * (1 - i / TAIL_N) + 0.012, r1 = 0.075 * (1 - (i + 1) / TAIL_N) + 0.008;
  const g = frustum(r1, r0, L * 1.08, 10);
  b.add(g, MAT.scaleGreen, [0, 0, -L / 2], [-Math.PI / 2, 0, 0], [1, 1, 0.85], O);
  b.add(GEO.cone4, MAT.emeraldDark, [0, r0 * 0.75, -L * 0.4], [-0.9, Math.PI / 4, 0], [r0 * 0.25, r0 * 1.0, r0 * 0.25], O);
  if (i === TAIL_N - 1) b.add(GEO.cone, MAT.emeraldDark, [0, 0, -L - 0.05], [-Math.PI / 2, 0, 0], [r1, 0.12, r1 * 0.85], O);
  return b;
}
const gmTailLen = (i) => 0.17 * (1 - i * 0.045);
const TAIL_REST = [-1.25, 0.15, 0.15, 0.15, 0.17, 0.17, 0.2, 0.2, 0.18, 0.25];
const TAIL_YAW = [0.05, 0.08, 0.1, 0.12, 0.14, 0.16, 0.18, 0.2, 0.22, 0.26];

let GM_BAKED = null;
function gmParts() {
  if (GM_BAKED) return GM_BAKED;
  const side = (fn) => ({ 1: bake(fn(1), 0.005), [-1]: bake(fn(-1), 0.005) });
  GM_BAKED = {
    head: bake(gmHead(), 0.004), chest: bake(gmChest(), 0.005), spine: bake(gmSpine(), 0.005), hips: bake(gmHips(), 0.005),
    upper: side(gmUpperArm), fore: side(gmForearm), hand: side(gmHand), thigh: side(gmThigh), shin: side(gmShin),
    foot: bake(gmFoot(), 0.004),
    tail: Array.from({ length: TAIL_N }, (_, i) => bake(gmTailSeg(i), 0.005)),
  };
  return GM_BAKED;
}

const STATE_POSES = {
  stand: { drop: 0.02, spine: 0.05, chest: 0.05, head: -0.05, shX: 0.1, shZ: 0.22, el: -0.4, th: -0.12, kn: 0.25, ft: -0.13, spread: 0.06 },
  ride: { drop: 0.1, spine: 0.25, chest: 0.12, head: -0.3, shX: -0.2, shZ: 0.65, el: -0.7, th: -0.5, kn: 0.95, ft: -0.45, spread: 0.12 },
  throw: { drop: 0.08, spine: 0.15, chest: 0.05, head: -0.15, shX: -0.1, shZ: 0.45, el: -0.6, th: -0.4, kn: 0.8, ft: -0.4, spread: 0.12 },
  crouch: { drop: 0.36, spine: 0.55, chest: 0.2, head: -0.6, shX: -0.6, shZ: 0.35, el: -0.8, th: -1.25, kn: 2.0, ft: -0.75, spread: 0.16 },
  hurt: { drop: 0.05, spine: -0.35, chest: -0.25, head: 0.45, shX: 0.5, shZ: 1.1, el: -0.4, th: -0.25, kn: 0.4, ft: -0.15, spread: 0.1 },
  'fly-away': { drop: -0.02, spine: -0.2, chest: -0.1, head: 0.2, shX: -2.7, shZ: 0.35, el: -0.2, th: 0.1, kn: 0.35, ft: 0.25, spread: 0.08 },
};

function keyInterp(keys, t) { // keys: [[time, value], ...] smoothstep between
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
      let u = (t - t0) / (t1 - t0); u = u * u * (3 - 2 * u);
      return v0 + (v1 - v0) * u;
    }
  }
  return keys[keys.length - 1][1];
}
const THROW_SH_X = [[0, 0], [0.12, 2.3], [0.3, 4.15], [0.45, 5.6]];
const THROW_SH_Z = [[0, 0.3], [0.12, 0.55], [0.3, 0.2], [0.45, 0.15]];
const THROW_EL = [[0, -0.5], [0.12, -2.0], [0.3, -0.15], [0.45, -0.45]];
const THROW_CHEST_YAW = [[0, 0], [0.12, -0.55], [0.3, 0.4], [0.45, 0.5]];
const THROW_SPINE = [[0, 0], [0.12, -0.15], [0.3, 0.25], [0.45, 0.35]];

/**
 * createGreenManiac() – origin at floor between the feet, faces +Z, ~1.9 m.
 */
export function createGreenManiac() {
  if (BOSS_MODELS?.maniac?.animated) return createGreenManiacAnimated(BOSS_MODELS.maniac.animated); // Mixamo clips + tail spring
  if (BOSS_MODELS?.maniac) return createGreenManiacGLB(BOSS_MODELS.maniac);
  const P = gmParts();
  const G = (name, meshes) => inst(meshes, Object.assign(new THREE.Group(), { name }));
  const root = new THREE.Group(); root.name = 'green-maniac';
  const hips = G('hips', P.hips); hips.position.y = GM.HIP_Y;
  const spine = G('spine', P.spine); spine.position.y = 0.06;
  const chest = G('chest', P.chest); chest.position.y = 0.2;
  const neck = new THREE.Group(); neck.position.set(0, 0.25, 0.01);
  const head = G('head', P.head); head.position.set(0, 0.1, 0.02);
  root.add(hips); hips.add(spine); spine.add(chest); chest.add(neck); neck.add(head);
  const neckMesh = new THREE.Mesh(frustum(0.04, 0.05, 0.12), MAT.black); neckMesh.position.y = 0.04; neck.add(neckMesh);

  const arms = {}, legs = {};
  for (const s of [1, -1]) { // s=+1 is the left side (+X when facing +Z)
    const sh = G('upperArm', P.upper[s]); sh.position.set(s * 0.2, 0.17, 0); sh.rotation.order = 'ZXY';
    const el = G('forearm', P.fore[s]); el.position.y = -GM.L_UP;
    const hd = G('hand', P.hand[s]); hd.position.y = -GM.L_FORE;
    chest.add(sh); sh.add(el); el.add(hd);
    arms[s] = { sh, el, hd };
    const th = G('thigh', P.thigh[s]); th.position.set(s * 0.095, -0.04, 0); th.rotation.order = 'ZXY';
    const kn = G('shin', P.shin[s]); kn.position.y = -GM.L_THIGH;
    const ft = G('foot', P.foot); ft.position.y = -GM.L_SHIN;
    hips.add(th); th.add(kn); kn.add(ft);
    legs[s] = { th, kn, ft };
  }
  const tail = [];
  let parent = hips;
  for (let i = 0; i < TAIL_N; i++) {
    const t = G('tail' + i, P.tail[i]);
    t.position.set(0, i === 0 ? -0.03 : 0, i === 0 ? -0.08 : -gmTailLen(i - 1));
    t.rotation.order = 'YXZ';
    parent.add(t); tail.push(t); parent = t;
  }

  const throwHand = new THREE.Object3D(); throwHand.name = 'throwHand';
  throwHand.position.set(0, -0.08, 0.02);
  arms[-1].hd.add(throwHand); // right hand
  const hitCenter = new THREE.Object3D(); hitCenter.name = 'hitCenter';
  hitCenter.position.set(0, 0.1, 0.03);
  chest.add(hitCenter);

  let state = 'stand', prevState = 'stand', throwT = -1, hurtT = 0;
  const cur = { ...STATE_POSES.stand };

  function setState(next) {
    if (next === 'hit') { setState('hurt'); return true; } // v0.46: hit reaction = the hurt shake, always plays ('taunt', like 'faceBack', has no pose here: ignored)
    if (!STATE_POSES[next]) return;
    if (next === 'throw') {
      if (state !== 'throw') prevState = state;
      throwT = 0;
    } else if (next === 'hurt') hurtT = 0;
    state = next;
  }

  function update(dt, t) {
    const tgt = STATE_POSES[state];
    const k = 1 - Math.exp(-dt * 9);
    for (const key in cur) cur[key] += (tgt[key] - cur[key]) * k;
    const breath = Math.sin(t * 2.2);

    hips.position.y = GM.HIP_Y - cur.drop + breath * 0.004;
    spine.rotation.set(cur.spine, 0, 0);
    chest.rotation.set(cur.chest + breath * 0.02, 0, 0);
    chest.scale.setScalar(1 + breath * 0.008);
    neck.rotation.set(0, 0, 0);
    head.rotation.set(cur.head + Math.sin(t * 0.9) * 0.04, Math.sin(t * 0.6) * 0.15, 0);

    for (const s of [1, -1]) {
      const a = arms[s];
      const sway = Math.sin(t * 1.7 + s) * 0.04;
      a.sh.rotation.set(cur.shX + sway, 0, s * cur.shZ);
      a.el.rotation.set(cur.el - Math.abs(sway), 0, 0);
      a.hd.rotation.set(-0.2, 0, s * 0.1);
      const l = legs[s];
      l.th.rotation.set(cur.th, 0, s * cur.spread);
      l.kn.rotation.set(cur.kn, 0, 0);
      l.ft.rotation.set(cur.ft, 0, -s * cur.spread);
    }
    if (state === 'hurt') {
      hurtT += dt;
      const shake = Math.exp(-hurtT * 5) * Math.sin(hurtT * 50) * 0.08;
      chest.rotation.z = shake; head.rotation.z = -shake * 1.5;
      arms[1].sh.rotation.x += Math.sin(t * 13) * 0.3; arms[-1].sh.rotation.x -= Math.sin(t * 11) * 0.3;
    }
    if (state === 'fly-away') {
      for (const s of [1, -1]) legs[s].th.rotation.x += Math.sin(t * 4 + s * 2) * 0.15;
    }

    // throw clip (right arm = side -1)
    if (throwT >= 0) {
      throwT += dt;
      const tt = Math.min(throwT, GREEN_MANIAC_THROW_DURATION);
      const a = arms[-1];
      a.sh.rotation.set(keyInterp(THROW_SH_X, tt), 0, -keyInterp(THROW_SH_Z, tt));
      a.el.rotation.x = keyInterp(THROW_EL, tt);
      chest.rotation.y = keyInterp(THROW_CHEST_YAW, tt);
      spine.rotation.x += keyInterp(THROW_SPINE, tt);
      if (throwT >= GREEN_MANIAC_THROW_DURATION) {
        throwT = -1;
        state = prevState; // pose blend eases the arm back from the follow-through
      }
    }

    // tail sway
    for (let i = 0; i < TAIL_N; i++) {
      const w = Math.sin(t * 1.6 - i * 0.55);
      tail[i].rotation.set(TAIL_REST[i] + (i === 0 ? cur.drop * 1.2 : 0) + Math.sin(t * 1.1 - i * 0.4) * 0.03, TAIL_YAW[i] * 0.6 + w * (0.05 + i * 0.012), 0);
    }
  }

  update(0, 0);
  return { root, update, setState, throwHand, hitCenter, mesh: inst.mesh, get state() { return state; } };
}

// ============================================================ BAT JET
const MEMBRANE = toon(0x16181c, { side: THREE.DoubleSide });
const NOSE_DIR = [-Math.PI / 2, 0, 0]; // cone +Y -> -Z

// gull-wing arch: height as a function of distance from the wing root
const ARCH = [[0, 0], [0.95, 0.22], [1.65, 0.34], [2.3, 0.22], [2.9, -0.12], [3.2, -0.25]];
function archY(ax) {
  const a = Math.abs(ax);
  for (let i = 1; i < ARCH.length; i++) {
    if (a <= ARCH[i][0]) { const [x0, y0] = ARCH[i - 1], [x1, y1] = ARCH[i]; return y0 + (y1 - y0) * (a - x0) / (x1 - x0); }
  }
  return ARCH[ARCH.length - 1][1];
}
function wingLayout(s) {
  const P = (x, y, z) => V(s * x, archY(x) + y * 0.3, z);
  return {
    shoulder: P(0, 0, 0), elbow: P(0.95, 0.12, -0.38), wrist: P(1.65, 0.2, -0.45),
    lead: [P(2.15, 0.15, -0.36), P(2.55, 0.06, -0.08)],
    tips: [P(2.85, -0.12, 0.62), P(2.25, -0.04, 0.72), P(1.65, 0.0, 0.8), P(1.05, 0.02, 0.72)],
    rootTrail: P(0.25, 0, 0.6),
  };
}

function batWing(s) {
  const b = new PartBuilder();
  const L = wingLayout(s);
  const E = MAT.emerald, A = MAT.amberGlow, Gm = MAT.gunmetal;
  // membrane shape in (x, z)
  const sh = new THREE.Shape();
  const pts2 = (v) => [v.x, v.z];
  sh.moveTo(s * 0.05, -0.3);
  sh.lineTo(...pts2(L.elbow));
  sh.lineTo(...pts2(L.wrist));
  sh.quadraticCurveTo(s * 2.4, -0.42, ...pts2(L.lead[1]));
  sh.quadraticCurveTo(s * 2.8, 0.15, ...pts2(L.tips[0]));
  const scallop = (a, c, depth) => {
    const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
    sh.quadraticCurveTo(mx, mz - depth, c.x, c.z);
  };
  scallop(L.tips[0], L.tips[1], 0.35);
  scallop(L.tips[1], L.tips[2], 0.3);
  scallop(L.tips[2], L.tips[3], 0.3);
  scallop(L.tips[3], L.rootTrail, 0.28);
  sh.lineTo(s * 0.05, 0.4);
  const mg = new THREE.ExtrudeGeometry(sh, { depth: 0.025, bevelEnabled: false, curveSegments: 10 });
  mg.rotateX(Math.PI / 2); // (x,y)->(x,0,y); depth -> -Y
  mg.translate(0, 0.02, 0);
  { // bend the flat membrane onto the arch
    const pa = mg.attributes.position;
    for (let i = 0; i < pa.count; i++) pa.setY(i, pa.getY(i) + archY(pa.getX(i)));
    mg.computeVertexNormals();
  }
  b.addRaw(mg, MEMBRANE);

  // bones: arm + fingers
  const bone = (a, c, w) => {
    seg(b, GEO.cylLo, Gm, a, c, w * 0.45, w * 0.45);
    seg(b, GEO.octa, E, a, c, w, w * 0.6, O, true);
    const mid = a.clone().lerp(c, 0.5);
    seg(b, GEO.box, A, a.clone().lerp(c, 0.25).setY(mid.y + w * 0.62), c.clone().lerp(a, 0.25).setY(mid.y + w * 0.62), 0.016, 0.016);
  };
  bone(L.shoulder, L.elbow, 0.16);
  bone(L.elbow, L.wrist, 0.14);
  bone(L.wrist, L.lead[0], 0.12);
  bone(L.lead[0], L.lead[1], 0.11);
  bone(L.lead[1], L.tips[0], 0.1);
  for (let i = 1; i < 4; i++) bone(L.wrist, L.tips[i], 0.07 + i * 0.008);
  // leading-edge shards
  for (let i = 0; i < 4; i++) {
    const a = L.elbow.clone().lerp(L.wrist, i / 4);
    const c = a.clone().add(V(s * 0.25, 0.05, 0.15));
    seg(b, GEO.octa, MAT.emeraldDark, a, c, 0.07, 0.04, O, true);
  }
  // hooked wing-tip claw
  seg(b, GEO.cone, E, L.tips[0], L.tips[0].clone().add(V(-s * 0.12, -0.05, 0.3)), 0.06, 0.05, O);
  // joint hubs
  for (const p of [L.elbow, L.wrist, L.lead[1]]) {
    b.add(GEO.cyl, Gm, [p.x, p.y + 0.02, p.z], [0, 0, 0], [0.075, 0.09, 0.075], O);
    b.add(GEO.cyl, A, [p.x, p.y + 0.066, p.z], [0, 0, 0], [0.03, 0.01, 0.03]);
  }
  return b;
}

function batBody() {
  const b = new PartBuilder();
  const E = MAT.emerald, D = MAT.emeraldDark, A = MAT.amberGlow, Gm = MAT.gunmetal, K = MAT.black;
  b.add(GEO.sphere, K, [0, 0, 0.05], [0, 0, 0], [0.55, 0.22, 1.05], O); // hull
  b.add(GEO.cone, E, [0, 0.02, -1.15], NOSE_DIR, [0.24, 0.85, 0.12], O); // nose spike
  b.add(GEO.box, A, [0, 0.1, -1.0], [0.12, 0, 0], [0.02, 0.012, 0.45]);
  for (const s of [-1, 1]) {
    // chevron plates on the hull top
    for (let i = 0; i < 3; i++) {
      b.add(GEO.octa, E, [s * 0.22, 0.12, -0.55 + i * 0.5], [0, s * 0.45, 0], [0.12, 0.05, 0.38], O);
      b.add(GEO.box, A, [s * 0.27, 0.165, -0.55 + i * 0.5], [0, s * 0.45, 0], [0.012, 0.01, 0.2]);
    }
    b.add(GEO.cone4, E, [s * 0.32, 0.3, -0.35], [0.4, 0, -s * 0.15], [0.06, 0.32, 0.08], O); // dorsal horns
    b.add(GEO.cone, D, [s * 0.36, -0.02, -0.75], NOSE_DIR, [0.08, 0.45, 0.06], O); // side nose spikes
    b.add(GEO.cone, D, [s * 0.3, -0.05, 1.05], [Math.PI / 2, 0, 0], [0.06, 0.5, 0.05], O); // rear spikes
    // thrusters (+Z = rear)
    const tx = s * 0.56, ty = -0.14, tz = 0.5;
    b.add(GEO.cyl, Gm, [tx, ty, tz], [Math.PI / 2, 0, 0], [0.17, 0.5, 0.17], O);
    b.add(GEO.cyl, K, [tx, ty, tz + 0.27], [Math.PI / 2, 0, 0], [0.15, 0.06, 0.15]);
    for (let r = 0; r < 3; r++) b.add(new THREE.TorusGeometry(0.172, 0.012, 5, 20), K, [tx, ty, tz - 0.15 + r * 0.12]);
    b.add(GEO.octa, E, [tx, ty + 0.15, tz - 0.05], [0, 0, 0], [0.09, 0.05, 0.3], O);
    b.add(new THREE.TorusGeometry(0.12, 0.018, 6, 20), A, [tx, ty, tz - 0.255]); // glowing intake ring
    b.add(GEO.cyl, K, [tx, ty, tz - 0.25], [Math.PI / 2, 0, 0], [0.11, 0.01, 0.11]);
    for (let k = -1; k <= 1; k++) b.add(GEO.box, A, [tx, ty + k * 0.045, tz - 0.262], [0, 0, 0], [0.14 - Math.abs(k) * 0.04, 0.012, 0.005]);
    b.add(GEO.box, A, [tx + s * 0.17, ty, tz], [0, 0, 0], [0.012, 0.03, 0.25]);
    // footpads with chevron treads + amber trim
    b.add(RBOX, Gm, [s * 0.2, 0.235, 0.15], [0, 0, 0], [0.24, 0.035, 0.46], O);
    for (let i = 0; i < 5; i++) {
      for (const k of [-1, 1]) b.add(GEO.box, K, [s * 0.2 + k * 0.045, 0.256, -0.02 + i * 0.085], [0, k * 0.6, 0], [0.1, 0.012, 0.02]);
    }
    b.add(GEO.box, A, [s * 0.2 + 0.125, 0.24, 0.15], [0, 0, 0], [0.008, 0.012, 0.46]);
    b.add(GEO.box, A, [s * 0.2 - 0.125, 0.24, 0.15], [0, 0, 0], [0.008, 0.012, 0.46]);
  }
  b.add(GEO.cone, D, [0, -0.08, 1.15], [Math.PI / 2, 0, 0], [0.07, 0.6, 0.05], O); // tail spike
  for (let i = -1; i <= 1; i++) b.add(GEO.cone, D, [i * 0.18, -0.2, -0.55], [Math.PI - 0.35, 0, 0], [0.05, 0.3, 0.04], O); // fangs
  b.add(RBOX, Gm, [0, 0.2, 0.15], [0, 0, 0], [0.75, 0.05, 0.85]); // deck
  return b;
}

let BAT_BAKED = null;
function batParts() {
  if (BAT_BAKED) return BAT_BAKED;
  BAT_BAKED = { body: bake(batBody(), 0.012), wing: { 1: bake(batWing(1), 0.01), [-1]: bake(batWing(-1), 0.01) } };
  return BAT_BAKED;
}
// base at the nozzle (origin), tip toward +Z (exhaust direction)
const FLAME_GEO = (() => { const g = new THREE.ConeGeometry(0.12, 0.7, 10, 1, true); g.translate(0, 0.35, 0); g.rotateX(Math.PI / 2); return g; })();
const FLAME_CORE_GEO = (() => { const g = new THREE.ConeGeometry(0.07, 0.45, 8, 1, true); g.translate(0, 0.225, 0); g.rotateX(Math.PI / 2); return g; })();
const NOZZLE_GEO = new THREE.CircleGeometry(0.135, 20);
const SPARK_COUNT = 28;

/** Green Maniac from public/models/green_maniac.glb, auto-skinned; same API and poses as the procedural one. */
function createGreenManiacGLB(model) {
  const { rig, J } = model; // built once in bossModels.js (skinned mesh is cloned per instance)
  const root = new THREE.Group(); root.name = 'green-maniac';
  const inst = rig.instance();
  root.add(inst.mesh);
  const B = inst.bones;
  const hips = B.hips, spine = B.spine, chest = B.chest, head = B.head;
  const arms = { 1: { sh: B.upperL, el: B.foreL, hd: B.handL }, '-1': { sh: B.upperR, el: B.foreR, hd: B.handR } };
  const legs = { 1: { th: B.thighL, kn: B.shinL, ft: B.footL }, '-1': { th: B.thighR, kn: B.shinR, ft: B.footR } };
  const restZ = { 1: J.armOut, '-1': J.armOut }, legZ = { 1: J.legOut, '-1': J.legOut };
  for (const b of Object.values(B)) b.rotation.order = 'ZXY';
  const throwHand = new THREE.Object3D(); throwHand.name = 'throwHand';
  throwHand.position.copy(J.handTip).multiplyScalar(0.6); B.handR.add(throwHand);
  const hitCenter = new THREE.Object3D(); hitCenter.name = 'hitCenter'; hitCenter.position.set(0, 0.12, 0.05); chest.add(hitCenter);
  let state = 'stand', prevState = 'stand', throwT = -1, hurtT = 0;
  const cur = { ...STATE_POSES.stand };
  const hipRest = hips.userData.rest.clone();
  function setState(next) {
    if (next === 'hit') { setState('hurt'); return true; } // v0.46: hit reaction = the hurt shake, always plays ('taunt', like 'faceBack', has no pose here: ignored)
    if (!STATE_POSES[next]) return;
    if (next === 'throw') { if (state !== 'throw') prevState = state; throwT = 0; } else if (next === 'hurt') hurtT = 0;
    state = next;
  }
  function update(dt, t) {
    const tgt = STATE_POSES[state], k = 1 - Math.exp(-dt * 9);
    for (const key in cur) cur[key] += (tgt[key] - cur[key]) * k;
    const breath = Math.sin(t * 2.2);
    hips.position.copy(hipRest); hips.position.y -= cur.drop - breath * 0.004;
    spine.rotation.set(cur.spine * 0.6, 0, 0);
    chest.rotation.set(cur.chest * 0.6 + breath * 0.02, 0, 0);
    head.rotation.set(cur.head * 0.7 + Math.sin(t * 0.9) * 0.04, Math.sin(t * 0.6) * 0.15, 0);
    for (const s of [1, -1]) {
      const a = arms[s], sway = Math.sin(t * 1.7 + s) * 0.04;
      a.sh.rotation.set(cur.shX + sway, 0, s * (cur.shZ - restZ[s]));
      a.el.rotation.set((cur.el - Math.abs(sway)) * 0.6, 0, 0);
      a.hd.rotation.set(0.15, 0, 0);
      const l = legs[s];
      l.th.rotation.set(cur.th, 0, s * (cur.spread - legZ[s]) * 0.5);
      l.kn.rotation.set(cur.kn, 0, 0);
      l.ft.rotation.set(cur.ft, 0, 0);
    }
    if (state === 'hurt') {
      hurtT += dt;
      const shake = Math.exp(-hurtT * 5) * Math.sin(hurtT * 50) * 0.08;
      chest.rotation.z = shake; head.rotation.z = -shake * 1.5;
    }
    if (throwT >= 0) { // right arm windmill throw (same keys as the procedural clip)
      throwT += dt;
      const tt = Math.min(throwT, GREEN_MANIAC_THROW_DURATION), a = arms[-1];
      a.sh.rotation.set(keyInterp(THROW_SH_X, tt), 0, -(keyInterp(THROW_SH_Z, tt) - restZ[-1]));
      a.el.rotation.x = keyInterp(THROW_EL, tt) * 0.7;
      chest.rotation.y = keyInterp(THROW_CHEST_YAW, tt);
      spine.rotation.x += keyInterp(THROW_SPINE, tt) * 0.6;
      if (throwT >= GREEN_MANIAC_THROW_DURATION) { throwT = -1; state = prevState; }
    }
    if (B.tail) B.tail.rotation.set(Math.sin(t * 1.1) * 0.04, Math.sin(t * 1.6) * 0.12, 0);
  }
  update(0, 0);
  return { root, update, setState, throwHand, hitCenter, mesh: inst.mesh, get state() { return state; } };
}

/**
 * createBatJet() – ~5.5 m wingspan, origin at the hull centre, nose = -Z.
 */
export function createBatJet() {
  const JM = BOSS_MODELS?.jet;
  const root = new THREE.Group(); root.name = 'bat-jet';
  let body;
  const wings = [];
  const wingTargets = [];
  if (JM) { // public/models/green_bat_jet.glb, skinned to a body + two wing bones (wing flap / damage droop)
    body = new THREE.Group(); body.name = 'body';
    const ji = JM.rig.instance(); body.add(ji.mesh);
    body.userData.wingBones = { '-1': ji.bones.wingL, 1: ji.bones.wingR }; body.userData.mesh = ji.mesh;
  } else body = inst(batParts().body, Object.assign(new THREE.Group(), { name: 'body' }));
  root.add(body);
  for (const s of [-1, 1]) {
    let w;
    if (JM) w = body.userData.wingBones[s];
    else { w = inst(batParts().wing[s], Object.assign(new THREE.Group(), { name: s < 0 ? 'wingL' : 'wingR' })); w.position.set(s * 0.42, 0.05, 0); body.add(w); }
    wings.push({ s, g: w });
    const t = new THREE.Object3D();
    t.name = s < 0 ? 'leftWingTarget' : 'rightWingTarget';
    t.position.set(s * 1.55, 0.05, 0.15);
    t.userData.radius = 0.95;
    w.add(t);
    wingTargets.push(t);
  }

  const standPoint = new THREE.Object3D(); standPoint.name = 'standPoint';
  standPoint.position.set(0, JM ? JM.topY : 0.255, JM?.standZ ?? 0.15);
  standPoint.rotation.y = Math.PI; // a +Z-facing character parented here faces the jet's nose (-Z)
  body.add(standPoint);

  // per-jet materials (thrust/damage vary per jet)
  const nozzleMat = glow(PALETTE.amber).clone();
  const flameMat = additive(0xff8a1a, 0.55).clone();
  const flameCoreMat = additive(0xffe2a0, 0.8).clone();
  const flames = [];
  for (const s of [-1, 1]) {
    const nz = new THREE.Mesh(NOZZLE_GEO, nozzleMat);
    if (JM) nz.position.set(s * JM.nozzleX, JM.nozzleY, JM.nozzleZ); else nz.position.set(s * 0.56, -0.14, 0.81);
    body.add(nz);
    const f = new THREE.Mesh(FLAME_GEO, flameMat); f.position.copy(nz.position);
    const c = new THREE.Mesh(FLAME_CORE_GEO, flameCoreMat); c.position.copy(nz.position);
    f.renderOrder = c.renderOrder = 10;
    body.add(f, c);
    flames.push(f, c);
  }

  // damage sparks
  const sparkPos = new Float32Array(SPARK_COUNT * 3);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    color: 0xffd27a, size: 0.07, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  sparks.frustumCulled = false; sparks.visible = false;
  body.add(sparks);
  const sparkVel = new Float32Array(SPARK_COUNT * 3);
  const sparkLife = new Float32Array(SPARK_COUNT);

  let damage = 0, thrust = 0.6;
  const baseNozzle = new THREE.Color(PALETTE.amber);

  function update(dt, t) {
    const flap = Math.sin(t * 2.1) * 0.05;
    for (const { s, g } of wings) {
      const jitter = damage > 0.5 ? Math.sin(t * 37 + s) * 0.02 * damage : 0;
      g.rotation.z = -s * (flap - damage * 0.32 + jitter);
    }
    body.rotation.z = Math.sin(t * 0.9) * 0.03 + damage * Math.sin(t * 7) * 0.03;
    body.position.y = Math.sin(t * 1.3) * 0.05;

    let flick = 0.9 + 0.1 * Math.sin(t * 9) * Math.sin(t * 5.3); // gentle (was a fast strobe → flicker)
    if (damage > 0.3) flick *= 0.85 + 0.15 * Math.sin(t * 3.1);
    const len = (0.25 + thrust * 1.0) * flick;
    for (let i = 0; i < flames.length; i++) {
      flames[i].scale.set(0.8 + thrust * 0.3, 0.8 + thrust * 0.3, len * (i % 2 ? 0.9 : 1));
      flames[i].visible = thrust > 0.02;
    }
    nozzleMat.color.copy(baseNozzle).multiplyScalar(0.5 + thrust * 0.9 * flick);

    // sparks
    sparks.visible = damage > 0.05;
    if (sparks.visible) {
      for (let i = 0; i < SPARK_COUNT; i++) {
        sparkLife[i] -= dt;
        if (sparkLife[i] <= 0) {
          if (Math.random() < damage * 0.4) {
            const s = Math.random() < 0.5 ? -1 : 1;
            sparkPos[i * 3] = s * (0.4 + Math.random() * 1.5);
            sparkPos[i * 3 + 1] = 0.1;
            sparkPos[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
            sparkVel[i * 3] = (Math.random() - 0.5) * 1.5;
            sparkVel[i * 3 + 1] = 0.5 + Math.random() * 1.5;
            sparkVel[i * 3 + 2] = 1 + Math.random() * 2;
            sparkLife[i] = 0.3 + Math.random() * 0.4;
          } else { sparkPos[i * 3 + 1] = -999; sparkLife[i] = 0.05; }
        } else {
          sparkVel[i * 3 + 1] -= 6 * dt;
          sparkPos[i * 3] += sparkVel[i * 3] * dt;
          sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
          sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
        }
      }
      sparkGeo.attributes.position.needsUpdate = true;
    }
  }

  update(0, 0);
  return {
    root, update, wingTargets, standPoint, mesh: body.userData.mesh || null,
    setDamage(v) { damage = THREE.MathUtils.clamp(v, 0, 1); },
    setThrust(v) { thrust = THREE.MathUtils.clamp(v, 0, 1); },
  };
}

// ======================================================== PUMPKIN BOMB
const PB_R = 0.16, PB_SQUASH = 0.82, PB_LOBES = 8;

const CIRCUIT_TEX = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 128);
  g.strokeStyle = '#ffb020'; g.fillStyle = '#ffb020'; g.lineWidth = 2;
  const trace = (pts) => { g.beginPath(); g.moveTo(...pts[0]); for (const p of pts.slice(1)) g.lineTo(...p); g.stroke(); g.beginPath(); g.arc(...pts[pts.length - 1], 3, 0, Math.PI * 2); g.fill(); };
  trace([[20, 26], [20, 44], [34, 52], [34, 70]]);
  trace([[44, 30], [44, 50]]);
  trace([[28, 84], [28, 96], [40, 104]]);
  trace([[14, 64], [22, 72], [22, 86]]);
  trace([[50, 76], [42, 84], [42, 92]]);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

const PB_SHELL_GEO = (() => {
  const parts = [];
  const step = (Math.PI * 2) / PB_LOBES, gap = 0.075;
  for (let i = 0; i < PB_LOBES; i++) {
    const g = new THREE.SphereGeometry(PB_R, 6, 14, i * step + gap / 2, step - gap, 0.12, Math.PI - 0.24);
    const p = g.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const x = p.getX(v), y = p.getY(v), z = p.getZ(v);
      let phi = Math.atan2(-z, x) - (i * step + gap / 2) + Math.PI; // three's sphere uses x=-cos, z=sin
      phi = ((phi % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const u = THREE.MathUtils.clamp(phi / (step - gap), 0, 1);
      const bulge = 0.93 + 0.07 * Math.sin(Math.PI * u);
      const yy = y / PB_R;
      const dimple = 1 - 0.1 * Math.pow(Math.abs(yy), 6);
      p.setXYZ(v, x * bulge, y * PB_SQUASH * bulge * dimple, z * bulge);
    }
    g.computeVertexNormals();
    parts.push(g);
  }
  const b = new PartBuilder();
  for (const g of parts) b.addRaw(g, MAT.gunmetal);
  return b.geometryFor(MAT.gunmetal);
})();
const PB_SHELL_MAT = new THREE.MeshStandardMaterial({
  color: PALETTE.gunmetal, metalness: 0.6, roughness: 0.38,
  emissive: PALETTE.amber, emissiveMap: CIRCUIT_TEX, emissiveIntensity: CIRCUIT_TEX ? 1.3 : 0,
});
const PB_CORE_GEO = (() => { const g = new THREE.SphereGeometry(PB_R * 0.92, 16, 12); g.scale(1, PB_SQUASH, 1); return g; })();
const PB_HULL_GEO = (() => { const g = new THREE.SphereGeometry(PB_R * 1.0, 18, 12); g.scale(1, PB_SQUASH * 0.98, 1); return g; })();
const PB_HULL_MATS = [
  outlineMaterial(0.004, 0x000000),
  outlineMaterial(0.009, 0x1aa6d6),
  outlineMaterial(0.014, 0x8af4ff),
];
const PB_CAP = (() => {
  const b = new PartBuilder();
  const top = PB_R * PB_SQUASH;
  b.add(GEO.cyl, MAT.black, [0, top - 0.005, 0], [0, 0, 0], [0.034, 0.03, 0.034]);
  b.add(GEO.cyl, MAT.gunmetal, [0, top + 0.016, 0], [0, 0, 0], [0.022, 0.018, 0.022]);
  b.add(GEO.cylLo, MAT.gunmetal, [0.004, top + 0.05, 0], [0, 0, -0.12], [0.004, 0.06, 0.004]);
  b.add(GEO.cyl, MAT.black, [0, -top + 0.004, 0], [0, 0, 0], [0.03, 0.02, 0.03]);
  b.add(new THREE.TorusGeometry(PB_R * 1.005, 0.006, 5, 40), MAT.black, [0, 0, 0], [Math.PI / 2, 0, 0]);
  return b;
})();
const PB_CAP_GEO = PB_CAP.geometryFor(MAT.gunmetal);
const PB_CAP_BLACK_GEO = PB_CAP.geometryFor(MAT.black);
const PB_LED_GEO = new THREE.SphereGeometry(0.009, 8, 6);
const PB_LED_MAT = glow(PALETTE.amber);
const PB_SCREEN_BOX = new RoundedBoxGeometry(0.13, 0.062, 0.03, 2, 0.008);
const PB_SCREEN_GEO = new THREE.PlaneGeometry(0.112, 0.048);

/**
 * createPumpkinBomb({countdown}) – origin at the bomb centre; countdown
 * display faces +Z. radius = collision radius (m).
 */
// User-provided pumpkin bomb GLBs (set by pumpkinModels.js before the arcade is created). null → procedural.
let PUMPKIN_MODELS = null;
export function setPumpkinModels(m) { PUMPKIN_MODELS = m; }
export const hasPumpkinModels = () => !!PUMPKIN_MODELS;

/** Model-based bomb ('normal' | 'giant'): one textured mesh + the highlight hull; front (+Z) faces the player. */
// the normal model's built-in timer display (front, measured on pumpkin_bomb.glb at its 0.34 m game size)
const PB_DISPLAY = { y: -0.017, z: 0.176, w: 0.074, h: 0.045 };
function createPumpkinBombGLB(kind, countdown = false) {
  const M = PUMPKIN_MODELS[kind] || PUMPKIN_MODELS.normal;
  const root = new THREE.Group(); root.name = `pumpkin-bomb-${kind}`;
  const mat = M.material.clone(); // per bomb: its own glow level (textures + shader program are shared)
  const body = new THREE.Mesh(M.geometry, mat);
  const hull = new THREE.Mesh(M.geometry, PB_HULL_MATS[1]); hull.visible = false; // highlight outline only when targeted (1 draw call otherwise)
  root.add(body, hull);
  // live countdown (story roof bomb / catch-and-return bomb): drawn over the model's own timer display
  let screen = null, ctx = null, tex = null, lastText = '';
  if (countdown && typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = 128; c.height = 72; ctx = c.getContext('2d');
    tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    screen = new THREE.Mesh(new THREE.PlaneGeometry(PB_DISPLAY.w, PB_DISPLAY.h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    screen.position.set(0, PB_DISPLAY.y, PB_DISPLAY.z); root.add(screen);
  }
  const draw = (txt) => {
    if (!ctx || txt === lastText) return; lastText = txt;
    ctx.fillStyle = '#1a0d05'; ctx.fillRect(0, 0, 128, 72);
    ctx.font = 'bold 46px "Courier New", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,190,60,0.12)'; ctx.fillText('88:88', 64, 38);
    ctx.fillStyle = '#ffc23a'; ctx.shadowColor = '#ff9a20'; ctx.shadowBlur = 10; ctx.fillText(txt, 64, 38); ctx.shadowBlur = 0;
    tex.needsUpdate = true;
  };
  let time = Math.random() * 2, glowV = 0.5, cd = null;
  const api = {
    root, radius: PB_R, kind,
    update(dt) {
      time += dt; const fast = cd !== null && cd < 1.5;
      const pulse = fast ? 0.75 + 0.25 * Math.sin(time * 28) : 0.9 + 0.1 * Math.sin(time * 9);
      mat.emissiveIntensity = (0.5 + glowV * 1.6) * pulse;
    },
    setGlow(v) { glowV = THREE.MathUtils.clamp(v, 0, 1); },
    setCountdown(sec) {
      cd = sec ?? null; if (!screen) return;
      screen.visible = cd !== null; if (!screen.visible) return;
      const v = Math.max(0, cd), w = Math.floor(v), c2 = Math.floor((v - w) * 100);
      draw(`${String(Math.min(w, 99)).padStart(2, '0')}:${String(c2).padStart(2, '0')}`);
    },
    setHighlight(level) { const l = THREE.MathUtils.clamp(level | 0, 0, 2); hull.visible = l > 0; if (l > 0) hull.material = PB_HULL_MATS[l]; },
  };
  if (screen) api.setCountdown(1); else api.setCountdown(null);
  api.update(0);
  return api;
}

export function createPumpkinBomb({ countdown = false, model = null } = {}) {
  if (PUMPKIN_MODELS && (model || countdown)) return createPumpkinBombGLB(model || 'normal', countdown); // GLB whenever loaded (arcade, story roof bomb, story bombs)
  const root = new THREE.Group(); root.name = 'pumpkin-bomb';
  const shell = new THREE.Mesh(PB_SHELL_GEO, PB_SHELL_MAT);
  const coreMat = glow(PALETTE.amber).clone();
  const core = new THREE.Mesh(PB_CORE_GEO, coreMat);
  const hull = new THREE.Mesh(PB_HULL_GEO, PB_HULL_MATS[0]);
  const cap = new THREE.Mesh(PB_CAP_GEO, MAT.gunmetal);
  const capB = new THREE.Mesh(PB_CAP_BLACK_GEO, MAT.black);
  const led = new THREE.Mesh(PB_LED_GEO, PB_LED_MAT);
  led.position.set(0.0115, PB_R * PB_SQUASH + 0.082, 0);
  root.add(shell, core, hull, cap, capB, led);

  let screen = null, ctx = null, tex = null, lastText = '';
  if (countdown && typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = 128; c.height = 56;
    ctx = c.getContext('2d');
    tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    screen = new THREE.Group();
    const box = new THREE.Mesh(PB_SCREEN_BOX, MAT.black);
    const face = new THREE.Mesh(PB_SCREEN_GEO, new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    face.position.z = 0.0155;
    screen.add(box, face);
    screen.position.set(0, 0.0, PB_R * 0.98);
    root.add(screen);
  }

  function drawText(txt) {
    if (!ctx || txt === lastText) return;
    lastText = txt;
    ctx.fillStyle = '#120202'; ctx.fillRect(0, 0, 128, 56);
    ctx.font = 'bold 44px "Courier New", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,40,40,0.12)'; ctx.fillText('88:88', 64, 30);
    ctx.fillStyle = '#ff2a2a'; ctx.shadowColor = '#ff2a2a'; ctx.shadowBlur = 8;
    ctx.fillText(txt, 64, 30);
    ctx.shadowBlur = 0;
    tex.needsUpdate = true;
  }

  let time = Math.random() * 2, glowV = 0.5, countdownV = null;
  const baseCore = new THREE.Color(PALETTE.amber);

  const api = {
    root,
    radius: PB_R,
    update(dt) {
      time += dt;
      const period = countdownV !== null && countdownV < 1.5 ? 0.18 : 0.6;
      led.visible = (time % period) < period * 0.35;
      const pulse = 0.92 + 0.08 * Math.sin(time * 9);
      coreMat.color.copy(baseCore).multiplyScalar((0.45 + glowV * 1.25) * pulse);
    },
    setGlow(v) { glowV = THREE.MathUtils.clamp(v, 0, 1); },
    setCountdown(sec) {
      countdownV = sec;
      if (!screen) return;
      screen.visible = sec !== null && sec !== undefined;
      if (!screen.visible) return;
      const s = Math.max(0, sec);
      const whole = Math.floor(s), cs = Math.floor((s - whole) * 100);
      drawText(`${String(Math.min(whole, 99)).padStart(2, '0')}:${String(cs).padStart(2, '0')}`);
    },
    setHighlight(level) { hull.material = PB_HULL_MATS[THREE.MathUtils.clamp(level | 0, 0, 2)]; },
  };
  if (screen) api.setCountdown(1); else api.setCountdown(null);
  api.update(0);
  return api;
}

// ========================================================= LIGHT BOMB
const LB_CORE_GEO = new THREE.IcosahedronGeometry(0.058, 0);
const LB_INNER_GEO = new THREE.IcosahedronGeometry(0.036, 0);
function ringGeo(r, notches, tilt) {
  const b = new PartBuilder();
  b.add(new THREE.TorusGeometry(r, 0.0035, 4, 48), MAT.cyanLED);
  for (let i = 0; i < notches; i++) {
    const a = (i / notches) * Math.PI * 2;
    b.add(GEO.box, MAT.cyanLED, [Math.cos(a) * r, Math.sin(a) * r, 0], [0, 0, a], [0.006, 0.014, 0.006 + (i % 4 === 0 ? 0.008 : 0)]);
  }
  const g = b.geometryFor(MAT.cyanLED);
  g.rotateX(tilt);
  return g;
}
const LB_RING1 = ringGeo(0.088, 16, Math.PI / 2);
const LB_RING2 = ringGeo(0.102, 12, 0.35);
const LB_RING_MAT_2 = glow(0x7fe9ff);
const LB_GLOW_TEX = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(160,220,255,0.8)');
  gr.addColorStop(0.6, 'rgba(40,110,255,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();

/** createLightBomb() – origin at centre, ≈0.2 m. */
export function createLightBomb() {
  const root = new THREE.Group(); root.name = 'light-bomb';
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xe8fbff, emissive: PALETTE.cyan, emissiveIntensity: 0.7, metalness: 0.1, roughness: 0.15, flatShading: true,
  });
  const core = new THREE.Mesh(LB_CORE_GEO, coreMat);
  const inner = new THREE.Mesh(LB_INNER_GEO, glow(0xffffff));
  const r1 = new THREE.Mesh(LB_RING1, MAT.cyanLED);
  const r2 = new THREE.Mesh(LB_RING2, LB_RING_MAT_2);
  const spriteMat = new THREE.SpriteMaterial({
    map: LB_GLOW_TEX, color: PALETTE.deepBlue, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false,
  });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.renderOrder = 10;
  root.add(sprite, core, inner, r1, r2);
  let charge = 1, time = 0;
  const api = {
    root, radius: 0.1,
    update(dt) {
      time += dt;
      core.rotation.y += dt * 0.8; core.rotation.x += dt * 0.5;
      inner.rotation.y -= dt * 1.7;
      r1.rotation.y += dt * 2.2;
      r2.rotation.y -= dt * 1.6;
      r2.rotation.z = Math.sin(time * 0.7) * 0.3;
      const p = 1 + Math.sin(time * 8) * 0.06;
      sprite.scale.setScalar((0.22 + charge * 0.35) * p);
      coreMat.emissiveIntensity = 0.4 + charge * 0.9;
    },
    setCharge(v) {
      charge = THREE.MathUtils.clamp(v, 0, 1);
      const s = 0.6 + charge * 0.4;
      r1.scale.setScalar(s); r2.scale.setScalar(s);
    },
  };
  api.update(0);
  return api;
}
