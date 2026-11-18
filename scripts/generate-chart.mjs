// Builds the built-in Arcade charts from their analyses: `npm run chart` rewrites public/songs/<id>/chart.json for every
// song byte for byte (the analyses are committed, so no Python is needed). To analyse a song again (Python + librosa):
//   python3 scripts/charts/analyze-song.py public/audio/songs/<id>.mp3 <id> [--bpm-range lo hi | --bpm B --offset S]
// The first song keeps its timing (125 BPM, first beat 0.31 s): --bpm 125 --offset 0.31.
// Prints, per chart: the events by type, the average and peak density, the rests, the Fan Web rows, the first and last
// arrival, and every giant and armored pumpkin with its time, bar and beat and the reason it is there.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildFromAnalysis } from './charts/build-chart.mjs';

export const SONGS = [
  { id: 'mobius-boss-01', title: 'Brand New Universe - Mobius', originalName: 'Brand_New_Universe-Mobius(Music).mp3', durationSec: 56.89, role: 'arcade-boss-battle',
    // the first song: short (48 s of notes), so it keeps its v1.0 density and three to five rows; no rest rule
    opts: { rate: { easy: 1.05, normal: 1.45, hard: 2.45 }, fanRows: { easy: 3, normal: 4, hard: 5 }, giants: { easy: 2, normal: 3, hard: 4 }, giantSpacing: { easy: 14, normal: 9, hard: 7 }, armored: { min: 3, max: 3, every: 16, spacing: 9 }, restEvery: 0, fanSpacing: 6 } },
  { id: 'cyber-boss-phase-2', title: 'Cyber Boss: Phase 2', originalName: 'Cyber Boss_ Phase 2.mp3', durationSec: 139.27, opts: {} },
  { id: 'catch-the-light', title: 'Catch the Light', originalName: 'Catch the Light.mp3', durationSec: 156.05, opts: {} },
];

export function build(s) {
  const a = JSON.parse(readFileSync(new URL(`./charts/${s.id}.analysis.json`, import.meta.url), 'utf8'));
  const song = { id: s.id, title: s.title, artist: 'Brand New Universe', audio: { src: `audio/songs/${s.id}.mp3`, originalName: s.originalName }, durationSec: s.durationSec, ...(s.role ? { role: s.role } : {}) };
  return buildFromAnalysis(a, song, s.opts);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const s of SONGS) {
    const { chart, report } = build(s);
    mkdirSync(new URL(`../public/songs/${s.id}/`, import.meta.url), { recursive: true });
    writeFileSync(new URL(`../public/songs/${s.id}/chart.json`, import.meta.url), JSON.stringify(chart, null, 1));
    console.log(`\n==== ${s.title} (${s.id}): ${chart.timing.bpm} BPM, first downbeat ${chart.timing.offsetSec} s; notes from ${report.span.first.sec} s (bar ${report.span.first.bar}) to ${report.span.last.sec} s (bar ${report.span.last.bar}); the music ends about ${report.span.musicEndSec} s`);
    console.log('armored pumpkins (the same places on every difficulty; the wave lands on the beat that ends the run / held note):');
    for (const x of report.armored) console.log(`  wave ${x.wave.sec} s, bar ${x.wave.bar} beat ${x.wave.beat}: ${x.why}`);
    for (const d of ['easy', 'normal', 'hard']) {
      const r = report[d], st = r.stats;
      console.log(`-- ${d}: ${st.total} rhythm events ${JSON.stringify(st.byType)}; ${st.perSec}/s from ${st.first} to ${st.last} s; peak ${st.peak4s} in 4 s (at ${st.peakAt} s); rests ≥ 4 s: ${st.rests.map(([a, b]) => `${a}–${b}`).join(', ') || 'none'}; longest stretch without one ${st.longestWithoutRest} s; violations ${r.violations.length}; dropped by the loader ${r.dropped.length}; armored step ${r.step}, gap ${r.gap}`);
      console.log(`   Fan Web rows: ${r.rows.map((x) => `${x.sec} s (bar ${x.bar})`).join(', ')}`);
      for (const g of r.giants) console.log(`   giant pumpkin ${g.sec} s, bar ${g.bar} beat ${g.beat}: ${g.why} (strength ${g.strength})`);
    }
  }
}
