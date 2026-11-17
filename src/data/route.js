// Dala City route (路線) — the sequence of modules the player swings through. Pure data.
//
// Story prefix (fixed, reproducible): start (home tower A, window) → 5 straight blocks → right turn →
// the factory block (the factory closes the avenue at its far end) → factory exit → endless.
// Endless (seeded): straight residential / commercial runs, left & right turns and crossroads.
// Rules: the route keeps a main direction (the heading leaving the factory) and only ever heads
// main or main ± 90° (a staircase), so it can never loop back onto itself; at least `minStraight`
// straights between turns; at most `maxSideRun` tiles sideways. Crossroads offer the exits allowed
// by those rules; while Green Maniac leads they resolve to his (seeded) choice, afterwards the player
// chooses by swinging into one exit (CityWorld commits it). Same seed + same choices → same route.
import { CITY_CFG } from './cityConfig.js';
import { MODULES, STORY_TILES, STEP, exitHeading } from './blocks.js';
import { mulberry32, hashInt } from './box.js';

const E = CITY_CFG.endless;
const STORY_PREFIX = [...STORY_TILES, { kind: 'factoryExit', flyIn: 22, flyOut: 40 }];
export const STORY_TILE_COUNT = STORY_TILES.length; // 8: start, 5 straights, turn, factory
export const FACTORY_TILE = STORY_TILES.findIndex((t) => t.kind === 'factory'); // 7
export const EXIT_TILE = FACTORY_TILE + 1; // 8

const key = (i, j) => `${i},${j}`;

export class RouteGen {
  constructor({ seed = CITY_CFG.seed, storySeed = CITY_CFG.storySeed } = {}) {
    this.seed = seed; this.storySeed = storySeed;
    this.tiles = []; this.used = new Set();
    this.leadUntil = EXIT_TILE + E.leadTiles; // crossroads before this resolve automatically (boss lead)
    this.choiceHash = 0x2545;
    for (const def of STORY_PREFIX) this._push(def);
    const last = this.tiles.at(-1);
    this.main = last.exitHeading;
    this.st = { heading: this.main, sinceTurn: 2, sideRun: 0, theme: 'res', themeLeft: 3, fly: last.fly.out };
  }
  _push(def, st = null) {
    const prev = this.tiles.at(-1);
    const heading = prev ? prev.exitHeading : 0;
    const cell = prev ? [prev.cell[0] + STEP[heading][0], prev.cell[1] + STEP[heading][1]] : [0, 0];
    const idx = this.tiles.length, M = MODULES[def.kind];
    const exit = def.exit ?? (M.exits.length === 1 ? M.exits[0] : null);
    const t = {
      idx, kind: def.kind, variant: def.variant ?? 0, theme: def.theme || M.theme, cell, heading,
      exits: M.exits.slice(), exit, exitHeading: exit ? exitHeading(heading, exit) : null,
      seed: idx < STORY_PREFIX.length ? hashInt(this.storySeed, idx * 31 + 1) >>> 0 : hashInt(this.seed, idx * 7919 + (this.choiceHash & 0xffff)) >>> 0,
      fly: { in: def.flyIn ?? 50, out: def.flyOut ?? def.flyIn ?? 50 }, minH: def.minH, maxH: def.maxH,
      story: idx < STORY_TILE_COUNT, tag: `t${idx}`, preferred: def.preferred || exit || 'N', allowed: def.allowed || null,
    };
    this.tiles.push(t); this.used.add(key(...cell));
    if (st) Object.assign(this.st, st);
    return t;
  }
  get length() { return this.tiles.length; }
  /** The first unresolved crossroads (route stops there until a choice), or null. */
  get pending() { const t = this.tiles.at(-1); return t && !t.exit ? t : null; }

  /** Generate committed tiles up to index n (stops at an unresolved crossroads). */
  ensure(n) {
    while (this.tiles.length <= n) {
      const last = this.tiles.at(-1);
      if (!last.exit) { // crossroads waiting for a choice
        if (last.idx < this.leadUntil) this.choose(last.idx, last.preferred); else return false;
        continue;
      }
      const { def, st } = this._decide(this.tiles.length, this.st, last, this.choiceHash);
      this._push(def, st);
    }
    return true;
  }
  /** Commit the exit of a crossroads tile; generation continues from there. */
  choose(idx, exit) {
    const t = this.tiles[idx];
    if (!t || t.kind !== 'cross' || t.exit) return false;
    if (!(t.allowed || t.exits).includes(exit)) return false;
    t.exit = exit; t.exitHeading = exitHeading(t.heading, exit);
    this.choiceHash = hashInt(this.choiceHash, idx * 3 + ['N', 'W', 'E'].indexOf(exit) + 1);
    const nh = t.exitHeading;
    this.st.sideRun = nh === this.main ? 0 : this.st.sideRun + (t.heading === nh ? 1 : 1);
    this.st.sinceTurn = nh === t.heading ? this.st.sinceTurn + 1 : 0;
    this.st.heading = nh;
    return true;
  }
  /**
   * Preview the tiles that would follow each allowed exit of the crossroads at idx (not committed).
   * Deterministic: committing that exit later generates exactly these tiles.
   */
  candidates(idx, depth = 2) {
    const t = this.tiles[idx];
    if (!t || t.kind !== 'cross' || t.exit) return [];
    return (t.allowed || t.exits).map((exit) => {
      const g = this._clone(); g.choose(idx, exit); g.leadUntil = -1;
      const out = [];
      for (let k = 1; k <= depth; k++) { if (!g.ensure(idx + k)) break; out.push(g.tiles[idx + k]); }
      return { exit, heading: exitHeading(t.heading, exit), tiles: out };
    });
  }
  _clone() {
    const g = Object.create(RouteGen.prototype);
    g.seed = this.seed; g.storySeed = this.storySeed; g.main = this.main; g.leadUntil = this.leadUntil; g.choiceHash = this.choiceHash;
    g.tiles = this.tiles.map((t) => ({ ...t })); g.used = new Set(this.used); g.st = { ...this.st };
    return g;
  }

  // ------------------------------------------------------------ endless rules
  _decide(idx, st, last, choiceHash) {
    const r = mulberry32(hashInt(this.seed + idx * 7919, choiceHash));
    const s = { ...st };
    const main = this.main, heading = last.exitHeading;
    s.heading = heading;
    if (--s.themeLeft <= 0) { s.theme = s.theme === 'res' ? 'com' : 'res'; s.themeLeft = s.theme === 'res' ? 3 + Math.floor(r() * 4) : 2 + Math.floor(r() * 3); }
    const flyOut = E.flyH[s.theme] + (r() - 0.5) * 12;
    const straight = () => ({ def: { kind: s.theme === 'com' ? 'straightCom' : 'straightRes', variant: Math.floor(r() * 4), flyIn: s.fly, flyOut }, st: { ...s, sinceTurn: s.sinceTurn + 1, sideRun: heading === main ? 0 : s.sideRun + 1, fly: flyOut } });
    const toward = (h) => { const d = (h - heading + 4) % 4; return d === 1 ? 'E' : d === 3 ? 'W' : d === 0 ? 'N' : null; };
    const free = (h) => { const c = [last.cell[0] + STEP[last.exitHeading][0] + STEP[h][0], last.cell[1] + STEP[last.exitHeading][1] + STEP[h][1]]; return !this.used.has(key(...c)); };
    const turn = (exit) => {
      const nh = exitHeading(heading, exit);
      if (!free(nh)) return straight();
      return { def: { kind: exit === 'E' ? 'turnR' : 'turnL', variant: Math.floor(r() * 3), flyIn: s.fly, flyOut, minH: 40 }, st: { ...s, sinceTurn: 0, sideRun: nh === main ? 0 : 1, heading: nh, fly: flyOut } };
    };
    if (s.sinceTurn < E.minStraight) return straight();
    const side = heading !== main;
    const back = toward(main); // exit that returns to the main heading (side runs only)
    if (side && s.sideRun >= E.maxSideRun) return turn(back);
    const roll = r();
    const crossExits = ['N', 'W', 'E'].filter((ex) => { const nh = exitHeading(heading, ex); const d = (nh - main + 4) % 4; return d !== 2 && (nh === main || !side || nh === heading) && free(nh); });
    if (side) {
      if (roll < 0.35) return turn(back);
      if (roll < 0.5 && crossExits.length > 1) return this._cross(r, s, crossExits, back, flyOut);
      return straight();
    }
    if (roll < E.pTurn) return turn(r() < 0.5 ? 'E' : 'W');
    if (roll < E.pTurn + E.pCross && crossExits.length > 1) return this._cross(r, s, crossExits, 'N', flyOut);
    return straight();
  }
  _cross(r, s, allowed, prefer, flyOut) {
    const preferred = r() < 0.55 ? prefer : allowed[Math.floor(r() * allowed.length)];
    return { def: { kind: 'cross', variant: Math.floor(r() * 3), flyIn: s.fly, flyOut, allowed, preferred: allowed.includes(preferred) ? preferred : allowed[0] }, st: { ...s, fly: flyOut } };
  }
}
