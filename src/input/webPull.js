// Web pull gesture (v0.44): with a web attached and the web pose kept, pull that hand back toward the body.
// Pure, one detector per hand. Input = the hand point and a body (chest) point in the SAME player-local frame
// (XR reference space). Only their distance — the reach — is used, so anything that moves or turns the whole
// tracking space (virtual locomotion, snap turns, origin rebasing, a recentre) cannot produce a pull.
//   idle → armed (hand far enough out) → stroke (reach shrinking; strength grows with the travel) → spent
//   → (clear forward reset) → armed …        tracking loss → lost → (recover frames) → spent (reset first)
// update() returns the strength gained THIS frame (0 … 1 per stroke in total): a stationary hand returns 0.
import * as THREE from 'three';
import { PULL } from '../data/handCombat.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const _rel = new THREE.Vector3();

/** Strength (0…1) of a stroke from its backward travel (m) and peak backward speed (m/s). Pure. */
export function pullStrength(travel, peakSpeed, C = PULL) {
  const x = clamp01((Math.min(travel, C.maxTravel) - C.minTravel) / (C.fullTravel - C.minTravel));
  const base = x * x * x * (x * (6 * x - 15) + 10); // smootherstep: small strokes count for disproportionately little
  const sp = clamp01((peakSpeed - C.speedLo) / (C.speedHi - C.speedLo));
  return base * (1 - C.speedShare + C.speedShare * sp);
}

export class WebPullDetector {
  constructor(cfg = PULL) { this.cfg = cfg; this.pTop = new THREE.Vector3(); this.strokes = 0; this.reset(); }
  reset() {
    this.state = 'idle'; this.f = 0; this.rTop = 0; this.rMin = 0; this.rEnd = 0; this.lastR = null; this.peak = 0; this.stallT = 0;
    this.endT = -9; this.armT = -9; this.trackedN = 0; this.counted = false; this.afterStroke = false; this.justStarted = false; this.travel = 0;
  }
  /** The web "flick re-fire" must stay off for this hand: a stroke is in progress or its forward reset is. */
  busy(t) { return this.state === 'stroke' || (this.afterStroke && (this.state === 'spent' || t - this.armT < this.cfg.flickGuard)); }
  _end(t, r) {
    if (!this.counted && r >= this.cfg.armReach) { this.state = 'armed'; this.rTop = r; this.pTop.copy(_rel); return; } // a drift / twitch that never counted: stay ready, nothing spent
    this.state = 'spent'; this.rEnd = r; this.endT = t; this.afterStroke = this.counted || this.afterStroke;
  }
  /**
   * @param {{t:number, dt:number, held:boolean, tracked:boolean, hand:Vector3, body:Vector3}} c
   *        held = this hand holds the web pose on a web attached to a fixed environmental anchor (and pulling is allowed)
   * @returns {number} strength gained this frame (≥ 0)
   */
  update(c) {
    const C = this.cfg, t = c.t, dt = Math.max(1e-4, c.dt);
    this.justStarted = false;
    if (!c.held) { if (this.state !== 'idle') this.reset(); return 0; }
    if (!c.tracked || !c.hand) { this.state = 'lost'; this.lastR = null; this.trackedN = 0; return 0; }
    _rel.copy(c.hand).sub(c.body);
    const r = _rel.length();
    this.trackedN++;
    if (this.state === 'idle') { // fresh web: the hand that just fired is usually out in front → ready at once
      this.state = r >= C.armReach ? 'armed' : 'spent'; this.rTop = this.rEnd = r; this.pTop.copy(_rel); this.lastR = r; this.afterStroke = false;
      return 0;
    }
    if (this.state === 'lost' || this.lastR === null) { // tracking came back: never a stroke out of the jump
      this.lastR = r;
      if (this.trackedN >= C.recoverFrames) { this.state = 'spent'; this.rEnd = r; this.endT = t; }
      return 0;
    }
    const dr = r - this.lastR; this.lastR = r;
    const jump = Math.abs(dr);
    if (jump > C.maxJump || (jump > C.jumpFloor && jump > C.maxHandSpeed * dt)) { // a jump no hand makes: re-baseline, forward reset required
      this.state = 'spent'; this.rEnd = r; this.endT = t;
      return 0;
    }
    const back = -dr / dt; // backward (toward the body) speed
    if (this.state === 'spent') {
      if (r < this.rEnd) this.rEnd = r;
      if (r - this.rEnd >= C.resetTravel && r >= C.armReach && t - this.endT >= C.cooldown) { this.state = 'armed'; this.rTop = r; this.pTop.copy(_rel); this.armT = t; }
      return 0;
    }
    if (this.state === 'armed') {
      if (r >= this.rTop) { this.rTop = r; this.pTop.copy(_rel); return 0; } // still reaching out: the stroke starts from the farthest point
      if (this.rTop - r < C.startTravel) return 0; // tracking jitter
      this.state = 'stroke'; this.f = 0; this.peak = 0; this.stallT = 0; this.rMin = r; this.counted = false;
    }
    // ---- stroke
    if (r < this.rMin) this.rMin = r;
    if (back > this.peak) this.peak = back;
    this.travel = this.rTop - this.rMin;
    let df = 0;
    const path = this.pTop.distanceTo(_rel);
    const straight = path > 1e-4 ? (this.rTop - r) / path : 1; // cos of the angle between the hand's path and the line to the chest
    if (straight >= Math.cos(C.tolDeg * Math.PI / 180)) {
      const target = pullStrength(this.travel, this.peak, C);
      if (target > this.f) {
        df = target - this.f; this.f = target;
        if (!this.counted) { this.counted = true; this.justStarted = true; this.strokes++; }
      }
    }
    this.stallT = back < C.stallSpeed ? this.stallT + dt : 0;
    if (r - this.rMin > C.reverse || this.stallT > C.stallTime || this.travel >= C.maxTravel) this._end(t, r);
    return df;
  }
}
