// v1.1 Arcade songs: the three built-in charts are rebuilt from their analyses byte for byte, keep every rule of
// src/game/chartRules.js on every difficulty, and are written the way docs/CHART_FORMAT.md describes (density, rests,
// Fan Web rows, giant pumpkins on accents only, armored pumpkins on runs / held notes, nothing after the music).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { SONGS, build } = await import('../scripts/generate-chart.mjs');
const { resolveNotes, validateChart } = await import('../src/core/chart.js');
const { CHART_RULES, chartViolations } = await import('../src/game/chartRules.js');
const { statsFor } = await import('../scripts/charts/build-chart.mjs');
const D = ['easy', 'normal', 'hard'];
const load = (id) => JSON.parse(readFileSync(new URL(`../public/songs/${id}/chart.json`, import.meta.url), 'utf8'));
const analysis = (id) => JSON.parse(readFileSync(new URL(`../scripts/charts/${id}.analysis.json`, import.meta.url), 'utf8'));
const NEW = ['cyber-boss-phase-2', 'catch-the-light'];

test('npm run chart rebuilds all three charts byte for byte from the committed analyses', () => {
  for (const s of SONGS) {
    const { chart } = build(s);
    assert.equal(JSON.stringify(chart, null, 1), readFileSync(new URL(`../public/songs/${s.id}/chart.json`, import.meta.url), 'utf8'), s.id);
  }
});

test('every built-in chart on every difficulty: no rule broken (armored on and off), no cluster, nothing dropped by the loader', () => {
  let n = 0;
  for (const s of SONGS) {
    const c = validateChart(load(s.id)), a = analysis(s.id), spb = 60 / c.timing.bpm;
    const clock = (b) => c.timing.offsetSec + b * spb;
    const accents = a.accents.map((x) => clock(x.beat));
    for (const d of D) {
      assert.ok(!c.difficulties[d].events.some((e) => e.type === 'cluster'), `${s.id} ${d}: no cluster`);
      for (const armored of [true, false]) {
        const { notes, sequences, dropped } = resolveNotes(c, d, { armored });
        const v = chartViolations(notes, d, CHART_RULES, { accents, sequences, secPerBeat: spb });
        assert.deepEqual(v, [], `${s.id} ${d} armored ${armored}`); assert.deepEqual(dropped, []);
      }
      n++;
    }
  }
  assert.equal(n, 9);
});

test('the two new songs: density, peaks, rests, rows, giant and armored pumpkins as the chart table says', () => {
  const want = { easy: [0.8, 1.1, 6, [4, 6]], normal: [1.4, 1.9, 10, [6, 8]], hard: [2.0, 2.6, 14, [8, 10]] };
  for (const id of NEW) {
    const c = load(id), a = analysis(id), spb = 60 / c.timing.bpm, T = (b) => c.timing.offsetSec + b * spb;
    const waves = {};
    for (const d of D) {
      const { notes, sequences } = resolveNotes(c, d, { armored: true }), st = statsFor(notes, sequences);
      const [lo, hi, peak, [r0, r1]] = want[d];
      assert.ok(st.perSec >= lo && st.perSec <= hi, `${id} ${d}: ${st.perSec} events/s`);
      assert.ok(st.peak4s <= peak, `${id} ${d}: ${st.peak4s} in 4 s`);
      assert.ok(st.longestWithoutRest <= 45, `${id} ${d}: a rest of 4 s in every 45 s (longest stretch ${st.longestWithoutRest} s)`);
      const ev = c.difficulties[d].events, rows = ev.filter((e) => e.type === 'fan_web_row');
      assert.ok(rows.length >= r0 && rows.length <= r1, `${id} ${d}: ${rows.length} rows`);
      assert.ok(rows[0].practice === true && rows.slice(1).every((r) => !r.practice), 'the first row is practice');
      for (let i = 1; i < rows.length; i++) assert.ok(T(rows[i].beat) - T(rows[i - 1].beat) >= 8 - 1e-6, `${id} ${d}: rows ≥ 8 s apart`);
      for (const r of rows) assert.equal(r.beat % 4, 0, 'rows on downbeats');
      const giants = ev.filter((e) => e.type === 'heavy'), playSec = st.last - st.first;
      for (const g of giants) assert.ok(a.accents.some((x) => x.beat === g.beat), `${id} ${d}: giant pumpkin at beat ${g.beat} is on an accent`);
      if (d === 'easy') assert.ok(giants.length >= 3 && giants.length <= 4, `${id} easy: ${giants.length} giants`);
      if (d === 'normal') assert.ok(Math.abs(playSec / giants.length - 20) <= 6, `${id} normal: one giant per ${(playSec / giants.length).toFixed(1)} s`);
      if (d === 'hard') assert.ok(playSec / giants.length >= 11 && playSec / giants.length <= 17, `${id} hard: one giant per ${(playSec / giants.length).toFixed(1)} s`);
      const arm = ev.filter((e) => e.type === 'armored');
      assert.ok(arm.length >= 2 && arm.length <= 5, `${id} ${d}: ${arm.length} armored`);
      waves[d] = sequences.map((q) => +q.waveTime.toFixed(3));
      for (let i = 1; i < sequences.length; i++) assert.ok(sequences[i].waveTime - sequences[i - 1].waveTime >= 20, 'armored ≥ 20 s apart');
      for (const q of sequences) {
        assert.ok([...a.runs, ...a.held].some((x) => Math.abs(T(x.endBeat) - q.waveTime) < 1e-6), `${id} ${d}: the wave at ${q.waveTime.toFixed(2)} s ends a run or a held note`);
        for (const g of giants) assert.ok(T(g.beat) < q.holdTime - CHART_RULES.heavyClear || T(g.beat) > q.waveTime + CHART_RULES.heavyClear, 'a giant pumpkin never overlaps an armored sequence');
        for (let i = 1; i < q.shellTimes.length; i++) assert.ok(q.shellTimes[i] - q.shellTimes[i - 1] >= CHART_RULES.minGap[d] - 1e-6, 'shell beats ≥ minGap apart');
      }
      // the intro's first two bars are empty; nothing after the music
      assert.ok(st.first >= T(8) - 1e-6, `${id} ${d}: first arrival ${st.first} s`);
      const lastPlayed = a.sections.filter((x) => x.kind === 'verse' || x.kind === 'chorus').at(-1).toBar * 4;
      assert.ok(st.last <= a.musicEndSec && st.last <= T(lastPlayed), `${id} ${d}: last arrival ${st.last} s, music ends ${a.musicEndSec} s`);
    }
    assert.deepEqual(waves.easy, waves.normal); assert.deepEqual(waves.normal, waves.hard); // the same places on every difficulty
  }
});

test('Cyber Boss: Phase 2 — the breakdown is empty or nearly empty on Easy and Normal', () => {
  const c = load('cyber-boss-phase-2'), a = analysis('cyber-boss-phase-2'), br = a.sections.find((s) => s.kind === 'break');
  for (const d of ['easy', 'normal']) {
    const inside = c.difficulties[d].events.filter((e) => e.beat >= br.fromBar * 4 && e.beat < br.toBar * 4);
    assert.ok(inside.length <= 2, `${d}: ${inside.length} events in bars ${br.fromBar}–${br.toBar - 1}`);
  }
});

test('Catch the Light — no notes in the quiet tail after the band stops', () => {
  const c = load('catch-the-light'), a = analysis('catch-the-light');
  const end = a.sections.filter((s) => s.kind === 'verse' || s.kind === 'chorus').at(-1).toBar * 4;
  for (const d of D) assert.ok(c.difficulties[d].events.every((e) => e.beat < end), d);
});

test('the analyses: tempo, first downbeat and the evidence for it are recorded', () => {
  const want = { 'mobius-boss-01': [125, 0.31], 'cyber-boss-phase-2': [150, null], 'catch-the-light': [170, null] };
  for (const s of SONGS) {
    const a = analysis(s.id), [bpm, off] = want[s.id];
    assert.ok(Math.abs(a.tempo.bpm - bpm) < 0.02, `${s.id}: ${a.tempo.bpm} BPM`);
    if (off !== null) assert.equal(a.offsetSec, off);
    assert.equal(a.downbeat.evidence.length, 4); assert.ok(a.beat.grids.length === 2);
    assert.ok(a.slots.onset.length > 100 && a.sections.length >= 3);
  }
});
