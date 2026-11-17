// v0.47 Story chase — PURE pieces around the stumble loop (no three.js, no scene): where on the route which attack tier
// applies and whether he may throw there, his pacing (the 14 m floor, the stall cap, the break-away, the 1.5 m last resort),
// what a pumpkin blast does to the player's velocity, and the throw scheduler (StoryAttacks).
// Attack choice and timings are World Chase's (chooseAttack + FIGHT, read only) with the tier as the phase (design 4.2).
import { STORY_CHASE } from '../data/storyChase.js';
import { FIGHT, chooseAttack } from '../worlds/bossFight.js';

/** Tier of a route position: 3 once the player has passed the right turn, else 2 from tile cfg.tiers.tier2Tile (0-based), else 1. */
export function segmentTier({ tile = 0, afterTurn = false } = {}, cfg = STORY_CHASE) {
  return afterTurn ? 3 : tile >= cfg.tiers.tier2Tile ? 2 : 1;
}

/**
 * May he start a throw at this route position? No throw within noThrow.nearTurn of the right turn (the player's progress)
 * or once he is within noThrow.beforeRoof of the roof. The room, stall, fly-in and fade rules are the caller's.
 */
export function throwWindow({ playerS, bossS, sTurn, length }, cfg = STORY_CHASE) {
  return Math.abs(playerS - sTurn) > cfg.noThrow.nearTurn && bossS < length - cfg.noThrow.beforeRoof;
}

/**
 * His speed along the route this frame (m/s). base = the v0.46 pacing speed for this gap; gap = his lead over the player
 * (m); playerSpeed = the player's speed along the route; state = Stumble state; boost = break-away speed still owed
 * (cfg.pacing.boost until he has his lead back, then 0).
 *   stalled            → never above stall.speedCap (the player can close in)
 *   lockout with boost → at least the player's speed, plus the boost (he pulls away)
 *   otherwise          → the v0.46 speed, but inside pacing.minGap at least the player's speed plus 2 m/s per missing metre
 *                        (he matches a faster player: never reached outside a stall)
 */
export function pacedSpeed({ base, gap, playerSpeed = 0, state = 'chasing', boost = 0 }, cfg = STORY_CHASE) {
  if (state === 'stalled') return Math.min(base, cfg.stall.speedCap);
  if (state === 'lockout' && boost > 0) return Math.max(base, playerSpeed) + boost;
  if (gap < cfg.pacing.minGap) return Math.max(base, playerSpeed + (cfg.pacing.minGap - gap) * 2);
  return base;
}

/**
 * Last resort against a fly-through: his route position, moved forward so he is never closer than pacing.noPass to the
 * player — but never past lim (the last built module) and never back.
 * flyIn (v0.49): the fly-in is in flight. It stops at the contact distance by itself, so the rule stands down: pushing him ahead
 * of the fly-in's small slow-motion steps kept him just out of reach and the hit never landed.
 */
export function holdS(bossS, playerS, lim = Infinity, cfg = STORY_CHASE, flyIn = false) {
  if (flyIn) return bossS;
  const want = playerS + cfg.pacing.noPass;
  if (bossS >= want) return bossS;
  return Math.max(bossS, Math.min(want, lim));
}

/**
 * A pumpkin blast reached the player (design 4.3): horizontal speed × (1 − player.speedLoss), plus player.push m/s
 * horizontally along `away` (from the blast to the player; its vertical part is ignored), vertical speed untouched —
 * never pushed down. Written to `out` and returned.
 */
export function hitVelocity(vel, away, cfg = STORY_CHASE, out = { x: 0, y: 0, z: 0 }) {
  const k = 1 - cfg.player.speedLoss, h = Math.hypot(away.x, away.z), p = h > 1e-6 ? cfg.player.push / h : 0;
  out.x = vel.x * k + away.x * p; out.z = vel.z * k + away.z * p; out.y = vel.y;
  return out;
}

/**
 * When Green Maniac throws what. idle ──(decision due + allowed + a fair attack)──▶ telegraph ──(its FIGHT.telegraph
 * time)──▶ hold (FIGHT.attackHold) ──▶ idle. A telegraph is cancelled when throws stop being allowed (a stall, the turn,
 * a fade, no line of sight) or by cancel(). No shield, no vent, no health: only the schedule.
 */
export class StoryAttacks {
  constructor(fight = FIGHT) { this.fight = fight; this._ev = []; this.reset(); }
  reset(seed = 1) {
    this._state = 'idle'; this._attack = null; this._t = 0; this._tier = 1;
    this.fightT = 0; this.sinceHeavy = 0; this.recent = []; this.next = 2.5; this._cancel = false;
    this.stats = { single: 0, spread: 0, heavy: 0, cancelled: 0 };
    this._ev.length = 0;
    let s = seed >>> 0 || 1;
    const f = (v) => { let x = v; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    this.rand = () => { s = (s + 0x6d2b79f5) >>> 0; return f(s); };
    this.peek = () => f((s + 0x6d2b79f5) >>> 0); // v1.1: the next rand() without taking it (the heavy throw's flight time, known to its path preview)
  }
  /** 'idle' | 'telegraph' | 'hold' */
  get state() { return this._state; }
  /** 'single' | 'spread' | 'heavy' while telegraphing or holding, else null */
  get attack() { return this._attack; }
  /** Seconds in the current state. */
  get t() { return this._t; }
  /** Drop a telegraph in progress on the next update (one 'cancel' event); the next decision comes 1.5 s later. */
  cancel() { if (this._state === 'telegraph') this._cancel = true; }
  _drop() { const k = this._attack; this._state = 'idle'; this._attack = null; this._t = 0; this._cancel = false; this.next = 1.5; this.stats.cancelled++; this._ev.push({ type: 'cancel', attack: k }); }
  /**
   * One step. ctx: { tier (1 … 3), allow (he may throw now), dist (m, him to the player), flying (pumpkins in the air) }.
   * Returns this step's events (the array is reused: read it before the next call):
   * { type: 'telegraph', attack } | { type: 'release', attack } | { type: 'cancel', attack }.
   */
  update(dt, ctx = {}) {
    const ev = this._ev; ev.length = 0;
    if (!(dt > 0)) return ev;
    const F = this.fight, tier = Math.max(1, Math.min(3, ctx.tier | 0 || 1)); this._tier = tier;
    this._t += dt; this.fightT += dt;
    if (!(this._state === 'telegraph' && this._attack === 'heavy')) this.sinceHeavy += dt;
    switch (this._state) {
      case 'idle': {
        this.next -= dt;
        if (this.next > 0) break;
        const kind = ctx.allow ? chooseAttack({ phase: tier, recent: this.recent, sinceHeavy: this.sinceHeavy, fightT: this.fightT, dist: ctx.dist, flying: ctx.flying || 0, rand: this.rand, heavyOk: tier >= 3 }, F) : null;
        if (!kind) { this.next = F.retry; break; }
        this._state = 'telegraph'; this._attack = kind; this._t = 0; this._cancel = false;
        this.recent.push(kind); if (this.recent.length > 4) this.recent.shift();
        ev.push({ type: 'telegraph', attack: kind });
        break;
      }
      case 'telegraph': {
        if (this._cancel || !ctx.allow) { this._drop(); break; }
        if (this._t >= F.telegraph[this._attack]) {
          const k = this._attack; this._state = 'hold'; this._t = 0; this.stats[k]++;
          if (k === 'heavy') this.sinceHeavy = 0;
          ev.push({ type: 'release', attack: k });
        }
        break;
      }
      default: // hold
        if (this._t >= F.attackHold) { this._state = 'idle'; this._attack = null; this._t = 0; const [a, b] = F.interval[tier - 1]; this.next = a + this.rand() * (b - a); }
        break;
    }
    return ev;
  }
}
