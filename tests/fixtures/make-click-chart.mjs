// v0.48 (Goal stage S7): a second chart to prove that nothing depends on the shipped song.
// 96 BPM for 48 beats, then 150 BPM; no `sections`; a click track as its audio. Not in the song list: test use only.
//   node tests/fixtures/make-click-chart.mjs   → tests/fixtures/click-96-150.chart.json + click-96-150.wav
import { writeFileSync } from 'node:fs';
import { validateChart, makeBeatClock, addArmored, CHART_FORMAT, CHART_VERSION } from '../../src/core/chart.js';

const timing = { bpm: 96, offsetSec: 0.2, beatsPerBar: 4, tempoMap: [{ beat: 0, bpm: 96 }, { beat: 48, bpm: 150 }] };
const clock = makeBeatClock(timing), LAST = 176;
const events = (step) => { const ev = []; let side = 1, n = 0; for (let b = 8; b <= LAST; b += step) { side = -side; ev.push({ id: `n${n++}`, beat: b, type: 'pumpkin', hand: side < 0 ? 'L' : 'R', lane: { x: side * 0.7, y: 0.5 } }); } return ev; };
const durationSec = +(clock.beatToSec(LAST) + 2.5).toFixed(2);
const chart = {
  format: CHART_FORMAT, version: CHART_VERSION,
  song: { id: 'test-click-96-150', title: 'Click 96 → 150', artist: 'test fixture', audio: { src: 'tests/fixtures/click-96-150.wav' }, durationSec },
  timing,
  difficulties: { easy: { travelSec: 2.5, events: events(4) }, normal: { travelSec: 2.05, events: events(2) }, hard: { travelSec: 1.7, events: events(1) } },
};
addArmored(chart); validateChart(chart);
writeFileSync(new URL('./click-96-150.chart.json', import.meta.url), JSON.stringify(chart, null, 1));

// the click track: 8-bit mono 11025 Hz; a short tick on every beat, a higher one on each bar line
const SR = 11025, N = Math.ceil(durationSec * SR), pcm = new Uint8Array(N).fill(128);
for (let b = 0; b <= LAST + 2; b++) { const t0 = Math.round(clock.beatToSec(b) * SR), f = b % 4 === 0 ? 1760 : 1100; for (let i = 0; i < SR * 0.03 && t0 + i < N; i++) pcm[t0 + i] = 128 + Math.round(90 * Math.sin(2 * Math.PI * f * i / SR) * Math.exp(-i / (SR * 0.008))); }
const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + N, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR, 28); h.writeUInt16LE(1, 32); h.writeUInt16LE(8, 34); h.write('data', 36); h.writeUInt32LE(N, 40);
writeFileSync(new URL('./click-96-150.wav', import.meta.url), Buffer.concat([h, Buffer.from(pcm)]));
for (const d of ['easy', 'normal', 'hard']) console.log(d, chart.difficulties[d].events.length, 'events;', 'armored at', chart.difficulties[d].events.filter((e) => e.type === 'armored').map((e) => e.beat).join(', '));
console.log('duration', durationSec, 's; tempo change at', clock.beatToSec(48).toFixed(2), 's; sections:', chart.sections ?? chart.generator?.sections ?? 'none');
