// v0.30 modular building kit at runtime (renderer only — never imported by src/data, never collides).
//
// public/models/city_kit.glb is built by tools/blender/build_city_kit.py (original procedural pieces, baked vertex AO).
// Piece frame: x along the facade, y up, z out of the wall; origin = bottom-centre of a bay on the wall plane.
// COLOR_0: R ambient occlusion, G material id / 8, B edge mask.
//
// Streaming unit = ONE building face (or one roof) at ONE level of detail, so the expensive near geometry only exists
// where it can be seen:
//   bay    window bays (+ piers, quoins)   LOD0 ≤ ~30 m, LOD1 ≤ ~64 m, only floors near the camera height, never on
//          faces turned away from the camera (their own building hides them); further out the box shader (interior
//          mapping) carries the facade, then the backdrop / skyline.
//   shop   storefronts on shop faces       LOD0 ≤ 44 m, LOD1 ≤ 96 m
//   trim   cornices / crowns / parapets    LOD0 ≤ 64 m, LOD1 ≤ 190 m (silhouette pieces)
//   fe     real fire-escape bays           LOD0 ≤ 40 m (the old shader panels fade out inside that range)
//   roof   roof props (water towers, bulkheads, HVAC, antennas, billboards, vents, planters…) LOD0 ≤ 64 m, LOD1 ≤ 190 m
// Every unit has a target state per frame; changed units are rebuilt time-sliced (≤ budget ms per frame, resumable).
// LOD switches are invisible: each LOD fades in / out by camera distance in the shader (dithered, stable per pixel),
// and a unit is only dropped when its fade range is already fully out.
// Gameplay safety: no piece is placed within reach of a swing anchor; pieces below 44 m protrude ≤ 0.16 m (the kit
// guarantees it for facade pieces; deep cornices are only used on roof lines ≥ 44 m, else the shallow scaled version).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CITY_SHARED, CITY_COMMON_GLSL, adsAtlas } from './cityMaterials.js';
import { FX_LIGHT, FX_LIGHT_GLSL } from './fxLight.js';
import { artHash } from './cityArt.js';

export const KIT_CFG = {
  url: 'models/city_kit.glb',
  // [fade-in start, fade-in end, fade-out start, fade-out end] per class + LOD (metres from the piece origin)
  lod: {
    bay: [[0, 0, 13, 17], [13, 17, 56, 62]], // LOD0 (vertical jambs) only close: thin vertical edges are what crawls at range
    shop: [[0, 0, 38, 42], [38, 42, 88, 94]],
    trim: [[0, 0, 56, 62], [56, 62, 176, 188]], hero: [[0, 0, 5000, 6000], [1e5, 1e5, 1e5, 1e5]], fe: [[0, 0, 15.99, 16], [1e5, 1e5, 1e5, 1e5]], roof: [[0, 0, 48, 54], [48, 54, 176, 188]],
  },
  graze: [0.26, 0.36], // |cos| of the view angle to the facade normal: pieces fade out beyond ~73–78° (cannot read, would alias)
  bayMaxY: 84, // no window-bay geometry above this (the box shader carries it)
  hyst: 12, budgetMs: 0.7, targetsPerFrame: 360, // round-robin LOD-target checks per frame (all at once only on setFocus)
  cap: { bay0: 2600, bay1: 5200, small0: 1400, small1: 2600, shop0: 500, shop1: 900, trim0: 900, trim1: 2200, fe0: 500, roof0: 500, roof1: 1100 },
};
// v0.30: far LOD shares one pool per look (draw calls); null = no LOD1 (small pieces fade out at the LOD0 range)
const LOD1_ALIAS = { brick_bay_b: 'brick_bay_a', brick_bay_c: 'brick_bay_a', deco_spandrel_bay: 'deco_bay', deco_fin_bay: 'deco_bay', brick_pier: null, brick_quoin: null,
  brick_crown_b: 'brick_crown_a', brick_crown_c: 'brick_crown_a', brick_cornice_a: 'brick_cornice_b', storefront_a: 'storefront_b', storefront_c: 'storefront_b', storefront_d: 'storefront_b',
  roof_vent: null, roof_skylight: null, roof_chimney: null, roof_planter: null, roof_satellite: null, roof_parapet_rail: null };
// dev: ?kitdbg=hard (no dither: hard switch at the fade middle), ?kitfar=<m> (far LOD1 range for trim / roof)
const KIT_DBG = (() => { try { const u = new URLSearchParams(location.search); return { hard: u.get('kitdbg') === 'hard', norender: u.get('kitdbg') === 'norender', far: +u.get('kitfar') || 0 }; } catch { return {}; } })();
if (KIT_DBG.far) for (const c of ['trim', 'roof']) KIT_CFG.lod[c][1] = [KIT_CFG.lod[c][1][0], KIT_CFG.lod[c][1][1], KIT_DBG.far - 10, KIT_DBG.far];
const FAMILY = (st) => (st <= 2 ? 'brick' : st === 3 ? 'deco' : st === 4 || st === 5 ? 'glass' : st === 6 ? 'ind' : null);
const FACE_N = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] };
const STYLE_COL = [[0.56, 0.25, 0.18], [0.43, 0.29, 0.21], [0.77, 0.64, 0.48], [0.81, 0.76, 0.66], [0.3, 0.38, 0.5], [0.16, 0.17, 0.22], [0.36, 0.23, 0.25]];
const AWN = [0x2e6a4a, 0x8a2a2a, 0x2a3e7a, 0xa8742a, 0x5a2a6a, 0x2a6a72, 0x3a3a3a];

const KIT_VERT = /* glsl */`
attribute vec3 aTint; attribute vec4 aKit;
uniform vec4 uLod; uniform vec2 uGraze; uniform float uLodXZ;
varying vec3 vWorld, vN, vLocal, vLocalN, vTint; varying vec4 vCol, vKit; varying float vFade; varying vec2 vUv2;
#include <common>
#include <fog_pars_vertex>
void main() {
  mat4 M = modelMatrix * instanceMatrix;
  vec3 o = (M * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float d = uLodXZ > 0.5 ? distance(o.xz, cameraPosition.xz) : distance(o, cameraPosition);
  // v0.30b: per-INSTANCE switch inside the fade band (no pixel dither → no stipple / shimmer in stills or in motion).
  // Each piece has its own threshold; the near LOD uses thr, the far LOD's fade-in uses 1 − thr → exactly one shows.
  float thr = fract(sin(dot(floor(o.xz * 4.0) + floor(o.y * 4.0) * 0.37, vec2(12.9898, 78.233))) * 43758.5453);
  float fin = uLod.y <= 0.0 ? 1.0 : smoothstep(uLod.x, max(uLod.y, uLod.x + 1e-3), d);
  float fout = 1.0 - smoothstep(uLod.z, uLod.w, d);
  vFade = step(1.0 - thr, fin) * step(thr, fout);
  if (uGraze.y > 0.0) { // facade pieces: fade out at grazing view angles (their relief cannot read there; thin frames would alias)
    vec3 fn = normalize(mat3(M) * vec3(0.0, 0.0, 1.0)); vec3 vd = normalize(cameraPosition - o);
    vFade *= step(thr, smoothstep(uGraze.x, uGraze.y, abs(dot(fn, vd))));
  }
  vCol = color; vKit = aKit; vTint = aTint; vLocal = position; vLocalN = normal; vUv2 = uv;
  vec4 wp = M * vec4(position, 1.0); vWorld = wp.xyz; vN = normalize(mat3(M) * normal);
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = vFade <= 0.001 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mvPosition; // fully faded: no fragments
  #include <fog_vertex>
}`;
const KIT_FRAG = /* glsl */`
uniform vec3 uSunDir, uSunColor, uSky, uGround, uShade, uLit;
uniform vec4 uQ3, uQ4; uniform vec3 uStyleCol[7];
uniform sampler2D uAds;
varying vec3 vWorld, vN, vLocal, vLocalN, vTint; varying vec4 vCol, vKit; varying float vFade; varying vec2 vUv2;
${CITY_COMMON_GLSL}
${FX_LIGHT_GLSL}
#include <common>
#include <fog_pars_fragment>
void main() {
  if (vFade < 0.5) discard; // (whole-instance LOD switch decided in the vertex shader)
  float mid = floor(vCol.g * 8.0 + 0.5); float ao = clamp(vCol.r, 0.0, 1.0), edge = vCol.b;
  int st = int(vKit.x + 0.5);
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  vec3 V = normalize(cameraPosition - vWorld); float camD = length(cameraPosition - vWorld);
  // box-projected UV in piece space (stable per instance)
  vec3 an = abs(vLocalN); vec2 buv; vec3 T, B;
  if (an.x > an.y && an.x > an.z) { buv = vLocal.zy; } else if (an.y > an.z) { buv = vLocal.xz; } else { buv = vLocal.xy; }
  T = normalize(cross(vec3(0.0, 1.0, 0.0), abs(n.y) > 0.9 ? vec3(0.0, 0.0, 1.0) : n)); B = cross(n, T);
  vec3 alb; float L = 4.0, tile = 2.4, glassy = 0.0, emis = 0.0;
  if (mid < 0.5) { alb = uStyleCol[min(st, 6)] * vTint; L = st == 0 ? 0.0 : st == 1 || st == 6 ? 1.0 : st == 2 ? 2.0 : st == 3 ? 3.0 : 4.0; }
  else if (mid < 1.5) { alb = vec3(0.80, 0.74, 0.63) * mix(vec3(1.0), vTint, 0.25); L = 3.0; tile = 3.0; }
  else if (mid < 2.5) { alb = vec3(0.13, 0.13, 0.145); L = 6.0; tile = 1.6; }
  else if (mid < 3.5) { if (uQ3.x > 0.5 && vKit.w < 0.5) discard; alb = vec3(0.07, 0.09, 0.12); glassy = 1.0; L = 8.0; } // shop glass: let the box shader's interior-mapped shop show through
  else if (mid < 4.5) { alb = vec3(0.30, 0.55, 0.47); L = 6.0; if (vKit.w > 0.5) { alb = vec3(0.20, 0.50, 0.44); glassy = 0.45; } } // hero towers: green-blue curtain glass
  else if (mid < 5.5) { alb = vTint; L = 4.0; tile = 1.2; }
  else if (mid < 6.5) { alb = vec3(0.56, 0.55, 0.53); L = 4.0; }
  else { emis = 1.0; alb = vTint; }
  vec3 nL = n; float oAO = 1.0;
  if (uQ4.x > 0.5 && uPbrOn > 0.5 && emis < 0.5) {
    vec2 tuv = buv / tile;
    vec3 pa = texture(uAlb, vec3(tuv, L)).rgb, pavg = textureLod(uAlb, vec3(0.5, 0.5, L), 10.0).rgb;
    alb *= mix(vec3(1.0), clamp(pa / max(pavg, vec3(0.04)), 0.4, 1.8), 0.6);
    nL = pbrNormal(n, T, B, tuv, L, 0.9 * (1.0 - smoothstep(25.0, 80.0, camD)));
    oAO = mix(1.0, texture(uOrm, vec3(tuv, L)).r, 0.6);
  }
  float sunVis = uQ3.z > 0.5 ? mix(0.13, 1.0, hfShadow(vWorld + n * 0.3, uSunDir, 2.5)) : smoothstep(4.0, 24.0, vWorld.y) * 0.8 + 0.2;
  float ndl = max(dot(nL, uSunDir), 0.0);
  vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5);
  amb = mix(amb * uShade, amb, sunVis) * ao * oAO;
  vec3 col = alb * (amb * 0.66 + uSunColor * ndl * sunVis * 1.05);
  if (glassy > 0.5) {
    vec3 R = reflect(-V, n);
    vec3 sky = uEnvOn > 0.5 && uQ3.y > 0.5 ? envSky(R, 0.15) : mix(vec3(0.95, 0.66, 0.47), vec3(0.42, 0.48, 0.75), clamp(R.y * 1.6, 0.0, 1.0));
    col = mix(col, sky * (0.6 + 0.4 * sunVis), (0.25 + 0.6 * pow(1.0 - max(dot(n, V), 0.0), 3.0)) * glassy);
  }
  if (emis > 0.5) {
    vec3 ad = vUv2.x + vUv2.y > 0.0 ? texture(uAds, vec2((mod(floor(vKit.y * 8.0), 2.0) + vUv2.x) * 0.5, (3.0 - floor(floor(vKit.y * 8.0) / 2.0) + vUv2.y) * 0.25)).rgb : vec3(1.0);
    col = alb * ad * 1.35 * (0.92 + 0.08 * sin(uCityTime * 0.9 + vKit.y * 40.0));
  }
  if (uQ3.w > 0.5) {
    col += uRimCol * pow(1.0 - max(dot(n, V), 0.0), 4.0) * 0.35 * (0.3 + 0.7 * sunVis);
    col += alb * uSunColor * ndl * sunVis * 0.18;
    col += uSunColor * 0.1 * edge * sunVis * max(dot(n, uSunDir) + 0.2, 0.0);
    col += alb * uBounce * (1.0 - smoothstep(0.0, 24.0, vWorld.y)) * 0.55 * max(-n.y * 0.5 + 0.5, 0.0);
  }
  if (uQ4.w > 0.5) col += alb * fxLight(vWorld, n);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  if (uQ4.y > 0.5) gl_FragColor.rgb = fog2(gl_FragColor.rgb, vWorld, uSunDir);
  else {
  #include <fog_fragment>
  }
}`;

export function createCityKit({ root, world, cfg, SlotPool, STYLE_P, details, art, mat }) {
  const K = KIT_CFG;
  const group = new THREE.Group(); group.name = 'CityKit'; root.add(group);
  const stats = { ready: false, pieces: 0, units: 0, jobs: 0, miss: 0, instances: 0, buildMs: 0, maxBuildMs: 0, err: null };
  let on = false, pieces = null, manifest = null, warm = null, warmFrames = 0, lite = false;
  // v0.30 room-lite: inside Mobius' room the city is only seen through one window → skip the far roof / trim LOD1 pools
  // and the small roof extras (draw calls), like the v0.26 mirror-lite
  const LITE_HIDE = (key) => /\|1$/.test(key) && /^(roof_|brick_crown|brick_cornice|deco_setback|glass_crown)/.test(key) || /^roof_(vent|skylight|chimney|planter|satellite|parapet)/.test(key);
  const pools = {}; // `${piece}|${lod}` → SlotPool
  const mats = {};
  const shared = () => {
    const u = { uLod: { value: new THREE.Vector4() }, uGraze: { value: new THREE.Vector2() }, uLodXZ: { value: 0 }, uStyleCol: { value: STYLE_COL.map((c) => new THREE.Color(...c)) }, uAds: { value: adsAtlas() } };
    for (const k of ['uSunDir', 'uSunColor', 'uSky', 'uGround', 'uShade', 'uLit', 'uQ3', 'uQ4']) u[k] = mat.uniforms[k];
    return Object.assign(u, THREE.UniformsUtils.clone(THREE.UniformsLib.fog), CITY_SHARED, { uFxP0: FX_LIGHT.uFxP0, uFxC0: FX_LIGHT.uFxC0, uFxP1: FX_LIGHT.uFxP1, uFxC1: FX_LIGHT.uFxC1 });
  };
  function matFor(cls, lod) {
    const key = `${cls}${lod}`; if (mats[key]) return mats[key];
    const m = new THREE.ShaderMaterial({ vertexShader: KIT_VERT, fragmentShader: KIT_FRAG, fog: true, vertexColors: true, side: THREE.DoubleSide, uniforms: shared() }); // double-sided: mirrored corner pieces
    m.uniforms.uLod.value.set(...K.lod[cls][lod]); m.name = `city-kit-${key}`;
    if (cls === 'bay' || cls === 'shop') m.uniforms.uGraze.value.set(...K.graze);
    if (cls === 'fe') m.uniforms.uLodXZ.value = 1; // fire escapes: hard hand-over with the AA'd panel at the same ground distance
    if (KIT_DBG.hard) { const L = K.lod[cls][lod]; m.uniforms.uLod.value.set((L[0] + L[1]) / 2, (L[0] + L[1]) / 2 + 0.01, (L[2] + L[3]) / 2, (L[2] + L[3]) / 2 + 0.01); }
    return (mats[key] = m);
  }
  function capOf(name, cls, lod) {
    if (cls === 'bay') return /_bay/.test(name) && !/fire/.test(name) ? (lod ? K.cap.bay1 : K.cap.bay0) : (lod ? K.cap.small1 : K.cap.small0);
    return K.cap[`${cls}${lod}`] || 600;
  }
  function pool(name, cls, lod) {
    const key = `${name}|${lod}`; if (pools[key]) return pools[key];
    const pc = pieces?.[name]; if (!pc || !pc[lod]) return null;
    const cap = capOf(name, cls, lod), g = pc[lod].clone();
    g.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3));
    g.setAttribute('aKit', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    const m = new THREE.InstancedMesh(g, matFor(cls, lod), cap); m.name = `kit:${key}`; m.visible = false;
    group.add(m);
    const p = new SlotPool(m, cap); p.attrs = [g.attributes.aTint, g.attributes.aKit];
    return (pools[key] = p);
  }

  // ---------------------------------------------------------------- loading
  const loading = (async () => {
    try {
      const [gltf, man] = await Promise.all([new GLTFLoader().loadAsync(K.url), fetch(K.url.replace('.glb', '.json')).then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
      manifest = man; pieces = {};
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return; const mm = /^(.*)_LOD([01])$/.exec(o.name) || /^(.*)_LOD([01])$/.exec(o.parent?.name || ''); if (!mm) return;
        const g = o.geometry; o.updateWorldMatrix(true, false); if (!o.matrixWorld.equals(new THREE.Matrix4())) g.applyMatrix4(o.matrixWorld);
        if (!g.attributes.color) { const n = g.attributes.position.count, c = new Float32Array(n * 4); for (let i = 0; i < n; i++) c.set([1, 0, 0, 1], i * 4); g.setAttribute('color', new THREE.BufferAttribute(c, 4)); }
        if (g.attributes.color.itemSize === 3) { const s = g.attributes.color, n = s.count, c = new Float32Array(n * 4); for (let i = 0; i < n; i++) c.set([s.getX(i), s.getY(i), s.getZ(i), 1], i * 4); g.setAttribute('color', new THREE.BufferAttribute(c, 4)); }
        g.computeBoundingSphere();
        (pieces[mm[1]] = pieces[mm[1]] || [])[+mm[2]] = g;
      });
      stats.pieces = Object.keys(pieces).length;
      // every pool is created NOW (loading screen), not the first time a piece type streams in: an InstancedMesh fills
      // its whole capacity with identity matrices on creation (ms for thousands of slots) — that was a streaming spike
      const clsOf = (n) => (/^storefront|podium/.test(n) ? 'shop' : /fire_escape/.test(n) ? 'fe' : /^roof_/.test(n) ? 'roof' : /^hero_/.test(n) ? null : /cornice|crown|parapet|deco_belt/.test(n) ? 'trim' : 'bay');
      for (const n of Object.keys(pieces)) { const c = clsOf(n); if (!c) continue; pool(n, c, 0); if (!(n in LOD1_ALIAS) && c !== 'fe') pool(n, c, 1); }
      for (const v of Object.values(LOD1_ALIAS)) if (v) pool(v, clsOf(v), 1);
      stats.ready = true;
      // warm-up: one degenerate instance (zero scale) drawn until the first few frames are through → the kit program
      // is compiled by the loader's renderer.compile() / the first frame, never in gameplay (all kit materials share it)
      const any = pieces.brick_bay_a?.[0] || Object.values(pieces)[0]?.[0];
      if (any) {
        const g = any.clone(); g.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(3).fill(1), 3)); g.setAttribute('aKit', new THREE.InstancedBufferAttribute(new Float32Array(4), 4));
        warm = new THREE.InstancedMesh(g, matFor('bay', 0), 1); warm.setMatrixAt(0, new THREE.Matrix4().makeScale(1e-4, 1e-4, 1e-4)); warm.frustumCulled = false; warm.name = 'kit-warm'; group.add(warm); warmFrames = 4;
      }
    } catch (e) { stats.err = String(e?.message || e); console.warn('[city-kit] not loaded — the kit layer stays off', e); }
  })();

  // ---------------------------------------------------------------- placement helpers
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), vX = new THREE.Vector3(), vY = new THREE.Vector3(0, 1, 0), vZ = new THREE.Vector3(), tmpC = new THREE.Color();
  const wx = (b, ox, oz) => b.x + ox * b.cos + oz * b.sin, wz = (b, ox, oz) => b.z - ox * b.sin + oz * b.cos;
  function faceBasis(b, face, t) {
    const [nx, nz] = FACE_N[face.f], sx = t.hx * 2, sz = t.hz * 2;
    let tx, tz, uBase, half;
    if (nz > 0) { tx = 1; tz = 0; uBase = 0; half = t.hx; } else if (nx > 0) { tx = 0; tz = -1; uBase = sx; half = t.hz; } else if (nz < 0) { tx = -1; tz = 0; uBase = sx + sz; half = t.hx; } else { tx = 0; tz = 1; uBase = 2 * sx + sz; half = t.hz; }
    const off = nx ? t.hx : t.hz;
    const nW = [nx * b.cos + nz * b.sin, -nx * b.sin + nz * b.cos], tW = [tx * b.cos + tz * b.sin, -tx * b.sin + tz * b.cos];
    return { nx, nz, tx, tz, uBase, half, off, nW, tW,
      at: (s, d, y, out) => out.set(wx(b, tx * s + nx * (off + d), tz * s + nz * (off + d)), y, wz(b, tx * s + nx * (off + d), tz * s + nz * (off + d))),
      quat: (out) => { vX.set(tW[0], 0, tW[1]); vZ.set(nW[0], 0, nW[1]); return out.setFromRotationMatrix(tmpM.makeBasis(vX, vY, vZ)); } };
  }
  const seedF = (b) => (b.seed % 1000) / 1000;
  function nearAnchor(c, p, r) { for (const a of c.anchors) { const dx = a.pos[0] - p.x, dy = a.pos[1] - p.y, dz = a.pos[2] - p.z; if (dx * dx + dy * dy + dz * dz < r * r) return true; } return false; }
  function put(out, name, cls, lod, pos, quat, scl, tint, kit) {
    if (lod === 1 && name in LOD1_ALIAS) { name = LOD1_ALIAS[name]; if (!name) return false; }
    const p = pool(name, cls, lod); if (!p) return false;
    const h = p.alloc(); if (!h) { stats.miss++; return false; }
    tmpM.compose(pos, quat, scl); p.set(h, tmpM);
    p.attrs[0].setXYZ(h.i, tint[0], tint[1], tint[2]); p.attrs[1].setXYZW(h.i, kit[0], kit[1], kit[2], kit[3]);
    p.mesh.visible = true; out.push([p, h]); return true;
  }

  // ---------------------------------------------------------------- unit builders (generators: yield to stay in budget)
  const BAY_VARIANTS = { brick: ['brick_bay_a', 'brick_bay_b', 'brick_bay_c'], deco: ['deco_bay', 'deco_spandrel_bay', 'deco_fin_bay'], glass: ['glass_curtain_bay'] };
  function* buildFace(u, lod, camY, out) {
    const { c, b, t, face, ti } = u, fam = FAMILY(b.style); if (!fam || fam === 'ind' || fam === 'glass') return; // curtain walls stay flush (real ones are; the caps' thin verticals crawled)
    const F = faceBasis(b, face, t), [bw, fh] = STYLE_P[b.style], q = F.quat(tmpQ), sd = seedF(b);
    const R = (lod ? K.lod.bay[1][3] : K.lod.bay[0][3]) + 6;
    const sx = fam === 'glass' ? bw / 1.6 : 1, tint = b.tint, kit = [b.style, sd, 0, 0];
    const vars = BAY_VARIANTS[fam];
    const vi = Math.floor(artHash(b.seed, ti, 7) * vars.length);
    const shopTop = t.y0 === 0 && b.shops ? 4.6 : t.y0;
    const j0 = Math.max(0, Math.ceil(shopTop / fh - 1e-3)), j1 = Math.floor((Math.min(t.y1 - 1.1, K.bayMaxY) - fh) / fh + 1e-3);
    const m0 = Math.ceil((F.uBase - F.half) / bw - 1e-3), m1 = Math.floor((F.uBase + F.half) / bw + 1e-3) - 1;
    let n = 0;
    for (let j = j0; j <= j1; j++) {
      const y = j * fh; if (Math.abs(y + fh * 0.5 - camY) > R) continue;
      for (let m = m0; m <= m1; m++) {
        const s = (m + 0.5) * bw - F.uBase;
        F.at(s, 0, y, tmpP);
        if (nearAnchor(c, tmpS.set(tmpP.x, y + fh * 0.5, tmpP.z), 2.4)) continue;
        let name = vars[vi];
        if (fam === 'deco' && m % 3 === 1) name = 'deco_fin_bay';
        if (fam === 'brick' && j === j1 && artHash(b.seed, m, j) < 0.5) name = 'brick_bay_b';
        put(out, name, 'bay', lod, tmpP, q, tmpS.set(sx, 1, 1), tint, kit);
        if (fam === 'brick' && sd < 0.55 && m > m0) { F.at(s - bw * 0.5, 0, y, tmpP); if (!nearAnchor(c, tmpS.set(tmpP.x, y + fh * 0.5, tmpP.z), 2.0)) put(out, 'brick_pier', 'bay', lod, tmpP, q, tmpS.set(1, 1, 1), tint, kit); }
        if (++n % 24 === 0) yield;
      }
      if (fam === 'brick' && sd > 0.35) for (const e of [-1, 1]) { // corner quoins
        F.at(e * F.half, 0, y, tmpP); if (!nearAnchor(c, tmpS.set(tmpP.x, y + fh * 0.5, tmpP.z), 2.0)) put(out, 'brick_quoin', 'bay', lod, tmpP, q, tmpS.set(e, 1, 1), tint, kit);
      }
    }
  }
  function* buildShop(u, lod, camY, out) {
    const { c, b, t, face } = u; if (!b.shops || t.y0 !== 0) return;
    const F = faceBasis(b, face, t), q = F.quat(tmpQ), s5 = seedF(b) * 5;
    for (let k = 0; k < 4; k++) {
      const qk = (k + 0.5) / 4;
      for (let n = Math.floor((F.uBase - F.half) / 12 + s5) - 1; n < (F.uBase + F.half) / 12 + s5 + 1; n++) {
        const s = (n + qk - s5) * 12 - F.uBase; if (s < -F.half + 1.5 || s > F.half - 1.5) continue;
        const h = artHash(c.i, c.j, b.seed, n * 8 + k);
        const name = ['storefront_a', 'storefront_b', 'storefront_c', 'storefront_d'][Math.floor(h * 4)];
        F.at(s, 0, 0, tmpP);
        const col = tmpC.set(AWN[Math.floor(artHash(b.seed, n, k, 5) * AWN.length)]);
        put(out, name, 'shop', lod, tmpP, q, tmpS.set(1, 1, 1), [col.r, col.g, col.b], [b.style, artHash(b.seed, n, k), 0, 0]);
      }
      yield;
    }
  }
  function* buildTrim(u, lod, camY, out) {
    const { c, b, t, face, ti } = u, fam = FAMILY(b.style); if (!fam) return;
    const F = faceBasis(b, face, t), q = F.quat(tmpQ), top = t.y1, last = ti === b.tiers.length - 1, tall = top >= 44;
    const mod = fam === 'deco' ? 3.2 : 3.0, kit = [b.style, seedF(b), 0, 0];
    const nmod = Math.floor((F.half * 2 - 0.4) / mod); if (nmod < 1) return;
    const sxs = (F.half * 2 - 0.4) / (nmod * mod);
    let cornice = null, crown = null;
    if (fam === 'brick' || fam === 'ind') { cornice = artHash(b.seed, 3) < 0.5 ? 'brick_cornice_a' : 'brick_cornice_b'; crown = last ? ['brick_crown_a', 'brick_crown_b', 'brick_crown_c'][Math.floor(artHash(b.seed, 11) * 3)] : null; }
    else if (fam === 'deco') { cornice = 'deco_belt'; crown = last ? 'deco_setback_parapet' : null; }
    else if (fam === 'glass') { crown = last && tall ? 'glass_crown_fin' : null; }
    for (let k = 0; k < nmod; k++) {
      const s = -F.half + 0.2 + (k + 0.5) * mod * sxs;
      if (cornice) {
        const ch = fam === 'deco' ? 0.4 : 1.2, y = top - ch - 0.05;
        F.at(s, 0, y, tmpP);
        if (!nearAnchor(c, tmpS.set(tmpP.x, y + ch * 0.5, tmpP.z), 2.6)) put(out, cornice, 'trim', lod, tmpP, q, tmpS.set(sxs, 1, tall ? 1 : 0.2), b.tint, kit);
      }
      if (crown) {
        F.at(s, 0, top, tmpP);
        if (!nearAnchor(c, tmpS.set(tmpP.x, top + 0.6, tmpP.z), 2.6)) put(out, crown, 'trim', lod, tmpP, q, tmpS.set(sxs, 1, tall ? 1 : 0.35), b.tint, kit);
      }
    }
    yield;
  }
  function* buildFe(u, lod, camY, out) { // one existing fire escape as real geometry, only the floors near the camera
    const { fe: [, , , , w, y0, y1], wn } = u;
    vX.set(wn[1], 0, -wn[0]); vZ.set(wn[0], 0, wn[1]); tmpQ.setFromRotationMatrix(tmpM.makeBasis(vX, vY, vZ));
    for (let y = y0; y < y1 - 1; y += 3.3) if (Math.abs(y + 1.6 - camY) < K.lod.fe[0][3] + 4) put(out, 'brick_fire_escape_bay', 'fe', lod, tmpP.set(u.cx, y, u.cz), tmpQ, tmpS.set(w / 3.0, 1, 1), [1, 1, 1], [0, 0.5, 0, 0]);
    yield;
  }
  const EXTRAS = ['roof_vent', 'roof_skylight', 'roof_chimney', 'roof_planter', 'roof_satellite', 'roof_hvac'];
  function* buildRoof(u, lod, camY, out) {
    const { c } = u, T = c.T, P = c.content.props;
    const W = (x, z, o) => o.set(T.cx + x * T.cos + z * T.sin, 0, T.cz - x * T.sin + z * T.cos);
    for (const [x, y, z, s, rot] of P.waterTowers) { W(x, z, tmpP).y = y; tmpQ.setFromAxisAngle(vY, rot + T.yaw); put(out, 'roof_water_tower', 'roof', lod, tmpP, tmpQ, tmpS.setScalar(s), [0.48, 0.32, 0.22], [0, 0.3, 0, 0]); }
    for (const [x, y, z, w, h, d, type] of P.roofBoxes) { W(x, z, tmpP).y = y; tmpQ.setFromAxisAngle(vY, T.yaw); put(out, type ? 'roof_hvac' : 'roof_bulkhead', 'roof', lod, tmpP, tmpQ, type ? tmpS.set(w / 3, h / 1.6, d / 2.4) : tmpS.set(w / 4, h / 3, d / 3), [0.62, 0.58, 0.55], [0, 0.4, 0, 0]); }
    for (const [x, y, z, h] of P.masts) { W(x, z, tmpP).y = y; tmpQ.identity(); put(out, 'roof_antenna', 'roof', lod, tmpP, tmpQ, tmpS.set(1, h / 10, 1), [0.3, 0.3, 0.32], [0, 0.2, 0, 0]); }
    yield;
    for (const b of c.buildings) { // extras on each roof: billboards, vents, skylights, planters… (away from anchors / props)
      if (b.role || b.h < 14) continue;
      const tt = b.tiers[b.tiers.length - 1], hx = tt.hx - 2.5, hz = tt.hz - 2.5; if (hx < 2 || hz < 2) continue;
      const nEx = 1 + Math.floor(artHash(b.seed, 41) * 3);
      for (let k = 0; k < nEx; k++) {
        const ox = (artHash(b.seed, k, 1) * 2 - 1) * hx, oz = (artHash(b.seed, k, 2) * 2 - 1) * hz;
        tmpP.set(wx(b, ox, oz), tt.y1, wz(b, ox, oz));
        if (nearAnchor(c, tmpP, 5) || P.roofBoxes.some((r) => Math.hypot(T.cx + r[0] * T.cos + r[2] * T.sin - tmpP.x, T.cz - r[0] * T.sin + r[2] * T.cos - tmpP.z) < 4)) continue;
        tmpQ.setFromAxisAngle(vY, b.yaw + Math.floor(artHash(b.seed, k, 3) * 4) * Math.PI / 2);
        put(out, EXTRAS[Math.floor(artHash(b.seed, k, 4) * EXTRAS.length)], 'roof', lod, tmpP, tmpQ, tmpS.set(1, 1, 1), [0.5, 0.5, 0.52], [0, artHash(b.seed, k), 0, 0]);
      }
      yield;
      if (b.h >= 18 && b.h <= 70 && artHash(b.seed, 77) < 0.28) { // rooftop billboard facing a street
        const f = b.faces?.[0]; if (!f) continue;
        const [nx, nz] = FACE_N[f.f], ox = nx * (tt.hx - 2.2), oz = nz * (tt.hz - 2.2);
        tmpP.set(wx(b, ox, oz), tt.y1, wz(b, ox, oz)); if (nearAnchor(c, tmpP, 6)) continue;
        vZ.set(nx * b.cos + nz * b.sin, 0, -nx * b.sin + nz * b.cos); vX.set(vZ.z, 0, -vZ.x); tmpQ.setFromRotationMatrix(tmpM.makeBasis(vX, vY, vZ));
        put(out, 'roof_billboard', 'roof', lod, tmpP, tmpQ, tmpS.set(1, 1, 1), [1, 1, 1], [0, (Math.floor(artHash(b.seed, 78) * 8) + 0.5) / 8, 0, 0]);
      }
    }
  }
  const BUILD = { bay: buildFace, shop: buildShop, trim: buildTrim, fe: buildFe, roof: buildRoof };

  // ---------------------------------------------------------------- units per cell + targets
  function unitsOf(c) {
    const us = [];
    for (const b of c.buildings) {
      if (b.role || !b.faces?.length) continue;
      b.tiers.forEach((t, ti) => { for (const face of b.faces) {
        const F = faceBasis(b, face, t), cx = wx(b, F.nx * F.off, F.nz * F.off), cz = wz(b, F.nx * F.off, F.nz * F.off);
        const base = { c, b, t, ti, face, cx, cz, n: F.nW, tw: F.tW, half: F.half, y0: t.y0, y1: t.y1 };
        us.push({ ...base, cls: 'bay' }); us.push({ ...base, cls: 'trim' }); if (b.shops && t.y0 === 0) us.push({ ...base, cls: 'shop' });
      } });
    }
    us.push({ c, cls: 'roof', cx: c.T.cx, cz: c.T.cz, half: cfg.cell / 2, y0: 0, y1: 0, n: null });
    const T = c.T;
    for (const fe of c.content.props.fireEscapes) {
      const [x, z, nx, nz, w, y0, y1] = fe, wn = [nx * T.cos + nz * T.sin, -nx * T.sin + nz * T.cos];
      us.push({ c, cls: 'fe', fe, wn, cx: T.cx + x * T.cos + z * T.sin, cz: T.cz - x * T.sin + z * T.cos, n: wn, tw: [wn[1], -wn[0]], half: w / 2, y0, y1 });
    }
    for (const u of us) { u.lod = [null, null]; u.band = [null, null]; }
    return us;
  }
  function distTo(u, cam) {
    if (!u.n) { const dx = Math.max(0, Math.abs(cam.x - u.cx) - u.half), dz = Math.max(0, Math.abs(cam.z - u.cz) - u.half); return Math.hypot(dx, dz); }
    const rx = cam.x - u.cx, rz = cam.z - u.cz, along = rx * u.tw[0] + rz * u.tw[1], outw = rx * u.n[0] + rz * u.n[1];
    const da = Math.max(0, Math.abs(along) - u.half), dy = Math.max(0, u.y0 - cam.y, cam.y - u.y1);
    return Math.hypot(da, Math.max(0, outw), dy) + (outw < -0.5 ? 1e4 : 0); // behind the face plane: never visible
  }
  const allocR = (cls, lod) => K.lod[cls][lod][3];
  const live = new Map(); // cell → units
  const queue = []; let job = null, flat = null, rr = 0, frameN = 0;
  function want(u, cam, lod) {
    const d = distTo(u, cam), R = allocR(u.cls, lod), has = !!u.lod[lod];
    if (!on || R > 9e4) return false;
    if (has ? d > R + K.hyst : d >= R) return false;
    if ((u.cls === 'bay' || u.cls === 'fe') && has && Math.abs(cam.y - u.band[lod]) > 14) return 'rebuild';
    return true;
  }
  function release(u, lod) { const l = u.lod[lod]; if (!l) return; for (const [p, h] of l) p.release(h); u.lod[lod] = null; }
  function releaseAll(v) { const us = live.get(v?.cell ?? v); if (!us) return; for (const u of us) { release(u, 0); release(u, 1); } live.delete(v?.cell ?? v); }

  function stream(visuals, cam, unbounded, budgetMs) {
    if (!stats.ready || !on) return;
    const t0 = performance.now();
    // targets: at most one new cell gets its units per frame; LOD targets are checked round-robin (a slice per frame)
    for (const [c] of visuals) if (!live.has(c)) { live.set(c, unitsOf(c)); flat = null; if (!unbounded) break; }
    for (const [c, us] of live) if (!visuals.has(c)) { for (const u of us) { release(u, 0); release(u, 1); } live.delete(c); flat = null; }
    if (!flat) { flat = []; for (const us of live.values()) for (const u of us) flat.push(u); rr = 0; }
    const nT = unbounded ? flat.length : Math.min(flat.length, K.targetsPerFrame);
    for (let k = 0; k < nT; k++) {
      const u = flat[rr++ % flat.length];
      for (let lod = 0; lod < 2; lod++) { // (no per-unit array allocation: GC pauses showed up as streaming spikes)
        const w = want(u, cam, lod);
        if (!w) { if (u.lod[lod]) release(u, lod); continue; }
        if (w === 'rebuild' || !u.lod[lod]) if (!u.q?.[lod]) { (u.q = u.q || [])[lod] = true; queue.push([u, lod, distTo(u, cam)]); }
      }
    }
    frameN++;
    if (queue.length > 1 && (unbounded || frameN % 20 === 0)) { // (bug fix: rr += 360 kept (rr & 7) at 0 → a full sort every frame)
      queue.sort((a, b) => a[2] - b[2]);
    }
    stats.jobs = queue.length;
    const lim = unbounded ? 1e9 : Math.min(budgetMs, K.budgetMs);
    while ((job || queue.length) && performance.now() - t0 < lim) {
      if (!job) {
        const [u, lod] = queue.shift(); u.q[lod] = false;
        const w = want(u, cam, lod); if (!w) continue;
        release(u, lod); u.lod[lod] = []; u.band[lod] = cam.y;
        job = BUILD[u.cls](u, lod, cam.y, u.lod[lod]);
      }
      if (job.next().done) job = null;
    }
    for (const key in pools) { // upload only the live range (not the whole capacity: MBs per frame while streaming)
      const p = pools[key];
      if (p.dirty) {
        const n = p.used, im = p.mesh.instanceMatrix; im.clearUpdateRanges(); im.addUpdateRange(0, Math.max(1, n) * 16);
        for (const a of p.attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, n) * a.itemSize); a.needsUpdate = true; }
      }
      p.flush(); p.mesh.visible = p.used > 0 && !(lite && LITE_HIDE(key)) && !KIT_DBG.norender; // (norender: dev A/B — stream but do not draw)
    }
    const ms = performance.now() - t0; stats.buildMs = ms; stats.streamMs = ms; stats.maxBuildMs = Math.max(stats.maxBuildMs, ms);
    let n = 0; for (const p of Object.values(pools)) n += p.used; stats.instances = n; stats.units = live.size;
  }
  function clearAll() { for (const us of live.values()) for (const u of us) { release(u, 0); release(u, 1); } live.clear(); queue.length = 0; job = null; flat = null; for (const p of Object.values(pools)) { p.flush(); p.mesh.visible = false; } }
  function setFlags(f) {
    const was = on; on = !!f.kit;
    if (was && !on) clearAll();
    // the kit replaces the v0.27 awnings (its storefronts carry their own) and the old roof-prop / fire-escape meshes up close
    if (art?.flags) art.flags.awning = !!f.awning && !on;
    for (const k of ['waterTowers', 'roofBoxes', 'masts']) if (details?.[k]) details[k].mesh.visible = !on;
    const fe = details?.fireEscapes?.mesh.material; if (fe?.uniforms?.uFeKit) fe.uniforms.uFeKit.value = on ? 1 : 0;
  }
  function shift(dx, dz) {
    for (const p of Object.values(pools)) { const a = p.mesh.instanceMatrix.array; for (let i = 0; i < p.used; i++) { a[i * 16 + 12] += dx; a[i * 16 + 14] += dz; } p.dirty = true; }
    for (const us of live.values()) for (const u of us) { u.cx += dx; u.cz += dz; }
  }
  function update(dt) { CITY_SHARED.uCityTime.value += dt; if (warm && --warmFrames < 0) { warm.visible = false; } }
  /** Prewarm: one instance per material class so every kit program exists before gameplay. */
  function prewarmPieces() { return Object.values(pools).map((p) => p.mesh); }
  function setLite(v) { if (v === lite) return; lite = v; for (const [key, p] of Object.entries(pools)) p.mesh.visible = p.used > 0 && !(lite && LITE_HIDE(key)); }
  return { root: group, setLite, stream, releaseAll, setFlags, shift, update, stats, pools, loading, get pieces() { return pieces; }, get manifest() { return manifest; }, prewarmPieces, materials: mats, matFor, clearAll };
}
