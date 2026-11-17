// v0.48 armored pumpkin: the rules of design 6.3 with three shell beats (docs/goals/v048-armored-pumpkin-decision.md),
// placement on any chart, and what the dev switch does to the event count.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ARMORED, ArmoredSeq, placeArmored, armoredEvents, addArmored, applyArmored, seqBeats, inWindow, chartSections } from '../src/game/armored.js';

test('the numbers of the decision file', () => {
  assert.equal(ARMORED.hits, 3);
  assert.deepEqual(ARMORED.waveGap, { easy: 2, normal: 2, hard: 1 });
  assert.equal(ARMORED.waveWeight, 3); assert.equal(ARMORED.perChart, 3); assert.equal(ARMORED.freeBeats, 8); assert.equal(ARMORED.everyBars, 32);
});
test('a sequence: three shell beats one beat apart, the wave `gap` beats after the last', () => {
  const s = new ArmoredSeq({ beat: 44, hits: 3, gap: 2 });
  assert.deepEqual(s.shellBeats, [44, 45, 46]); assert.equal(s.waveBeat, 48);
  assert.equal(new ArmoredSeq({ beat: 44, hits: 3, gap: 1 }).waveBeat, 47);
  assert.equal(s.layers, 3); assert.equal(s.stage, 0); assert.equal(s.charge, 0);
});
test('outcome: all three hit, then the wave = full; the stage and the hand charge follow the layers', () => {
  const s = new ArmoredSeq({ beat: 0 });
  assert.equal(s.shellHit(0), 2); assert.equal(s.stage, 1); assert.equal(s.charge, 1);
  assert.equal(s.shellHit(1), 1); assert.equal(s.stage, 2);
  assert.equal(s.shellHit(2), 0); assert.equal(s.stage, 3); assert.equal(s.charge, 3);
  assert.equal(s.wave(), 'full'); assert.equal(s.done, true); assert.equal(s.outcome, 'full');
});
test('outcome: one shell beat missed, then the wave = partial; the missed layer stays on and nothing grows back', () => {
  const s = new ArmoredSeq({ beat: 0 });
  s.shellHit(0); assert.equal(s.shellMiss(1), 2); assert.equal(s.stage, 1, 'a miss does not advance the stage');
  assert.equal(s.shellHit(2), 1); assert.equal(s.stage, 2); assert.equal(s.charge, 2, 'a missed beat lights no pip');
  assert.equal(s.wave(), 'partial');
});
test('outcome: two missed, and all three missed, then the wave = partial', () => {
  const a = new ArmoredSeq({ beat: 0 }); a.shellMiss(0); a.shellMiss(1); a.shellHit(2); assert.equal(a.layers, 2); assert.equal(a.wave(), 'partial');
  const b = new ArmoredSeq({ beat: 0 }); b.shellMiss(0); b.shellMiss(1); b.shellMiss(2); assert.equal(b.layers, 3); assert.equal(b.stage, 0); assert.equal(b.wave(), 'partial');
});
test('outcome: no wave = miss, whatever the layers', () => {
  const a = new ArmoredSeq({ beat: 0 }); a.shellHit(0); a.shellHit(1); a.shellHit(2); assert.equal(a.expire(), 'miss');
  const b = new ArmoredSeq({ beat: 0 }); assert.equal(b.expire(), 'miss');
});
test('a beat is judged once; nothing changes after the end', () => {
  const s = new ArmoredSeq({ beat: 0 });
  s.shellHit(0); s.shellHit(0); s.shellMiss(0); assert.equal(s.layers, 2);
  s.shellMiss(1); s.shellHit(1); assert.equal(s.layers, 2, 'a missed beat cannot be hit later');
  assert.equal(s.wave(), 'partial'); assert.equal(s.expire(), 'partial'); assert.equal(s.shellHit(2), 2); assert.equal(s.wave(), 'partial');
});
test('a wave before the last shell beat was judged counts the open beats as missed', () => {
  const s = new ArmoredSeq({ beat: 0 }); s.shellHit(0); assert.equal(s.wave(), 'partial'); assert.deepEqual(s.shell, ['hit', 'miss', 'miss']);
});

const chart = JSON.parse(readFileSync(new URL('../public/songs/mobius-boss-01/chart.json', import.meta.url)));
const bare = (c) => { const x = JSON.parse(JSON.stringify(c)); for (const d of Object.values(x.difficulties)) d.events = d.events.filter((e) => e.type !== 'armored'); return x; };
test('the current song: three per difficulty, the last wave on the final note, 8 free beats each, no Fan Web row inside', () => {
  const c = bare(chart);
  for (const d of ['easy', 'normal', 'hard']) {
    const starts = placeArmored(c, d), gap = ARMORED.waveGap[d], ev = c.difficulties[d].events;
    assert.equal(starts.length, 3, d);
    const last = Math.max(...ev.map((e) => e.beat));
    assert.equal(starts[2] + 2 + gap, Math.round(last), `${d}: the last wave is on the final note`);
    for (const s of starts) {
      const w = seqBeats(s, 3, gap);
      assert.equal(w.to - w.from, 8, 'eight free beats');
      assert.ok(!ev.some((e) => e.type === 'fan_web_row' && e.beat > w.from - 1e-6 && e.beat < w.wave + 2), `${d}: no Fan Web row in or right after the window at ${s}`);
      assert.ok(Number.isInteger(s) && s >= 0);
    }
    for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 16, 'sequences are well apart');
  }
});
test('the switch: off = the v0.46 event count (54 / 97 / 126), on = other notes inside a sequence are dropped', () => {
  const rhythm = (events) => events.filter((e) => e.type !== 'armored').length; // one per event; a Fan Web row is one
  const want = { easy: 54, normal: 97, hard: 126 };
  for (const d of ['easy', 'normal', 'hard']) {
    const ev = chart.difficulties[d].events;
    assert.equal(ev.filter((e) => e.type === 'armored').length, 3, `${d}: the shipped chart carries three armored events`);
    const off = applyArmored(ev, false);
    assert.equal(off.length, want[d], d); assert.ok(!off.some((e) => e.type === 'armored'));
    const on = applyArmored(ev, true), arm = on.filter((e) => e.type === 'armored');
    assert.equal(arm.length, 3);
    for (const e of on) if (e.type !== 'armored') assert.ok(!arm.some((a) => inWindow(e.beat, a)), `${d}: ${e.id} sits inside a sequence`);
    assert.ok(rhythm(on) <= want[d]);
    assert.ok(!arm.some((a) => ev.some((e) => e.type === 'fan_web_row' && inWindow(e.beat, a))), 'no Fan Web row is dropped');
  }
});
test('a chart with no sections, another tempo and a tempo change: one about every 32 bars and one at the end', () => {
  const events = []; for (let b = 8; b <= 400; b += 2) events.push({ id: `n${b}`, beat: b, type: 'pumpkin', hand: 'R' });
  const c = { timing: { bpm: 96, offsetSec: 0, beatsPerBar: 4, tempoMap: [{ beat: 0, bpm: 96 }, { beat: 200, bpm: 150 }] }, difficulties: { normal: { events }, hard: { events: events.slice() } } };
  assert.equal(chartSections(c), null);
  const starts = placeArmored(c, 'normal');
  assert.deepEqual(starts.map((s) => s + 4), [127, 255, 383, 400], 'waves at the end of every 32nd bar, and on the final note');
  assert.deepEqual(placeArmored(c, 'hard').map((s) => s + 3), [127, 255, 383, 400]);
  addArmored(c);
  assert.equal(c.difficulties.normal.events.filter((e) => e.type === 'armored').length, 4);
  assert.deepEqual(c.difficulties.normal.events.find((e) => e.id === 'a0'), { id: 'a0', beat: 123, type: 'armored', hand: 'both', hits: 3, gap: 2 });
  addArmored(c); assert.equal(c.difficulties.normal.events.filter((e) => e.type === 'armored').length, 4, 'placing twice does not double them');
});
test('a chart too short for a sequence gets none; an empty chart gets none', () => {
  const c = { timing: { bpm: 120, beatsPerBar: 4 }, difficulties: { normal: { events: [{ id: 'n0', beat: 2, type: 'pumpkin', hand: 'R' }, { id: 'n1', beat: 6, type: 'pumpkin', hand: 'L' }] }, easy: { events: [] } } };
  assert.deepEqual(placeArmored(c, 'normal'), []); assert.deepEqual(placeArmored(c, 'easy'), []); assert.deepEqual(armoredEvents(c, 'nope'), []);
});
