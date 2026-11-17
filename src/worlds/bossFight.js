// v0.42 World Chase boss fight — Green Maniac on the Green Bat Jet as a moving boss with readable attacks,
// a protective shield, a heavy-throw counter and temporary vulnerability windows. PURE (no three.js / scene):
// the state machine, the damage model, attack choice and the counter rules are all unit tested
// (tests/bossfight.test.mjs). worldChase.js feeds it the world facts (distance, line of sight, route ahead) and
// turns its events into animation, projectiles, VFX, HUD and audio.
//
//   protected ──(attack due + fair)──▶ telegraph ──(release)──▶ attack ──▶ protected
//        │                                 │ heavy
//        │                                 ▼
//        │                           telegraph (core vents open at ventAt) ──release──▶ vent ──(window ends)──▶ recovering
//        │                                 │                                              │
//        │      core hit / Light Bomb on core / heavy pumpkin destroyed near launch ───────┤
//        ▼                                                                                ▼
//   shield broken by chip ──────────────────────────────────────────────────────────▶ staggered ──▶ recovering ──▶ protected
//   any state ──(HP 0)──▶ defeated (terminal)
//
// Only these transitions exist (TRANSITIONS); `go()` rejects anything else, so overlapping attack sequences and a
// second resolution are impossible. All timing uses the dt the caller passes (= the game clock: a pause simply stops
// calling update(), nothing here uses wall time or callbacks).

export const FIGHT = {
  shield: {
    max: 60, // stability (shield) capacity
    regenDelay: 3.5, // s without shield damage before it regenerates …
    regenRate: 5, // … at this many points / s (only while protected / telegraphing: never during an opening)
    rebreakArmor: 0.4, // after a chip break: shield damage × this …
    rebreakTime: 15, // … for this long once he is protected again (spamming the shield down again is slower)
  },
  // HP / stability per hit. 'protected' also covers telegraph / attack / recovering; 'vent' = core open, before the counter
  dmg: {
    protected: { web: { hp: 0.1, st: 4 }, lightBomb: { hp: 0.5, st: 12 }, tether: { hp: 0.5, st: 14 }, fan: { hp: 0, st: 3 }, punch: { hp: 0.5, st: 14 } }, // (v0.46 punch = the fly-in hit / a body contact)
    core: { web: { hp: 6 }, lightBomb: { hp: 10 }, counter: { hp: 6 } }, // a core hit / near-launch heavy kill = COUNTER → stagger
    staggered: { web: { hp: 4 }, webCore: { hp: 5 }, lightBomb: { hp: 12 }, lightBombCore: { hp: 16 }, tether: { hp: 6 }, fan: { hp: 1 }, punch: { hp: 10 } },
  },
  webInterval: { protected: 0.6, staggered: 0.45 }, // s: at most one damaging web per interval (both hands together)
  punchInterval: 0.5, // s: v0.46 — at most one punch per interval (its own limiter, independent of the webs)
  openingCap: { counter: 30, break: 10 }, // HP one opening can deal (counter ⇒ ≥ 4 openings per fight); reaching it ends the stagger early
  stagger: { counter: 6.0, break: 3.0 }, // s of the vulnerability window: after a counter / after a chip break (core stays shut)
  recover: 1.8, // s: the shield visibly re-forms (core closes) — damage as protected
  attackHold: 0.35, // s after a release before the next decision
  telegraph: { single: 0.95, spread: 1.4, heavy: 2.4 }, // s from the first cue to the release
  heavy: {
    ventAt: 1.1, // s into the heavy telegraph: the jet vents, the core opens (before the release → can be hit early)
    window: 2.8, // s the core stays open after the release (the vent state)
    counterTime: 1.3, // s after the release in which destroying the heavy pumpkin counters …
    counterRange: 20, // … and only while it is within this many metres of the jet (a far kill just blocks it; the jet and the pumpkin separate at ≈ 20–25 m/s)
    every: [17, 18, 15], // s of fight time between heavy throws, per phase
    first: 10, // s into the chase before the first heavy throw
    maxDist: 40, // m: heavy throws only when the player is this close (the core must be reachable)
    playerDamage: 30, flight: [2.4, 2.8], gravity: 2.5, blast: 3.0, scale: 2.0, hitRadius: 1.8, // (flatter lob than a normal pumpkin: stays in view)
  },
  phases: [0.65, 0.30], // boss HP fractions: phase 2 below the first, phase 3 below the second (applied when protected)
  interval: [[3.6, 5.0], [3.2, 4.6], [2.6, 3.8]], // s between attacks per phase (random in range, seeded)
  spread: { fromPhase: 2, lateral: 2.6, flight: 1.8, chance: [0, 0.4, 0.5] }, // three pumpkins: m apart at the player
  single: { flight: [1.5, 2.6] },
  range: { min: 14, max: 60 }, // m: no attack decision outside this (never point-blank, never from off-screen)
  retry: 0.6, // s: an attack that is due but not fair right now is re-checked after this
  core: { radius: 1.2, aimDeg: 8, range: 45, viewDeg: 100 }, // eligible weak-point target (world m / deg)
};

export const FIGHT_STATES = ['protected', 'telegraph', 'attack', 'vent', 'staggered', 'recovering', 'defeated'];
export const TRANSITIONS = {
  protected: ['telegraph', 'staggered', 'defeated'],
  telegraph: ['attack', 'vent', 'protected', 'staggered', 'defeated'], // protected = cancelled before the release
  attack: ['protected', 'staggered', 'defeated'],
  vent: ['staggered', 'recovering', 'defeated'],
  staggered: ['recovering', 'defeated'],
  recovering: ['protected', 'defeated'],
  defeated: [],
};

/** Phase (1 … 3) for a boss HP fraction. */
export function phaseFor(frac, cfg = FIGHT) { return frac > cfg.phases[0] ? 1 : frac > cfg.phases[1] ? 2 : 3; }

/**
 * Which attack to start (pure). ctx: { phase, recent: [kinds, newest last], sinceHeavy, fightT, dist, flying, rand, heavyOk }.
 * heavyOk: the route ahead has escape space for a heavy throw (caller: module type + map preference).
 * Returns 'single' | 'spread' | 'heavy' | null (null = nothing fair right now).
 */
export function chooseAttack(ctx, cfg = FIGHT) {
  const { phase = 1, recent = [], sinceHeavy = 0, fightT = 0, dist = 30, flying = 0, rand = Math.random, heavyOk = true } = ctx;
  if (dist < cfg.range.min || dist > cfg.range.max) return null;
  const last = recent[recent.length - 1];
  const heavyDue = fightT >= cfg.heavy.first && sinceHeavy >= cfg.heavy.every[phase - 1];
  if (heavyDue && heavyOk && flying === 0 && dist <= cfg.heavy.maxDist && last !== 'heavy') return 'heavy';
  if (phase >= cfg.spread.fromPhase && flying === 0 && last !== 'spread' && rand() < cfg.spread.chance[phase - 1]) return 'spread';
  if (flying <= 1) return 'single';
  return null;
}

/** A heavy pumpkin destroyed `tSince` s after its release, `distToJet` m from the jet: does it counter? (time AND position) */
export function heavyCounterOk(tSince, distToJet, cfg = FIGHT) { return tSince >= 0 && tSince <= cfg.heavy.counterTime && distToJet <= cfg.heavy.counterRange; }

export class BossFight {
  constructor(cfg = FIGHT) { this.cfg = cfg; this.reset(); }
  reset(seed = 1) {
    this.state = 'protected'; this.t = 0; this.fightT = 0; this.phase = 1; this.pendingPhase = 1;
    this.stability = this.cfg.shield.max; this.lastShieldHit = -99; this.armorUntil = -1;
    this.attack = null; this.released = false; this.coreOpen = false; this.nextAttackIn = 2.5;
    this.recent = []; this.sinceHeavy = 0; this.heavyReleaseT = -99;
    this.staggerLen = 0; this.staggerCause = null; this.openingDamage = 0; this.lastWebT = -99; this.lastPunchT = -99;
    this.events = []; this.log = []; this.stats = { counters: 0, breaks: 0, staggers: 0, heavies: 0, missedHeavies: 0, attacks: { single: 0, spread: 0, heavy: 0 }, blocked: 0 };
    let s = seed >>> 0 || 1; this.rand = () => { s = (s + 0x6d2b79f5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  }
  get vulnerable() { return this.state === 'staggered'; }
  /** The power core is open and may be targeted (heavy vent from ventAt, the vent window, the stagger). */
  get coreEligible() { return this.coreOpen && this.state !== 'defeated' && this.state !== 'recovering'; }
  /** 0 … 1 for the HUD: shield fraction (stagger: remaining window). */
  get shieldFrac() { return this.stability / this.cfg.shield.max; }
  get windowFrac() { return this.state === 'staggered' ? Math.max(0, 1 - this.t / this.staggerLen) : this.state === 'vent' ? Math.max(0, 1 - this.t / this.cfg.heavy.window) : 0; }
  /** The boss should let the player close in (stagger, heavy windup / vent). */
  get slowed() { return this.state === 'staggered' ? 'stagger' : (this.attack === 'heavy' && (this.state === 'telegraph' || this.state === 'vent')) ? 'heavy' : null; }

  _emit(type, data = {}) { const e = { type, state: this.state, t: +this.fightT.toFixed(3), ...data }; this.events.push(e); this.log.push(e); if (this.log.length > 200) this.log.shift(); return e; }
  go(next, why = '') {
    if (!TRANSITIONS[this.state]?.includes(next)) { this._emit('rejected', { to: next, why }); return false; }
    const from = this.state; this.state = next; this.t = 0;
    this._emit('state', { from, to: next, why });
    return true;
  }

  /**
   * One step. ctx: { fair: bool (dist / LOS / route ok for an attack now), dist, flying, heavyOk, bossHpFrac }.
   * Returns the events since the previous update (this step + any hit() / forced attack in between): state changes, 'telegraph' {attack}, 'ventOpen', 'release' {attack},
   * 'ventClose', 'stagger' {cause}, 'recover', 'shieldUp', 'phase' {phase}, 'regen'.
   */
  update(dt, ctx = {}) {
    const C = this.cfg;
    if (this.state === 'defeated') return this._flush();
    this.t += dt; this.fightT += dt;
    if (this.state !== 'telegraph' && this.state !== 'vent' && this.attack !== 'heavy') this.sinceHeavy += dt;
    if (ctx.bossHpFrac != null) this.pendingPhase = Math.max(this.pendingPhase, phaseFor(ctx.bossHpFrac, C));
    // shield regeneration (only while protected / winding up a normal attack — never during an opening)
    if ((this.state === 'protected' || (this.state === 'telegraph' && this.attack !== 'heavy') || this.state === 'attack') && this.stability < C.shield.max && this.fightT - this.lastShieldHit >= C.shield.regenDelay) {
      this.stability = Math.min(C.shield.max, this.stability + C.shield.regenRate * dt);
    }
    switch (this.state) {
      case 'protected': {
        if (this.phase !== this.pendingPhase) { this.phase = this.pendingPhase; this._emit('phase', { phase: this.phase }); } // safe boundary
        this.nextAttackIn -= dt;
        if (this.nextAttackIn <= 0) {
          const kind = ctx.fair ? chooseAttack({ phase: this.phase, recent: this.recent, sinceHeavy: this.sinceHeavy, fightT: this.fightT, dist: ctx.dist, flying: ctx.flying, rand: this.rand, heavyOk: ctx.heavyOk }, C) : null;
          if (kind) this.startAttack(kind); else this.nextAttackIn = C.retry;
        }
        break;
      }
      case 'telegraph': {
        if (ctx.abort && !this.released) { // the player respawns / the route turns blind before the release: cancel cleanly
          const k = this.attack; this._closeCore(); this.attack = null; this.go('protected', 'abort'); this._emit('cancel', { attack: k }); this.nextAttackIn = 1.5; break;
        }
        if (this.attack === 'heavy' && !this.coreOpen && this.t >= C.heavy.ventAt) { this.coreOpen = true; this._emit('ventOpen'); }
        if (this.t >= C.telegraph[this.attack]) {
          this.released = true; const k = this.attack;
          if (k === 'heavy') { this.heavyReleaseT = this.fightT; this.sinceHeavy = 0; this.stats.heavies++; this.go('vent', 'release'); }
          else this.go('attack', 'release');
          this._emit('release', { attack: k });
        }
        break;
      }
      case 'attack': if (this.t >= C.attackHold) this._toProtected(); break;
      case 'vent': if (this.t >= C.heavy.window) { this.stats.missedHeavies++; this._closeCore(); this.go('recovering', 'missed'); this._emit('recover', { from: 'vent' }); } break;
      case 'staggered': if (this.t >= this.staggerLen) this._endStagger('time'); break;
      case 'recovering': if (this.t >= C.recover) { this._toProtected(); this._emit('shieldUp'); } break;
    }
    return this._flush();
  }
  /** Events since the last update (incl. those emitted by hit() / forced attacks between frames), then cleared. Two buffers: no allocation. */
  _flush() { const out = this.events; this.events = this._spare || []; this.events.length = 0; this._spare = out; return out; }
  startAttack(kind) {
    if (this.state !== 'protected') return false;
    if (!this.go('telegraph', kind)) return false;
    this.attack = kind; this.released = false; this.recent.push(kind); if (this.recent.length > 4) this.recent.shift();
    this.stats.attacks[kind]++;
    this._emit('telegraph', { attack: kind });
    return true;
  }
  _toProtected() {
    this.attack = null; this.released = false; this.go('protected');
    const [a, b] = this.cfg.interval[this.phase - 1]; this.nextAttackIn = a + this.rand() * (b - a);
  }
  _closeCore() { if (this.coreOpen) { this.coreOpen = false; this._emit('ventClose'); } }
  _stagger(cause) {
    const C = this.cfg; if (!this.go('staggered', cause)) return false;
    this.coreOpen = cause !== 'break'; this.attack = null; this.released = false; this.openingDamage = 0;
    this.staggerLen = cause === 'break' ? C.stagger.break : C.stagger.counter; this.staggerCause = cause;
    this.stats.staggers++; if (cause === 'break') this.stats.breaks++; else this.stats.counters++;
    this._emit('stagger', { cause });
    return true;
  }
  _endStagger(why) {
    const C = this.cfg; this._closeCore();
    if (this.staggerCause === 'break') this.armorUntil = this.fightT + C.recover + C.shield.rebreakTime;
    this.stability = C.shield.max; // the broken shield re-forms (visibly, during `recovering`)
    this.go('recovering', why); this._emit('recover', { from: 'stagger', why });
  }

  /**
   * A hit on the boss. src: 'web' | 'lightBomb' | 'tether' | 'fan' | 'counter' (heavy pumpkin destroyed near launch) | 'punch' (v0.46).
   * zone: 'core' | 'body'. now: optional (defaults to fight time). Returns { hp, st, kind } where kind is the
   * feedback: 'blocked' (no effect), 'shield' (stability damage), 'break' (shield broke → stagger), 'counter'
   * (core / heavy counter → stagger), 'weak' (vulnerable hit), 'weakCore', 'capped' (opening cap reached) or 'none'.
   * HP is applied by the caller (Health); this only decides the amounts.
   */
  hit(src, zone = 'body') {
    const C = this.cfg, s = this.state, D = C.dmg;
    if (s === 'defeated') return { hp: 0, st: 0, kind: 'none' };
    // webs are rate limited (both hands together)
    if (src === 'web') {
      const iv = s === 'staggered' ? C.webInterval.staggered : C.webInterval.protected;
      if (this.fightT - this.lastWebT < iv) return { hp: 0, st: 0, kind: 'blocked', limited: true };
      this.lastWebT = this.fightT;
    }
    if (src === 'punch') { // v0.46: its own limiter
      if (this.fightT - this.lastPunchT < C.punchInterval) return { hp: 0, st: 0, kind: 'blocked', limited: true };
      this.lastPunchT = this.fightT;
    }
    // COUNTER: the open core (heavy vent / its windup after ventAt) or the heavy pumpkin near the jet
    if ((s === 'telegraph' || s === 'vent') && ((zone === 'core' && this.coreEligible && (src === 'web' || src === 'lightBomb')) || src === 'counter')) {
      const hp = (src === 'counter' ? D.core.counter : D.core[src]).hp;
      this._stagger('counter'); this.openingDamage += hp;
      return { hp, st: 0, kind: 'counter' };
    }
    if (s === 'staggered') {
      const key = src === 'web' ? (zone === 'core' ? 'webCore' : 'web') : src === 'lightBomb' ? (zone === 'core' ? 'lightBombCore' : 'lightBomb') : src === 'counter' ? null : src;
      const e = key && D.staggered[key]; if (!e) return { hp: 0, st: 0, kind: 'none' };
      const cap = C.openingCap[this.staggerCause] ?? C.openingCap.counter;
      const hp = Math.max(0, Math.min(e.hp, cap - this.openingDamage));
      this.openingDamage += hp;
      const capped = this.openingDamage >= cap - 1e-9;
      if (capped) this._endStagger('cap');
      return { hp, st: 0, kind: capped ? 'capped' : zone === 'core' ? 'weakCore' : 'weak' };
    }
    // protected / telegraph / attack / vent body hits / recovering: the shield takes it
    const e = D.protected[src]; if (!e) return { hp: 0, st: 0, kind: 'blocked' };
    if (s === 'recovering' || s === 'vent') { this.stats.blocked++; return { hp: e.hp * 0.5, st: 0, kind: 'blocked' }; } // re-forming / venting: no shield progress
    const st = e.st * (this.fightT < this.armorUntil ? C.shield.rebreakArmor : 1);
    this.stability = Math.max(0, this.stability - st); if (st > 0) this.lastShieldHit = this.fightT;
    if (this.stability <= 0) {
      if (s === 'telegraph' && !this.released) this._emit('cancel', { attack: this.attack });
      this._stagger('break'); return { hp: e.hp, st, kind: 'break' };
    }
    if (!st) this.stats.blocked++;
    return { hp: e.hp, st, kind: st > 0 ? 'shield' : 'blocked' };
  }
  /** Boss HP reached 0. */
  defeat() { if (this.state === 'defeated') return false; this._closeCore(); this.attack = null; this.go('defeated', 'hp'); return true; }

  // ---- debug / tuning hooks (never used by normal play)
  forceAttack(kind) { if (this.state !== 'protected') return false; return this.startAttack(kind); }
  forceStagger(cause = 'counter') { if (this.state === 'staggered' || this.state === 'defeated') return false; if (!TRANSITIONS[this.state].includes('staggered')) { this.state = 'protected'; } return this._stagger(cause); }
  snapshot() { return { state: this.state, t: +this.t.toFixed(2), attack: this.attack, phase: this.phase, stability: +this.stability.toFixed(1), coreOpen: this.coreOpen, nextAttackIn: +this.nextAttackIn.toFixed(2), sinceHeavy: +this.sinceHeavy.toFixed(1), window: +this.windowFrac.toFixed(2), opening: this.openingDamage, stats: this.stats }; }
}
