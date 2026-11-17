// Builds an Arcade chart from a song's analysis (scripts/charts/<id>.analysis.json, written by analyze-song.py).
// Pure and deterministic: the same analysis and options always give the same chart (byte for byte once serialised).
// The notes follow the music, inside the rules of src/game/chartRules.js:
//   1. armored pumpkins on the song's held notes and runs (the same places on every difficulty), the wave on the beat
//      that ends them;
//   2. Fan Web rows on strong downbeats of phrase and section starts, at least `fanSpacing` s apart;
//   3. giant pumpkins (Light Bomb) on the strongest accents only;
//   4. ordinary pumpkins on the beats (and, on Hard, the off-beats) with the strongest onsets, more in loud sections,
//      none in the intro or the outro, nothing (Easy / Normal) or little (Hard) in a breakdown;
//   5. a rest of at least `rest` s in every `restEvery` s, at most `peak4s[d]` events in any 4 s;
//   6. hands alternate inside a phrase and walk across the lanes; doubles (left + right) at phrase starts.
// Every choice is recorded in `report` (printed by scripts/generate-chart.mjs) so a person can check it against the song.
import { CHART_FORMAT, CHART_VERSION, makeBeatClock, validateChart, resolveNotes } from '../../src/core/chart.js';
import { CHART_RULES, chartViolations, fitRules } from '../../src/game/chartRules.js';
import { ARMORED, armoredStep } from '../../src/game/armored.js';

const DIFFS = ['easy', 'normal', 'hard'];
export const DEFAULTS = {
  travelSec: { easy: 2.5, normal: 2.05, hard: 1.7 },
  rate: { easy: 0.95, normal: 1.7, hard: 2.45 }, // target rhythm events per second, first note to last
  peak4s: { easy: 6, normal: 10, hard: 14 }, // most events in any 4 s
  fanRows: { easy: 5, normal: 7, hard: 8 }, // Fan Web rows (the first is practice)
  fanSpacing: 8, // s between rows
  giants: { easy: 4, normal: 'per20', hard: 'per13' }, // giant pumpkins: a count, or one per 20 s / 13.5 s of play
  giantSpacing: { easy: 18, normal: 11, hard: 7.5 }, // s at least between giant pumpkins
  armored: { min: 2, max: 5, every: 40, spacing: 20 }, // armored pumpkins: about one per `every` s of play, ≥ spacing s apart
  rest: 4.0, restEvery: 45, // a rest of at least `rest` s in every `restEvery` s (0 = no rule)
  // how busy each kind of section is (relative); a breakdown (a 'break' quieter than breakEnergy) stays empty on Easy and
  // Normal, a quieter stretch above it plays like a light verse; the intro is light (and its first bars empty)
  weight: { chorus: 1.25, verse: 0.85, light: 0.6, break: { easy: 0, normal: 0, hard: 0.3 }, intro: 0.3, outro: 0 },
  breakEnergy: 0.45,
  emptyIntroBars: 2,
};

const r3 = (x) => Math.round(x * 1000) / 1000;

/**
 * a: the analysis JSON; song: the chart's `song` block; opts: DEFAULTS overrides.
 * Returns { chart, report } — report: { [difficulty]: { stats, giants: [...], armored: [...], rows: [...] } }.
 */
export function buildFromAnalysis(a, song, opts = {}) {
  const O = { ...DEFAULTS, ...opts, weight: { ...DEFAULTS.weight, ...(opts.weight || {}) } };
  const R = CHART_RULES, bpm = a.tempo.bpm, spb = 60 / bpm, bpb = a.beatsPerBar || 4;
  const timing = { bpm, offsetSec: a.offsetSec, beatsPerBar: bpb, tempoMap: [{ beat: 0, bpm }], analysis: { method: 'scripts/charts/analyze-song.py (librosa onsets, kick-band beat grid, section entrances / chord changes for the downbeat)', file: `scripts/charts/${a.id}.analysis.json` } };
  const clock = makeBeatClock(timing), T = (b) => clock.beatToSec(b);
  const onset = a.slots.onset, kick = a.slots.kick, loud = a.slots.loud;
  const slotOf = (b) => Math.round(b * 2);
  const at = (arr, b) => arr[slotOf(b)] ?? 0;
  const sections = a.sections.map(({ fromBar, toBar, kind }) => ({ fromBar, toBar, kind }));
  // how each section is played: a quiet 'break' is a breakdown; a louder one plays like a light verse
  const play = a.sections.map((s) => (s.kind === 'break' && s.energy >= O.breakEnergy ? 'light' : s.kind));
  const secAt = (b) => sections.findIndex((s) => b >= s.fromBar * bpb && b < s.toBar * bpb);
  const kindAt = (b) => { const i = secAt(b); return i < 0 ? 'outro' : play[i]; };
  const phraseStart = (b) => { const i = secAt(b); return i >= 0 && (barOf(b) - sections[i].fromBar) % 4 === 0; }; // phrases counted from the section's start
  const barOf = (b) => Math.floor(b / bpb), beatOfBar = (b) => +(b - barOf(b) * bpb).toFixed(2);
  const where = (b) => ({ sec: r3(T(b)), bar: barOf(b), beat: beatOfBar(b) + 1 }); // beat of the bar counted from 1

  // ---------------------------------------------------------------- the playable span
  const played = sections.filter((s) => s.kind === 'verse' || s.kind === 'chorus');
  const firstBeat = O.emptyIntroBars * bpb; // the intro's first bars stay empty
  const endBeat = Math.min(played.at(-1).toBar * bpb, (a.musicEndSec - a.offsetSec) / spb); // nothing after the music
  let lastBeat = firstBeat;
  { // the last note on the last strong hit: the strongest beat of the last bar of music
    const from = Math.max(firstBeat, Math.floor(endBeat) - 2 * bpb);
    let best = -1;
    for (let b = Math.floor(endBeat) - 1; b >= from; b--) { const v = at(onset, b) + 0.5 * at(kick, b); if (v > best + 0.15) { best = v; lastBeat = b; } }
  }
  const playSec = T(lastBeat) - T(firstBeat);

  // ---------------------------------------------------------------- armored pumpkins: held notes and runs (all difficulties)
  const nArm = Math.max(O.armored.min, Math.min(O.armored.max, Math.round(playSec / O.armored.every)));
  const armCands = [...(a.runs || []).map((r) => ({ ...r, score: 0.6 * r.busier + 0.4 * r.strength + (r.sectionChange ? 0.4 : 0) })), ...(a.held || []).map((h) => ({ ...h, score: h.strength + 0.1 * h.beats }))]
    .filter((c) => c.endBeat - 8 >= firstBeat + 4 && c.endBeat <= lastBeat && ['verse', 'chorus'].includes(kindAt(c.endBeat - 1)))
    .sort((x, y) => y.score - x.score || x.endBeat - y.endBeat);
  const waves = [];
  for (const c of armCands) {
    if (waves.length >= nArm) break;
    if (waves.some((w) => Math.abs(T(w.endBeat) - T(c.endBeat)) < O.armored.spacing)) continue;
    waves.push(c);
  }
  waves.sort((x, y) => x.endBeat - y.endBeat);
  const armWindow = (W) => [W - Math.max(ARMORED.freeBeats, 2 * 2 + 2 + 2) + 1, W + 1]; // the free beats of the longest form (step 2, gap 2)

  // ---------------------------------------------------------------- accents
  const accents = (a.accents || []).filter((x) => x.beat >= firstBeat && x.beat <= lastBeat);
  const accentTimes = accents.map((x) => T(x.beat));

  const chart = { format: CHART_FORMAT, version: CHART_VERSION, song, timing, sections, generator: { name: 'mobius-chartgen-analysis', version: 1 }, difficulties: {} };
  const report = { span: { first: where(firstBeat), last: where(lastBeat), musicEndSec: a.musicEndSec }, armored: waves.map((w) => ({ wave: where(w.endBeat), kind: w.kind, why: w.kind === 'run' ? `a run of ${w.hits} strong hits (slots ${w.fromSlot}–${w.toSlot}) into ${w.sectionChange ? 'a section change' : 'the next downbeat'}` : `a held sound of ${w.beats} beats from ${r3(a.offsetSec + w.fromSlot * spb / 2)} s with no new hit` })) };

  for (const d of DIFFS) {
    const minGap = R.minGap[d], gap = ARMORED.waveGap[d] ?? 2, step = armoredStep(bpm, minGap);
    const events = []; let id = 0;
    const blocked = []; // [fromBeat, toBeat) where no ordinary pumpkin may go
    // armored
    waves.forEach((w, k) => {
      const beat = w.endBeat - gap - (ARMORED.hits - 1) * step;
      events.push({ id: `a${k}`, beat, type: 'armored', hand: 'both', hits: ARMORED.hits, gap, ...(step !== 1 ? { step } : {}) });
      const [f, t] = armWindow(w.endBeat); blocked.push([f, t + 0.5]);
    });
    // giant pumpkins on accents
    const nG = O.giants[d] === 'per20' ? Math.round(playSec / 20) : O.giants[d] === 'per13' ? Math.round(playSec / 13.5) : O.giants[d];
    const giants = [];
    for (const x of accents.slice().sort((p, q) => q.strength - p.strength || p.beat - q.beat)) {
      if (giants.length >= nG) break;
      const b = x.beat;
      if (blocked.some(([f, t]) => b > f - 2 && b < t + 1)) continue;
      if (giants.some((g) => Math.abs(T(g.beat) - T(b)) < Math.max(O.giantSpacing[d], R.bombGap))) continue;
      giants.push(x);
    }
    giants.sort((p, q) => p.beat - q.beat);
    for (const g of giants) events.push({ id: `n${id++}`, beat: g.beat, type: 'heavy', hand: 'any', lane: { x: 0, y: 0.6 } });
    // fan rows
    const nRows = O.fanRows[d];
    const rowCands = [];
    for (let bar = barOf(firstBeat) + 1; bar * bpb <= lastBeat - bpb; bar++) {
      const b = bar * bpb, k = kindAt(b); if (k !== 'verse' && k !== 'chorus' && k !== 'light') continue;
      const entry = sections.some((s) => s.fromBar === bar && (s.kind === 'verse' || s.kind === 'chorus'));
      const i = secAt(b), inPhrase = (bar - sections[i].fromBar) % 4;
      if (!entry && inPhrase % 2 !== 0) continue; // section entries, phrase starts, and the half-way bar of a phrase
      if (blocked.some(([f, t]) => b > f - 3 && b < t + 2) || giants.some((g) => Math.abs(T(g.beat) - T(b)) < 1.5)) continue; // (giant pumpkins have the accents first)
      rowCands.push({ beat: b, score: at(onset, b) + at(kick, b) + (entry ? 0.6 : 0) + (inPhrase === 0 ? 0.4 : 0) + (k === 'chorus' ? 0.2 : 0) });
    }
    // as many rows as wanted (up to nRows) at least fanSpacing apart, and among those the strongest set (a small DP)
    const rc = rowCands.slice().sort((x, y) => x.beat - y.beat), nC = rc.length;
    const best = Array.from({ length: nC }, () => new Array(nRows + 1).fill(null)); // best[i][k]: { score, prev } for k rows ending at i
    for (let i = 0; i < nC; i++) {
      best[i][1] = { score: rc[i].score, prev: -1 };
      for (let j = 0; j < i; j++) {
        if (T(rc[i].beat) - T(rc[j].beat) < O.fanSpacing) continue;
        for (let k = 2; k <= nRows; k++) { const b = best[j][k - 1]; if (b && (!best[i][k] || b.score + rc[i].score > best[i][k].score)) best[i][k] = { score: b.score + rc[i].score, prev: j }; }
      }
    }
    let rows = [];
    for (let k = nRows; k >= 1 && !rows.length; k--) {
      let end = -1; for (let i = 0; i < nC; i++) if (best[i][k] && (end < 0 || best[i][k].score > best[end][k].score)) end = i;
      if (end < 0) continue;
      for (let i = end, kk = k; i >= 0 && kk >= 1; i = best[i][kk].prev, kk--) rows.push(rc[i].beat);
    }
    rows.sort((x, y) => x - y);
    rows.forEach((b, k) => { events.push({ id: `f${k}`, beat: b, type: 'fan_web_row', hand: 'both', tracks: [0, 1, 2], cue: 'fan', ...(k === 0 ? { practice: true } : {}) }); });
    const rowZone = (b) => rows.some((r) => { const dt = T(b) - T(r); return dt > -Math.max(R.rowClear.before, R.rowClear.beatsBefore * spb) - 1e-6 && dt < Math.max(R.rowClear.after, R.rowClear.beatsAfter * spb) + 1e-6; });
    const heavyZone = (b) => giants.some((g) => Math.abs(T(b) - T(g.beat)) < R.heavyClear + 1e-6 || (Math.abs(b - g.beat) < 1e-6));

    // ---- ordinary pumpkins: the strongest onsets, section by section
    const fixedCount = rows.length + waves.length * (ARMORED.hits + 1) + giants.length;
    const target = Math.round(O.rate[d] * playSec) - fixedCount;
    const cands = [];
    for (let s = slotOf(firstBeat); s <= slotOf(lastBeat); s++) {
      const b = s / 2, half = s % 2 === 1, k = kindAt(b);
      const w = typeof O.weight[k] === 'object' ? O.weight[k][d] : O.weight[k] ?? 0;
      if (!w) continue;
      if (b < firstBeat || b > lastBeat) continue;
      if (blocked.some(([f, t]) => b > f - 1e-6 && b < t - 1e-6) || rowZone(b) || heavyZone(b)) continue;
      const bb = beatOfBar(b);
      if (d === 'easy' && !(bb === 0 || bb === 2)) continue; // strong beats only
      const fast = d === 'normal' && spb < minGap - 1e-9; // a beat shorter than Normal's minGap (170 BPM): dotted steps, 3 + 3 + 3 + 3 + 4 half beats over two bars
      if (fast) { const i = secAt(b), g = i >= 0 ? (b - sections[i].fromBar * bpb) % (2 * bpb) : b % (2 * bpb); if (![0, 1.5, 3, 4.5, 6].some((x) => Math.abs(g - x) < 1e-6)) continue; }
      const sv = onset[s] + 0.35 * kick[s];
      if (half && !fast) { // an off-beat only where the music has one
        if (d === 'easy') continue;
        const syncop = onset[s] >= 0.3 && onset[s] > Math.min(onset[s - 1] ?? 0, onset[s + 1] ?? 0); // Hard: stronger than a neighbouring beat
        const dotted = spb < minGap - 1e-9 && onset[s] >= 0.15; // a beat shorter than minGap (Normal at 170 BPM): dotted steps on the off-beats the music plays
        if (!(d === 'hard' ? syncop : dotted)) continue;
      }
      const strongBeat = !half && (bb === 0 || bb === 2);
      cands.push({ b, s, k, w, score: sv * (half ? (fast ? 0.9 : 0.7) : 1) + (strongBeat ? 0.12 : 0) + (bb === 0 ? 0.05 : 0) });
    }
    // budget per section: weight × duration
    const secList = sections.map((sec, i) => ({ i, ...sec, kind: play[i], f: Math.max(sec.fromBar * bpb, firstBeat), t: Math.min(sec.toBar * bpb, lastBeat + 1) })).filter((sec) => sec.t > sec.f);
    const wsum = secList.reduce((acc, sec) => acc + (typeof O.weight[sec.kind] === 'object' ? O.weight[sec.kind][d] : O.weight[sec.kind] ?? 0) * (T(sec.t) - T(sec.f)), 0) || 1;
    const chosen = [];
    const fixedTimes = [...giants.map((g) => T(g.beat))];
    const ok = (b) => {
      const t = T(b);
      for (const c of chosen) { const dt = Math.abs(T(c.b) - t); if (dt < minGap - 1e-6) return false; }
      for (const ft of fixedTimes) if (Math.abs(ft - t) < Math.max(minGap, R.heavyClear) - 1e-6) return false;
      return true;
    };
    for (const sec of secList) {
      const w = typeof O.weight[sec.kind] === 'object' ? O.weight[sec.kind][d] : O.weight[sec.kind] ?? 0;
      if (!w) continue;
      const want = Math.round((target * w * (T(sec.t) - T(sec.f))) / wsum);
      const pool = cands.filter((c) => c.b >= sec.f && c.b < sec.t).sort((x, y) => y.score - x.score || x.b - y.b);
      let n = 0;
      for (const c of pool) { if (n >= want) break; if (ok(c.b)) { chosen.push(c); n++; } }
    }
    // a section that could not take its share (its beats are too close for this difficulty, or too few) hands the rest to
    // the loud sections: chorus first, then verse, then the lighter ones, strongest onsets first
    { const order = { chorus: 0, verse: 1, light: 2, break: 3, intro: 4 }; let deficit = target - chosen.length;
      const rest = cands.filter((c) => !chosen.includes(c)).sort((x, y) => (order[x.k] ?? 9) - (order[y.k] ?? 9) || y.score - x.score || x.b - y.b);
      for (const c of rest) { if (deficit <= 0) break; if (ok(c.b)) { chosen.push(c); deficit--; } } }
    chosen.sort((x, y) => x.b - y.b);
    // always the last strong hit
    if (!chosen.some((c) => Math.abs(c.b - lastBeat) < 1e-6) && !heavyZone(lastBeat) && !rowZone(lastBeat) && !blocked.some(([f, t]) => lastBeat > f - 1e-6 && lastBeat < t - 1e-6)) {
      for (let i = chosen.length - 1; i >= 0 && T(lastBeat) - T(chosen[i].b) < minGap; i--) chosen.splice(i, 1);
      chosen.push({ b: lastBeat, s: slotOf(lastBeat), k: kindAt(lastBeat), score: 9 });
    }
    // ---- rests: at least one gap of O.rest s in every O.restEvery s
    const arrivals = () => [...chosen.map((c) => T(c.b)), ...giants.map((g) => T(g.beat)), ...rows.map((r) => T(r)), ...waves.flatMap((w) => { const bt = w.endBeat - gap - (ARMORED.hits - 1) * step; return [0, 1, 2].map((i) => T(bt + i * step)).concat([T(w.endBeat)]); })].sort((x, y) => x - y);
    const restsOf = (arr) => { const out = []; for (let i = 1; i < arr.length; i++) if (arr[i] - arr[i - 1] >= O.rest) out.push([arr[i - 1], arr[i]]); return out; };
    if (O.restEvery) {
      for (let guard = 0; guard < 40; guard++) {
        const arr = arrivals(), rests = restsOf(arr), t0 = arr[0], t1 = arr.at(-1);
        // the first stretch longer than restEvery without a rest
        let from = t0, need = null;
        for (const [ra, rb] of [...rests, [t1, Infinity]]) { if (ra - from > O.restEvery) { need = [from, Math.min(ra, from + O.restEvery)]; break; } from = rb; }
        if (!need) break;
        // the quietest O.rest + 0.2 s span inside it that holds only ordinary pumpkins
        const span = O.rest + 0.2; let best = null;
        for (let x = need[0] + 1; x + span <= need[1] - 0.5; x += spb / 2) {
          const xa = x, xb = x + span;
          if (giants.some((g) => T(g.beat) > xa - 0.05 && T(g.beat) < xb + 0.05) || rows.some((r) => T(r) > xa - 0.05 && T(r) < xb + 0.05)) continue;
          if (waves.some((w) => { const bt = w.endBeat - gap - (ARMORED.hits - 1) * step; return T(w.endBeat) > xa - 0.05 && T(bt) < xb + 0.05; })) continue;
          const inside = chosen.filter((c) => T(c.b) > xa && T(c.b) < xb);
          const cost = inside.reduce((acc, c) => acc + c.score, 0) + (inside.some((c) => c.b === lastBeat) ? 99 : 0);
          if (!best || cost < best.cost) best = { xa, xb, cost };
        }
        if (!best) break;
        for (let i = chosen.length - 1; i >= 0; i--) if (T(chosen[i].b) > best.xa && T(chosen[i].b) < best.xb) chosen.splice(i, 1);
      }
    }
    // ---- doubles: phrase starts in loud sections (Normal); every bar of a chorus and every other bar of a verse (Hard)
    const doubles = new Set();
    if (d !== 'easy') for (const c of chosen) {
      const bb = beatOfBar(c.b), bar = barOf(c.b);
      const want = d === 'normal' ? bb === 0 && phraseStart(c.b) && c.k === 'chorus' : bb === 0 && (c.k === 'chorus' || (c.k === 'verse' && (phraseStart(c.b) || phraseStart(c.b - 2 * bpb)))); // Hard: every bar of a chorus, every other bar of a verse
      if (!want) continue;
      const near = arrivals().filter((t) => Math.abs(t - T(c.b)) > 1e-6 && Math.abs(t - T(c.b)) < R.window + 0.01);
      if (!near.length) doubles.add(c.b);
    }
    // ---- peak density: at most O.peak4s[d] events in any 4 s (the weakest ordinary pumpkins go)
    for (let guard = 0; guard < 200; guard++) {
      const ev = [...chosen.flatMap((c) => (doubles.has(c.b) ? [c, c] : [c])).map((c) => ({ t: T(c.b), c })), ...arrivals().filter((t) => !chosen.some((c) => Math.abs(T(c.b) - t) < 1e-6)).map((t) => ({ t, c: null }))].sort((x, y) => x.t - y.t);
      let worst = null;
      for (let i = 0, j = 0; i < ev.length; i++) { while (ev[i].t - ev[j].t >= 4 - 1e-9) j++; if (i - j + 1 > O.peak4s[d]) { worst = ev.slice(j, i + 1); break; } }
      if (!worst) break;
      const victim = worst.filter((x) => x.c && x.c.b !== lastBeat).sort((x, y) => (doubles.has(y.c.b) ? 1 : 0) - (doubles.has(x.c.b) ? 1 : 0) || x.c.score - y.c.score)[0];
      if (!victim) break;
      if (doubles.has(victim.c.b)) doubles.delete(victim.c.b); else chosen.splice(chosen.indexOf(victim.c), 1);
    }
    // ---- hands and lanes: alternate inside a phrase (starting right), walk across the lanes
    const WALK = [0.85, 0.0, 0.85, 0.45, 0.85, 0.0, 0.45, 0.0];
    let phrase = -1, kq = 0;
    for (const c of chosen) {
      const ph = Math.floor(barOf(c.b) / 4); if (ph !== phrase) { phrase = ph; kq = 0; }
      const y = +(0.35 + 0.3 * ((beatOfBar(c.b) / bpb + (barOf(c.b) % 4) * 0.25) % 1)).toFixed(2);
      if (doubles.has(c.b)) {
        events.push({ id: `n${id++}`, beat: c.b, type: 'pumpkin', hand: 'L', lane: { x: -0.95, y: 0.7 } });
        events.push({ id: `n${id++}`, beat: c.b, type: 'pumpkin', hand: 'R', lane: { x: 0.95, y: 0.7 } });
        kq = 0; continue;
      }
      const right = kq % 2 === 0, x = WALK[kq % WALK.length] * (right ? 1 : -1);
      events.push({ id: `n${id++}`, beat: c.b, type: 'pumpkin', hand: right ? 'R' : 'L', lane: { x: +x.toFixed(2), y } });
      kq++;
    }
    events.sort((x, y) => x.beat - y.beat || String(x.id).localeCompare(String(y.id)));
    // the rules' own last pass must have nothing left to do
    const fitted = fitRules(events, clock, d, R);
    if (fitted.length !== events.length) throw new Error(`${song.id} ${d}: fitRules removed ${events.length - fitted.length} events (${events.filter((e) => !fitted.includes(e)).map((e) => e.id).join(', ')})`);
    chart.difficulties[d] = { travelSec: O.travelSec[d], events };
    report[d] = { giants: giants.map((g) => ({ ...where(g.beat), why: g.reason, strength: g.strength })), rows: rows.map((b) => where(b)), step, gap };
  }
  validateChart(chart);
  // ---- stats and the rules, as the game loads the chart (armored pumpkins on)
  for (const d of DIFFS) {
    const { notes, sequences, dropped } = resolveNotes(chart, d, { armored: true });
    const v = chartViolations(notes, d, R, { accents: accentTimes, sequences, secPerBeat: spb });
    report[d].stats = statsFor(notes, sequences);
    report[d].violations = v; report[d].dropped = dropped;
  }
  return { chart, report };
}

/** Rhythm events (a row counts once, an armored pumpkin hits + 1) with their times; densities, rests, first and last. */
export function statsFor(notes, sequences) {
  const ev = [];
  const rows = new Map();
  for (const n of notes) { if (n.row) { rows.set(n.row, n.time); continue; } ev.push({ t: n.time, type: n.type }); }
  for (const [, t] of rows) ev.push({ t, type: 'fan_web_row' });
  for (const q of sequences) { for (const t of q.shellTimes) ev.push({ t, type: 'armored shell' }); ev.push({ t: q.waveTime, type: 'armored wave' }); }
  ev.sort((a, b) => a.t - b.t);
  const by = {}; for (const e of ev) by[e.type] = (by[e.type] || 0) + 1;
  const first = ev[0].t, last = ev.at(-1).t;
  let peak = 0, peakAt = 0; for (let i = 0, j = 0; i < ev.length; i++) { while (ev[i].t - ev[j].t >= 4 - 1e-9) j++; if (i - j + 1 > peak) { peak = i - j + 1; peakAt = ev[j].t; } }
  const rests = []; for (let i = 1; i < ev.length; i++) if (ev[i].t - ev[i - 1].t >= 4) rests.push([r3(ev[i - 1].t), r3(ev[i].t)]);
  let longestNoRest = 0, from = first; for (const [a, b] of [...rests, [last, last]]) { longestNoRest = Math.max(longestNoRest, a - from); from = b; }
  return { total: ev.length, byType: by, first: r3(first), last: r3(last), perSec: +(ev.length / (last - first)).toFixed(2), peak4s: peak, peakAt: r3(peakAt), rests, longestWithoutRest: +longestNoRest.toFixed(1), sequences: sequences.length };
}
