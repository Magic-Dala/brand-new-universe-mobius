// v0.44 palm-facing light-web shield: energy, swept blocking of Green Maniac's pumpkin bombs, visuals + feedback.
// The gesture itself (which hand holds a shield) is decided by the InputHub (src/input/palmShield.js + hub.js);
// this module turns it into a world-space disc in front of the palm and answers ChaseBombs' question
// "does this pumpkin's path meet a shield?" (ChaseBombs.blocker → tryBlock). Defensive only: a blocked pumpkin
// bursts on the shield — no reflection, no damage to Green Maniac, no score. Tunables: SHIELD (src/data/handCombat.js).
// Nothing here allocates per frame (two reusable discs, scratch vectors).
import * as THREE from 'three';
import { SHIELD } from '../data/handCombat.js';
import { audio } from '../core/audio.js';

const HANDS = ['left', 'right'];
const _r0 = new THREE.Vector3(), _r1 = new THREE.Vector3(), _d = new THREE.Vector3(), _h = new THREE.Vector3(), _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _hit = { front: 0, point: new THREE.Vector3() };
const PUMPKIN_RADIUS = 0.17; // m at model scale 1 (≈ 0.34 m across)

/**
 * Does a pumpkin moving prev → pos meet a shield disc moving (c0, n0) → (c1, n1)? Swept in the shield's own frame, so
 * neither a fast pumpkin nor a fast-moving player can tunnel through it. Pure.
 *   - only from the FRONT (the side the palm faces): a pumpkin that starts behind the disc is never blocked;
 *   - only when its path (straight, in the shield's frame) crosses the disc within `catchRadius` of the centre,
 *     closing at no more than S.maxIncidenceDeg from the palm normal;
 *   - reported from S.standoff metres in front of the disc (out.front = signed distance in front; ≤ 0 = it crossed).
 * @returns {boolean} out = { front, point (world, on the disc) }
 */
export function shieldIntercept(prev, pos, c0, c1, n0, n1, catchRadius, S = SHIELD, out = _hit) {
  _r0.copy(prev).sub(c0); _r1.copy(pos).sub(c1);
  const a0 = _r0.dot(n0), a1 = _r1.dot(n1);
  if (a0 <= 0 || a1 > S.standoff) return false; // came from behind / still far out in front
  _d.copy(_r1).sub(_r0); const L = _d.length();
  if (L < 1e-9) return false;
  const closing = -_d.dot(n1) / L; // cos of the incidence angle (1 = straight into the palm)
  if (closing < Math.cos(S.maxIncidenceDeg * Math.PI / 180)) return false; // moving away / grazing past
  const s = a1 / closing; // distance still to go along the path to the disc's plane (negative: already through)
  _h.copy(_r1).addScaledVector(_d, s / L);
  _h.addScaledVector(n1, -_h.dot(n1)); // (on the plane)
  if (_h.length() > catchRadius) return false;
  out.front = a1; out.point.copy(_h).add(c1);
  return true;
}

/** One energy pool with drain while raised, a cost per block, delayed recharge and an overload lock. Pure. */
export class ShieldEnergy {
  constructor(cfg = SHIELD) { this.cfg = cfg; this.reset(); }
  reset() { this.value = this.cfg.energyMax; this.idleT = 99; this.broken = false; this.lockT = 0; }
  get frac() { return this.value / this.cfg.energyMax; }
  /** May a shield be raised right now? */
  get canRaise() { return !this.broken && this.value >= this.cfg.minRaise; }
  /** @param nActive raised shields (0–2). @returns 'break' when it just ran empty. */
  tick(dt, nActive) {
    const C = this.cfg;
    if (nActive > 0) {
      this.idleT = 0; this.value -= C.holdDrain * nActive * dt;
      return this.value <= 0 ? this._break() : null;
    }
    this.idleT += dt; if (this.lockT > 0) this.lockT -= dt;
    if (this.idleT >= C.regenDelay) this.value = Math.min(C.energyMax, this.value + C.regen * dt);
    if (this.broken && this.lockT <= 0 && this.value >= C.rearmEnergy) this.broken = false;
    return null;
  }
  /** A block. @returns 'break' when that emptied it (the block itself still counts). */
  hit(cost) { this.value -= cost; this.idleT = 0; return this.value <= 0 ? this._break() : null; }
  _break() { this.value = 0; this.broken = true; this.lockT = this.cfg.breakLock; this.idleT = 0; return 'break'; }
}

const VERT = 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const FRAG = `
uniform float uTime, uOn, uEnergy, uHit; uniform vec2 uHitPos; varying vec2 vP;
void main(){
  float r = length(vP); if (r > 1.0) discard;
  float a = atan(vP.y, vP.x);
  float spokes = smoothstep(0.985, 1.0, abs(cos(a * 6.0))) * smoothstep(0.08, 0.3, r);
  float rings = smoothstep(0.972, 1.0, abs(sin((r * 4.0 - uTime * 0.25) * 3.14159))); // thin strands: the view through the shield stays clear
  float web = max(spokes, rings) * smoothstep(1.0, 0.9, r);
  float rim = smoothstep(0.86, 0.94, r);
  float lit = step((a + 3.14159) / 6.28318, uEnergy); // the rim arc = the energy left
  float ripple = uHit * (1.0 - smoothstep(0.0, 0.14, abs(length(vP - uHitPos) - (1.0 - uHit) * 1.3)));
  float low = 1.0 - smoothstep(0.15, 0.4, uEnergy);
  vec3 col = mix(vec3(0.13, 0.83, 1.0), vec3(0.72, 0.97, 1.0), clamp(web + ripple, 0.0, 1.0));
  col = mix(col, vec3(1.0, 0.5, 0.36), low * (0.55 + 0.45 * sin(uTime * 9.0)) * 0.7);
  float alpha = 0.035 * (1.0 - r) + web * 0.32 + rim * mix(0.2, 0.95, lit) + ripple * 1.1 + uHit * 0.22;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0) * uOn);
}`;

export class LightShield {
  constructor(app, cfg = SHIELD) {
    this.app = app; this.cfg = cfg;
    this.energy = new ShieldEnergy(cfg);
    this.root = new THREE.Group(); this.root.name = 'lightShield'; app.scene.add(this.root);
    const geo = new THREE.CircleGeometry(1, 48);
    this.hands = {};
    for (const h of HANDS) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uOn: { value: 0 }, uEnergy: { value: 1 }, uHit: { value: 0 }, uHitPos: { value: new THREE.Vector2() } },
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
      });
      const mesh = new THREE.Mesh(geo, mat); mesh.visible = true; mesh.scale.setScalar(1e-3); mesh.frustumCulled = false; // (drawn fully transparent until the first update(): the program is compiled on the title frames, not on the first block)
      mesh.renderOrder = 34; this.root.add(mesh);
      this.hands[h] = { on: false, blocking: false, k: 0, pos: new THREE.Vector3(), normal: new THREE.Vector3(0, 0, -1), prevPos: new THREE.Vector3(), prevNormal: new THREE.Vector3(0, 0, -1), mesh, mat };
    }
    this.time = 0; this._popT = -9;
    this.stats = { raised: 0, blocked: 0, heavyBlocked: 0, breaks: 0 };
  }
  get anyActive() { return this.hands.left.on || this.hands.right.on; }
  /** New run / scene change: full energy, shields down (silently), detectors re-armed. */
  reset() {
    this.energy.reset();
    const hub = this.app.hub;
    for (const h of HANDS) { const H = this.hands[h]; H.on = false; H.blocking = false; H.k = 0; H.mesh.visible = false; H.mat.uniforms.uHit.value = 0; hub?.shieldDet?.[h]?.reset(); }
    if (hub?.ctx) hub.ctx.shieldReady = true;
    this.stats.raised = this.stats.blocked = this.stats.heavyBlocked = this.stats.breaks = 0;
  }
  /**
   * Once per frame, right after InputHub.update() (same rig transform as the gestures, before the bombs move).
   * Energy only runs while the game allows shields (hub.ctx.shield): a pause / menu neither drains nor recharges it.
   */
  update(dt, t) {
    const hub = this.app.hub, enabled = !!hub.ctx.shield;
    this.time += dt;
    let n = 0;
    for (const h of HANDS) {
      const H = this.hands[h], det = hub.shieldDet[h], up = enabled && det.active;
      if (up) {
        if (H.on) { H.prevPos.copy(H.pos); H.prevNormal.copy(H.normal); }
        hub.shieldPose(h, H.pos, H.normal); // (an untracked gap keeps the last pose; it cannot block then)
        if (!H.on) { H.on = true; H.prevPos.copy(H.pos); H.prevNormal.copy(H.normal); this.stats.raised++; audio.play('shieldOn'); hub.haptic?.(h, 0.3, 30); }
        H.blocking = det.blocking;
        n++;
      } else if (H.on) { H.on = false; H.blocking = false; if (enabled) audio.play('shieldOff'); }
    }
    if (enabled && this.energy.tick(dt, n) === 'break') this._overload();
    hub.ctx.shieldReady = this.energy.canRaise; // the hub's gate for the next frame
    // visuals
    const e = this.energy.frac;
    for (const h of HANDS) {
      const H = this.hands[h], u = H.mat.uniforms;
      H.k += ((H.on ? 1 : 0) - H.k) * Math.min(1, dt * (H.on ? 14 : 9));
      if (u.uHit.value > 0) u.uHit.value = Math.max(0, u.uHit.value - dt * 2.6);
      const vis = H.k > 0.02; H.mesh.visible = vis;
      if (!vis) continue;
      u.uTime.value = this.time; u.uOn.value = H.k; u.uEnergy.value = e;
      H.mesh.position.copy(H.pos); H.mesh.lookAt(_p.copy(H.pos).add(H.normal));
      H.mesh.scale.setScalar(this.cfg.radius * (0.55 + 0.45 * H.k * (2 - H.k)));
    }
    void t;
  }
  _overload() {
    const app = this.app, hub = app.hub;
    this.stats.breaks++; hub.ctx.shieldReady = false;
    for (const h of HANDS) {
      const H = this.hands[h];
      if (H.on) { app.fx.boom?.(H.pos, { color: 0x5fd8ff, size: 0.5, life: 0.4 }); H.on = false; H.blocking = false; }
      hub.shieldDet[h].drop(true); // the hand must leave the pose before the next shield
    }
    audio.play('shieldBreak');
    const at = _p.copy(this.hands.left.pos).lerp(this.hands.right.pos, this.hands.left.k > 0.02 ? (this.hands.right.k > 0.02 ? 0.5 : 0) : 1);
    app.fx.popup?.('shield.break', at.clone().setY(at.y + 0.3), '#ff9a7a');
  }
  /**
   * ChaseBombs asks for every flying pumpkin, every frame, before its own proximity / wall tests.
   * @returns 0 = no shield in its way, 1 = its path meets a shield (hold the proximity fuse), 2 = blocked now (consumed).
   */
  tryBlock(bombs, it) {
    const S = this.cfg;
    let held = 0;
    for (const h of HANDS) {
      const H = this.hands[h];
      if (!H.on || !H.blocking) continue;
      const rad = PUMPKIN_RADIUS * (it.scale ?? bombs.cfg.scale ?? 1);
      if (!shieldIntercept(it.prev, it.pos, H.prevPos, H.pos, H.prevNormal, H.normal, S.radius + rad * S.pumpkinPad, S, _hit)) continue;
      if (_hit.front > rad) { held = 1; continue; } // on its way in: bursts when it touches the disc
      // ---- contact: processed exactly once (the pumpkin is recycled here)
      const heavy = it.kind === 'giant';
      const u = H.mat.uniforms; u.uHit.value = 1;
      _p.copy(_hit.point).sub(H.pos).applyQuaternion(_q.copy(H.mesh.quaternion).invert()).divideScalar(S.radius); u.uHitPos.value.set(_p.x, _p.y); // ripple centre in disc coordinates
      it.pos.copy(_hit.point).addScaledVector(H.normal, Math.min(rad, 0.2));
      if (!bombs.blockAt(it, it.pos)) return 0;
      this.stats.blocked++; if (heavy) this.stats.heavyBlocked++;
      audio.play('shieldHit'); this.app.hub.haptic?.(h, heavy ? 0.9 : 0.6, heavy ? 110 : 60);
      if (this.time - this._popT > 0.35) { this._popT = this.time; this.app.fx.popup?.('shield.block', _hit.point.clone().addScaledVector(H.normal, 0.25).setY(_hit.point.y + 0.3), '#7ef0ff'); }
      if (this.energy.hit(heavy ? S.heavyCost : S.blockCost) === 'break') this._overload();
      return 2;
    }
    return held;
  }
  /** Floating-origin rebase: the discs (and their previous poses) move with the world. */
  shift(dx, dz) { for (const h of HANDS) { const H = this.hands[h]; H.pos.x += dx; H.pos.z += dz; H.prevPos.x += dx; H.prevPos.z += dz; } }
}
