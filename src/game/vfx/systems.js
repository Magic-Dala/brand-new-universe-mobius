// v0.30 GPU-driven VFX systems. Every system is ONE draw call and only draws while something is alive.
// Particles / debris / rings / shells / arcs write their spawn attributes ONCE into a ring buffer (partial buffer
// updates via addUpdateRange); the vertex shader computes position, size, alpha and colour from (spawn time, life,
// p0, v0, gravity, drag, curves) and the shared time uniform → no per-particle CPU work per frame, no allocation.
// Beams and attached sprites follow moving objects, so their few instances are rewritten each frame.
// Colours are display values (no colour-space conversion, no tone mapping) — HDR > 1 saturates to a white-hot core.
import * as THREE from 'three';

export const VFX_U = { uTime: { value: 0 }, uOffset: { value: new THREE.Vector3() } };
const DEAD = 'gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return;';
export const HEX_GLSL = /* glsl */`
float hexEdge(vec2 p) { // 0 at a hex border … 0.5 at the cell centre (cells of inradius 0.5)
  const vec2 s = vec2(1.0, 1.7320508);
  vec2 a = mod(p, s) - s * 0.5, b = mod(p - s * 0.5, s) - s * 0.5;
  vec2 g = dot(a, a) < dot(b, b) ? a : b; g = abs(g);
  return 0.5 - max(dot(g, vec2(0.5, 0.8660254)), g.x);
}
float hash11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float hash21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }`;

/** Ring-buffer of instance attributes (vec4 each) with dirty-range uploads. */
class RingBuf {
  constructor(geo, cap, names) {
    this.cap = cap; this.head = 0; this.dStart = -1; this.dCount = 0; this.attrs = {}; this.arr = {};
    for (const n of names) { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(n, a); this.attrs[n] = a; this.arr[n] = a.array; }
    this.list = names.map((n) => this.attrs[n]);
  }
  /** Next slot index (oldest overwritten). */
  take() {
    const i = this.head; this.head = (this.head + 1) % this.cap;
    if (this.dStart < 0) { this.dStart = i; this.dCount = 1; } else if (this.dCount < this.cap) this.dCount++;
    return i;
  }
  flush() {
    if (this.dStart < 0) return;
    const s = this.dStart, n = Math.min(this.cap, this.dCount);
    for (const a of this.list) {
      a.clearUpdateRanges();
      if (n >= this.cap) a.addUpdateRange(0, this.cap * 4);
      else if (s + n <= this.cap) a.addUpdateRange(s * 4, n * 4);
      else { a.addUpdateRange(s * 4, (this.cap - s) * 4); a.addUpdateRange(0, (s + n - this.cap) * 4); }
      a.needsUpdate = true;
    }
    this.dStart = -1; this.dCount = 0;
  }
  clear() { for (const n in this.arr) this.arr[n].fill(0); for (const a of this.list) { a.clearUpdateRanges(); a.needsUpdate = true; } this.head = 0; this.dStart = -1; this.dCount = 0; }
}

class Sys {
  constructor(geo, mat, cap, names, name, order) {
    this.geo = geo; this.mat = mat; this.buf = new RingBuf(geo, cap, names); geo.instanceCount = cap;
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.name = name; this.mesh.frustumCulled = false; this.mesh.renderOrder = order; this.mesh.visible = false;
    this.until = -1; this.warm = 0; this.spawned = 0;
  }
  live(t) { return t < this.until; }
  frame(t) { this.buf.flush(); this.mesh.visible = this.warm > 0 || t < this.until; if (this.warm > 0) this.warm--; }
  clear() { this.buf.clear(); this.until = -1; this.mesh.visible = false; }
}
function instGeo(base) { const g = new THREE.InstancedBufferGeometry(); g.index = base.index; for (const k in base.attributes) g.setAttribute(k, base.attributes[k]); return g; }

// =========================================================================== particles
const PART_COMMON = /* glsl */`
attribute vec4 aA, aB, aC, aD, aE, aF;
uniform float uTime; uniform vec3 uOffset;
varying vec2 vUv; varying vec4 vCol; varying vec4 vX;
vec3 pAt(float t, float k) { float e = (1.0 - exp(-k * t)) / k; return aA.xyz + uOffset + aB.xyz * e - vec3(0.0, aC.z, 0.0) * (t - e) / k; }
vec3 vAt(float t, float k) { float x = exp(-k * t); return aB.xyz * x - vec3(0.0, aC.z, 0.0) * (1.0 - x) / k; }`;

const ADD_VERT = /* glsl */`${PART_COMMON}
void main() {
  float age = uTime - aA.w, u = age / aB.w;
  if (u < 0.0 || u > 1.0) { ${DEAD} }
  float k = max(aC.w, 0.05);
  vec3 p = pAt(age, k);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float depth = -mv.z;
  float size = mix(aC.x, aC.y, 1.0 - (1.0 - u) * (1.0 - u));
  size = min(size, depth * mix(0.22, 0.55, smoothstep(1.0, 5.0, depth))); // never a huge quad in front of the eyes
  vec2 c = position.xy;
  if (aF.w > 0.0) {                                     // velocity-stretched streak
    vec3 vv = (viewMatrix * vec4(vAt(age, k), 0.0)).xyz;
    vec2 d = vv.xy; float sp = length(d); d = sp > 1e-4 ? d / sp : vec2(1.0, 0.0);
    float L = min(size * (1.0 + min(sp * aF.w, 6.0)), depth * 0.6); // streak length capped near the eyes too
    mv.xy += d * c.x * L + vec2(-d.y, d.x) * c.y * size * 0.5;
  } else {
    float r = aF.x + aF.y * age, cs = cos(r), sn = sin(r);
    mv.xy += mat2(cs, sn, -sn, cs) * c * size;
  }
  gl_Position = projectionMatrix * mv;
  float tile = aF.z; vUv = (uv + vec2(mod(tile, 2.0), 1.0 - floor(tile / 2.0))) * 0.5;
  float hot = 1.0 - smoothstep(0.0, max(aD.w, 1e-3), u);
  vec3 col = mix(aD.rgb, aE.rgb, smoothstep(0.0, 1.0, u)) + hot * vec3(1.2);
  float a = aE.w * min(1.0, u * 18.0) * (1.0 - u * u) * (1.0 - u * 0.5) * smoothstep(0.3, 1.2, depth);
  vCol = vec4(col * a, 1.0);
}`;
const ADD_FRAG = /* glsl */`uniform sampler2D uMap; varying vec2 vUv; varying vec4 vCol;
void main() { float I = texture2D(uMap, vUv).r; if (I < 0.003) discard; gl_FragColor = vec4(vCol.rgb * I, 1.0); }`;

const SMOKE_VERT = /* glsl */`${PART_COMMON}
void main() {
  float age = uTime - aA.w, u = age / aB.w;
  if (u < 0.0 || u > 1.0) { ${DEAD} }
  float k = max(aC.w, 0.05);
  vec3 p = pAt(age, k);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float depth = -mv.z;
  float size = mix(aC.x, aC.y, 1.0 - pow(1.0 - u, 2.2));
  size = min(size, depth * mix(0.28, 0.7, smoothstep(1.5, 7.0, depth))); // overdraw cap near the camera
  float r = aF.x + aF.y * age, cs = cos(r), sn = sin(r);
  mv.xy += mat2(cs, sn, -sn, cs) * position.xy * size;
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  float f = mod(u * 15.0 + aF.z, 16.0);
  vX = vec4(f, u, smoothstep(0.4, 2.0, depth), aE.w * min(1.0, u * 9.0));
  vCol = vec4(aE.rgb, aD.w);
}`;
const SMOKE_FRAG = /* glsl */`uniform sampler2D uMap; uniform vec3 uLit, uShadow; varying vec2 vUv; varying vec4 vCol; varying vec4 vX;
attribute_placeholder
void main() {
  float f0 = floor(vX.x), ff = vX.x - f0, f1 = mod(f0 + 1.0, 16.0);
  vec2 t0 = (vUv + vec2(mod(f0, 4.0), 3.0 - floor(f0 / 4.0))) * 0.25, t1 = (vUv + vec2(mod(f1, 4.0), 3.0 - floor(f1 / 4.0))) * 0.25;
  vec3 s = mix(texture2D(uMap, t0).rgb, texture2D(uMap, t1).rgb, ff);
  float u = vX.y, thr = pow(u, 1.1) * 0.7;
  float a = smoothstep(thr, thr + 0.34 + 0.2 * u, s.r * (0.72 + 0.28 * s.b)) * vX.w * vX.z * (1.0 - u * u * 0.6); // v0.30d: softer edges, thins out before it ends
  if (a < 0.004) discard;
  float fk = vCol.a > 0.0 ? 1.0 - smoothstep(0.0, vCol.a, u) : 0.0;
  vec3 lit = vCol.rgb * mix(uShadow, uLit, s.g);
  // fire: heat = time × density (+ a little top-lit billow) → dark red → orange → yellow; thin edges stay sooty
  float I = max(max(vFire.r, vFire.g), vFire.b);
  float heat = fk * smoothstep(0.18, 0.85, s.r * (0.8 + 0.35 * s.g)) * mix(1.0, 0.75, s.b);
  vec3 ramp = heat < 0.45 ? mix(vec3(0.28, 0.03, 0.01), vec3(1.0, 0.24, 0.04), heat / 0.45)
            : mix(vec3(1.0, 0.24, 0.04), vec3(1.0, 0.62, 0.16), min(1.0, (heat - 0.45) / 0.4)) + vec3(0.0, 0.18, 0.08) * smoothstep(0.85, 1.0, heat);
  vec3 tint = vFire / max(I, 1e-3);                   // per-effect tint (red miss fire, amber core …)
  vec3 em = ramp * mix(vec3(1.0), tint, 0.35) * I * smoothstep(0.05, 0.3, heat);
  float soot = fk * (1.0 - smoothstep(0.1, 0.5, heat));   // cooler fringes of the fire are black soot
  lit *= 1.0 - 0.75 * soot;
  gl_FragColor = vec4(lit * a * (1.0 - heat * 0.85) + em * a, a * (1.0 - 0.35 * heat));
}`;

/** Billboard particles. kind 'add' (atlas, additive) | 'smoke' (flipbook, premultiplied alpha, fire → smoke). */
export class GpuParticles extends Sys {
  constructor(cap, kind, tex, name) {
    const geo = instGeo(new THREE.PlaneGeometry(1, 1));
    const smoke = kind === 'smoke';
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: VFX_U.uTime, uOffset: VFX_U.uOffset, uMap: { value: tex }, uLit: { value: new THREE.Vector3(1.25, 1.0, 0.85) }, uShadow: { value: new THREE.Vector3(0.42, 0.36, 0.55) } },
      vertexShader: smoke ? SMOKE_VERT.replace('varying vec4 vX;', 'varying vec4 vX; varying vec3 vFire;').replace('vUv = uv;', 'vUv = uv; vFire = aD.rgb;') : ADD_VERT,
      fragmentShader: smoke ? SMOKE_FRAG.replace('attribute_placeholder', 'varying vec3 vFire;') : ADD_FRAG,
      transparent: true, depthWrite: false, depthTest: true, fog: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: smoke ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    super(geo, mat, cap, ['aA', 'aB', 'aC', 'aD', 'aE', 'aF'], name, smoke ? 8 : 9);
    this.kind = kind;
  }
  /** e: spec object (see Kit.P). t = absolute spawn time on the kit clock. */
  emit(e, t) {
    const i = this.buf.take() * 4, A = this.buf.arr, o = VFX_U.uOffset.value;
    const a = A.aA; a[i] = e.x - o.x; a[i + 1] = e.y - o.y; a[i + 2] = e.z - o.z; a[i + 3] = t;
    const b = A.aB; b[i] = e.vx; b[i + 1] = e.vy; b[i + 2] = e.vz; b[i + 3] = e.life;
    const c = A.aC; c[i] = e.s0; c[i + 1] = e.s1; c[i + 2] = e.g; c[i + 3] = e.drag;
    const d = A.aD; d[i] = e.c0[0] * e.i0; d[i + 1] = e.c0[1] * e.i0; d[i + 2] = e.c0[2] * e.i0; d[i + 3] = e.hot;
    const f = A.aE; f[i] = e.c1[0] * e.i1; f[i + 1] = e.c1[1] * e.i1; f[i + 2] = e.c1[2] * e.i1; f[i + 3] = e.a;
    const g = A.aF; g[i] = e.rot; g[i + 1] = e.spin; g[i + 2] = e.tile; g[i + 3] = e.stretch;
    if (t + e.life > this.until) this.until = t + e.life;
    this.spawned++;
  }
}

// =========================================================================== debris (lit instanced chunks)
const DEB_VERT = /* glsl */`
attribute vec4 aA, aB, aC, aD, aE, aF;
uniform float uTime; uniform vec3 uOffset;
varying vec3 vN; varying vec3 vAlb; varying vec3 vEm; varying float vIn; varying vec3 vW;
vec3 rot(vec3 v, vec3 ax, float an) { float c = cos(an), s = sin(an); return v * c + cross(ax, v) * s + ax * dot(ax, v) * (1.0 - c); }
void main() {
  float age = uTime - aA.w, u = age / aB.w;
  if (u < 0.0 || u > 1.0) { ${DEAD} }
  float g = aD.w, y0 = aA.y + uOffset.y - aC.w, vy = aB.y;
  float tHit = (vy + sqrt(max(vy * vy + 2.0 * g * max(y0, 0.0), 0.0))) / max(g, 1e-3);
  float te = min(age, tHit), th = min(age, tHit + 0.12);
  vec3 p = aA.xyz + uOffset;
  p.xz += aB.xz * (1.0 - exp(-0.9 * th)) / 0.9;
  p.y = age < tHit ? p.y + vy * age - 0.5 * g * age * age : aC.w;
  float w = length(aC.xyz); vec3 ax = w > 1e-4 ? aC.xyz / w : vec3(0.0, 1.0, 0.0);
  float an = w * te + w * 0.15 * max(0.0, th - te);
  float s = smoothstep(1.0, 0.72, u) * smoothstep(0.0, 0.04, u);
  vec3 lp = rot(position * aD.xyz * s, ax, an);
  if (age >= tHit) lp.y = abs(lp.y) * 0.4;           // settled: lie flat-ish on the ground
  vN = rot(normal / max(aD.xyz, vec3(1e-3)), ax, an); vIn = normal.y;
  vec4 wp = vec4(p + lp, 1.0); vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  vAlb = aE.rgb;
  float cool = exp(-age / max(aF.w, 0.05));
  vEm = aF.rgb * aE.w * cool;
}`;
const DEB_FRAG = /* glsl */`uniform vec3 uSun, uSunCol, uSky, uGround; varying vec3 vN; varying vec3 vAlb; varying vec3 vEm; varying float vIn; varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  float l = max(dot(n, uSun), 0.0);
  vec3 c = vAlb * (uSunCol * l + mix(uGround, uSky, n.y * 0.5 + 0.5));
  vec3 vd = normalize(cameraPosition - vW); float rim = pow(1.0 - abs(dot(n, vd)), 2.0);
  c += vEm * (vIn < 0.0 ? 1.0 : 0.35) * (0.7 + rim * 0.9);
  gl_FragColor = vec4(c, 1.0);
}`;
function chunkGeometry() {
  const g = new THREE.IcosahedronGeometry(0.5, 0).toNonIndexed();
  const p = g.attributes.position, seen = new Map();
  let s = 17;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < p.count; i++) { // same jitter for shared corners → closed chunk
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(k)) seen.set(k, 0.7 + rnd() * 0.55);
    const m = seen.get(k); p.setXYZ(i, p.getX(i) * m, p.getY(i) * m * 0.8, p.getZ(i) * m);
  }
  g.computeVertexNormals();
  return g;
}
export class Debris extends Sys {
  constructor(cap, sun) {
    const geo = instGeo(chunkGeometry());
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: VFX_U.uTime, uOffset: VFX_U.uOffset, uSun: { value: sun.clone().normalize() }, uSunCol: { value: new THREE.Color(1.0, 0.66, 0.42) }, uSky: { value: new THREE.Color(0.42, 0.36, 0.62) }, uGround: { value: new THREE.Color(0.24, 0.18, 0.2) } },
      vertexShader: DEB_VERT, fragmentShader: DEB_FRAG, fog: false,
    });
    super(geo, mat, cap, ['aA', 'aB', 'aC', 'aD', 'aE', 'aF'], 'vfx-debris', 2);
  }
  /** e: { x,y,z, vx,vy,vz, life, wx,wy,wz, floor, sx,sy,sz, g, alb:[r,g,b], em, emc:[r,g,b], cool } */
  emit(e, t) {
    const i = this.buf.take() * 4, A = this.buf.arr, o = VFX_U.uOffset.value;
    A.aA.set([e.x - o.x, e.y - o.y, e.z - o.z, t], i);
    A.aB[i] = e.vx; A.aB[i + 1] = e.vy; A.aB[i + 2] = e.vz; A.aB[i + 3] = e.life;
    A.aC[i] = e.wx; A.aC[i + 1] = e.wy; A.aC[i + 2] = e.wz; A.aC[i + 3] = e.floor - o.y;
    A.aD[i] = e.sx; A.aD[i + 1] = e.sy; A.aD[i + 2] = e.sz; A.aD[i + 3] = e.g;
    A.aE[i] = e.alb[0]; A.aE[i + 1] = e.alb[1]; A.aE[i + 2] = e.alb[2]; A.aE[i + 3] = e.em;
    A.aF[i] = e.emc[0]; A.aF[i + 1] = e.emc[1]; A.aF[i + 2] = e.emc[2]; A.aF[i + 3] = e.cool;
    if (t + e.life > this.until) this.until = t + e.life;
  }
}

// =========================================================================== rings (shockwaves)
const RING_VERT = /* glsl */`
attribute vec4 aA, aB, aC, aD, aE;
uniform float uTime; uniform vec3 uOffset;
varying vec2 vC; varying vec4 vCol; varying vec4 vP;
void main() {
  float age = uTime - aA.w, u = age / aB.w;
  if (u < 0.0 || u > 1.0) { ${DEAD} }
  float R = mix(aC.x, aC.y, 1.0 - pow(1.0 - u, aC.w));
  float half_ = R * (1.0 + aC.z * 2.5);
  vec3 c = aA.xyz + uOffset;
  vec4 mv;
  if (dot(aB.xyz, aB.xyz) < 0.01) { mv = viewMatrix * vec4(c, 1.0); mv.xy += position.xy * 2.0 * half_; }
  else { vec3 n = normalize(aB.xyz); vec3 t = normalize(cross(n, abs(n.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))); vec3 b = cross(n, t);
    mv = viewMatrix * vec4(c + (t * position.x + b * position.y) * 2.0 * half_, 1.0); }
  gl_Position = projectionMatrix * mv;
  vC = position.xy * 2.0 * (1.0 + aC.z * 2.5);
  float fade = pow(1.0 - u, aE.z) * min(1.0, u * 25.0) * smoothstep(0.15, 0.8, -mv.z);
  vCol = vec4(aD.rgb * aD.w * fade, aC.z);
  vP = vec4(aE.x, aE.y, u, R);
}`;
const RING_FRAG = /* glsl */`varying vec2 vC; varying vec4 vCol; varying vec4 vP;
${HEX_GLSL}
void main() {
  float d = length(vC), w = vCol.a;
  float band = exp(-pow((d - 1.0) / w, 2.0));
  float lead = exp(-pow((d - 1.0 - w * 0.4) / (w * 0.35), 2.0));
  float ang = atan(vC.y, vC.x);
  float brk = 0.6 + 0.4 * hash11(floor(ang * 9.0 + vP.y * 13.0)) ;
  float I = (band * 0.7 + lead * 0.8) * brk + smoothstep(1.0, 0.0, d) * 0.12 * (1.0 - vP.z);
  if (vP.x > 0.5) { // hex lattice band (Mobius)
    float h = hexEdge(vC * 5.0 + vP.y); I = band * (0.35 + (1.0 - smoothstep(0.0, 0.07, h)) * 1.2) + lead * 0.6;
  }
  if (I < 0.004) discard;
  gl_FragColor = vec4(vCol.rgb * I, 1.0);
}`;
export class Rings extends Sys {
  constructor(cap) {
    const geo = instGeo(new THREE.PlaneGeometry(1, 1));
    const mat = new THREE.ShaderMaterial({ uniforms: { uTime: VFX_U.uTime, uOffset: VFX_U.uOffset }, vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
    super(geo, mat, cap, ['aA', 'aB', 'aC', 'aD', 'aE'], 'vfx-rings', 10);
  }
  /** n: normal (null → camera-facing). mode 0 shock, 1 hex band. */
  emit(x, y, z, t, life, n, r0, r1, width, ease, col, I, mode = 0, seed = 0, fadePow = 1.5) {
    const i = this.buf.take() * 4, A = this.buf.arr, o = VFX_U.uOffset.value;
    A.aA[i] = x - o.x; A.aA[i + 1] = y - o.y; A.aA[i + 2] = z - o.z; A.aA[i + 3] = t;
    A.aB[i] = n ? n.x : 0; A.aB[i + 1] = n ? n.y : 0; A.aB[i + 2] = n ? n.z : 0; A.aB[i + 3] = life;
    A.aC[i] = r0; A.aC[i + 1] = r1; A.aC[i + 2] = width; A.aC[i + 3] = ease;
    A.aD[i] = col[0]; A.aD[i + 1] = col[1]; A.aD[i + 2] = col[2]; A.aD[i + 3] = I;
    A.aE[i] = mode; A.aE[i + 1] = seed; A.aE[i + 2] = fadePow; A.aE[i + 3] = 0;
    if (t + life > this.until) this.until = t + life;
  }
}

// =========================================================================== shells (nova / hex net / implosion)
const SHELL_VERT = /* glsl */`
attribute vec4 aA, aB, aC, aD;
uniform float uTime; uniform vec3 uOffset;
varying vec3 vN; varying vec3 vL; varying vec3 vV; varying vec4 vCol; varying vec4 vP;
void main() {
  float age = uTime - aA.w, u = age / aB.z;
  if (u < 0.0 || u > 1.0) { ${DEAD} }
  float e = 1.0 - pow(1.0 - u, aD.y);
  float R = mix(aB.x, aB.y, e);
  float m = aB.w;
  if (m > 0.5 && m < 1.5) R = aB.y * (0.55 + 0.45 * smoothstep(0.0, 0.25, u)) * (1.0 - 0.12 * smoothstep(0.35, 1.0, u)); // net: snap open, then tighten round the target
  vec3 wp = aA.xyz + uOffset + position * R;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  float a = age * (1.2 + aD.z * 0.2), c = cos(a), s = sin(a);
  vL = vec3(c * position.x + s * position.z, position.y, -s * position.x + c * position.z);
  vN = normalize(mat3(viewMatrix) * normal); vV = normalize(-mv.xyz);
  float fade = pow(1.0 - u, aD.w) * min(1.0, u * 20.0) * smoothstep(0.2, 0.9, -mv.z);
  vCol = vec4(aC.rgb * aC.w * fade, m);
  vP = vec4(aD.x, aD.z, u, R);
}`;
const SHELL_FRAG = /* glsl */`varying vec3 vN; varying vec3 vL; varying vec3 vV; varying vec4 vCol; varying vec4 vP;
${HEX_GLSL}
void main() {
  vec3 n = normalize(vN);
  float fr = 1.0 - abs(dot(n, normalize(vV)));
  vec3 w = pow(abs(normalize(vL)), vec3(4.0)); w /= (w.x + w.y + w.z);
  float s = vP.x;
  float hx = hexEdge(vL.yz * s + vP.y) * w.x + hexEdge(vL.xz * s + vP.y * 1.7) * w.y + hexEdge(vL.xy * s + vP.y * 2.3) * w.z;
  float line = 1.0 - smoothstep(0.0, 0.06, hx);
  float knot = 1.0 - smoothstep(0.0, 0.16, hx);
  float m = vCol.a, I;
  if (m < 0.5) I = pow(fr, 3.5) * 1.5 + line * 0.55 * pow(fr, 1.5) + 0.02;                    // nova: fresnel shell, faint lattice
  else if (m < 1.5) I = line * (0.55 + 0.9 * fr) + knot * 0.08 + pow(fr, 3.0) * 0.35; // hex web net
  else I = pow(fr, 1.5) * 1.6 + line * 0.4;                                            // implosion
  if (I < 0.004) discard;
  gl_FragColor = vec4(vCol.rgb * I, 1.0);
}`;
export class Shells extends Sys {
  constructor(cap) {
    const geo = instGeo(new THREE.IcosahedronGeometry(1, 3));
    const mat = new THREE.ShaderMaterial({ uniforms: { uTime: VFX_U.uTime, uOffset: VFX_U.uOffset }, vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
    super(geo, mat, cap, ['aA', 'aB', 'aC', 'aD'], 'vfx-shells', 10);
  }
  /** mode 0 nova, 1 hex net, 2 implosion. Returns the slot (for follow). */
  emit(x, y, z, t, life, r0, r1, mode, col, I, hexScale = 4, ease = 3, seed = 0, fadePow = 1.2) {
    const s = this.buf.take(), i = s * 4, A = this.buf.arr, o = VFX_U.uOffset.value;
    A.aA[i] = x - o.x; A.aA[i + 1] = y - o.y; A.aA[i + 2] = z - o.z; A.aA[i + 3] = t;
    A.aB[i] = r0; A.aB[i + 1] = r1; A.aB[i + 2] = life; A.aB[i + 3] = mode;
    A.aC[i] = col[0]; A.aC[i + 1] = col[1]; A.aC[i + 2] = col[2]; A.aC[i + 3] = I;
    A.aD[i] = hexScale; A.aD[i + 1] = ease; A.aD[i + 2] = seed; A.aD[i + 3] = fadePow;
    if (t + life > this.until) this.until = t + life;
    return s;
  }
  /** Move a live shell (net following a moving target). */
  setPos(s, p) { const i = s * 4, a = this.buf.attrs.aA, o = VFX_U.uOffset.value; a.array[i] = p.x - o.x; a.array[i + 1] = p.y - o.y; a.array[i + 2] = p.z - o.z; if (this.buf.dStart < 0) { this.buf.dStart = s; this.buf.dCount = 1; } else { this.buf.dCount = this.buf.cap; } }
}

// =========================================================================== arcs (electric, jagged strips from a seed)
const ARC_SEG = 12;
const ARC_VERT = /* glsl */`
attribute vec4 aA, aB, aC;
uniform float uTime; uniform vec3 uOffset;
varying float vX; varying float vI;
${HEX_GLSL}
vec3 arcP(float y, float stp, vec3 A, vec3 B, vec3 p1, vec3 p2) {
  float seg = floor(y * ${ARC_SEG}.0 + 0.5);
  float h1 = hash11(seg * 7.13 + stp * 3.7 + aC.x) - 0.5, h2 = hash11(seg * 3.31 + stp * 5.1 + aC.x * 1.7) - 0.5;
  float env = sin(3.14159 * y);
  return mix(A, B, y) + (p1 * h1 + p2 * h2) * aC.z * env * 2.0;
}
void main() {
  float age = uTime - aA.w, u = age / aB.w;
  if (u < 0.0 || u > 1.0) { ${DEAD} }
  vec3 A = aA.xyz + uOffset, B = aB.xyz + uOffset, ax = normalize(B - A);
  vec3 p1 = normalize(cross(ax, abs(ax.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), p2 = cross(ax, p1);
  float stp = floor(age * aC.w);
  float y = position.y;
  vec3 P = arcP(y, stp, A, B, p1, p2), Q = arcP(min(1.0, y + 1.0 / ${ARC_SEG}.0), stp, A, B, p1, p2);
  if (y > 0.999) Q = P + (P - arcP(y - 1.0 / ${ARC_SEG}.0, stp, A, B, p1, p2));
  vec3 vp = (viewMatrix * vec4(P, 1.0)).xyz, vq = (viewMatrix * vec4(Q, 1.0)).xyz;
  vec2 d = normalize(vq.xy - vp.xy + 1e-5); vp.xy += vec2(-d.y, d.x) * position.x * aC.y;
  gl_Position = projectionMatrix * vec4(vp, 1.0);
  vX = position.x;
  vI = smoothstep(0.0, 0.08, u) * pow(1.0 - u, 1.4) * (0.75 + 0.25 * sin(age * 9.0 + aC.x));
}`;
const ARC_FRAG = /* glsl */`uniform vec3 uCol; varying float vX; varying float vI;
void main() { float x = abs(vX); float core = exp(-x * x * 18.0); float I = (core * 1.4 + exp(-x * x * 3.0) * 0.4) * vI; gl_FragColor = vec4(mix(uCol, vec3(1.0), core * 0.7) * I, 1.0); }`;
export class Arcs extends Sys {
  constructor(cap, col) {
    const pos = [], idx = [];
    for (let s = 0; s <= ARC_SEG; s++) { pos.push(-1, s / ARC_SEG, 0, 1, s / ARC_SEG, 0); if (s < ARC_SEG) { const a = s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    const base = new THREE.BufferGeometry(); base.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); base.setIndex(idx);
    const geo = instGeo(base);
    const mat = new THREE.ShaderMaterial({ uniforms: { uTime: VFX_U.uTime, uOffset: VFX_U.uOffset, uCol: { value: new THREE.Vector3(...col) } }, vertexShader: ARC_VERT, fragmentShader: ARC_FRAG, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
    super(geo, mat, cap, ['aA', 'aB', 'aC'], 'vfx-arcs', 10);
  }
  emit(a, b, t, life, seed, width = 0.012, jitter = 0.08, rate = 14) {
    const i = this.buf.take() * 4, A = this.buf.arr, o = VFX_U.uOffset.value;
    A.aA[i] = a.x - o.x; A.aA[i + 1] = a.y - o.y; A.aA[i + 2] = a.z - o.z; A.aA[i + 3] = t;
    A.aB[i] = b.x - o.x; A.aB[i + 1] = b.y - o.y; A.aB[i + 2] = b.z - o.z; A.aB[i + 3] = life;
    A.aC[i] = seed; A.aC[i + 1] = width; A.aC[i + 2] = jitter; A.aC[i + 3] = rate;
    if (t + life > this.until) this.until = t + life;
  }
}

// =========================================================================== beams / ropes (camera-facing ribbons)
const BEAM_SEG = 24;
const BEAM_VERT = /* glsl */`
attribute vec4 aA, aB, aC, aD;
uniform float uTime;
varying vec2 vUv; varying float vAlong; varying vec4 vP; varying float vY;
void main() {
  float y = position.y, f = mix(aC.x, aC.y, y);
  vec3 A = aA.xyz, B = aB.xyz, P = mix(A, B, f);
  float len = length(B - A);
  vec3 ax = (B - A) / max(len, 1e-4);
  vec3 side = normalize(cross(ax, cameraPosition - P) + 1e-5);
  float w = mix(aA.w, aB.w, f);
  if (aC.w > 0.5) P += side * sin(f * 18.0 - uTime * 7.0 + aD.y) * 0.004 * sin(3.14159 * f); // rope shimmer: a faint travelling ripple
  P += side * position.x * w * 3.2;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
  vUv = vec2(position.x, f * len); vAlong = f; vY = y;
  vP = vec4(uTime - aD.x, len, aC.z, aC.w);
}`;
const BEAM_FRAG = /* glsl */`uniform sampler2D uHex; uniform vec3 uDeep, uCyan; varying vec2 vUv; varying float vAlong; varying vec4 vP; varying float vY;
void main() {
  float x = abs(vUv.x), age = vP.x, len = vP.y, br = vP.z, rope = vP.w;
  float core = exp(-x * x * 120.0), glow = exp(-x * x * 9.0), halo = exp(-x * x * 3.0) * 0.25;
  float lat = texture2D(uHex, vec2(vUv.x * 0.5 + 0.5, vUv.y * 1.4 - age * (rope > 0.5 ? 0.6 : 3.0))).r;
  float pulse = 0.0;
  if (rope < 0.5) { for (int i = 0; i < 3; i++) { float c = age * 46.0 - float(i) * 2.6; float d = vUv.y - c; pulse += exp(-d * d * 3.0) * step(0.0, c); } }
  else { for (int i = 0; i < 2; i++) { float c = mod(age * 9.0 + float(i) * (len * 0.5 + 3.0), len + 6.0) - 3.0; float d = vUv.y - c; pulse += exp(-d * d * 1.2) * 0.75; } pulse += 0.14 * sin(vUv.y * 4.0 - age * 11.0); }
  float tip = smoothstep(0.0, 0.03, vY) * (rope > 0.5 ? 1.0 : 0.7 + 0.3 * smoothstep(1.0, 0.9, vY));
  vec3 col = uDeep * halo + uCyan * glow * (0.55 + lat * 0.9 + pulse * 1.3) + vec3(1.0) * core * (1.0 + pulse * 1.2);
  gl_FragColor = vec4(col * br * tip, 1.0);
}`;
export class Beams {
  constructor(cap, hexTex) {
    const pos = [], idx = [];
    for (let s = 0; s <= BEAM_SEG; s++) { pos.push(-1, s / BEAM_SEG, 0, 1, s / BEAM_SEG, 0); if (s < BEAM_SEG) { const a = s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    const base = new THREE.BufferGeometry(); base.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); base.setIndex(idx);
    this.geo = instGeo(base); this.cap = cap;
    this.attrs = ['aA', 'aB', 'aC', 'aD'].map((n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); a.setUsage(THREE.DynamicDrawUsage); this.geo.setAttribute(n, a); return a; });
    this.mat = new THREE.ShaderMaterial({ uniforms: { uTime: VFX_U.uTime, uHex: { value: hexTex }, uDeep: { value: new THREE.Vector3(0.02, 0.32, 1.0) }, uCyan: { value: new THREE.Vector3(0.5, 0.91, 1.0) } }, vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
    this.mesh = new THREE.Mesh(this.geo, this.mat); this.mesh.name = 'vfx-beams'; this.mesh.frustumCulled = false; this.mesh.renderOrder = 10; this.mesh.visible = false;
    this.n = 0; this.warm = 0;
  }
  begin() { this.n = 0; }
  /** from/to: Vector3, w0/w1 half widths (m), s0..s1 visible fraction, br brightness, rope 0/1, t0 start time, seed */
  put(from, to, w0, w1, s0, s1, br, rope, t0, seed) {
    if (this.n >= this.cap) return;
    const i = this.n++ * 4, [a, b, c, d] = this.attrs;
    a.array[i] = from.x; a.array[i + 1] = from.y; a.array[i + 2] = from.z; a.array[i + 3] = w0;
    b.array[i] = to.x; b.array[i + 1] = to.y; b.array[i + 2] = to.z; b.array[i + 3] = w1;
    c.array[i] = s0; c.array[i + 1] = s1; c.array[i + 2] = br; c.array[i + 3] = rope;
    d.array[i] = t0; d.array[i + 1] = seed; d.array[i + 2] = 0; d.array[i + 3] = 0;
  }
  end() {
    this.geo.instanceCount = this.n;
    if (this.n) for (const a of this.attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, this.n * 4); a.needsUpdate = true; }
    this.mesh.visible = this.n > 0 || this.warm > 0; if (this.warm > 0) { this.warm--; if (!this.n) this.geo.instanceCount = 0; }
  }
  clear() { this.n = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }
}

// =========================================================================== attached sprites (face glow, halos, nozzle glows)
const ATT_VERT = /* glsl */`
attribute vec4 aA, aB, aC;
varying vec2 vUv; varying vec4 vCol; varying float vTile;
void main() {
  vec4 mv = viewMatrix * vec4(aA.xyz, 1.0);
  float size = min(aA.w, -mv.z * 0.6);
  float r = aC.y, c = cos(r), s = sin(r);
  mv.xy += mat2(c, s, -s, c) * position.xy * size;
  mv.z += aC.z;                    // pulled toward the camera (face glow in front of the shell)
  gl_Position = projectionMatrix * mv;
  vUv = uv; vCol = aB; vTile = aC.x;
}`;
const ATT_FRAG = /* glsl */`uniform sampler2D uFace; uniform vec3 uFaceHot; varying vec2 vUv; varying vec4 vCol; varying float vTile;
void main() {
  vec3 col;
  if (vTile < 0.5) { vec2 f = texture2D(uFace, vUv).rg; col = vCol.rgb * f.r * 0.9 + uFaceHot * f.g * f.r * 1.4; }
  else { float r = length(vUv * 2.0 - 1.0); float I = exp(-r * r * 5.0) * (1.0 - smoothstep(0.7, 1.0, r)) + exp(-r * r * 40.0) * 0.6 * step(1.5, vTile); col = vCol.rgb * I; }
  gl_FragColor = vec4(col * vCol.a, 1.0);
}`;
export class Attach {
  constructor(cap, faceTex) {
    this.geo = instGeo(new THREE.PlaneGeometry(1, 1)); this.cap = cap;
    this.attrs = ['aA', 'aB', 'aC'].map((n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); a.setUsage(THREE.DynamicDrawUsage); this.geo.setAttribute(n, a); return a; });
    this.mat = new THREE.ShaderMaterial({ uniforms: { uFace: { value: faceTex }, uFaceHot: { value: new THREE.Vector3(1.0, 0.95, 0.55) } }, vertexShader: ATT_VERT, fragmentShader: ATT_FRAG, transparent: true, depthWrite: false, fog: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
    this.mesh = new THREE.Mesh(this.geo, this.mat); this.mesh.name = 'vfx-attach'; this.mesh.frustumCulled = false; this.mesh.renderOrder = 11; this.mesh.visible = false;
    this.n = 0; this.warm = 0;
  }
  begin() { this.n = 0; }
  /** tile 0 face, 1 halo, 2 halo + hot dot. pull = metres toward the camera. */
  put(p, size, col, I, tile, rot = 0, pull = 0) {
    if (this.n >= this.cap) return;
    const i = this.n++ * 4, [a, b, c] = this.attrs;
    a.array[i] = p.x; a.array[i + 1] = p.y; a.array[i + 2] = p.z; a.array[i + 3] = size;
    b.array[i] = col[0]; b.array[i + 1] = col[1]; b.array[i + 2] = col[2]; b.array[i + 3] = I;
    c.array[i] = tile; c.array[i + 1] = rot; c.array[i + 2] = pull; c.array[i + 3] = 0;
  }
  end() {
    this.geo.instanceCount = this.n;
    if (this.n) for (const a of this.attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, this.n * 4); a.needsUpdate = true; }
    this.mesh.visible = this.n > 0 || this.warm > 0; if (this.warm > 0) this.warm--;
  }
  clear() { this.n = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }
}

// =========================================================================== damage edge (camera-attached, centre transparent)
const EDGE_VERT = /* glsl */`varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const EDGE_FRAG = /* glsl */`uniform float uAge, uOn, uSeed; uniform vec2 uDir; varying vec3 vP;
${HEX_GLSL}
void main() {
  vec3 d = normalize(vP);
  float ang = acos(clamp(-d.z, -1.0, 1.0));            // 0 = straight ahead
  vec2 q = d.xy / max(-d.z, 0.25);
  vec2 dd = length(d.xy) > 1e-4 ? normalize(d.xy) : vec2(0.0);
  float side = 0.55 + 0.75 * max(dot(dd, uDir), 0.0);
  float env = smoothstep(0.0, 0.04, uAge) * (1.0 - smoothstep(0.12, 0.62, uAge));
  float rim = smoothstep(0.85, 1.4, ang) * env * side; // (v0.30b: periphery only — the centre ~50° stays clear)
  // shield fracture: irregular radial cracks from ONE impact point at the view edge (+ a broken concentric ring),
  // grown in 70 ms, faded by 0.45 s, masked out of the central ~40°
  vec2 P = uDir * 1.25;               // impact point ≈ 51° off-centre: at the view edge
  vec2 v = q - P; float r = length(v); float th = atan(v.y, v.x);
  float grow = smoothstep(0.0, 0.07, uAge) * 1.25, crack = 0.0;
  for (int k = 0; k < 8; k++) {
    float fk = float(k), h1 = hash11(fk * 3.1 + uSeed), h2 = hash11(fk * 7.7 + uSeed * 1.3);
    float base = 6.2832 * (fk + h1 * 0.7) / 8.0;
    float wig = sin(r * 9.0 + fk * 4.0 + uSeed) * 0.09 + sin(r * 23.0 + fk * 1.7) * 0.035 + (hash11(floor(r * 7.0) + fk * 13.0 + uSeed) - 0.5) * 0.06;
    float a0 = th - base - wig; float dist = abs(sin(a0)) * r;
    float len = 0.45 + 0.9 * h2;
    float w = mix(0.02, 0.006, min(1.0, r / len));
    crack = max(crack, (1.0 - smoothstep(w * 0.4, w, dist)) * step(0.0, cos(a0)) * step(r, min(len, grow)) * (1.0 - 0.5 * r / len));
    // short side branches
    float bth = base + wig + (h1 - 0.5) * 1.6; float br = r - len * 0.45; float bd = abs(sin(th - bth)) * r;
    crack = max(crack, (1.0 - smoothstep(0.002, 0.007, bd)) * step(0.0, br) * step(br, 0.22 * h2) * step(r, grow) * 0.8);
  }
  float rr = 0.28 + 0.05 * sin(th * 5.0 + uSeed);
  crack = max(crack, (1.0 - smoothstep(0.003, 0.009, abs(r - rr))) * step(0.45, hash11(floor(th * 1.9) + uSeed)) * step(rr, grow));
  crack *= smoothstep(0.75, 1.0, ang) * (1.0 - smoothstep(0.08, 0.45, uAge)) * uOn;
  float glint = exp(-r * r * 60.0) * smoothstep(0.55, 0.85, ang) * (1.0 - smoothstep(0.0, 0.12, uAge)); // impact spark ≤ 120 ms
  vec3 col = mix(vec3(0.85, 0.12, 0.04), vec3(1.0, 0.72, 0.45), max(crack, glint));
  float a = clamp(rim * 0.5 + crack * 0.9 + glint * 0.7, 0.0, 0.8) * uOn;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
}`;
export class DamageEdge {
  constructor() {
    this.mat = new THREE.ShaderMaterial({ uniforms: { uAge: { value: 9 }, uOn: { value: 0 }, uSeed: { value: 1 }, uDir: { value: new THREE.Vector2(0, -1) } }, vertexShader: EDGE_VERT, fragmentShader: EDGE_FRAG, transparent: true, depthTest: false, depthWrite: false, side: THREE.BackSide, fog: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 16), this.mat); this.mesh.name = 'vfx-damage-edge'; this.mesh.renderOrder = 99; this.mesh.frustumCulled = false; this.mesh.visible = false;
    this.age = 9; this.warm = 0;
  }
  trigger(dirX, dirY, seed = 1) { this.age = 0; this.mat.uniforms.uSeed.value = seed; const l = Math.hypot(dirX, dirY) || 1; this.mat.uniforms.uDir.value.set(dirX / l, dirY / l); }
  update(dt) {
    this.age += dt; const on = this.age < 0.65;
    this.mat.uniforms.uAge.value = this.age; this.mat.uniforms.uOn.value = on ? 1 : 0;
    this.mesh.visible = on || this.warm > 0; if (this.warm > 0) this.warm--;
  }
  clear() { this.age = 9; this.mesh.visible = false; }
}
