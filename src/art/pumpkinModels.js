// Pumpkin bombs from the user-provided Tripo GLBs (public/models/pumpkin_bomb.glb, giant_pumpkin_bomb.glb —
// optimised copies; textures 1024 / 512 webp, positions quantised, see docs/ASSETS.md):
//   'normal' – the regular tech pumpkin bomb (timer display on its front)   ≈ 4.7k triangles
//   'giant'  – the heavy bomb (snarling carved face)                         ≈ 9.7k triangles
// Each bomb is ONE mesh (+ the shared highlight hull) — 2 draw calls instead of the old 6.
// The glowing seams / timer / carved face get an emissive mask extracted from the base colour.
import * as THREE from 'three';
import { loadBakedGLB } from './autorig.js';
import { setPumpkinModels } from './enemies.js';
import { reflectionEnv } from './city.js';

const DIAMETER = 0.34; // ≈ the procedural bomb (2 × 0.16 m + rim) → same hit zones and spacing

/** Emissive mask: keep the warm, bright pixels (glowing seams, timer digits, lit face), black elsewhere. */
function emissiveMask(map) {
  const img = map?.image; if (!img || typeof document === 'undefined') return null;
  const S = 512, c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, S, S);
  const d = g.getImageData(0, 0, S, S), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i] / 255, gg = p[i + 1] / 255, b = p[i + 2] / 255;
    const glow = gg > 0.55 && r > 0.75 && b < 0.55 && gg > r * 0.62 ? Math.min(1, (gg - 0.5) * 2.4) : 0; // yellow-ish highlights only
    p[i] = 255 * glow; p[i + 1] = 200 * glow; p[i + 2] = 90 * glow; p[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.flipY = map.flipY; t.channel = map.channel;
  return t;
}

async function load(path) {
  const m = await loadBakedGLB(path, { width: DIAMETER, center: 'xyz' });
  const mat = m.material;
  mat.envMap = reflectionEnv(); mat.envMapIntensity = 0.45;
  mat.metalness = Math.min(mat.metalness ?? 1, 0.5);
  const em = emissiveMask(mat.map);
  if (em) { mat.emissiveMap = em; mat.emissive = new THREE.Color(1, 1, 1); mat.emissiveIntensity = 1.4; }
  mat.name = path.split('/').pop().replace('.glb', '');
  m.geometry.computeBoundingSphere();
  return { geometry: m.geometry, material: mat, radius: m.geometry.boundingSphere.radius };
}

export async function loadPumpkinModels() {
  const [normal, giant] = await Promise.all([load('models/pumpkin_bomb.glb'), load('models/giant_pumpkin_bomb.glb')]);
  setPumpkinModels({ normal, giant });
  return { normal, giant };
}
