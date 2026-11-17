// v0.46 close range (World Chase), pure: where the player is relative to Green Maniac along the route decides whether he
// lets them come close (taunting, red target ring) or keeps the v0.45 distance.
//   far ──gap < tauntIn──▶ close (event taunt)        close ──gap > tauntOut──▶ far (event surf)
//   close, not staggered, campTime s ──▶ boost (events surf, boost): breakAway until gap ≥ CLOSE.boostOut (19 m = tauntOut + 2)
//   boost ──▶ lockout (lockout s, the v0.45 floor) ──▶ far (event lockoutEnd)
// Staggered: the camping count is cleared and does not run; a boost in progress is cancelled into far.
// Disabled (switch off / not in the chase): far, minGap null, a single surf if it was close.
// The gap floor (minGap = holdGap, the early brake, the noPass last resort) holds in close and in boost (a boost starts wherever
// camping ended, 2.2–17 m: a surge then must not fly through him); far and lockout keep the v0.45 rule (null).
// Revision 4: while staggered in close range there is NO early-brake floor (minGap null + noFloor: the stagger speed cap
// stands, so the player can reach him — body contact + rebound in worldChase stop a pass-through); noPass still holds.
import { CLOSE } from '../data/closeCombat.js';

const EV = { taunt: Object.freeze({ type: 'taunt' }), surf: Object.freeze({ type: 'surf' }), boost: Object.freeze({ type: 'boost' }), lockoutEnd: Object.freeze({ type: 'lockoutEnd' }) };

export class CloseRange {
  constructor(cfg = CLOSE) { this.cfg = cfg; this._ev = []; this.reset(); }
  reset() { this.clamps = 0; this._state = 'far'; this._t = 0; this._on = true; this._stag = false; this._ev.length = 0; }
  get state() { return this._state; }
  /** close range or its boost: the 2.2 m floor and the last resort hold (far / lockout: the v0.45 rule) */
  get _held() { return this._on && (this._state === 'close' || this._state === 'boost'); }
  /** Gap floor for pursuitSpeed (q.minGap): holdGap in close range and the boost, null = the v0.45 rule (WORLD_CHASE.minGap) in far / lockout (and with noFloor). */
  get minGap() { return this._held && !this._stag ? this.cfg.holdGap : null; }
  /** Revision 4: staggered in close range → no floor at all (pursuitSpeed q.noFloor); only the noPass last resort. */
  get noFloor() { return this._held && this._stag; }
  /** Last-resort gap (m) his route position is clamped to in close range and the boost (null = no clamp). */
  get noPass() { return this._held ? this.cfg.noPass : null; }
  get breakAway() { return this._state === 'boost'; }
  /** The red target ring shows exactly in close range. */
  get ring() { return this._state === 'close'; }
  /**
   * Shape this frame's pursuit query (pursuitSpeed's q, mutated): the gap floor (minGap), the boost (breakAway), and in close
   * range he holds the gap where it is (lead = the gap, kept within holdGap … tauntIn) at the player's actual speed (ps =
   * max(ps, psNow)) — he matches them instead of fleeing, so they can stay close; brakeAccel / brakeHold: pursuitSpeed's early
   * floor (close range and the boost; the boost keeps the v0.42 lead and reference speed).
   */
  pursuit(q) {
    q.minGap = this.minGap; if (this.breakAway) q.breakAway = true;
    if (this.noFloor) q.noFloor = true;
    else if (this._held) { q.brakeAccel = this.cfg.brakeAccel; q.brakeHold = this.cfg.brakeHold; }
    if (this._state === 'close') { const C = this.cfg; q.lead = Math.min(C.tauntIn, Math.max(C.holdGap, q.gap)); q.ps = Math.max(q.ps, q.psNow ?? q.ps); }
    return q;
  }
  /**
   * Last resort (close range, boost): his route position, moved forward so the gap is never below noPass — but never past lim
   * (the route-end limit wins) and never back. Counts each use that moves him (clamps).
   * flyIn (v0.49): the fly-in is in flight. It stops at the contact distance by itself, so the clamp stands down (in slow motion
   * it pushed him ahead of the fly-in's small steps and the hit never landed).
   */
  holdS(bossS, playerS, lim = Infinity, flyIn = false) {
    const n = this.noPass; if (flyIn || n == null || bossS - playerS >= n) return bossS;
    const s = Math.min(playerS + n, Math.max(bossS, lim)); if (s > bossS) this.clamps++; return s;
  }
  /** One step. Returns this step's events (the array is reused: read it before the next call). */
  update(dt, gap, staggered, enabled) {
    const C = this.cfg, ev = this._ev; ev.length = 0;
    this._on = !!enabled; this._stag = !!staggered;
    if (!enabled) { if (this._state === 'close') ev.push(EV.surf); this._state = 'far'; this._t = 0; return ev; }
    switch (this._state) {
      case 'far': if (gap < C.tauntIn) { this._state = 'close'; this._t = 0; ev.push(EV.taunt); } break;
      case 'close':
        if (gap > C.tauntOut) { this._state = 'far'; this._t = 0; ev.push(EV.surf); break; }
        if (staggered) { this._t = 0; break; }
        this._t += dt;
        if (this._t >= C.campTime) { this._state = 'boost'; this._t = 0; ev.push(EV.surf, EV.boost); }
        break;
      case 'boost':
        if (staggered) { this._state = 'far'; this._t = 0; break; }
        if (gap >= C.boostOut) { this._state = 'lockout'; this._t = 0; }
        break;
      case 'lockout':
        this._t += dt;
        if (this._t >= C.lockout) { this._state = 'far'; this._t = 0; ev.push(EV.lockoutEnd); }
        break;
    }
    return ev;
  }
}
