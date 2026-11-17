// Cheap billboard particles: ONE draw call per system (instanced quads facing the camera in
// view space — no per-frame camera quaternion work). Used for smoke, dust, sparks, embers.
import * as THREE from 'three';
import { canvasTexture } from './toon.js';

let _soft = null;
/** Soft round puff texture (shared). */
export function softTexture() {
  if (_soft) return _soft;
  _soft = canvasTexture(64, 64, (ctx, S) => {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  });
  return _soft;
}

export class Billboards {
  /**
   * @param {number} n max particles
   * @param {object} o { color, additive, gravity, drag, texture, fog }
   */
  constructor(n, { color = 0xffffff, additive = false, gravity = 0, drag = 0.4, texture = softTexture(), name = 'particles' } = {}) {
    this.n = n; this.gravity = gravity; this.drag = drag;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.attributes.position = base.attributes.position; g.attributes.uv = base.attributes.uv;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3); this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(n), 1); this.aSize.setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(n), 1); this.aAlpha.setUsage(THREE.DynamicDrawUsage);
    this.aSpin = new THREE.InstancedBufferAttribute(new Float32Array(n), 1); this.aSpin.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', this.aPos); g.setAttribute('aSize', this.aSize); g.setAttribute('aAlpha', this.aAlpha); g.setAttribute('aSpin', this.aSpin);
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, color: { value: new THREE.Color(color) } },
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false,
      vertexShader: `attribute vec3 aPos; attribute float aSize, aAlpha, aSpin; varying vec2 vUv; varying float vA;
        void main(){ vUv = uv; vA = aAlpha; float c = cos(aSpin), s = sin(aSpin);
          vec4 mv = modelViewMatrix * vec4(aPos, 1.0); mv.xy += mat2(c, s, -s, c) * position.xy * aSize;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 color; varying vec2 vUv; varying float vA;
        void main(){ vec4 t = texture2D(map, vUv); gl_FragColor = vec4(color * t.rgb, t.a * vA); if (gl_FragColor.a < 0.004) discard; }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.name = name; this.mesh.frustumCulled = false; this.mesh.renderOrder = 8; this.mesh.visible = false;
    this.p = []; for (let i = 0; i < n; i++) this.p.push({ on: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 0, life: 1, s0: 1, s1: 1, a: 1, spin: 0, w: 0 });
    this.next = 0;
  }
  /** spawn(pos, vel, { life, size:[s0,s1], alpha, spin }) */
  spawn(pos, vel, { life = 1.5, size = [0.5, 1.5], alpha = 0.8, spin = 0 } = {}) {
    let q = null;
    for (let k = 0; k < this.n; k++) { const c = this.p[(this.next + k) % this.n]; if (!c.on) { q = c; this.next = (this.next + k + 1) % this.n; break; } }
    if (!q) { q = this.p[this.next]; this.next = (this.next + 1) % this.n; } // recycle the oldest slot
    q.on = true; q.pos.copy(pos); q.vel.copy(vel); q.age = 0; q.life = life; q.s0 = size[0]; q.s1 = size[1]; q.a = alpha; q.spin = Math.random() * 6.28; q.w = spin;
    return q;
  }
  clear() { for (const q of this.p) q.on = false; this.mesh.geometry.instanceCount = 0; }
  get active() { let n = 0; for (const q of this.p) if (q.on) n++; return n; }
  update(dt) {
    let n = 0;
    const P = this.aPos.array, S = this.aSize.array, A = this.aAlpha.array, R = this.aSpin.array;
    const k = Math.exp(-this.drag * dt);
    for (const q of this.p) {
      if (!q.on) continue;
      q.age += dt; if (q.age >= q.life) { q.on = false; continue; }
      q.vel.y -= this.gravity * dt; q.vel.multiplyScalar(k); q.pos.addScaledVector(q.vel, dt); q.spin += q.w * dt;
      const t = q.age / q.life;
      P[n * 3] = q.pos.x; P[n * 3 + 1] = q.pos.y; P[n * 3 + 2] = q.pos.z;
      S[n] = q.s0 + (q.s1 - q.s0) * t; A[n] = q.a * Math.min(1, t * 6) * (1 - t) * (1 - t * 0.2); R[n] = q.spin;
      n++;
    }
    this.mesh.geometry.instanceCount = n;
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = this.aSpin.needsUpdate = true;
    this.mesh.visible = n > 0;
  }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); }
}

/** Static camera-facing glows (lamp halos, pumpkin glows): one draw call, gentle shared flicker. */
export class StaticGlows {
  /** items: [{ pos: [x,y,z], size, color: THREE.Color|hex, alpha }] */
  constructor(items, { texture = softTexture(), name = 'glows', hopUniforms = null } = {}) {
    const n = items.length, base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.attributes.position = base.attributes.position; g.attributes.uv = base.attributes.uv;
    const P = new Float32Array(n * 3), S = new Float32Array(n), C = new Float32Array(n * 3), A = new Float32Array(n), F = new Float32Array(n);
    items.forEach((it, i) => { P.set(it.pos, i * 3); S[i] = it.size; const c = new THREE.Color(it.color); C.set([c.r, c.g, c.b], i * 3); A[i] = it.alpha ?? 0.6; F[i] = Math.random() * 6.28; });
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(P, 3)); g.setAttribute('aSize', new THREE.InstancedBufferAttribute(S, 1));
    g.setAttribute('aCol', new THREE.InstancedBufferAttribute(C, 3)); g.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(A, 1)); g.setAttribute('aPh', new THREE.InstancedBufferAttribute(F, 1));
    // v0.48: an item with hop: [x, y, z, size] rides its decorative pumpkin when the hall show makes it hop (hopUniforms from factoryV2; zero without)
    const Hp = new Float32Array(n * 4); items.forEach((it, i) => { if (it.hop) Hp.set([it.hop[0], it.hop[1], it.hop[2], 10 + it.hop[3]], i * 4); });
    g.setAttribute('aHopG', new THREE.InstancedBufferAttribute(Hp, 4));
    g.instanceCount = n;
    const hu = { uShowB: { value: new THREE.Vector4() }, uShowD: { value: new THREE.Vector4() }, uShowE: { value: new THREE.Vector4() }, uCorr: { value: new THREE.Vector3() }, ...(hopUniforms || {}) };
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, uTime: { value: 0 }, uShowB: hu.uShowB, uShowD: hu.uShowD, uShowE: hu.uShowE, uCorr: hu.uCorr }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      vertexShader: `attribute vec3 aPos, aCol; attribute vec4 aHopG; attribute float aSize, aAlpha, aPh; uniform float uTime; uniform vec4 uShowB, uShowD, uShowE; uniform vec3 uCorr; varying vec2 vUv; varying vec3 vC; varying float vA;
        void main(){ vUv = uv; vC = aCol; vA = aAlpha * (0.93 + 0.07 * sin(uTime * 2.3 + aPh) * sin(uTime * 0.7 + aPh * 1.7));
          if (aHopG.w < 5.0 && uShowE.x > 0.0) { // v0.48: lamp halos outside the lane corridor glow stronger while the hall show runs, and swell on the beat
            float mk = 1.0 - (1.0 - smoothstep(uCorr.x, uCorr.x + 0.25, abs(aPos.x))) * step(uCorr.y, aPos.z) * step(aPos.z, uCorr.z);
            vA *= 1.0 + mk * (0.6 * uShowE.x + 2.0 * uShowE.y);
          }
          float hop = 0.0;
          if (aHopG.w > 5.0 && uShowD.w > 0.0) { float u = fract(uShowB.x - uShowB.y) / 0.5; float m = 1.0 - (1.0 - smoothstep(uCorr.x, uCorr.x + 0.25, abs(aHopG.x))) * step(uCorr.y, aHopG.z) * step(aHopG.z, uCorr.z); hop = uShowD.w * (u < 1.0 ? 4.0 * u * (1.0 - u) : 0.0) * m * (aHopG.w - 10.0); }
          vec4 mv = modelViewMatrix * vec4(aPos + vec3(0.0, hop, 0.0), 1.0); mv.xy += position.xy * aSize; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying vec3 vC; varying float vA;
        void main(){ float t = texture2D(map, vUv).a; t = t * t; gl_FragColor = vec4(vC * t * vA, 1.0); }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.name = name; this.mesh.frustumCulled = false; this.mesh.renderOrder = 9;
  }
  update(t) { this.mat.uniforms.uTime.value = t; }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); }
}
