// Dala City / 達拉城 renderer (v0.20) — the modular NYC-style city from src/data/cityWorld.js.
//
// Draw calls (independent of the city size):
//  - buildings: ONE InstancedMesh per active cell (object pool; frustum-culled per cell). All facades
//    share one shader + one texture array (red / brown / cream brick, limestone, glass, dark glass,
//    industrial, storefront, roof): windows, lit rooms, storefronts, cornices, warm low sun above the
//    street-canyon shadow line and cool blue shade below it, fog.
//  - details near the player only (≤ detailRange): water towers, roof boxes, fire escapes, street lamps
//    (+ heads), trees, anchor brackets (+ LEDs), masts — one global instanced pool each.
//  - backdrop: one InstancedMesh with the SAME silhouettes as the cells around the active area.
//  - ground (street grid shader, follows the player), distant skyline band, home tower A (window hole),
//    the factory exterior (when its module is active).
// Cell visuals are filled time-sliced (≤ buildBudgetMs per frame); recycled cells return their pool
// slots; shared geometry / materials / textures are never freed by a single cell.
import * as THREE from 'three';
import { CITY_CFG } from '../data/cityConfig.js';
import { STYLE, HOME_LOCAL } from '../data/blocks.js';
import { KEY_BUILDINGS, ROOM, FACTORY_EXT } from '../data/layout.js';
import { cityWorld } from '../data/cityWorld.js';
import { toonMaterial, canvasTexture, rng } from './toon.js';
import { Bucket, CYL, CONE } from './geom.js';
import { createFactoryExterior } from './factoryExterior.js';
import { cityQualityFlags, cityNoiseTexture } from './cityQuality.js';
import { createCityArt } from './cityArt.js';
import { FOLIAGE_CUTOFF, streetTreeGeometry, treeLeafTexture } from './treeFoliage.js';
import { SUN_DIRECTION, SUN_COLOR, HEMI_COLORS, setSkyQuality } from './sky.js';
import { CITY_SHARED, CITY_COMMON_GLSL, createHeightField, roomAtlas, loadCityPBR, bakeSkyReflection } from './cityMaterials.js';
import { FX_LIGHT, FX_LIGHT_GLSL } from './fxLight.js';
import { createCityKit } from './cityKit.js';
import { createCityLife } from './cityLife.js';

export const FOG = CITY_CFG.fog;
export function createFog() { return new THREE.Fog(FOG.color, FOG.near, FOG.far); }

// ---------------------------------------------------------------------------- reflection env (glass, armour)
let _env = null;
/** Stylised equirect sunset + skyline used as reflections (armour, pumpkins, glass). */
export function reflectionEnv() {
  if (_env) return _env;
  _env = canvasTexture(512, 256, (ctx, W, Hh) => {
    const r = rng(17);
    const g = ctx.createLinearGradient(0, 0, 0, Hh / 2);
    g.addColorStop(0, '#3a4a80'); g.addColorStop(0.45, '#7a6a9c'); g.addColorStop(0.75, '#e08a7c'); g.addColorStop(0.92, '#f6aa6a'); g.addColorStop(1, '#ffc878');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, Hh / 2);
    ctx.fillStyle = '#4a3a48'; ctx.fillRect(0, Hh / 2, W, Hh / 2);
    for (let k = 0; k < 40; k++) { ctx.fillStyle = `rgba(255,${170 + r() * 60},${140 + r() * 40},0.35)`; const y = Hh * (0.18 + r() * 0.28); ctx.beginPath(); ctx.ellipse(r() * W, y, 30 + r() * 90, 3 + r() * 6, 0, 0, 7); ctx.fill(); }
    for (const [colr, maxH, a] of [['#8a6a82', 35, 0.5], ['#5a4256', 23, 0.7]]) {
      let x = 0;
      while (x < W) { const w = 8 + r() * 14, h = 4 + r() * maxH; ctx.fillStyle = colr; ctx.fillRect(x, Hh / 2 - h, w, h + 2); ctx.fillStyle = `rgba(255,200,120,${a * 0.35})`; ctx.fillRect(x + 1, Hh / 2 - h * 0.8, w - 2, h * 0.6); x += w + r() * 3; }
    }
  });
  _env.mapping = THREE.EquirectangularReflectionMapping;
  return _env;
}

// ---------------------------------------------------------------------------- facade texture array
// layers: 0 red brick, 1 brown brick, 2 cream brick, 3 limestone, 4 glass, 5 dark glass, 6 industrial,
// 7 storefront band, 8 roof. 8 bays × 8 floors per tile (style bay / floor sizes in STYLE_P).
const TEX = 512, LAYERS = 9;
// per style: bay width (m), floor height (m), bays per tile, floors per tile
const STYLE_P = [[3.0, 3.3], [3.0, 3.3], [3.0, 3.3], [3.2, 3.9], [1.6, 3.8], [1.8, 3.8], [4.0, 4.2]];
function drawLayer(layer, ctx, v1 = false) { // v1 (v0.25 'tex'): no tiny high-contrast speckles, softer mortar (less far sparkle)
  const S = TEX, c = S / 8, r = rng(1000 + layer * 77);
  const bricks = (base, dark, light) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, S, S);
    if (v1) ctx.globalAlpha = 0.6;
    for (let y = 0; y < S; y += 3) {
      ctx.fillStyle = dark; ctx.fillRect(0, y, S, 1);
      const off = (y / 3) % 2 ? 0 : 3;
      ctx.fillStyle = 'rgba(40,20,16,0.25)'; for (let x = off; x < S; x += 6) ctx.fillRect(x, y, 1, 3);
    }
    ctx.globalAlpha = 1;
    if (v1) for (let k = 0; k < 2400; k++) { const a = r() < 0.5, x = r() * S, y = r() * S, w = 10 + r() * 18, h = 3 + w * 0.18; if (k % 4 === 0) { ctx.globalAlpha = 0.5; ctx.fillStyle = a ? light : 'rgba(30,14,10,0.14)'; ctx.fillRect(x, y, w, h); } } // same r() sequence length as v0
    else for (let k = 0; k < 2400; k++) { ctx.fillStyle = r() < 0.5 ? light : 'rgba(30,14,10,0.14)'; ctx.fillRect(r() * S, r() * S, 4 + r() * 6, 2); }
    ctx.globalAlpha = 1;
  };
  const window = (x, y, w, h, frame, glassTop, glassBot, mullion = true) => {
    ctx.fillStyle = frame; ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, glassTop); g.addColorStop(1, glassBot);
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    if (mullion) { ctx.fillStyle = frame; ctx.fillRect(x, y + h * 0.48, w, 3); ctx.fillRect(x + w / 2 - 1, y, 2, h); }
  };
  const sill = (x, y, w, col) => { ctx.fillStyle = col; ctx.fillRect(x - 6, y, w + 12, 5); };
  if (layer <= 2) { // NYC brick walk-ups / pre-war apartments
    const pal = [['#8e3e2c', 'rgba(60,24,18,0.55)', 'rgba(190,110,90,0.18)', '#e8dccb', '#c9b9a0'], ['#6e4a36', 'rgba(40,26,18,0.55)', 'rgba(170,130,100,0.18)', '#d9cbb0', '#b8a68c'], ['#c4a27a', 'rgba(110,80,50,0.45)', 'rgba(240,220,190,0.2)', '#2f4a3a', '#efe2c8']][layer];
    bricks(pal[0], pal[1], pal[2]);
    for (let j = 0; j < 8; j++) {
      if (layer === 1 && j % 4 === 3) { ctx.fillStyle = pal[4]; ctx.fillRect(0, j * c + c - 7, S, 5); } // stone string course
      for (let i = 0; i < 8; i++) {
        const x = i * c + 18, y = j * c + 12, w = 28, h = 40;
        ctx.fillStyle = pal[4]; ctx.fillRect(x - 5, y - 8, w + 10, 6); // lintel
        window(x, y, w, h, pal[3], '#46506a', '#2a2e44');
        sill(x, y + h + 3, w, pal[4]);
      }
    }
  } else if (layer === 3) { // limestone: ashlar courses, pilasters, big windows
    ctx.fillStyle = '#cfc2a8'; ctx.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 16) { ctx.fillStyle = 'rgba(90,76,56,0.35)'; ctx.fillRect(0, y, S, 1); for (let x = (y / 16) % 2 ? 0 : 20; x < S; x += 40) ctx.fillRect(x, y, 1, 16); }
    for (let k = 0; k < 2000; k++) { ctx.fillStyle = r() < 0.5 ? 'rgba(255,250,240,0.12)' : 'rgba(80,60,40,0.10)'; const x = r() * S, y = r() * S; if (!v1) ctx.fillRect(x, y, 3, 3); else if (k % 4 === 0) { ctx.globalAlpha = 0.5; ctx.fillRect(x, y, 12, 8); ctx.globalAlpha = 1; } }
    for (let i = 0; i < 8; i += 2) { ctx.fillStyle = 'rgba(255,248,232,0.35)'; ctx.fillRect(i * c, 0, 6, S); ctx.fillStyle = 'rgba(70,58,44,0.3)'; ctx.fillRect(i * c + 6, 0, 2, S); }
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const x = i * c + 12, y = j * c + 10, w = 40, h = 44;
      window(x, y, w, h, '#4a4034', '#5a6a8a', '#2c3450');
      ctx.fillStyle = '#b8a888'; ctx.fillRect(x - 4, y + h + 3, w + 8, 4);
    }
  } else if (layer === 4 || layer === 5) { // curtain walls
    const dark = layer === 5;
    ctx.fillStyle = dark ? '#1e2230' : '#2c4a72'; ctx.fillRect(0, 0, S, S);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const x = i * c, y = j * c, t = r();
      const g = ctx.createLinearGradient(x, y, x + c, y + c);
      if (dark) { g.addColorStop(0, t < 0.3 ? '#4a4a5a' : '#2a2c3a'); g.addColorStop(1, '#181a26'); }
      else { g.addColorStop(0, t < 0.25 ? '#8aa6c8' : '#4a6a96'); g.addColorStop(0.6, '#36577e'); g.addColorStop(1, t < 0.3 ? '#6a7ea8' : '#2c4468'); }
      ctx.fillStyle = g; ctx.fillRect(x + 2, y + 2, c - 4, c - 10);
    }
    ctx.fillStyle = dark ? '#3a3226' : '#c8d0da';
    for (let i = 0; i <= 8; i++) ctx.fillRect(i * c - 2, 0, 4, S);
    for (let j = 0; j < 8; j++) ctx.fillRect(0, j * c + c - 9, S, 8);
  } else if (layer === 6) { // industrial brick with steel factory windows
    bricks('#5a3a40', 'rgba(30,14,20,0.5)', 'rgba(150,90,100,0.16)');
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const x = i * c + 8, y = j * c + 10, w = 48, h = 40;
      ctx.fillStyle = '#2a262c'; ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
      ctx.fillStyle = '#3c4256'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#2a262c'; for (let k = 1; k < 4; k++) ctx.fillRect(x + k * w / 4 - 1, y, 2, h); for (let k = 1; k < 3; k++) ctx.fillRect(x, y + k * h / 3 - 1, w, 2);
    }
  } else if (layer === 7) { // storefront band (ground floor): 4 shops per tile
    ctx.fillStyle = '#3a2e2a'; ctx.fillRect(0, 0, S, S);
    const awn = ['#2e6a4a', '#8a2a2a', '#2a3e7a', '#a8742a', '#5a2a6a', '#2a6a72', '#7a4a2a', '#3a3a3a'];
    for (let k = 0; k < 4; k++) {
      const x = k * 128;
      ctx.fillStyle = '#5a4a40'; ctx.fillRect(x, 0, 128, S);
      ctx.fillStyle = '#2a2220'; ctx.fillRect(x + 4, 0, 6, S); // pier
      const g = ctx.createLinearGradient(0, 150, 0, 480); g.addColorStop(0, '#4a5068'); g.addColorStop(1, '#262a3a');
      ctx.fillStyle = g; ctx.fillRect(x + 14, 150, 80, 330); // shop window
      ctx.fillStyle = '#1e1a18'; ctx.fillRect(x + 98, 200, 24, 312); // door
      ctx.fillStyle = awn[(k + layer) % awn.length]; ctx.fillRect(x + 8, 60, 116, 70); // awning / sign band
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; for (let s = 0; s < 116; s += 16) ctx.fillRect(x + 8 + s, 60, 8, 70);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x + 8, 128, 116, 6);
    }
    ctx.fillStyle = '#8a7a66'; ctx.fillRect(0, 0, S, 20); // fascia
  } else { // roof: tar / gravel
    ctx.fillStyle = '#5c5658'; ctx.fillRect(0, 0, S, S);
    for (let k = 0; k < 9000; k++) { ctx.fillStyle = `rgba(${r() < 0.5 ? '230,220,210' : '20,16,18'},0.10)`; const x = r() * S, y = r() * S; if (!v1) ctx.fillRect(x, y, 2, 2); else if (k % 6 === 0) { ctx.globalAlpha = 0.45; ctx.fillRect(x, y, 6 + (k % 5), 5); ctx.globalAlpha = 1; } }
    ctx.fillStyle = 'rgba(30,26,28,0.35)'; for (let i = 0; i < 8; i++) { ctx.fillRect(i * c, 0, 2, S); ctx.fillRect(0, i * c, S, 2); }
  }
}
function drawMask(layer, ctx) { // alpha channel = glass (windows that can reflect / light up)
  const S = TEX, c = S / 8;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S); ctx.fillStyle = '#fff';
  if (layer <= 2) { for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) ctx.fillRect(i * c + 18, j * c + 12, 28, 40); }
  else if (layer === 3) { for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) ctx.fillRect(i * c + 12, j * c + 10, 40, 44); }
  else if (layer === 4 || layer === 5) { for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) ctx.fillRect(i * c + 2, j * c + 2, c - 4, c - 10); }
  else if (layer === 6) { for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) ctx.fillRect(i * c + 8, j * c + 10, 48, 40); }
  else if (layer === 7) { for (let k = 0; k < 4; k++) { ctx.fillRect(k * 128 + 14, 150, 80, 330); } }
}
const _facade = { v0: null, v1: null };
function facadeArray(v1 = false) {
  const key = v1 ? 'v1' : 'v0';
  if (_facade[key]) return _facade[key];
  const data = new Uint8Array(TEX * TEX * 4 * LAYERS);
  const cv = document.createElement('canvas'); cv.width = TEX; cv.height = TEX; const ctx = cv.getContext('2d', { willReadFrequently: true });
  const cm = document.createElement('canvas'); cm.width = TEX; cm.height = TEX; const cx2 = cm.getContext('2d', { willReadFrequently: true });
  for (let L = 0; L < LAYERS; L++) {
    drawLayer(L, ctx, v1); drawMask(L, cx2);
    const a = ctx.getImageData(0, 0, TEX, TEX).data, m = cx2.getImageData(0, 0, TEX, TEX).data;
    const off = L * TEX * TEX * 4;
    for (let y = 0; y < TEX; y++) { // flip rows: v = 0 at the bottom (ground floor)
      const src = (TEX - 1 - y) * TEX * 4, dst = off + y * TEX * 4;
      for (let x = 0; x < TEX * 4; x += 4) { data[dst + x] = a[src + x]; data[dst + x + 1] = a[src + x + 1]; data[dst + x + 2] = a[src + x + 2]; data[dst + x + 3] = m[src + x]; }
    }
  }
  const t = new THREE.DataArrayTexture(data, TEX, TEX, LAYERS);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
  t.needsUpdate = true; t.name = `city-facades-${key}`;
  return (_facade[key] = t);
}

// ---------------------------------------------------------------------------- building material
const BUILDING_VERT = /* glsl */`
attribute vec3 aSize; attribute float aStyle; attribute float aSeed; attribute vec3 aTint; attribute vec4 aParams; attribute vec2 aOff;
varying vec3 vObj; varying vec3 vNw; varying vec3 vWorld; varying vec3 vSize; varying vec3 vTint; varying vec4 vParams; varying vec2 vOff;
flat varying float vStyle; varying float vSeed; varying vec3 vNo;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec3 p = position * aSize;
  vObj = p; vNo = normal; vSize = aSize; vStyle = aStyle; vSeed = aSeed; vTint = aTint; vParams = aParams; vOff = aOff;
  mat4 M = modelMatrix;
  #ifdef USE_INSTANCING
    M = modelMatrix * instanceMatrix;
  #endif
  vec4 wp = M * vec4(p, 1.0);
  vWorld = wp.xyz; vNw = normalize(mat3(M) * normal);
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const BUILDING_FRAG = /* glsl */`
precision highp sampler2DArray;
uniform sampler2DArray uFacade;
uniform vec4 uQ3; // v0.30: x interior-mapped windows, y sky reflections, z neighbour shadows, w rim + street bounce
uniform vec4 uQ4; // v0.30: x CC0 PBR detail, y layered fog, z (unused), w VFX light pulses
uniform vec4 uWinRect[8]; // window opening per style in bay-cell fractions (x0, x1, y0, y1); [7] = storefront
${CITY_COMMON_GLSL}
${FX_LIGHT_GLSL}
uniform sampler2D uNoise;
uniform vec4 uQ; // v0.25 switches: x win, y var, z ao, w shade (0 = the original v0.24 path)
uniform vec4 uQ2; // v0.26: x ledge (sill-course shadow band), y ledge range (m)
uniform vec3 uSunDir, uSunColor, uSky, uGround, uShade, uLit, uHorizon, uZenith;
uniform vec2 uStyleP[7];
varying vec3 vObj; varying vec3 vNw; varying vec3 vWorld; varying vec3 vSize; varying vec3 vTint; varying vec4 vParams; varying vec2 vOff;
flat varying float vStyle; varying float vSeed; varying vec3 vNo;
#include <common>
#include <fog_pars_fragment>
float h21(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
void main() {
  int st = int(vStyle + 0.5);
  vec3 n = normalize(vNw);
  vec3 V = normalize(cameraPosition - vWorld);
  float camD = length(cameraPosition - vWorld);
  vec3 albedo; float glass = 0.0; float isGlassStyle = 0.0; float u = 0.0, v = vWorld.y;
  vec2 bp = vec2(3.0, 3.4);
  bool roof = vNo.y > 0.5;
  float tierBase = vWorld.y - vObj.y; // height of this box's base above the street (0 = street level tier)
  bool glassy = st == 4 || st == 5;
  if (st >= 9) { // cornice / parapet band: plain stone
    albedo = vec3(0.80, 0.74, 0.64) * vTint;
  } else if (roof) {
    vec4 tx = texture(uFacade, vec3(vObj.xz / 14.0 + vSeed * 3.0, 8.0));
    albedo = tx.rgb * vTint;
    float edge = min(min(vSize.x * 0.5 - abs(vObj.x), vSize.z * 0.5 - abs(vObj.z)), 4.0);
    albedo *= mix(0.72, 1.0, smoothstep(0.0, 1.2, edge)); // parapet shadow
    if (uQ.y > 0.5) { // roof: broad tone + darker damp patches (world-stable: building-local metres)
      vec2 rc = vObj.xz + vSeed * 97.0;
      albedo *= mix(0.86, 1.08, texture(uNoise, rc / 29.0).r);
      albedo *= 1.0 - 0.16 * smoothstep(0.6, 0.82, texture(uNoise, rc / 17.0).b);
    }
    if (uQ4.x > 0.5) { // v0.30d roof variety: tar / gravel / green roof / pale membrane per building + skylights, vents, edge walkway
      float sq = floor(vSeed * 1000.0 + 0.5) / 1000.0, rt = floor(fract(sq * 7.31) * 4.0);
      vec3 rb = rt < 0.5 ? vec3(0.2, 0.19, 0.2) : rt < 1.5 ? vec3(0.44, 0.39, 0.34) : rt < 2.5 ? vec3(0.3, 0.33, 0.27) : vec3(0.5, 0.48, 0.47);
      float lum = dot(albedo, vec3(0.3, 0.59, 0.11));
      albedo = rb * mix(0.75, 1.25, clamp(lum * 1.6, 0.0, 1.0));
      vec2 rc2 = vObj.xz + sq * 53.0;
      if (rt > 1.5 && rt < 2.5) albedo = mix(albedo, vec3(0.2, 0.34, 0.14), smoothstep(0.45, 0.6, texture(uNoise, rc2 / 9.0).g) * 0.8); // planted beds
      if (rt > 2.5) albedo *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.06, abs(fract(rc2.x / 2.5) - 0.5) - 0.44)); // membrane seams
      vec2 cid = floor(rc2 / 6.0), cf = fract(rc2 / 6.0);
      float h = fract(sin(dot(cid, vec2(12.9898, 78.233)) + sq * 31.0) * 43758.5453);
      float inner = step(0.2, cf.x) * step(cf.x, 0.8) * step(0.25, cf.y) * step(cf.y, 0.75) * step(3.0, edge);
      if (h < 0.12) albedo = mix(albedo, vec3(0.1, 0.13, 0.18), inner);                                        // skylight
      else if (h < 0.24) albedo = mix(albedo, vec3(0.5, 0.5, 0.52) * (0.8 + 0.2 * step(0.5, fract(cf.x * 6.0))), inner); // vent grille
      albedo = mix(albedo * 1.12, albedo, smoothstep(0.6, 1.4, edge)); // lighter walkway along the parapet
    }
  } else {
    bp = uStyleP[st];
    if (vParams.w > 0.0) bp.y = vParams.w;
    // metres along the face, continuous around the building
    if (abs(vNo.x) > 0.5) u = (vNo.x > 0.0 ? -vObj.z : vObj.z) + (vNo.x > 0.0 ? vSize.x : vSize.x * 2.0 + vSize.z);
    else u = (vNo.z > 0.0 ? vObj.x : -vObj.x) + (vNo.z > 0.0 ? 0.0 : vSize.x + vSize.z);
    u += vOff.x;
    float uOff = floor(vSeed * 8.0) / 8.0, vOffT = floor(fract(vSeed * 7.3) * 8.0) / 8.0;
    float storeH = 4.6;
    if (vParams.y > 0.5 && v < storeH) {
      vec4 tx = texture(uFacade, vec3(u / 12.0 + vSeed * 5.0, v / storeH, 7.0));
      albedo = tx.rgb; glass = tx.a;
    } else {
      float vv = (v - vOff.y) / (bp.y * 8.0);
      vec4 tx = texture(uFacade, vec3(u / (bp.x * 8.0) + uOff, vv + vOffT, float(st)));
      albedo = tx.rgb * vTint; glass = tx.a;
    }
    isGlassStyle = glassy ? 1.0 : 0.0;
    // top band (cornice line) on masonry
    if (st != 4 && st != 5 && vSize.y > 1.5) albedo = mix(albedo, vec3(0.78, 0.72, 0.62) * vTint, smoothstep(vSize.y - 1.0, vSize.y - 0.8, vObj.y) * (1.0 - step(vSize.y, vObj.y + 0.01)));
    if (uQ.y > 0.5) { // v0.25 var: weathering from the fixed noise texture, in building-local face metres (stable)
      vec2 fc = vec2(u, v) + vSeed * 131.0;
      float masonry = 1.0 - isGlassStyle * 0.7;
      float n1 = texture(uNoise, fc / 41.0).r;                          // broad patches
      float n2 = texture(uNoise, vec2(fc.x / 6.5, fc.y / 57.0)).g;      // vertical rain streaks
      float n3 = texture(uNoise, fc / 15.0).b;                          // stains
      albedo *= mix(0.9, 1.07, n1);
      float top = smoothstep(vSize.y * 0.35, vSize.y, vObj.y);          // runoff from the cornice / parapet
      albedo *= 1.0 - 0.15 * smoothstep(0.5, 0.85, n2) * (0.55 + 0.45 * top) * masonry;
      albedo *= 1.0 - 0.09 * smoothstep(0.58, 0.8, n3) * masonry;
      if (tierBase < 0.5) albedo *= mix(0.8, 1.0, smoothstep(0.0, 1.0 + 2.4 * n1, vWorld.y)); // street grime splash
    }
  }
  // ---- v0.30 CC0 PBR detail (masonry relief + albedo variation, facade-plane UVs in metres; roofs: concrete)
  vec3 nL = n; float ormAO = 1.0;
  vec3 Tg = normalize(cross(vec3(0.0, 1.0, 0.0), abs(n.y) > 0.9 ? vec3(0.0, 0.0, 1.0) : n));
  if (uQ4.x > 0.5 && uPbrOn > 0.5 && st < 9) {
    float L = roof ? 4.0 : st == 0 ? 0.0 : st == 1 ? 1.0 : st == 2 ? 2.0 : st == 3 ? 3.0 : st == 6 ? 1.0 : 6.0;
    float tile = roof ? 4.0 : st == 3 ? 3.2 : (st == 4 || st == 5) ? 2.0 : 2.6;
    vec2 tuv = roof ? vObj.xz / tile : vec2(u, v) / tile;
    vec3 pa = texture(uAlb, vec3(tuv, L)).rgb, pavg = textureLod(uAlb, vec3(0.5, 0.5, L), 10.0).rgb;
    float wall = (1.0 - glass) * (roof ? 0.3 : 1.0);
    vec3 det = clamp(pa / max(pavg, vec3(0.04)), 0.35, 1.9);
    albedo *= mix(vec3(1.0), det, 0.62 * wall);
    float nf = (1.0 - smoothstep(30.0, 90.0, camD)) * wall * (roof ? 0.5 : 1.0);
    nL = pbrNormal(n, roof ? vec3(1.0, 0.0, 0.0) : Tg, roof ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0), tuv, L, 1.15 * nf);
    ormAO = mix(1.0, texture(uOrm, vec3(tuv, L)).r, 0.75 * wall);
  }
  // ---- lighting: warm low sun above the canyon shadow line, cool shade below
  float ndl = max(dot(nL, uSunDir), 0.0);
  float shadowLine = roof ? -10.0 : vParams.z;
  float sunVis = smoothstep(shadowLine - 5.0, shadowLine + 9.0, vWorld.y);
  vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5);
  if (uQ.w > 0.5) {
    if (!roof && st < 9) { // uneven, softer canyon shadow edge (no ruler-straight horizontal cut)
      float wob = texture(uNoise, vec2(u / 63.0 + vSeed * 3.7, 0.37 + vSeed)).r - 0.5;
      float sl = shadowLine + wob * 14.0;
      sunVis = smoothstep(sl - 10.0, sl + 14.0, vWorld.y);
    }
    vec2 hz = n.xz; float hl = length(hz);
    float facing = hl > 0.3 ? dot(hz / hl, normalize(uSunDir.xz)) : 0.0; // +1 toward the sun
    amb *= mix(vec3(0.93, 0.97, 1.05), vec3(1.05, 1.0, 0.95), facing * 0.5 + 0.5);
  }
  if (uQ.z > 0.5 && !roof && st < 9) amb *= mix(0.78, 1.0, smoothstep(2.0, 34.0, vWorld.y)); // canyon: less sky low down
  if (uQ3.z > 0.5) { // v0.30 analytic neighbour shadows (height field), replaces the per-building canyon line
    float hs = hfShadow(vWorld + n * 0.4, uSunDir, roof ? 2.5 : 4.5);
    sunVis = roof ? mix(0.18, 1.0, hs) : mix(0.13, 1.0, hs) * smoothstep(-2.0, 3.0, vWorld.y); // v0.30b: soft, never fully dark (warmth)
  }
  amb = mix(amb * (roof ? mix(uShade, vec3(0.9, 0.86, 0.9), 0.55) : uShade), amb, sunVis); // (roofs: less flat blue in shade)
  amb *= ormAO;
  vec3 col = albedo * (amb * 0.62 + uSunColor * ndl * sunVis * 1.05);
  if (uQ3.w > 0.5 && st < 9) { // v0.30 rim / edge light against the sky + warm street bounce + lit top edges
    float fr = pow(1.0 - max(dot(n, V), 0.0), 4.0);
    col += uRimCol * fr * 0.42 * (0.35 + 0.65 * sunVis) * (roof ? 0.25 : 1.0);
    col += albedo * uSunColor * ndl * sunVis * 0.18; // v0.30d: stronger sun vs blue-shade contrast
    if (!roof) {
      col += albedo * uBounce * (1.0 - smoothstep(0.0, 24.0, vWorld.y)) * 0.6 * (1.0 - glass * 0.6);
      float topE = smoothstep(vSize.y - 0.7, vSize.y - 0.05, vObj.y) * step(vObj.y, vSize.y - 0.01);
      col += uSunColor * 0.32 * topE * max(sunVis, 0.25) * smoothstep(-0.4, 0.4, dot(n.xz, normalize(uSunDir.xz)));
    }
  }
  if (uQ4.w > 0.5) col += albedo * fxLight(vWorld, n);
  // window grid + its screen footprint (derivatives taken outside the per-pixel glass branch)
  vec2 wc = vec2(u / bp.x, v / bp.y);
  float px = max(fwidth(wc.x), fwidth(wc.y)); // windows per pixel
  // glass: sky reflection + sun glint (cheap analytic env)
  if (glass > 0.01 && uQ3.x > 0.5) {
    // ---- v0.30 interior-mapped windows: a room box behind every window (back wall from the room atlas, side walls,
    // floor / ceiling, ceiling light), curtains / blinds on the glass, sunset sky reflection on top (fresnel)
    float sq = floor(vSeed * 1000.0 + 0.5) / 1000.0;
    bool shop = vParams.y > 0.5 && v < 4.6;
    vec2 cm = shop ? vec2(3.0, 4.6) : bp;
    vec2 cc = shop ? vec2(u / 3.0 + vSeed * 20.0, v / 4.6) : vec2(u / bp.x, (v - vOff.y) / bp.y);
    vec2 win = floor(cc), cell = fract(cc);
    vec4 wr = uWinRect[shop ? 7 : min(st, 6)];
    float gw = 2.0 + floor(fract(sq * 13.7) * 3.0);
    vec2 grp = vec2(floor(win.x / gw), win.y);
    float lit = shop ? 1.0 : step(h21(grp + sq * 91.7), vParams.x);
    float kd = (1.0 - smoothstep(0.16, 0.42, px)) * (1.0 - smoothstep(240.0, 400.0, camD));
    vec3 rd = vec3(dot(-V, Tg), dot(-V, vec3(0.0, 1.0, 0.0)), dot(-V, n)); rd.z = min(rd.z, -0.05);
    float D = shop ? 4.5 : cm.x * 1.15 + 0.8;
    vec3 p0 = vec3(cell * cm, 0.0);
    vec3 tb = (vec3(rd.x > 0.0 ? cm.x : 0.0, rd.y > 0.0 ? cm.y : 0.0, -D) - p0) / rd;
    float th = min(min(tb.x, tb.y), tb.z); vec3 hp = p0 + rd * th;
    float rh = h21(win * 1.37 + sq * 17.1), rh2 = h21(win * 2.71 + sq * 5.3);
    float ty = shop ? 7.0 : floor(rh * 7.0);
    vec3 wallC = mix(vec3(0.78, 0.7, 0.6), vec3(0.62, 0.66, 0.7), rh2);
    vec3 rc;
    float depth = clamp(-hp.z / D, 0.0, 1.0);
    if (th == tb.z) {
      vec2 ruv = clamp(hp.xy / cm, 0.0, 1.0);
      vec2 auv = vec2((mod(ty, 4.0) + ruv.x) * 0.25, (1.0 - floor(ty / 4.0) + ruv.y) * 0.5);
      rc = texture(uRooms, auv).rgb;
    } else if (th == tb.x) {
      rc = wallC * (0.85 - 0.25 * depth);
    } else if (rd.y < 0.0) {
      rc = mix(vec3(0.42, 0.3, 0.22), vec3(0.55, 0.42, 0.3), step(0.5, fract(hp.x * 2.2 + floor(hp.z * 0.8) * 0.37))) * (0.75 + 0.25 * depth);
    } else {
      float lamp = exp(-dot(hp.xz - vec2(cm.x * 0.5, -D * 0.5), hp.xz - vec2(cm.x * 0.5, -D * 0.5)) * 1.2);
      rc = vec3(0.86, 0.82, 0.76) * (0.6 + 0.8 * lamp * lit);
    }
    float lampY = smoothstep(0.0, cm.y, hp.y);
    vec3 warmL = mix(uLit, uLit * vec3(0.8, 0.92, 1.18), step(0.78, h21(grp + 19.3)));
    vec3 inner = lit > 0.5 ? rc * warmL * (0.75 + 0.55 * lampY) * (1.05 - 0.35 * depth) * (0.85 + 0.3 * h21(grp * 1.7 + 3.1))
                           : rc * vec3(0.05, 0.06, 0.085) + (ty == 2.0 ? vec3(0.02, 0.05, 0.1) * (1.0 - depth) : vec3(0.0));
    // curtains / blinds on the glass plane
    vec2 wl = vec2((cell.x - wr.x) / max(wr.y - wr.x, 1e-3), (cell.y - wr.z) / max(wr.w - wr.z, 1e-3));
    float ck = h21(win * 3.1 + sq * 7.7);
    if (!shop && ck < 0.34) {
      float cw = 0.14 + 0.2 * h21(win + 4.4);
      float cur = max(1.0 - smoothstep(cw - 0.02, cw, wl.x), smoothstep(1.0 - cw, 1.0 - cw + 0.02, wl.x));
      vec3 fab = mix(vec3(0.85, 0.78, 0.62), vec3(0.6, 0.32, 0.28), step(0.5, h21(win + 9.1)));
      inner = mix(inner, fab * (lit > 0.5 ? warmL * 0.95 : vec3(0.08, 0.08, 0.1)) * (0.85 + 0.15 * sin(wl.x * 60.0)), cur);
    } else if (!shop && ck < 0.52) {
      float bh = 0.25 + 0.5 * h21(win + 2.2);
      float bl = step(1.0 - bh, wl.y) * step(0.45, fract(wl.y * 22.0));
      inner = mix(inner, vec3(0.8, 0.76, 0.68) * (lit > 0.5 ? warmL * 0.8 : vec3(0.1)), bl * 0.9);
    }
    vec3 avg = lit > 0.5 ? uLit * 0.5 : vec3(0.05, 0.055, 0.075);
    inner = mix(avg, inner, kd);
    // reflection
    vec3 R = reflect(-V, n);
    float rough = isGlassStyle > 0.5 ? 0.12 : 0.28;
    vec3 sky = uEnvOn > 0.5 && uQ3.y > 0.5 ? envSky(R, rough) : mix(uHorizon, uZenith, clamp(R.y * 1.6, 0.0, 1.0));
    float ndv = max(dot(n, V), 0.0);
    float fres = (isGlassStyle > 0.5 ? 0.18 : 0.06) + 0.82 * pow(1.0 - ndv, 4.0);
    fres *= lit > 0.5 ? 0.6 : 1.0;
    float glint = pow(max(dot(R, uSunDir), 0.0), 60.0) * sunVis;
    if (isGlassStyle > 0.5) { // v0.30d: dark tinted curtain glass, one tint per tower, strong warm grazing reflection
      vec3 gt = mix(vec3(0.66, 0.8, 1.0), vec3(1.0, 0.84, 0.66), h21(vec2(sq * 37.0, 1.3)));
      inner *= 0.5; sky *= gt * 1.05; fres = 0.04 + 0.96 * pow(1.0 - ndv, 4.0);
    }
    vec3 gcol = mix(inner, sky * (0.62 + 0.38 * sunVis), clamp(fres + (isGlassStyle > 0.5 ? 0.1 : 0.0), 0.0, 0.92)) + uSunColor * glint * 1.6;
    col = mix(col, gcol, glass * (0.82 + 0.15 * isGlassStyle));
  } else if (glass > 0.01) {
    vec3 R = reflect(-V, n);
    vec3 sky = mix(uHorizon, uZenith, clamp(R.y * 1.6, 0.0, 1.0));
    float fres = 0.25 + 0.75 * pow(1.0 - max(dot(n, V), 0.0), 3.0);
    float glint = pow(max(dot(R, uSunDir), 0.0), 40.0) * sunVis;
    vec3 gcol = mix(albedo * 0.55, sky * (0.55 + 0.45 * sunVis), fres * (0.45 + 0.4 * isGlassStyle)) + uSunColor * glint * 1.4;
    col = mix(col, gcol, glass * (0.65 + 0.3 * isGlassStyle));
    if (uQ.x > 0.5) {
      // v0.25 win: rooms lit in groups of 2–4 windows per floor (per building seed), one brightness per group;
      // faded to the average once a window covers only a few pixels (screen size, not a fixed distance)
      // vSeed is an interpolated varying: its tiny per-pixel interpolation error, amplified by the chaotic h21 hash,
      // made the v0.24 lit pattern change from pixel to pixel (the "noisy / flickering windows"). Snap it back to the
      // exact per-building value (seed % 1000 / 1000) before hashing.
      float sq = floor(vSeed * 1000.0 + 0.5) / 1000.0;
      vec2 win = floor(wc);
      float gw = 2.0 + floor(fract(sq * 13.7) * 3.0);
      vec2 grp = vec2(floor(win.x / gw), win.y);
      float lit = step(h21(grp + sq * 91.7), vParams.x);
      float kd = (1.0 - smoothstep(0.16, 0.42, px)) * (1.0 - smoothstep(240.0, 400.0, camD));
      lit = mix(vParams.x * 0.6, lit, kd);
      float inten = 0.5 + 0.3 * h21(grp * 1.7 + 3.1) + 0.08 * (h21(win + 7.7) - 0.5) * kd;
      vec3 warm = mix(uLit, uLit * vec3(0.86, 0.95, 1.12), step(0.7, h21(grp + 19.3))); // a few cooler rooms
      col += warm * inten * lit * glass * (isGlassStyle > 0.5 ? 0.4 : 0.85);
    } else {
      // lit rooms (evening), faded to the average far away (no shimmering)
      vec2 win = floor(vec2(u / bp.x, v / bp.y));
      float hh = h21(win + vSeed * 91.7);
      float lit = step(hh, vParams.x);
      float kd = 1.0 - smoothstep(170.0, 340.0, camD);
      lit = mix(vParams.x * 0.6, lit, kd);
      col += uLit * (0.42 + 0.45 * h21(win * 1.7 + 3.1)) * lit * glass * (isGlassStyle > 0.5 ? 0.4 : 0.85);
    }
  }
  if (uQ.z > 0.5) { // v0.25 ao: contact / setback / cornice / edge occlusion (cheap, analytic)
    float ao = 1.0;
    if (st >= 9) ao = n.y < -0.5 ? 0.62 : 1.0; // cornice underside
    else if (!roof) {
      if (tierBase < 0.5) ao *= mix(0.6, 1.0, smoothstep(0.0, 2.4, vWorld.y)) * mix(0.9, 1.0, smoothstep(0.0, 8.0, vWorld.y));
      else ao *= mix(0.7, 1.0, smoothstep(0.0, 1.8, vObj.y)); // setback: where this tier stands on the roof below
      if (!glassy && vSize.y > 3.0) ao *= 1.0 - 0.2 * smoothstep(vSize.y - 2.6, vSize.y - 1.05, vObj.y) * (1.0 - step(vSize.y - 1.0, vObj.y)); // under the cornice
      float ex = abs(vNo.x) > 0.5 ? vSize.z * 0.5 - abs(vObj.z) : vSize.x * 0.5 - abs(vObj.x);
      ao *= mix(0.87, 1.0, smoothstep(0.0, 1.5, ex)); // vertical edges / corners
      if (uQ2.x > 0.5 && (st <= 3 || st == 6) && vWorld.y > 4.7 && vWorld.y < 72.5) { // soft shadow under each sill strip
        float fv = fract(vWorld.y / bp.y) * bp.y;                        // metres above the floor line
        float sh = smoothstep(0.1 * bp.y - 0.32, 0.1 * bp.y - 0.02, fv) * (1.0 - step(0.1 * bp.y, fv));
        ao *= 1.0 - 0.28 * sh * (1.0 - smoothstep(uQ2.y, uQ2.y + 30.0, camD));
      }
    }
    col *= ao;
  } else col *= mix(0.55, 1.0, smoothstep(0.0, 3.0, vWorld.y)); // contact shade at the street (v0.24)
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  if (uQ4.y > 0.5) gl_FragColor.rgb = fog2(gl_FragColor.rgb, vWorld, uSunDir);
  else {
  #include <fog_fragment>
  }
}`;
function buildingMaterial() {
  const m = new THREE.ShaderMaterial({
    vertexShader: BUILDING_VERT, fragmentShader: BUILDING_FRAG, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uFacade: { value: null }, uSunDir: { value: SUN_DIRECTION.clone() }, uSunColor: { value: new THREE.Color(0xffa860).multiplyScalar(1.5) }, // v0.30b: warmer, stronger low sun
      uSky: { value: new THREE.Color(0xa8b4e0) }, uGround: { value: new THREE.Color(0x8a7470) }, uShade: { value: new THREE.Color(0.55, 0.62, 0.96) }, // v0.30b: deeper blue shade (warm / cool contrast)
      uLit: { value: new THREE.Color(0xffc070) }, uHorizon: { value: new THREE.Color(0xf2a878) }, uZenith: { value: new THREE.Color(0x6a7ac0) },
      uStyleP: { value: STYLE_P.map(([a, b]) => new THREE.Vector2(a, b)) },
      uNoise: { value: null }, uQ: { value: new THREE.Vector4(0, 0, 0, 0) }, uQ2: { value: new THREE.Vector4(0, CITY_CFG.ledgeRange, 0, 0) },
      uQ3: { value: new THREE.Vector4(0, 0, 0, 0) }, uQ4: { value: new THREE.Vector4(0, 0, 0, 0) },
      uWinRect: { value: WIN_RECTS.map((r) => new THREE.Vector4(...r)) },
    }]),
  });
  Object.assign(m.uniforms, CITY_SHARED, { uFxP0: FX_LIGHT.uFxP0, uFxC0: FX_LIGHT.uFxC0, uFxP1: FX_LIGHT.uFxP1, uFxC1: FX_LIGHT.uFxC1 }); // shared objects (set once for every city material)
  // uFacade: set by createCity() → setQuality() (v0 or v1 texture variant; only one is kept)
  m.uniforms.uNoise.value = cityNoiseTexture();
  m.name = 'city-buildings';
  return m;
}
const STYLE_CORNICE = 9;
// v0.30 window openings in bay-cell fractions (from drawLayer / drawMask): brick ×3, limestone, glass ×2, industrial, storefront
const WIN_RECTS = [[18 / 64, 46 / 64, 12 / 64, 52 / 64], [18 / 64, 46 / 64, 12 / 64, 52 / 64], [18 / 64, 46 / 64, 12 / 64, 52 / 64], [12 / 64, 52 / 64, 10 / 64, 54 / 64],
  [2 / 64, 62 / 64, 10 / 64, 62 / 64], [2 / 64, 62 / 64, 10 / 64, 62 / 64], [8 / 64, 56 / 64, 14 / 64, 54 / 64], [14 / 128, 94 / 128, 32 / 512, 362 / 512]];

// ---------------------------------------------------------------------------- ground (street grid)
const GROUND_VERT = /* glsl */`
varying vec3 vWorld; varying vec3 vNg;
#include <common>
#include <fog_pars_vertex>
void main() {
  mat4 M = modelMatrix;
  #ifdef USE_INSTANCING
    M = modelMatrix * instanceMatrix; // v0.27 raised sidewalk segments share the street shader
  #endif
  vec4 wp = M * vec4(position, 1.0); vWorld = wp.xyz; vNg = normalize(mat3(M) * normal);
  vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`;
const GROUND_FRAG = /* glsl */`
uniform vec2 uGrid; uniform float uCell, uRoadH, uWalkH, uQG, uQG2;
uniform vec4 uQ3, uQ4; uniform vec3 uSunDir, uSunColor;
${CITY_COMMON_GLSL}
${FX_LIGHT_GLSL}
varying vec3 vNg;
uniform vec3 uRoad, uWalk, uLine, uYellow, uShadeC;
uniform sampler2D uNoise;
varying vec3 vWorld;
#include <common>
#include <fog_pars_fragment>
float h21(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
// anti-aliased helpers: coverage of |d| < halfW, edge softened by one pixel footprint
float bandAA(float d, float halfW) { float w = max(fwidth(d), 1e-4); return 1.0 - smoothstep(halfW - w, halfW + w, d); }
vec3 groundV1() {
  // grid-relative coordinates: uGrid follows the origin rebase, so q (and every pattern below) is identical
  // before / after a rebase. mod() keeps the numbers small on very long endless runs (4608 = 64 cells; the noise
  // periods 48 / 18 / 9 m divide it → no seam).
  vec2 q = vWorld.xz - uGrid;
  vec2 m = mod(q + uCell * 0.5, uCell) - uCell * 0.5; // offset from the nearest intersection centre
  vec2 a = abs(m);
  float dmin = min(a.x, a.y);
  vec2 qm = mod(q, 4608.0);
  float fq = max(fwidth(q.x), fwidth(q.y)); // metres per pixel
  float fine = 1.0 - smoothstep(0.04, 0.16, fq); // small features fade out before they alias
  float n1 = texture(uNoise, qm / 48.0).r, n2 = texture(uNoise, qm / 9.0).a, n3 = texture(uNoise, qm / 18.0).b;
  float road = bandAA(dmin, uRoadH), walk = bandAA(dmin, uWalkH);
  bool alongX = a.y < a.x;
  float off = alongX ? a.y : a.x, along = alongX ? m.x : m.y;
  float inter = step(a.x, uWalkH) * step(a.y, uWalkH);
  // ---- asphalt: low-frequency tone, tyre-polished lane centres, dark gutters, stains
  vec3 asph = uRoad * (0.88 + 0.18 * n1 + 0.08 * (n2 - 0.5) * fine);
  vec3 pAs = vec3(1.0), pPv = vec3(1.0);
  if (uQ4.x > 0.5 && uPbrOn > 0.5) { // v0.30 CC0 asphalt / paving detail (albedo ratio to the layer average)
    pAs = clamp(texture(uAlb, vec3(qm / 3.6, 5.0)).rgb / max(textureLod(uAlb, vec3(0.5, 0.5, 5.0), 10.0).rgb, vec3(0.04)), 0.4, 1.8);
    pPv = clamp(texture(uAlb, vec3(qm / 2.4, 7.0)).rgb / max(textureLod(uAlb, vec3(0.5, 0.5, 7.0), 10.0).rgb, vec3(0.04)), 0.4, 1.8);
    asph *= mix(vec3(1.0), pAs, 0.7);
  }
  float lane = min(abs(off - 1.75), abs(off - 5.25));
  asph *= 1.0 - 0.06 * (1.0 - smoothstep(0.35, 1.1, lane)) * (1.0 - inter);
  asph *= 1.0 - 0.16 * smoothstep(uRoadH - 0.9, uRoadH - 0.1, dmin) * (1.0 - inter * step(uRoadH, max(a.x, a.y)));
  asph *= 1.0 - 0.12 * smoothstep(0.6, 0.82, n3);
  vec3 rc = asph;
  float wear = 0.72 + 0.28 * n2;
  // both marking sets are evaluated every pixel and selected with mix(): fwidth() inside a per-pixel branch is
  // undefined in GLSL ES (seam / sparkle pixels along the intersection edge on some GPUs)
  vec3 rcB = rc;
  {
    float yl = max(bandAA(abs(off - 0.1), 0.06), bandAA(abs(off - 0.3), 0.06)); // double yellow
    rc = mix(rc, uYellow * 0.92, yl * wear);
    float dash = bandAA(abs(fract(along / 6.0 + 0.25) - 0.5) * 6.0, 1.5); // 3 m dash every 6 m (continuous triangle wave)
    rc = mix(rc, uLine * 0.95, bandAA(abs(off - 3.5), 0.07) * dash * wear);
    // manhole (one per block side, in the lane) + storm drain at the curb near the corner
    vec2 mh = vec2(abs(along) - 21.0, off - 1.9);
    float r = length(mh);
    rc = mix(rc, rc * 0.6, bandAA(r, 0.34) * 0.85);
    rc *= 1.0 - 0.35 * bandAA(abs(r - 0.34), 0.035) * fine;
    vec2 dr = vec2(abs(along) - (uWalkH + 1.6), off - (uRoadH - 0.28));
    float grate = bandAA(abs(dr.x), 0.45) * bandAA(abs(dr.y), 0.2);
    rc = mix(rc, vec3(0.1, 0.1, 0.11), grate * mix(0.55, 0.85, step(0.5, fract(dr.x * 4.0 + 0.5)) * fine));
  }
  { // crosswalks at the intersection edges
    float zebra = alongX ? a.x : a.y;
    float cw = bandAA(abs(zebra - (uRoadH - 1.8)), 1.4);
    float stripe = bandAA(abs(fract((alongX ? q.y : q.x) / 1.2 + 0.225) - 0.5) * 1.2, 0.33);
    stripe = mix(0.45, stripe, 1.0 - smoothstep(0.16, 0.42, fq)); // far away (period < ~4 px): the average, not a moiré
    rcB = mix(rcB, uLine * 0.9, cw * stripe * wear);
  }
  rc = mix(rc, rcB, inter);
  // ---- sidewalk: paving slabs (1.5 m), per-slab tone, curb with its face shadow, contact AO at the building line
  vec3 sw = uWalk * (0.9 + 0.12 * n1 + 0.05 * (n2 - 0.5) * fine) * mix(vec3(1.0), pPv, 0.6);
  vec2 sl = abs(fract(q / 1.5) - 0.5) * 1.5; // distance to a slab joint (m)
  float joint = bandAA(min(sl.x, sl.y), 0.025) * fine;
  sw *= 1.0 - 0.14 * joint;
  sw *= 1.0 + 0.07 * (texture(uNoise, (floor(q / 1.5) + 0.5) * 1.5 / 18.0).a - 0.5) * fine;
  sw *= mix(0.72, 1.0, smoothstep(0.0, 1.3, uWalkH - dmin)); // building base
  float curb = bandAA(abs(dmin - uRoadH - 0.17), 0.17);
  sw = mix(sw, vec3(0.64, 0.62, 0.6) * (0.92 + 0.12 * n1), curb);
  vec3 lot = vec3(0.33, 0.31, 0.33);
  vec3 col = mix(lot, sw, walk);
  col = mix(col, rc, road);
  col *= 1.0 - 0.3 * bandAA(abs(dmin - uRoadH), 0.05); // curb face shadow line
  if (uQG2 > 0.5) { // v0.27 lampglow: warm light pools under the street-lamp heads (every module has them at the same spots)
    vec2 l1 = a - vec2(8.1, 18.0), l2 = a - vec2(18.0, 8.1);
    float g = exp(-dot(l1, l1) / 14.0) + exp(-dot(l2, l2) / 14.0);
    col += vec3(1.0, 0.62, 0.28) * 0.16 * g;
  }
  if (vNg.y < 0.5) col *= 0.58 + 0.12 * vNg.y; // vertical curb face of a raised sidewalk segment
  return col;
}
void main() {
  if (uQG > 0.5) {
    vec3 g0 = groundV1();
    vec3 c1 = g0 * uShadeC;
    if (uQ3.z > 0.5) { // v0.30 neighbour shadows on the street: warm sun stripes between the long building shadows
      float hs = hfShadow(vWorld + vec3(0.0, 0.08, 0.0), uSunDir, 2.0);
      c1 = mix(c1, g0 * (uShadeC * 0.55 + uSunColor * 0.42), hs);
    }
    if (uQ4.w > 0.5) c1 += g0 * fxLight(vWorld, vec3(0.0, 1.0, 0.0));
    gl_FragColor = vec4(c1, 1.0);
  } else {
  vec2 q = vWorld.xz - uGrid;
  vec2 m = mod(q + uCell * 0.5, uCell) - uCell * 0.5; // distance to the nearest street centre lines
  vec2 a = abs(m);
  float road = step(min(a.x, a.y), uRoadH);
  float walk = step(min(a.x, a.y), uWalkH);
  vec3 col = mix(vec3(0.33, 0.31, 0.33), uWalk, walk); // under buildings / lots
  float noise = h21(floor(vWorld.xz * 2.0)) * 0.06;
  if (road > 0.5) {
    col = uRoad + noise;
    bool alongX = a.y < a.x; // street running along x (cross street) at this pixel
    float off = alongX ? a.y : a.x, along = alongX ? q.x : q.y;
    bool inter = a.x < uWalkH && a.y < uWalkH;
    if (!inter) {
      if (abs(off - 0.18) < 0.09) col = uYellow; // double yellow centre line
      if (abs(off - 3.5) < 0.07 && fract(along / 6.0) < 0.5) col = uLine; // lane dashes
    } else {
      float zebra = alongX ? a.x : a.y; // crosswalk stripes at the intersection edges
      float cw = step(uRoadH - 3.2, zebra) * step(zebra, uRoadH - 0.4);
      if (cw > 0.5 && fract((alongX ? q.y : q.x) / 1.2) < 0.55) col = uLine * 0.9;
    }
  } else if (walk > 0.5) {
    col = uWalk * (0.92 + noise);
    if (abs(min(a.x, a.y) - uRoadH) < 0.25) col = vec3(0.62, 0.6, 0.58); // curb
    vec2 sl = fract(vWorld.xz / 1.5); if (sl.x < 0.04 || sl.y < 0.04) col *= 0.88; // slabs
  }
  col *= uShadeC; // the street sits in the cool canyon shade
  gl_FragColor = vec4(col, 1.0);
  }
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  if (uQ4.y > 0.5) gl_FragColor.rgb = fog2(gl_FragColor.rgb, vWorld, uSunDir);
  else {
  #include <fog_fragment>
  }
}`;

// ---------------------------------------------------------------------------- fire escape panels
const FE_VERT = /* glsl */`
attribute vec2 aSize; varying vec2 vM; varying vec3 vWorld; varying float vW; varying float vFeNear;
#include <common>
#include <fog_pars_vertex>
void main() { vM = vec2(position.x * aSize.x, position.y * aSize.y); vW = aSize.x; vec3 feO = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; vFeNear = step(distance(feO.xz, cameraPosition.xz), 16.0); vec4 wp = modelMatrix * instanceMatrix * vec4(position.x * aSize.x, position.y * aSize.y, 0.0, 1.0); vWorld = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`;
const FE_FRAG = /* glsl */`
uniform float uFeAA, uFeKit;
varying vec2 vM; varying vec3 vWorld; varying float vW; varying float vFeNear;
#include <common>
#include <fog_pars_fragment>
void main() {
  float fl = 3.3; float y = mod(vM.y, fl); float x = vM.x;
  float a;
  if (uFeAA > 0.5) {
    // v0.27 'feaa': coverage from the pixel footprint (alpha-to-coverage with the 4× MSAA target) instead of a
    // hard discard — thin rails / bars no longer crawl at a distance; once a bar is far below a pixel it fades
    float wy = max(fwidth(vM.y), 1e-4), wx = max(fwidth(x), 1e-4); // (not fwidth(y): y = mod(…) jumps at every landing)
    float cov = 1.0 - smoothstep(0.0, 1.0, max(wx, wy) / 0.14); // whole fire escape thins out when its parts are < ~1/7 px… 1 px
    float rail = max(1.0 - smoothstep(0.05 - wy, 0.05 + wy, abs(y - 1.0)), 1.0 - smoothstep(0.08 - wy, 0.08 + wy, abs(y - 0.08)));
    float bx = abs(fract(x / 0.42 + 0.44) - 0.5) * 0.42; // distance to the bar centre (bar width 0.05 m)
    float bars = (1.0 - smoothstep(0.025 - wx, 0.025 + wx, bx)) * step(y, 1.0) * step(0.1, y);
    float t = y / fl, dir = mod(floor(vM.y / fl), 2.0) < 0.5 ? 1.0 : -1.0;
    float sx = dir * mix(-vW * 0.5 + 0.35, vW * 0.5 - 0.35, t);
    float stair = 1.0 - smoothstep(0.07 - wx, 0.07 + wx, abs(x - sx));
    a = clamp(max(max(rail, bars * 0.9), stair), 0.0, 1.0);
    a = mix(a * 0.55, a, cov); // far away: lighter (the average coverage), not a sparkle of whole-pixel bars
    if (a < 0.03) discard;
  } else {
    float rail = step(abs(y - 1.0), 0.05) + step(abs(y - 0.08), 0.08); // top rail + platform edge
    float bars = step(fract(x / 0.42), 0.12) * step(y, 1.0) * step(0.1, y);
    float t = y / fl, dir = mod(floor(vM.y / fl), 2.0) < 0.5 ? 1.0 : -1.0;
    float sx = dir * mix(-vW * 0.5 + 0.35, vW * 0.5 - 0.35, t); // the stair between two landings
    float stair = step(abs(x - sx), 0.07) + step(abs(x - sx), 0.3) * step(fract(y / 0.22), 0.3) * 0.0;
    a = clamp(rail + bars * 0.9 + stair, 0.0, 1.0);
    if (a < 0.5) discard;
    a = 1.0;
  }
  if (uFeKit > 0.5 && vFeNear > 0.5) discard; // v0.30b: the kit's real fire escape is shown (same 16 m ground-distance switch, no dither)
  vec3 col = vec3(0.11, 0.1, 0.11) * mix(0.8, 1.2, smoothstep(10.0, 40.0, vWorld.y));
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// ---------------------------------------------------------------------------- pooled instanced details
export class SlotPool {
  // v0.26: packed pool. Only the used instances are drawn (mesh.count = used). Before, every pool drew its whole
  // capacity each pass (unused slots were zero-scaled but still went through the vertex shader): ~160k wasted
  // triangles per pass in the main view AND again in the mirror. Release swaps the last live instance into the hole;
  // owners keep a handle object whose .i follows the move.
  constructor(mesh, cap) { this.mesh = mesh; this.cap = cap; this.handles = []; mesh.count = 0; mesh.frustumCulled = false; this.inst = Object.values(mesh.geometry.attributes).filter((a) => a.isInstancedBufferAttribute); }
  get used() { return this.handles.length; }
  alloc() { if (this.handles.length >= this.cap) return null; const h = { i: this.handles.length }; this.handles.push(h); this.mesh.count = this.handles.length; return h; }
  release(h) {
    if (!h || h.i < 0) return;
    const i = h.i, last = this.handles.length - 1, m = this.mesh;
    if (i !== last) {
      const hl = this.handles[last];
      m.instanceMatrix.array.copyWithin(i * 16, last * 16, last * 16 + 16);
      if (m.instanceColor) m.instanceColor.array.copyWithin(i * 3, last * 3, last * 3 + 3);
      for (const a of this.inst) a.array.copyWithin(i * a.itemSize, last * a.itemSize, (last + 1) * a.itemSize);
      hl.i = i; this.handles[i] = hl;
    }
    this.handles.pop(); h.i = -1; m.count = this.handles.length; this.dirty = true;
  }
  set(h, m) { this.mesh.setMatrixAt(h.i, m); this.dirty = true; }
  flush() {
    if (!this.dirty) return;
    const m = this.mesh; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    for (const a of this.inst) a.needsUpdate = true;
    this.dirty = false;
  }
}

// ---------------------------------------------------------------------------- the city
export function createCity({ world = cityWorld } = {}) {
  const cfg = CITY_CFG;
  const root = new THREE.Group(); root.name = 'City';
  const mat = buildingMaterial();
  const unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const tmpM = new THREE.Matrix4(), tmpE = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpN = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpC = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0), ZAX = new THREE.Vector3(0, 0, 1), ONE = new THREE.Vector3(1, 1, 1);
  const decorMat = toonMaterial({ vertexColors: true }); decorMat.name = 'city-decor';
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }); glowMat.name = 'city-glow';

  // ---------------- per-cell building meshes (object pool)
  function makeInstGeo(cap) {
    const g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv']) g.setAttribute(k, unit.attributes[k]);
    g.setIndex(unit.index);
    g.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    g.setAttribute('aStyle', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
    g.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    g.setAttribute('aParams', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2));
    return g;
  }
  const cellPool = [];
  const cellGroup = new THREE.Group(); cellGroup.name = 'CityCells'; root.add(cellGroup);
  for (let k = 0; k < cfg.pools.cells; k++) {
    const m = new THREE.InstancedMesh(makeInstGeo(cfg.pools.perCell), mat, cfg.pools.perCell);
    m.count = 0; m.visible = false; m.name = `cell${k}`; m.matrixAutoUpdate = false;
    cellGroup.add(m); cellPool.push({ m, cell: null });
  }
  const acquireCellMesh = () => cellPool.find((p) => !p.cell) || null;
  /** Write building boxes (tiers + cornices) into an instanced mesh, starting at index n. */
  function writeBuildings(m, list, start, cap, withCornice) {
    const g = m.geometry, A = g.attributes;
    let n = start;
    for (const b of list) {
      if (b.role) continue; // home tower / factory: dedicated meshes
      for (let k = 0; k < b.tiers.length && n < cap; k++) {
        const t = b.tiers[k];
        tmpM.makeRotationY(b.yaw).setPosition(b.x, t.y0, b.z); m.setMatrixAt(n, tmpM);
        A.aSize.setXYZ(n, t.hx * 2, t.y1 - t.y0, t.hz * 2); A.aStyle.setX(n, b.style); A.aSeed.setX(n, (b.seed % 1000) / 1000);
        A.aTint.setXYZ(n, b.tint[0], b.tint[1], b.tint[2]); A.aParams.setXYZW(n, b.lit, k === 0 && b.shops ? 1 : 0, b.shadowLine, 0); A.aOff.setXY(n, 0, t.y0 ? 0 : 0);
        n++;
        if (withCornice && n < cap && b.style !== STYLE.glass && b.style !== STYLE.darkGlass) {
          const top = t.y1;
          tmpM.makeRotationY(b.yaw).setPosition(b.x, top - 0.55, b.z); m.setMatrixAt(n, tmpM);
          A.aSize.setXYZ(n, t.hx * 2 + 0.7, 0.9, t.hz * 2 + 0.7); A.aStyle.setX(n, STYLE_CORNICE); A.aSeed.setX(n, 0.3); A.aTint.setXYZ(n, b.tint[0], b.tint[1], b.tint[2]); A.aParams.setXYZW(n, 0, 0, b.shadowLine, 0); A.aOff.setXY(n, 0, 0);
          n++;
        }
      }
    }
    return n;
  }
  const flushInst = (m, n) => {
    m.count = n; m.instanceMatrix.needsUpdate = true;
    for (const k of ['aSize', 'aStyle', 'aSeed', 'aTint', 'aParams', 'aOff']) m.geometry.attributes[k].needsUpdate = true;
    m.computeBoundingSphere();
  };

  // ---------------- global detail pools
  const details = {}; let feMat = null;
  const mkPool = (name, geo, material, cap, colors = false) => { const m = new THREE.InstancedMesh(geo, material, cap); m.name = name; if (colors) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); root.add(m); details[name] = new SlotPool(m, cap); return details[name]; };
  { // water tower (legs, platform, barrel, cone roof)
    const b = new Bucket(), I = new THREE.Matrix4();
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(I, 0.22, 4, 0.22, 0x3a3238, dx * 1.5, 2, dz * 1.5);
    b.box(I, 3.4, 0.2, 3.4, 0x3a3238, 0, 4, 0);
    b.geo(I, ...CYL(2.0, 2.0, 3.6, 12), 0x7a5236, 0, 5.9, 0);
    for (const y of [4.8, 6.0, 7.2]) b.geo(I, ...CYL(2.04, 2.04, 0.12, 12), 0x2a2224, 0, y, 0);
    b.geo(I, ...CONE(2.25, 1.4, 12), 0x4a3430, 0, 8.4, 0);
    const lm = new THREE.MeshLambertMaterial({ vertexColors: true }); lm.name = 'water-towers';
    mkPool('waterTowers', b.build(), lm, cfg.pools.waterTowers);
  }
  { const lm = new THREE.MeshLambertMaterial({ color: 0xffffff }); lm.name = 'roof-boxes'; mkPool('roofBoxes', unit, lm, cfg.pools.roofBoxes, true); }
  {
    const fm = new THREE.ShaderMaterial({ vertexShader: FE_VERT, fragmentShader: FE_FRAG, fog: true, side: THREE.DoubleSide, alphaToCoverage: true, uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uFeAA: { value: 1 }, uFeKit: { value: 0 } } }); fm.name = 'fire-escapes'; feMat = fm;
    const g = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    g.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(cfg.pools.fireEscapes * 2), 2));
    mkPool('fireEscapes', g, fm, cfg.pools.fireEscapes);
  }
  { // street lamp: pole + arm (dark), head glow (separate pool)
    const b = new Bucket(), I = new THREE.Matrix4();
    b.geo(I, ...CYL(0.09, 0.13, 6.4, 6), 0x2a2a30, 0, 3.2, 0); b.box(I, 0.08, 0.08, 1.6, 0x2a2a30, 0, 6.3, 0.75);
    const lm = new THREE.MeshLambertMaterial({ vertexColors: true }); lm.name = 'lamps';
    mkPool('lamps', b.build(), lm, cfg.pools.lamps);
    const hm = new THREE.MeshBasicMaterial({ color: 0xffd08a, toneMapped: false }); hm.name = 'lamp-heads';
    mkPool('lampHeads', new THREE.BoxGeometry(0.42, 0.18, 0.6), hm, cfg.pools.lamps);
  }
  { // One instanced batch for the trunk and cutout leaves.
    const lm = new THREE.MeshLambertMaterial({ vertexColors: true, map: treeLeafTexture(), alphaTest: FOLIAGE_CUTOFF });
    lm.name = 'trees';
    mkPool('trees', streetTreeGeometry(), lm, cfg.pools.trees, true);
  }
  { // anchor bracket plate + LED (each anchor is a visible steel fixing)
    const pm = new THREE.MeshLambertMaterial({ color: 0x2c3040 }); pm.name = 'anchor-brackets';
    mkPool('brackets', new THREE.BoxGeometry(0.8, 0.8, 0.16), pm, cfg.pools.brackets);
    const lm = new THREE.MeshBasicMaterial({ color: 0x6ae4ff, toneMapped: false }); lm.name = 'anchor-leds';
    mkPool('leds', new THREE.BoxGeometry(0.3, 0.3, 0.1), lm, cfg.pools.brackets);
    const mm = new THREE.MeshLambertMaterial({ color: 0x4a4652 }); mm.name = 'masts';
    mkPool('masts', new THREE.CylinderGeometry(0.12, 0.22, 1, 6).translate(0, 0.5, 0), mm, cfg.pools.masts);
  }

  // ---------------- backdrop (same silhouettes as the real cells, beyond the active area)
  const backCap = cfg.backdropMax;
  // v0.26: double-buffered + time-sliced. The hidden buffer is rebuilt a few cells per frame (≤ backdropBudgetMs,
  // ≤ 1 new module layout generated per frame), then the two swap. Before, one refresh rebuilt ~1100 instances and
  // could generate 3 module layouts in a single frame (measured spikes up to 7.7 ms on desktop).
  const backBufs = [0, 1].map((k) => { const m = new THREE.InstancedMesh(makeInstGeo(backCap), mat, backCap); m.name = 'CityBackdrop'; m.count = 0; m.frustumCulled = false; m.visible = k === 0; root.add(m); return m; });
  let backdrop = backBufs[0], backJob = null;
  let backAt = null, backDirty = true, backT = 0;

  // ---------------- ground + skyline + sky colour
  const G = (cfg.backdropFarRadius || cfg.backdropRadius) * 2 + cfg.cell * 4; // v0.27: covers the far backdrop ring too
  const groundMat = new THREE.ShaderMaterial({ vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG, fog: true, uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uGrid: { value: new THREE.Vector2() }, uCell: { value: cfg.cell }, uRoadH: { value: cfg.road / 2 }, uWalkH: { value: cfg.street / 2 },
    uRoad: { value: new THREE.Color(0x3a3a42) }, uWalk: { value: new THREE.Color(0x8a8480) }, uLine: { value: new THREE.Color(0xd8d4cc) }, uYellow: { value: new THREE.Color(0xd8a840) }, uShadeC: { value: new THREE.Color(0.78, 0.8, 0.95) },
    uQG: { value: 0 }, uQG2: { value: 0 }, uNoise: { value: cityNoiseTexture() },
    uQ3: { value: new THREE.Vector4() }, uQ4: { value: new THREE.Vector4() }, uSunDir: { value: SUN_DIRECTION.clone() }, uSunColor: { value: new THREE.Color(0xffb27a).multiplyScalar(1.25) },
  }]) });
  Object.assign(groundMat.uniforms, CITY_SHARED, { uFxP0: FX_LIGHT.uFxP0, uFxC0: FX_LIGHT.uFxC0, uFxP1: FX_LIGHT.uFxP1, uFxC1: FX_LIGHT.uFxC1 });
  groundMat.name = 'streets';
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(G, G).rotateX(-Math.PI / 2), groundMat); ground.name = 'Streets'; ground.renderOrder = 0; root.add(ground);
  const skyline = (() => {
    const tex = canvasTexture(2048, 256, (ctx, W, H) => {
      const r = rng(303); ctx.clearRect(0, 0, W, H);
      for (const [col, maxH, minH, wmin] of [['rgba(150,120,150,0.75)', 200, 40, 10], ['rgba(110,90,120,0.92)', 150, 24, 14]]) {
        let x = 0;
        while (x < W) { const w = wmin + r() * 22, h = minH + Math.pow(r(), 2) * maxH; ctx.fillStyle = col; ctx.fillRect(x, H - h, w, h); if (r() < 0.25) { ctx.fillRect(x + w * 0.35, H - h - 14, w * 0.3, 14); } x += w + r() * 4; }
      }
    }, { repeat: true, mipmaps: true });
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide, toneMapped: true });
    m.name = 'skyline';
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(cfg.skylineRadius, cfg.skylineRadius, 300, 64, 1, true).translate(0, 120, 0), m);
    // v0.49: drawn FIRST among the see-through things (it is the farthest thing in the city). It was drawn late (950), so it was
    // painted over anything see-through in front of it that leaves the depth buffer alone: the menus, the HUD banner, effects.
    mesh.name = 'Skyline'; mesh.renderOrder = -5; mesh.frustumCulled = false;
    return mesh;
  })();
  root.add(skyline);

  // ---------------- v0.27 near-art layers (ledges, awnings, curbs, corner kits, signs, cars, traffic, trees, skyline)
  const art = createCityArt({ root, mat, groundMat, makeInstGeo, SlotPool, world, cfg, STYLE_P, STYLE_CORNICE });
  const skylineV1 = skyline.material.map;
  // ---------------- v0.30: materials, neighbour shadows, modular kit, city life
  roomAtlas(); loadCityPBR().then((ok) => ok || loadCityPBR()).then((ok) => { if (ok) CITY_SHARED.uPbrOn.value = 1; });
  const heightField = createHeightField(world);
  const kit = createCityKit({ root, world, cfg, SlotPool, STYLE_P, details, art, mat });
  const life = createCityLife({ root, world, cfg, art, kit });

  // ---------------- home tower A (window hole) + factory exterior (dedicated)
  const home = buildHome(mat, decorMat, glowMat); home.visible = false; root.add(home);
  let factory = null;
  const ensureFactory = () => { if (!factory) { factory = createFactoryExterior(KEY_BUILDINGS[1], { decorMat, glowMat }); factory.root.visible = false; root.add(factory.root); } return factory; };

  // ---------------- streaming: cell visuals
  const jobs = []; // cells waiting for visuals
  const stats = { cellsUsed: 0, cellsCap: cfg.pools.cells, instances: 0, detailCells: 0, backdrop: 0, buildMs: 0, maxBuildMs: 0, queue: 0, poolMiss: 0 };
  const visualOf = new Map();
  world.on({
    cellAdded: (c) => { jobs.push(c); heightField.markDirty(); },
    cellRemoved: (c) => { const i = jobs.indexOf(c); if (i >= 0) jobs.splice(i, 1); releaseCell(c); backDirty = true; heightField.markDirty(); },
    cellRoleChanged: () => { backDirty = true; },
    rebased: (dx, dz) => shiftAll(dx, dz),
  });
  function buildCellVisual(c) {
    const t0 = performance.now();
    const p = acquireCellMesh();
    if (!p) { stats.poolMiss++; world.markReady(c); return; } // pool exhausted: still playable (data), visuals skipped
    p.cell = c;
    const n = writeBuildings(p.m, c.buildings, 0, cfg.pools.perCell, true);
    flushInst(p.m, n); p.m.visible = true;
    visualOf.set(c, { p, detail: null });
    if (c.buildings.some((b) => b.id === 'A')) home.visible = true;
    if (c.buildings.some((b) => b.id === 'C')) ensureFactory().root.visible = true;
    world.markReady(c);
    const ms = performance.now() - t0; stats.buildMs = ms; stats.maxBuildMs = Math.max(stats.maxBuildMs, ms);
    backDirty = true;
  }
  function releaseCell(c) {
    const v = visualOf.get(c); if (!v) return;
    releaseDetail(v); art.releaseAll(v); kit.releaseAll(c);
    v.p.cell = null; v.p.m.visible = false; v.p.m.count = 0;
    if (c.buildings.some((b) => b.id === 'A')) home.visible = false;
    if (c.buildings.some((b) => b.id === 'C') && factory) factory.root.visible = false;
    visualOf.delete(c);
  }
  // ---- details (only near the player)
  const W = (T, x, z) => [T.cx + x * T.cos + z * T.sin, T.cz - x * T.sin + z * T.cos];
  function assignDetail(c, v) {
    const T = c.T, P = c.content.props, slots = [];
    const put = (pool, m) => { const h = details[pool].alloc(); if (!h) return -1; details[pool].set(h, m); slots.push([pool, h]); return h.i; }; // index valid until the next release
    const vh = (x, z, n) => Math.abs(Math.round(x * 7.31 + z * 13.17)) % n; // stable per-prop variant (was the pool slot index)
    for (const [x, y, z, s, rot] of P.waterTowers) { const [wx, wz] = W(T, x, z); tmpM.compose(tmpP.set(wx, y, wz), tmpQ.setFromAxisAngle(UP, rot + T.yaw), tmpS.setScalar(s)); put('waterTowers', tmpM); }
    for (const [x, y, z, w, h, d, type] of P.roofBoxes) { const [wx, wz] = W(T, x, z); tmpM.compose(tmpP.set(wx, y, wz), tmpQ.setFromAxisAngle(UP, T.yaw), tmpS.set(w, h, d)); const i = put('roofBoxes', tmpM); if (i >= 0) details.roofBoxes.mesh.setColorAt(i, tmpC.set(type ? 0x9a96a2 : [0x8a7a6e, 0x6e6662, 0x9a8a7a][vh(x, z, 3)])); }
    for (const [x, z, nx, nz, w, y0, y1] of P.fireEscapes) {
      const [wx, wz] = W(T, x, z), wn = [nx * T.cos + nz * T.sin, -nx * T.sin + nz * T.cos];
      tmpM.compose(tmpP.set(wx, y0, wz), tmpQ.setFromUnitVectors(ZAX, tmpN.set(wn[0], 0, wn[1])), ONE);
      const i = put('fireEscapes', tmpM); if (i >= 0) details.fireEscapes.mesh.geometry.attributes.aSize.setXY(i, w, y1 - y0);
    }
    for (const [x, z, nx, nz] of P.lamps) {
      const [wx, wz] = W(T, x, z), wn = [nx * T.cos + nz * T.sin, -nx * T.sin + nz * T.cos], yaw = Math.atan2(wn[0], wn[1]);
      tmpM.compose(tmpP.set(wx, 0, wz), tmpQ.setFromAxisAngle(UP, yaw), tmpS.setScalar(1)); put('lamps', tmpM);
      tmpM.compose(tmpP.set(wx + wn[0] * 1.5, 6.2, wz + wn[1] * 1.5), tmpQ, tmpS.setScalar(1)); put('lampHeads', tmpM);
    }
    for (const [x, z, s] of P.trees) { const [wx, wz] = W(T, x, z); tmpM.compose(tmpP.set(wx, 0, wz), tmpQ.setFromAxisAngle(UP, (x * 13.1 + z) % 6.28), tmpS.set(s, s * (0.9 + (Math.abs(x * 7 + z) % 0.3)), s)); const i = put('trees', tmpM); if (i >= 0) details.trees.mesh.setColorAt(i, tmpC.setHSL(0.24 + vh(x, z, 5) * 0.012, 0.35, 0.42 + vh(z, x, 3) * 0.04)); }
    for (const [x, y, z, h] of P.masts) { const [wx, wz] = W(T, x, z); tmpM.compose(tmpP.set(wx, y, wz), tmpQ.identity(), tmpS.set(1, h, 1)); put('masts', tmpM); }
    for (const a of c.anchors) {
      const n = tmpN.set(a.normal[0], a.normal[1], a.normal[2]);
      tmpQ.setFromUnitVectors(ZAX, n);
      if (a.kind !== 'mast') { tmpM.compose(tmpP.set(a.pos[0] - n.x * 0.27, a.pos[1], a.pos[2] - n.z * 0.27), tmpQ, ONE); put('brackets', tmpM); }
      tmpM.compose(tmpP.set(a.pos[0] - n.x * 0.16, a.pos[1] - (a.kind === 'mast' ? 0.2 : 0), a.pos[2] - n.z * 0.16), tmpQ, ONE); put('leds', tmpM);
    }
    v.detail = slots;
  }
  function releaseDetail(v) { if (!v.detail) return; for (const [pool, i] of v.detail) details[pool].release(i); v.detail = null; }

  // ---- rebase: every world-space position shifts by (dx, dz)
  function shiftAll(dx, dz) {
    pendingShift[0] += dx; pendingShift[1] += dz;
    { const a = backdrop.instanceMatrix.array; for (let i = 0; i < backdrop.count; i++) { a[i * 16 + 12] += dx; a[i * 16 + 14] += dz; } backdrop.instanceMatrix.needsUpdate = true; }
    backJob = null; backGenPending = false; // a half-built buffer holds pre-rebase positions: start over
    for (const p of cellPool) if (p.cell) {
      const m = p.m, e = tmpE;
      for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, e); e.elements[12] += dx; e.elements[14] += dz; m.setMatrixAt(i, e); }
      m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere();
    }
    art.shift(dx, dz); kit.shift(dx, dz); life.shift(dx, dz); heightField.shift(dx, dz);
    for (const d of Object.values(details)) {
      const a = d.mesh.instanceMatrix.array;
      for (let i = 0; i < d.used; i++) { a[i * 16 + 12] += dx; a[i * 16 + 14] += dz; }
      d.dirty = true;
    }
    home.position.x += dx; home.position.z += dz; home.updateMatrixWorld(true);
    if (factory) { factory.root.matrix.elements[12] += dx; factory.root.matrix.elements[14] += dz; factory.root.updateMatrixWorld(true); }
    backDirty = true;
  }

  // ---- backdrop refresh (generator: resumable across frames)
  function* backdropJob(camX, camZ) {
    const [ci, cj] = world.cellOf(camX, camZ);
    const RF = quality?.farring ? cfg.backdropFarRadius || cfg.backdropRadius : cfg.backdropRadius; // v0.27: far ring (backdropRadius … RF) = simplified massing
    const R = Math.ceil(RF / cfg.cell);
    const target = backBufs[backdrop === backBufs[0] ? 1 : 0];
    const A = target.geometry.attributes; let n = 0, more = false;
    const order = [];
    for (let di = -R; di <= R; di++) for (let dj = -R; dj <= R; dj++) order.push([di * di + dj * dj, ci + di, cj + dj]);
    order.sort((a, b) => a[0] - b[0]); // near first: if the cap is hit, the far ring is what gets dropped
    for (const [, i, j] of order) {
      if (n >= backCap) break;
      if (world.cells.has(`${i},${j}`)) continue;
      const [cx, cz] = world.cellCenter(i, j), dc = Math.hypot(cx - camX, cz - camZ); if (dc > RF + cfg.cell * 0.7) continue;
      const far = dc > cfg.backdropRadius + cfg.cell * 0.7;
      let L = world.layoutAt(i, j, false);
      if (!L) { yield 'gen'; L = world.layoutAt(i, j, true); } // generating a module layout costs ~0.1–1 ms: at most one per slice
      if (!L) { more = true; continue; }
      const T = L.T;
      for (const b of L.content.buildings) {
        if (b.role || n >= backCap) continue;
        if (far && b.h < 32) continue; // far ring: only what can rise above the nearer roofs
        const [x, z] = W(T, b.lx, b.lz);
        for (const t of (far ? [{ hx: b.hx, hz: b.hz, y0: 0, y1: b.h }] : b.tiers)) {
          if (n >= backCap) break;
          tmpM.makeRotationY(T.yaw).setPosition(x, t.y0, z); target.setMatrixAt(n, tmpM);
          A.aSize.setXYZ(n, t.hx * 2, t.y1 - t.y0, t.hz * 2); A.aStyle.setX(n, b.style); A.aSeed.setX(n, (b.seed % 1000) / 1000); A.aTint.setXYZ(n, b.tint[0], b.tint[1], b.tint[2]); A.aParams.setXYZW(n, b.lit, 0, b.shadowLine, 0); A.aOff.setXY(n, 0, 0);
          n++;
        }
      }
      yield 'cell';
    }
    yield 'cell'; // the upload + swap get a slice of their own
    target.count = n; target.instanceMatrix.needsUpdate = true; // (no bounding sphere: the backdrop is never frustum-culled)
    for (const k of ['aSize', 'aStyle', 'aSeed', 'aTint', 'aParams', 'aOff']) target.geometry.attributes[k].needsUpdate = true;
    target.frustumCulled = false;
    backdrop.visible = false; target.visible = true; backdrop = target; // swap
    stats.backdrop = n; stats.backSwaps = (stats.backSwaps || 0) + 1;
    backAt = [ci, cj]; return more;
  }
  /** Advance the backdrop rebuild for up to `ms`; at most one module layout is generated per call (unless unbounded). */
  let backGenPending = false;
  function stepBackdrop(ms) {
    const t0 = performance.now(), unbounded = ms >= 1e6; let gens = backGenPending ? 1 : 0; backGenPending = false;
    while (backJob) {
      const r = backJob.next();
      if (r.done) { backJob = null; backDirty = r.value; backT = r.value ? 0.05 : 0.5; break; }
      if (r.value === 'gen' && !unbounded) { if (gens >= 1) { backGenPending = true; break; } gens++; }
      if (!unbounded && performance.now() - t0 > ms) { if (r.value === 'gen') backGenPending = true; break; }
    }
  }



  // ---------------- v0.25 quality switches (original v0.24 look ↔ new look, per feature) — renderer only
  let quality = null;
  function setQuality(flags = cityQualityFlags()) {
    quality = { ...flags };
    mat.uniforms.uQ.value.set(flags.win ? 1 : 0, flags.var ? 1 : 0, flags.ao ? 1 : 0, flags.shade ? 1 : 0);
    groundMat.uniforms.uQG.value = flags.ground ? 1 : 0;
    mat.uniforms.uQ2.value.x = flags.ledge ? 1 : 0; // the art layers are released / rebuilt by pump() (one cell-layer per frame)
    groundMat.uniforms.uQG2.value = flags.lampglow ? 1 : 0;
    if (feMat) feMat.uniforms.uFeAA.value = flags.feaa ? 1 : 0;
    // v0.30 switches (uniforms only: no shader recompiles)
    for (const m of [mat, groundMat]) {
      m.uniforms.uQ3.value.set(flags.interior ? 1 : 0, flags.refl ? 1 : 0, flags.nshadow ? 1 : 0, flags.rim ? 1 : 0);
      m.uniforms.uQ4.value.set(flags.pbr ? 1 : 0, flags.fog2 ? 1 : 0, 0, flags.fxlight ? 1 : 0);
    }
    heightField.setEnabled(!!flags.nshadow); setSkyQuality(!!flags.clouds);
    skyline.material.color.set(flags.fog2 ? 0x8c8cc4 : 0xffffff); // v0.30: far skyline as deep blue-violet silhouettes (aerial perspective), not pale see-through 'ghost' towers
    kit.setFlags(flags); life.setFlags(flags);
    art.setFlags(flags, { treesPool: details.trees, skylineMesh: skyline, skylineV1 });
    backDirty = true; backT = 0; backJob = null; // far ring on / off → rebuild the backdrop
    const want = facadeArray(!!flags.tex), had = mat.uniforms.uFacade.value;
    if (had !== want) { mat.uniforms.uFacade.value = want; if (had) { had.dispose(); for (const k of ['v0', 'v1']) if (_facade[k] === had) _facade[k] = null; } } // only one variant stays in GPU memory
    return quality;
  }
  setQuality();

  // ---------------- per-frame
  let suspended = false, sortT = 0; const pendingShift = [0, 0];
  function update(dt, cam, vel) {
    if (suspended || !cam) return;
    pendingShift[0] = pendingShift[1] = 0;
    world.update(cam, vel || { x: 0, y: 0, z: 0 }, dt);
    // an origin rebase inside world.update() moved everything by pendingShift — the caller's camera position was taken
    // before it: stream with the shifted position (otherwise every near layer / car was ~1500 m 'out of range' for one
    // frame and was released, then popped back in over 1–2 s)
    if (pendingShift[0] || pendingShift[1]) cam = { x: cam.x + pendingShift[0], y: cam.y, z: cam.z + pendingShift[1] };
    pump(cam, cfg.buildBudgetMs);
    art.update(dt, cam); // traffic + signal phases
    if (quality?.nshadow) heightField.update(cam, dt);
    life.update(dt, cam); kit.update(dt, cam);
  }
  /** Build pending cell visuals within the time budget + details / backdrop / follow meshes. */
  function pump(cam, budget) {
    const t0 = performance.now();
    if (jobs.length > 1) jobs.sort((a, b) => world.distToCell(a.i, a.j, cam.x, cam.z) - world.distToCell(b.i, b.j, cam.x, cam.z));
    while (jobs.length && performance.now() - t0 < budget) buildCellVisual(jobs.shift());
    stats.queue = jobs.length;
    const t1 = performance.now(); stats.phBuild = t1 - t0;
    // details by distance (hysteresis)
    // v0.26: at most ONE cell gets its details per frame (the nearest waiting one), and one cell its ledges —
    // several cells crossing detailRange in the same frame used to stack up (measured up to 6 ms on desktop)
    let dc = 0, nearC = null, nearV = null, nearD = Infinity;
    for (const [c, v] of visualOf) {
      const d = world.distToCell(c.i, c.j, cam.x, cam.z);
      if (!v.detail && d < cfg.detailRange) { if (budget >= 1e6) assignDetail(c, v); else if (d < nearD) { nearD = d; nearC = c; nearV = v; } }
      else if (v.detail && d > cfg.detailRange + 30) releaseDetail(v);
      if (v.detail) dc++;
    }
    if (nearC) { assignDetail(nearC, nearV); dc++; }
    const artOk = !nearC && performance.now() - t0 < 1.5; // v0.27: never a detail cell AND an art layer in one frame
    stats.detailCells = dc;
    for (const d of Object.values(details)) d.flush();
    art.stream(visualOf, cam, budget >= 1e6, artOk); // ≤ 1 cell-layer per frame (nearest first)
    kit.stream(visualOf, cam, budget >= 1e6, Math.max(0, Math.min(0.7, 2.0 - (performance.now() - t0)))); // v0.30: time-sliced kit layers (only what is left of a 2 ms pump slice)
    const t2 = performance.now(); stats.phDetail = t2 - t1;
    // backdrop when the player changes cell or cells come / go (throttled)
    backT -= 1 / 60;
    const [ci, cj] = world.cellOf(cam.x, cam.z);
    if (!backJob && ((backDirty && backT <= 0) || !backAt || backAt[0] !== ci || backAt[1] !== cj)) { backJob = backdropJob(cam.x, cam.z); backDirty = false; }
    if (backJob) stepBackdrop(budget >= 1e6 ? 1e9 : Math.min(cfg.backdropBudgetMs ?? 1, budget)); // setFocus (loading screens): finish now
    stats.phBack = performance.now() - t2;
    // follow meshes
    const [gx, gz] = world.cellCenter(0, 0);
    groundMat.uniforms.uGrid.value.set(gx, gz);
    ground.position.set(Math.round(cam.x / cfg.cell) * cfg.cell, 0, Math.round(cam.z / cfg.cell) * cfg.cell);
    skyline.position.set(cam.x, 0, cam.z);
    // front-to-back order (cheap early-z for the many facade layers)
    sortT -= 1 / 60;
    if (sortT <= 0) {
      sortT = 0.25;
      const used = cellPool.filter((p) => p.cell).sort((a, b) => world.distToCell(a.cell.i, a.cell.j, cam.x, cam.z) - world.distToCell(b.cell.i, b.cell.j, cam.x, cam.z));
      used.forEach((p, i) => { p.m.renderOrder = 1 + i; });
      stats.cellsUsed = used.length; stats.instances = used.reduce((s, p) => s + p.m.count, 0);
    }
    stats.pumpMs = performance.now() - t0; // v0.25: whole streaming slice this frame (perf probe spikes)
  }
  /** Build everything around p now (startup, behind black Loading screens). */
  function setFocus(p, vel) {
    suspended = false; root.visible = true;
    for (let k = 0; k < 4; k++) { world.update(p, vel || { x: 0, y: 0, z: 0 }, 1 / 60, { force: true }); pump(p, 1e9); }
    if (quality?.nshadow) { heightField.markDirty(); heightField.update(p, 1); }
    kit.update(0, p); life.update(0, p);
  }
  /** Factory interior active: hide everything and free all cell visuals + data (the route itself is kept). */
  function suspend() {
    suspended = true; root.visible = false;
    art.clearTraffic();
    for (const c of [...world.cells.values()]) world._removeCell(c);
    jobs.length = 0;
  }
  function resume() { suspended = false; root.visible = true; }
  const pendingNear = (p, range = 160) => world.pendingNear(p, range) + jobs.filter((c) => world.distToCell(c.i, c.j, p.x, p.z) < range).length;
  const stream = (p, ms = 8) => { world.update(p, { x: 0, y: 0, z: 0 }, 1 / 60, { force: true }); pump(p, ms); };

  return {
    root, update, stream, setFocus, suspend, resume, pendingNear, stats, world, setQuality, get quality() { return quality; }, kit, life, heightField,
    /** v0.30: bake the sky reflection cube once (call after the sky exists, before XR); returns the texture or null. */
    bakeReflections: (renderer, sky) => bakeSkyReflection(renderer, [sky, skyline]),
    get suspended() { return suspended; }, art,
    get factory() { return factory || ensureFactory(); },
    home, details, materials: { buildings: mat, decor: decorMat, glow: glowMat, ground: groundMat },
    rebarSite: new THREE.Group(), rebarBeams: [], // (legacy story props: none in v0.20)
    drawCallsEstimate: () => cellPool.filter((p) => p.cell && p.m.visible).length + Object.keys(details).length + 4,
  };
}

// ---------------------------------------------------------------------------- home tower A (Mobius' building)
function buildHome(mat, decorMat, glowMat) {
  const A = KEY_BUILDINGS[0], hx = A.hw, hz = A.hd, h = A.h;
  const g = new THREE.Group(); g.name = 'HomeTowerA';
  // walls with the room window hole on the north face (z = −hz), roof
  const pos = [], nrm = [], idx = [];
  const quad = (a, b, c, d, n) => { const o = pos.length / 3; pos.push(...a, ...b, ...c, ...d); for (let k = 0; k < 4; k++) nrm.push(...n); idx.push(o, o + 1, o + 2, o, o + 2, o + 3); };
  const wx0 = ROOM.origin[0] + ROOM.window.xMin - A.x, wx1 = ROOM.origin[0] + ROOM.window.xMax - A.x, wy0 = ROOM.origin[1] + ROOM.window.yMin, wy1 = ROOM.origin[1] + ROOM.window.yMax;
  // north face (normal −z), split around the hole: seen from the north, x runs right→left (+x → −x)
  const N = [0, 0, -1], zN = -hz;
  quad([hx, 0, zN], [-hx, 0, zN], [-hx, wy0, zN], [hx, wy0, zN], N);
  quad([hx, wy1, zN], [-hx, wy1, zN], [-hx, h, zN], [hx, h, zN], N);
  quad([hx, wy0, zN], [wx1, wy0, zN], [wx1, wy1, zN], [hx, wy1, zN], N);
  quad([wx0, wy0, zN], [-hx, wy0, zN], [-hx, wy1, zN], [wx0, wy1, zN], N);
  quad([-hx, 0, hz], [hx, 0, hz], [hx, h, hz], [-hx, h, hz], [0, 0, 1]); // south
  quad([hx, 0, hz], [hx, 0, -hz], [hx, h, -hz], [hx, h, hz], [1, 0, 0]); // east
  quad([-hx, 0, -hz], [-hx, 0, hz], [-hx, h, hz], [-hx, h, -hz], [-1, 0, 0]); // west
  quad([-hx, h, hz], [hx, h, hz], [hx, h, -hz], [-hx, h, -hz], [0, 1, 0]); // roof
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  const nV = pos.length / 3, rep = (k, a) => Float32Array.from({ length: nV * k }, (_, i) => a[i % k]);
  // window bays centred on the room window (u offset), floors on the room's 3.6 m storeys
  const uCentre = -(ROOM.origin[0] - A.x) + 2; // shader u of the window centre on the north face (aSize = 1)
  const uOff = (((1.5 - uCentre) % 3) + 3) % 3; // a facade window bay centred on the room window
  geo.setAttribute('aSize', new THREE.Float32BufferAttribute(rep(3, [1, 1, 1]), 3));
  geo.setAttribute('aStyle', new THREE.Float32BufferAttribute(rep(1, [STYLE.brownBrick]), 1));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(rep(1, [0.0]), 1));
  geo.setAttribute('aTint', new THREE.Float32BufferAttribute(rep(3, [1.0, 0.97, 0.94]), 3));
  geo.setAttribute('aParams', new THREE.Float32BufferAttribute(rep(4, [0.3, 1, 24, 3.6]), 4));
  geo.setAttribute('aOff', new THREE.Float32BufferAttribute(rep(2, [uOff, 0]), 2));
  geo.computeBoundingSphere();
  // aSize = 1 → vSize used for the cornice band: pass the real size through a uniform-free trick (the tower's
  // own height): the cornice band is drawn by the decor mesh below instead.
  const walls = new THREE.Mesh(geo, mat); walls.name = 'HomeWalls';
  const b = new Bucket(), I = new THREE.Matrix4();
  // cornice + parapet, water tower, stair bulkhead, AC, antenna (as in v0.9)
  const t = 0.6, y = h - 0.55, hh = 0.9;
  b.box(I, hx * 2 + 0.8, hh, t, 0xe8d4bc, 0, y, -hz + 0.1); b.box(I, hx * 2 + 0.8, hh, t, 0xe8d4bc, 0, y, hz - 0.1);
  b.box(I, t, hh, hz * 2 - 0.2, 0xe8d4bc, -hx + 0.1, y, 0); b.box(I, t, hh, hz * 2 - 0.2, 0xe8d4bc, hx - 0.1, y, 0);
  for (const [w, d, x, z] of [[hx * 2, 0.35, 0, -hz + 0.17], [hx * 2, 0.35, 0, hz - 0.17], [0.35, hz * 2, -hx + 0.17, 0], [0.35, hz * 2, hx - 0.17, 0]]) b.box(I, w, 0.9, d, 0xc0a488, x, h + 0.45, z);
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(I, 0.22, 4, 0.22, 0x3a3238, -7 + dx * 1.5, h + 2, 6 + dz * 1.5);
  b.box(I, 3.4, 0.2, 3.4, 0x3a3238, -7, h + 4, 6); b.geo(I, ...CYL(2.0, 2.0, 3.6, 12), 0x8a5a3c, -7, h + 5.9, 6); b.geo(I, ...CONE(2.2, 1.3, 12), 0x5a3a34, -7, h + 8.35, 6);
  b.box(I, 6, 3.4, 4.5, 0xa87a64, 5, h + 1.7, 7); b.box(I, 6.4, 0.3, 4.9, 0x6a4a40, 5, h + 3.55, 7);
  b.box(I, 2.4, 1.2, 1.6, 0x9c98a6, 4, h + 0.6, -4); b.box(I, 2.4, 1.2, 1.6, 0x9c98a6, 7.5, h + 0.6, -4);
  b.geo(I, ...CYL(0.08, 0.15, 9, 5), 0x6a6474, -9, h + 4.5, -9);
  // storey bands every 4 floors (stone) + fire escape on the west face
  for (let f = 4; f < 28; f += 4) { const yy = f * 3.6 - 0.2; for (const [w, d, x, z] of [[hx * 2 + 0.3, 0.25, 0, -hz - 0.1], [hx * 2 + 0.3, 0.25, 0, hz + 0.1], [0.25, hz * 2 + 0.3, -hx - 0.1, 0], [0.25, hz * 2 + 0.3, hx + 0.1, 0]]) b.box(I, w, 0.25, d, 0xd2c0a4, x, yy, z); }
  const decor = new THREE.Mesh(b.build(), decorMat); decor.name = 'HomeDecor';
  const glow = new Bucket(); glow.geo(I, 'aviation', () => new THREE.OctahedronGeometry(0.3), 0xff3050, -9, h + 9.1, -9);
  const glowMesh = new THREE.Mesh(glow.build(), glowMat);
  g.add(walls, decor, glowMesh);
  g.position.set(A.x, 0, A.z); g.rotation.y = A.yaw; g.updateMatrixWorld(true);
  void FACTORY_EXT; void HOME_LOCAL;
  return g;
}
