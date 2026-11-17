// v0.30 Dala City materials + lighting resources (renderer only; never imported by src/data).
//
//  • CC0 PBR texture arrays (Poly Haven / ambientCG, packed by tools/assets/fetch_cc0.py → public/textures/city/*.webp):
//      albedo (sRGB), normal (OpenGL, linear), ORM (linear: R ao, G roughness, B metal); 9 layers × 512² each, mipmapped.
//      KTX2 / Basis is NOT used: the toolchain has no Basis encoder (basisu) and IWSDK ships no transcoder setup, so the
//      files are WebP (small downloads) and the GPU memory is plain RGBA8 (3 × 9 × 1.33 MiB ≈ 36 MiB). Documented in
//      docs/ASSETS.md. Layers: 0 brick red, 1 brick dark, 2 brick cream, 3 limestone, 4 concrete, 5 asphalt, 6 metal,
//      7 paving, 8 glass grime.
//  • Room atlas (interior-mapped windows): 8 procedurally drawn back walls (furniture silhouettes, shelves, a TV glow,
//      plants, a shop) in one 1024×512 canvas; side walls / floor / ceiling / lights / curtains are done in the shader.
//  • Billboard atlas: 8 ORIGINAL ads (invented names) for the rooftop billboard faces.
//  • Sky reflection cube: the sky dome (+ the far skyline) rendered ONCE at load into a 128² cube with GPU mipmaps
//      → glass reflects the real sunset sky, blurrier on rough glass. Never re-rendered during play.
//  • Height field for neighbour shadows: the tops of every building collider of the active cells rasterised into a
//      256² R8 texture (3 m / texel, 1 m height steps) around the focus, re-centred in 24 m steps (world-anchored, so
//      shadows never swim). The shaders march toward the sun through it (analytic soft shadows; no shadow maps).
import * as THREE from 'three';
import { canvasTexture, rng } from './toon.js';

export const PBR_LAYERS = ['brick_red', 'brick_dark', 'brick_cream', 'limestone', 'concrete', 'asphalt', 'metal', 'paving', 'glass_grime'];
export const PBR = { BRICK_RED: 0, BRICK_DARK: 1, BRICK_CREAM: 2, LIMESTONE: 3, CONCRETE: 4, ASPHALT: 5, METAL: 6, PAVING: 7, GRIME: 8 };

// ---------------------------------------------------------------------------- shared uniforms (one object per uniform,
// referenced by every city material → set once, no per-material copies, toggles never recompile)
const placeholderArray = () => { const t = new THREE.DataArrayTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, 1); t.needsUpdate = true; return t; };
export const CITY_SHARED = {
  uAlb: { value: placeholderArray() }, uNrm: { value: placeholderArray() }, uOrm: { value: placeholderArray() },
  uRooms: { value: null }, uEnv: { value: null }, uEnvOn: { value: 0 },
  uHF: { value: null }, uHFp: { value: new THREE.Vector4(0, 0, 768, 0) },
  uFog2: { value: new THREE.Vector4(0.0011, 85, 120, 0.72) }, // v0.30b: lighter, crisper near (warmer brick) // x density, y height scale (m), z crisp radius (m), w max
  uFogCool: { value: new THREE.Color(0x7088bc) }, uFogWarm: { value: new THREE.Color(0xf2b08a) }, uFogLow: { value: new THREE.Color(0xc8a492) },
  uRimCol: { value: new THREE.Color(0xffc890) }, uBounce: { value: new THREE.Color(0x8a5a40) },
  uCityTime: { value: 0 },
  uPbrOn: { value: 0 },
};

// ---------------------------------------------------------------------------- PBR arrays
let _pbrPromise = null;
async function loadImageData(url, S) {
  const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const bmp = await createImageBitmap(await r.blob());
  const c = document.createElement('canvas'); c.width = S; c.height = S; const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, S, S); bmp.close?.();
  return g.getImageData(0, 0, S, S).data;
}
function makeArray(data, S, n, srgb, name) {
  const t = new THREE.DataArrayTexture(data, S, S, n);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
  t.name = name; t.needsUpdate = true; return t;
}
/** Load the CC0 arrays once (async; the city renders with neutral placeholders until they arrive). */
export function loadCityPBR(base = 'textures/city/') {
  if (_pbrPromise) return _pbrPromise;
  _pbrPromise = (async () => {
    const S = 512, n = PBR_LAYERS.length, per = S * S * 4;
    const out = { albedo: new Uint8Array(per * n), normal: new Uint8Array(per * n), orm: new Uint8Array(per * n) };
    await Promise.all(PBR_LAYERS.flatMap((name, L) => ['albedo', 'normal', 'orm'].map(async (k) => {
      const px = await loadImageData(`${base}${name}_${k}.webp`, S);
      out[k].set(px, L * per);
    })));
    CITY_SHARED.uAlb.value = makeArray(out.albedo, S, n, true, 'city-pbr-albedo');
    CITY_SHARED.uNrm.value = makeArray(out.normal, S, n, false, 'city-pbr-normal');
    CITY_SHARED.uOrm.value = makeArray(out.orm, S, n, false, 'city-pbr-orm');
    return CITY_SHARED;
  })().catch((e) => { console.warn('[city] CC0 PBR textures failed, keeping the procedural look (will retry once)', e); _pbrPromise = null; return null; });
  return _pbrPromise;
}

// ---------------------------------------------------------------------------- room atlas (4 × 2 rooms, 256² each)
export const ROOM_TYPES = 8;
export function roomAtlas() {
  if (CITY_SHARED.uRooms.value) return CITY_SHARED.uRooms.value;
  const t = canvasTexture(1024, 512, (ctx) => {
    const r = rng(3030), S = 256;
    const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
    const walls = ['#d8c7ae', '#c9b8a6', '#b8c0c4', '#d6c2a0', '#c4b4c0', '#bfc8b0', '#d0c0b0', '#e0d8c8'];
    for (let k = 0; k < ROOM_TYPES; k++) {
      const ox = (k % 4) * S, oy = (k >> 2) * S;
      ctx.save(); ctx.translate(ox, oy);
      // back wall: soft vertical gradient + skirting
      const g = ctx.createLinearGradient(0, 0, 0, S); g.addColorStop(0, walls[k]); g.addColorStop(1, '#8a7a6a');
      rect(0, 0, S, S, g); rect(0, S - 18, S, 18, '#5a4a3e');
      const sil = 'rgba(40,30,28,0.92)', mid = 'rgba(70,56,50,0.9)';
      if (k === 0) { // living room: sofa, lamp, framed picture
        rect(40, 168, 150, 52, sil); rect(30, 150, 24, 70, sil); rect(178, 150, 24, 70, sil); rect(50, 150, 130, 26, mid);
        rect(214, 120, 6, 100, sil); ctx.fillStyle = '#ffe2a8'; ctx.beginPath(); ctx.moveTo(198, 120); ctx.lineTo(236, 120); ctx.lineTo(226, 92); ctx.lineTo(208, 92); ctx.fill();
        rect(84, 60, 70, 50, '#3a3040'); rect(90, 66, 58, 38, '#7a8aa8');
      } else if (k === 1) { // kitchen: cabinets, counter, hood
        rect(0, 150, S, 70, '#6a5446'); rect(0, 140, S, 12, '#a89a8a'); rect(20, 40, 216, 54, '#7a6656');
        for (let x = 24; x < 230; x += 54) { rect(x, 44, 48, 46, '#8a7464'); rect(x, 156, 48, 58, '#7a6252'); }
        rect(110, 94, 40, 30, '#4a4044');
      } else if (k === 2) { // office: desk, monitor glow, shelf
        rect(30, 160, 200, 12, sil); rect(40, 172, 10, 50, sil); rect(210, 172, 10, 50, sil);
        rect(90, 112, 76, 46, '#202838'); rect(94, 116, 68, 38, '#7ac8ff'); rect(124, 158, 8, 6, sil);
        rect(20, 40, 216, 8, mid); rect(20, 80, 216, 8, mid);
        for (let x = 24; x < 230; x += 12 + Math.floor(r() * 10)) rect(x, 48 + r() * 8, 8, 30, ['#7a3a2a', '#2a4a6a', '#6a6a2a', '#3a2a4a'][Math.floor(r() * 4)]);
      } else if (k === 3) { // bedroom: bed + headboard, bedside lamp, curtain hint
        rect(50, 150, 160, 14, '#e8e0d0'); rect(40, 164, 180, 56, '#8a6a7a'); rect(50, 110, 160, 44, sil);
        rect(18, 170, 26, 50, mid); ctx.fillStyle = '#ffd890'; ctx.beginPath(); ctx.arc(31, 160, 14, 0, 7); ctx.fill();
      } else if (k === 4) { // library: full bookshelf
        rect(10, 20, 236, 210, '#4a3426');
        for (let y = 30; y < 220; y += 38) { rect(14, y + 30, 228, 6, '#2a1c14'); for (let x = 16; x < 238; x += 7 + Math.floor(r() * 7)) rect(x, y + 4 + r() * 8, 5 + r() * 3, 26 - r() * 6, ['#8a3a2a', '#2a5a7a', '#a88a3a', '#3a5a3a', '#6a2a4a', '#c8b89a'][Math.floor(r() * 6)]); }
      } else if (k === 5) { // plants + armchair
        rect(150, 170, 70, 50, sil); rect(140, 150, 20, 70, sil);
        for (let i = 0; i < 14; i++) { ctx.fillStyle = `rgba(${40 + r() * 30},${90 + r() * 50},${40 + r() * 30},0.95)`; ctx.beginPath(); ctx.ellipse(60 + r() * 50, 90 + r() * 90, 10 + r() * 16, 6 + r() * 10, r() * 3, 0, 7); ctx.fill(); }
        rect(66, 190, 40, 30, '#7a4a3a');
      } else if (k === 6) { // empty / gallery: posters, ceiling pendant
        rect(40, 60, 60, 84, '#c84a3a'); rect(130, 50, 80, 60, '#3a6ab0'); rect(140, 120, 60, 40, '#e0c040');
        rect(0, 200, S, 20, '#6a5a50');
      } else { // shop: shelves with goods (storefronts)
        rect(0, 0, S, S, '#efe6d6');
        for (let y = 40; y < 230; y += 46) { rect(10, y + 32, 236, 6, '#6a6a70'); for (let x = 14; x < 240; x += 10 + Math.floor(r() * 8)) rect(x, y + 6 + r() * 6, 8, 26 - r() * 8, ['#e05040', '#40a0e0', '#f0c030', '#50b060', '#e080b0', '#f0f0f0'][Math.floor(r() * 6)]); }
      }
      ctx.restore();
    }
  }, { mipmaps: true });
  t.name = 'city-room-atlas';
  return (CITY_SHARED.uRooms.value = t);
}

// ---------------------------------------------------------------------------- billboard atlas (2 × 4, invented brands)
export const ADS = [['DALA COLA', '#ffffff', '#c8202a', 'ice cold since 1972'], ['MOBIUS ENERGY', '#0a1830', '#7fe8ff', 'charge the night'], ['MOON NOODLE', '#2a0e0e', '#ffcf6a', '24 h • 達拉麵館'], ['ARC LIGHT CINEMA', '#ffffff', '#3a2a8a', 'now showing'],
  ['VOLTA SHOES', '#111111', '#f2f2f2', 'run the rooftops'], ['SKYLINE RADIO 72.0', '#ffe2a0', '#1e3a5a', 'city sounds'], ['KITE BANK', '#ffffff', '#1e6a4a', 'save higher'], ['NOVA AIR', '#1a1030', '#ff9a6a', 'fly west tonight']];
let _ads = null;
export function adsAtlas() {
  if (_ads) return _ads;
  _ads = canvasTexture(1024, 1024, (ctx) => {
    const cw = 512, ch = 256;
    ADS.forEach(([name, fg, bg, sub], i) => {
      const x = (i % 2) * cw, y = (i >> 1) * ch;
      const g = ctx.createLinearGradient(x, y, x + cw, y + ch); g.addColorStop(0, bg); g.addColorStop(1, '#101018');
      ctx.fillStyle = g; ctx.fillRect(x, y, cw, ch);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.arc(x + cw * (0.15 + k * 0.16), y + ch * 0.8, 40 + k * 9, 0, 7); ctx.fill(); }
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = fg;
      let fs = 74; ctx.font = `900 ${fs}px system-ui, sans-serif`; while (ctx.measureText(name).width > cw - 60 && fs > 30) { fs -= 4; ctx.font = `900 ${fs}px system-ui, sans-serif`; }
      ctx.fillText(name, x + 30, y + ch * 0.42);
      ctx.font = `600 30px system-ui, "Noto Sans CJK TC", sans-serif`; ctx.globalAlpha = 0.85; ctx.fillText(sub, x + 32, y + ch * 0.74); ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 8; ctx.strokeRect(x + 4, y + 4, cw - 8, ch - 8);
    });
  }, { mipmaps: true });
  _ads.name = 'city-billboard-ads';
  return _ads;
}

// ---------------------------------------------------------------------------- sky reflection cube (baked once)
let _envRT = null;
/** Render `objects` (sky dome, far skyline) into a mipmapped cube once. Call after the sky exists, before XR. */
export function bakeSkyReflection(renderer, objects, at = new THREE.Vector3(0, 60, 0)) {
  if (_envRT || !renderer || renderer.xr?.isPresenting) return _envRT?.texture || null;
  const rt = new THREE.WebGLCubeRenderTarget(128, { type: THREE.UnsignedByteType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.SRGBColorSpace });
  const cam = new THREE.CubeCamera(1, 3000, rt); cam.position.copy(at);
  const tmp = new THREE.Scene(); tmp.background = new THREE.Color(0x4a4058);
  const parents = objects.filter(Boolean).map((o) => [o, o.parent, o.position.clone()]);
  for (const [o] of parents) { tmp.add(o); if (o.name === 'Skyline') o.position.set(at.x, 0, at.z); }
  tmp.add(cam);
  const prevRT = renderer.getRenderTarget(), xr = renderer.xr.enabled; renderer.xr.enabled = false;
  try { cam.update(renderer, tmp); } catch (e) { console.warn('[city] reflection bake failed', e); }
  renderer.xr.enabled = xr; renderer.setRenderTarget(prevRT);
  for (const [o, p, pos] of parents) { if (p) p.add(o); else tmp.remove(o); o.position.copy(pos); }
  rt.texture.name = 'city-sky-reflection';
  _envRT = rt; CITY_SHARED.uEnv.value = rt.texture; CITY_SHARED.uEnvOn.value = 1;
  return rt.texture;
}
export const skyReflectionTarget = () => _envRT;

// ---------------------------------------------------------------------------- neighbour-shadow height field
export function createHeightField(world, { N = 256, texel = 3, snap = 24 } = {}) {
  const data = new Uint8Array(N * N), tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.generateMipmaps = false;
  tex.name = 'city-height-field'; tex.needsUpdate = true;
  CITY_SHARED.uHF.value = tex;
  const size = N * texel, P = CITY_SHARED.uHFp.value;
  const st = { ox: NaN, oz: NaN, dirty: true, t: 0, builds: 0, ms: 0 };
  function rebuild(cx, cz) {
    const t0 = performance.now();
    const ox = Math.round(cx / snap) * snap - size / 2, oz = Math.round(cz / snap) * snap - size / 2;
    data.fill(0);
    for (const c of world.cells.values()) for (const k of c.colliders) {
      if (k.y1 < 6) continue;
      const h = Math.min(255, Math.round(k.y1)), cs = Math.cos(k.yaw || 0), sn = Math.sin(k.yaw || 0);
      const ex = Math.abs(cs) * k.hw + Math.abs(sn) * k.hd, ez = Math.abs(sn) * k.hw + Math.abs(cs) * k.hd;
      const i0 = Math.max(0, Math.floor((k.x - ex - ox) / texel)), i1 = Math.min(N - 1, Math.ceil((k.x + ex - ox) / texel));
      const j0 = Math.max(0, Math.floor((k.z - ez - oz) / texel)), j1 = Math.min(N - 1, Math.ceil((k.z + ez - oz) / texel));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = ox + (i + 0.5) * texel - k.x, z = oz + (j + 0.5) * texel - k.z;
        const lx = x * cs - z * sn, lz = x * sn + z * cs; // into the box frame (rotation by -yaw)
        if (Math.abs(lx) <= k.hw + texel * 0.25 && Math.abs(lz) <= k.hd + texel * 0.25) { const q = j * N + i; if (data[q] < h) data[q] = h; }
      }
    }
    tex.needsUpdate = true; P.set(ox, oz, size, 1);
    st.ox = ox; st.oz = oz; st.dirty = false; st.builds++; st.ms = performance.now() - t0;
  }
  return {
    tex, stats: st,
    markDirty() { st.dirty = true; },
    /** Re-centre / refresh when needed (throttled; ~0.3–1 ms when it runs). */
    update(cam, dt) {
      st.t -= dt;
      const ox = Math.round(cam.x / snap) * snap - size / 2, oz = Math.round(cam.z / snap) * snap - size / 2;
      if ((st.dirty && st.t <= 0) || ox !== st.ox || oz !== st.oz) { rebuild(cam.x, cam.z); st.t = 0.4; return true; }
      return false;
    },
    shift(dx, dz) { st.dirty = true; st.t = 0; P.x += dx; P.y += dz; st.ox += dx; st.oz += dz; },
    setEnabled(on) { P.w = on ? 1 : 0; },
  };
}

// ---------------------------------------------------------------------------- shared GLSL (lighting + fog + shadows)
export const CITY_COMMON_GLSL = /* glsl */`
precision highp sampler2DArray;
uniform sampler2DArray uAlb, uNrm, uOrm;
uniform sampler2D uHF, uRooms; uniform vec4 uHFp;
uniform samplerCube uEnv; uniform float uEnvOn, uPbrOn, uCityTime;
uniform vec4 uFog2; uniform vec3 uFogCool, uFogWarm, uFogLow, uRimCol, uBounce;
float ignz(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); } // interleaved gradient noise
// soft analytic neighbour shadow: march toward the sun through the building-top height field (1 = lit)
float hfShadow(vec3 wp, vec3 sunDir, float startT) {
  if (uHFp.w < 0.5) return 1.0;
  vec2 d = normalize(sunDir.xz); float slope = sunDir.y / max(length(sunDir.xz), 1e-3);
  float t = startT, occ = 0.0; // no per-pixel jitter: a stable (banded) penumbra instead of sparkling noise
  for (int i = 0; i < 12; i++) {
    vec2 p = wp.xz + d * t; vec2 uv = (p - uHFp.xy) / uHFp.z;
    float h = texture(uHF, uv).r * 255.0; float ry = wp.y + t * slope;
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    occ = max(occ, inside * smoothstep(ry - 1.0, ry + 4.0 + t * 0.06, h));
    t *= 1.42;
  }
  return 1.0 - occ;
}
// layered aerial perspective: crisp near, hazed mid, blue-grey far; thicker low down; warm in-scattering toward the sun
vec3 fog2(vec3 col, vec3 wp, vec3 sunDir) {
  vec3 dv = wp - cameraPosition; float dist = length(dv); vec3 vd = dv / max(dist, 1e-3);
  float hf = exp(-max(wp.y, 0.0) / uFog2.y);
  float f = 1.0 - exp(-max(dist - uFog2.z, 0.0) * uFog2.x * (0.45 + 1.1 * hf));
  float sun = pow(max(dot(vd, sunDir), 0.0), 5.0);
  vec3 fc = mix(uFogCool, uFogLow, hf * 0.7);
  fc = mix(fc, uFogWarm, clamp(sun * 0.9 + hf * 0.12, 0.0, 1.0));
  return mix(col, fc, clamp(f, 0.0, uFog2.w));
}
vec3 envSky(vec3 R, float rough) { return textureLod(uEnv, vec3(-R.x, R.y, R.z), rough * 6.0).rgb; }
// box-projected tangent-space normal from the PBR array (detail relief); n = surface normal, uv in texture tiles
vec3 pbrNormal(vec3 n, vec3 T, vec3 B, vec2 uv, float layer, float strength) {
  vec3 tn = texture(uNrm, vec3(uv, layer)).xyz * 2.0 - 1.0; tn.xy *= strength;
  return normalize(T * tn.x + B * tn.y + n * tn.z);
}
`;

/** Bake-time environment helpers for tests / tools. */
export const _internals = { makeArray };
