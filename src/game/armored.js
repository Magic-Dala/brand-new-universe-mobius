// v0.48 armored pumpkin (new Arcade note type `armored`): pure rules, no three.js, no DOM.
// Design 6.3 with docs/goals/v048-armored-pumpkin-decision.md: THREE shell beats (one per beat, a web from either
// hand cracks one layer), then the energy-wave beat `gap` beats after the last shell beat. One chart event starts a
// sequence on the centre lane:  { "id": "a0", "beat": 44, "type": "armored", "hand": "both", "hits": 3, "gap": 2 }
// `beat` is the FIRST shell beat. Song-agnostic: nothing here knows a song.
export const ARMORED = { hits: 3, waveGap: { easy: 2, normal: 2, hard: 1 }, waveWeight: 3, perChart: 3, freeBeats: 8, everyBars: 32 };
export const ARMORED_TYPE = 'armored';

/** Sections of a chart (hand-authored `sections`, or the generator's), or null. [{ fromBar, toBar, kind }] */
export function chartSections(chart) { const s = chart?.sections || chart?.generator?.sections; return Array.isArray(s) && s.length ? s : null; }
/** Beats of a sequence that starts on `beat`: its shell beats, its wave beat, and the beats it needs free of other notes. */
export function seqBeats(beat, hits = ARMORED.hits, gap = 2, freeBeats = ARMORED.freeBeats) {
  const shells = Array.from({ length: hits }, (_, i) => beat + i), wave = beat + hits - 1 + gap;
  return { shells, wave, from: wave - freeBeats + 1, to: wave + 1 }; // other notes with from − ε < beat < to are dropped
}
const EPS = 1e-6;
/** True when `beat` lies inside the free window of an armored event (the window is closed at its start, open at its end). */
export function inWindow(beat, ev, cfg = ARMORED) { const w = seqBeats(ev.beat, ev.hits ?? cfg.hits, ev.gap ?? 2, cfg.freeBeats); return beat > w.from - EPS && beat < w.to - EPS; }

/**
 * Where the sequences of a chart start (first shell beat of each), for one difficulty.
 * With sections: `perChart` sequences. The last one puts its wave on the final note of the song; the others take the
 * section ends and the middles of long sections that lie closest to an even spread over the song. A place whose free
 * window would swallow a Fan Web row (or end right before one) moves by whole bars until it does not, or is dropped.
 * Without sections: one about every `everyBars` bars, and one at the end.
 */
export function placeArmored(chart, difficulty, cfg = ARMORED) {
  const diff = chart?.difficulties?.[difficulty]; if (!diff?.events?.length) return [];
  const bpb = chart.timing?.beatsPerBar || 4, gap = cfg.waveGap[difficulty] ?? 2, span = cfg.hits - 1 + gap;
  const others = diff.events.filter((e) => e.type !== ARMORED_TYPE);
  if (!others.length) return [];
  const first = Math.min(...others.map((e) => e.beat)), last = Math.max(...others.map((e) => e.beat));
  const rows = others.filter((e) => e.type === 'fan_web_row').map((e) => e.beat);
  const lastWave = Math.round(last); // the wave of the last sequence falls on the final note
  if (lastWave - cfg.freeBeats + 1 < first) return []; // a chart too short for even one
  const taken = [lastWave];
  const free = (wave) => wave - cfg.freeBeats + 1 >= first && wave <= lastWave - cfg.freeBeats - 1 // room before the last one
    && !rows.some((r) => r > wave - cfg.freeBeats + 1 - EPS && r < wave + 2 + EPS)
    && !taken.some((w) => Math.abs(w - wave) < cfg.freeBeats * 2);
  const settle = (wave) => { for (const off of [0, -1, 1, -2, 2]) { const w = wave + off * bpb; if (free(w)) return w; } return null; };
  const sections = chartSections(chart);
  if (sections) {
    const cands = [];
    for (const s of sections) {
      if (s.kind === 'intro') continue;
      cands.push(s.toBar * bpb - 1); // the last beat of the section
      if (s.toBar - s.fromBar >= 8) cands.push(Math.floor((s.fromBar + s.toBar) / 2) * bpb - 1); // the middle of a long one
    }
    const want = cfg.perChart - 1;
    for (let k = 1; k <= want; k++) {
      const ideal = first + (lastWave - first) * (k / (want + 1));
      const sorted = cands.slice().sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal));
      for (const c of sorted) { const w = settle(c); if (w !== null) { taken.push(w); break; } }
    }
  } else {
    for (let w = cfg.everyBars * bpb - 1; w < lastWave; w += cfg.everyBars * bpb) { const s = settle(w); if (s !== null) taken.push(s); }
  }
  return taken.sort((a, b) => a - b).map((w) => w - span);
}
/** The chart events for a difficulty (ids a0, a1, …). */
export function armoredEvents(chart, difficulty, cfg = ARMORED) {
  const gap = cfg.waveGap[difficulty] ?? 2;
  return placeArmored(chart, difficulty, cfg).map((beat, k) => ({ id: `a${k}`, beat, type: ARMORED_TYPE, hand: 'both', hits: cfg.hits, gap }));
}
/** Add armored events to every difficulty of a chart (generator and import path). Existing ones are replaced. Nothing else is removed. */
export function addArmored(chart, cfg = ARMORED) {
  for (const [d, diff] of Object.entries(chart.difficulties || {})) {
    diff.events = diff.events.filter((e) => e.type !== ARMORED_TYPE);
    diff.events.push(...armoredEvents(chart, d, cfg));
    diff.events.sort((a, b) => a.beat - b.beat || String(a.id).localeCompare(String(b.id)));
  }
  return chart;
}
/**
 * What a difficulty's events become when the chart loads. on = false: the armored events are dropped and every other
 * event stays (the v0.46 event count). on = true: the other events inside a sequence's free window are dropped.
 */
export function applyArmored(events, on, cfg = ARMORED) {
  const arm = events.filter((e) => e.type === ARMORED_TYPE);
  if (!on || !arm.length) return events.filter((e) => e.type !== ARMORED_TYPE);
  return events.filter((e) => e.type === ARMORED_TYPE || !arm.some((a) => inWindow(e.beat, a, cfg)));
}

/** One sequence at run time: which layers are still on, and how it ends. */
export class ArmoredSeq {
  constructor({ beat, hits = ARMORED.hits, gap = 2 }) {
    this.beat = beat; this.hits = hits; this.gap = gap;
    this.shell = new Array(hits).fill(null); // null = not judged yet | 'hit' | 'miss'
    this.outcome = null; // null | 'full' | 'partial' | 'miss'
  }
  get shellBeats() { return this.shell.map((_, i) => this.beat + i); }
  get waveBeat() { return this.beat + this.hits - 1 + this.gap; }
  /** layers still on */
  get layers() { return this.hits - this.shell.filter((s) => s === 'hit').length; }
  /** which mesh shows: stage_<n>, n = layers removed (0 … hits) */
  get stage() { return this.hits - this.layers; }
  /** charge pips lit on the hands: one per layer removed */
  get charge() { return this.stage; }
  get done() { return this.outcome !== null; }
  /** shell beat i answered in time: one layer off. Returns the layers left (unchanged if that beat was already judged). */
  shellHit(i) { if (!this.done && this.shell[i] === null) this.shell[i] = 'hit'; return this.layers; }
  /** shell beat i went by: that layer stays on. Nothing grows back. */
  shellMiss(i) { if (!this.done && this.shell[i] === null) this.shell[i] = 'miss'; return this.layers; }
  /** the energy wave arrived in its window: 'full' with every layer off, else 'partial' (it still destroys it; Good at best). */
  wave() { if (this.done) return this.outcome; for (let i = 0; i < this.hits; i++) if (this.shell[i] === null) this.shell[i] = 'miss'; this.outcome = this.layers === 0 ? 'full' : 'partial'; return this.outcome; }
  /** no wave: a miss, and it explodes on the player. */
  expire() { if (!this.done) this.outcome = 'miss'; return this.outcome; }
}
