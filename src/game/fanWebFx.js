// Fan Web (扇形光網) visuals for the arcade — pooled, one draw call per fan:
//   · fan: a translucent sector "net" opening from the hands toward the row (radial strands + arcs + clear
//     gaps, bright rim), revealed outward over ~0.16 s, then fading; never an opaque wall;
//   · row cue: a thin pale-blue connector across the three bombs of an upcoming row + a small pictogram of the
//     gesture (open hand palm UP, upright fist thumb side up, little-finger edge on the palm).
// Hits are decided by the chart event, never by this geometry.
import * as THREE from 'three';
import { Billboards } from '../art/particles.js';
import { vfxOn } from './vfx/vfxFlags.js';
import { hexTexture } from './vfx/textures.js';
import { mulberry32 } from './vfx/rand.js';

/** Effect tuning (Quest 3: one draw call per fan layer / particle set; additive, no lights). */
export const FAN_FX = { dur: 0.85, reveal: 0.18, hold: 0.32, gain: 1.25, streamSparks: 46, burstSparks: 14, shards: 7 };
const _t = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3(), _s = new THREE.Vector3();

const FAN_VERT = /* glsl */`
varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FAN_FRAG = /* glsl */`
uniform float uHalf, uReveal, uFade, uTime, uGain; uniform vec3 uColor, uHot;
varying vec2 vP;
float ln(float d, float w) { return 1.0 - smoothstep(w, w * 2.6, d); }
void main() {
  float r = length(vP); float a = atan(vP.x, vP.y);           // a = 0 straight ahead (+y local)
  if (r > uReveal + 0.04 || abs(a) > uHalf) discard;
  float ua = a / uHalf;                                         // -1 … 1 across the fan
  float radial = ln(abs(fract(ua * 9.0 + 0.5) - 0.5), 0.014);   // 19 strands
  float arcs = ln(abs(fract(r * 9.0 - uTime * 3.0) - 0.5), 0.02); // web rings drifting outward
  // woven diagonals (two families) → a real net instead of spokes
  float d1 = ln(abs(fract(ua * 5.0 + r * 6.0) - 0.5), 0.012), d2 = ln(abs(fract(ua * 5.0 - r * 6.0) - 0.5), 0.012);
  float lines = max(max(radial, arcs * 0.9), max(d1, d2) * 0.55);
  // knots where strands cross
  float knot = radial * arcs;
  // bright wavefront + side rims
  float front = smoothstep(uReveal - 0.14, uReveal, r) * (1.0 - smoothstep(uReveal, uReveal + 0.04, r));
  float side = ln(1.0 - abs(ua), 0.012);
  float spark = step(0.985, fract(sin(dot(floor(vP * 40.0), vec2(12.9898, 78.233))) * 43758.5453 + uTime * 2.0)) * 0.8; // glints
  float a0 = (0.035 + lines * 0.7 + knot * 0.6 + front * 1.05 + side * 0.6 + spark * lines) * uFade * uGain * smoothstep(0.1, 0.38, r); // faint at the hands: the fist / palm contact stays visible
  vec3 col = mix(uColor, uHot, clamp(front + knot * 0.6, 0.0, 1.0)) * (0.7 + lines * 0.9 + front * 1.6);
  gl_FragColor = vec4(col, a0);
}`;

// v0.30 fan look (flag `fanWeb`): hex lattice net, white-hot reveal front and a shockwave arc that sweeps on past the
// three lanes (geometry scaled by uOver; r = 1 is the row). Shares the uniforms object of the old material.
const FAN_FRAG2 = /* glsl */`
uniform float uHalf, uReveal, uFade, uTime, uGain, uOver; uniform vec3 uColor, uHot; uniform sampler2D uHex;
varying vec2 vP;
float ln(float d, float w) { return 1.0 - smoothstep(w, w * 2.6, d); }
void main() {
  float r = length(vP) * uOver; float a = atan(vP.x, vP.y);
  if (abs(a) > uHalf) discard;
  float ua = a / uHalf;
  float sweep = uReveal * uOver;                                              // shockwave arc keeps going past the row
  float shock = exp(-pow((r - sweep) / 0.05, 2.0)) * (1.0 - smoothstep(1.0, uOver, r) * 0.6) * smoothstep(0.15, 0.4, r);
  if (r > uReveal + 0.05 && shock < 0.01) discard;
  float inside = 1.0 - smoothstep(uReveal, uReveal + 0.05, r);
  float radial = ln(abs(fract(ua * 6.0 + 0.5) - 0.5), 0.012);
  float lat = texture2D(uHex, vec2(ua * 2.4, r * 2.6 - uTime * 0.35)).r;
  float arcs = ln(abs(fract(r * 6.0 - uTime * 2.0) - 0.5), 0.016);
  float lines = max(max(radial * 0.9, lat * 0.75), arcs * 0.5);
  float front = smoothstep(uReveal - 0.12, uReveal, r) * inside;
  float side = ln(1.0 - abs(ua), 0.01);
  float edgeFade = 1.0 - smoothstep(0.7, 1.0, abs(ua)) * 0.35;
  float a0 = ((0.025 + lines * 0.65 + front * 1.2 + side * 0.5) * inside * edgeFade + shock * 1.1) * uFade * uGain * smoothstep(0.1, 0.38, r);
  vec3 col = mix(uColor, uHot, clamp(front + shock + lat * 0.25, 0.0, 1.0)) * (0.7 + lines * 0.8 + front * 1.5 + shock);
  gl_FragColor = vec4(col, a0);
}`;

function gesturePictogram() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = 'rgba(6,18,40,0.72)'; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#7ef0ff'; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#e8f6ff'; g.strokeStyle = '#0b1830'; g.lineWidth = 3;
  // open hand seen from the side, palm UP (a tray): flat palm + fingers to the right
  g.beginPath(); g.roundRect(22, 78, 62, 14, 6); g.fill(); g.stroke();
  g.beginPath(); g.roundRect(80, 80, 26, 9, 4); g.fill(); g.stroke();
  // upright fist on top: little-finger edge DOWN on the palm, thumb on TOP
  g.beginPath(); g.roundRect(42, 38, 30, 40, 8); g.fill(); g.stroke();
  g.strokeStyle = '#0b1830'; g.lineWidth = 2; for (const y of [48, 58, 68]) { g.beginPath(); g.moveTo(46, y); g.lineTo(68, y); g.stroke(); } // curled fingers
  g.fillStyle = '#e8f6ff'; g.beginPath(); g.roundRect(40, 30, 26, 11, 5); g.fill(); g.lineWidth = 3; g.stroke(); // thumb on top
  // contact spark at the little-finger edge
  g.fillStyle = '#22d3ff'; g.beginPath(); g.arc(57, 79, 5, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class FanWebFx {
  constructor(scene, n = 4, fx = null) {
    this.fx = fx; this._rng = mulberry32(0xfa9); // v0.30: shared VFX kit (fx.vfx) when given
    this.root = new THREE.Group(); this.root.name = 'fanWebFx'; scene.add(this.root);
    // pooled particles (one draw call each): blue sparks along the fan + at the bombs, orange shell shards
    this.sparks = new Billboards(160, { color: 0x8fe6ff, additive: true, gravity: 1.5, drag: 1.2, name: 'FanSparks' });
    this.shards = new Billboards(48, { color: 0xff8a2a, additive: false, gravity: 7, drag: 0.4, name: 'FanShards' });
    this.root.add(this.sparks.mesh, this.shards.mesh);
    // contact flash between the hands + an impact shock ring per bomb (pooled sprites / rings)
    const flashTex = (() => { if (typeof document === 'undefined') return null; const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(140,230,255,0.85)'); gr.addColorStop(1, 'rgba(20,90,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    this.flashes = [];
    for (let i = 0; i < 2; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: 0x9fefff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false })); sp.visible = false; sp.renderOrder = 31; this.root.add(sp); this.flashes.push({ sp, t: 0, on: false }); }
    const ringGeo = new THREE.RingGeometry(0.82, 1, 40);
    this.shocks = [];
    for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x9fefff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false })); m.visible = false; m.renderOrder = 31; this.root.add(m); this.shocks.push({ m, t: 0, on: false }); }
    const geo = new THREE.CircleGeometry(1, 48, Math.PI / 2 - 1.2, 2.4); // sector around +y (wider than needed; shader clips)
    this.fans = [];
    for (let i = 0; i < n; i++) {
      const mat = new THREE.ShaderMaterial({ vertexShader: FAN_VERT, fragmentShader: FAN_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: { uHalf: { value: 0.5 }, uReveal: { value: 0 }, uFade: { value: 1 }, uTime: { value: 0 }, uGain: { value: 1 }, uColor: { value: new THREE.Color(0x4fc8ff) }, uHot: { value: new THREE.Color(0xe8fbff) } } });
      const m = new THREE.Mesh(geo, mat); m.visible = false; m.renderOrder = 30; m.frustumCulled = false; this.root.add(m);
      let mat2 = null;
      if (fx?.vfx && typeof document !== 'undefined') { // v0.30 look: same uniforms object, new fragment shader
        mat.uniforms.uOver = { value: 1.35 }; mat.uniforms.uHex = { value: hexTexture() };
        mat2 = new THREE.ShaderMaterial({ vertexShader: FAN_VERT, fragmentShader: FAN_FRAG2, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: mat.uniforms });
      }
      this.fans.push({ m, mat, mat2, active: false, t: 0, len: 1, dur: FAN_FX.dur, delay: 0 });
    }
    // row cue: connector + pictogram (one each per visible row; rows never overlap in time)
    this.cues = [];
    const lineMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false, fog: false });
    const tex = gesturePictogram();
    for (let i = 0; i < 2; i++) {
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 6, 1, true), lineMat.clone()); line.visible = false; line.renderOrder = 29;
      const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, fog: false })); icon.visible = false; icon.renderOrder = 40;
      this.root.add(line, icon); this.cues.push({ line, icon, used: false });
    }
  }
  /** Open a fan from `origin` over the three target points (world). hit = the row was cleared (full burst). */
  _kit() { return this.fx?.vfx && vfxOn('fanWeb') ? this.fx.vfx : null; }
  fire(origin, targets, color = 0x4fc8ff, { hit = true } = {}) {
    const kit = this._kit();
    if (kit) return this._fireV30(kit, origin, targets, color, hit);
    const main = this._fan(origin, targets, color, { gain: hit ? FAN_FX.gain : 0.55, delay: 0, widen: 0.12 });
    if (hit) this._fan(origin, targets, 0x7d6bff, { gain: 0.5, delay: 0.05, widen: 0.2, lift: 0.06 }); // violet ghost layer behind it (depth)
    this._flash(origin, hit ? 0.55 : 0.3);
    // sparks streaming from the hands along the fan toward the row
    const n = hit ? FAN_FX.streamSparks : 14;
    for (let i = 0; i < n; i++) {
      const k = Math.random(), a = targets[0], b = targets[targets.length - 1];
      const to = _t.copy(a).lerp(b, k).sub(origin), d = to.length(); to.normalize();
      this.sparks.spawn(_s.copy(origin).addScaledVector(to, 0.35), _u.copy(to).multiplyScalar(d / (0.18 + Math.random() * 0.25)).add(_w.set((Math.random() - 0.5) * 0.8, (Math.random() - 0.3) * 0.8, (Math.random() - 0.5) * 0.8)), { life: 0.3 + Math.random() * 0.25, size: [0.11, 0.02], alpha: 1 });
    }
    return main;
  }
  /** v0.30: fan + violet ghost layer with the new shader, a small short contact flash, kit spark streams. */
  _fireV30(kit, origin, targets, color, hit) {
    const main = this._fan(origin, targets, color, { gain: hit ? FAN_FX.gain : 0.55, delay: 0, widen: 0.12 });
    if (hit) this._fan(origin, targets, 0x7d6bff, { gain: 0.45, delay: 0.05, widen: 0.2, lift: 0.06 });
    const f = this.flashes.find((x) => !x.on) || this.flashes[0]; f.on = true; f.t = 0; f.size = 0; f.sp.visible = false; // timer only (activeCount)
    kit._flash(origin, hit ? 0.22 : 0.14, [0.8, 0.97, 1.0], 0.07); // near the eyes: small and short
    const r = kit._seed(), n = hit ? 36 : 12, a = targets[0], b = targets[targets.length - 1], P = kit.P;
    for (let i = 0; i < n; i++) {
      const k = r.next(), to = _t.copy(a).lerp(b, k).sub(origin), d = to.length(); to.normalize();
      kit._p(_s.copy(origin).addScaledVector(to, 0.4)); const sp = d / r.range(0.2, 0.42);
      P.vx = to.x * sp + r.sym(0.4); P.vy = to.y * sp + r.sym(0.4); P.vz = to.z * sp + r.sym(0.4); P.drag = 1.2;
      P.life = r.range(0.22, 0.4); P.s0 = 0.05; P.s1 = 0.02; P.c0 = [1, 1, 1]; P.c1 = [0.5, 0.91, 1.0]; P.stretch = 0.03; P.tile = i % 5 === 0 ? 3 : 1; P.i0 = 1.3;
      if (P.tile === 3) { P.stretch = 0; P.s0 = 0.08; P.s1 = 0.04; }
      kit.add.emit(P, kit.time + r.range(0, 0.06));
    }
    return main;
  }
  /** Impact at one bomb: shock ring facing the camera, blue spark burst, orange shell shards. */
  burst(pos, cam) {
    const kit = this._kit();
    if (kit) { // v0.30: ≤ 80 ms hit flash, hex shock ring, spark burst (the shell shards come with the pop: kit.pumpkinBurst)
      const s = this.shocks.find((x) => !x.on) || this.shocks[0]; s.on = true; s.t = 0; s.m.visible = false; // timer only (activeCount)
      kit._flash(pos, 0.55, [0.85, 0.98, 1.0], 0.075);
      kit._ring(pos, 0.38, 0.12, 0.95, [0.5, 0.91, 1.0], 1.5, { width: 0.05, mode: 1, seed: this._rng() * 9 });
      kit._sparks(kit._seed(), pos, 14, 2, 5.5, 0.25, 0.5, 0.05, [1, 1, 1], [0.5, 0.91, 1.0], { g: 2, drag: 3 });
      void cam; return;
    }
    const s = this.shocks.find((x) => !x.on) || this.shocks[0];
    s.on = true; s.t = 0; s.m.visible = true; s.m.position.copy(pos); s.m.lookAt(cam); s.m.scale.setScalar(0.1);
    for (let i = 0; i < FAN_FX.burstSparks; i++) { const v = _u.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 3.5); this.sparks.spawn(pos, v, { life: 0.35 + Math.random() * 0.3, size: [0.13, 0.02], alpha: 1 }); }
    for (let i = 0; i < FAN_FX.shards; i++) { const v = _u.set(Math.random() - 0.5, 0.4 + Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(1.5 + Math.random() * 2.5); this.shards.spawn(pos, v, { life: 0.6 + Math.random() * 0.4, size: [0.12, 0.07], alpha: 0.95, spin: Math.random() * 6 }); }
  }
  _flash(pos, size) { const f = this.flashes.find((x) => !x.on) || this.flashes[0]; f.on = true; f.t = 0; f.size = size; f.sp.visible = true; f.sp.position.copy(pos); }
  _fan(origin, targets, color, { gain = 1, delay = 0, widen = 0.12, lift = 0 } = {}) {
    const f = this.fans.find((x) => !x.active) || this.fans[0];
    const center = targets[1] || targets[0], left = targets[0], right = targets[targets.length - 1];
    const fwd = new THREE.Vector3().subVectors(center, origin); const len = fwd.length(); fwd.divideScalar(len || 1);
    const across = new THREE.Vector3().subVectors(right, left); across.addScaledVector(fwd, -across.dot(fwd)); if (across.lengthSq() < 1e-6) across.set(1, 0, 0); across.normalize();
    const nrm = new THREE.Vector3().crossVectors(across, fwd).normalize();
    // local frame: +y = fwd, +x = across, +z = normal
    f.m.matrix.makeBasis(across, fwd, nrm).setPosition(_t.copy(origin).addScaledVector(nrm, lift)); f.m.matrixAutoUpdate = false;
    let half = 0; for (const p of targets) { const d = p.clone().sub(origin); half = Math.max(half, Math.abs(Math.atan2(d.dot(across), d.dot(fwd)))); }
    f.len = Math.max(...targets.map((p) => p.distanceTo(origin))) + 0.6;
    f.m.matrix.scale(_w.set(f.len, f.len, 1)); f.m.matrixWorldNeedsUpdate = true;
    f.mat.uniforms.uHalf.value = Math.min(1.15, half + widen); f.mat.uniforms.uColor.value.set(color); f.mat.uniforms.uGain.value = gain;
    f.mat.uniforms.uReveal.value = 0; f.mat.uniforms.uFade.value = 1;
    const v30 = !!(f.mat2 && this._kit()); f.m.material = v30 ? f.mat2 : f.mat; // v0.30: bigger quad for the sweeping shock arc
    if (v30) { f.m.matrix.scale(_w.set(f.mat.uniforms.uOver.value, f.mat.uniforms.uOver.value, 1)); f.m.matrixWorldNeedsUpdate = true; }
    f.active = true; f.t = -delay; f.m.visible = delay <= 0;
    return f;
  }
  /** Row cue between the outer bombs of an upcoming row; k 0..1 = approach (brightens), null = hide. */
  showCue(i, left, right, center, cam, k) {
    const c = this.cues[i]; if (!c) return;
    if (k === null) { c.line.visible = c.icon.visible = false; return; }
    const d = new THREE.Vector3().subVectors(right, left), L = d.length();
    c.line.position.copy(left).addScaledVector(d, 0.5); c.line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.divideScalar(L || 1)); c.line.scale.set(1 + k, L, 1 + k);
    c.line.material.opacity = 0.15 + 0.45 * k; c.line.visible = true;
    c.icon.position.copy(center).add(new THREE.Vector3(0, 0.55, 0)); const s = 0.42 * Math.max(1, center.distanceTo(cam) / 6); c.icon.scale.set(s, s, 1);
    c.icon.material.opacity = 0.4 + 0.6 * k; c.icon.visible = true;
  }
  update(dt) {
    if (this._warm > 0 && --this._warm === 0) for (const f of this.fans) if (!f.active) f.m.visible = false;
    for (const f of this.fans) {
      if (!f.active) continue;
      f.t += dt; if (f.t < 0) continue; f.m.visible = true;
      const u = f.mat.uniforms, D = FAN_FX;
      u.uTime.value += dt; u.uReveal.value = Math.min(1, f.t / D.reveal);
      u.uFade.value = f.t < D.hold ? 1 + 0.35 * Math.max(0, 1 - f.t / 0.12) : Math.max(0, 1 - (f.t - D.hold) / (f.dur - D.hold)); // a flare on the opening, then fade
      if (f.t >= f.dur) { f.active = false; f.m.visible = false; }
    }
    for (const f of this.flashes) { if (!f.on) continue; f.t += dt; const k = f.t / 0.3; if (!f.size) { if (k >= 1) f.on = false; continue; } f.sp.scale.setScalar(f.size * (0.4 + 1.6 * Math.min(1, k * 2))); f.sp.material.opacity = Math.max(0, 1 - k); if (k >= 1) { f.on = false; f.sp.visible = false; } }
    for (const s of this.shocks) { if (!s.on) continue; s.t += dt; const k = s.t / 0.4; if (!s.m.visible) { if (k >= 1) s.on = false; continue; } s.m.scale.setScalar(0.15 + 0.75 * Math.sqrt(Math.min(1, k))); s.m.material.opacity = Math.max(0, 0.9 * (1 - k)); if (k >= 1) { s.on = false; s.m.visible = false; } }
    this.sparks.update(dt); this.shards.update(dt);
  }
  /** v0.30: show one fan of each material for a few frames (programs compiled in the lead-in). */
  prewarm(pos, frames = 4) {
    const f = this.fans; if (f.length < 2 || f.some((x) => x.active)) return;
    this._warm = frames;
    f[0].m.material = f[0].mat; if (f[1].mat2) f[1].m.material = f[1].mat2;
    for (const x of [f[0], f[1]]) { x.m.matrixAutoUpdate = true; x.m.position.copy(pos); x.m.scale.setScalar(0.01); x.m.visible = true; }
  }
  get activeCount() { return this.fans.filter((f) => f.active).length + this.cues.filter((c) => c.line.visible).length + this.flashes.filter((f) => f.on).length + this.shocks.filter((s) => s.on).length; }
  clear() { for (const f of this.fans) { f.active = false; f.m.visible = false; } for (const c of this.cues) { c.line.visible = c.icon.visible = false; } for (const x of [...this.flashes, ...this.shocks]) { x.on = false; (x.sp || x.m).visible = false; } this.sparks.clear(); this.shards.clear(); }
}
