// v0.47 Story chase — the stumble-and-punch loop that replaces health and shield in Story (design 4.1). PURE: no three.js,
// no audio, no scene. src/game/storyCombat.js feeds it and turns its events into the jet's look, sound and the red ring.
//
//   chasing ──(pressure reaches the threshold, or a countered heavy pumpkin)──▶ stalled
//   stalled ──(punch)──▶ lockout          stalled ──(stall time runs out: no punch, no reward)──▶ lockout
//   lockout ──(lockout time)──▶ chasing   any state ──(cancel: a respawn, the roof)──▶ chasing
//
// There is no defeated state and nothing here ends the chase: Green Maniac always gets away.
// Pressure only builds while chasing; it decays after a pause without gains. All time comes from update(dt), so a paused
// game (update not called, or update(0)) changes nothing.
import { STORY_CHASE } from '../data/storyChase.js';

export class Stumble {
  constructor(cfg = STORY_CHASE) { this.cfg = cfg; this._ev = []; this._spare = []; this.reset(); }
  /** A new chase. tier = its base tier (1: the first chase, 2: the chase after the factory). */
  reset({ tier = 1 } = {}) {
    this._state = 'chasing'; this._p = 0; this._punches = 0; this._stalls = 0; this._base = tier;
    this._t = 0; // seconds in the current state
    this._idle = 0; // seconds since the last gain (decay)
    this._clock = 0; this._lastWeb = -Infinity; this._faced = false;
    this._ev.length = 0;
  }
  /** 'chasing' | 'stalled' | 'lockout' */
  get state() { return this._state; }
  /** 0 … threshold */
  get pressure() { return this._p; }
  /** pressure / threshold; 1 while stalled (drives the jet's smoke). */
  get frac() { return this._state === 'stalled' ? 1 : Math.min(1, this._p / this.cfg.pressure.threshold); }
  get punches() { return this._punches; }
  /** Stalls started since reset(). */
  get stalls() { return this._stalls; }
  /** Seconds left of the stall (0 outside one). */
  get stallLeft() { return this._state === 'stalled' ? Math.max(0, this.cfg.stall.time - this._t) : 0; }
  /** Attack tier: the higher of the route segment's tier and (base + punches landed), at most cfg.tiers.max. */
  tier(segmentTier = 1) { return Math.min(this.cfg.tiers.max, Math.max(segmentTier, this._base + this._punches)); }

  _stall(cause) { this._state = 'stalled'; this._faced = false; this._t = 0; this._p = this.cfg.pressure.threshold; this._stalls++; this._ev.push({ type: 'stall', cause }); }
  /**
   * Pressure from a hit. kind: 'web' (a web strike on him or the jet; at most one per webInterval of `t`), 'pumpkin'
   * (a pumpkin destroyed), 'lightBomb' (a Light Bomb blast that reached him). t: the caller's clock in seconds (omitted:
   * this machine's own). Returns true when it counted. Counts only while chasing.
   */
  gain(kind, t = this._clock) {
    const P = this.cfg.pressure, g = kind === 'web' ? P.web : kind === 'pumpkin' ? P.pumpkin : kind === 'lightBomb' ? P.lightBomb : 0;
    if (!g || this._state !== 'chasing') return false;
    if (kind === 'web') { if (t - this._lastWeb < P.webInterval) return false; this._lastWeb = t; }
    this._idle = 0; this._p += g;
    if (this._p >= P.threshold) this._stall('pressure');
    return true;
  }
  /** A pumpkin blast reached the player: pressure drops (never below 0). A stall in progress is not touched. */
  playerHit() { if (this._state === 'chasing') this._p = Math.max(0, this._p + this.cfg.pressure.playerHit); }
  /** A heavy pumpkin destroyed inside its counter window: he stalls at once. Only while chasing. */
  counter() { if (this._state !== 'chasing') return false; this._stall('counter'); return true; }
  /** The fly-in reached him. Only while stalled: he breaks away (lockout), punches + 1. */
  punch() {
    if (this._state !== 'stalled') return false;
    this._state = 'lockout'; this._faced = false; this._t = 0; this._p = 0; this._punches++;
    this._ev.push({ type: 'punch', punches: this._punches });
    return true;
  }
  /** v0.49: he has turned to face the player in this stall. */
  get faced() { return this._faced; }
  /** v0.49: the red ring's state this frame. True once per stall, the first time it is on: he turns to face the player and stays turned until the stall ends. */
  face(ringOn) { if (this._state !== 'stalled' || this._faced || !ringOn) return false; this._faced = true; return true; }
  /** A respawn, or he reached the roof: back to chasing with no pressure and nothing queued. True when anything changed. */
  cancel() {
    const changed = this._state !== 'chasing' || this._p > 0 || this._ev.length > 0;
    this._state = 'chasing'; this._faced = false; this._t = 0; this._p = 0; this._idle = 0; this._ev.length = 0;
    return changed;
  }
  update(dt) {
    if (!(dt > 0)) return;
    const C = this.cfg; this._clock += dt; this._t += dt;
    if (this._state === 'chasing') {
      const before = this._idle; this._idle += dt;
      const past = this._idle - Math.max(before, C.pressure.decayDelay); // only the part of dt past the delay
      if (past > 0 && this._p > 0) this._p = Math.max(0, this._p - C.pressure.decayRate * past);
    } else if (this._state === 'stalled') {
      if (this._t >= C.stall.time) { this._state = 'lockout'; this._faced = false; this._t = 0; this._p = 0; this._ev.push({ type: 'recover' }); } // timed out: no punch, no reward
    } else if (this._t >= C.stall.lockout) { this._state = 'chasing'; this._t = 0; this._idle = 0; this._ev.push({ type: 'lockoutEnd' }); }
  }
  /** Events since the last drain(): { type: 'stall', cause: 'pressure' | 'counter' } | { type: 'recover' } | { type: 'punch', punches } | { type: 'lockoutEnd' }. The array is reused: read it before the next call. */
  drain() { const out = this._ev; this._ev = this._spare; this._ev.length = 0; this._spare = out; return out; }
}
