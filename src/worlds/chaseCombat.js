// v0.41 World Chase combat: every tunable + the pure pieces (target selection with hysteresis, swept collision,
// health with damage protection, the run clock and the single-resolution run lifecycle). No three.js scene access
// here, so all of it is unit tested (tests/chasecombat.test.mjs). Only the standalone World Chase uses this file —
// the story chase and the Arcade keep their own rules.
import * as THREE from 'three';
import { FIGHT } from './bossFight.js';

const D2R = Math.PI / 180;
export const CHASE_COMBAT = {
  player: {
    hp: 100,
    pumpkinDamage: 20, // per pumpkin explosion that reaches Mobius (5 hits = defeat)
    hazardDamage: 10, // lethal floor (river / canal / lava / clouds) → recovery + this much
    invuln: 1.2, // s of damage protection after any hit (overlapping blasts never stack)
  },
  boss: {
    hp: 100, // v0.42: HP only drops fast in openings (see `fight`); protected hits mostly hit the shield
    webDamage: 4, // (legacy v0.41 value — the v0.42 fight uses fight.dmg.*)
    webInterval: 0.6, // s: at most one damaging web hit per this interval (no machine-gun spam)
    tetherDamage: 10, // (legacy v0.41 value — the v0.42 fight uses fight.dmg.*)
    lightBombDamage: 16, // (legacy v0.41 value — the v0.42 fight uses fight.dmg.*)
    radius: 1.8, // m: his effective hit radius (body + cockpit) for webs and Light Bombs
    aimDeg: 7, // web aim cone half-angle around him (degrees) — on top of the radius
    webRange: 48, // m
    hurtTime: 0.45, // s of the hurt reaction (then back to riding)
  },
  // ---- pumpkin aim assist for wrist webs (angles in degrees, distances in metres, times in seconds)
  aim: {
    coneDeg: 9, // angular cone around the wrist aim ray …
    hitRadius: 0.95, // … plus the pumpkin's enlarged radius (model ≈ 0.55 m at scale 1.6): allowed angle = cone + atan(r / d)
    maxRange: 40, minRange: 1.0, // combat range along the aim ray
    viewDeg: 100, // never targets a pumpkin more than this far from where the head looks (behind the player)
    stickyDeg: 4, // hysteresis: the current lock stays valid up to this much OUTSIDE its normal cone …
    stickyBias: 0.2, // … and is only replaced when another pumpkin scores this much better (score units: 0.2 ≈ 2.3° at 20 m)
    imminent: 1.2, // s: time-to-impact below which a pumpkin is a threat (priority, beats swing anchors)
    anchorRatio: 0.55, // a swing anchor wins the shot when its aim offset is < this × the pumpkin's (and no threat)
    occlusionChecks: 3, // segment tests per query (best candidates only — bounded cost)
  },
  // ---- Green Maniac's pumpkin throws in the World Chase (overrides the story values; readability + fairness)
  bombs: {
    firstDelay: 6, interval: [3.8, 5.8], maxActive: 2,
    minRange: 14, // m: never throws when closer (no point-blank, unavoidable contact)
    flightTime: [1.5, 2.6], // s: at least 1.5 s to react
    quietModules: ['recovery', 'start', 'turnL', 'turnR', 'gate', 'branch'], // calm or constrained sections: no new throws
  },
  lightBomb: {
    cooldown: 2.0, // s between throws (readiness shown in the HUD)
    speed: 26, gravity: 4, life: 1.8, // free throw (m/s, m/s², s); the player's velocity is added
    homingSpeed: 30, // m/s toward a locked target (target re-read every frame)
    lockDeg: 13, lockRange: 50, // assist: cone half-angle (deg, + target radius) / range (m)
    pumpkinRadius: 1.0, // m: contact radius against a flying pumpkin (swept)
    blastRadius: 3.2, // m: destroys pumpkins / damages Green Maniac with a clear line from the blast
  },
  // ---- v0.42 Fan Web in chase (two-hand gesture / desktop V): spread defence by spatial grouping, no beat timing
  fan: { coneDeg: 38, range: 36, groupDeg: 70 }, // half-angle of the fan (+ pumpkin radius), reach (m), re-centre on a group within this
  results: { delay: 1.3 }, // s of the defeat effect before the results panel
  lead: 26, leadMax: 52, // m: Green Maniac's preferred / maximum lead (was 34 / 70 in v0.40 — now inside attack range)
  fight: FIGHT, // v0.42 boss fight: HP / shield / damage / timings / counters — all in src/worlds/bossFight.js (FIGHT)
};

// ------------------------------------------------------------------------------------------------ geometry helpers
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
/** Closest distance between segment [p0, p1] and point q (all THREE.Vector3). Returns { dist, t }. */
export function segPointDist(p0, p1, q) {
  const d = _a.copy(p1).sub(p0), L2 = d.lengthSq();
  let t = L2 > 1e-12 ? _b.copy(q).sub(p0).dot(d) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { dist: _c.copy(p0).addScaledVector(d, t).distanceTo(q), t };
}
/**
 * Swept sphere test for a moving object against a moving point: relative motion (a0 → a1 for the object, q0 → q1 for
 * the point). Returns the first contact fraction t ∈ [0, 1] or -1. Uses the closest approach on the relative segment.
 */
export function sweptHit(a0, a1, q0, q1, radius) {
  const r0 = _a.copy(a0).sub(q0), r1 = _b.copy(a1).sub(q1); // relative positions
  const d = _c.copy(r1).sub(r0), L2 = d.lengthSq();
  let t = L2 > 1e-12 ? -r0.dot(d) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dist = Math.sqrt(r0.lengthSq() + 2 * t * r0.dot(d) + t * t * L2);
  if (dist > radius) return -1;
  // first contact along the segment: solve |r0 + s d| = radius for the smaller root s ∈ [0, t]
  const A = L2, B = 2 * r0.dot(d), C = r0.lengthSq() - radius * radius;
  if (C <= 0) return 0;
  const disc = B * B - 4 * A * C; if (disc < 0 || A < 1e-12) return t;
  const s = (-B - Math.sqrt(disc)) / (2 * A);
  return s < 0 ? 0 : s > 1 ? t : s;
}

// ------------------------------------------------------------------------------------------------ target selection
const _rel = new THREE.Vector3(), _toHead = new THREE.Vector3();
/**
 * Forgiving, predictable target choice around the player's INTENDED aim (pure; unit tested).
 * @param origin  aim ray origin (wrist), dir normalized aim direction
 * @param cands   [{ pos, vel?, radius?, key? }]  (key = stable identity for the lock)
 * @param opt     { coneDeg, hitRadius, maxRange, minRange, viewDeg, head?, headFwd?, chest?, imminent,
 *                  lock? (key of the current lock), stickyDeg, stickyBias, occluded?(origin, pos, cand) → bool, occlusionChecks }
 * @returns {null | { cand, angle (deg), allowed (deg), norm (0 centre … 1 edge), score, dist, tti, sticky }}
 */
export function selectTarget(origin, dir, cands, opt = {}) {
  const cone = opt.coneDeg ?? 9, maxR = opt.maxRange ?? 40, minR = opt.minRange ?? 1, viewCos = Math.cos((opt.viewDeg ?? 100) * D2R);
  const out = [];
  for (const c of cands) {
    _rel.copy(c.pos).sub(origin);
    const along = _rel.dot(dir); if (along < minR) continue; // behind the hand / too close
    const dist = _rel.length(); if (dist > maxR) continue;
    if (opt.head && opt.headFwd) { _toHead.copy(c.pos).sub(opt.head); const L = _toHead.length(); if (L > 0.5 && _toHead.dot(opt.headFwd) / L < viewCos) continue; } // behind the player
    const angle = Math.atan2(Math.sqrt(Math.max(0, dist * dist - along * along)), along) / D2R;
    const rad = c.radius ?? opt.hitRadius ?? 0.95;
    const allowed = cone + Math.atan(rad / Math.max(0.5, dist)) / D2R;
    const sticky = opt.lock != null && c.key === opt.lock;
    if (angle > allowed + (sticky ? (opt.stickyDeg ?? 4) : 0)) continue;
    // threat: time to impact against the chest (closing speed along the line)
    let tti = Infinity;
    if (c.vel && opt.chest) { const to = _toHead.copy(opt.chest).sub(c.pos), L = to.length(); const closing = L > 1e-6 ? c.vel.dot(to) / L : 0; if (closing > 0.5) tti = L / closing; }
    const norm = angle / allowed;
    let score = norm + 0.15 * (dist / maxR) - (tti < (opt.imminent ?? 1.2) ? 0.25 : 0) - (tti < Infinity ? 0.05 : 0);
    if (sticky) score -= opt.stickyBias ?? 0.2; // hysteresis: the held lock keeps priority
    out.push({ cand: c, angle, allowed, norm, score, dist, tti, sticky });
  }
  if (!out.length) return null;
  out.sort((x, y) => x.score - y.score);
  const n = Math.min(out.length, opt.occlusionChecks ?? 3);
  for (let i = 0; i < n; i++) if (!opt.occluded || !opt.occluded(origin, out[i].cand.pos, out[i].cand)) return out[i];
  return null; // the best candidates are all behind walls: no target (never through buildings)
}

/**
 * Combat shot vs swing anchor (pure). pumpkin / anchor: selectTarget / pickTarget results (or null).
 * anchorNorm: the anchor's normalized aim offset (0 centre … 1 edge). Returns 'pumpkin' | 'anchor' | null.
 */
export function shotIntent(pumpkin, anchorNorm, cfg = CHASE_COMBAT.aim) {
  if (!pumpkin) return anchorNorm == null ? null : 'anchor';
  if (anchorNorm == null) return 'pumpkin';
  if (pumpkin.tti < cfg.imminent || pumpkin.sticky) return 'pumpkin'; // a threat / the shown lock always wins
  return anchorNorm < cfg.anchorRatio * pumpkin.norm ? 'anchor' : 'pumpkin';
}

// ------------------------------------------------------------------------------------------------ health
/** One health pool with damage protection and per-hit ids (a hit id is counted once, ever). */
export class Health {
  constructor(max, invuln = 0) { this.max = max; this.invuln = invuln; this.reset(); }
  reset() { this.hp = this.max; this.until = -1; this.seen = new Set(); this.log = []; this.lastHitT = -9; this.lag = this.max; }
  get frac() { return this.hp / this.max; }
  get dead() { return this.hp <= 0; }
  /** Apply `amount` at time `t` (run clock). Returns the damage actually dealt (0 = ignored). */
  damage(amount, t, id = null, src = '') {
    if (this.dead || amount <= 0) return 0;
    if (id != null) { if (this.seen.has(id)) return 0; this.seen.add(id); }
    if (t < this.until) return 0; // damage protection
    const d = Math.min(this.hp, amount);
    this.hp -= d; this.lastHitT = t; if (this.invuln > 0) this.until = t + this.invuln;
    this.log.push({ t: +t.toFixed(3), d, src });
    return d;
  }
  /** HUD: a trailing "recent damage" bar that catches up with the HP. */
  tick(dt) { this.lag = Math.max(this.hp, this.lag - this.max * 0.6 * dt); }
}

// ------------------------------------------------------------------------------------------------ run lifecycle
/**
 * The World Chase run: 'preparing' (loading / intro, the player already has control) → 'active' (timer runs) ⇄ paused →
 * 'victory' | 'defeat' (transition: frozen, effects settle) → 'results' → 'returning'. resolve() succeeds once.
 */
export class ChaseRun {
  constructor() { this.reset(); }
  reset() { this.phase = 'preparing'; this.paused = false; this.time = 0; this.outcome = null; this.resolvedAt = null; this.final = null; this.transitionT = 0; }
  start() { if (this.phase === 'preparing') this.phase = 'active'; }
  get running() { return this.phase === 'preparing' || this.phase === 'active'; }
  get over() { return !this.running; }
  /** Gameplay time: only while active and not paused (dt = the game's frame step). */
  tick(dt) { if (this.phase === 'active' && !this.paused) this.time += dt; if (this.phase === 'victory' || this.phase === 'defeat') this.transitionT += dt; }
  pause() { if (this.running) this.paused = true; }
  resume() { this.paused = false; }
  /** Only the first call resolves the run (victory / defeat). Returns true if this call did. */
  resolve(outcome, data = {}) {
    if (!this.running) return false;
    this.phase = outcome; this.outcome = outcome; this.paused = false; this.resolvedAt = this.time; this.transitionT = 0;
    this.final = { ...data, time: this.time, outcome };
    return true;
  }
  showResults() { if (this.phase === 'victory' || this.phase === 'defeat') { this.phase = 'results'; return true; } return false; }
  returning() { this.phase = 'returning'; }
}

/** mm:ss, h:mm:ss from one hour (floor of whole seconds — the shown time never runs ahead). */
export function formatChaseTime(sec) {
  const s = Math.max(0, Math.floor(sec + 1e-6)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(r)}` : `${p(m)}:${p(r)}`;
}
