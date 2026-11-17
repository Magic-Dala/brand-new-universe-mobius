// v0.48 energy wave (Arcade only): both hands OPEN, brought together (palms touching, or side by side facing forward).
// 2026-11-15, after the first headset try: the palms no longer have to face forward (only not back at the player),
// the hands may be a little less flat, and the join distance is wider, so tracking has not yet lost the hands when it fires.
// The first frame the palms join fires the wave; that moment is the judged time. Built only from WebXR hand joints.
// All vectors are PLAYER-LOCAL (XR reference space), metres; +Y = up. Numbers are starting guesses until a headset says otherwise.
import * as THREE from 'three';

export const WAVE_TUNING = {
  openMaxCurl: 0.5, faceDeg: 110, heightMin: -0.5,   // faceDeg: palms forward, inward (a clap), up or down all count; facing the player does not
  joinDist: 0.16, releaseDist: 0.24, engageDist: 0.28,
  readyFrames: 2, lostTolerance: 0.12, cooldown: 0.25,
  triggerGap: 0.25, controllerDist: 0.3,  // controllers: both triggers within 250 ms, held within 30 cm of each other
  lostJoinDist: 0.24, // hands closing and closer than this when tracking drops (they hide each other as they touch) = joined
  stackMax: 0.12, // side by side, not stacked: the palm centres at most this far apart in height
};
const _f = new THREE.Vector3(), _m = new THREE.Vector3();
const deg = (r) => r * 57.29578;

/** One hand in the wave pose? Returns { ok, open, faceDeg, raised } */
export function wavePose(f, headPos, headFwd, T = WAVE_TUNING) {
  const r = { ok: false, open: false, faceDeg: 180, raised: false };
  if (!f?.tracked) return r;
  r.open = Math.max(f.curl[1], f.curl[2], f.curl[3], f.curl[4]) < T.openMaxCurl;
  _f.set(headFwd.x, 0, headFwd.z); if (_f.lengthSq() < 1e-6) _f.set(0, 0, -1); _f.normalize(); // the head's horizontal forward
  r.faceDeg = deg(Math.acos(THREE.MathUtils.clamp(f.palmNormal.dot(_f), -1, 1)));
  r.raised = f.palm.y - headPos.y >= T.heightMin && _m.copy(f.palm).sub(headPos).dot(_f) > 0.08; // raised, in front of the body
  r.ok = r.open && r.faceDeg <= T.faceDeg && r.raised;
  return r;
}

/**
 * Armed → FIRE once on the first frame both open hands are together → waitRelease (until the palms part by releaseDist or
 * the pose is dropped) → armed again. Hands that reappear already together after a tracking gap fire too.
 */
export class EnergyWaveDetector {
  constructor() { this.reset(); }
  reset() { this._dist = 1; this._prev = 1; this._valid = false; this.state = 'idle'; this.armed = true; this.readyCount = 0; this.lastFire = -9; this.lostSince = null; this._engaged = false; this.debug = { state: 'idle', dist: 1, left: null, right: null }; }
  get engaged() { return this._engaged; }
  /** @returns {null | { tContact:number, origin:THREE.Vector3 }} origin = the point between the palms (player-local) */
  update(left, right, { t, headPos, headFwd, allow }) {
    const T = WAVE_TUNING;
    // 2026-11-15 (feedback: the first touch sometimes did not start the blast): the detector no longer has to have watched the
    // open hands apart for some frames first. It fires on ANY frame where both open hands are together while it is armed,
    // and it is armed from the start and again whenever the hands part (or leave the pose) after a wave.
    if (!left?.tracked || !right?.tracked) {
      // Touching hands hide each other from the headset's cameras, so tracking often drops exactly when the palms meet.
      // Armed, in the pose, closing, and already close when it drops: that is the join.
      if (this.lostSince === null && this.armed && this._valid && this._dist < T.lostJoinDist && this._dist < this._prev - 1e-4 && allow && t - this.lastFire >= T.cooldown) {
        this.lostSince = t; this.lastFire = t; this.state = 'waitRelease'; this.armed = false; this._valid = false; this.debug.state = 'waitRelease(lost)';
        return { tContact: t, origin: this._mid.clone(), onLoss: true };
      }
      if (this.lostSince === null) this.lostSince = t;
      if (t - this.lostSince > T.lostTolerance) { this._engaged = false; this._valid = false; if (this.armed) this.state = 'idle'; }
      this.debug.state = `${this.state}(lost)`;
      return null;
    }
    this.lostSince = null;
    const a = wavePose(left, headPos, headFwd, T), b = wavePose(right, headPos, headFwd, T);
    const dist = left.palm.distanceTo(right.palm), level = Math.abs(left.palm.y - right.palm.y) <= T.stackMax;
    const valid = a.ok && b.ok, joined = valid && level && dist < T.joinDist;
    this._prev = this._dist; this._dist = dist; this._valid = valid; (this._mid ||= new THREE.Vector3()).copy(left.palm).add(right.palm).multiplyScalar(0.5);
    this.debug.dist = dist; this.debug.left = a; this.debug.right = b;
    this._engaged = a.open && b.open && a.faceDeg <= T.faceDeg && b.faceDeg <= T.faceDeg && dist < T.engageDist;
    let out = null;
    if (!this.armed) { if (!valid || dist > T.releaseDist) this.armed = true; } // parted (or dropped the pose): ready for the next one
    else if (joined) {
      if (!allow) this.armed = false; // not allowed now: this join is spent, it never fires late
      else if (t - this.lastFire >= T.cooldown) { out = { tContact: t, origin: this._mid.clone() }; this.lastFire = t; this.armed = false; }
    }
    this.state = this.armed ? (valid ? 'ready' : 'idle') : 'waitRelease';
    this.debug.state = this.state;
    return out;
  }
}
