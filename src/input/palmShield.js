// Palm-facing light-web shield gesture (v0.44): an OPEN hand, PALM FORWARD, RAISED in front of the body.
// One detector per hand; all inputs are PLAYER-LOCAL hand features (gestures.js). Pure — no scene access.
// Rules: the three conditions together + a dwell to rise, looser thresholds + a dwell to drop (hysteresis),
// explicit lock-outs for the other gestures (decided by the InputHub), a short tracking-loss grace during which
// the shield stays up but never blocks, and a full re-qualification after a longer loss.
import { SHIELD } from '../data/handCombat.js';

const R2D = 57.29578;

/** Pose measurements used by the detector (exported for tests / debug overlays). */
export function measurePalm(f, headPos, headFwd, out = {}) {
  const c = f.curl;
  out.maxCurl = Math.max(c[1], c[2], c[3], c[4]);
  const d = f.palmNormal.x * headFwd.x + f.palmNormal.y * headFwd.y + f.palmNormal.z * headFwd.z;
  out.faceDeg = Math.acos(d > 1 ? 1 : d < -1 ? -1 : d) * R2D;
  out.height = f.palm.y - headPos.y;
  out.forward = (f.palm.x - headPos.x) * headFwd.x + (f.palm.z - headPos.z) * headFwd.z;
  out.speed = f.vel.length();
  return out;
}

export class PalmShieldDetector {
  constructor(handedness, cfg = SHIELD) { this.handedness = handedness; this.cfg = cfg; this.m = {}; this.reset(); }
  reset() {
    this.active = false; // the shield is up
    this.blocking = false; // … and may block this frame (tracked, with a previous pose)
    this.candT = 0; this.offT = 0; this.absentT = 0; this.lostAt = null; this.lockUntil = -9; this.needRelease = false; this.why = '';
  }
  /** No shield from this hand before t + dur (e.g. right after a Light Bomb left it). */
  lock(t, dur) { if (t + dur > this.lockUntil) this.lockUntil = t + dur; }
  /** Take the shield down now. needRelease: the hand must leave the pose before it can rise again (after an overload). */
  drop(needRelease = false) {
    const was = this.active;
    this.active = false; this.blocking = false; this.candT = 0; this.offT = 0; this.lostAt = null;
    if (needRelease) { this.needRelease = true; this.absentT = 0; }
    return was ? 'off' : null;
  }
  /** Desktop / debug: the shield follows a held key. */
  setManual(on) {
    if (on === this.active) { this.blocking = on; return null; }
    this.active = on; this.blocking = on; this.candT = 0; this.offT = 0;
    return on ? 'on' : 'off';
  }
  /**
   * @param {HandFeatures} f
   * @param {{t:number, dt:number, headPos:Vector3, headFwd:Vector3, allow:boolean, blocked:boolean}} ctx
   *        headFwd = the head's horizontal forward (unit); allow = the game allows shields (mode, energy);
   *        blocked = another gesture / the UI owns this hand right now.
   * @returns {'on'|'off'|null} transition this frame
   */
  update(f, ctx) {
    const G = this.cfg, t = ctx.t, dt = ctx.dt;
    if (!f.tracked) {
      this.blocking = false; this.candT = 0;
      if (!this.active) { this.why = 'lost'; return null; }
      if (this.lostAt === null) this.lostAt = t;
      if (t - this.lostAt > G.lostGrace) { this.why = 'lost'; return this.drop(); }
      return null; // short gap: stays up, cannot block
    }
    const m = measurePalm(f, ctx.headPos, ctx.headFwd, this.m);
    const locked = !ctx.allow || ctx.blocked || t < this.lockUntil;
    if (this.active) {
      this.lostAt = null;
      if (locked) { this.why = 'locked'; return this.drop(); }
      const hold = m.maxCurl < G.openExit && m.faceDeg < G.faceExitDeg && m.height > G.heightExit && m.forward > G.forwardExit;
      this.offT = hold ? 0 : this.offT + dt;
      if (this.offT >= G.exitDwell) { this.why = 'pose'; return this.drop(); }
      this.blocking = hold && f.trackedFrames >= 2; // (a frame right after a gap has no reliable previous pose)
      return null;
    }
    const cand = m.maxCurl < G.openEnter && m.faceDeg < G.faceEnterDeg && m.height > G.heightEnter && m.forward > G.forwardEnter;
    if (!cand) {
      this.candT = 0; this.absentT += dt;
      if (this.absentT >= G.exitDwell) this.needRelease = false; // the pose was seen absent → re-armed
      this.why = 'pose'; return null;
    }
    this.absentT = 0;
    if (locked || this.needRelease || f.trackedFrames < G.recoverFrames || m.speed > G.maxSpeedEnter) {
      this.candT = 0; this.why = locked ? 'locked' : this.needRelease ? 'release' : m.speed > G.maxSpeedEnter ? 'moving' : 'recover';
      return null;
    }
    this.candT += dt;
    if (this.candT < G.enterDwell) { this.why = 'dwell'; return null; }
    this.active = true; this.blocking = true; this.offT = 0; this.candT = 0; this.why = '';
    return 'on';
  }
}
