// Procedural tail for Green Maniac (綠狂魔): a spring-damper chain on the Tail_01..Tail_NN bones.
// Mixamo clips carry no tail tracks, so the tail stays in its rest pose relative to the hips; this module
// makes it lag / swing with the body (turns, banking, acceleration of the Green Bat Jet, the throw twist).
//
// Per segment (root → tip), in WORLD space, every frame AFTER mixer.update():
//   rest direction  = parent's current (already simulated) world rotation × the bone's rest local rotation
//   target tip      = bone world position + rest direction × segment length
//   tip spring      : a = k_i (target − tip) − c_i (tipVel − targetVel) + gravity   (relative damping → flying at a
//                     constant 26 m/s does NOT stream the tail out; only accelerations / turns swing it)
//   then the tip is put back at the segment length, clamped to maxAngle from the rest direction, and the bone is
//   rotated by the shortest arc rest dir → simulated dir. Small equal sub-steps (frame-rate independent), dt clamped.
// Stiffness / damping fall off linearly from root to tip (the tip is the floppiest). Cost: 8 bones, no allocations.
import * as THREE from 'three';

/** Tunables (shared defaults; pass overrides to new TailSpring(bones, { ... })). */
export const TAIL_SPRING_DEFAULTS = {
  stiffRoot: 260, stiffTip: 70, // 1/s² spring toward the animated rest pose (root → tip)
  dampRoot: 22, dampTip: 9, // 1/s relative-velocity damping (root → tip)
  gravity: 1.2, // m/s² downward pull on the tips (0 = off). Small: the rest pose already lies on the ground
  maxAngle: 1.0, // rad, max deviation of each segment from its rest direction
  substep: 1 / 120, // s, max integration step (each frame is split into equal sub-steps ≤ this)
  maxDt: 1 / 20, // s, larger frame gaps are clamped (hitches / tab switches)
  teleport: 1.5, // m, a target jump bigger than this in one frame resets the chain (re-parenting, respawn)
};

const _pw = new THREE.Quaternion(), _rw = new THREE.Quaternion(), _q = new THREE.Quaternion(), _inv = new THREE.Quaternion();
const _bp = new THREE.Vector3(), _dir = new THREE.Vector3(), _rd = new THREE.Vector3(), _tgt = new THREE.Vector3(), _a = new THREE.Vector3();
const _s = new THREE.Vector3(), _ps = new THREE.Vector3(), _m = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0);

export class TailSpring {
  /**
   * bones: ordered root → tip (each the child of the previous; bone +Y points down the chain, as exported).
   * The first bone's parent (e.g. mixamorigHips) is driven by the AnimationMixer.
   */
  constructor(bones, params = {}) {
    this.p = { ...TAIL_SPRING_DEFAULTS, ...params };
    this.enabled = true;
    const n = bones.length;
    this.segs = bones.map((b, i) => {
      const next = bones[i + 1];
      // segment length in the bone's local units (the last bone reuses the previous length × 0.8)
      const len = next ? next.position.length() : bones[i].position.length() * 0.8;
      const k = n > 1 ? i / (n - 1) : 0;
      return {
        bone: b, restQ: b.quaternion.clone(), len,
        stiff: THREE.MathUtils.lerp(this.p.stiffRoot, this.p.stiffTip, k),
        damp: THREE.MathUtils.lerp(this.p.dampRoot, this.p.dampTip, k),
        tip: new THREE.Vector3(), vel: new THREE.Vector3(), tv: new THREE.Vector3(), tgt: new THREE.Vector3(), tgtPrev: new THREE.Vector3(),
      };
    });
    this.primed = false;
  }
  /** Re-snap the chain to the animated pose (call after teleports / re-parenting; done automatically on big jumps). */
  reset() { this.primed = false; }

  /** Call once per frame, after mixer.update(dt). */
  update(dt) {
    if (!this.enabled || !this.segs.length) return;
    const P = this.p;
    dt = Math.min(Math.max(dt, 0), P.maxDt);
    const parent = this.segs[0].bone.parent;
    parent.updateWorldMatrix(true, false); // ancestors + hips (just posed by the mixer)
    // world scale (uniform) → segment lengths in metres
    _m.copy(parent.matrixWorld); _s.setFromMatrixScale(_m);
    const ws = (_s.x + _s.y + _s.z) / 3;
    let jump = false;
    // pass 1: targets from the rest pose under the CURRENT parent chain (rest rotations restored first)
    for (const s of this.segs) s.bone.quaternion.copy(s.restQ);
    this.segs[0].bone.updateWorldMatrix(false, true);
    for (const s of this.segs) {
      s.bone.getWorldPosition(_bp); s.bone.getWorldQuaternion(_rw);
      s.tgtPrev.copy(s.tgt);
      s.tgt.copy(Y).applyQuaternion(_rw).multiplyScalar(s.len * ws).add(_bp);
      if (this.primed && s.tgt.distanceToSquared(s.tgtPrev) > P.teleport * P.teleport) jump = true;
    }
    if (!this.primed || jump || dt <= 0) {
      for (const s of this.segs) { s.tip.copy(s.tgt); s.vel.set(0, 0, 0); s.tv.set(0, 0, 0); s.tgtPrev.copy(s.tgt); }
      this.primed = true;
      if (dt <= 0 || jump) return;
    }
    // pass 2: integrate tips (fixed sub-steps; the target moves linearly across the frame)
    const steps = Math.min(8, Math.ceil(dt / P.substep)), h = dt / steps, invDt = 1 / dt; // h ≤ substep
    for (const s of this.segs) {
      _a.subVectors(s.tgt, s.tgtPrev).multiplyScalar(invDt); s.tv.copy(_a); // target velocity (world, m/s)
      for (let k = 0; k < steps; k++) {
        const u = (k + 1) / steps; _tgt.lerpVectors(s.tgtPrev, s.tgt, u);
        _ps.subVectors(_tgt, s.tip).multiplyScalar(s.stiff); // spring
        _ps.addScaledVector(_dir.subVectors(s.vel, _a), -s.damp); // relative damping
        _ps.y -= P.gravity;
        s.vel.addScaledVector(_ps, h);
        s.tip.addScaledVector(s.vel, h);
      }
    }
    // pass 3: orient bones root → tip toward their simulated tips (length + angle constraints)
    for (const s of this.segs) {
      const b = s.bone;
      b.parent.getWorldQuaternion(_pw);
      _rw.copy(_pw).multiply(s.restQ); // rest world rotation under the (already simulated) parent
      b.getWorldPosition(_bp);
      _rd.copy(Y).applyQuaternion(_rw); // rest direction
      _dir.subVectors(s.tip, _bp);
      const L = _dir.length();
      if (L < 1e-6) { b.quaternion.copy(s.restQ); b.updateMatrixWorld(true); continue; }
      _dir.multiplyScalar(1 / L);
      const ang = Math.acos(THREE.MathUtils.clamp(_rd.dot(_dir), -1, 1));
      if (ang > P.maxAngle) { // clamp: rotate rest dir toward dir by maxAngle
        _a.crossVectors(_rd, _dir); if (_a.lengthSq() < 1e-12) _a.set(1, 0, 0); _a.normalize();
        _dir.copy(_rd).applyAxisAngle(_a, P.maxAngle);
      }
      s.tip.copy(_bp).addScaledVector(_dir, s.len * ws); // length constraint (keeps the chain from stretching)
      s.vel.addScaledVector(_dir, -_a.subVectors(s.vel, s.tv).dot(_dir) * 0.9); // drop most of the radial (stretch) relative velocity
      _q.setFromUnitVectors(_rd, _dir).multiply(_rw); // world rotation
      b.quaternion.copy(_inv.copy(_pw).invert().multiply(_q));
      b.updateMatrixWorld(true);
    }
  }
}
