// World Chase shaders (v0.40). One opaque "world" material per map (all module geometry + backdrop), a floor
// material (street / water / lava / ice / clouds), the sky dome, a camera-following particle box and an additive
// glow material. Lighting is baked-cheap: sun Lambert + hemisphere ambient + height-based ambient occlusion + rim,
// distance + height fog with sun scattering. All surface detail (windows, bricks, tiles, strata, ice cracks…) is
// procedural from the per-vertex uv (metres) + aMat (kind, variation): no textures, no shadow maps, no reflections,
// so the GPU cost is one program for all architecture. Every material ends with three's tone mapping + colour space
// chunks like the city shaders.
import * as THREE from 'three';
import { FOLIAGE_CUTOFF, treeLeafTexture } from '../../art/treeFoliage.js';
import { K } from './builder.js';
import { bindNeonAds, NEON_FACADE, NEON_SIGN } from './neonAds.js';

const C = (hex) => new THREE.Color(hex);

const COMMON = /* glsl */ `
float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm2(vec2 p) { return vnoise(p) * 0.65 + vnoise(p * 2.03 + 7.1) * 0.35; }
`;
const FOG = /* glsl */ `
uniform vec3 uFogCol; uniform vec4 uFog; // near, far, height density, base y
uniform vec3 uSunDir; uniform vec3 uSunCol;
vec3 applyFog(vec3 c, vec3 wp) {
  vec3 d = wp - cameraPosition; float dist = length(d);
  float f = smoothstep(uFog.x, uFog.y, dist);
  float hf = uFog.z * exp(-max(0.0, wp.y - uFog.w) / 38.0) * smoothstep(20.0, 260.0, dist); // low haze in the canyon
  f = clamp(max(f, hf), 0.0, 1.0);
  float sc = pow(max(dot(normalize(d), uSunDir), 0.0), 6.0);
  vec3 fc = mix(uFogCol, uFogCol * 0.55 + uSunCol * 0.6, sc * 0.6);
  #ifdef NEON
  // Neon blends after the output conversion, so convert its fog to match the sky.
  fc = linearToOutputTexel(vec4(fc, 1.0)).rgb;
  #endif
  return mix(c, fc, f);
}`;

// =============================================================================================== world (architecture)
const WORLD_VS = /* glsl */ `
attribute vec2 aMat;
varying vec3 vCol; varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying vec2 vMat;
void main() {
  vCol = color; vUv = uv; vMat = aMat;
  #ifdef USE_INSTANCING_COLOR
    if (abs(aMat.x - 21.0) < 0.5) vCol *= instanceColor; // foldscape kit: host-wall parts take the building's tint
  #endif
  vec4 lp = vec4(position, 1.0);
  #if defined(USE_INSTANCING) && defined(FOREST)
    // forest kit (v0.43): tint every part, normals with the inverse-transpose of the (rotation × scale) instance matrix
    // (trunks are stretched along y), uv kept in metres (× the instance scale) — Tripo heroes (26) and leaf cards (28)
    // keep their texture / atlas uv
    #ifdef USE_INSTANCING_COLOR
      vCol *= instanceColor;
    #endif
    mat3 im = mat3(instanceMatrix); vec3 isc = vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2]));
    vN = normalize(mat3(modelMatrix) * (im * (normal / isc)));
    if (abs(aMat.x - 26.0) > 0.5 && abs(aMat.x - 28.0) > 0.5) vUv = uv * sqrt(vec2(isc.x, isc.y));
    lp = instanceMatrix * lp;
  #elif defined(USE_INSTANCING) && defined(REDROCK)
    // redrock pieces (v0.46): tint, inverse-transpose normals (shafts / mounts are scaled non-uniformly), kit uv × scale;
    // the Tripo heroes (30) keep their texture uv
    #ifdef USE_INSTANCING_COLOR
      vCol *= instanceColor;
    #endif
    mat3 im = mat3(instanceMatrix); vec3 isc = vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2]));
    vN = normalize(mat3(modelMatrix) * (im * (normal / isc)));
    if (abs(aMat.x - 30.0) > 0.5) vUv = uv * sqrt(vec2(isc.x, isc.y));
    lp = instanceMatrix * lp;
  #elif defined(USE_INSTANCING)
    lp = instanceMatrix * lp;
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  #else
    vN = normalize(mat3(modelMatrix) * normal);
  #endif
  vec4 wp = modelMatrix * lp; vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const WORLD_FS = /* glsl */ `
uniform vec3 uSky; uniform vec3 uGnd; uniform float uHemiI; uniform float uSunI;
uniform vec3 uAO; // min, max, height scale
uniform vec3 uRim; uniform float uTime; uniform float uNight;
uniform vec3 uLit; uniform vec3 uGlass; uniform vec3 uRefl; uniform float uLitFrac;
uniform vec3 uAccent; uniform vec3 uAccent2; uniform vec3 uMoss; uniform vec2 uStone;
#ifdef TREE_LEAVES
uniform sampler2D uTreeLeaves;
#endif
varying vec3 vCol; varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying vec2 vMat;
${COMMON}
${FOG}
// window grid on a facade (uv in metres). returns albedo, writes emissive
vec3 windows(vec3 base, vec2 uv, vec2 cell, vec2 win, float seed, inout vec3 emis, float glassMix) {
  vec2 c = floor(uv / cell), f = fract(uv / cell) * cell;
  vec2 o = (cell - win) * 0.5;
  float inW = step(o.x, f.x) * step(f.x, o.x + win.x) * step(o.y * 0.7, f.y) * step(f.y, o.y * 0.7 + win.y);
  float r = h21(c + seed * 17.0);
  vec3 col = base * (0.92 + 0.1 * h21(c * 1.7 + seed));
  // sill / lintel shadow lines
  col *= 1.0 - 0.25 * step(abs(f.y - (o.y * 0.7 - 0.12)), 0.1) - 0.15 * step(abs(f.y - (o.y * 0.7 + win.y + 0.15)), 0.12);
  if (inW > 0.5) {
    float lit = step(r, uLitFrac) * step(0.12, f.y);
    vec3 gl = mix(uGlass, uRefl, glassMix * (0.4 + 0.6 * h21(c + 3.1)));
    col = gl;
    float mull = step(abs(f.x - (o.x + win.x * 0.5)), 0.05);
    col *= 1.0 - 0.6 * mull;
    emis += lit * uLit * (0.55 + 0.6 * h21(c + 9.3)) * (1.0 - mull) * (0.35 + 0.65 * uNight);
  }
  return col;
}

#ifdef FOLDSCAPE
// ---- Foldscape City (v0.41, foldscape only): CC0 texture detail + bay-aligned windows (3.0 x 3.3 m grid, identical to
// the Blender kit's window bays in tools/blender/build_foldscape_kit.py) + canyon sun line.
uniform highp sampler2DArray uAlb; uniform highp sampler2DArray uNrm; uniform highp sampler2DArray uOrm; uniform float uPbrOn;
uniform vec4 uShade; // canyon sun line: y0, y1 (m), shade floor, unused
vec3 fsDetail(vec3 base, vec2 tuv, float L, inout vec3 N, float camD, float amt) {
  if (uPbrOn < 0.5) return base * (0.94 + 0.1 * vnoise(tuv * 3.0));
  vec3 pa = texture(uAlb, vec3(tuv, L)).rgb, pavg = textureLod(uAlb, vec3(0.5, 0.5, L), 10.0).rgb;
  vec3 c = base * mix(vec3(1.0), clamp(pa / max(pavg, vec3(0.04)), 0.35, 1.9), amt);
  float nf = (1.0 - smoothstep(22.0, 75.0, camD)) * amt;
  if (nf > 0.01 && abs(N.y) < 0.9) {
    vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N)), nt = texture(uNrm, vec3(tuv, L)).xyz * 2.0 - 1.0;
    N = normalize(mix(N, normalize(T * nt.x + vec3(0.0, 1.0, 0.0) * nt.y + N * max(nt.z, 0.25)), nf * 0.85));
  }
  return c * mix(1.0, texture(uOrm, vec3(tuv, L)).r, 0.55 * amt);
}
vec3 fsWeather(vec3 c, vec2 uv) { // soft runoff streaks + street grime (low frequency: no VR shimmer)
  float st = vnoise(vec2(uv.x * 0.45, vW.y * 0.025)) * vnoise(vec2(uv.x * 0.13 + 3.0, vW.y * 0.01));
  c *= 1.0 - 0.16 * smoothstep(0.25, 0.6, st);
  return c * mix(0.78, 1.0, smoothstep(0.0, 9.0, vW.y));
}
vec3 fsWindows(vec3 wall, vec3 trim, vec2 uv, float arch, float seed, inout vec3 emis, vec3 N, vec3 V, float camD) {
  vec2 c = floor(uv / vec2(3.0, 3.3)), f = uv - c * vec2(3.0, 3.3);
  float dx = abs(f.x - 1.5);
  float top = arch > 0.5 ? 2.30 + 0.40 * sqrt(max(0.0, 1.0 - (dx / 0.65) * (dx / 0.65))) : 2.68;
  float inW = step(dx, 0.65) * step(0.62, f.y) * step(f.y, top);
  float sill = step(dx, 0.84) * step(0.50, f.y) * step(f.y, 0.62);
  float lint = arch > 0.5 ? 0.0 : step(dx, 0.88) * step(2.68, f.y) * step(f.y, 2.94);
  vec3 col = mix(wall, trim, max(sill, lint));
  if (arch > 0.5) { float e = (dx / 0.87) * (dx / 0.87) + ((f.y - 2.30) / 0.64) * ((f.y - 2.30) / 0.64); col *= 1.0 - 0.2 * step(e, 1.0) * step(2.30, f.y) * (1.0 - inW); }
  col *= 1.0 - 0.3 * step(f.y, 0.50) * step(0.44, f.y) * step(dx, 0.78); // shadow under the sill
  if (inW > 0.5) {
    float h1 = h21(c + seed * 17.0), h2 = h21(c + 7.1 + seed), h3 = h21(c + 3.3);
    vec3 R = reflect(-V, N);
    vec3 refl = mix(uGlass, uRefl, smoothstep(-0.3, 0.5, R.y)) + uSunCol * pow(max(dot(R, uSunDir), 0.0), 24.0) * 0.45;
    float fres = 0.08 + 0.42 * pow(1.0 - abs(dot(N, V)), 4.0);
    vec3 room = mix(vec3(0.03, 0.028, 0.03), vec3(0.11, 0.08, 0.065), h3);
    float sh = step(top - (0.15 + 0.85 * h2), f.y) * step(0.5, h21(c + 1.7)); // a pulled-down shade (half the windows)
    room = mix(room, vec3(0.34, 0.29, 0.22) * (0.6 + 0.4 * h3), sh * 0.75);
    float meet = arch > 0.5 ? 2.30 : 1.65;
    float frame = max(max(step(0.59, dx), step(f.y, 0.70)), max(step(top - 0.07, f.y), max(step(dx, 0.03), step(abs(f.y - meet), 0.03))));
    float lit = step(h1, uLitFrac);
    emis += (1.0 - frame) * (refl * fres * 0.6 + lit * uLit * (0.45 + 0.55 * h21(c + 9.3)) * (1.0 - 0.5 * sh) * (0.3 + 0.7 * uNight));
    col = mix(room, vec3(0.07, 0.06, 0.055), frame);
  }
  // far: fade to the cell average (no crawling grid at range)
  vec3 avg = mix(wall, vec3(0.08, 0.075, 0.07), 0.24);
  return mix(col, avg, smoothstep(140.0, 320.0, camD));
}
#endif
#ifdef FOREST
// ---- Forest of Shadow Ruins (v0.43, forest only): bark / masonry / leaves / rock / textured Tripo heroes + canopy sun
// dapples (route-space noise: uOff = the floating-origin offset, so a rebase never moves the pattern).
uniform sampler2D uHeroMap; uniform vec2 uCanopy; uniform vec2 uOff;
float camFade(float d, float a, float b) { return 1.0 - smoothstep(a, b, d); }
vec3 frMoss(vec3 c, float amt) { return mix(c, uMoss * (0.75 + 0.5 * vnoise(vW.xz * 0.9 + vW.y)), clamp(amt, 0.0, 0.92)); }
vec3 frBark(vec3 alb, vec2 uv, vec3 N, float vr, float camD) {
  float w = vnoise(vec2(uv.x * 0.45, uv.y * 0.05)) * 1.6 + vnoise(vec2(uv.x * 1.7, uv.y * 0.22)) * 0.5;
  float ridge = abs(fract(uv.x * 0.62 + w) - 0.5) * 2.0;                       // 0 = in a fissure
  float fis = 1.0 - smoothstep(0.1, 0.42, ridge);
  float plate = vnoise(vec2(uv.x * 0.8 + w, uv.y * 0.32));
  float near = camFade(camD, 40.0, 140.0);
  vec3 c = alb * mix(1.0, mix(0.9, 0.3 + 0.1 * plate, fis) * (0.8 + 0.42 * plate), 0.45 + 0.55 * near);
  c *= mix(vec3(1.0), vec3(1.08, 1.0, 0.9), smoothstep(0.4, 0.8, vnoise(uv * vec2(0.2, 0.05) + 9.0))); // warm / grey drift
  float moss = smoothstep(0.5, 0.85, vnoise(uv * vec2(0.35, 0.12) + 3.0) * 0.7 + vr * 0.45) * (0.45 + 0.55 * smoothstep(-0.2, 0.7, N.y));
  moss = max(moss, (1.0 - smoothstep(2.0, 14.0, vW.y)) * 0.55 * smoothstep(0.35, 0.65, vnoise(uv * 0.6)));
  c = frMoss(c, moss * 0.6 + fis * 0.08);
  return c;
}
vec3 frStone(vec3 alb, vec2 uv, vec3 N, float vr, float camD, bool blocks) {
  vec3 c = alb;
  if (blocks) { // code-drawn masses: block courses (uStone), chipped edges
    vec2 bs = uStone; float row = floor(uv.y / bs.y);
    vec2 q = vec2(uv.x + mod(row, 2.0) * bs.x * 0.5 + h11(row) * 0.6, uv.y); vec2 cc = floor(q / bs), f = fract(q / bs);
    float mortar = smoothstep(0.0, 0.045, f.x) * smoothstep(0.0, 0.07, f.y) * smoothstep(1.0, 0.97, f.x);
    c *= (0.82 + 0.24 * h21(cc + vr * 31.0)) * mix(0.55, 1.0, mortar);
    c *= 1.0 - 0.18 * smoothstep(0.55, 0.0, f.y) * (1.0 - f.y) * camFade(camD, 30.0, 120.0); // block shading (lower lip)
  } else c *= 0.8 + 0.4 * vr;                                                  // kit blocks: per-block tone
  c *= 0.86 + 0.24 * fbm2(uv * 1.3 + vr * 4.0);
  float grime = fbm2(vec2(uv.x * 0.08, vW.y * 0.03) + vr * 5.0);                  // large weathering patches (no clean walls)
  c *= mix(vec3(1.0), vec3(0.62, 0.66, 0.6), smoothstep(0.42, 0.75, grime));
  c = mix(c, c * vec3(0.78, 0.86, 0.7), (1.0 - smoothstep(4.0, 26.0, vW.y)) * 0.8);  // damp green-grey foot of the walls
  float streak = smoothstep(0.45, 0.8, vnoise(vec2(uv.x * 1.3, vW.y * 0.06))) * (1.0 - abs(N.y));
  c *= 1.0 - 0.28 * streak;                                                    // dark rain runs under ledges
  float lich = step(0.86, h21(floor(uv * 5.0))) * camFade(camD, 15.0, 45.0) * 0.18;
  c += vec3(0.9, 0.92, 0.75) * lich * 0.25;
  float moss = smoothstep(0.3, 0.85, N.y) * (0.55 + 0.45 * vnoise(uv * 0.4 + 2.0)) + smoothstep(0.58, 0.82, vnoise(uv * 0.32 + 9.0)) * 0.55 + streak * 0.3 * smoothstep(0.4, 0.7, vnoise(uv * 0.9));
  return frMoss(c, moss * 0.62);
}
vec3 frLeaf(vec3 alb, vec2 uv, vec3 N, vec3 V, float vr, float camD, inout vec3 emis) {
  float n = vnoise(uv * 0.9 + vr * 10.0), sp = h21(floor(uv * 6.0 + vr * 3.0));
  vec3 c = alb * mix(vec3(0.85, 1.04, 0.78), vec3(1.12, 1.04, 0.72), vr) * (0.72 + 0.5 * n);
  c *= mix(1.0, 0.78 + 0.42 * sp, camFade(camD, 25.0, 90.0));                  // leaf speckle (fades: no far shimmer)
  c = mix(c * vec3(0.78, 0.9, 0.8), c * vec3(1.2, 1.16, 0.78), smoothstep(-0.5, 0.75, N.y)); // cool undersides, sunlit tops
  float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
  emis += c * uSunCol * back * 0.35;                                           // translucency against the sun
  return c;
}
#ifdef FOREST_LEAF
// leaf cards (v0.44): the kit's RGBA leaf / twig atlas, alpha tested. The cutoff rises with the mip level (alpha
// coverage would otherwise average away: distant sprays thinning to nothing); bent clump normals, both sides lit
// alike, warm translucency against the sun.
uniform sampler2D uLeafMap;
vec3 frLeafCard(vec2 uv, vec3 tint, vec3 N, vec3 V, float vr, inout vec3 emis) {
  vec4 t = texture2D(uLeafMap, uv);
  vec2 ts = uv * 1024.0; float mip = max(0.0, 0.5 * log2(max(dot(dFdx(ts), dFdx(ts)), dot(dFdy(ts), dFdy(ts)))));
  if (t.a * (1.0 + 0.3 * mip) < 0.5) discard;
  vec3 c = t.rgb * tint * mix(vec3(0.92, 1.03, 0.9), vec3(1.08, 1.02, 0.84), vr);   // per-card hue drift
  c = mix(c * vec3(0.8, 0.9, 0.85), c, smoothstep(-0.6, 0.6, N.y));                 // cooler, darker undersides
  emis += c * uSunCol * pow(max(dot(-V, uSunDir), 0.0), 4.0) * 0.28;                // light through the leaves
  return c;
}
#endif
float frDapple(vec3 wp) { // sun visibility under the canopy (soft patches projected along the sun direction)
  float under = 1.0 - smoothstep(uCanopy.x - 14.0, uCanopy.x + 6.0, wp.y);
  if (under <= 0.0) return 1.0;
  vec2 sp = wp.xz - uOff + uSunDir.xz / max(uSunDir.y, 0.25) * max(0.0, uCanopy.x - wp.y);
  float g = smoothstep(0.36, 0.56, fbm2(sp * 0.04) * 0.75 + vnoise(sp * 0.15) * 0.25);
  return mix(1.0, mix(uCanopy.y, 1.25, g), under); // (sun patches slightly hotter than open sun: the warm shafts of the concept)
}
#endif
#ifdef REDROCK
// ---- Redrock Canyon (v0.46, redrock only): one sandstone palette for the code cliffs (29), the Blender kit (31) and the
// far canyon — rust-red strata with cream / beige bands at shared heights (world y: kit and cliffs line up), dark desert
// varnish runs down the faces, dusty tops, a damp darker foot; the textured Tripo heroes (30). Route-space noise (uOff).
uniform sampler2D uHeroMap; uniform vec2 uOff;
vec3 rrSand(vec3 alb, vec3 N, float vr, float camD) {
  vec2 g = vW.xz - uOff; float q = g.x * 0.62 + g.y * 0.78;
  float n = vnoise(vec2(q * 0.035, vW.y * 0.06) + vr * 3.0);
  float yy = vW.y + n * 1.6, band = fract(yy / 21.0), band2 = fract((yy + 7.0) / 9.5);
  float cream = smoothstep(0.0, 0.05, band) * (1.0 - smoothstep(0.09, 0.15, band));         // pale band every 21 m
  float thin = smoothstep(0.0, 0.06, band2) * (1.0 - smoothstep(0.1, 0.16, band2)) * 0.4;    // thinner beige bedding
  vec3 c = alb * (0.86 + 0.22 * vnoise(vec2(q * 0.11, yy * 0.42) + vr * 7.0));
  c = mix(c, c * vec3(1.18, 1.1, 0.98) + vec3(0.07, 0.05, 0.03), clamp(cream * 0.75 + thin, 0.0, 0.8)); // (a lighter tone of the same rock: no white stripes)
  c *= mix(vec3(1.0), vec3(0.86, 0.74, 0.7), smoothstep(0.55, 0.9, vnoise(vec2(q * 0.05 + 4.0, vW.y * 0.011)))); // tone drift
  float side = 1.0 - smoothstep(0.35, 0.7, abs(N.y));
  float varnish = smoothstep(0.62, 0.88, vnoise(vec2(q * 0.42, vW.y * 0.016) + 9.0)) * side * (1.0 - smoothstep(30.0, 160.0, camD) * 0.5);
  c *= 1.0 - 0.32 * varnish;                                                                  // desert varnish runs
  c = mix(c, c * vec3(1.12, 1.03, 0.9) + vec3(0.04, 0.03, 0.01), smoothstep(0.55, 0.85, N.y) * 0.7); // dusty, sunlit tops
  c *= mix(0.68, 1.0, smoothstep(2.0, 16.0, vW.y));                                           // damp foot at the river
  return c;
}
#endif
#ifdef NEON
uniform sampler2D uNeonAds;

vec3 neonFacade(vec3 base, vec2 uv, vec3 N, vec3 V, float seed, inout vec3 emis) {
  if (abs(N.y) > 0.65) return base;
  float style = floor(fract(seed * 5.73) * 3.0);
  vec2 cell = style < 1.0 ? vec2(2.2, 4.2) : (style < 2.0 ? vec2(5.4, 3.5) : vec2(1.65, 3.8));
  vec2 q = uv / cell;
  vec2 tile = floor(q);
  vec2 p = fract(q);
  vec2 footprint = fwidth(q);
  vec2 aa = clamp(footprint, vec2(0.01), vec2(0.22));
  vec2 inset = style < 1.0 ? vec2(0.16, 0.13) : (style < 2.0 ? vec2(0.07, 0.30) : vec2(0.09, 0.16));
  vec2 edge = min(p, 1.0 - p);
  vec2 inside = smoothstep(inset - aa, inset + aa, edge);
  float pane = inside.x * inside.y;
  float detail = 1.0 - smoothstep(0.13, 0.52, max(footprint.x, footprint.y));
  float occupied = step(h21(tile + seed * 41.0), uLitFrac + 0.08);
  float cluster = h21(vec2(floor(tile.x / 3.0), floor(tile.y / 4.0)) + seed * 17.0);
  vec3 lamps = mix(vec3(0.21, 0.34, 0.63), vec3(0.60, 0.65, 0.84), cluster);
  lamps = mix(lamps, uLit * 0.8, step(0.78, cluster));
  float office = 0.42 + 0.58 * smoothstep(0.15, 0.84, p.y);
  office *= mix(1.0, 0.52, smoothstep(0.19, 0.30, p.x) * (1.0 - smoothstep(0.46, 0.58, p.x)) * (1.0 - smoothstep(0.27, 0.39, p.y)));
  emis += lamps * mix((uLitFrac + 0.08) * 0.28, occupied * pane * mix(0.78, office, detail), detail);
  vec3 R = reflect(-V, N);
  vec3 glass = mix(uGlass, uRefl, smoothstep(-0.25, 0.7, R.y) * 0.68);
  float soffit = smoothstep(0.75, 0.94, p.y) * detail;
  emis += glass * (0.26 + 0.27 * soffit);
  return mix(base * (0.5 + 0.5 * (1.0 - soffit)), glass, pane * 0.9);
}
#endif
#ifdef MOONLIT
// ---- Moonlit Japanese City (moonlit only): storey-aligned facades (3.5 m storeys, the eave levels of
// src/worlds/kits/moonlit.js), dark navy tiles with moonlit crests.
vec3 mlShoji(vec3 wood, vec2 uv, vec3 N, float vr, inout vec3 emis) {
  emis += wood * uLit * 0.18 * uNight; // warm bounce from the lanterns / lit rooms on the timber
  if (abs(N.y) > 0.5) return wood * 0.8;
  float sy = fract(uv.y / 3.5), bay = uv.x / 1.9, fx = fract(bay);
  vec2 c = vec2(floor(bay), floor(uv.y / 3.5));
  float post = step(fx, 0.07) + step(0.93, fx), band = step(0.24, sy) * step(sy, 0.84); // posts; the window band
  if (band * (1.0 - post) < 0.5) return wood * (sy < 0.24 ? 0.62 : 0.9) * (0.82 + 0.18 * step(0.08, fract(uv.y / 0.3))); // sill boards, lintel
  vec2 g = fract(vec2(fx * 4.0, (sy - 0.24) / 0.6 * 5.0));
  float grid = step(0.08, g.x) * step(0.07, g.y), lit = step(h21(c + vr * 13.0), uLitFrac);
  emis += uLit * lit * grid * (0.62 + 0.38 * h21(c + 1.7)) * (0.3 + 0.9 * uNight);
  return mix(wood * 0.5, vec3(0.95, 0.86, 0.68) * mix(0.32, 1.0, lit), grid);
}
vec3 mlPlaster(vec3 alb, vec2 uv, vec3 N) { // white plaster: a timber band at every storey line, faint posts
  if (abs(N.y) > 0.5) return alb;
  float sy = fract(uv.y / 3.5), beam = step(sy, 0.06) + 0.45 * step(abs(fract(uv.x / 4.2) - 0.5), 0.025);
  return mix(alb * (0.9 + 0.1 * vnoise(uv * 1.3)), vec3(0.14, 0.1, 0.08), clamp(beam, 0.0, 1.0));
}
vec3 mlTile(vec3 alb, vec2 uv, vec3 N, vec3 V, inout vec3 emis) { // round tile rows; the moon catches their crests
  float rr = fract(uv.x * 2.6), crest = smoothstep(0.2, 0.5, rr) * smoothstep(0.8, 0.5, rr);
  alb *= (0.5 + 0.7 * crest) * (0.85 + 0.15 * step(0.1, fract(uv.y * 2.2)));
  emis += uSunCol * crest * pow(max(dot(reflect(-V, N), uSunDir), 0.0), 6.0) * 0.1;
  return alb;
}
#endif
void main() {
  int k = int(vMat.x + 0.5); float vr = vMat.y;
  vec3 N = normalize(vN);
  #ifdef FOREST
  if (!gl_FrontFacing && k != 28) N = -N; // (leaf cards: one bent clump normal for both sides)
  #else
  if (!gl_FrontFacing) N = -N;
  #endif
  vec3 V = normalize(cameraPosition - vW);
  vec3 alb = vCol; vec3 emis = vec3(0.0); float unlit = 0.0;
  vec2 uv = vUv;
  #ifdef NEON
  if (k == ${NEON_SIGN}) {
    vec2 tile = vec2(mod(vr, 4.0), 1.0 - floor(vr / 4.0));
    vec2 atlasUv = (tile + mix(vec2(0.012), vec2(0.988), uv)) / vec2(4.0, 2.0);
    vec3 screen = texture2D(uNeonAds, atlasUv).rgb;
    float sweep = 0.08 * exp(-12.0 * abs(uv.y - fract(uTime * 0.09 + vr * 0.17)));
    gl_FragColor = vec4(screen * (0.86 + sweep), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vW);
    return;
  }
  if (k == ${NEON_FACADE}) alb = neonFacade(alb, uv, N, V, vr, emis);
  else
  #endif
  #ifdef REDROCK
  float rrD = length(vW - cameraPosition);
  if (k == 29) { alb = rrSand(alb, N, vr, rrD); alb *= 1.0 - 0.14 * (1.0 - smoothstep(0.0, 0.08, abs(fract(uv.y / (1.3 + 0.7 * vr)) - 0.5) - 0.42)) * (1.0 - smoothstep(25.0, 90.0, rrD)); } // + fine bedding lines (near)
  else if (k == 31) alb = rrSand(alb, N, vr, rrD);
  else if (k == 30) alb = texture2D(uHeroMap, vUv).rgb * vCol * 1.1 * mix(0.72, 1.0, smoothstep(2.0, 16.0, vW.y));
  else
  #endif
  #ifdef FOREST
  float frD = length(vW - cameraPosition);
  if (k == 4 || k == 23) alb = frBark(alb, uv, N, vr, frD);
  else if (k == 8 || k == 24) alb = frStone(alb, uv, N, vr, frD, k == 8);
  else if (k == 11 || k == 25) alb = frLeaf(alb, uv, N, V, vr, frD, emis);
  else if (k == 27) { alb *= 0.78 + 0.34 * fbm2(uv * 0.8 + vr * 3.0); alb = frMoss(alb, smoothstep(0.15, 0.7, N.y) * (0.5 + 0.5 * vr) + 0.15); }
  else if (k == 26) { alb = texture2D(uHeroMap, vUv).rgb * vCol * 1.12; alb = frMoss(alb, smoothstep(0.75, 0.98, N.y) * 0.25); }
  #ifdef FOREST_LEAF
  else if (k == 28) alb = frLeafCard(vUv, vCol, N, V, vr, emis);
  #endif
  else
  #endif
  #ifdef TREE_LEAVES
  if (k == ${K.LEAF_CARD}) {
    vec4 leaves = texture2D(uTreeLeaves, uv);
    if (leaves.a < ${FOLIAGE_CUTOFF}) discard;
    alb *= leaves.rgb;
    N = normalize(vec3(N.x * 0.35, 0.85, N.z * 0.35));
    emis += alb * (0.17 + 0.44 * uNight);
  } else
  #endif
  #ifdef MOONLIT
  if (k == 9) alb = mlShoji(alb, uv, N, vr, emis);
  else if (k == 13) alb = mlPlaster(alb, uv, N);
  else if (k == 5) alb = mlTile(alb, uv, N, V, emis);
  else
  #endif
  if (k == 1) { // masonry facade + windows
    vec3 b = alb;
    if (abs(N.y) < 0.5) {
      float brick = step(0.06, fract(uv.y / 0.3)) * step(0.04, fract((uv.x + step(0.5, fract(uv.y / 0.6)) * 0.45) / 0.9));
      b *= 0.86 + 0.14 * brick;
      alb = windows(b, uv, vec2(3.4, 3.6), vec2(1.55, 2.1), vr, emis, 0.6);
    }
  } else if (k == 2) { emis = alb * 1.6; alb *= 0.2; unlit = 1.0; }
  else if (k == 3) { // rock strata: soft low-frequency bands, cross-bedding, vertical fissures, weathered streaks
    float n = fbm2(vec2(uv.x * 0.05, vW.y * 0.18) + vr * 7.0), n2 = vnoise(uv * vec2(0.9, 0.25) + 3.1);
    float band = 0.5 + 0.5 * sin(vW.y * 0.42 + n * 1.3 + vr * 6.0);
    alb *= 0.78 + 0.26 * band + 0.14 * (n2 - 0.5);
    alb *= 1.0 - 0.22 * smoothstep(0.86, 0.97, fract(vW.y / 5.3 + n * 0.2));
    float fis = smoothstep(0.035, 0.0, abs(fract(uv.x / 6.5 + n * 0.8) - 0.5) - 0.46) * smoothstep(0.35, 0.65, n2);
    alb *= 1.0 - 0.35 * fis;
    float thin = smoothstep(0.08, 0.0, abs(fract(vW.y / (1.1 + 0.6 * vr) + n * 0.08) - 0.5) - 0.42); alb *= 1.0 - 0.12 * thin; // fine bedding lines
    alb *= 0.92 + 0.12 * vnoise(vec2(uv.x * 0.03, vW.y * 0.02) + vr * 4.0); // large-scale tone drift
    if (N.y > 0.6) alb = mix(alb, alb * vec3(1.1, 1.0, 0.92), 0.6);
  } else if (k == 4) { // bark
    float g = vnoise(vec2(uv.x * 2.2, uv.y * 0.18)) ;
    alb *= 0.6 + 0.5 * g; alb *= 0.85 + 0.15 * sin(uv.x * 9.0 + g * 6.0);
    alb = mix(alb, uMoss, smoothstep(0.55, 0.9, vnoise(uv * 0.5 + 3.0)) * 0.55);
  } else if (k == 5) { // roof tiles (rows + rounded ridges)
    float rr = fract(uv.x * 2.4); alb *= 0.62 + 0.45 * smoothstep(0.0, 0.5, rr) * smoothstep(1.0, 0.5, rr);
    alb *= 0.85 + 0.15 * step(0.12, fract(uv.y * 2.0));
  } else if (k == 6) { // ice
    float cr = smoothstep(0.018, 0.0, abs(vnoise(uv * 0.5 + vr * 9.0) - 0.5)) * 0.6 + smoothstep(0.012, 0.0, abs(vnoise(uv * 1.3 + 4.0) - 0.5)) * 0.3;
    alb *= 0.9 + 0.2 * vnoise(uv * vec2(0.3, 0.08) + vr * 3.0); // depth streaks
    float fr = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    alb = mix(alb, vec3(0.85, 0.97, 1.0), fr * 0.55);
    emis += vec3(0.25, 0.75, 1.0) * (cr * 0.5 + 0.15 * fr) * (0.4 + 0.6 * uNight);
  } else if (k == 7) { // metal panels
    vec2 p = fract(uv / vec2(2.4, 1.8));
    alb *= 1.0 - 0.35 * (step(p.x, 0.03) + step(p.y, 0.04));
    alb *= 0.85 + 0.25 * vnoise(uv * 0.7 + vr * 5.0);
    alb = mix(alb, alb * vec3(1.25, 0.8, 0.55), smoothstep(0.65, 0.95, vnoise(uv * 0.25 + 4.0)) * 0.6); // rust
  } else if (k == 8) { // stone blocks
    vec2 bs = uStone; float row = floor(uv.y / bs.y);
    vec2 q = vec2(uv.x + mod(row, 2.0) * bs.x * 0.5, uv.y); vec2 c = floor(q / bs), f = fract(q / bs);
    float mortar = smoothstep(0.0, 0.05, f.x) * smoothstep(0.0, 0.07, f.y);
    alb *= (0.86 + 0.18 * h21(c + vr * 31.0)) * (0.74 + 0.26 * mortar);
    alb *= 0.9 + 0.1 * vnoise(uv * 2.0);
    float moss = smoothstep(0.25, 0.9, N.y) * 0.9 + smoothstep(0.5, 0.8, vnoise(uv * 0.28 + 9.0)) * 0.75 * (1.0 - smoothstep(10.0, 60.0, vW.y) * 0.5);
    alb = mix(alb, uMoss * (0.7 + 0.5 * vnoise(uv * 3.0)), clamp(moss * length(uMoss) * 1.2, 0.0, 0.85));
  } else if (k == 9) { // timber frame + glowing shoji panels
    vec2 cell = vec2(1.9, 2.6); vec2 c = floor(uv / cell), f = fract(uv / cell);
    float post = step(f.x, 0.09) + step(0.91, f.x), rail = step(f.y, 0.08) + step(0.92, f.y);
    vec3 wood = alb;
    if (abs(N.y) < 0.5 && post + rail < 0.5) {
      vec2 g = fract(f * vec2(3.0, 4.0)); float grid = step(0.08, g.x) * step(0.08, g.y);
      float lit = step(h21(c + vr * 13.0), uLitFrac);
      vec3 paper = vec3(0.95, 0.88, 0.72);
      alb = mix(wood * 0.6, paper * mix(0.55, 1.0, lit), grid);
      emis += uLit * lit * grid * (0.7 + 0.3 * h21(c)) * (0.3 + 0.9 * uNight);
    } else alb = wood * (0.85 + 0.15 * vnoise(uv * vec2(0.5, 4.0)));
    emis += wood * uLit * 0.22 * uNight; // warm bounce from the lanterns / lit rooms on the timber
  } else if (k == 10) { // glass curtain wall
    vec2 cell = vec2(1.6, 3.8); vec2 c = floor(uv / cell), f = fract(uv / cell);
    float mull = step(f.x, 0.06) + step(f.y, 0.05);
    vec3 R = reflect(-V, N);
    vec3 refl = mix(uGlass, uRefl, smoothstep(-0.2, 0.6, R.y)) + uSunCol * pow(max(dot(R, uSunDir), 0.0), 40.0) * 0.6;
    alb = mix(refl * (0.85 + 0.25 * h21(c + vr)), alb * 0.5, mull * 0.8);
    float lit = step(h21(c * 0.37 + vr * 7.0 + floor(c.y / 3.0)), uLitFrac * 0.8);
    emis += lit * (1.0 - mull) * uLit * (0.35 + 0.65 * uNight) * (0.55 + 0.45 * uNight) * (0.8 + 0.4 * h21(c + 2.0));
    unlit = 0.55;
  } else if (k == 11) { // foliage / blossoms
    float n = vnoise(uv * 1.3 + vr * 10.0);
    alb *= 0.7 + 0.55 * n;
    float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
    emis += alb * uSunCol * back * 0.25 + alb * 0.22 * uNight; // (night: blossoms / leaves keep their colour)
  } else if (k == 12) { // red lattice windows (Chinese)
    vec2 cell = vec2(2.2, 2.8); vec2 c = floor(uv / cell), f = fract(uv / cell);
    float frame = step(f.x, 0.1) + step(0.9, f.x) + step(f.y, 0.08) + step(0.92, f.y);
    if (abs(N.y) < 0.5 && frame < 0.5) {
      vec2 g = fract(f * 5.0); float lat = step(0.18, g.x) * step(0.18, g.y);
      float lit = step(h21(c + vr * 3.0), uLitFrac);
      alb = mix(alb * 0.55, vec3(1.0, 0.78, 0.48) * mix(0.5, 1.0, lit), lat);
      emis += uLit * lit * lat * (0.25 + 0.7 * uNight);
    }
  } else if (k == 13) { // white plaster with dark timber beams
    float beam = step(fract(uv.y / 3.4), 0.07) + step(fract(uv.x / 4.2), 0.045);
    alb = mix(alb * (0.92 + 0.08 * vnoise(uv * 1.5)), vec3(0.16, 0.11, 0.09), clamp(beam, 0.0, 1.0));
  } else if (k == 14) { // snow
    alb *= 0.92 + 0.08 * vnoise(uv * 3.0);
    emis += vec3(0.9, 0.95, 1.0) * step(0.985, h21(floor(uv * 9.0))) * 0.35;
  } else if (k == 15) { // lava fall / glowing seam
    float fl = vnoise(vec2(uv.x * 0.6, uv.y * 0.25 + uTime * 0.9)) ;
    emis = mix(vec3(1.0, 0.25, 0.02), vec3(1.0, 0.85, 0.35), fl) * (1.2 + 0.6 * fl); alb *= 0.1; unlit = 1.0;
  } else if (k == ${K.LAVA_FLOW}) { // channel / fall, v follows the downstream distance in metres
    float run = uv.y * 0.23 - uTime * (1.1 + vr * 0.30);
    float across = uv.x * 7.0 + sin(run * 0.67 + vr * 6.28) * 0.55;
    float threads = vnoise(vec2(across, run * 0.52));
    float pulses = vnoise(vec2(across * 1.55 + 5.0, run * 1.14 + threads * 1.7));
    float heat = smoothstep(0.26, 0.85, threads * 0.68 + pulses * 0.32);
    float flank = smoothstep(0.018, 0.21, min(uv.x, 1.0 - uv.x));
    vec3 molten = mix(vec3(0.92, 0.075, 0.006), vec3(1.0, 0.77, 0.18), heat);
    emis = mix(vec3(0.34, 0.024, 0.002), molten, flank) * (0.82 + 0.39 * pulses);
    alb *= 0.09;
  } else if (k == 16) { // wood planks
    alb *= 0.78 + 0.22 * step(0.08, fract(uv.y / 0.32)); alb *= 0.85 + 0.2 * vnoise(vec2(uv.x * 0.4, uv.y * 3.0));
  } else if (k == 17) { // adobe / plaster (cliff dwellings): blotchy
    alb *= 0.85 + 0.2 * vnoise(uv * 0.8);
  }
  #ifdef FOLDSCAPE
  else if (k >= 18 && k <= 22) { // foldscape masonry: brick (18 rect windows, 19 arched, 21 plain) / limestone (20 windows, 22 plain)
    float camD = length(vW - cameraPosition);
    bool stone = k == 20 || k == 22;
    float L = stone ? 3.0 : (vr > 0.72 ? 1.0 : 0.0);
    vec3 wall = fsWeather(fsDetail(alb, uv / (stone ? 3.2 : 2.6), L, N, camD, stone ? 0.7 : 0.8), uv);
    if (k <= 20 && abs(N.y) < 0.5) {
      vec3 dN = N; vec3 trim = fsDetail(vec3(0.80, 0.73, 0.60) * (stone ? 1.08 : 1.0), uv / 3.2, 3.0, dN, camD, 0.6);
      alb = fsWindows(wall, trim, uv, k == 19 ? 1.0 : 0.0, vr, emis, N, V, camD);
    } else alb = wall;
  }
  #endif
  // lighting
  float ndl = max(dot(N, uSunDir), 0.0);
  #ifdef FOLDSCAPE
  ndl *= mix(uShade.z, 1.0, smoothstep(uShade.x, uShade.y, vW.y + 5.0 * vnoise(vW.xz * 0.03))); // street canyon in shade, upper floors in the low sun
  #endif
  #ifdef FOREST
  ndl *= mix(1.0, frDapple(vW), camFade(frD, 180.0, 420.0)); // (far / backdrop: no dapples)
  #endif
  float ao = mix(uAO.x, uAO.y, smoothstep(0.0, uAO.z, vW.y));
  vec3 hemi = mix(uGnd, uSky, N.y * 0.5 + 0.5) * uHemiI;
  vec3 lit = alb * (uSunCol * ndl * uSunI + hemi) * ao;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * (0.3 + 0.35 * uNight);
  #ifdef MOONLIT
  rim *= mix(0.2, 1.0, clamp(dot(alb, vec3(0.3, 0.59, 0.11)) * 4.0, 0.0, 1.0)); // dark tiles / timber keep a faint rim only
  if (k == 13) lit += alb * vec3(0.08, 0.09, 0.13) * ao;                         // white plaster reads white under the moon
  #endif
  lit += uRim * rim * ao * (0.4 + 0.6 * max(dot(-V, uSunDir), 0.2));
  #ifdef REDROCK
  lit += alb * vec3(0.05, 0.07, 0.13) * (1.0 - ndl) * ao;                                      // cool sky fill in the shade (concept: violet shadows)
  lit += alb * vec3(0.20, 0.09, 0.04) * (1.0 - smoothstep(-0.8, 0.2, N.y)) * 0.6;              // warm bounce under overhangs / arches
  #endif
  #ifdef FOREST
  lit += alb * vec3(0.10, 0.24, 0.22) * smoothstep(0.1, -0.9, N.y) * (1.0 - smoothstep(4.0, 30.0, vW.y)); // turquoise bounce off the stream
  #endif
  vec3 c = mix(lit, alb, unlit * 0.0) + emis;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vW);
}`;

export function createWorldMaterial(look) {
  const L = look, f = L.fog, w = L.win, fold = L.art === 'foldscape';
  // foldscape only: the FOLDSCAPE branch (texture arrays are attached by src/worlds/art/foldscapeArt.js — the city's
  // CC0 arrays, shared, never owned here); every other map compiles exactly the previous shader
  const extra = fold ? { uAlb: { value: null }, uNrm: { value: null }, uOrm: { value: null }, uPbrOn: { value: 0 }, uShade: { value: new THREE.Vector4(...(L.shade || [6, 30, 0.3, 0])) } } : {};
  // forest only (v0.43): the FOREST branch (hero texture uniform set per hero material by src/worlds/art/forestArt.js)
  const forest = L.art === 'forest', redrock = L.art === 'redrock', neon = L.art === 'neon', moonlit = L.art === 'moonlit';
  if (redrock) Object.assign(extra, { uHeroMap: { value: null }, uOff: { value: new THREE.Vector2() } }); // (redrock only, v0.46)
  if (forest) Object.assign(extra, { uHeroMap: { value: null }, uCanopy: { value: new THREE.Vector2(...(L.canopy || [64, 0.4])) }, uOff: { value: new THREE.Vector2() } });
  if (neon) extra.uNeonAds = { value: null };
  const material = new THREE.ShaderMaterial({
    name: 'WorldMat', vertexColors: true, defines: fold ? { FOLDSCAPE: 1 } : forest ? { FOREST: 1 } : redrock ? { REDROCK: 1 } : neon ? { NEON: 1 } : moonlit ? { MOONLIT: 1 } : {},
    uniforms: { ...extra,
      uSunDir: { value: new THREE.Vector3(...L.sunDir).normalize() }, uSunCol: { value: C(L.sunColor) }, uSunI: { value: L.sunI * 0.95 },
      uSky: { value: C(L.hemiSky) }, uGnd: { value: C(L.hemiGround) }, uHemiI: { value: L.hemiI * 0.62 },
      uAO: { value: new THREE.Vector3(...L.ao) }, uRim: { value: C(L.rim) }, uTime: { value: 0 }, uNight: { value: L.night },
      uLit: { value: C(w.lit) }, uGlass: { value: C(w.glass) }, uRefl: { value: C(w.refl) }, uLitFrac: { value: w.litFrac },
      uAccent: { value: C(0x22d3ff) }, uAccent2: { value: C(0xff4ad8) }, uMoss: { value: C(L.moss ?? 0x000000) }, uStone: { value: new THREE.Vector2(...(L.stone || [1.7, 0.9])) },
      uFogCol: { value: C(f.color) }, uFog: { value: new THREE.Vector4(f.near, f.far, f.height, 0) },
    },
    vertexShader: WORLD_VS, fragmentShader: WORLD_FS,
  });
  if (neon) bindNeonAds(material);
  return material;
}

export function createTreeMaterial(base) {
  const material = base.clone();
  material.name = 'TreeLeaves';
  material.side = THREE.FrontSide;
  material.defines.TREE_LEAVES = 1;
  material.uniforms = { ...base.uniforms, uTreeLeaves: { value: treeLeafTexture() } };
  return material;
}

// =============================================================================================== glow (additive)
export function createGlowMaterial(look, { opacity = 1 } = {}) {
  return new THREE.ShaderMaterial({
    name: 'WorldGlow', vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    defines: look.art === 'neon' ? { NEON: 1 } : {},
    uniforms: { uTime: { value: 0 }, uOpacity: { value: opacity }, uFogCol: { value: C(look.fog.color) }, uFog: { value: new THREE.Vector4(look.fog.near, look.fog.far * 1.4, 0, 0) }, uSunDir: { value: new THREE.Vector3(...look.sunDir).normalize() }, uSunCol: { value: C(look.sunColor) } },
    vertexShader: WORLD_VS,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uOpacity;
      varying vec3 vCol; varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying vec2 vMat;
      ${COMMON}
      uniform vec3 uFogCol; uniform vec4 uFog; uniform vec3 uSunDir; uniform vec3 uSunCol;
      void main() {
        int k = int(vMat.x + 0.5);
        float a = uOpacity;
        vec3 V = normalize(cameraPosition - vW), N = normalize(vN);
        if (k == 1) { a *= 0.35 + 0.65 * pow(abs(dot(N, V)), 0.6); a *= 0.75 + 0.25 * step(0.5, fract(vUv.y * 2.5 - uTime * 0.6)); } // holo panel scanlines
        else if (k == 2) { a *= smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.6, vUv.y) * (0.7 + 0.3 * vnoise(vec2(vUv.x * 3.0, vUv.y * 2.0 - uTime * 1.5))); } // waterfall / light shaft
        else if (k == 3) { a *= pow(abs(dot(N, V)), 1.5); } // soft halo
        #ifdef NEON
        else if (k == 4) { // soft spill on the wall around an LED sign
          vec2 edge = abs(vUv - 0.5) * 2.0;
          a *= (1.0 - smoothstep(0.38, 1.0, max(edge.x, edge.y))) * 0.32;
        }
        else if (k == 5) { // distant light shaft, one tapered quad
          a *= (1.0 - smoothstep(0.06, 0.5, abs(vUv.x - 0.5))) * (1.0 - smoothstep(0.0, 0.92, vUv.y)) * 0.10;
        }
        #endif
        float d = length(vW - cameraPosition); a *= 1.0 - smoothstep(uFog.x, uFog.y, d) * 0.85;
        gl_FragColor = vec4(vCol * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// =============================================================================================== floor
const FLOOR_FS = /* glsl */ `
uniform vec3 uA; uniform vec3 uB; uniform vec3 uLine; uniform vec3 uY; uniform float uTime; uniform int uMode; uniform float uHalfW;
uniform vec3 uSkyH; uniform vec3 uSkyZ; uniform float uNight;
varying vec3 vCol; varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying vec2 vMat;
${COMMON}
${FOG}
#ifdef FOREST
uniform vec2 uCanopy; uniform vec2 uOff;
float frDappleF(vec3 wp) { vec2 sp = wp.xz - uOff + uSunDir.xz / max(uSunDir.y, 0.25) * max(0.0, uCanopy.x - wp.y); return smoothstep(0.4, 0.62, fbm2(sp * 0.045) * 0.75 + vnoise(sp * 0.17) * 0.25); }
#endif
// The two nearest jittered plate centres are equidistant at a fracture.
float iceFractures(vec2 p) {
  vec2 tile = floor(p), f = fract(p);
  float nearest = 10.0, second = 10.0;
  for (int z = -1; z <= 1; z++) for (int x = -1; x <= 1; x++) {
    vec2 cell = vec2(float(x), float(z));
    float seed = h21(tile + cell);
    vec2 d = cell + 0.27 + vec2(seed, fract(seed * 17.13)) * 0.46 - f;
    float dist = dot(d, d);
    second = min(second, max(nearest, dist));
    nearest = min(nearest, dist);
  }
  float gap = second - nearest;
  float aa = min(0.12, fwidth(gap));
  return 1.0 - smoothstep(0.004, 0.012 + aa, gap);
}
void main() {
  vec2 uv = vUv; // x = metres along the route, y = metres across (0 = centre)
  float ax = abs(uv.y);
  vec3 V = normalize(cameraPosition - vW);
  vec3 c = uA; vec3 e = vec3(0.0);
  if (uMode == 0) { // street: asphalt, double yellow, dashes, sidewalks, crosswalk every 70 m
    float road = step(ax, uHalfW - 3.5);
    c = mix(uB * (0.9 + 0.1 * vnoise(vW.xz * 0.5)), uA * (0.92 + 0.12 * vnoise(vW.xz * 1.3)), road);
    if (road > 0.5) {
      if (abs(ax - 0.2) < 0.1) c = uY;
      if (abs(ax - (uHalfW - 3.5) * 0.5) < 0.08 && fract(uv.x / 6.0) < 0.5) c = uLine;
      float cw = step(fract(uv.x / 70.0), 0.06); if (cw > 0.5 && fract(uv.y / 1.2) < 0.55) c = uLine * 0.95;
    } else { vec2 sl = fract(vW.xz / 1.5); if (sl.x < 0.04 || sl.y < 0.04) c *= 0.85; }
    float wet = uNight; // neon: rain-dark reflections
    vec3 R = reflect(-V, vec3(0.0, 1.0, 0.0));
    c = mix(c, c * 0.5 + mix(uSkyH, uSkyZ, R.y) * 0.25, wet * 0.6);
    // moving light streaks (neon night traffic)
    float lane = floor(uv.y / 3.0); float tr = fract(uv.x / 37.0 + uTime * (0.35 + 0.2 * h11(lane)) * sign(uv.y));
    e += uLine * wet * smoothstep(0.03, 0.0, abs(fract(uv.y / 3.0) - 0.5) * 0.1) * smoothstep(0.08, 0.0, tr) * step(ax, uHalfW - 4.0) * 1.5;
    #ifdef NEON
    float curb = abs(ax - (uHalfW - 5.0));
    float pool = smoothstep(0.38, 0.75, vnoise(vec2(uv.x * 0.12, uv.y * 0.40)));
    float smear = (1.0 - smoothstep(0.5, 5.5, curb)) * pool * road;
    vec3 neonTint = mix(vec3(0.34, 0.06, 0.44), vec3(0.06, 0.26, 0.45), 0.5 + 0.5 * sin(uv.x * 0.08 + sign(uv.y) * 2.0));
    e += neonTint * smear * 0.55;
    e += vec3(0.035, 0.06, 0.17) * (1.0 - smoothstep(1.0, 6.0, curb)) * 0.45;
    #endif
  }
  #ifdef FOREST
  else if (uMode == 1) { // forest stream (v0.43): meandering turquoise water between mossy banks, pebbles, sun dapples
    float off = sin(uv.x * 0.011) * 4.0 + sin(uv.x * 0.031 + 1.3) * 1.6, hw = 9.0 + 2.2 * sin(uv.x * 0.017 + 0.7);
    float d = abs(uv.y - off), edge = d - hw;
    vec2 f = vec2(uv.x * 0.08 - uTime * 0.45, uv.y * 0.22);
    float n = fbm2(f * 3.0);
    vec3 R = reflect(-V, normalize(vec3((n - 0.5) * 0.3, 1.0, (vnoise(f * 5.0) - 0.5) * 0.3)));
    vec3 sky = mix(uSkyH, uSkyZ, clamp(R.y, 0.0, 1.0));
    float fres = 0.18 + 0.7 * pow(1.0 - max(V.y, 0.0), 4.0);
    float depth = smoothstep(0.0, -hw * 0.8, edge);
    vec3 bed = mix(vec3(0.42, 0.40, 0.30), vec3(0.30, 0.34, 0.28), vnoise(uv * 0.7)) * (0.75 + 0.35 * step(0.5, vnoise(uv * 2.2)));
    vec3 water = mix(mix(bed, uB, 0.55), uA * 0.78, depth) * (0.8 + 0.3 * n);
    water = mix(water, sky, fres * 0.55);
    float foam = smoothstep(0.7, 0.9, fbm2(vec2(uv.x * 0.3 - uTime * 1.4, uv.y * 0.9))) * (0.25 + 0.75 * smoothstep(-2.5, 0.0, edge)) + smoothstep(-0.8, 0.0, edge) * 0.5 * vnoise(vec2(uv.x * 1.5 - uTime, uv.y));
    water = mix(water, uLine * 0.95, clamp(foam, 0.0, 1.0) * 0.6);
    e += uLine * pow(max(dot(R, uSunDir), 0.0), 60.0) * 0.7 * (1.0 - smoothstep(-1.0, 0.0, edge));
    // banks: wet pebbles → mossy loam with leaf litter
    vec2 g = vW.xz - uOff;
    float peb = step(0.55, h21(floor(g * 1.6))) * (1.0 - smoothstep(2.5, 6.0, edge));
    vec3 loam = mix(vec3(0.26, 0.22, 0.15), vec3(0.24, 0.32, 0.13), smoothstep(0.35, 0.7, fbm2(g * 0.09)));
    loam = mix(loam, vec3(0.36, 0.30, 0.18), smoothstep(0.6, 0.85, vnoise(g * 0.5)) * 0.6);              // leaf litter
    vec3 bank = mix(mix(vec3(0.30, 0.29, 0.24), vec3(0.46, 0.44, 0.38), peb), loam, smoothstep(1.5, 5.0, edge));
    bank *= 0.8 + 0.3 * vnoise(g * 1.7);
    c = mix(water, bank, smoothstep(-0.3, 0.6, edge));
    float sunV = frDappleF(vW);
    c *= mix(0.62, 1.12, sunV);
  }
  #endif
  #ifdef REDROCK
  else if (uMode == 1) { // redrock river (v0.46): a meandering turquoise channel with rapids between warm sand / gravel banks
    float off = sin(uv.x * 0.009) * 5.0 + sin(uv.x * 0.027 + 1.1) * 2.5, hw = 8.5 + 2.5 * sin(uv.x * 0.013 + 0.4);
    float edge = abs(uv.y - off) - hw;
    vec2 f = vec2(uv.x * 0.07 - uTime * 0.6, uv.y * 0.2);
    float n = fbm2(f * 3.0);
    vec3 R = reflect(-V, normalize(vec3((n - 0.5) * 0.3, 1.0, (vnoise(f * 5.0) - 0.5) * 0.3)));
    vec3 sky = mix(uSkyH, uSkyZ, clamp(R.y, 0.0, 1.0));
    float depth = 1.0 - smoothstep(-hw * 0.8, 0.0, edge), fres = 0.15 + 0.6 * pow(1.0 - max(V.y, 0.0), 4.0);
    vec3 water = mix(uB * 0.85, uA * 0.7, depth) * (0.82 + 0.3 * n);
    water = mix(water, sky, fres * 0.5);
    float rap = smoothstep(0.55, 0.8, vnoise(vec2(uv.x * 0.025, 1.7)));                       // rapid stretches
    float foam = smoothstep(0.62 - 0.2 * rap, 0.9, fbm2(vec2(uv.x * 0.35 - uTime * 1.5, uv.y * 0.8))) * (0.3 + 0.7 * rap) + smoothstep(-1.2, 0.0, edge) * 0.55 * vnoise(vec2(uv.x * 1.3 - uTime, uv.y));
    water = mix(water, uLine * 0.95, clamp(foam, 0.0, 1.0) * 0.7);
    e += uLine * pow(max(dot(R, uSunDir), 0.0), 60.0) * 0.6 * (1.0 - smoothstep(-1.0, 0.0, edge));
    vec2 g = vW.xz;
    float peb = step(0.6, h21(floor(g * 1.3))) * (1.0 - smoothstep(1.0, 5.0, edge));
    vec3 sand = mix(vec3(0.66, 0.46, 0.33), vec3(0.74, 0.56, 0.40), vnoise(g * 0.08)) * (0.85 + 0.25 * vnoise(g * 0.9));
    vec3 bank = mix(sand * vec3(0.62, 0.58, 0.56), sand, smoothstep(0.0, 3.5, edge));        // wet sand at the water line
    bank = mix(bank, vec3(0.42, 0.26, 0.19), peb * 0.6 + smoothstep(9.0, 16.0, edge) * 0.35);  // gravel, rubble toward the walls
    c = mix(water, bank, smoothstep(-0.4, 0.5, edge));
    c *= 0.82;                                                                                  // the canyon floor lies in the walls' shade
  }
  #endif
  #ifdef MOONLIT
  else if (uMode == 2) { // moonlit canal: deep blue water, a long moon path, warm lantern streaks along both walkways
    float n = fbm2(vec2(uv.x * 0.1 - uTime * 0.5, uv.y * 0.7)), t = uTime;
    // ripples from crossed sines: smooth slopes everywhere (value-noise normals put a grid into the sharp moon glint)
    vec2 w = vec2(sin(uv.x * 0.55 + uv.y * 0.8 - t * 1.1) + 0.6 * sin(uv.x * 1.7 - uv.y * 1.3 + t * 1.6),
                  sin(uv.y * 1.1 - uv.x * 0.35 + t * 0.9) + 0.5 * sin(uv.x * 2.3 + uv.y * 0.6 - t * 1.9));
    float n2 = 0.5 + 0.25 * w.x;
    vec3 R = reflect(-V, normalize(vec3(w.x * 0.035 + (n - 0.5) * 0.08, 1.0, w.y * 0.035)));
    vec3 sky = mix(uSkyH, uSkyZ, clamp(R.y * 1.5, 0.0, 1.0));
    float fres = 0.12 + 0.8 * pow(1.0 - max(V.y, 0.0), 4.0);
    c = mix(uA * (0.85 + 0.2 * n), sky * 0.8, fres * 0.6);
    e += uLine * pow(max(dot(R, uSunDir), 0.0), 120.0) * 1.2;
    float bank = 1.0 - smoothstep(0.0, 2.4, uHalfW - 9.6 - ax); // the 2.4 m of water in front of each walkway
    float streak = smoothstep(0.5, 0.85, vnoise(vec2(uv.x * 0.32, sign(uv.y) * 5.0))) * (0.55 + 0.45 * n2);
    e += vec3(1.0, 0.55, 0.22) * bank * streak * 0.42 * uNight;
  }
  #endif
  else if (uMode == 1 || uMode == 2) { // river / canal / stream: flowing water with sky reflection
    vec2 f = vec2(uv.x * 0.08 - uTime * 0.35, uv.y * 0.22);
    float n = fbm2(f * 3.0) ;
    vec3 R = reflect(-V, normalize(vec3((n - 0.5) * 0.25, 1.0, (vnoise(f * 5.0) - 0.5) * 0.25)));
    vec3 sky = mix(uSkyH, uSkyZ, clamp(R.y, 0.0, 1.0));
    float fres = 0.3 + 0.7 * pow(1.0 - max(V.y, 0.0), 3.0);
    c = mix(uA * (0.75 + 0.3 * n), sky, fres * 0.7);
    float foam = smoothstep(0.72, 0.9, fbm2(vec2(uv.x * 0.3 - uTime * 1.2, uv.y * 0.9))) * (0.4 + 0.6 * smoothstep(uHalfW * 0.4, uHalfW, ax));
    c = mix(c, uB, foam * 0.7);
    e += uLine * pow(max(dot(R, uSunDir), 0.0), 60.0) * 0.8 + uY * smoothstep(0.65, 1.0, n) * 0.15 * uNight;
    if (uMode == 2) { c = mix(c, uLine * 0.15 + c, 0.0); }
  } else if (uMode == 3) { // lava: a meandering, elongated flowing channel with fractured dark basalt crust toward the banks
    float bend = sin(uv.x * 0.018) * uHalfW * 0.22 + sin(uv.x * 0.047 + 1.3) * uHalfW * 0.08;
    float dc = abs(uv.y - bend) / (uHalfW * 0.6);
    vec2 f = vec2(uv.x * 0.02 - uTime * 0.14, uv.y * 0.2);
    float n = fbm2(f * 3.0 + vec2(0.0, fbm2(f * 2.0 + uTime * 0.04)));
    float crust = smoothstep(0.5, 1.0, dc + (n - 0.5) * 0.55);
    float vein = smoothstep(0.07, 0.0, abs(fbm2(f * vec2(1.2, 3.6) + 4.0) - 0.5));
    vec3 hot = mix(uA, uB, smoothstep(0.45, 0.85, 1.0 - n) * 0.5);
    c = mix(hot * 0.7, vec3(0.05, 0.036, 0.04) + uY * 0.04, crust);
    e = hot * (1.0 - crust) * (0.6 + 0.3 * smoothstep(0.5, 0.0, n)) + uA * vein * crust * 0.55;
  } else if (uMode == 4) { // frozen canal: blue ice with cracks + aurora reflection
    vec2 plates = vec2(dot(vW.xz, vec2(0.13, 0.038)), dot(vW.xz, vec2(-0.041, 0.098)));
    float cr = iceFractures(plates);
    vec3 R = reflect(-V, vec3(0.0, 1.0, 0.0));
    float au = smoothstep(0.4, 1.0, vnoise(vec2(R.x * 2.0 + uTime * 0.05, R.z * 0.8)));
    float streak = smoothstep(0.55, 0.95, vnoise(vec2(vW.x * 0.42, vW.z * 0.04 + uTime * 0.03))); // long glints stretched along the canal
    float frost = vnoise(vW.xz * vec2(1.7, 0.6));                                                   // opaque frost / clear-ice breakup
    vec3 ribbon = mix(vec3(0.1, 0.95, 0.7), vec3(0.62, 0.3, 1.0), smoothstep(0.3, 0.7, vnoise(vW.xz * vec2(0.03, 0.012) + 7.0)));
    c = mix(uA, uB, 0.25 + 0.3 * vnoise(vW.xz * 0.05)) * (0.63 + 0.24 * frost) + ribbon * (au * 0.33 + streak * 0.44);
    c = mix(c, uLine, cr * (0.29 + frost * 0.22));
    float bank = smoothstep(uHalfW * 0.7, uHalfW + 2.0, ax); c = mix(c, vec3(0.92, 0.95, 1.0), bank * 0.8);
  } else { // clouds sea
    vec2 f = vW.xz * 0.038 + vec2(uTime * 0.012, uTime * 0.004);
    float billows = fbm2(f);
    float wisps = fbm2(f * 2.6 + vec2(2.0, 0.6) + billows * 0.7);
    float crest = smoothstep(0.30, 0.72, billows * 0.78 + wisps * 0.22);
    c = mix(uA * (0.75 + 0.16 * wisps), uB, crest);
    c += uSunCol * pow(max(dot(normalize(vec3(-V.x, 0.4, -V.z)), uSunDir), 0.0), 4.0) * crest * 0.12;
  }
  gl_FragColor = vec4(c + e, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vW);
}`;
export const FLOOR_MODES = { street: 0, river: 1, stream: 1, canal: 2, lava: 3, ice: 4, clouds: 5 };
export function createFloorMaterial(map) {
  const L = map.look, F = L.floor, f = L.fog, forest = L.art === 'forest', redrock = L.art === 'redrock', neon = L.art === 'neon', moonlit = L.art === 'moonlit';
  return new THREE.ShaderMaterial({
    name: 'WorldFloor', vertexColors: true, defines: forest ? { FOREST: 1 } : redrock ? { REDROCK: 1 } : neon ? { NEON: 1 } : moonlit ? { MOONLIT: 1 } : {},
    uniforms: { ...(forest ? { uCanopy: { value: new THREE.Vector2(...(L.canopy || [64, 0.4])) }, uOff: { value: new THREE.Vector2() } } : {}),
      uA: { value: C(F.a) }, uB: { value: C(F.b) }, uLine: { value: C(F.line) }, uY: { value: C(F.yellow ?? F.rock ?? 0xffffff) },
      uTime: { value: 0 }, uMode: { value: FLOOR_MODES[map.gen.floor] ?? 0 }, uHalfW: { value: map.gen.halfW + 6 }, uNight: { value: L.night },
      uSkyH: { value: C(L.sky.horizon) }, uSkyZ: { value: C(L.sky.zenith) },
      uFogCol: { value: C(f.color) }, uFog: { value: new THREE.Vector4(f.near, f.far, f.height, 0) },
      uSunDir: { value: new THREE.Vector3(...L.sunDir).normalize() }, uSunCol: { value: C(L.sunColor) },
    },
    vertexShader: WORLD_VS, fragmentShader: FLOOR_FS,
  });
}

// =============================================================================================== sky
export function createSkyMaterial(look) {
  const S = look.sky;
  return new THREE.ShaderMaterial({
    name: 'WorldSky', side: THREE.BackSide, depthWrite: false,
    uniforms: {
      uZ: { value: C(S.zenith) }, uM: { value: C(S.mid) }, uH: { value: C(S.horizon) }, uBelow: { value: C(S.below) }, uSun: { value: C(S.sun) },
      uSunDir: { value: new THREE.Vector3(...look.sunDir).normalize() }, uSunSize: { value: S.sunSize }, uGlow: { value: S.sunGlow },
      uClouds: { value: S.clouds }, uCloudCol: { value: C(S.cloudColor) }, uCloudShade: { value: C(S.cloudShade) },
      uStars: { value: S.stars }, uMoon: { value: S.moon }, uAurora: { value: S.aurora }, uTime: { value: 0 },
    },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: /* glsl */ `
      uniform vec3 uZ, uM, uH, uBelow, uSun, uSunDir, uCloudCol, uCloudShade; uniform float uSunSize, uGlow, uClouds, uStars, uMoon, uAurora, uTime;
      varying vec3 vD;
      ${COMMON}
      void main() {
        vec3 d = normalize(vD); float y = d.y;
        vec3 c = y > 0.0 ? mix(mix(uH, uM, smoothstep(0.0, 0.22, y)), uZ, smoothstep(0.18, 0.75, y)) : mix(uH, uBelow, smoothstep(0.0, -0.25, y));
        float sd = dot(d, uSunDir);
        c += uSun * (pow(max(sd, 0.0), 6.0) * 0.35 + pow(max(sd, 0.0), 60.0) * 0.6) * uGlow;
        if (uSunSize > 0.0) c = mix(c, uSun * 1.6, smoothstep(1.0 - uSunSize * 0.02, 1.0 - uSunSize * 0.012, sd));
        if (uMoon > 0.0) { // big moon opposite-ish the light: drawn at the light direction (moonlight)
          float md = smoothstep(0.99935, 0.99955, sd);
          float craters = 0.85 + 0.15 * vnoise(d.xz * 900.0);
          c = mix(c, vec3(0.95, 0.96, 1.0) * craters * 1.25, md);
          c += vec3(0.6, 0.7, 1.0) * pow(max(sd, 0.0), 300.0) * 0.6 + vec3(0.3, 0.35, 0.6) * pow(max(sd, 0.0), 12.0) * 0.25;
        }
        if (uStars > 0.0 && y > 0.0) { vec2 g = floor(d.xz / (d.y + 0.4) * 260.0); float s = step(0.9965, h21(g)); c += vec3(0.9, 0.92, 1.0) * s * uStars * smoothstep(0.05, 0.4, y) * (0.6 + 0.4 * sin(uTime * 2.0 + h21(g + 1.0) * 30.0)); }
        if (uAurora > 0.0 && y > 0.025) {
          float az = atan(d.x, -d.z);
          vec3 light = vec3(0.0);
          for (int i = 0; i < 3; i++) {
            float fi = float(i), phase = uTime * 0.038 + fi * 1.8;
            float foot = 0.14 + fi * 0.063 + sin(az * 2.0 + phase) * 0.054
              + sin(az * 6.0 - phase * 1.2) * 0.035;
            float rise = y - foot;
            float folds = sin(az * 13.0 + sin(az * 5.0 + phase) * 1.8 + phase) * 0.5 + 0.5;
            float rays = sin(az * 57.0 + folds * 4.5 - rise * 9.0 + phase) * 0.5 + 0.5;
            float curtain = smoothstep(-0.022, 0.015, rise)
              * (1.0 - smoothstep(0.025, 0.155 + folds * 0.085, rise));
            float hem = 1.0 - smoothstep(0.0, 0.05, abs(rise - 0.012));
            vec3 hue = i == 0 ? vec3(0.065, 0.86, 0.44)
              : (i == 1 ? vec3(0.40, 0.12, 0.84) : vec3(0.05, 0.56, 0.68));
            light += hue * curtain * (0.18 + folds * 0.40 + rays * 0.26 + hem * 0.31);
          }
          c += light * uAurora * smoothstep(0.025, 0.085, y) * 0.76;
        }
        if (uClouds > 0.0 && y > -0.02) {
          vec2 p = d.xz / (y + 0.12) * 1.2 + vec2(uTime * 0.004, 0.0);
          float n = fbm2(p * 1.3) * 0.7 + fbm2(p * 3.7 + 3.0) * 0.3;
          float cl = smoothstep(0.52, 0.82, n) * uClouds * smoothstep(-0.02, 0.12, y) * (1.0 - smoothstep(0.55, 0.95, y));
          vec3 cc = mix(uCloudShade, uCloudCol, smoothstep(0.5, 0.95, n) + pow(max(sd, 0.0), 4.0) * 0.6);
          c = mix(c, cc, cl);
        }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// =============================================================================================== particles
export function createParticles(look) {
  const P = look.particles, n = P.count, box = 46;
  const g = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), rnd = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos[i * 3] = Math.random() * box; pos[i * 3 + 1] = Math.random() * box; pos[i * 3 + 2] = Math.random() * box; rnd[i] = Math.random(); }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aR', new THREE.BufferAttribute(rnd, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const kind = { dust: 0, motes: 1, rain: 2, snow: 3, petals: 4, embers: 5 }[P.kind] ?? 0;
  const m = new THREE.ShaderMaterial({
    name: 'WorldParticles', transparent: true, depthWrite: false, blending: kind === 5 || kind === 1 ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: box }, uCol: { value: C(P.color) }, uSize: { value: P.size }, uKind: { value: kind }, uScale: { value: 600 } },
    vertexShader: /* glsl */ `
      attribute float aR; uniform float uTime, uBox, uSize, uScale; uniform int uKind; uniform vec3 uCam; varying float vA; varying float vR;
      void main() {
        vec3 p = position; float t = uTime;
        if (uKind == 2) p.y -= t * 14.0; else if (uKind == 3) { p.y -= t * (1.2 + aR); p.x += sin(t * 0.7 + aR * 20.0) * 1.2; }
        else if (uKind == 4) { p.y -= t * (0.9 + aR * 0.6); p.x += sin(t * 0.9 + aR * 30.0) * 2.0 + t * 1.2; p.z += cos(t * 0.6 + aR * 12.0) * 1.5; }
        else if (uKind == 5) { p.y += t * (1.5 + aR * 2.0); p.x += sin(t * 1.3 + aR * 40.0) * 0.8; }
        else { p.y += sin(t * 0.3 + aR * 20.0) * 1.5; p.x += t * 0.3; }
        vec3 w = uCam + mod(p - uCam, uBox) - uBox * 0.5;
        vec4 mv = modelViewMatrix * vec4(w, 1.0);
        float d = -mv.z; vA = smoothstep(2.0, 6.0, d) * (1.0 - smoothstep(uBox * 0.35, uBox * 0.5, length(w - uCam))); vR = aR;
        gl_PointSize = uSize * uScale / max(d, 1.0) * (uKind == 2 ? 1.0 : 0.7 + aR * 0.6);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCol; uniform int uKind; varying float vA; varying float vR;
      void main() {
        vec2 q = gl_PointCoord - 0.5; float r = length(q);
        float a = smoothstep(0.5, 0.15, r);
        if (uKind == 2) a = smoothstep(0.08, 0.0, abs(q.x)) * smoothstep(0.5, 0.1, abs(q.y)) * 0.55; // rain streak
        if (uKind == 4) a = smoothstep(0.5, 0.3, length(q * vec2(1.0, 1.8))) * 0.9; // petal
        gl_FragColor = vec4(uCol * (uKind == 5 ? 1.6 : 1.0), a * vA * (uKind == 1 ? 0.6 : uKind == 0 ? 0.35 : 0.85));
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 20;
  return pts;
}
