// Green Maniac (綠狂魔) and Green Bat Jet (綠魔飛行器) from the user-provided Tripo GLBs
// (public/models/green_maniac.glb, green_bat_jet.glb — optimised, see docs/ASSETS.md).
// v2 models (2026-10): Green Maniac comes RIGGED (its skin weights are remapped onto our bone set, see
// rigManiac below); the jet is static and auto-skinned to a body + two wing bones. Both plug into the
// existing enemy API in enemies.js (setBossModels) → the Boss code is unchanged.
import * as THREE from 'three';
import { loadBakedGLB, autoSkin, remapSkin } from './autorig.js';
import { setBossModels } from './enemies.js';
import { reflectionEnv } from './city.js';
import { loadGreenManiacAnimated } from './greenManiacAnimated.js';

const GM_H = 1.9; // metres (same as the procedural Green Maniac)
const JET_SPAN = 5.5; // wingspan (same as the procedural jet)

// Tripo PBR maps read as wet chrome and too dark at dusk (high metal + near-mirror roughness reflecting a
// dark purple env). Armour look instead: less metal, roughness map remapped to a satin floor, a little
// self-illumination from the base colour so the silhouette stays readable against the sky. All in the
// material (no extra lights / passes). Tunable: BOSS_LOOK.
export const BOSS_LOOK = { metal: 0.3, roughFloor: 0.6, env: 1.2, selfLit: 0.32 };
function armor(mat, metal = BOSS_LOOK.metal) {
  mat.envMap = reflectionEnv(); mat.envMapIntensity = BOSS_LOOK.env;
  mat.metalness = metal; mat.roughness = 1;
  if (mat.roughnessMap) {
    const floor = BOSS_LOOK.roughFloor.toFixed(3);
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>',
        THREE.ShaderChunk.roughnessmap_fragment.replace('roughnessFactor *= texelRoughness.g;', `roughnessFactor *= mix(${floor}, 1.0, texelRoughness.g);`));
    };
    mat.customProgramCacheKey = () => `boss-armor-${floor}`;
  }
  if (mat.map && BOSS_LOOK.selfLit > 0) { mat.emissiveMap = mat.map; mat.emissive = new THREE.Color(1, 1, 1); mat.emissiveIntensity = BOSS_LOOK.selfLit; }
  return mat;
}

export async function loadBossModels() {
  // v3 (2026-10): Green Maniac = green_maniac_mixamo_tail.glb (Mixamo rig + tail bones + wait / surf / throw / turn
  // clips, see greenManiacAnimated.js). The v2 path (green_maniac.glb + rigManiac) is kept below but unused.
  const [gmA, jet] = await Promise.all([
    loadGreenManiacAnimated('models/green_maniac_mixamo_tail.glb'),
    loadBakedGLB('models/green_bat_jet.glb', { rotate: new THREE.Matrix4().makeRotationY(Math.PI), width: JET_SPAN, center: 'xyz' }),
  ]);
  armor(gmA.material); gmA.material.name = 'green-maniac';
  const maniac = { animated: gmA };

  // ---------------- Bat Jet: nose −Z, top +Y; body + wing bones
  armor(jet.material, 0.4); jet.material.name = 'green-bat-jet';
  const P = jet.geometry.attributes.position, v = new THREE.Vector3();
  let topY = -1e9, zMax = -1e9;
  for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i); if (Math.abs(v.x) < 0.3 && Math.abs(v.z - 0.35) < 0.35) topY = Math.max(topY, v.y); if (Math.abs(v.x) < 0.5 && Math.abs(v.y + 0.34) < 0.2) zMax = Math.max(zMax, v.z); }
  const jb = [
    { name: 'core', parent: null, a: [0, 0, 2.0], b: [0, 0, -2.2], r: 0.5 },
    { name: 'wingL', parent: 'core', a: [-0.55, 0, 0.2], b: [-JET_SPAN / 2, 0, 0.6], r: 0.1, side: -1 },
    { name: 'wingR', parent: 'core', a: [0.55, 0, 0.2], b: [JET_SPAN / 2, 0, 0.6], r: 0.1, side: 1 },
  ];
  DEF.jb = jb;
  let jetFirst = autoSkin(jet.geometry, jet.material, jb);
  // twin engines under the hull (measured on the v2 model: x ±0.33, y −0.34, exhaust face z ≈ 1.05 m)
  const jetM = { topY: topY + 0.01, standZ: 0.35, nozzleX: 0.33, nozzleY: -0.34, nozzleZ: Math.min(zMax, 1.07), rig: { instance: () => { const r = jetFirst || autoSkin(jet.geometry, jet.material, jb); jetFirst = null; return r; } } };
  const models = { maniac, jet: jetM };
  setBossModels(models);
  return models;
}

// ---------------- Green Maniac v2 (Green_Maniac_3d_model_2k_rigged.glb): the file has a full UE-style
// skeleton (pelvis / spine_01-03 / clavicle / upperarm / lowerarm / hand + fingers / thigh / calf / foot / ball).
// Its skin WEIGHTS are kept and summed onto our small bone set, so every existing pose (stand, ride, throw,
// hurt, fall) drives it unchanged; bone positions come from the file's bind pose. No tail bone in the source
// rig → the tail is blended onto a 'tail' bone (gentle sway, as before).
const DEF = { gm: null, jb: null }; // SD rig definitions, reused so the HD meshes bind to the SAME bones

/**
 * Arcade / factory HD set (green_maniac_hd.glb 190k tris, green_bat_jet_hd.glb 91k tris; 2048 colour + normal maps).
 * Returns { maniac: {geometry, material}, jet: {geometry, material} } skinned to the same bone lists as the
 * SD models → Boss.setDetail('hd') just swaps geometry + material on the live skinned meshes.
 */
export async function loadBossModelsHD() {
  if (!DEF.jb) throw new Error('load the SD boss models first');
  if (!DEF.gm) { // v3 Mixamo Green Maniac: one model for every distance (21k tris) → only the jet has an HD swap
    const jet = await loadBakedGLB('models/green_bat_jet_hd.glb', { rotate: new THREE.Matrix4().makeRotationY(Math.PI), width: JET_SPAN, center: 'xyz' });
    armor(jet.material, 0.4); jet.material.name = 'green-bat-jet-hd';
    const jetR = autoSkin(jet.geometry, jet.material, DEF.jb); jet.geometry.dispose();
    return { jet: { geometry: jetR.mesh.geometry, material: jet.material } };
  }
  const [gm, jet] = await Promise.all([
    loadBakedGLB('models/green_maniac_hd.glb', { height: GM_H, center: '' }),
    loadBakedGLB('models/green_bat_jet_hd.glb', { rotate: new THREE.Matrix4().makeRotationY(Math.PI), width: JET_SPAN, center: 'xyz' }),
  ]);
  const sh = DEF.gm.shift; gm.geometry.translate(sh.x, 0, sh.z);
  armor(gm.material); gm.material.name = 'green-maniac-hd';
  armor(jet.material, 0.4); jet.material.name = 'green-bat-jet-hd';
  const gmR = remapSkin(gm.geometry, gm.material, DEF.gm.bones, gm.joints.map((j) => j.name), mapJoint, { blend: DEF.gm.blend });
  const jetR = autoSkin(jet.geometry, jet.material, DEF.jb);
  gm.geometry.dispose(); jet.geometry.dispose(); // the skinned copies are kept
  return { maniac: { geometry: gmR.mesh.geometry, material: gm.material }, jet: { geometry: jetR.mesh.geometry, material: jet.material } };
}

const JOINT_MAP = [
  [/^(root|ik_|socket|pelvis)/, 'hips'], [/^spine_01/, 'spine'], [/^(spine_0[23]|clavicle)/, 'chest'],
  [/^neck/, 'neck'], [/^head/i, 'head'],
  [/^upperarm_(l|r)/, 'upper'], [/^lowerarm_(l|r)/, 'fore'], [/^(hand|index|middle|ring|pinky|thumb).*_(l|r)$/, 'hand'],
  [/^thigh_(l|r)/, 'thigh'], [/^calf_(l|r)/, 'shin'], [/^(foot|ball).*_(l|r)$/, 'foot'],
];
function mapJoint(name) {
  for (const [re, bone] of JOINT_MAP) if (re.test(name)) {
    if (['hips', 'spine', 'chest', 'neck', 'head'].includes(bone)) return bone;
    return bone + (/_l$/.test(name) ? 'L' : 'R');
  }
  return 'hips';
}
function rigManiac(gm) {
  const jp = Object.fromEntries(gm.joints.map((j) => [j.name, j.pos.clone()]));
  const pel = jp.pelvis;
  const sh = new THREE.Vector3(-pel.x, 0, -pel.z); // pelvis over the origin (the tail makes the bbox lopsided)
  gm.geometry.translate(sh.x, 0, sh.z); for (const k in jp) jp[k].add(sh);
  armor(gm.material); gm.material.name = 'green-maniac';
  const A = (n) => jp[n].toArray();
  const headTop = jp.Head.clone().add(new THREE.Vector3(0, 0.17, 0.02));
  const bones = [
    { name: 'hips', parent: null, a: A('pelvis'), b: A('spine_01') },
    { name: 'spine', parent: 'hips', a: A('spine_01'), b: A('spine_02') },
    { name: 'chest', parent: 'spine', a: A('spine_02'), b: A('neck_01') },
    { name: 'neck', parent: 'chest', a: A('neck_01'), b: A('Head') },
    { name: 'head', parent: 'neck', a: A('Head'), b: headTop.toArray() },
    { name: 'tail', parent: 'hips', a: [0, jp.pelvis.y - 0.05, jp.pelvis.z - 0.2], b: [0, 0.15, jp.pelvis.z - 0.5] },
  ];
  for (const [K, s] of [['L', 'l'], ['R', 'r']]) bones.push(
    { name: `upper${K}`, parent: 'chest', a: A(`upperarm_${s}`), b: A(`lowerarm_${s}`) },
    { name: `fore${K}`, parent: `upper${K}`, a: A(`lowerarm_${s}`), b: A(`hand_${s}`) },
    { name: `hand${K}`, parent: `fore${K}`, a: A(`hand_${s}`), b: A(`middle_04_leaf_${s}`) },
    { name: `thigh${K}`, parent: 'hips', a: A(`thigh_${s}`), b: A(`calf_${s}`) },
    { name: `shin${K}`, parent: `thigh${K}`, a: A(`calf_${s}`), b: A(`foot_${s}`) },
    { name: `foot${K}`, parent: `shin${K}`, a: A(`foot_${s}`), b: A(`ball_leaf_${s}`) },
  );
  // tail: behind the hips / legs (z well behind the pelvis); fades in over 12 cm so the seat doesn't tear
  const z0 = jp.pelvis.z - 0.22, hipY = jp.pelvis.y + 0.05;
  const blend = (p) => (p.y < hipY ? ['tail', THREE.MathUtils.smoothstep(z0 - p.z, 0, 0.12)] : null);
  const names = gm.joints.map((j) => j.name);
  const ang = (a, b) => Math.atan2(Math.abs(jp[b].x - jp[a].x), Math.abs(jp[b].y - jp[a].y));
  const hr = jp.hand_r, tip = jp.middle_04_leaf_r;
  const J = {
    armOut: (ang('upperarm_l', 'hand_l') + ang('upperarm_r', 'hand_r')) / 2,
    legOut: (ang('thigh_l', 'foot_l') + ang('thigh_r', 'foot_r')) / 2,
    handTip: tip.clone().sub(hr).multiplyScalar(0.6), // a bit inside the claw tips (× 0.6 again at use)
  };
  DEF.gm = { bones, blend, shift: sh };
  let first = remapSkin(gm.geometry, gm.material, bones, names, mapJoint, { blend });
  return { J, rig: { instance: () => { const r = first || remapSkin(gm.geometry, gm.material, bones, names, mapJoint, { blend }); first = null; return r; } } };
}
