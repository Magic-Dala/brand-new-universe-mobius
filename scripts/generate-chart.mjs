// Generates the official chart for song 1 from analysed timing.
// Timing source: scripts/analyze-beats.py (librosa + phase search) → BPM 125.0, first beat 0.310 s, no drift.
import { writeFileSync } from 'node:fs';
import { buildChart, resolveNotes } from '../src/core/chart.js';

const chart = buildChart({
  song: {
    id: 'mobius-boss-01',
    title: 'Brand New Universe - Mobius',
    artist: 'Brand New Universe',
    audio: { src: 'audio/songs/mobius-boss-01.mp3', originalName: 'Brand_New_Universe-Mobius(Music).mp3' },
    durationSec: 56.89,
    role: 'arcade-boss-battle',
  },
  timing: { bpm: 125, offsetSec: 0.31, beatsPerBar: 4, tempoMap: [{ beat: 0, bpm: 125 }],
            analysis: { method: 'librosa beat_track + onset phase search', confidence: 'high', driftMs: 4, leadingSilenceSec: 0.29 } },
  // bar = 4 beats = 1.92 s; bar k starts at 0.31 + 1.92k s
  sections: [
    { fromBar: 0, toBar: 2, kind: 'intro' },   // 0.31–4.15 s
    { fromBar: 2, toBar: 6, kind: 'verse' },   // 4.15–11.83 s
    { fromBar: 6, toBar: 12, kind: 'verse2' }, // 11.83–23.35 s
    { fromBar: 12, toBar: 13, kind: 'build' }, // 23.35–25.27 s
    { fromBar: 13, toBar: 27, kind: 'chorus' },// 25.27–52.15 s
    { fromBar: 27, toBar: 29, kind: 'outro' }, // 52.15–55.99 s
  ],
  totalBars: 29,
  lastBeat: 112,
  seed: 125,
  // v0.22 Fan Web rows (two-hand 扇形光網): first = practice (tutorial banner ~3 s before, no shield loss),
  // the rest alternate with the one-hand phrases (verse 2 / chorus downbeats, ≥ 3 bars apart)
  fanRows: { easy: [24, 60, 92], normal: [24, 52, 72, 92], hard: [24, 44, 64, 80, 96] },
});
writeFileSync('public/songs/mobius-boss-01/chart.json', JSON.stringify(chart, null, 1));
for (const d of ['easy', 'normal', 'hard']) {
  const { notes } = resolveNotes(chart, d);
  const c = notes.reduce((m, n) => ((m[n.type] = (m[n.type] || 0) + 1), m), {});
  c.rows = new Set(notes.filter((n) => n.row).map((n) => n.row)).size;
  console.log(d, notes.length, c, 'first', notes[0].time.toFixed(3), 'last', notes.at(-1).time.toFixed(3));
}
