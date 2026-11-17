// v0.31 factory interior: the rebuild that matches docs/reference/factory/ (top / eye-level / side views).
// Blender (tools/blender/build_factory_v2.py + bake_factory_v2.py) → public/models/factory_v2/*:
//   factory_v2.glb  one primitive per source material; merged here into 5 draw calls by group:
//     atlas (opaque CC0 PBR atlas, 4×4 tiles) · floor (wet concrete) · cutout (grating, banners, cobwebs) · emissive · plenum
//   lightmap.webp / lightmap_floor.webp  Cycles bake, RGBM HDR (range 8): warm pools AND deep shadows survive
//   probe.webp      equirectangular reflection probe from the hall centre (1.2 m), box-projected on the floor
// No post-processing, no shadow maps, no reflection pass; real-time lights = the v0.30 five (for the boss / bombs only).
// Same API as the v0.30 interior (src/art/factory.js), which stays selectable (?fq=0 / settings.factoryQ = 'v0').
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { INTERIOR } from '../data/factory.js';
import { HALL_SHOW } from '../game/hallShow.js';
import { canvasTexture, rng } from './toon.js';
import { Billboards, StaticGlows, softTexture } from './particles.js';
import { factoryFlags } from './factoryQuality.js';

const DIR = 'models/factory_v2/';
const _I4 = new THREE.Matrix4();
const LM_RANGE = 8.0;
const F = INTERIOR;
const HALL = { min: new THREE.Vector3(-F.size.w / 2, 0, -F.size.d / 2), max: new THREE.Vector3(F.size.w / 2, 14.6, F.size.d / 2) };
const PROBE_POS = new THREE.Vector3(0, 1.2, 0);
/** v0.48: the lane corridor in hall-local metres: the three lanes (0.9 m apart at the rings, 1.7 m at Green Maniac's end, bands 0.42 m wide)
 *  plus HALL_SHOW.corridorPad each side, from behind the player's circle to the north door. No show term applies inside it. */
export const CORRIDOR = { xHalf: 1.7 + 0.5 + HALL_SHOW.corridorPad, /* lanes 1.7 m apart at Green Maniac's end, bands now 0.99 m wide there (2026-11-15: wider lanes) */ zNorth: -F.size.d / 2, zSouth: F.arenaCircle.pos[2] + F.arenaCircle.radius };
const SHOW_LIGHT = 0.12; // the two warm hall lights follow the show by this share of its swing (25 % → 3 %; the design allows up to 15 %)

// material name → [group, tile, tint r, g, b]  (tiles: tools/assets/fetch_cc0_factory.py)
const T = (tile, r = 1, g = 1, b = 1) => ['atlas', tile, r, g, b];
const MAP = {
  steel: T(0), steel_blue: T(0, 0.85, 0.9, 1.0), steel_dark: T(1), wall_panel: T(2), corrugated: T(3), brick: T(10, 1.05, 0.72, 0.6),
  yellow: T(4), yellow_dirty: T(4, 0.62, 0.56, 0.45), paint_yellow: T(4), sign: T(4), rolldoor: T(5),
  // r3: machines = painted steel (blue plate / green paint tiles, tinted toward the reference's grey-green), not the brown tile
  machine_green: T(6, 1.1, 1.06, 1.35), machine_olive: T(6, 1.3, 1.08, 1.4), machine_grey: T(2, 1.38, 1.32, 1.12), machine_teal: T(2, 1.0, 1.2, 0.85),
  cabinet_cream: T(2, 1.85, 1.58, 1.02), red_door: T(7, 1.5, 0.35, 0.28), wood: T(8), steel_rust: T(9, 0.85, 0.85, 0.9), rubble: T(10, 0.72, 0.78, 0.86),
  drum_purple: T(11), copper: T(12), hazard: T(13), pumpkin: T(14), pumpkin_stem: T(6, 0.5, 0.65, 0.3), rubber: T(15), cable: T(15), cloth_purple: T(11),
  grating: ['cutout', 0], banner_purple: ['cutout', 1], banner_orange: ['cutout', 2], web: ['cutout', 3],
  floor_v2: ['floor', 0], concrete: ['floor', 0], plenum: ['plenum', 0],
  // emissive: [group, flicker class (0 lamp hum, 1 candle, 2 led, 3 ember, 4 steady), r, g, b] (linear, before tone mapping)
  lamp_bulb: ['emissive', 0, 3.2, 1.75, 0.7], lamp_warm: ['emissive', 0, 2.6, 1.35, 0.5], lamp_purple: ['emissive', 0, 1.3, 0.6, 2.6],
  led_green: ['emissive', 2, 0.35, 2.2, 0.6], led_red: ['emissive', 2, 2.4, 0.3, 0.2], led_orange: ['emissive', 2, 2.3, 1.0, 0.15],
  pumpkin_glow: ['emissive', 1, 4.2, 2.4, 0.55], ember: ['emissive', 3, 2.0, 0.6, 0.1], emblem: ['emissive', 4, 1.2, 0.7, 0.3], window: ['emissive', 4, 0.9, 0.5, 0.2],
};

// per-tile albedo gain: linear target luminance / measured CC0 tile mean (tools/assets/fetch_cc0_factory.py atlas)
const TILE_GAIN = [1.7, 3.0, 2.4, 3.2, 1.0, 1.45, 2.1, 3.6, 1.4, 1.4, 3.4, 1.2, 1.3, 1.0, 1.0, 4.0];
// ------------------------------------------------------------------ shared GLSL
// v0.48 hall show (src/game/hallShow.js → setShow): every term is 0 at rest, so the hall then renders exactly as before.
//   uShow  = (pulse swing, gain: miss dip / chorus dim (−) and burst (+), strips+LEDs pulse on, accent mix)
//   uShowB = (pulse phase 0…1 (0 = start of the rise), attack / period, fall / period, lamp chase amount)
//   uShowC = (candle flare, floor-streak boost, Fan Web floor wave radius, its strength)
//   uCorr  = lane corridor in hall-local metres (half width, north z, south z): nothing inside it takes part
const SHOW = /* glsl */`
uniform vec4 uShow, uShowB, uShowC, uShowD, uShowE; uniform vec3 uShowHue, uCorr; // uShowE.x = ceiling light boost (lamps, their cones and pools; 0 at rest) // uShowD = (light band strength, its place 0…1 down the hall, colour wash, pumpkin hop height in m)
float showMask(vec3 lp) { return 1.0 - (1.0 - smoothstep(uCorr.x, uCorr.x + 0.25, abs(lp.x))) * step(uCorr.y, lp.z) * step(lp.z, uCorr.z); }
float showSm(float x) { x = clamp(x, 0.0, 1.0); return x * x * (3.0 - 2.0 * x); }
float showEnv(float ph) { ph = fract(ph); float a = max(uShowB.y, 1e-4), fl = max(uShowB.z, 1e-4); return ph < a ? showSm(ph / a) : 1.0 - showSm((ph - a) / fl); }
float showZn(float z) { return clamp((uCorr.z + 8.0 - z) / (uCorr.z + 8.0 - uCorr.y), 0.0, 1.0); } // 0 at the player's end, 1 at the north door
float showPulse(float z) { return uShow.x * showEnv(uShowB.x - showZn(z) * uShowB.w); }               // lamps: the same pulse, later toward the back (the chase)
// baked light outside the corridor: follows its lamps at half their swing, a band of light runs down the hall on each pulse,
// and the walls take a wash of the accent colour on the beat
vec3 showLM(vec3 lp) {
  float d = (showZn(lp.z) - uShowD.y) / 0.075, band = uShowD.x * exp(-d * d);
  float g = (1.0 + max(0.5 * showPulse(lp.z), band)) * (1.0 + 0.6 * uShow.y);
  return mix(vec3(1.0), g * mix(vec3(1.0), uShowHue, uShowD.z), showMask(lp));
}
// decorative pumpkins hop on the beat: up and down over the half pulse after the beat (0 at rest). base = the pumpkin's foot.
float showHop(vec3 base) { float u = fract(uShowB.x - uShowB.y) / 0.5; return uShowD.w * (u < 1.0 ? 4.0 * u * (1.0 - u) : 0.0) * showMask(base); }
`;
const COMMON = /* glsl */`
${SHOW}
uniform float uTime, uLMGain, uExposureFix, uRefl, uDbg; uniform vec3 uFogCold, uFogWarm; uniform vec4 uFog; // x density, y north boost, z height boost, w max
vec3 rgbm(vec4 c) { return c.rgb * c.a * ${LM_RANGE.toFixed(1)}; }
// reference grade: dim light turns cool blue-violet (#2C3247 / #4A2F5E shadows), the lamp pools stay hot amber
vec3 grade(vec3 l) {
  l = mix(l, vec3(l.r, l.g, min(l.b, max(l.r, l.g) * 1.15)), 0.8); /* r4: purple wash mostly gone (accent only) */   // tame the baked purple wash (keep it as an accent)
  float y = dot(l, vec3(0.3, 0.55, 0.15));
  // r2: value structure like the reference — dim areas sink to cool steel-blue, lit areas go hot amber (contrast S-curve)
  vec3 cool = vec3(y) * vec3(0.58, 0.64, 0.9) * mix(0.35, 0.9, smoothstep(0.0, 0.35, y)); /* r4: darker gaps between pools */
  vec3 warm = l * vec3(1.42, 1.0, 0.58) * (1.0 + 0.8 * smoothstep(0.3, 1.2, y));
  return mix(cool, warm, smoothstep(0.06, 0.45, y)); } /* r4: warm-dominant pools */
// readability (S7): the roll-up door + its lamps / hazard frame sit right behind the bomb paths → held down to a dim silhouette
float doorDim(vec3 p) { return mix(1.0, 0.32, (1.0 - smoothstep(-17.2, -16.2, p.z)) * (1.0 - smoothstep(3.6, 4.6, abs(p.x))) * (1.0 - smoothstep(7.0, 8.0, p.y))); }
// depth fog: denser toward the north and with height; blue-purple far, warm near the floor lamps
uniform vec3 uHallMin, uHallMax;
// r3: fog only accumulates INSIDE the hall (section views from outside the shell see a clean cutaway; in-game the camera
//     is always inside, so this is a no-op there)
float hallInside(vec3 c, vec3 p) {
  vec3 r = p - c; vec3 inv = 1.0 / (abs(r) + 1e-4) * sign(r + 1e-6);
  vec3 t1 = (uHallMin - c) * inv, t2 = (uHallMax - c) * inv;
  float tn = max(max(min(t1.x, t2.x), min(t1.y, t2.y)), min(t1.z, t2.z));
  return 1.0 - clamp(tn, 0.0, 1.0);
}
vec3 hallFog(vec3 col, vec3 lp, float dist, vec3 view) {
  dist *= hallInside(lp + view, lp);
  float north = clamp((-lp.z + 18.0) / 36.0, 0.0, 1.0);
  float d = uFog.x * (1.0 + uFog.y * north) * (1.0 + uFog.z * clamp(lp.y / 12.0, 0.0, 1.0));
  float f = clamp(1.0 - exp(-dist * d), 0.0, uFog.w);
  return mix(col, mix(uFogWarm, uFogCold, clamp(north * 0.7 + lp.y / 14.0, 0.0, 1.0)), f);
}`;
const PROBE = /* glsl */`
uniform sampler2D uProbe; uniform vec3 uBoxMin, uBoxMax, uProbePos; uniform float uProbeOn;
vec3 boxProject(vec3 p, vec3 r) { // parallax-corrected direction (hall bounds), probe at the hall centre
  vec3 t1 = (uBoxMax - p) / r, t2 = (uBoxMin - p) / r; vec3 tf = max(t1, t2); float t = min(min(tf.x, tf.y), tf.z);
  return normalize(p + r * t - uProbePos);
}
vec3 probe(vec3 d, float rough) { // equirect: u = 0.5 + atan(x, −z)/2π (north at the centre), v = 0.5 − asin(y)/π
  vec2 uv = vec2(0.5 + atan(d.x, -d.z) / 6.2831853, 0.5 - asin(clamp(d.y, -1.0, 1.0)) / 3.1415927);
  return rgbm(textureLod(uProbe, uv, rough * 7.0));
}`;
const VERT = /* glsl */`
${SHOW}
attribute vec2 aUv1; attribute vec4 aCol, aLight, aHop; attribute float aTile; attribute vec3 aTint; // aHop: (foot x, y, z, 10 + size) on a decorative pumpkin's vertices, else 0
uniform float uTime, uSway, uPropsOff;
varying vec2 vUv, vUv1; varying vec4 vCol; varying float vTile; varying vec3 vTint, vLp, vN, vView, vLight; varying float vDist; varying float vCull;
void main() {
  vCull = fract(sin(dot(floor(position.xz / vec2(2.2, 2.2)), vec2(12.9898, 78.233))) * 43758.5453); /* r4: per-cluster hash (unswayed) */
  vUv = uv; vUv1 = aUv1; vCol = aCol; vTile = aTile; vTint = aTint; vLight = aLight.rgb * aLight.a * 8.0; // per-vertex baked light (RGBM) for the small parts
  vec3 p = position;
  if (uSway > 0.5 && aCol.a > 0.001) { // banners / cobwebs: wind from the breach (south-west), gentle (≤ 0.5 Hz)
    float ph = p.x * 0.7 + p.z * 0.45;
    p.x += aCol.a * (0.10 * sin(uTime * 1.3 + ph) + 0.05 * sin(uTime * 2.9 + ph * 1.7));
    p.z += aCol.a * (0.12 * sin(uTime * 1.1 + ph * 0.8) - 0.04);
  }
  if (aHop.w > 5.0 && uShowD.w > 0.0) { // v0.48: decorative pumpkins hop on the beat, with a little stretch going up and squash coming down
    float sc = aHop.w - 10.0, hop = showHop(aHop.xyz), k = hop / uShowD.w;
    p.y = aHop.y + (p.y - aHop.y) * (1.0 + 0.14 * k) + hop * sc;
    p.xz = aHop.xz + (p.xz - aHop.xz) * (1.0 - 0.07 * k);
  }
  vLp = p;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vView = cameraPosition - wp.xyz; vDist = length(vView);
  gl_Position = projectionMatrix * viewMatrix * wp;
  if (uPropsOff > 0.5 && aCol.r < 0.75) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // dev toggle 'props': drop the optional dressing
}`;

// derivative TBN (no tangents in the glb)
const PERTURB = /* glsl */`
vec3 perturb(vec3 n, vec3 pos, vec2 uv, vec3 mapN) {
  vec3 q0 = dFdx(pos), q1 = dFdy(pos); vec2 st0 = dFdx(uv), st1 = dFdy(uv);
  vec3 q1p = cross(q1, n), q0p = cross(n, q0);
  vec3 T = q1p * st0.x + q0p * st1.x, B = q1p * st0.y + q0p * st1.y;
  float det = max(dot(T, T), dot(B, B)); float sc = det == 0.0 ? 0.0 : inversesqrt(det);
  return normalize(T * (mapN.x * sc) + B * (mapN.y * sc) + n * mapN.z);
}`;

const ATLAS_FRAG = /* glsl */`
${COMMON}
${PROBE}
${PERTURB}
uniform sampler2D uAlb, uNrm, uOrm, uLM; uniform float uTileGain[16]; uniform float uGradK;
varying vec2 vUv, vUv1; varying vec4 vCol; varying float vTile; varying vec3 vTint, vLp, vN, vView, vLight; varying float vDist;
vec2 tileUv(vec2 uv, float t) { vec2 o = vec2(mod(t, 4.0), floor(t / 4.0)) * 0.25; return o + (fract(uv) * 0.9375 + 0.03125) * 0.25; }
void main() {
  float t = floor(vTile + 0.5);
  vec2 g = vUv * 0.25 * 0.9375; vec2 dx = dFdx(g) * uGradK, dy = dFdy(g) * uGradK; vec2 tu = tileUv(vUv, t); // r2: wider filter footprint → less texture shimmer (Quest too)
  vec3 alb = textureGrad(uAlb, tu, dx, dy).rgb * vTint * uTileGain[int(t)]; // CC0 tiles normalised to plausible albedo (dark steel ≈ 0.1–0.2 linear)
  vec3 orm = textureGrad(uOrm, tu, dx, dy).rgb;
  vec3 nm = textureGrad(uNrm, tu, dx, dy).xyz * 2.0 - 1.0;
  float wear = smoothstep(0.3, 0.75, vCol.g) * (1.0 - 0.8 * smoothstep(5.0, 16.0, vDist)), grime = vCol.b; // r2: far bevel highlights fade (they alias into crawling lines)
  float paint = (t == 0.0 || t == 1.0 || t == 2.0 || t == 4.0 || t == 6.0 || t == 7.0 || t == 13.0) ? 1.0 : 0.0;
  // baked curvature wear: painted edges chip to bright bare steel (catches the light like the reference)
  float chip = wear * paint * smoothstep(0.3, 0.6, orm.g * 0.7 + 0.3 * textureGrad(uOrm, tileUv(vUv * 3.1, t), dx * 3.1, dy * 3.1).g);
  alb = mix(alb, vec3(0.42, 0.43, 0.46), chip * 0.75);
  alb *= 1.0 - 0.38 * grime;
  bool vtx = vUv1.x > 0.99 && vUv1.y > 0.99;
  vec3 lm = (vtx ? vLight : rgbm(texture2D(uLM, vUv1))) * uLMGain * showLM(vLp);
  if (vtx) lm = max(lm, vec3(0.1, 0.09, 0.1));
  if (vLp.y < 0.35) lm = max(lm, vec3(0.2, 0.18, 0.2)); // r3: floor chips / bricks never read as black holes // r2: small parts on the floor (rubble chips) never go pure black
  { // r3: the rubble mound under the breach is lit by the moonlight shaft (the bake leaves it in the sheets' shadow)
    float rub = (1.0 - smoothstep(2.6, 4.2, length((vLp.xz - vec2(-8.2, 14.7)) * vec2(1.0, 0.9)))) * (1.0 - smoothstep(2.6, 4.2, vLp.y)); /* r4: taller mound + girders */
    lm = max(lm, mix(vec3(0.0), vec3(0.2, 0.24, 0.38), rub)) + vec3(0.05, 0.06, 0.1) * rub; }
  lm = grade(lm);
  if (uDbg > 0.5 && uDbg < 1.5) lm = vec3(0.6); if (uDbg > 1.5) { gl_FragColor = vec4(fract(vUv1 * 64.0), 0.0, 1.0); return; }
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  vec3 nd = perturb(n, vLp, vUv, nm * vec3(1.0, 1.0, 1.0));
  vec3 col = alb * lm * mix(1.0, orm.r, 0.7) * (0.82 + 0.36 * clamp(dot(nd, normalize(vec3(0.25, 0.9, 0.35))) - dot(n, normalize(vec3(0.25, 0.9, 0.35))) + 0.5, 0.0, 1.0));
  col += alb * wear * paint * 0.35 * lm; // painted edge highlight
  col += alb * vec3(0.012, 0.012, 0.02);   // ambient fill (r2: lower — keep the reference's deep blacks) (the bake's bounce light under-reads in the headset; no crushed blacks)
  if (t == 4.0 || t == 13.0) col += alb * vec3(0.07, 0.06, 0.04); // safety-yellow paint reads from across the hall (ref: bright railings)
  if (t == 14.0) col = col * 0.62 + alb * vec3(0.16, 0.08, 0.01); // pumpkins: darker skin so the glowing carved face reads (candle inside)
  if (uProbeOn > 0.5) {
    vec3 V = normalize(vView); vec3 R = reflect(-V, nd);
    float rough = clamp(orm.g * (1.0 - 0.4 * chip), 0.08, 1.0), metal = orm.b;
    float F = 0.04 + 0.96 * pow(1.0 - clamp(dot(nd, V), 0.0, 1.0), 5.0);
    vec3 env = probe(boxProject(vLp, R), rough);
    col += env * mix(F, 0.6, metal) * (1.0 - rough) * (1.0 - rough) * 0.55 * (1.0 - grime * 0.6);
  }
  col *= doorDim(vLp);
  col = hallFog(col, vLp, vDist, vView);
  gl_FragColor = vec4(col * uExposureFix, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const FLOOR_FRAG = /* glsl */`
${COMMON}
${PROBE}
${PERTURB}
uniform sampler2D uFAlb, uFNrm, uFOrm, uPaint, uLMF;
varying vec2 vUv, vUv1; varying vec4 vCol; varying float vTile; varying vec3 vTint, vLp, vN, vView, vLight; varying float vDist;
void main() {
  vec2 d = vLp.xz / 3.0;                                   // CC0 concrete detail, 3 m tiles
  vec3 alb = vec3(dot(texture2D(uFAlb, d).rgb / vec3(0.034, 0.030, 0.027), vec3(0.333))) * 0.16; // r2b: grey (the CC0 scan is brown) // CC0 detail (linear mean ≈ 0.03) normalised to dark polished concrete
  vec3 orm = texture2D(uFOrm, d).rgb;
  vec3 nm = texture2D(uFNrm, d).xyz * 2.0 - 1.0;
  vec4 paint = texture2D(uPaint, vUv);                       // slab seams, cracks, stains, safety lines, hazard boxes; a = wetness
  float ylw = clamp((paint.r - paint.b) * 4.0 - 0.4, 0.0, 1.0);   // safety-yellow paint
  alb = alb * paint.rgb * 1.5 * mix(vec3(0.82, 0.9, 1.08), vec3(1.5, 1.3, 0.7), ylw); // blue-grey concrete, saturated yellow lines
  float wet = paint.a * (1.0 - ylw);
  alb *= 1.0 - 0.35 * wet;                                   // wet concrete is darker
  vec3 lm = rgbm(texture2D(uLMF, vUv1)) * uLMGain * showLM(vLp);
  lm = pow(lm * 0.72 / 0.9, vec3(1.7)) * 0.9;               // deeper falloff between the lamp pools (reference contrast)
  { float y = dot(lm, vec3(0.3, 0.55, 0.15));  // r2b: neutral grey concrete (ref), cool between the pools, amber only in the hot pools
    vec3 neutral = vec3(y) * vec3(0.9, 0.88, 0.9); /* r4: grey concrete between pools */
    vec3 hot = lm * vec3(1.3, 0.95, 0.6) * (1.0 + 0.5 * smoothstep(0.9, 1.8, y));
    lm = mix(vec3(y) * vec3(0.48, 0.52, 0.82), mix(neutral, hot, smoothstep(0.6, 1.4, y)), smoothstep(0.15, 0.7, y)); }
  lm += vec3(0.035, 0.03, 0.02) * ylw; // painted lines stay readable between the pools
  vec3 n = vec3(0.0, 1.0, 0.0);
  vec3 nd = perturb(n, vLp, d, mix(nm, vec3(0.0, 0.0, 1.0), 0.55 + 0.4 * wet));
  vec3 col = alb * lm * mix(1.0, orm.r, 0.5);
  if (uProbeOn > 0.5) {
    vec3 V = normalize(vView); vec3 R = reflect(-V, nd);
    float rough = mix(clamp(orm.g, 0.25, 0.9), 0.04, wet);
    float F = 0.04 + 0.96 * pow(1.0 - clamp(dot(nd, V), 0.0, 1.0), 5.0);
    vec3 env = probe(boxProject(vLp, R), rough);
    col += env * (F * 1.2 + 0.1) * (1.0 - rough) * mix(0.45, 1.3, wet) * uRefl;
  }
  col = hallFog(col, vLp, vDist, vView);
  gl_FragColor = vec4(col * uExposureFix, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const CUTOUT_FRAG = /* glsl */`
${COMMON}
uniform sampler2D uCut, uLM;
varying vec2 vUv, vUv1; varying vec4 vCol; varying float vTile; varying vec3 vTint, vLp, vN, vView, vLight; varying float vDist; varying float vCull;
void main() {
  float t = floor(vTile + 0.5);
  if ((t == 1.0 || t == 2.0) && vCull < 0.5) discard; /* r4: half the banner clusters (ref: sparse tattered pennants) */
  vec2 o = vec2(mod(t, 2.0), floor(t / 2.0)) * 0.5;
  vec2 uv = t == 0.0 ? fract(vUv) : clamp(vUv, 0.002, 0.998);
  vec4 c = texture2D(uCut, o + (uv * 0.98 + 0.01) * 0.5);
  if (c.a < 0.5) discard;
  vec3 lm = ((vUv1.x > 0.99 && vUv1.y > 0.99) ? vLight : rgbm(texture2D(uLM, vUv1))) * uLMGain * showLM(vLp);
  lm = grade(lm);
  if (t > 0.5) lm = max(lm, vec3(0.26, 0.2, 0.24)) * (t == 3.0 ? 0.7 : 1.9); // cloth / webs: translucent cloth catches more light
  vec3 col = c.rgb * lm;
  col = hallFog(col, vLp, vDist, vView);
  gl_FragColor = vec4(col * uExposureFix, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const EMIT_FRAG = /* glsl */`
${COMMON}
uniform float uLife;
varying vec2 vUv, vUv1; varying vec4 vCol; varying float vTile; varying vec3 vTint, vLp, vN, vView, vLight; varying float vDist;
void main() {
  float k = floor(vTile + 0.5); float ph = dot(floor(vLp * 2.0), vec3(1.7, 3.1, 2.3));
  float f = 1.0;
  if (uLife > 0.5) { // slow drifts only (comfort: nothing above 3 Hz, small amplitude)
    if (k == 0.0) f = 1.0 + 0.035 * sin(uTime * 2.1 + ph) + 0.02 * sin(uTime * 0.7 + ph * 1.3);       // lamp hum
    else if (k == 1.0) f = 1.0 + 0.10 * sin(uTime * 2.6 + ph) + 0.06 * sin(uTime * 4.1 + ph * 2.0);   // candle (≤ 0.7 Hz)
    else if (k == 2.0) f = step(0.15, fract(uTime * 0.25 + fract(ph * 0.37))) * 0.85 + 0.15;          // LEDs: some blink at 0.25 Hz
    else if (k == 3.0) f = 0.8 + 0.2 * sin(uTime * 1.7 + ph);
  }
  // v0.48 show: side lamps breathe on the beat (and chase), candles breathe and flare, strips and LEDs take the accent colour
  vec3 tint = vTint; float g = 1.0; bool strip = k == 0.0 && vTint.b > vTint.r * 1.2;
  if (k == 0.0 && !strip) g = (1.0 + 0.6 * uShowE.x) * (1.0 + showPulse(vLp.z)); // ceiling lamps: brighter while the show runs, and on the beat
  else if (k == 1.0) g += max(uShow.x * showEnv(uShowB.x), uShowC.x); // candle orange stays: only its brightness moves, never above the level's swing
  else if (strip || k == 2.0) { g += uShow.x * uShow.z * showEnv(uShowB.x); tint = mix(vTint, uShowHue * dot(vTint, vec3(0.33333)), uShow.w * (strip ? 1.0 : 0.6)); }
  float sm = showMask(vLp); g = mix(1.0, g * (1.0 + uShow.y), sm); tint = mix(vTint, tint, sm);
  gl_FragColor = vec4(tint * f * g * doorDim(vLp), 1.0);
  gl_FragColor.rgb = hallFog(gl_FragColor.rgb, vLp, vDist * 0.5, vView);
  #include <colorspace_fragment>
}`;


// r2: the closed plenum above the roof breach shows a night sky with the moon (direction-only, like a skybox; static stars)
const SKY_VERT = /* glsl */`varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const SKY_FRAG = /* glsl */`
uniform vec3 uMoon, uHallC, uHallH; varying vec3 vW;
float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
void main() {
  vec3 lc = cameraPosition - uHallC; if (any(greaterThan(abs(lc), uHallH))) { gl_FragColor = vec4(0.035, 0.04, 0.05, 1.0); return; } // seen from outside (section views): the plenum housing
  vec3 d = normalize(vW - cameraPosition);
  float up = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(vec3(0.11, 0.13, 0.26), vec3(0.035, 0.045, 0.12), up); // moonlit night (reads as sky, not a hole)
  float m = dot(d, uMoon);
  col += vec3(0.6, 0.68, 1.0) * pow(max(m, 0.0), 80.0) * 0.5 + vec3(0.3, 0.36, 0.65) * pow(max(m, 0.0), 8.0) * 0.16; // halo
  col = mix(col, vec3(1.6, 1.65, 1.8), smoothstep(0.9975, 0.998, m));                                             // moon disc
  vec3 q = floor(d * 220.0); float st = step(0.993, h3(q)); col += vec3(0.7, 0.75, 0.9) * st * (1.0 - smoothstep(0.98, 1.0, m));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
// streaks: lamp reflections on the wet floor, stretched TOWARD THE CAMERA (instanced, 1 draw call)
const STREAK_VERT = /* glsl */`
${SHOW}
attribute vec3 aC; attribute vec2 aWL; attribute vec3 aRGB;
uniform vec3 uCam; varying vec2 vQ; varying vec3 vRGB; varying float vNear;
void main() {
  vec3 c = aC; vec2 toCam = uCam.xz - c.xz; float L = length(toCam); vec2 dir = L > 1e-3 ? toCam / L : vec2(0.0, 1.0);
  vec2 side = vec2(-dir.y, dir.x);
  float len = aWL.y * (0.7 + 0.6 * clamp(L / 12.0, 0.0, 1.0));
  vec2 p = c.xz + side * position.x * aWL.x + dir * (position.y + 0.15) * len;
  // v0.48 show: the streaks breathe with their lamps, are brighter at level 3, and carry the Fan Web floor wave outward from the player
  float wd = length(c.xz - vec2(0.0, uCorr.z - 1.3)) - uShowC.z;
  float sg = (1.0 + 0.5 * uShowE.x) * (1.0 + showPulse(c.z) + uShowC.y + min(uShow.x, uShowC.w * exp(-wd * wd * 0.35))) * (1.0 + uShow.y);
  vQ = position.xy * 2.0; vRGB = aRGB * mix(1.0, sg, showMask(c)); vNear = smoothstep(0.6, 2.5, L);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p.x, 0.015, p.y, 1.0);
}`;
const STREAK_FRAG = /* glsl */`
varying vec2 vQ; varying vec3 vRGB; varying float vNear;
void main() { float a = (1.0 - smoothstep(0.0, 1.0, abs(vQ.x))) * (1.0 - smoothstep(-0.2, 1.0, abs(vQ.y))); gl_FragColor = vec4(vRGB * a * a * vNear, 1.0); }`;

// cones / beams: additive, soft edges (view angle), fade near the camera
const CONE_VERT = /* glsl */`
attribute vec3 color; varying vec3 vC, vL; varying float vEdge, vNear;
void main() { vC = color; vL = position; vec4 wp = modelMatrix * vec4(position, 1.0); vec3 n = normalize(mat3(modelMatrix) * normal); vec3 v = normalize(cameraPosition - wp.xyz);
  vEdge = abs(dot(n, v)); vNear = smoothstep(0.8, 3.5, length(cameraPosition - wp.xyz)); gl_Position = projectionMatrix * viewMatrix * wp; }`;
const CONE_FRAG = /* glsl */`
${SHOW}
uniform float uOpacity; varying vec3 vC, vL; varying float vEdge, vNear;
void main() {
  bool lamp = vC.b <= vC.r; // (the moonlight shaft takes no part)
  float m = lamp ? showMask(vL) : 0.0, g = mix(1.0, (1.0 + uShowE.x) * (1.0 + 3.0 * showPulse(vL.z)) * (1.0 + uShow.y), m); // the light cones swell on the beat …
  vec3 c = mix(vC, uShowHue * dot(vC, vec3(0.33333)), m * min(1.0, uShowD.z * 2.0)); // … and take the accent colour
  gl_FragColor = vec4(c * uOpacity * g * smoothstep(0.05, 0.7, vEdge) * vNear, 1.0); }`;

function mistTexture() {
  return canvasTexture(256, 256, (ctx, S) => {
    const r = rng(73); ctx.clearRect(0, 0, S, S);
    for (let k = 0; k < 40; k++) { const x = r() * S, y = r() * S, rad = 30 + r() * 70; const g = ctx.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { ctx.save(); ctx.translate(dx, dy); ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2); ctx.restore(); } }
  }, { repeat: true });
}

export function createFactoryInteriorV2() {
  const Q = factoryFlags();
  const { h } = F.size;
  const root = new THREE.Group(); root.name = 'FactoryInterior'; root.visible = false;
  root.position.set(...F.origin);
  const disposables = [];
  const own = (x) => { if (x && !disposables.includes(x)) disposables.push(x); return x; };
  const lights = [];
  let fx = null, ready = false, mist = null, glows = null, streakMat = null, dress = null;
  const show = { downbeat: 0, done: 0, level: 0, light: 0 }; // v0.48: what setShow last stored (uniforms aside)
  const showU = () => ({ uShow: shared.uShow, uShowB: shared.uShowB, uShowC: shared.uShowC, uShowD: shared.uShowD, uShowE: shared.uShowE, uShowHue: shared.uShowHue, uCorr: shared.uCorr });
  const stats = { tris: 0, materials: 0, drawCalls: 0, version: 'v0.31', flags: Q };
  const B = F.breach;
  const U = (() => { try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); } })(); // dev tuning (?fgain=, ?ffog=, ?frefl=)
  const shared = {
    uShow: { value: new THREE.Vector4() }, uShowB: { value: new THREE.Vector4() }, uShowC: { value: new THREE.Vector4() }, uShowD: { value: new THREE.Vector4() }, uShowE: { value: new THREE.Vector4() }, uShowHue: { value: new THREE.Vector3(1, 1, 1) }, uCorr: { value: new THREE.Vector3(CORRIDOR.xHalf, CORRIDOR.zNorth, CORRIDOR.zSouth) }, // v0.48 hall show (all 0 = at rest)
    uTime: { value: 0 }, uLMGain: { value: +(U.get('fgain') || 1.5) }, uExposureFix: { value: +(U.get('fexp') || 0.85) /* r4: shimmer budget + less haze */ }, uRefl: { value: +(U.get('frefl') || 3.0) }, uDbg: { value: +(U.get('fdbg') || 0) },
    uFog: { value: new THREE.Vector4(+(U.get('ffog') || 0.03), 1.2, 0.8, +(U.get('ffogmax') || 0.55)) }, uFogCold: { value: new THREE.Color(0x1b1f36) }, uFogWarm: { value: new THREE.Color(0x4a2c18) },
    uProbe: { value: null }, uBoxMin: { value: HALL.min.clone() }, uHallMin: { value: HALL.min.clone() }, uHallMax: { value: HALL.max.clone() }, uBoxMax: { value: HALL.max.clone() }, uProbePos: { value: PROBE_POS.clone() }, uProbeOn: { value: Q.probe ? 1 : 0 },
    uSway: { value: Q.sway ? 1 : 0 }, uPropsOff: { value: Q.props ? 0 : 1 }, uLife: { value: Q.life ? 1 : 0 },
  };

  function* build() {
    const base = (import.meta.env && import.meta.env.BASE_URL) || './';
    const href = (f) => new URL(base + DIR + f, document.baseURI).href;
    const tl = new THREE.TextureLoader();
    const tex = {}; let pending = 0, err = null, gltf = null;
    const load = (key, file, srgb, opts = {}) => {
      pending++;
      tl.loadAsync(href(file)).then((t) => { t.flipY = false; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = opts.aniso ?? 4; if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; if (opts.nomip) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; } tex[key] = own(t); pending--; }, (e) => { err = e; pending--; });
    };
    load('alb', 'atlas_albedo.webp', true, { aniso: 8 }); load('nrm', 'atlas_normal.webp', false); load('orm', 'atlas_orm.webp', false);
    load('falb', 'floor_albedo.webp', true, { repeat: true, aniso: 8 }); load('fnrm', 'floor_normal.webp', false, { repeat: true }); load('form', 'floor_orm.webp', false, { repeat: true });
    load('paint', 'floor_paint.webp', false, { aniso: 8 }); // linear multiplier data (not sRGB)
    load('cut', 'cutout.webp', true, { aniso: 4 });
    load('lm', Q.lmfull ? 'lightmap.webp' : 'lightmap_half.webp', false, { aniso: 4 }); // (denoised; 4 px island margins → mips are safe)
    load('lmf', 'lightmap_floor.webp', false, { aniso: 8 });
    load('probe', 'probe.webp', false, { aniso: 1 });
    pending++; fetch(href('factory_dress.json')).then((r) => r.json()).then((j) => { dress = j; pending--; }, (e) => { dress = {}; pending--; console.warn('dress', e); });
    const gl = new GLTFLoader(); gl.setMeshoptDecoder(MeshoptDecoder);
    gl.loadAsync(href('factory_v2.glb')).then((g) => { gltf = g; }, (e) => { err = e; });
    while ((!gltf || pending > 0) && !err) yield 'wait';
    if (err) throw err;
    tex.probe.wrapS = THREE.RepeatWrapping; tex.probe.magFilter = THREE.LinearFilter; tex.probe.minFilter = THREE.LinearMipmapLinearFilter;
    shared.uProbe.value = tex.probe;
    yield 'loaded';

    // ------------------------------------------------ primitives → 5 groups (merged), custom attributes per source material
    const groups = { atlas: [], floor: [], cutout: [], emissive: [], plenum: [] };
    const unknown = new Set();
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const name = (o.material.name || '').replace(/^M_/, '').replace(/\.\d+$/, '');
      const m = MAP[name] || (unknown.add(name), T(1));
      let g = o.geometry; own(o.geometry);
      if (!o.matrixWorld.equals(_I4)) g.applyMatrix4(o.matrixWorld);
      if (g.index === null) g = g.toNonIndexed();
      const n = g.attributes.position.count;
      const keep = ['position', 'normal', 'uv', 'uv1', 'color', 'color_1'];
      for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      const uv1 = g.attributes.uv1 || g.attributes.uv; g.setAttribute('aUv1', toFloat(uv1, 2)); g.deleteAttribute('uv1');
      // two colour sets: 'Col' (R ∈ {0.5, 1}: optional flag, G wear, B grime, A sway) and 'Light' (RGBM per-vertex bake)
      let c0 = g.attributes.color, c1 = g.attributes.color_1;
      const isCol = (a) => { if (!a) return false; for (let i = 0; i < Math.min(a.count, 24); i++) { const r = a.getX(i); if (Math.abs(r - 1) > 0.01 && Math.abs(r - 0.5) > 0.01) return false; } return true; };
      if (c0 && c1 && !isCol(c1) && isCol(c0)) [c0, c1] = [c1, c0];
      if (c0 && c1 && isCol(c0) && !isCol(c1)) [c0, c1] = [c1, c0];
      // now c0 = Light, c1 = Col (exporter order: Light first)
      const light = c1 ? c0 : null, cc = c1 || c0;
      g.setAttribute('aCol', cc ? toFloat(cc, 4) : new THREE.BufferAttribute(new Float32Array(n * 4).fill(1), 4));
      g.setAttribute('aLight', light ? toFloat(light, 4) : new THREE.BufferAttribute(new Float32Array(n * 4).fill(0.05), 4));
      g.deleteAttribute('color'); g.deleteAttribute('color_1');
      g.setAttribute('uv', toFloat(g.attributes.uv, 2)); g.setAttribute('position', toFloat(g.attributes.position, 3)); g.setAttribute('normal', toFloat(g.attributes.normal, 3));
      g.setAttribute('aTile', new THREE.BufferAttribute(new Float32Array(n).fill(m[1]), 1));
      const tint = new Float32Array(n * 3); for (let i = 0; i < n; i++) { tint[i * 3] = m[2] ?? 1; tint[i * 3 + 1] = m[3] ?? 1; tint[i * 3 + 2] = m[4] ?? 1; }
      g.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
      // v0.48: mark the vertices of each decorative pumpkin with its foot and size, so the shader can make it hop (0 elsewhere)
      const hopA = new Float32Array(n * 4);
      if (/^pumpkin/.test(name)) {
        const P = g.attributes.position, list = F.pumpkins || [];
        for (let i = 0; i < n; i++) {
          const x = P.getX(i), y = P.getY(i), z = P.getZ(i); let best = null, bd = 1e9;
          for (const q of list) { const d = Math.hypot(x - q[0], z - q[2]); if (d < bd && d < 0.9 * q[3] + 0.25 && y > q[1] - 0.2 && y < q[1] + 1.6 * q[3] + 0.3) { bd = d; best = q; } }
          if (best) hopA.set([best[0], best[1], best[2], 10 + best[3]], i * 4);
        }
      }
      g.setAttribute('aHop', new THREE.BufferAttribute(hopA, 4));
      groups[m[0]].push(g);
    });
    if (unknown.size) console.warn('factory v2: unmapped materials', [...unknown]);
    yield 'groups';
    const mk = (frag, uniforms, opts = {}) => own(new THREE.ShaderMaterial({ uniforms: { ...shared, ...uniforms }, vertexShader: VERT, fragmentShader: frag, ...opts }));
    const mats = {
      atlas: mk(ATLAS_FRAG, { uAlb: { value: tex.alb }, uNrm: { value: tex.nrm }, uOrm: { value: tex.orm }, uLM: { value: tex.lm }, uTileGain: { value: TILE_GAIN }, uGradK: { value: +(U.get('fgrad') || 1.8) } }),
      floor: mk(FLOOR_FRAG, { uFAlb: { value: tex.falb }, uFNrm: { value: tex.fnrm }, uFOrm: { value: tex.form }, uPaint: { value: tex.paint }, uLMF: { value: tex.lmf } }),
      cutout: mk(CUTOUT_FRAG, { uCut: { value: tex.cut }, uLM: { value: tex.lm } }, { side: THREE.DoubleSide }),
      emissive: mk(EMIT_FRAG, {}, { toneMapped: false, side: THREE.DoubleSide }), // double-sided: some carved mouths are wound inward (they were culled)
      plenum: own(new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: { uMoon: { value: new THREE.Vector3(-0.3, 0.85, 0.4).normalize() }, uHallC: { value: new THREE.Vector3(F.origin[0], F.origin[1] + h / 2, F.origin[2]) }, uHallH: { value: new THREE.Vector3(F.size.w / 2 + 1, h / 2 + 8, F.size.d / 2 + 1) } }, side: THREE.DoubleSide })), // r2: night sky + moon through the breach (still never the city)
    };
    for (const [k, list] of Object.entries(groups)) {
      if (!list.length) continue;
      const geo = own(mergeGeometries(list, false)); for (const g of list) g.dispose();
      if (!geo) { console.warn('merge failed', k); continue; }
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mats[k]); mesh.name = `FactoryV2_${k}`; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      mesh.renderOrder = k === 'floor' ? 0 : 1;
      root.add(mesh); stats.tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3; stats.drawCalls++;
      yield k;
    }
    stats.materials = Object.keys(mats).length;

    // ------------------------------------------------ low floor mist (3 drifting layers, kept from v0.30, cooler tint)
    mist = new THREE.Group(); mist.name = 'LowFog';
    const mt = own(mistTexture());
    for (const [y, sc] of [[0.25, 1], [0.6, 1.3], [1.0, 1.7]]) {
      const t = own(mt.clone()); t.repeat.set(1.2 * sc, 2 * sc);
      const m = new THREE.Mesh(own(new THREE.PlaneGeometry(F.size.w, F.size.d).rotateX(-Math.PI / 2)), own(new THREE.MeshBasicMaterial({ map: t, color: 0x7c86a8, transparent: true, depthWrite: false, opacity: 0.12 - y * 0.07, fog: false })));
      m.position.y = y; m.renderOrder = 7; mist.add(m);
    }
    root.add(mist);
    yield 'fog';

    // ------------------------------------------------ glows: lamps, pumpkins (layout + catwalk extras), door lamps, purple wall light, LEDs
    const D = dress || {};
    const halo = [];
    for (const [x, y, z, p0] of F.lamps || []) { const purple = false; /* r3: every lamp warm */ halo.push({ pos: [x, y - 0.05, z], size: y > 7 ? 1.3 : 0.8, color: purple ? 0x9a6cff : 0xffa050, alpha: purple ? 0.42 : 0.5 }); }
    // pumpkins: candle light spilling OUT of the carved face (hot core just in front of the face + a softer spill), not a
    // halo over the whole pumpkin; the sprites sit in front of the face, so from behind the pumpkin body hides them
    const pumpkinGlow = (x, y, z, sc, dx, dz, hops = true) => {
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      halo.push({ pos: [x + dx * 0.5 * sc, y + 0.37 * sc, z + dz * 0.5 * sc], size: 0.62 * sc, color: 0xffb648, alpha: 0.62, hop: hops ? [x, y, z, sc] : null });
      halo.push({ pos: [x + dx * 0.75 * sc, y + 0.3 * sc, z + dz * 0.75 * sc], size: 1.5 * sc, color: 0xff7a20, alpha: 0.22, hop: hops ? [x, y, z, sc] : null });
    };
    for (const [x, y, z, sc] of F.pumpkins || []) pumpkinGlow(x, y, z, sc, 0.5 - x, 12 - z); // face the arena (same rule as the Blender builder)
    for (const [x, y, z, sc] of D.pumpkins || []) pumpkinGlow(x, y, z, sc, -x, -z, false); // (the catwalk extras do not hop)
    for (const [x, y, z, s, kind] of D.glows || []) halo.push({ pos: [x, y, z], size: s, color: kind === 'purple' ? 0x9a62ff : 0xffa850, alpha: (kind === 'purple' ? 0.5 : 0.45) * (z < -16 && Math.abs(x) < 4.6 && y < 8 ? 0.35 : 1) }); // door lamps: dim (readability)
    for (const [x, y, z, c] of D.leds || []) halo.push({ pos: [x, y, z], size: 0.14, color: c === 'green' ? 0x3dff6b : c === 'red' ? 0xff3b2e : 0xffa020, alpha: 0.7 });
    halo.push({ pos: [-8.2, 0.9, 14.6], size: 3.0, color: 0xff6a20, alpha: 0.4 }); // debris fire
    // readability (S7): a soft cool backlight behind Green Maniac's hover point (between him and the door) → rim / silhouette
    halo.push({ pos: [F.bossHover[0], F.bossHover[1] + 0.3, F.bossHover[2] - 2.2], size: 9.0, color: 0x4a7cff, alpha: 0.36 });
    glows = own(new StaticGlows(halo, { name: 'LampHalos', hopUniforms: { uShowB: shared.uShowB, uShowD: shared.uShowD, uShowE: shared.uShowE, uCorr: shared.uCorr } })); root.add(glows.mesh); // the candle glows hop with their pumpkins

    // ------------------------------------------------ light cones under the high-bays + moonlight beam through the breach
    if (Q.cones) {
      const cones = [];
      const addCone = (top, bot, r0, r1, color, k0 = 0.05) => {
        const len = top.distanceTo(bot);
        const c = new THREE.CylinderGeometry(r0, r1, len, 20, 1, true);
        c.translate(0, -len / 2, 0); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), bot.clone().sub(top).normalize()); c.applyQuaternion(q); c.translate(top.x, top.y, top.z);
        const col = new THREE.Color(color), cols = [], P = c.attributes.position;
        for (let i = 0; i < P.count; i++) { const p = new THREE.Vector3(P.getX(i), P.getY(i), P.getZ(i)); const k = 1 - p.distanceTo(top) / len; const a = k0 + (1 - k0) * k * k; cols.push(col.r * a, col.g * a, col.b * a); }
        c.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); cones.push(c.toNonIndexed());
      };
      // readability (S7): no cones on the centre lamp row — they would sit right behind the bomb paths / the boss
      for (const [x, y, z, p0] of F.lamps || []) if (y > 7 && Math.abs(x) > 0.5) { const purple = false; /* r3: every lamp warm */ addCone(new THREE.Vector3(x, y + 0.05, z), new THREE.Vector3(x, 0.2, z), 0.55, 2.9, purple ? 0x7a54ff : 0xffa055); }
      addCone(new THREE.Vector3(B.x - 1.2, h + 0.5, B.z + 2.2), new THREE.Vector3(B.x + 0.6, 0.1, B.z - 0.8), 2.2, 3.6, 0x8aa4ff, 0.6); /* r4: stronger shaft */ // moonlight (r2: brighter, reads from the breach camera)
      for (const c of cones) { if (!c.attributes.uv) c.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(c.attributes.position.count * 2), 2)); }
      const beams = new THREE.Mesh(own(mergeGeometries(cones)), own(new THREE.ShaderMaterial({ uniforms: { uOpacity: { value: 0.12 }, ...showU() }, vertexShader: CONE_VERT, fragmentShader: CONE_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })));
      beams.name = 'LightCones'; beams.renderOrder = 8; beams.frustumCulled = false; root.add(beams);
    }
    // ------------------------------------------------ wet-floor reflection streaks (camera-facing, instanced)
    if (Q.streaks) {
      const items = [];
      for (const [x, y, z, p0] of F.lamps || []) if (Math.abs(x) > 0.5) { const purple = false; /* r3: every lamp warm */ items.push([x, z, y > 7 ? 0.42 : 0.3, y > 7 ? 7.5 : 3.2, purple ? [0.45, 0.28, 0.9] : [1.0, 0.55, 0.22], y > 7 ? 0.55 : 0.35]); } // (centre row: under the lanes → none)
      for (const [x, y, z, sc] of F.pumpkins || []) if (y < 0.5) items.push([x, z, 0.5 * sc, 1.6 * sc, [1.0, 0.42, 0.1], 0.4]);
      for (const [x, y, z, s, kind] of D.glows || []) if (y < 9) items.push([x, z, 0.5, 2.6, kind === 'purple' ? [0.5, 0.3, 1.0] : [1.0, 0.55, 0.2], 0.35]);
      items.push([-7.0, 13.5, 1.6, 4.0, [1.0, 0.4, 0.12], 0.4]);
      const base = new THREE.PlaneGeometry(1, 1, 1, 1); const g = new THREE.InstancedBufferGeometry();
      g.index = base.index; g.setAttribute('position', base.attributes.position);
      const C = new Float32Array(items.length * 3), WL = new Float32Array(items.length * 2), RGB = new Float32Array(items.length * 3);
      items.forEach(([x, z, w, l, c, a], i) => { C.set([x, 0, z], i * 3); WL.set([w, l], i * 2); RGB.set([c[0] * a * 2.2, c[1] * a * 2.2, c[2] * a * 2.2], i * 3); });
      g.setAttribute('aC', new THREE.InstancedBufferAttribute(C, 3)); g.setAttribute('aWL', new THREE.InstancedBufferAttribute(WL, 2)); g.setAttribute('aRGB', new THREE.InstancedBufferAttribute(RGB, 3));
      g.instanceCount = items.length;
      streakMat = own(new THREE.ShaderMaterial({ uniforms: { uCam: { value: new THREE.Vector3() }, ...showU() }, vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      const sm = new THREE.Mesh(own(g), streakMat); sm.name = 'WetFloorStreaks'; sm.frustumCulled = false; sm.renderOrder = 2; root.add(sm);
    }
    yield 'atmosphere';

    // ------------------------------------------------ particles + the v0.30 real lights (count unchanged: 5)
    fx = {
      smoke: own(new Billboards(48, { color: 0x4a4458, gravity: -0.25, drag: 0.5, name: 'InteriorSmoke' })),
      embers: own(new Billboards(24, { color: 0xff8a3a, additive: true, gravity: -0.6, drag: 0.8, name: 'InteriorEmbers' })),
      dust: own(new Billboards(40, { color: 0x9a8a90, gravity: 0.3, drag: 1.6, name: 'LandingDust' })),
      motes: own(new Billboards(140, { color: 0xffc890, additive: true, gravity: -0.02, drag: 0.2, texture: softTexture(), name: 'DustMotes' })),
      fall: own(new Billboards(120, { color: 0x9aa8ff, additive: true, gravity: 0.25, drag: 0.6, name: 'BreachDust' })),
      sparks: own(new Billboards(30, { color: 0xffd080, additive: true, gravity: 6.0, drag: 0.4, name: 'WireSparks' })),
      steam: own(new Billboards(30, { color: 0xa9a3b8, gravity: -0.35, drag: 0.9, name: 'PipeSteam' })),
      t: 0, sparkT: 2,
    };
    for (const k of ['smoke', 'embers', 'dust', 'motes', 'fall', 'sparks', 'steam']) root.add(fx[k].mesh);
    const hemi = new THREE.HemisphereLight(0x6a5a9a, 0x1a1016, 0.55); hemi.name = 'FactoryHemi';
    const warmA = new THREE.PointLight(0xff9a50, 46, 20, 1.4); warmA.position.set(0, 7.6, 6); warmA.name = 'HallWarmSouth';
    const warmB = new THREE.PointLight(0xff9a50, 42, 20, 1.4); warmB.position.set(0, 7.6, -6); warmB.name = 'HallWarmNorth';
    const fire = new THREE.PointLight(0xff7a30, 26, 14, 1.6); fire.position.set(-8.2, 1.4, 14.6); fire.name = 'DebrisFire';
    const purple = new THREE.PointLight(0x9a62ff, 34, 22, 1.5); purple.position.set(0, 7.5, -12); purple.name = 'BossZonePurple';
    lights.push(hemi, warmA, warmB, fire, purple);
    for (const l of lights) root.add(l);
    for (let i = 0; i < 90; i++) step(1 / 15, i / 15); // smoke column + dust already there on fade-in
    for (const k of ['sparks', 'steam', 'fall', 'motes']) fx[k].mesh.visible = true; // compiled with the rest during Loading
    root.updateMatrixWorld(true);
    yield 'done';
  }
  function toFloat(attr, n) { // typed-array fast path (no per-element getters: this runs over ~210k vertices during Loading)
    if (attr.array instanceof Float32Array && !attr.normalized && attr.itemSize === n && !attr.isInterleavedBufferAttribute) return attr;
    const cnt = attr.count, m = attr.itemSize, out = new Float32Array(cnt * n);
    if (attr.isInterleavedBufferAttribute) { for (let i = 0; i < cnt; i++) for (let k = 0; k < n; k++) out[i * n + k] = k >= m ? 1 : k === 0 ? attr.getX(i) : k === 1 ? attr.getY(i) : k === 2 ? attr.getZ(i) : attr.getW(i); return new THREE.BufferAttribute(out, n); }
    const a = attr.array, sc = !attr.normalized ? 1 : a instanceof Uint8Array ? 1 / 255 : a instanceof Uint16Array ? 1 / 65535 : a instanceof Int16Array ? 1 / 32767 : a instanceof Int8Array ? 1 / 127 : 1;
    if (m === n) { for (let i = 0; i < a.length; i++) out[i] = a[i] * sc; }
    else for (let i = 0; i < cnt; i++) { for (let k = 0; k < n; k++) out[i * n + k] = k < m ? a[i * m + k] * sc : 1; }
    return new THREE.BufferAttribute(out, n);
  }

  const _p = new THREE.Vector3(), _v = new THREE.Vector3(), _c = new THREE.Vector3();
  const R = Math.random;
  function step(dt, t) {
    if (!fx) return;
    fx.t += dt; shared.uTime.value = t;
    if (R() < dt * 6) fx.smoke.spawn(_p.set(-8.2 + (R() - 0.5) * 3, 0.8 + R() * 1.5, 14.6 + (R() - 0.5) * 2.4), _v.set((R() - 0.5) * 0.3, 0.9 + R() * 0.5, -0.3), { life: 9, size: [1.2, 4.2], alpha: 0.26 });
    if (R() < dt * 3) fx.smoke.spawn(_p.set(B.x + (R() - 0.5) * 4, h - 0.5, B.z + (R() - 0.5) * 4), _v.set((R() - 0.5) * 0.4, 0.15, (R() - 0.5) * 0.4), { life: 6, size: [2, 4], alpha: 0.2 });
    if (R() < dt * 4) fx.embers.spawn(_p.set(-9.5 + R() * 3, 0.3, 13 + R() * 3.5), _v.set((R() - 0.5) * 0.4, 1.2 + R(), (R() - 0.5) * 0.4), { life: 2.5, size: [0.08, 0.02], alpha: 0.9 });
    if (Q.dust) {
      if (R() < dt * 12) { const lp = (F.lamps || [])[Math.floor(R() * (F.lamps || []).length)]; if (lp && lp[1] > 7) fx.motes.spawn(_p.set(lp[0] + (R() - 0.5) * 3, 0.8 + R() * 6, lp[2] + (R() - 0.5) * 3), _v.set((R() - 0.5) * 0.08, (R() - 0.5) * 0.06, (R() - 0.5) * 0.08), { life: 6 + R() * 4, size: [0.03, 0.05], alpha: 0.8 }); }
      if (R() < dt * 5) fx.fall.spawn(_p.set(B.x - 0.6 + (R() - 0.5) * 2.2, 0.6 + R() * (h - 1.5), B.z + 0.6 + (R() - 0.5) * 2.2), _v.set(0.06 * (R() - 0.5), -0.05 - R() * 0.08, 0.06 * (R() - 0.5)), { life: 6 + R() * 3, size: [0.35, 0.8], alpha: 0.12 }); /* r4: soft dust column in the moon shaft */
      if (R() < dt * 7) fx.fall.spawn(_p.set(B.x + (R() - 0.5) * 3.5, h - 0.3, B.z + (R() - 0.5) * 3.5), _v.set(0.25 + (R() - 0.5) * 0.2, -0.25 - R() * 0.3, -0.35), { life: 7 + R() * 3, size: [0.04, 0.07], alpha: 0.75 });
    }
    if (Q.life) {
      const D = dress || {};
      fx.sparkT -= dt;
      if (fx.sparkT <= 0 && D.sparks?.length) { // occasional burst from the broken wire on the west wall (never near the lanes)
        fx.sparkT = 2.5 + R() * 5; const [x, y, z] = D.sparks[0];
        for (let i = 0; i < 9; i++) fx.sparks.spawn(_p.set(x, y, z), _v.set(0.6 + R() * 1.2, R() * 1.4, (R() - 0.5) * 1.6), { life: 0.5 + R() * 0.5, size: [0.05, 0.015], alpha: 1 });
      }
      for (const [x, y, z] of D.steam || []) if (R() < dt * 1.6) fx.steam.spawn(_p.set(x, y, z), _v.set(-Math.sign(x) * 0.5, 0.25 + R() * 0.2, (R() - 0.5) * 0.2), { life: 3 + R() * 2, size: [0.3, 1.6], alpha: 0.22 });
    }
    if (show.downbeat !== show.done) { // v0.48 show: on each bar line, sparks from the west-wall wire (level 2 up) and steam from the pipes (level 3). Existing pools, far from the lanes
      show.done = show.downbeat; const D = dress || {};
      if (show.level >= 2 && D.sparks?.length) { const [x, y, z] = D.sparks[0]; for (let i = 0; i < 8; i++) fx.sparks.spawn(_p.set(x, y, z), _v.set(0.6 + R() * 1.2, R() * 1.4, (R() - 0.5) * 1.6), { life: 0.5 + R() * 0.5, size: [0.05, 0.015], alpha: 1 }); }
      if (show.level >= 3) for (const [x, y, z] of D.steam || []) for (let i = 0; i < 2; i++) fx.steam.spawn(_p.set(x, y, z), _v.set(-Math.sign(x) * (0.5 + R() * 0.3), 0.3 + R() * 0.3, (R() - 0.5) * 0.3), { life: 2.5 + R() * 1.5, size: [0.3, 1.6], alpha: 0.22 });
    }
    for (const k of ['smoke', 'embers', 'dust', 'motes', 'fall', 'sparks', 'steam']) fx[k].update(dt);
    glows?.update(t);
    if (mist) for (const m of mist.children) { m.material.map.offset.x = (t * 0.006 * (1 + m.position.y)) % 1; m.material.map.offset.y = (t * 0.004) % 1; }
    const fireL = lights[3]; if (fireL) fireL.intensity = 24 + Math.sin(t * 7.3) * 1.5 + Math.sin(t * 3.1) * 1.5; // gentle, never strobing
    if (lights[1]) { lights[1].intensity = 46 * (1 + show.light); lights[2].intensity = 42 * (1 + show.light); } // v0.48: the two warm lights follow the show a little (0 at rest)
  }

  let prevFog = null, prevTone = null, camRef = null;
  const api = {
    root,
    *build() { for (const s of build()) { if (s === 'done') ready = true; yield s; } },
    get ready() { return ready; },
    get stats() { return stats; },
    toWorld: (x, y, z, out = new THREE.Vector3()) => out.set(x + F.origin[0], y + F.origin[1], z + F.origin[2]),
    activate(scene, renderer, camera) {
      prevFog = scene.fog; scene.fog = new THREE.Fog(0x1a1a2c, 14, 60); root.visible = true; camRef = camera || null;
      if (renderer) { prevTone = { tm: renderer.toneMapping, ex: renderer.toneMappingExposure }; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15; }
    },
    deactivate(scene, renderer) {
      if (prevFog !== null) scene.fog = prevFog; prevFog = null; root.visible = false;
      if (renderer && prevTone) { renderer.toneMapping = prevTone.tm; renderer.toneMappingExposure = prevTone.ex; } prevTone = null;
    },
    update(dt, t, camera) {
      if (!root.visible) return;
      step(dt, t);
      const cam = camera || camRef;
      if (streakMat && cam) { cam.getWorldPosition(_c); streakMat.uniforms.uCam.value.set(_c.x - F.origin[0], _c.y - F.origin[1], _c.z - F.origin[2]); }
    },
    /**
     * v0.48 hall show: the ONE entry point. It only stores numbers (uniforms and the few values the hall's own update reads);
     * nothing is created, shown or compiled here. beat = envelope 0…1, level 0…3, dip = gain (−0.30 on a miss, −0.65 before a
     * chorus, +0.40 in its burst), hue = [r, g, b] accent (mean 1) or null. With no argument: back to rest.
     */
    setShow({ beat = 0, level = 0, dip = 0, hue = null, swing = 0, phase = 0, attack = 0, fall = 0, chase = 0, strips = 0, flare = 0, streak = 0, wave = 0, waveR = 0, band = 0, bandPos = 0, wash = 0, hop = 0, ceil = 0, downbeat = show.downbeat } = {}) {
      shared.uShowD.value.set(band, bandPos, wash, hop); shared.uShowE.value.set(ceil, swing * beat, 0, 0);
      shared.uShow.value.set(swing, dip, strips, hue ? 1 : 0);
      shared.uShowB.value.set(phase, attack, fall, chase);
      shared.uShowC.value.set(flare, streak, waveR, wave);
      if (hue) shared.uShowHue.value.set(hue[0], hue[1], hue[2]);
      show.level = level; show.downbeat = downbeat; show.light = SHOW_LIGHT * (swing * beat + dip);
    },
    get showState() { return { uShow: shared.uShow.value.toArray(), uShowB: shared.uShowB.value.toArray(), uShowC: shared.uShowC.value.toArray(), uShowD: shared.uShowD.value.toArray(), uShowE: shared.uShowE.value.toArray(), light: show.light, level: show.level, corridor: { ...CORRIDOR } }; },
    /** the streak shader faces this camera (screenshots / the bench use their own cameras) */
    faceCamera(cam) { if (streakMat && cam) { cam.getWorldPosition(_c); streakMat.uniforms.uCam.value.set(_c.x - F.origin[0], _c.y - F.origin[1], _c.z - F.origin[2]); } },
    landingDust(x, z) { for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; fx?.dust.spawn(_p.set(x - F.origin[0] + Math.cos(a) * 0.3, 0.15, z - F.origin[2] + Math.sin(a) * 0.3), _v.set(Math.cos(a) * 2.2, 0.4 + R() * 0.5, Math.sin(a) * 2.2), { life: 1.6, size: [0.5, 1.6], alpha: 0.5 }); } },
    dispose() { root.parent?.remove(root); for (const x of disposables) x.dispose?.(); disposables.length = 0; ready = false; },
    mapBoxes() { return F.blockers.map((b, i) => ({ x: (b.x0 + b.x1) / 2 + F.origin[0], z: (b.z0 + b.z1) / 2 + F.origin[2], w: b.x1 - b.x0, d: b.z1 - b.z0, yaw: 0, id: `F${i}`, upper: false, highlight: b.kind === 'debris' })); },
    /** dev toggles that apply live (lightmap resolution / props: next load for lmfull) */
    applyFlags() {
      const q = factoryFlags(); Object.assign(Q, q);
      shared.uProbeOn.value = q.probe ? 1 : 0; shared.uSway.value = q.sway ? 1 : 0; shared.uPropsOff.value = q.props ? 0 : 1; shared.uLife.value = q.life ? 1 : 0;
      root.traverse((o) => { if (o.name === 'LightCones') o.visible = q.cones; if (o.name === 'WetFloorStreaks') o.visible = q.streaks; if (o.name === 'DustMotes' || o.name === 'BreachDust') o.visible = q.dust; });
    },
    /** live tuning hooks (dev panel / screenshots) */
    tune: shared,
    views: {
      spawn: { pos: new THREE.Vector3(F.spawn.pos[0] + F.origin[0], 1.6 + F.origin[1], F.spawn.pos[2] + F.origin[2]), look: new THREE.Vector3(F.bossHover[0] + F.origin[0], 3 + F.origin[1], F.bossHover[2] + F.origin[2]) },
      arena: { pos: new THREE.Vector3(F.arenaCircle.pos[0] + F.origin[0], 1.7 + F.origin[1], F.arenaCircle.pos[2] + 2.5 + F.origin[2]), look: new THREE.Vector3(F.origin[0], F.origin[1] + 4, F.origin[2] - 12) },
      top: { pos: new THREE.Vector3(F.origin[0] + 0.01, F.origin[1] + 42, F.origin[2] + 0.5), look: new THREE.Vector3(F.origin[0], F.origin[1], F.origin[2]) },
      side: { pos: new THREE.Vector3(F.origin[0] + 8.0, F.origin[1] + 7.0, F.origin[2] + 16.5), look: new THREE.Vector3(F.origin[0] - 2, F.origin[1] + 4, F.origin[2] - 6) },
    },
  };
  return api;
}
