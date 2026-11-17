// v1.1 Arcade chart rules: never three pumpkins at once outside the Fan Web, one job per pumpkin, the retired cluster,
// the armored `step`, the generator from 80 to 200 BPM, the loader's guard for stored charts.
import test from 'node:test';
import assert from 'node:assert/strict';
const { CHART_RULES, chartViolations, enforceThree } = await import('../src/game/chartRules.js');
const { buildChart, resolveNotes, validateChart, makeBeatClock, generateEvents } = await import('../src/core/chart.js');
const { seqBeats, inWindow, ArmoredSeq, armoredStep } = await import('../src/game/armored.js');

const N = (id, time, type = 'pumpkin', hand = 'R', extra = {}) => ({ id, time, type, hand, ...extra });
const rules = (v) => v.map((x) => x.rule).sort();

test('chartViolations: the window, minGap, doubles, rows, giant pumpkins, accents and clusters', () => {
  assert.deepEqual(chartViolations([N('a', 1), N('b', 1.5, 'pumpkin', 'L')], 'hard'), [], 'two singles 0.5 s apart');
  assert.deepEqual(chartViolations([N('a', 1, 'pumpkin', 'L'), N('b', 1, 'pumpkin', 'R')], 'normal'), [], 'a left + right double is one moment');
  assert.deepEqual(rules(chartViolations([N('a', 1, 'pumpkin', 'L'), N('b', 1, 'pumpkin', 'R'), N('c', 1.24, 'pumpkin', 'L')], 'hard')), ['window'], 'a double and a third 0.24 s later: three inside 0.35 s');
  assert.deepEqual(rules(chartViolations([N('a', 1, 'pumpkin', 'any'), N('b', 1, 'pumpkin', 'any')], 'hard')), ['minGap'], 'two "any" on one moment are not a double');
  assert.deepEqual(rules(chartViolations([N('a', 1), N('b', 1.3)], 'normal')), ['minGap'], 'Normal: 0.3 s < 0.40 s');
  assert.deepEqual(chartViolations([N('a', 1), N('b', 1.3)], 'hard'), [], 'Hard: 0.3 s ≥ 0.24 s');
  assert.deepEqual(rules(chartViolations([N('a', 1), N('b', 1.5)], 'easy')), ['minGap'], 'Easy: 0.5 s < 0.60 s');
  const row = [0, 1, 2].map((k) => N(`f0.${k}`, 5, 'fanRow', 'both', { row: 'f0' }));
  assert.deepEqual(chartViolations(row, 'hard'), [], 'a fan row\'s three members are not three arrivals');
  assert.deepEqual(rules(chartViolations([...row, N('x', 4.5)], 'hard')), ['rowClear'], 'nothing inside 0.72 s before a row');
  assert.deepEqual(rules(chartViolations([...row, N('x', 5.4)], 'hard')), ['rowClear'], 'nothing inside 0.48 s after a row');
  assert.deepEqual(chartViolations([...row, N('x', 4.2), N('y', 5.5)], 'hard'), []);
  assert.deepEqual(rules(chartViolations([N('h', 2, 'heavy', 'any'), N('h2', 4, 'heavy', 'any')], 'hard')), ['bombGap']);
  assert.deepEqual(rules(chartViolations([N('h', 2, 'heavy', 'any'), N('x', 2.4)], 'hard')), ['heavyClear']);
  assert.deepEqual(rules(chartViolations([N('h', 2, 'heavy', 'any')], 'hard', CHART_RULES, { accents: [1, 3] })), ['accent'], 'off an accent');
  assert.deepEqual(chartViolations([N('h', 2, 'heavy', 'any')], 'hard', CHART_RULES, { accents: [2.01] }), [], 'on an accent');
  assert.deepEqual(rules(chartViolations([N('c', 1, 'cluster', 'any')], 'hard')), ['cluster']);
  const seq = { id: 'a0', holdTime: 10, shellTimes: [10.4, 10.8, 11.2], waveTime: 12 };
  assert.deepEqual(chartViolations([N('x', 9), N('y', 12.6)], 'normal', CHART_RULES, { sequences: [seq] }), []);
  assert.deepEqual(rules(chartViolations([N('x', 11)], 'normal', CHART_RULES, { sequences: [seq] })), ['armoredClear']);
  assert.deepEqual(rules(chartViolations([], 'easy', CHART_RULES, { sequences: [seq] })), ['armoredGap', 'armoredGap'], 'Easy shell beats 0.4 s apart: too close');
});

test('enforceThree: drops the latest ordinary pumpkin of a crowded window; never a giant pumpkin, a row or an armored one; deterministic', () => {
  const row = [0, 1, 2].map((k) => N(`f0.${k}`, 5, 'fanRow', 'both', { row: 'f0' }));
  const notes = [N('a', 1, 'pumpkin', 'L'), N('b', 1, 'pumpkin', 'R'), N('c', 1.2, 'pumpkin', 'L'), N('h', 3, 'heavy', 'any'), N('d', 3.1), N('e', 3.2, 'pumpkin', 'L'), ...row];
  const { notes: out, dropped } = enforceThree(notes);
  assert.deepEqual(dropped, ['c', 'e']); assert.ok(out.some((n) => n.id === 'h')); assert.equal(out.filter((n) => n.row).length, 3);
  assert.deepEqual(enforceThree(notes).dropped, dropped, 'the same every time');
  assert.deepEqual(chartViolations(out, 'hard').filter((v) => v.rule === 'window'), []);
});

// a v1.0-style stored chart (an imported song in a browser's IndexedDB): three-pumpkin clusters on one beat, an armored event without `step`
const stored = {
  format: 'mobius-chart', version: 1, song: { id: 'import-old', title: 'Old import', audio: { storeKey: 'import-old' } },
  timing: { bpm: 125, offsetSec: 0.31, beatsPerBar: 4 },
  difficulties: { normal: { travelSec: 2.05, events: [
    { id: 'n0', beat: 8, type: 'pumpkin', hand: 'R', lane: { x: 0.7, y: 0.5 } },
    { id: 'n1', beat: 12, type: 'cluster', hand: 'any', lane: { x: -0.22, y: 0.5 }, group: 'c1' },
    { id: 'n2', beat: 12, type: 'cluster', hand: 'any', lane: { x: 0.22, y: 0.5 }, group: 'c1' },
    { id: 'n3', beat: 12, type: 'cluster', hand: 'any', lane: { x: 0, y: 0.72 }, group: 'c1' },
    { id: 'n4', beat: 14, type: 'pumpkin', hand: 'L', lane: { x: -0.7, y: 0.5 } },
    { id: 'a0', beat: 20, type: 'armored', hand: 'both', hits: 3, gap: 2 },
  ] } },
};
test('loader: a stored chart with three-pumpkin clusters loads as ordinary pumpkins for either hand, two at most at once', () => {
  validateChart(stored);
  const { notes, dropped } = resolveNotes(stored, 'normal');
  assert.ok(!notes.some((n) => n.type === 'cluster'), 'no cluster at run time');
  const at12 = notes.filter((n) => Math.abs(n.beat - 12) < 1e-6);
  assert.equal(at12.length, 2, 'two of the three remain'); assert.ok(at12.every((n) => n.type === 'pumpkin' && n.hand === 'any' && n.group === undefined));
  assert.deepEqual(dropped, ['n3'], 'the latest one (by id) goes');
  assert.deepEqual(chartViolations(notes, 'normal').filter((v) => v.rule === 'window'), []);
});
test('armored step: shell beats `step` beats apart, the wave after the last; without step exactly as before', () => {
  const clock = makeBeatClock(stored.timing);
  const old = resolveNotes(stored, 'normal', { armored: true }).sequences[0];
  assert.deepEqual(old.shellTimes, [20, 21, 22].map((b) => clock.beatToSec(b)), 'no step: one beat apart (v0.48)');
  assert.equal(old.waveTime, clock.beatToSec(24)); assert.equal(old.holdTime, clock.beatToSec(19)); assert.equal(old.step, 1);
  const c2 = structuredClone(stored); c2.difficulties.normal.events[5].step = 2; validateChart(c2);
  const q = resolveNotes(c2, 'normal', { armored: true }).sequences[0];
  assert.deepEqual(q.shellTimes, [20, 22, 24].map((b) => clock.beatToSec(b))); assert.equal(q.waveTime, clock.beatToSec(26));
  assert.deepEqual(seqBeats(20, 3, 2, 8, 2), { shells: [20, 22, 24], wave: 26, from: 19, to: 27 });
  assert.deepEqual(seqBeats(20, 3, 2, 8), { shells: [20, 21, 22], wave: 24, from: 17, to: 25 }, 'step 1: the v0.48 window');
  assert.ok(inWindow(19.5, { beat: 20, hits: 3, gap: 2, step: 2 }) && !inWindow(18.5, { beat: 20, hits: 3, gap: 2, step: 2 }));
  const s = new ArmoredSeq({ beat: 20, hits: 3, gap: 2, step: 2 }); assert.deepEqual(s.shellBeats, [20, 22, 24]); assert.equal(s.waveBeat, 26);
  const bad = structuredClone(stored); bad.difficulties.normal.events[5].step = 0.3; assert.throws(() => validateChart(bad), /step/);
  assert.equal(armoredStep(170, CHART_RULES.minGap.easy), 2); assert.equal(armoredStep(170, CHART_RULES.minGap.normal), 2); assert.equal(armoredStep(170, CHART_RULES.minGap.hard), 1);
  assert.equal(armoredStep(150, CHART_RULES.minGap.normal), 1); assert.equal(armoredStep(125, CHART_RULES.minGap.easy), 2);
});

// ---------------------------------------------------------------------------------------- the generator sweep
const LAYOUTS = {
  song: (bars) => [{ fromBar: 0, toBar: 2, kind: 'intro' }, { fromBar: 2, toBar: 6, kind: 'verse' }, { fromBar: 6, toBar: 12, kind: 'verse2' }, { fromBar: 12, toBar: 13, kind: 'build' }, { fromBar: 13, toBar: bars - 2, kind: 'chorus' }, { fromBar: bars - 2, toBar: bars, kind: 'outro' }],
  allChorus: (bars) => [{ fromBar: 0, toBar: bars, kind: 'chorus' }],
  builds: (bars) => [{ fromBar: 0, toBar: 1, kind: 'intro' }, { fromBar: 1, toBar: bars, kind: 'build' }],
  verses: (bars) => [{ fromBar: 0, toBar: 2, kind: 'intro' }, { fromBar: 2, toBar: Math.floor(bars / 2), kind: 'verse2' }, { fromBar: Math.floor(bars / 2), toBar: bars, kind: 'outro' }],
  tiny: () => [{ fromBar: 0, toBar: 1, kind: 'intro' }, { fromBar: 1, toBar: 4, kind: 'chorus' }],
};
export function sweep() {
  let charts = 0; const bad = [];
  for (let bpm = 80; bpm <= 200; bpm += 5) for (let seed = 1; seed <= 5; seed++) for (const [name, lay] of Object.entries(LAYOUTS)) {
    const bars = name === 'tiny' ? 4 : 24 + seed * 4;
    const fan = name === 'tiny' ? null : { easy: [24, 60], normal: [24, 44, 72], hard: [24, 40, 56, 80] };
    const chart = buildChart({ song: { id: `sweep-${bpm}`, title: 'x', artist: '', audio: { storeKey: 'x' } }, timing: { bpm, offsetSec: 0.2, beatsPerBar: 4 }, sections: lay(bars), totalBars: bars, lastBeat: bars * 4 - 1, seed: bpm * 7 + seed, fanRows: fan });
    for (const d of ['easy', 'normal', 'hard']) {
      charts++;
      if (chart.difficulties[d].events.some((e) => e.type === 'cluster')) bad.push({ bpm, seed, name, d, rule: 'cluster in the chart' });
      for (const armored of [false, true]) {
        const { notes, sequences, dropped } = resolveNotes(chart, d, { armored });
        const v = chartViolations(notes, d, CHART_RULES, { sequences: armored ? sequences : [], secPerBeat: 60 / bpm });
        if (v.length || dropped.length) bad.push({ bpm, seed, name, d, armored, v: v.slice(0, 3), dropped });
      }
    }
  }
  return { charts, bad };
}
test('generator: no violation and no cluster at any tempo from 80 to 200 BPM, any seed, any section layout (armored on and off)', () => {
  const { charts, bad } = sweep();
  console.log(`generator sweep: ${charts} generated charts (25 tempos × 5 seeds × 5 section layouts × 3 difficulties), each checked with armored pumpkins off and on: ${bad.length} with a violation`);
  assert.deepEqual(bad.slice(0, 5), []);
  assert.ok(charts >= 1800);
});
test('generator: Easy steps grow with the tempo (minGap in seconds), clusters are gone, giant pumpkins only on phrase-start accents', () => {
  const secs = [{ fromBar: 0, toBar: 1, kind: 'intro' }, { fromBar: 1, toBar: 17, kind: 'chorus' }];
  for (const bpm of [90, 125, 170]) {
    const { events } = generateEvents({ totalBars: 17, sections: secs, difficulty: 'easy', bpm });
    const t = events.map((e) => (e.beat * 60) / bpm);
    for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] >= CHART_RULES.minGap.easy - 1e-6 || Math.abs(t[i] - t[i - 1]) < 0.01, `${bpm} BPM: ${t[i - 1].toFixed(2)} → ${t[i].toFixed(2)}`);
    assert.ok(!events.some((e) => e.type === 'cluster'));
    for (const e of events.filter((x) => x.type === 'heavy')) assert.equal(e.beat % 16, 0, 'the first beat of a four-bar phrase');
  }
});
