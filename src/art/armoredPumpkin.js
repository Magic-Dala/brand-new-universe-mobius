// v0.48 armored pumpkin (Arcade): four stages SWAPPED, never shown together (docs/goals/v048-armored-pumpkin-decision.md).
// public/models/armored_pumpkin.glb: nodes stage_0 … stage_<hits>, plain glTF with EXT_texture_webp (a plain GLTFLoader
// reads it), front +Z, each mesh 1.0 wide with its origin at the centre of the body, double-sided on purpose, green
// emissive map already in the file. One stage visible = one draw call.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ARMORED } from '../game/armored.js';

/** Tunables to settle on the headset (the decision file's proposals). */
export const ARMORED_LOOK = { diameter: 1.95, /* 2026-11-15: three times the first size (0.65 m), on the designer's word */ stageScale: [1.0, 0.88, 0.76, 0.64], emissive: 1.4, url: 'models/armored_pumpkin.glb',
  burst: [0x4dff6a, 0xffa020, 0xb9b2a8] }; // the burst when layer 0 / 1 / 2 breaks: green-black armor, orange rind, charcoal flakes
let template = null;

/** Load the model once. Throws if a stage is missing (the caller then uses the stand-in). */
export async function loadArmoredPumpkin(url = ARMORED_LOOK.url) {
  const gltf = await new GLTFLoader().loadAsync(url), stages = [];
  for (let i = 0; i <= ARMORED.hits; i++) { // the stage count comes from ARMORED.hits, never a fixed number
    const n = gltf.scene.getObjectByName(`stage_${i}`); if (!n) throw new Error(`armored_pumpkin.glb: stage_${i} is missing`);
    n.traverse((o) => { if (o.isMesh) { o.material.emissiveIntensity = ARMORED_LOOK.emissive; o.frustumCulled = false; } });
    stages.push(n);
  }
  template = stages; return true;
}
export const armoredModelReady = () => !!template;

/**
 * One armored pumpkin. standIn(): an Object3D to use when the model did not load (the giant pumpkin bomb): the same
 * four stages by size only. Returns { root, real, stage, setStage(n), size(n) }.
 */
export function createArmoredPumpkin(standIn = null) {
  const root = new THREE.Group(); root.name = 'armoredPumpkin';
  const stages = [], L = ARMORED_LOOK, n = ARMORED.hits + 1, real = !!template;
  for (let i = 0; i < n; i++) {
    const s = real ? template[i].clone(true) : (i === 0 && standIn ? standIn() : null);
    if (real) { s.position.set(0, 0, 0); s.rotation.set(0, 0, 0); s.scale.setScalar(L.diameter * (L.stageScale[i] ?? L.stageScale.at(-1))); root.add(s); }
    else if (s) root.add(s);
    stages.push(s);
  }
  const api = {
    root, real, stage: 0,
    size: (i) => L.diameter * (L.stageScale[i] ?? L.stageScale.at(-1)),
    setStage(i) {
      api.stage = Math.max(0, Math.min(n - 1, i));
      if (real) stages.forEach((s, k) => { s.visible = k === api.stage; });
      else if (stages[0]) stages[0].scale.setScalar((L.stageScale[api.stage] ?? 1) * 0.45); // stand-in: the same model, smaller per layer
    },
    /** lead-in: every stage visible at once so all four materials compile before play */
    showAll(on) { if (real) stages.forEach((s, k) => { s.visible = on || k === api.stage; }); },
  };
  api.setStage(0);
  return api;
}
