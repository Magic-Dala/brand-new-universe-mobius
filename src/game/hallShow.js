// v0.48 the Arcade hall on the beat and on the combo (design 6.1 and 6.2). This file starts with the three pure
// functions (no three.js); the HallShow class below them drives the v0.31 hall's uniforms from the Arcade's clock.
export const HALL_SHOW = {
  tierFrac: [0.15, 0.35, 0.60],
  swing: [0.12, 0.16, 0.20, 0.25],        // brightness swing per show level
  attack: 0.04, decay: 0.15, maxHz: 3,
  missDip: { amount: 0.30, time: 0.35 },
  chorus: { dimTo: 0.35, burst: 0.40, burstTime: 0.30 },
  hueBars: 4, corridorPad: 1.5, corridorMax: 0.05,
  reactEvery: 8, reactThrowGap: 0.6, tauntMisses: 2, tauntGap: 8,
  // 2026-11-15 (feedback: the hall still feels boring): per show level 0 … 3
  hop: [0.10, 0.16, 0.22, 0.30],   // how high the decorative pumpkins jump on the beat (m, times the pumpkin's size)
  wash: [0.10, 0.22, 0.34, 0.46],  // how far the walls take the accent colour on the beat
  band: [0.6, 0.8, 1.0, 1.0],
  ceil: [1.5, 2.0, 2.5, 3.0],      // 2026-11-15: how much stronger the ceiling lamps, their light cones and floor pools are while the show runs (added to 1)      // the light band that runs down the hall on each pulse, as a share of the swing
};
/** Combo needed for show levels 1, 2, 3: fractions of the chart's rhythm events. */
export function tierThresholds(eventCount, frac = HALL_SHOW.tierFrac) { return frac.map((f) => Math.max(1, Math.round(eventCount * f))); }
/** Show level 0 … 3. It rises when the combo reaches a threshold and never falls by itself; a miss drops ONE level, not to zero. */
export function showLevel(prev, combo, thresholds, missed) {
  if (missed) return Math.max(0, prev - 1);
  let lv = 0; for (const n of thresholds) if (combo >= n) lv++;
  return Math.max(prev, lv);
}
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** The pulse period for a beat length: every beat, or every other beat while the beat is faster than maxHz. */
export function pulsePeriod(beatSec, cfg = HALL_SHOW) { let p = beatSec; while (p > 0 && 1 / p > cfg.maxHz + 1e-9) p *= 2; return p; }
/**
 * Beat envelope 0 … 1: a smooth pulse whose peak is ON the beat. It rises over `attack` seconds before the beat and
 * falls over at least `decay` seconds after it (longer on slow songs), with no step anywhere.
 */
export function beatEnvelope(now, beatSec, offsetSec, cfg = HALL_SHOW) {
  if (!(beatSec > 0)) return 0;
  const period = pulsePeriod(beatSec, cfg);
  const fall = Math.min(period - cfg.attack, Math.max(cfg.decay, 0.6 * (period - cfg.attack)));
  let ph = (now - offsetSec + cfg.attack) % period; if (ph < 0) ph += period; // 0 = the start of the rise
  if (ph < cfg.attack) return smooth(ph / cfg.attack);
  return 1 - smooth((ph - cfg.attack) / fall);
}
/** Brightness swing of a show level (comfort mode halves it). */
export function swingFor(level, comfort = false, cfg = HALL_SHOW) { return cfg.swing[Math.max(0, Math.min(cfg.swing.length - 1, level | 0))] * (comfort ? 0.5 : 1); }

// ---------------------------------------------------------------------------------------------------------------
// HallShow: turns the Arcade's music clock, the combo and a few events into the numbers the v0.31 hall's setShow()
// takes. It owns no object in the scene. The old v0.30 hall has no setShow and gets nothing.
// ---------------------------------------------------------------------------------------------------------------
/** Accent colours of the wall strips and LEDs (mean of r, g, b = 1, so the brightness of a strip does not change). The first is today's purple. */
export const ACCENTS = [[0.867, 0.4, 1.733], [1.75, 0.91, 0.34], [1.59, 0.31, 1.1]]; // purple, amber, magenta
const lerp = (a, b, k) => a + (b - a) * k;
const REST = Object.freeze({});

export class HallShow {
  constructor(app) { this.app = app; this.active = false; this._reset(); }
  _reset() {
    this._level = 0; this._lv = 0; this.thresholds = [1, 1, 1]; this.sections = null; this.clock = null; this.bpb = 4;
    this._hue = ACCENTS[0].slice(); this._dipT = -1; this._dip = 0; this._flare = 0; this._wave = -1; this._bursts = []; this._downbeat = 0; this._lastBar = -1;
    this._on = 0; this._hits = 0; this._misses = 0; this._tauntT = -99; this.react = null; this.out = null; this.gain = 0;
    this._reactDue = -1; this._reacts = 0; this._tauntDue = false; this._taunts = 0; this.levelEvent = null;
  }
  get level() { return this._level; }
  get hall() { const h = this.app?.interior; return h && typeof h.setShow === 'function' ? h : null; }
  /** eventCount: the chart's rhythm events; sections: [{ fromBar, toBar, kind }] or null; clock: the chart's beat clock; on: settings.arcadeShow */
  start({ eventCount, sections = null, clock = null, beatsPerBar = 4, on = true }) {
    this._reset();
    this.active = !!on; this.thresholds = tierThresholds(eventCount); this.sections = Array.isArray(sections) && sections.length ? sections : null; this.clock = clock; this.bpb = beatsPerBar || 4;
    // a chorus burst: over the bar before a section marked as a chorus the hall dims, then one burst (a chart without sections has none)
    this.choruses = (this.sections || []).filter((s) => s.kind === 'chorus' && s.fromBar >= 1).map((s) => s.fromBar * this.bpb);
    this.hall?.setShow();
  }
  /**
   * now: song time; beatSec: the beat length now; offsetSec: when beat 0 falls (chart offset + the player's offset);
   * combo: the score keeper's combo; comfort: settings.comfortMode; beat (optional): the beat number now from the
   * chart's clock (follows tempo changes; without it the beat is taken from now, beatSec and offsetSec).
   */
  update(dt, { now, beatSec, offsetSec = 0, combo = 0, comfort = false, beat = null, nextThrowIn = Infinity }) {
    if (!this.active) return;
    // Green Maniac: a hit reaction after every reactEvery hits in a row, never within reactThrowGap before a throw (it waits
    // for a gap, at most 2 s); a taunt after tauntMisses misses in a row, at most once per tauntGap seconds
    if (this._reactDue >= 0) { this._reactDue += dt; if (nextThrowIn >= HALL_SHOW.reactThrowGap) { this.react = { kind: 'hit', variant: this._reacts++ % 2 ? 'body' : 'head' }; this._reactDue = -1; } else if (this._reactDue > 2) this._reactDue = -1; }
    if (this._tauntDue && now - this._tauntT >= HALL_SHOW.tauntGap) { this.react = { kind: 'taunt', n: this._taunts++ }; this._tauntT = now; }
    this._tauntDue = false;
    const C = HALL_SHOW, k = comfort ? 0.5 : 1;
    const b = beat ?? (beatSec > 0 ? (now - offsetSec) / beatSec : 0), period = pulsePeriod(beatSec), mult = Math.max(1, Math.round(period / beatSec));
    const tIn = (((b % mult) + mult) % mult) * beatSec; // seconds since the last pulse beat (beat domain: follows tempo changes)
    const env = beatEnvelope(tIn, beatSec, 0), fall = Math.min(period - C.attack, Math.max(C.decay, 0.6 * (period - C.attack)));
    const phase = (((tIn + C.attack) % period) + period) % period / period;
    // show level (a miss was already applied in onEvent); the swing follows it smoothly
    { const lv = showLevel(this._level, combo, this.thresholds, false); if (lv > this._level) this.levelEvent = { up: true, level: lv }; this._level = lv; }
    this._lv += (this._level - this._lv) * Math.min(1, dt * 3);
    const i0 = Math.min(2, Math.floor(this._lv)), swing = lerp(C.swing[i0], C.swing[i0 + 1], this._lv - i0) * k;
    // accent colour: one step every hueBars bars, cross-faded
    const bar = Math.floor(b / this.bpb), want = ACCENTS[((Math.floor(Math.max(0, bar) / C.hueBars) % ACCENTS.length) + ACCENTS.length) % ACCENTS.length];
    for (let i = 0; i < 3; i++) this._hue[i] += (want[i] - this._hue[i]) * Math.min(1, dt * 2.5);
    if (bar !== this._lastBar) { this._lastBar = bar; if (bar >= 0) this._downbeat++; }
    // gain: the chorus dim and its one burst, and the miss dip (S4)
    let gain = 0;
    for (const cb of this.choruses) {
      const d = b - cb; // beats from the chorus start
      if (d >= -this.bpb && d < 0) gain += (C.chorus.dimTo - 1) * k * smooth((d + this.bpb) / this.bpb) * (1 - smooth((d + 0.5) / 0.5)); // dims over the bar, lets go in its last half beat
      else if (d >= 0) { const t = d * beatSec; if (t < C.chorus.burstTime && this._burstFor !== cb) { this._burstFor = cb; this.burstEvent = true; } if (t < C.chorus.burstTime) gain += C.chorus.burst * k * (t < C.attack ? smooth(t / C.attack) : 1 - smooth((t - C.attack) / (C.chorus.burstTime - C.attack))); }
    }
    if (this._dipT >= 0) { // a miss: down in 60 ms, back up over the rest of missDip.time
      this._dipT += dt; const T = C.missDip.time, a = 0.06;
      const s = this._dipT < a ? smooth(this._dipT / a) : 1 - smooth((this._dipT - a) / (T - a));
      if (this._dipT >= T) this._dipT = -1; else gain -= C.missDip.amount * k * s;
    }
    this._flare = Math.max(0, this._flare - dt / 0.3); // candle flare: up at once in onEvent (smoothed below), down over 0.3 s
    this._flareS = (this._flareS || 0) + (this._flare - (this._flareS || 0)) * Math.min(1, dt / 0.05);
    if (this._wave >= 0) { this._wave += dt; if (this._wave > 1.6) this._wave = -1; }
    const wv = this._wave >= 0 ? this._wave / 1.6 : 0;
    this.gain = gain;
    this.out = {
      beat: env, level: this._level, dip: gain, hue: this._hue, swing, phase, attack: C.attack / period, fall: fall / period,
      chase: this._lv >= 0.5 ? 0.5 * Math.min(1, this._lv) : 0, // level 1: the side lamps chase front to back
      strips: Math.max(0, Math.min(1, this._lv - 1)),            // level 2: wall strips and LEDs pulse
      flare: Math.min(swing, this._flareS * swing),              // level 3 / the energy wave: decorative pumpkins flare (candle brightness only)
      streak: 0.15 * Math.max(0, Math.min(1, this._lv - 2)),     // level 3: brighter floor streaks
      wave: this._wave >= 0 ? Math.sin(Math.PI * wv) : 0, waveR: 2 + 22 * wv, // a Fan Web row cleared: a wave runs outward along the floor streaks
      downbeat: this._downbeat,
      ceil: lerp(C.ceil[i0], C.ceil[i0 + 1], this._lv - i0) * k * Math.min(1, this._on = (this._on || 0) + dt / 1.5), // fades in over 1.5 s at the start
      hop: lerp(C.hop[i0], C.hop[i0 + 1], this._lv - i0) * k,               // decorative pumpkins jump on the beat
      wash: lerp(C.wash[i0], C.wash[i0 + 1], this._lv - i0) * k * (0.35 + 0.65 * env), // the accent colour breathes on the walls
      band: swing * lerp(C.band[i0], C.band[i0 + 1], this._lv - i0), bandPos: phase, // a band of light runs from the player's end to the door
    };
    this.hall?.setShow(this.out);
  }
  /** 'miss' | 'perfect' | 'fanRow' | 'wave' (and 'good', which only counts toward Green Maniac's reactions) */
  onEvent(type) {
    if (!this.active) return;
    if (type === 'miss') {
      const lv = showLevel(this._level, 0, this.thresholds, true); if (lv < this._level) this.levelEvent = { up: false, level: lv };
      this._level = lv; this._dipT = 0; this._hits = 0; if (++this._misses >= HALL_SHOW.tauntMisses) { this._tauntDue = true; this._misses = 0; }
    } else if (type === 'perfect' || type === 'good') {
      this._misses = 0; if (++this._hits % HALL_SHOW.reactEvery === 0) this._reactDue = 0;
      if (type === 'perfect' && this._level >= 3) this._flare = 1;
    }
    else if (type === 'wave') this._flare = 1;
    else if (type === 'fanRow') this._wave = 0;
  }
  /** Green Maniac's pending reaction ({ kind: 'hit', variant } | { kind: 'taunt', n }) or null; reading it clears it. */
  takeReact() { const r = this.react; this.react = null; return r; }
  /** true once when a chorus burst starts (for its sound) */
  takeBurst() { const b = !!this.burstEvent; this.burstEvent = false; return b; }
  /** a show level change since the last call ({ up, level }) or null */
  takeLevelEvent() { const e = this.levelEvent; this.levelEvent = null; return e; }
  stop() { if (this.active) this.hall?.setShow(); this.active = false; this.out = null; }
}
