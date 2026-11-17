// v0.48 hall show: the three pure functions (thresholds, show level, beat envelope) and the comfort limits of the Goal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HALL_SHOW, tierThresholds, showLevel, beatEnvelope, pulsePeriod, swingFor } from '../src/game/hallShow.js';

test('the numbers of the Goal', () => {
  assert.deepEqual(HALL_SHOW.tierFrac, [0.15, 0.35, 0.60]);
  assert.deepEqual(HALL_SHOW.swing, [0.12, 0.16, 0.20, 0.25]);
  assert.equal(HALL_SHOW.attack, 0.04); assert.equal(HALL_SHOW.decay, 0.15); assert.equal(HALL_SHOW.maxHz, 3);
  assert.deepEqual(HALL_SHOW.missDip, { amount: 0.30, time: 0.35 });
  assert.deepEqual(HALL_SHOW.chorus, { dimTo: 0.35, burst: 0.40, burstTime: 0.30 });
  assert.equal(HALL_SHOW.corridorMax, 0.05); assert.equal(HALL_SHOW.corridorPad, 1.5); assert.equal(HALL_SHOW.hueBars, 4);
});
test('thresholds on the current song: Easy 8/19/32, Normal 15/34/58, Hard 19/44/76', () => {
  assert.deepEqual(tierThresholds(54), [8, 19, 32]);
  assert.deepEqual(tierThresholds(97), [15, 34, 58]);
  assert.deepEqual(tierThresholds(126), [19, 44, 76]);
  assert.deepEqual(tierThresholds(3), [1, 1, 2], 'a tiny chart still has thresholds of at least 1');
});
test('show level: rises with the combo, a miss drops one level and not to zero', () => {
  const th = [8, 19, 32];
  assert.equal(showLevel(0, 7, th, false), 0); assert.equal(showLevel(0, 8, th, false), 1);
  assert.equal(showLevel(1, 19, th, false), 2); assert.equal(showLevel(2, 32, th, false), 3); assert.equal(showLevel(3, 99, th, false), 3);
  assert.equal(showLevel(3, 0, th, true), 2); assert.equal(showLevel(2, 0, th, true), 1); assert.equal(showLevel(0, 0, th, true), 0);
  assert.equal(showLevel(2, 0, th, false), 2, 'after a miss the level holds while the combo rebuilds');
  assert.equal(showLevel(2, 31, th, false), 2); assert.equal(showLevel(2, 32, th, false), 3);
});
test('swing: 12 % at level 0, 25 % at level 3, comfort mode halves it', () => {
  assert.equal(swingFor(0), 0.12); assert.equal(swingFor(3), 0.25); assert.equal(swingFor(9), 0.25); assert.equal(swingFor(-1), 0.12);
  for (let l = 0; l < 4; l++) assert.equal(swingFor(l, true), HALL_SHOW.swing[l] / 2);
});
test('beat envelope, 60 to 240 BPM: 0 … 1, peak on the beat, attack ≥ 40 ms, decay ≥ 150 ms, at most 3 pulses a second, no step', () => {
  for (let bpm = 60; bpm <= 240; bpm += 1) {
    const beat = 60 / bpm, off = 0.31, period = pulsePeriod(beat);
    assert.ok(1 / period <= 3 + 1e-9, `${bpm} BPM pulses at ${(1 / period).toFixed(2)} Hz`);
    assert.ok(period === beat || bpm > 180, `${bpm} BPM: every beat up to 180`);
    const dt = 0.0005, N = Math.round(4 / dt); let prev = beatEnvelope(-dt, beat, off), peaks = 0, lo = 1, hi = 0, maxStep = 0;
    let riseStart = null, fallStart = null; const rises = [], falls = [];
    for (let i = 0; i < N; i++) {
      const t = i * dt, e = beatEnvelope(t, beat, off);
      assert.ok(e >= 0 && e <= 1, `${bpm} BPM: ${e}`);
      lo = Math.min(lo, e); hi = Math.max(hi, e); maxStep = Math.max(maxStep, Math.abs(e - prev));
      if (prev <= 0.001 && e > 0.001) riseStart = t;
      if (prev < 0.999 && e >= 0.999 && riseStart !== null) { rises.push(t - riseStart); peaks++; riseStart = null; }
      if (prev >= 0.999 && e < 0.999) fallStart = t;
      if (prev > 0.001 && e <= 0.001 && fallStart !== null) { falls.push(t - fallStart); fallStart = null; }
      prev = e;
    }
    assert.ok(hi > 0.999 && lo < 0.001, `${bpm} BPM: full swing`);
    assert.ok(peaks / 4 <= 3 + 0.26, `${bpm} BPM: ${peaks} peaks in 4 s`);
    assert.ok(Math.min(...rises) >= 0.04 * 0.9, `${bpm} BPM: attack ${Math.min(...rises)}`); // 0.001 … 0.999 of a 40 ms smooth rise
    assert.ok(Math.min(...falls) >= 0.15 * 0.9, `${bpm} BPM: decay ${Math.min(...falls)}`);
    assert.ok(maxStep < 0.03, `${bpm} BPM: a step of ${maxStep} in 0.5 ms`);
    assert.ok(Math.abs(beatEnvelope(off + 8 * period, beat, off) - 1) < 1e-6, `${bpm} BPM: the peak is on the beat`);
  }
});
test('beat envelope: a beat faster than 3 Hz pulses on every other beat; no beat length gives 0', () => {
  assert.equal(pulsePeriod(60 / 125), 60 / 125); assert.equal(pulsePeriod(60 / 200), 2 * 60 / 200); assert.equal(pulsePeriod(60 / 180), 60 / 180);
  assert.equal(pulsePeriod(60 / 400), 4 * 60 / 400, 'and every fourth above 360');
  assert.equal(beatEnvelope(1, 0, 0), 0); assert.equal(beatEnvelope(1, NaN, 0), 0);
  assert.ok(beatEnvelope(-3.2, 0.48, 0.31) >= 0, 'the lead-in (negative song time) is fine');
});

// ---- the HallShow class (S3): a fake hall records what setShow receives
const { HallShow, ACCENTS } = await import('../src/game/hallShow.js');
const fakeApp = () => { const calls = []; return { calls, interior: { setShow(o) { calls.push(o ? { ...o, hue: o.hue ? [...o.hue] : null } : null); } } }; };
const clock125 = { secToBeat: (t) => (t - 0.31) * 125 / 60 };
function play(show, app, { from = 0, to = 10, bpm = 125, combo = () => 0, comfort = false, each = null, dt = 1 / 72 } = {}) {
  const beatSec = 60 / bpm; const outs = [];
  for (let t = from; t < to; t += dt) { each?.(t); show.update(dt, { now: t, beatSec, offsetSec: 0.31, combo: combo(t), comfort, beat: (t - 0.31) / beatSec }); if (show.out) outs.push({ t, ...show.out, hue: [...show.out.hue] }); }
  return outs;
}
test('HallShow: off = the hall is left at rest and never written during play', () => {
  const app = fakeApp(), s = new HallShow(app);
  s.start({ eventCount: 97, sections: null, clock: clock125, on: false });
  play(s, app, { to: 3 }); s.onEvent('miss'); s.onEvent('fanRow');
  assert.deepEqual(app.calls, [null], 'only the reset at the start (no argument = rest)');
  assert.equal(s.level, 0);
});
test('HallShow: the swing follows the level and never exceeds it; comfort mode halves it', () => {
  for (const comfort of [false, true]) {
    const app = fakeApp(), s = new HallShow(app);
    s.start({ eventCount: 54, sections: null, clock: clock125 });
    const outs = play(s, app, { to: 24, combo: (t) => Math.floor(t * 2), comfort });
    assert.equal(s.level, 3);
    for (const o of outs) { assert.ok(o.swing <= swingFor(o.level, comfort) + 1e-9, `swing ${o.swing} at level ${o.level}`); assert.ok(o.swing >= swingFor(0, comfort) - 1e-9); assert.ok(o.beat >= 0 && o.beat <= 1); assert.ok(o.flare <= o.swing + 1e-9); }
    assert.ok(Math.abs(outs.at(-1).swing - swingFor(3, comfort)) < 0.005);
    assert.equal(outs[0].chase, 0, 'level 0: no chase'); assert.ok(outs.at(-1).chase > 0 && outs.at(-1).strips === 1 && outs.at(-1).streak > 0, 'level 3 has the chase, the strips and brighter streaks');
  }
});
test('HallShow: the accent colour steps every 4 bars: purple (today\'s), amber, magenta, purple …', () => {
  const app = fakeApp(), s = new HallShow(app);
  s.start({ eventCount: 54, sections: null, clock: clock125 });
  const outs = play(s, app, { to: 32 }), bar = 4 * 60 / 125, at = (b) => outs.find((o) => o.t >= 0.31 + b * bar).hue;
  const near = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 0.02);
  assert.ok(near(at(3.5), ACCENTS[0])); assert.ok(near(at(7.5), ACCENTS[1])); assert.ok(near(at(11.5), ACCENTS[2])); assert.ok(near(at(15.5), ACCENTS[0]));
  for (const a of ACCENTS) assert.ok(Math.abs((a[0] + a[1] + a[2]) / 3 - 1) < 0.01, 'an accent keeps the strip\'s brightness');
});
test('HallShow: a chart with no sections never dims; one with a chorus dims over the bar before it and bursts once', () => {
  const a1 = fakeApp(), s1 = new HallShow(a1);
  s1.start({ eventCount: 54, sections: null, clock: clock125 });
  assert.ok(play(s1, a1, { to: 30 }).every((o) => o.dip === 0));
  const a2 = fakeApp(), s2 = new HallShow(a2);
  s2.start({ eventCount: 54, sections: [{ fromBar: 0, toBar: 2, kind: 'intro' }, { fromBar: 2, toBar: 13, kind: 'verse' }, { fromBar: 13, toBar: 27, kind: 'chorus' }], clock: clock125 });
  const outs = play(s2, a2, { to: 40, dt: 1 / 240 }), bar = 4 * 60 / 125, t0 = 0.31 + 13 * bar;
  const lo = Math.min(...outs.map((o) => o.dip)), hi = Math.max(...outs.map((o) => o.dip));
  assert.ok(lo >= HALL_SHOW.chorus.dimTo - 1 - 1e-9 && lo < -0.5, `dims toward 35 % (${lo})`);
  assert.ok(hi <= HALL_SHOW.chorus.burst + 1e-9 && hi > 0.3, `burst at most +40 % (${hi})`);
  assert.ok(outs.filter((o) => o.dip < 0).every((o) => o.t >= t0 - bar - 0.01 && o.t < t0), 'dim only in the bar before the chorus');
  assert.ok(outs.filter((o) => o.dip > 0).every((o) => o.t >= t0 - 0.01 && o.t <= t0 + HALL_SHOW.chorus.burstTime + 0.01), 'the burst lasts 0.3 s, once');
  let maxStep = 0; for (let i = 1; i < outs.length; i++) maxStep = Math.max(maxStep, Math.abs(outs[i].dip - outs[i - 1].dip));
  assert.ok(maxStep < 0.08, `no step in the gain (${maxStep} per 4 ms)`);
  const a3 = fakeApp(), s3 = new HallShow(a3); s3.start({ eventCount: 54, sections: [{ fromBar: 2, toBar: 13, kind: 'chorus' }], clock: clock125 });
  const o3 = play(s3, a3, { to: 12, comfort: true });
  assert.ok(Math.min(...o3.map((o) => o.dip)) >= (HALL_SHOW.chorus.dimTo - 1) / 2 - 1e-9 && Math.max(...o3.map((o) => o.dip)) <= HALL_SHOW.chorus.burst / 2 + 1e-9, 'comfort mode halves both');
});
test('HallShow: a tempo change and a fast song keep the pulse inside 3 Hz (beat numbers, not seconds, drive it)', () => {
  const app = fakeApp(), s = new HallShow(app); s.start({ eventCount: 54, sections: null, clock: null });
  const outs = []; let beat = 0;
  for (let t = 0; t < 12; t += 1 / 240) { const bpm = t < 6 ? 96 : 200; beat += (1 / 240) * bpm / 60; s.update(1 / 240, { now: t, beatSec: 60 / bpm, offsetSec: 0, combo: 0, beat }); outs.push({ t, e: s.out.beat }); }
  let peaks = 0; for (let i = 1; i < outs.length - 1; i++) if (outs[i].t > 6.5 && outs[i].e > 0.999 && outs[i - 1].e <= 0.999) peaks++;
  assert.ok(peaks / 5.5 <= 3, `${peaks} peaks in 5.5 s at 200 BPM`); assert.ok(peaks >= 8, 'every other beat at 200 BPM');
});
test('HallShow: stop puts the hall back at rest; a hall without setShow (the v0.30 hall) is simply skipped', () => {
  const app = fakeApp(), s = new HallShow(app); s.start({ eventCount: 54, clock: clock125 }); play(s, app, { to: 1 }); s.stop();
  assert.equal(app.calls.at(-1), null);
  const old = new HallShow({ interior: { update() {} } }); old.start({ eventCount: 54 }); old.update(0.016, { now: 1, beatSec: 0.48, offsetSec: 0, combo: 0 }); old.onEvent('miss'); old.stop();
  const none = new HallShow({ interior: null }); none.start({ eventCount: 54 }); none.update(0.016, { now: 1, beatSec: 0.48, offsetSec: 0, combo: 0 }); none.stop();
});
test('factoryV2: setShow only stores numbers; the show uniforms exist on the emissive, cone and streak shaders; the corridor is the lanes plus 1.5 m', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/art/factoryV2.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('    setShow({'), src.indexOf('    get showState()'));
  assert.ok(body.length > 100);
  assert.ok(!/new THREE\.|\.add\(|\.visible|compile|spawn\(|Material\(/.test(body), 'setShow creates, shows and compiles nothing');
  for (const frag of ['COMMON', 'CONE_FRAG', 'STREAK_VERT']) { const i = src.indexOf(`const ${frag} =`); assert.ok(src.slice(i, i + 200).includes('${SHOW}'), `${frag} includes the show block`); }
  assert.ok(/xHalf: 1\.7 \+ 0\.5 \+ HALL_SHOW\.corridorPad/.test(src));
  assert.ok(/PointLight\(0xff9a50/.test(src) && (src.match(/new THREE\.PointLight\(/g) || []).length === 4, 'no real-time light was added (4 point lights and the hemisphere, as before)');
  assert.ok(/SHOW_LIGHT = 0\.12/.test(src), 'the warm lights follow by 12 % of the swing: 3 % at level 3');
});

// ---- S4: the hall follows the player
test('HallShow: a miss drops one level and dips the hall 30 % for 0.35 s (15 % in comfort mode), smoothly', () => {
  for (const comfort of [false, true]) {
    const app = fakeApp(), s = new HallShow(app); s.start({ eventCount: 54, clock: clock125 });
    play(s, app, { to: 22, combo: (t) => Math.floor(t * 2), comfort }); assert.equal(s.level, 3);
    s.onEvent('miss'); assert.equal(s.level, 2, 'one level, not to zero');
    assert.deepEqual(s.takeLevelEvent(), { up: false, level: 2 });
    const outs = play(s, app, { from: 22, to: 23, combo: () => 0, comfort, dt: 1 / 240 });
    const lo = Math.min(...outs.map((o) => o.dip)), want = -HALL_SHOW.missDip.amount * (comfort ? 0.5 : 1);
    assert.ok(Math.abs(lo - want) < 0.01, `dip ${lo}, want ${want}`);
    assert.ok(outs.filter((o) => o.dip < -1e-6).every((o) => o.t <= 22 + HALL_SHOW.missDip.time + 0.01), 'back within 0.35 s');
    let maxStep = 0; for (let i = 1; i < outs.length; i++) maxStep = Math.max(maxStep, Math.abs(outs[i].dip - outs[i - 1].dip));
    assert.ok(maxStep < 0.05, `no step (${maxStep} per 4 ms)`);
    assert.equal(s.level, 2, 'the level holds while the combo rebuilds');
  }
});
test('HallShow: a Fan Web row sends a wave along the floor streaks; the energy wave and a level 3 Perfect flare the candles within the swing', () => {
  const app = fakeApp(), s = new HallShow(app); s.start({ eventCount: 54, clock: clock125 });
  play(s, app, { to: 2 }); s.onEvent('fanRow');
  const w = play(s, app, { from: 2, to: 4.2 });
  assert.ok(Math.max(...w.map((o) => o.wave)) > 0.95 && w.at(-1).wave === 0, 'the wave rises and ends'); assert.ok(w[5].waveR < w[40].waveR, 'it runs outward');
  s.onEvent('perfect'); assert.ok(play(s, app, { from: 4.2, to: 4.5 }).every((o) => o.flare === 0), 'a Perfect below level 3 does not flare');
  s.onEvent('wave'); const f = play(s, app, { from: 4.5, to: 5.2 });
  assert.ok(Math.max(...f.map((o) => o.flare)) > 0.08 && f.every((o) => o.flare <= o.swing + 1e-9) && f.at(-1).flare < 0.01);
  let up = 0; for (let i = 1; i < f.length; i++) up = Math.max(up, f[i].flare - f[i - 1].flare);
  assert.ok(up < 0.05, 'the flare rises over several frames, not in one');
});
test('HallShow: Green Maniac reacts after every 8 hits in a row, never within 0.6 s before a throw', () => {
  const app = fakeApp(), s = new HallShow(app); s.start({ eventCount: 54, clock: clock125 });
  const tick = (nextThrowIn) => { s.update(1 / 72, { now: 1, beatSec: 0.48, offsetSec: 0, combo: 0, nextThrowIn }); return s.takeReact(); };
  for (let i = 0; i < 7; i++) s.onEvent(i % 2 ? 'good' : 'perfect'); assert.equal(tick(5), null);
  s.onEvent('perfect');
  assert.equal(tick(0.3), null, 'a throw is 0.3 s away: wait'); assert.equal(tick(0.59), null);
  assert.deepEqual(tick(0.7), { kind: 'hit', variant: 'head' }); assert.equal(tick(5), null, 'once');
  for (let i = 0; i < 8; i++) s.onEvent('good'); assert.deepEqual(tick(Infinity), { kind: 'hit', variant: 'body' });
  for (let i = 0; i < 7; i++) s.onEvent('good'); s.onEvent('miss'); s.onEvent('good'); assert.equal(tick(5), null, 'a miss restarts the count');
  for (let i = 0; i < 7; i++) s.onEvent('good');
  for (let i = 0; i < 200; i++) assert.equal(tick(0.2), null); // throws keep coming for more than 2 s: the reaction is dropped
  assert.equal(tick(5), null);
});
test('HallShow: he taunts after two misses in a row, at most once per 8 s', () => {
  const app = fakeApp(), s = new HallShow(app); s.start({ eventCount: 54, clock: clock125 });
  const tick = (now) => { s.update(1 / 72, { now, beatSec: 0.48, offsetSec: 0, combo: 0 }); return s.takeReact(); };
  s.onEvent('miss'); assert.equal(tick(1), null);
  s.onEvent('miss'); assert.deepEqual(tick(1.1), { kind: 'taunt', n: 0 });
  s.onEvent('miss'); s.onEvent('miss'); assert.equal(tick(5), null, 'within 8 s: no second taunt');
  s.onEvent('miss'); s.onEvent('good'); s.onEvent('miss'); assert.equal(tick(12), null, 'a hit between them: not in a row');
  s.onEvent('miss'); assert.deepEqual(tick(12.1), { kind: 'taunt', n: 1 });
});
test('HallShow: a level gained is reported once (for the combo sound)', () => {
  const app = fakeApp(), s = new HallShow(app); s.start({ eventCount: 54, clock: clock125 });
  s.update(1 / 72, { now: 1, beatSec: 0.48, offsetSec: 0, combo: 8 });
  assert.deepEqual(s.takeLevelEvent(), { up: true, level: 1 }); assert.equal(s.takeLevelEvent(), null);
});
