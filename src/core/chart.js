// Chart (譜面) format v1 – see docs/CHART_FORMAT.md
//
// {
//   "format": "mobius-chart", "version": 1,
//   "song": { "id", "title", "artist", "audio": { "src", "originalName" }, "durationSec" },
//   "timing": { "bpm": 125, "offsetSec": 0.31, "beatsPerBar": 4,
//               "tempoMap": [ { "beat": 0, "bpm": 125 } ]   // optional, for tempo changes
//             },
//   "difficulties": { "easy": { "travelSec": 2.4, "events": [...] }, "normal": {...}, "hard": {...} }
// }
// event: { "id": "n12", "beat": 16, "type": "pumpkin"|"heavy"|"fan_web_row"|"armored",
//          "hand": "L"|"R"|"any"|"both", "lane": { "x": -1..1, "y": 0..1 } }
// v1.1: `cluster` is retired (still accepted: it loads as an ordinary pumpkin for either hand). Every chart keeps the
// rules of src/game/chartRules.js (never three arrivals at once outside a Fan Web row, one job per pumpkin).
// Event time = offsetSec + seconds(beat) via tempo map. Never assumes beat 0 at t=0.

export const CHART_FORMAT = 'mobius-chart';
export const CHART_VERSION = 1;
export const TYPES = ['pumpkin', 'cluster', 'heavy', 'fan_web_row', 'armored'];
export const HANDS = ['L', 'R', 'any', 'both'];
/**
 * v0.22 `fan_web_row`: a row of three ordinary pumpkin bombs, one per lane (tracks [0,1,2]), arriving on the
 * SAME beat — answered by the two-hand Fan Web (扇形光網). One rhythm event: judged once for the whole row.
 *   { "id": "f1", "beat": 40, "type": "fan_web_row", "hand": "both", "tracks": [0,1,2], "cue": "fan", "practice": true }
 * practice: a miss costs no shield and does not break the combo (the first row of a chart = tutorial).
 */
export const ROW_TYPE = 'fan_web_row';
import { ARMORED, ARMORED_TYPE, applyArmored, addArmored } from '../game/armored.js';
import { CHART_RULES, enforceThree, fitRules } from '../game/chartRules.js';
export { addArmored };

/** Build beat→seconds converter from a tempo map. */
export function makeBeatClock(timing) {
  const map = (timing.tempoMap && timing.tempoMap.length ? timing.tempoMap : [{ beat: 0, bpm: timing.bpm }])
    .slice().sort((a, b) => a.beat - b.beat);
  // precompute segment start seconds
  const segs = [];
  let sec = 0;
  for (let i = 0; i < map.length; i++) {
    const s = map[i];
    if (i > 0) { const p = map[i - 1]; sec += (s.beat - p.beat) * 60 / p.bpm; }
    segs.push({ beat: s.beat, bpm: s.bpm, sec });
  }
  const offset = timing.offsetSec || 0;
  return {
    beatToSec(beat) {
      let s = segs[0];
      for (const g of segs) if (g.beat <= beat) s = g; else break;
      return offset + s.sec + (beat - s.beat) * 60 / s.bpm;
    },
    secToBeat(t) {
      const x = t - offset;
      let s = segs[0];
      for (const g of segs) if (g.sec <= x) s = g; else break;
      return s.beat + (x - s.sec) * s.bpm / 60;
    },
    bpmAt(beat) { let s = segs[0]; for (const g of segs) if (g.beat <= beat) s = g; return s.bpm; },
  };
}

export function validateChart(c) {
  const err = (m) => { throw new Error(m); };
  if (!c || typeof c !== 'object') err('not an object');
  if (c.format !== CHART_FORMAT) err(`format must be "${CHART_FORMAT}"`);
  if (c.version !== CHART_VERSION) err(`unsupported version ${c.version}`);
  if (!c.song?.id) err('song.id missing');
  if (!c.song?.audio?.src && !c.song?.audio?.storeKey) err('song.audio.src missing');
  const tm = c.timing;
  if (!tm || !(tm.bpm > 20 && tm.bpm < 400)) err('timing.bpm must be 20–400');
  if (typeof tm.offsetSec !== 'number') err('timing.offsetSec must be a number');
  if (!c.difficulties || !Object.keys(c.difficulties).length) err('no difficulties');
  for (const [d, diff] of Object.entries(c.difficulties)) {
    if (!Array.isArray(diff.events)) err(`${d}.events must be an array`);
    const ids = new Set();
    for (const e of diff.events) {
      if (typeof e.beat !== 'number' || e.beat < 0) err(`${d}: bad beat in ${JSON.stringify(e)}`);
      if (!TYPES.includes(e.type)) err(`${d}: bad type ${e.type}`);
      if (!HANDS.includes(e.hand)) err(`${d}: bad hand ${e.hand}`);
      if (ids.has(e.id)) err(`${d}: duplicate id ${e.id}`);
      if (e.type === ROW_TYPE) {
        const tr = e.tracks || [0, 1, 2];
        if (!Array.isArray(tr) || tr.length !== 3 || new Set(tr).size !== 3 || tr.some((x) => ![0, 1, 2].includes(x))) err(`${d}: ${e.id} tracks must be three distinct lanes 0..2`);
        if (e.hand !== 'both') err(`${d}: ${e.id} fan_web_row hand must be "both"`);
      }
      if (e.type === ARMORED_TYPE) { // v0.48: `beat` = the first shell beat; hits shell beats one beat apart, the wave `gap` beats after the last
        if (e.hits !== undefined && !(Number.isInteger(e.hits) && e.hits >= 1 && e.hits <= 6)) err(`${d}: ${e.id} armored hits must be 1..6`);
        if (e.gap !== undefined && !(e.gap > 0 && e.gap <= 8)) err(`${d}: ${e.id} armored gap must be 0..8 beats`);
        if (e.step !== undefined && !(e.step > 0 && e.step <= 4 && Number.isInteger(e.step * 2))) err(`${d}: ${e.id} armored step must be 0.5..4 beats in half beats`); // v1.1
      }
      ids.add(e.id);
    }
  }
  return c;
}

/**
 * Resolve a difficulty into sorted runtime notes with absolute times. v1.1: a stored `cluster` loads as an ordinary
 * pumpkin for either hand, and the loader's guard (enforceThree) keeps at most two arrivals inside any 0.35 s outside a
 * Fan Web row — so hand-written charts and imported songs already stored in a browser keep the rule too. `dropped`: the
 * ids it removed.
 */
export function resolveNotes(chart, difficulty, { armored = false } = {}) {
  const clock = makeBeatClock(chart.timing);
  const diff = chart.difficulties[difficulty] || chart.difficulties.normal || Object.values(chart.difficulties)[0];
  const notes = [], sequences = [];
  // v0.48: armored off (the default here, and settings.arcadeArmored = false) drops the armored events and keeps every
  // other event: the v0.46 event count. On: the other events inside a sequence's free beats are dropped.
  for (const e of applyArmored(diff.events, armored)) {
    const time = e.timeSec ?? clock.beatToSec(e.beat);
    if (e.type === ARMORED_TYPE) {
      const hits = e.hits ?? ARMORED.hits, gap = e.gap ?? 2, step = e.step ?? 1; // (v1.1 step: beats between shell beats)
      sequences.push({ id: e.id, beat: e.beat, hits, gap, step, time, shellTimes: Array.from({ length: hits }, (_, i) => clock.beatToSec(e.beat + i * step)), waveTime: clock.beatToSec(e.beat + (hits - 1) * step + gap), holdTime: clock.beatToSec(e.beat - 1) });
      continue;
    }
    if (e.type === ROW_TYPE) { // one row → three member bombs (same time, one per lane); judged as ONE event
      (e.tracks || [0, 1, 2]).forEach((track, k) => notes.push({ id: `${e.id}.${k}`, beat: e.beat, time, type: 'fanRow', hand: 'both', track, row: e.id, member: k, practice: !!e.practice, cue: e.cue || 'fan', lane: { x: track - 1, y: 0.5 } }));
      continue;
    }
    if (e.type === 'cluster') { const { group, ...rest } = e; void group; notes.push({ ...rest, type: 'pumpkin', hand: 'any', time, lane: { x: e.lane?.x ?? 0, y: e.lane?.y ?? 0.5 } }); continue; } // v1.1: retired
    notes.push({ ...e, time, lane: { x: e.lane?.x ?? 0, y: e.lane?.y ?? 0.5 } });
  }
  notes.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  sequences.sort((a, b) => a.time - b.time);
  const { notes: kept, dropped } = enforceThree(notes, CHART_RULES); // v1.1: never three at once
  return { notes: kept, sequences, travelSec: diff.travelSec || 2.0, clock, dropped };
}

// ===========================================================================
// Procedural chart generator – used for the official track (offline script)
// and for imported songs (runtime). Deterministic given inputs.
// sections: [{ fromBar, toBar, kind: 'intro'|'verse'|'verse2'|'build'|'chorus'|'outro' }]
// ===========================================================================
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const DIFF_PARAMS = {
  easy: { travelSec: 2.5, chorusEighths: false, verseEvery: 2, chorusEvery: 2, heavies: 'rare' },
  normal: { travelSec: 2.05, chorusEighths: false, verseEvery: 1, chorusEvery: 1, heavies: 'some' },
  hard: { travelSec: 1.7, chorusEighths: true, verseEvery: 1, chorusEvery: 0.5, heavies: 'many' },
};

/**
 * Procedural events for one difficulty. v1.1: every step comes from the difficulty's minGap in SECONDS (chartRules.js),
 * not from a fixed number of beats, so the same patterns stay playable from 80 to 200 BPM (a step that would be too
 * short at this tempo is lengthened: 1 → 1.5 → 2 … beats). The `cluster` of three is retired: its slot becomes an
 * ordinary pumpkin, or — on an accent (the first beat of a four-bar phrase in a loud section) when the Light Bomb has had
 * bombGap seconds since the last one — a giant pumpkin. Giant pumpkins go on accents only. fitRules() in buildChart
 * makes sure whatever is left keeps every rule.
 */
export function generateEvents({ totalBars, sections, beatsPerBar = 4, difficulty = 'normal', seed = 1, lastBeat = Infinity, bpm = 120, rules = CHART_RULES }) {
  const P = DIFF_PARAMS[difficulty];
  const R = rng(seed * 97 + difficulty.length * 13);
  const spb = 60 / bpm, minB = (rules.minGap[difficulty] ?? rules.minGap.normal) / spb; // the shortest step in beats
  const fit = (want) => { for (const s of [want, 1, 1.5, 2, 3, 4, 6, 8]) if (s >= want - 1e-9 && s >= minB - 1e-9) return s; return 8; };
  const ev = [];
  let n = 0, side = 1, phrase = 0;
  const kindAt = (bar) => (sections.find((s) => bar >= s.fromBar && bar < s.toBar) || { kind: 'verse' }).kind;
  let lastBomb = -Infinity;
  const push = (beat, type, hand, x, y) => {
    if (beat > lastBeat) return;
    ev.push({ id: `n${n++}`, beat: Math.round(beat * 1000) / 1000, type, hand, lane: { x: +x.toFixed(2), y: +y.toFixed(2) } });
  };
  const handFor = (s) => (s < 0 ? 'L' : 'R');
  const bombAllowed = (beat) => (beat - lastBomb) * spb >= rules.bombGap; // the Light Bomb's spacing, in seconds
  const heavyBar = (barInPhrase) => P.heavies === 'many' || P.heavies === 'some' ? barInPhrase === 0 : barInPhrase === 0 && phrase % 2 === 0;
  for (let bar = 0; bar < totalBars; bar++) {
    const kind = kindAt(bar);
    const b0 = bar * beatsPerBar;
    if (kind === 'intro') continue;
    const barInPhrase = bar % 4;
    if (barInPhrase === 0) phrase++;
    const lateralPattern = [0.75, 0.45, 0.85, 0.35][phrase % 4];

    if (kind === 'verse' || kind === 'verse2') {
      const step = fit(kind === 'verse' ? Math.max(2, P.verseEvery * 2) : P.verseEvery);
      for (let k = 0; k < beatsPerBar; k += step) {
        const beat = b0 + k;
        side = -side;
        const y = 0.3 + 0.4 * ((k / beatsPerBar + bar * 0.37) % 1);
        push(beat, 'pumpkin', handFor(side), side * lateralPattern, y);
      }
      // two-hand accent at phrase start (verse2)
      if (kind === 'verse2' && barInPhrase === 0 && difficulty !== 'easy') {
        push(b0 + 0.001, 'pumpkin', 'L', -0.95, 0.7);
        const first = ev.find((e) => e.beat === b0 && e.type === 'pumpkin' && e.hand !== 'L' && Math.abs(e.lane.x) > 0);
        if (first) { first.hand = 'R'; first.lane.x = 0.95; } else push(b0, 'pumpkin', 'R', 0.95, 0.7);
      }
    } else if (kind === 'build') {
      // rising stream, alternating, climbing height
      const step = fit(difficulty === 'hard' ? 0.5 : 1);
      for (let k = 0; k < beatsPerBar; k += step) {
        side = -side;
        push(b0 + k, 'pumpkin', handFor(side), side * (0.3 + 0.15 * k), 0.15 + 0.2 * k);
      }
    } else if (kind === 'chorus') {
      const every = fit(P.chorusEvery >= 2 ? 2 : 1), eighth = P.chorusEighths && 0.5 >= minB - 1e-9;
      for (let k = 0; k < beatsPerBar; k += every) {
        const beat = b0 + k;
        if (k === 0 && heavyBar(barInPhrase) && bombAllowed(beat)) { // the accent: the phrase's first beat in a loud section
          push(beat, 'heavy', 'any', (R() - 0.5) * 0.8, 0.6); lastBomb = beat; continue;
        }
        side = -side;
        const zig = (k % 2 ? 0.45 : 0.85) * side;
        push(beat, 'pumpkin', handFor(side), zig, 0.25 + 0.5 * R());
        if (eighth && (k === 1 || k === 3)) {
          side = -side;
          push(beat + 0.5, 'pumpkin', handFor(side), side * 0.6, 0.35 + 0.3 * R());
        }
        // doubles on beat 3 every other bar (both hands) – normal & hard
        if (difficulty !== 'easy' && k === 2 && barInPhrase === 1) {
          push(beat + 0.001, 'pumpkin', handFor(-side), -side * 0.9, 0.75);
        }
      }
    } else if (kind === 'outro') {
      const step = fit(2);
      for (let k = 0; k < beatsPerBar; k += step) { side = -side; if (barInPhrase % 2 === 0 || k === 0) push(b0 + k, 'pumpkin', handFor(side), side * 0.6, 0.5); }
    }
  }
  return { travelSec: P.travelSec, events: ev };
}

/**
 * Insert fan_web_row events at the given beats (the first one is a practice row). Every other event within
 * `clearBefore` beats before / `clearAfter` after a row is removed, so no conflicting one-hand gesture is
 * asked for around the two-hand attack.
 */
export function addFanRows(diff, beats, { clearBefore = 1.5, clearAfter = 1.0, prefix = 'f' } = {}) {
  if (!beats?.length) return diff;
  diff.events = diff.events.filter((e) => !beats.some((b) => e.beat > b - clearBefore - 1e-6 && e.beat < b + clearAfter + 1e-6));
  beats.forEach((b, k) => diff.events.push({ id: `${prefix}${k}`, beat: b, type: ROW_TYPE, hand: 'both', tracks: [0, 1, 2], cue: 'fan', ...(k === 0 ? { practice: true } : {}) }));
  diff.events.sort((a, b) => a.beat - b.beat || a.id.localeCompare(b.id));
  return diff;
}

export function buildChart({ song, timing, sections, totalBars, lastBeat, seed = 1, fanRows = null, armored = true, rules = CHART_RULES }) {
  const chart = {
    format: CHART_FORMAT, version: CHART_VERSION,
    song, timing: { beatsPerBar: 4, ...timing },
    generator: { name: 'mobius-chartgen', version: 2, seed, sections },
    difficulties: {},
  };
  const bpm = chart.timing.bpm, spb = 60 / bpm, clock = makeBeatClock(chart.timing);
  const clear = { clearBefore: Math.max(rules.rowClear.beatsBefore, rules.rowClear.before / spb), clearAfter: Math.max(rules.rowClear.beatsAfter, rules.rowClear.after / spb) }; // (v1.1: seconds, never less than 1.5 / 1 beats)
  for (const d of ['easy', 'normal', 'hard']) {
    chart.difficulties[d] = generateEvents({ totalBars, sections, difficulty: d, seed, lastBeat, beatsPerBar: chart.timing.beatsPerBar, bpm, rules });
    if (fanRows?.[d]) addFanRows(chart.difficulties[d], fanRows[d], clear);
  }
  if (armored) addArmored(chart, ARMORED, rules.minGap); // v0.48: armored pumpkin sequences, placed by rule (any chart); v1.1: with `step` where a beat is shorter than minGap
  for (const d of ['easy', 'normal', 'hard']) chart.difficulties[d].events = fitRules(chart.difficulties[d].events, clock, d, rules); // v1.1: never a violation
  return validateChart(chart);
}

/** Simple section guess for imported songs from a per-bar energy curve (0..1). */
export function guessSections(barEnergy) {
  const n = barEnergy.length;
  const sorted = [...barEnergy].sort((a, b) => a - b);
  const hi = sorted[Math.floor(n * 0.6)] ?? 0.5;
  const sections = [];
  const introBars = Math.min(2, n);
  sections.push({ fromBar: 0, toBar: introBars, kind: 'intro' });
  for (let b = introBars; b < n; b++) {
    const kind = b >= n - 2 ? 'outro' : barEnergy[b] >= hi ? 'chorus' : b % 8 < 4 ? 'verse' : 'verse2';
    const last = sections[sections.length - 1];
    if (last.kind === kind) last.toBar = b + 1; else sections.push({ fromBar: b, toBar: b + 1, kind });
  }
  return sections;
}
