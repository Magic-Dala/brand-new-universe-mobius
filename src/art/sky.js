// Stylised sunset sky dome (comic / anime background look).
import * as THREE from 'three';

const deg = THREE.MathUtils.degToRad;
import { SUNSET_DIR } from '../data/layout.js';
// v0.10: the city is enclosed in a ring; the sun sets outside the OUTER glazing, in the
// direction the sunset seat on Rooftop C looks at (layout.SUNSET_DIR).
const SUN_AZIMUTH = Math.atan2(SUNSET_DIR[0], -SUNSET_DIR[2]); // 0 = north (-Z); + = toward east (+X)
const SUN_ELEVATION = deg(7);

/** Normalised vector pointing TOWARD the sun: low (~7°), seen through the outer sunset glazing. */
export const SUN_DIRECTION = new THREE.Vector3(
  Math.sin(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
  Math.sin(SUN_ELEVATION),
  -Math.cos(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
).normalize();

export const SUN_COLOR = new THREE.Color(0xffa060);
export const HEMI_COLORS = { sky: new THREE.Color(0x9a78d8), ground: new THREE.Color(0x6a5262) };

const vert = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w * 0.99999; // always behind everything, never far-clipped
}`;

const frag = /* glsl */ `
uniform vec3 sunDir;
uniform float time;
uniform float uCloudsQ; // v0.30 'clouds': layered painterly clouds lit from below + a wider sun bloom (0 = the v0.29 cel sky)
uniform vec3 cZenith, cHigh, cMid, cLow, cHorizonWarm, cHorizonCool, cGround, cSun;
varying vec3 vWorldPos;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.55;
  for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.07 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vWorldPos - cameraPosition);
  float e = d.y;
  float sd = dot(d, sunDir);
  float toward = clamp(dot(normalize(d.xz + 1e-5), normalize(sunDir.xz)) * 0.5 + 0.5, 0.0, 1.0); // azimuthal warmth

  // --- vertical gradient ---------------------------------------------------
  vec3 horizon = mix(cHorizonCool, cHorizonWarm, pow(toward, 1.5));
  vec3 col;
  float eh = max(e, 0.0);
  col = mix(horizon, cLow, smoothstep(0.0, 0.10, eh));
  col = mix(col, cMid, smoothstep(0.06, 0.28, eh));
  col = mix(col, cHigh, smoothstep(0.22, 0.55, eh));
  col = mix(col, cZenith, smoothstep(0.5, 1.0, eh));
  col = mix(col, cGround, smoothstep(0.0, -0.08, e));

  // --- sun glow + disc ------------------------------------------------------
  float s = max(sd, 0.0);
  col += vec3(1.0, 0.55, 0.25) * pow(s, 6.0) * 0.45 * (1.0 - smoothstep(0.1, 0.6, eh));
  col += vec3(1.0, 0.75, 0.4) * pow(s, 60.0) * 0.55;
  // stepped anime halo rings
  col = mix(col, vec3(1.0, 0.86, 0.6), smoothstep(0.9965, 0.9970, sd) * 0.35);
  col = mix(col, vec3(1.0, 0.93, 0.75), smoothstep(0.9990, 0.9992, sd) * 0.5);
  float disc = smoothstep(0.99955, 0.99965, sd);
  col = mix(col, cSun, disc);

  if (uCloudsQ > 0.5) {
    // --- v0.30 sun bloom (faked in the shader: wide soft glow + tight core, no post-processing)
    col += vec3(1.0, 0.62, 0.32) * pow(s, 24.0) * 0.55 + vec3(1.0, 0.8, 0.55) * pow(s, 220.0) * 0.6;
    // --- low stratocumulus layer (domain-warped fBm on a flat cloud deck), lit from below by the low sun
    if (e > 0.008) {
      vec2 p = d.xz / (e + 0.035) * 0.55;
      vec2 drift = vec2(time * 0.006, time * 0.002);
      vec2 w = vec2(fbm(p * 0.7 + drift), fbm(p * 0.7 - drift + 3.1));
      float n = fbm(p * 1.1 + w * 1.6 + drift);
      float n2 = fbm(p * 1.1 + w * 1.6 + drift + normalize(sunDir.xz) * 0.09); // toward the sun: thinner = lit edge
      float band = smoothstep(0.012, 0.06, e) * (1.0 - smoothstep(0.30, 0.62, e));
      float dens = smoothstep(0.47, 0.70, n) * band;
      float under = clamp((n - n2) * 7.0 + 0.45, 0.0, 1.0);          // underside facing the sun
      float warm = pow(toward, 1.6);
      vec3 cTop = mix(vec3(0.42, 0.30, 0.52), vec3(0.62, 0.38, 0.55), warm);
      vec3 cUnder = mix(vec3(1.0, 0.56, 0.48), vec3(1.0, 0.72, 0.42), warm);
      vec3 cc = mix(cTop, cUnder, under * (0.55 + 0.45 * smoothstep(0.0, 0.25, e)));
      cc += vec3(1.0, 0.7, 0.4) * smoothstep(0.47, 0.53, n) * (1.0 - smoothstep(0.53, 0.6, n)) * warm * 0.45; // silver lining
      cc += vec3(1.0, 0.55, 0.25) * pow(s, 8.0) * 0.5;
      col = mix(col, cc, dens * 0.9);
      // high cirrus streaks (thin, stretched along the sun azimuth)
      vec2 q = vec2(dot(p, normalize(sunDir.xz)), dot(p, vec2(-sunDir.z, sunDir.x))) * vec2(0.25, 2.2);
      float ci = smoothstep(0.55, 0.8, fbm(q * 1.3 + vec2(time * 0.004, 0.0))) * smoothstep(0.08, 0.3, e) * (1.0 - smoothstep(0.55, 0.85, e));
      col = mix(col, mix(vec3(1.0, 0.78, 0.7), vec3(1.0, 0.85, 0.55), warm), ci * 0.35);
    }
    gl_FragColor = vec4(col, 1.0);
    return;
  }
  // --- stylised cloud bands -------------------------------------------------
  if (e > 0.012) {
    vec2 p = d.xz / (e + 0.06) * 0.9;
    p.x *= 0.55; // stretch into horizontal streaks
    vec2 drift = vec2(time * 0.010, time * 0.003);
    float n = fbm(p * 1.3 + drift);
    float band = smoothstep(0.02, 0.10, e) * (1.0 - smoothstep(0.42, 0.75, e));
    float dens = n - 0.52 + 0.12 * band - (1.0 - band) * 0.25;
    float mask = smoothstep(0.0, 0.025, dens);
    // light from the sun side: offset sample toward the sun
    vec2 sOff = normalize(sunDir.xz) * 0.12;
    float n2 = fbm(p * 1.3 + drift + sOff);
    float lit = clamp((n - n2) * 9.0 + 0.5, 0.0, 1.0);
    float warm = pow(toward, 2.0);
    vec3 cLit = mix(vec3(1.0, 0.62, 0.62), vec3(1.0, 0.82, 0.5), warm);
    vec3 cShade = mix(vec3(0.50, 0.28, 0.55), vec3(0.72, 0.36, 0.52), warm);
    float steps = lit > 0.62 ? 1.0 : (lit > 0.35 ? 0.55 : 0.0); // cel bands
    vec3 cc = mix(cShade, cLit, steps);
    // halftone dots in the mid/shadow band of the clouds
    vec2 hp = p * 26.0;
    vec2 cell = fract(hp) - 0.5;
    float r = length(cell);
    float fw = fwidth(hp.x) + fwidth(hp.y);
    float dotR = mix(0.42, 0.08, steps);
    float dots = (1.0 - smoothstep(dotR - 0.06, dotR + 0.06, r)) * (1.0 - smoothstep(0.25, 0.7, fw));
    cc = mix(cc, cc * 0.8 + vec3(0.06, 0.0, 0.08), dots * 0.55 * (1.0 - steps * 0.6));
    // rim highlight on cloud edges facing the sun
    cc += vec3(1.0, 0.75, 0.45) * smoothstep(0.0, 0.03, dens) * (1.0 - smoothstep(0.03, 0.06, dens)) * warm * 0.35;
    // clouds near sun get bright
    cc += vec3(1.0, 0.6, 0.3) * pow(s, 10.0) * 0.4;
    col = mix(col, cc, mask * band * 0.92);
  }

  // subtle halftone over the high sky (screen-door comic texture)
  if (e > 0.25) {
    vec2 hp = vec2(atan(d.x, d.z) * 60.0, e * 60.0);
    float fw = fwidth(hp.x) + fwidth(hp.y);
    float r = length(fract(hp) - 0.5);
    float dots = (1.0 - smoothstep(0.18, 0.26, r)) * smoothstep(0.25, 0.9, e) * (1.0 - smoothstep(0.3, 0.8, fw));
    col *= 1.0 - dots * 0.12;
  }

  gl_FragColor = vec4(col, 1.0);
}`;

/** v0.30: sky quality switch shared by every sky material (City feature 'clouds'; uniform only, no recompile). */
export const SKY_Q = { value: 1 };
export function setSkyQuality(clouds) { SKY_Q.value = clouds ? 1 : 0; }

// ShaderMaterial without the colorspace include writes raw values -> use sRGB components directly
const srgb = (hex) => new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);

/**
 * @param {{ sunDirection?: THREE.Vector3 }} [opts]
 * @returns {{ root: THREE.Mesh, sunDirection: THREE.Vector3, update(t:number):void, sunColor: THREE.Color, hemi: {sky: THREE.Color, ground: THREE.Color}, material: THREE.ShaderMaterial }}
 */
export function createSky({ sunDirection = SUN_DIRECTION } = {}) {
  const sunDir = sunDirection.clone().normalize();
  const material = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      sunDir: { value: sunDir },
      time: { value: 0 },
      uCloudsQ: SKY_Q,
      cZenith: { value: srgb(0x26173f) },
      cHigh: { value: srgb(0x5a3384) },
      cMid: { value: srgb(0xb4528f) },
      cLow: { value: srgb(0xf07a7c) },
      cHorizonWarm: { value: srgb(0xffb35a) },
      cHorizonCool: { value: srgb(0xe2809a) },
      cGround: { value: srgb(0xb47a96) },
      cSun: { value: srgb(0xfff4cf) },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const geo = new THREE.SphereGeometry(2000, 48, 24);
  const root = new THREE.Mesh(geo, material);
  root.name = 'Sky';
  root.frustumCulled = false;
  root.renderOrder = -100;
  return {
    root,
    material,
    sunDirection: sunDir,
    sunColor: SUN_COLOR.clone(),
    hemi: { sky: HEMI_COLORS.sky.clone(), ground: HEMI_COLORS.ground.clone() },
    update(t) { material.uniforms.time.value = t; },
  };
}

/**
 * Adds a warm directional "sun" light + purple/brown hemisphere light.
 * No shadows (performance). Returns { sun, hemi }.
 */
export function createLighting(scene, { sunDirection = SUN_DIRECTION } = {}) {
  const sun = new THREE.DirectionalLight(SUN_COLOR, 2.6);
  sun.name = 'SunLight';
  sun.position.copy(sunDirection).normalize().multiplyScalar(500);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = false;
  const hemi = new THREE.HemisphereLight(HEMI_COLORS.sky, HEMI_COLORS.ground, 1.9);
  hemi.name = 'HemiLight';
  scene.add(sun, sun.target, hemi);
  return { sun, hemi };
}
