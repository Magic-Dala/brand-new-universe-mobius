// v0.30 cheap VFX "light pulses": a big effect (blue light bomb, pumpkin fireball, roof explosion) brightens the nearby
// city / factory surfaces for a moment through two shared uniforms — no real lights, no shader recompiles, no
// allocation per frame. Shaders that want it include FX_LIGHT_GLSL and add fxLight(worldPos, normal) * albedo.
//   pulse(pos, color, intensity = 1, radius = 12, dur = 0.5)   → slot index (2 slots, the weakest / oldest is reused)
//   update(dt)  (called once per frame by Effects.update)          shift(dx, dz)  (origin rebase)
import * as THREE from 'three';

export const FX_LIGHT = {
  uFxP0: { value: new THREE.Vector4(0, -1e5, 0, 1) }, uFxC0: { value: new THREE.Vector3() },
  uFxP1: { value: new THREE.Vector4(0, -1e5, 0, 1) }, uFxC1: { value: new THREE.Vector3() },
  enabled: true,
};
const slots = [0, 1].map((i) => ({ p: FX_LIGHT[`uFxP${i}`].value, c: FX_LIGHT[`uFxC${i}`].value, col: new THREE.Color(), t: 9, dur: 1, k: 0, I: 0 }));
const _c = new THREE.Color();

export function pulse(pos, color = 0x7fe8ff, intensity = 1, radius = 12, dur = 0.5) {
  if (!FX_LIGHT.enabled) return -1;
  let s = slots[0];
  for (const q of slots) if (q.k * q.I < s.k * s.I) s = q;
  s.p.set(pos.x, pos.y, pos.z, radius); s.col.set(color); s.I = intensity; s.t = 0; s.dur = Math.max(0.05, dur);
  return slots.indexOf(s);
}
export function update(dt) {
  for (const s of slots) {
    if (s.t > s.dur) { if (s.k) { s.k = 0; s.c.set(0, 0, 0); s.p.y = -1e5; } continue; }
    s.t += dt;
    const a = Math.min(1, s.t / 0.04), d = Math.max(0, 1 - s.t / s.dur); // 40 ms attack, then a smooth fall-off
    s.k = a * d * d;
    _c.copy(s.col).multiplyScalar(s.k * s.I); s.c.set(_c.r, _c.g, _c.b);
  }
}
export function shift(dx, dz) { for (const s of slots) { s.p.x += dx; s.p.z += dz; } }
export function clear() { for (const s of slots) { s.t = 9; s.k = 0; s.c.set(0, 0, 0); s.p.y = -1e5; } }

/** GLSL: uniforms + fxLight(worldPos, normal) → additive light (multiply by the albedo yourself). */
export const FX_LIGHT_GLSL = /* glsl */`
uniform vec4 uFxP0, uFxP1; uniform vec3 uFxC0, uFxC1;
vec3 fxLightOne(vec4 P, vec3 C, vec3 wp, vec3 n) {
  vec3 d = P.xyz - wp; float r = length(d);
  float fall = 1.0 - smoothstep(0.0, P.w, r);
  return C * fall * fall * (0.35 + 0.65 * max(dot(n, d / max(r, 1e-3)), 0.0));
}
vec3 fxLight(vec3 wp, vec3 n) { return fxLightOne(uFxP0, uFxC0, wp, n) + fxLightOne(uFxP1, uFxC1, wp, n); }`;
