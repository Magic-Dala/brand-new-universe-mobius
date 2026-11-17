// v0.25 city quality upgrade — switches + shared art resources (renderer only; never imported by src/data).
//
// cityQ 'v1' = new look, 'v0' = the original v0.24 look (bit-for-bit the old shader paths). Each v1 feature can be
// turned off on its own (settings.cityQOff = ['win', ...]) for A/B comparisons. URL overrides (not saved):
//   ?cq=0 | ?cq=1      original / new
//   ?cqoff=win,ground  turn single features off
// Features (stage 1):
//   win    stable lit-window groups (per building / floor, 2–4 windows), screen-size fade (no far shimmer)
//   ground anti-aliased street markings + curbs, mip-filtered low-frequency asphalt / paving, gutters, manholes,
//          drains; coordinates relative to the city grid (identical before / after an origin rebase)
//   var    low-frequency colour variation, rain streaks, stains, street-level grime on the facades + roofs
//   ao     baked-style contact AO: wall bases, setbacks, under cornices, vertical edges, canyon sky occlusion
//   shade  softer, uneven canyon shadow line; facing-based warm / cool ambient
//   tex    facade texture redrawn without the tiny high-contrast speckles (less sparkle at a distance)
// Stage 2 (v0.26):
//   ledge  real sill courses (one thin stone strip per floor) + a belt over the shop fronts on street faces of
//          masonry buildings within ledgeRange (70 m, +30 m hysteresis), with a soft shadow line under each strip
// Stage 2 / 3 (v0.27, src/art/cityArt.js):
//   ledge    + limestone pilasters        awning  shop awnings (texture colours)   curb  raised sidewalks + curb face
//   props    corner kits (signal poles + heads with phases, hydrant, trash can, news box)
//   signs    blade signs (one atlas, original names)   cars  parked cars   traffic  a few moving cars (N–S streets)
//   trees    clustered low-poly canopy   skyline  redrawn far silhouette   lampglow  warm light pools under street lamps
//   feaa     fire escapes: footprint-based coverage + alpha-to-coverage (4× MSAA) instead of a hard discard
//   farring  far backdrop ring 430–650 m (one box per building ≥ 32 m): no empty ground band when seen from high up
// All variation is derived on the GPU from values the buildings already have (seed, size, face metres) or from
// the fixed noise texture below — no new random draws anywhere, so routes / buildings / anchors / coins cannot move.
import * as THREE from 'three';
import { settings } from '../core/settings.js';

// v0.30 (src/art/cityKit.js, cityMaterials.js, cityLife.js, sky.js):
//   kit       modular building kit (tools/blender/build_city_kit.py → public/models/city_kit.glb): window bays, piers,
//             cornices, crowns, storefronts, fire escapes, roof props; LOD0 / LOD1 with dithered cross-fades
//   pbr       CC0 PBR detail (brick / limestone / concrete / asphalt / metal / paving arrays)
//   interior  interior-mapped windows (room atlas, curtains / blinds)   refl  sunset sky reflections (baked cube)
//   nshadow   analytic neighbour shadows (height field)                 rim   rim / top-edge light + warm street bounce
//   fog2      layered fog (height + distance, sun in-scattering)         fxlight  VFX light pulses on the city
//   shafts    light-shaft cards at street ends facing the sun            hero  3 landmark towers on the skyline
//   clouds    lit cloud layers + sun glow (sky)                          birds  flocks + distant aircraft
//   steam     manhole steam                                              neon  slow neon flicker on blade signs
//   traffic2  denser traffic with light trails
export const CITY_Q_FEATURES = ['win', 'ground', 'var', 'ao', 'shade', 'tex', 'ledge', 'awning', 'curb', 'props', 'signs', 'cars', 'traffic', 'trees', 'skyline', 'lampglow', 'farring', 'feaa',
  'kit', 'pbr', 'interior', 'refl', 'nshadow', 'rim', 'fog2', 'fxlight', 'shafts', 'hero', 'clouds', 'birds', 'steam', 'neon', 'traffic2'];

function urlOverrides() {
  try {
    const u = new URLSearchParams(location.search);
    return { cq: u.get('cq'), off: u.get('cqoff') ? u.get('cqoff').split(',').map((s) => s.trim()) : null };
  } catch { return { cq: null, off: null }; }
}
const URL_Q = typeof location !== 'undefined' ? urlOverrides() : { cq: null, off: null };

// v0.30: features that ship OFF until they meet every budget (turn on: ?cqon=kit, or settings.cityQOn = ['kit']).
// kit: its streaming still exceeds the route spike budget on the desktop bench (see docs/goals/v030-log.md).
export const CITY_Q_DEFAULT_OFF = []; // (kit back ON by default: v0.30b, user to verify on Quest)
const URL_ON = (() => { try { const v = new URLSearchParams(location.search).get('cqon'); return v ? v.split(',').map((x) => x.trim()) : null; } catch { return null; } })();

/** Effective switches: { level: 'v0'|'v1', win, ground, var, ao, shade, tex }. */
export function cityQualityFlags(override = {}) {
  let level = override.level || (URL_Q.cq === '0' ? 'v0' : URL_Q.cq === '1' ? 'v1' : settings.cityQ || 'v1');
  if (level !== 'v0') level = 'v1';
  const on = new Set(override.on || URL_ON || settings.cityQOn || []);
  const off = new Set([...(override.off || URL_Q.off || settings.cityQOff || []), ...CITY_Q_DEFAULT_OFF.filter((k) => !on.has(k))]);
  const f = { level };
  for (const k of CITY_Q_FEATURES) f[k] = level === 'v1' && !off.has(k);
  return f;
}

// ---------------------------------------------------------------------------- noise texture (fixed, tileable)
// 256² RGBA8, repeat-wrapped, mipmapped (≈ 0.33 MiB with mips). Deterministic: own integer hash, no Math.random,
// no shared RNG. R: broad fBm, G: second fBm (streaks when stretched), B: blotches, A: finer grain.
let _noise = null;
function hash2(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function valueNoise(x, y, period, seed) { // tileable value noise, smooth (quintic)
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const P = (a) => ((a % period) + period) % period;
  const v00 = hash2(P(xi), P(yi), seed), v10 = hash2(P(xi + 1), P(yi), seed), v01 = hash2(P(xi), P(yi + 1), seed), v11 = hash2(P(xi + 1), P(yi + 1), seed);
  const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10), sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  return (v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy;
}
function fbm(u, v, base, oct, seed) { let a = 0, w = 0.5, s = 0; for (let o = 0; o < oct; o++) { const p = base << o; a += w * valueNoise(u * p, v * p, p, seed + o * 31); s += w; w *= 0.5; } return a / s; }
export function cityNoiseTexture() {
  if (_noise) return _noise;
  const N = 256, data = new Uint8Array(N * N * 4);
  const stretch = (x) => Math.max(0, Math.min(255, Math.round(((x - 0.5) * 1.7 + 0.5) * 255)));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, i = (y * N + x) * 4;
    data[i] = stretch(fbm(u, v, 4, 4, 11));
    data[i + 1] = stretch(fbm(u, v, 8, 3, 57));
    data[i + 2] = stretch(fbm(u, v, 6, 4, 93));
    data[i + 3] = stretch(fbm(u, v, 32, 2, 131));
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
  t.colorSpace = THREE.NoColorSpace; t.name = 'city-noise'; t.needsUpdate = true;
  return (_noise = t);
}
