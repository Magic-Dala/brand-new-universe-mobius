// v0.46 close combat (World Chase), revision 4 — pure helpers (no three.js, no scene access):
//   Lunge      the fly-in hit: a web at a staggered Green Maniac inside close range flies Mobius at him (scripted) until the
//              chest is within CLOSE.lunge.contact of his body point (contact) or CLOSE.lunge.timeout runs out (timeout).
//   webAtBoss  what a web aimed at him does — the shield decides: shield up → a web strike only; shield broken (staggered) →
//              attach to the jet beyond close range (then the v0.44 web pull), the lunge inside it.
//   rebound    body contact: the player's velocity relative to him loses its toward-him part and gets pushed back.
import { CLOSE } from '../data/closeCombat.js';

export class Lunge {
  constructor(cfg = CLOSE.lunge) { this.cfg = cfg; this._out = { speed: 0, step: 0, done: null }; this.reset(); }
  reset() { this.active = false; this.t = 0; this.t0 = 0; this.speed = 0; this.max = this.cfg.speed; this.timeout = this.cfg.timeout; }
  /**
   * t: start time (for the record); v0: the player's speed toward him now (m/s, clamped to 0 … max — the fly-in starts from
   * the swing, not from rest); comfort: comfortSpeed instead of speed, and the timeout scaled by the closing speeds against a
   * target moving away at `away` m/s ((speed − away) / (comfortSpeed − away)) so the gentler fly-in reaches as far as the
   * normal one (World Chase passes the stagger speed cap).
   */
  start(t, { v0 = 0, comfort = false, away = 0 } = {}) {
    const C = this.cfg; this.reset();
    this.max = comfort ? C.comfortSpeed : C.speed; this.timeout = C.timeout * (comfort ? (C.speed - away) / Math.max(1, C.comfortSpeed - away) : 1);
    this.speed = Math.min(this.max, Math.max(0, v0 || 0)); this.t0 = t; this.active = true;
    return this;
  }
  /**
   * One step. gap = metres from the chest to his body point now. Returns (reused object) { speed (m/s), step (m to move toward
   * him this step — never past the contact distance: swept), done: null | 'contact' | 'timeout' }. Inactive afterwards when done.
   */
  update(dt, { gap }) {
    const C = this.cfg, o = this._out; o.done = null; o.step = 0;
    if (!this.active) { o.speed = 0; return o; }
    if (gap <= C.contact) { o.speed = this.speed; o.done = 'contact'; this.active = false; return o; }
    this.t += dt;
    this.speed = Math.min(this.max, this.speed + C.accel * dt);
    const room = gap - C.contact, step = this.speed * dt;
    if (step >= room) { o.step = room; o.done = 'contact'; this.active = false; }
    else { o.step = step; if (this.t >= this.timeout) { o.done = 'timeout'; this.active = false; } }
    o.speed = this.speed;
    return o;
  }
}

/**
 * Revision 4 (R4.1 / R4.2): a web aimed at Green Maniac. staggered = fight.state === 'staggered' (shield broken); inClose =
 * CloseRange 'close' (gap ≤ 15 m; always false with the close-combat switch off); los = clear line chest → jet; dist = chest →
 * jet hook (m); tethered = a jet web is already held. 'strike' (the v0.42 web strike) | 'attach' (the jet tether) | 'lunge' (the fly-in hit).
 */
export function webAtBoss({ staggered, inClose, los, dist, minDist = 0, maxDist = 28, tethered = false }) {
  if (!staggered || !los) return 'strike';
  if (inClose) return 'lunge'; // (also with a jet web held: the fly-in releases it — R4.2)
  if (tethered) return 'strike'; // (one jet web at a time)
  return dist >= minDist && dist <= maxDist ? 'attach' : 'strike';
}

/**
 * R4.3 contact push-back. relVel = the player's velocity minus his ({x, y, z}); awayDir = unit vector from him to the player.
 * Horizontal (fix round 1): the toward-him part of the horizontal relative velocity is removed and cfg.rebound m/s added
 * horizontally away from him; vertical: max(current, 0) + cfg.reboundUp — a contact from below (the usual case: he flies
 * ≈ 5.5 m above the route) never drives the player down. Straight above / below him: only the vertical push. Written to
 * `out` (a new plain object when omitted) and returned: the new relative velocity (add his velocity back for the world one).
 */
export function rebound(relVel, awayDir, cfg = CLOSE.lunge, out = { x: 0, y: 0, z: 0 }) {
  const hl = Math.hypot(awayDir.x, awayDir.z), ux = hl > 1e-6 ? awayDir.x / hl : 0, uz = hl > 1e-6 ? awayDir.z / hl : 0;
  const d = relVel.x * ux + relVel.z * uz, k = hl > 1e-6 ? (d < 0 ? -d : 0) + cfg.rebound : 0;
  out.x = relVel.x + ux * k; out.z = relVel.z + uz * k; out.y = Math.max(relVel.y, 0) + cfg.reboundUp;
  return out;
}

/** Distance (m) from point c to the segment a–b (plain {x, y, z}; no allocation). The swept body-contact test (R4.3). */
export function segPointDist(a, b, c) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z, L2 = abx * abx + aby * aby + abz * abz;
  const k = L2 > 1e-12 ? Math.min(1, Math.max(0, ((c.x - a.x) * abx + (c.y - a.y) * aby + (c.z - a.z) * abz) / L2)) : 0;
  return Math.hypot(a.x + abx * k - c.x, a.y + aby * k - c.y, a.z + abz * k - c.z);
}

/**
 * v0.49: he turns to face the player the first time the red ring is on in a stagger, and stays turned until it ends.
 * state = { on } (he has turned in this stagger; start it false), staggered = the fight is staggered now, red = the red
 * ring is on. Call it every frame. True on the frame he should turn. (No stagger count: the fight's counts restart with it.)
 */
export function faceOnRing(state, staggered, red) {
  if (!staggered) { state.on = false; return false; }
  if (!red || state.on) return false;
  state.on = true;
  return true;
}
