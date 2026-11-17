// v0.48: the look of the energy wave and of the hand charge. Made once: the charge pips on both hands (ONE Points
// object), the beam (a bright core and a soft outer glow), a charge orb at the palms and an impact orb at the target.
// Everything is drawn hidden in the lead-in so nothing compiles in play.
// 2026-11-15 (feedback: the effect was not good enough): the beam is now a shader with energy rushing along it, with an outer
// glow, and both ends have a pulsing orb while the blast is held.
import * as THREE from 'three';
import { ARMORED } from './armored.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _c = new THREE.Color();
const BEAM_VERT = /* glsl */`varying vec2 vUv; varying vec3 vN, vV;
void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`;
// vUv.y: 0 at the palms, 1 at the target. Bright along the middle of the tube as seen (|N·V| high), fading to its edge;
// bands of energy rush toward the target and twist around it.
const BEAM_FRAG = /* glsl */`uniform float uTime, uOpacity, uSoft; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN, vV;
void main() {
  float f = abs(dot(normalize(vN), normalize(vV)));
  float core = mix(pow(f, 2.2), pow(f, 0.9) * 0.55, uSoft);
  float rush = 0.62 + 0.38 * sin(vUv.y * 46.0 - uTime * 34.0 + sin(vUv.x * 18.85 + uTime * 9.0) * 1.6);
  float streak = 0.75 + 0.25 * sin(vUv.x * 37.7 + vUv.y * 9.0 - uTime * 21.0);
  float ends = smoothstep(0.0, 0.05, vUv.y) * (1.0 - 0.35 * smoothstep(0.85, 1.0, vUv.y));
  float a = uOpacity * core * mix(rush * streak, 1.0, uSoft * 0.7) * ends;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), core * core * (1.0 - uSoft)) * a, 1.0);
}`;
const ORB_FRAG = /* glsl */`uniform float uTime, uOpacity; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN, vV;
void main() { float f = abs(dot(normalize(vN), normalize(vV))); float a = uOpacity * (pow(f, 3.0) + 0.35 * pow(f, 0.8)) * (0.85 + 0.15 * sin(uTime * 40.0 + vUv.y * 20.0)); gl_FragColor = vec4(mix(uColor, vec3(1.0), pow(f, 4.0)) * a, 1.0); }`;
// 2026-11-16 (feedback: the armored pumpkin should feel more powerful): an aura around it. Bright at the rim of the sphere as
// seen, with tongues of energy crawling up it; its colour follows the layer that is showing.
const AURA_FRAG = /* glsl */`uniform float uTime, uOpacity; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN, vV;
void main() {
  float f = abs(dot(normalize(vN), normalize(vV))), rim = pow(1.0 - f, 1.6);
  float lick = 0.55 + 0.45 * sin(vUv.y * 22.0 - uTime * 7.0 + sin(vUv.x * 25.13 + uTime * 2.3) * 2.2);
  float a = uOpacity * (rim * (0.55 + 0.45 * lick) + 0.06);
  gl_FragColor = vec4(mix(uColor, vec3(1.0), rim * rim * 0.5) * a, 1.0);
}`;
/** aura and mote colour per stage showing: armor (toxic green), cracked rind (orange), charred husk (ember red), bare core (bright green) */
export const AURA_COLORS = [0x4dff6a, 0xff9a2a, 0xff5a2a, 0x9dffb0];
const MOTES = 48;
const mat = (frag, extra = {}) => new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0x8fe9ff) }, ...extra }, vertexShader: BEAM_VERT, fragmentShader: frag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false });

export class ArmoredFx {
  constructor(scene) {
    const n = ARMORED.hits * 2;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const cv = document.createElement('canvas'); cv.width = cv.height = 32; { const c = cv.getContext('2d'), gr = c.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, 32, 32); }
    const dot = new THREE.CanvasTexture(cv); // a soft round dot (4 kB)
    this.pips = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.035, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false }));
    this.pips.name = 'WaveChargePips'; this.pips.frustumCulled = false; this.pips.visible = false; this.pips.renderOrder = 20; scene.add(this.pips);
    const bg = new THREE.CylinderGeometry(1, 0.6, 1, 20, 1, true); bg.translate(0, 0.5, 0); // from the palms (y 0) to the target (y 1); it widens toward the hands' end as seen from behind it
    const mk = (geo, m, name, order) => { const o = new THREE.Mesh(geo, m); o.name = name; o.frustumCulled = false; o.visible = false; o.renderOrder = order; scene.add(o); return o; };
    this.beam = mk(bg, mat(BEAM_FRAG, { uSoft: { value: 0 } }), 'EnergyWaveBeam', 19);
    this.glow = mk(bg, mat(BEAM_FRAG, { uSoft: { value: 1 } }), 'EnergyWaveGlow', 18);
    const sg = new THREE.SphereGeometry(1, 20, 14);
    this.orbA = mk(sg, mat(ORB_FRAG), 'EnergyWaveOrbPalms', 21); this.orbB = mk(sg, mat(ORB_FRAG), 'EnergyWaveOrbTarget', 21);
    this.parts = [this.beam, this.glow, this.orbA, this.orbB];
    // the armored pumpkin's own aura: a shell around it and motes of energy circling it (2 draw calls while it is out)
    this.aura = mk(sg, mat(AURA_FRAG), 'ArmoredAura', 17); this.aura.material.side = THREE.BackSide;
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
    mg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
    this.motes = new THREE.Points(mg, new THREE.PointsMaterial({ size: 0.09, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false }));
    this.motes.name = 'ArmoredMotes'; this.motes.frustumCulled = false; this.motes.visible = false; this.motes.renderOrder = 18; scene.add(this.motes);
    this._seed = Array.from({ length: MOTES }, (_, i) => ({ a: (i / MOTES) * Math.PI * 2 * 3.0, tilt: (i % 3) * 1.05 - 0.6, sp: 1.6 + (i % 5) * 0.35, r: 1.12 + (i % 4) * 0.09, up: (i % 7) / 7 }));
    this._auraCol = new THREE.Color(AURA_COLORS[0]); this._auraT = 0; this._auraKick = 0;
    this.beamT = -1; this.beamLife = 0.5; this.sustain = false; this._t = 0; this._from = new THREE.Vector3(); this._to = new THREE.Vector3();
  }
  /**
   * The aura around the armored pumpkin. on = it is out; radius = its current half size; stage = the layer showing;
   * pulse 0 … 1 = the beat (the aura breathes with it). kick() makes it flare (a layer broke, it landed).
   */
  setAura(on, pos, radius = 1, stage = 0, dt = 0, pulse = 0) {
    this.aura.visible = this.motes.visible = !!on; if (!on) return;
    this._auraT += dt; this._auraKick = Math.max(0, this._auraKick - dt / 0.35);
    const t = this._auraT, k = this._auraKick, col = this._auraCol;
    col.lerp(_c.setHex(AURA_COLORS[Math.min(AURA_COLORS.length - 1, stage)]), Math.min(1, dt * 8));
    this.aura.position.copy(pos); this.aura.scale.setScalar(radius * (1.22 + 0.06 * pulse + 0.25 * k));
    const u = this.aura.material.uniforms; u.uTime.value = t; u.uColor.value.copy(col); u.uOpacity.value = 0.55 + 0.25 * pulse + 0.6 * k;
    const P = this.motes.geometry.attributes.position, C = this.motes.geometry.attributes.color;
    for (let i = 0; i < MOTES; i++) { // three tilted rings of motes circling it, some drifting upward like embers
      const s = this._seed[i], ang = s.a + t * s.sp, r = radius * s.r * (1 + 0.3 * k), y = Math.sin(ang * 0.5 + s.up * 6.28) * 0.25;
      const cx = Math.cos(ang) * r, cz = Math.sin(ang) * r, ct = Math.cos(s.tilt), st = Math.sin(s.tilt);
      const rise = ((t * 0.35 + s.up) % 1) * (i % 4 === 0 ? radius * 1.6 : 0);
      P.setXYZ(i, pos.x + cx, pos.y + cz * st + y * radius + rise, pos.z + cz * ct);
      const v = (0.6 + 0.4 * Math.sin(t * 9 + i)) * (1 + 1.5 * k) * (i % 4 === 0 ? 1 - ((t * 0.35 + s.up) % 1) : 1);
      C.setXYZ(i, col.r * v, col.g * v, col.b * v);
    }
    P.needsUpdate = true; C.needsUpdate = true;
    this.motes.material.size = 0.09 * (1 + 0.5 * k) * Math.max(0.5, radius);
  }
  kick(amount = 1) { this._auraKick = Math.max(this._auraKick, amount); }
  /** lead-in warm-up: everything drawn once out of sight */
  prewarm(pos, on) {
    this.aura.visible = this.motes.visible = on; if (on) { this.aura.position.copy(pos); this.aura.scale.setScalar(0.01); this.aura.material.uniforms.uOpacity.value = 0.01; const mp = this.motes.geometry.attributes.position; for (let i = 0; i < MOTES; i++) mp.setXYZ(i, pos.x, pos.y, pos.z); mp.needsUpdate = true; }
    this.pips.visible = on; for (const o of this.parts) { o.visible = on; if (on) { o.position.copy(pos); o.scale.setScalar(0.01); o.material.uniforms.uOpacity.value = 0.01; } else o.material.uniforms.uOpacity.value = 0; }
    if (on) { const p = this.pips.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setXYZ(i, pos.x, pos.y, pos.z); p.needsUpdate = true; } else { this.beamT = -1; this.sustain = false; }
  }
  /**
   * charge: pips lit (0 … hits), the same on both hands; hands: [{ pos: Vector3, valid }] left, right; glow 0 … 1 = the palms
   * approaching (the lit pips grow). show = false hides them.
   */
  setCharge(show, charge, hands, camera, glow = 0) {
    this.pips.visible = !!show; if (!show) return;
    const P = this.pips.geometry.attributes.position, C = this.pips.geometry.attributes.color, H = ARMORED.hits;
    const right = _a.set(1, 0, 0).applyQuaternion(camera.quaternion); // the row of pips lies across the view
    for (let h = 0; h < 2; h++) for (let i = 0; i < H; i++) {
      const k = h * H + i, hand = hands[h];
      if (!hand?.valid) { P.setXYZ(k, 0, -9999, 0); continue; }
      _b.copy(hand.pos).addScaledVector(_up, 0.07).addScaledVector(right, (i - (H - 1) / 2) * 0.03);
      P.setXYZ(k, _b.x, _b.y, _b.z);
      const lit = i < charge, full = charge >= H, v = lit ? (full ? 2.2 + 1.2 * glow : 1.0 + 0.5 * glow) : 0.12;
      C.setXYZ(k, (lit ? 0.6 : 0.25) * v, (lit ? 0.95 : 0.4) * v, v); // cyan-white when lit, a faint blue dot when not
    }
    P.needsUpdate = true; C.needsUpdate = true;
    this.pips.material.size = (charge >= H ? 0.06 : 0.035) * (1 + 0.8 * glow); // fully charged: bigger, brighter dots (ready for the wave)
  }
  _place() {
    const d = _a.subVectors(this._to, this._from), len = d.length(); if (len < 1e-3) return;
    d.normalize(); this._len = len;
    for (const o of [this.beam, this.glow]) { o.position.copy(this._from); o.quaternion.setFromUnitVectors(_up, d); }
    this.orbA.position.copy(this._from); this.orbB.position.copy(this._to);
  }
  /** one shot of the beam: from → to, full = every layer was off (a thin, dim one otherwise) */
  fire(from, to, full = true) {
    this._from.copy(from); this._to.copy(to); this._place();
    this._w = full ? 0.2 : 0.07; this._peak = full ? 1.0 : 0.35; // radius at the target (0.6 of it at the palms): the full beam fills the centre lane's width there this.beamLife = full ? 0.75 : 0.4;
    const col = full ? 0x8fe9ff : 0x6fb6d8; for (const o of this.parts) { o.material.uniforms.uColor.value.setHex(col); o.visible = true; }
    this.beamT = 0; this.sustain = false; this._orb = 0; this._apply(0);
  }
  /** a beam that stays on (the blast that burns the armored pumpkin down): call aim() each frame, release() to let it fade */
  hold(from, to, full = true, targetRadius = 0) { this.fire(from, to, full); this.sustain = true; this._orb = targetRadius; }
  aim(from, to) { this._from.copy(from); this._to.copy(to); this._place(); }
  release() { if (this.sustain) { this.sustain = false; this.beamT = Math.max(this.beamT, 0.12 * this.beamLife); } }
  /** strength 0 … 1 → sizes and opacities of the four parts */
  _apply(s) {
    const t = this._t, w = this._w * (1.0 + 0.1 * Math.sin(t * 38) + 0.05 * Math.sin(t * 61)), len = this._len || 1;
    this.beam.scale.set(w, len, w); this.glow.scale.set(w * 2.0, len, w * 2.0);
    this.orbA.scale.setScalar(w * (0.55 + 0.08 * Math.sin(t * 47)) * (0.4 + 0.6 * s));  // a small ball of light at the palms (it must not fill the view)
    this.orbB.scale.setScalar(Math.max(w * 2.4, (this._orb || 0) * 1.15) * (1 + 0.12 * Math.sin(t * 29)) * (0.4 + 0.6 * s));   // a big one swallowing the pumpkin
    this.beam.material.uniforms.uOpacity.value = this._peak * s; this.glow.material.uniforms.uOpacity.value = this._peak * 0.45 * s;
    this.orbA.material.uniforms.uOpacity.value = this._peak * 0.6 * s; this.orbB.material.uniforms.uOpacity.value = this._peak * s;
    for (const o of this.parts) o.material.uniforms.uTime.value = t;
  }
  update(dt) {
    if (this.beamT < 0) return;
    this.beamT += dt; this._t += dt;
    const k = this.beamT / this.beamLife, rise = 0.12;
    if (this.sustain && k > rise) { this._apply(1); return; } // held at full strength
    if (k >= 1) { for (const o of this.parts) { o.visible = false; o.material.uniforms.uOpacity.value = 0; } this.beamT = -1; return; }
    this._apply(k < rise ? k / rise : 1 - (k - rise) / (1 - rise));
  }
  clear() { this.aura.visible = this.motes.visible = false; this.sustain = false; this.pips.visible = false; for (const o of this.parts) { o.visible = false; o.material.uniforms.uOpacity.value = 0; } this.beamT = -1; }
}
