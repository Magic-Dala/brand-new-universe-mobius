// v0.48 budget (constraint 2.8): the Arcade's busiest frame under autoplay, measured the same way before and after:
// the whole song on Hard in the v0.31 hall, a picture every 6th frame (10 per second of song), highest draw calls and
// triangles; real-time lights; shader programs before and after the song (a new one during play = a compile).
import { launch, openArcade } from './arcadeharness.mjs';
const b = await launch();
const { p, errors } = await openArcade(b);
const out = await p.evaluate(async (diffs) => {
  const X = window.__x, R = {};
  for (const d of diffs) {
    X.begin(d); X.step(150); // the lead-in: everything prewarmed
    const prog0 = X.programs(); let peak = { calls: 0, tris: 0, at: 0 }, peakT = { tris: 0 }, n = 0, sum = 0;
    while (X.ar.state === 'playing' && X.sim < 70) { X.step(6); const r = X.render(); n++; sum += r.calls; if (r.calls > peak.calls) peak = { ...r, at: +X.sim.toFixed(2) }; if (r.tris > peakT.tris) peakT = r; }
    R[d] = { peak, peakTris: peakT.tris, mean: +(sum / n).toFixed(1), frames: n, lights: X.lights(), programs: [prog0, X.programs()], events: X.ar.eventTotal, counts: X.a.lastResult?.counts };
  }
  return R;
}, (process.env.DIFFS || 'hard').split(','));
console.log('difficulty | peak draw calls (at s) | peak triangles | mean draw calls | lights | programs before → after the song | events | result');
for (const [d, r] of Object.entries(out)) console.log(`${d} | ${r.peak.calls} (${r.peak.at}) | ${r.peakTris} | ${r.mean} | ${r.lights} | ${r.programs[0]} → ${r.programs[1]} | ${r.events} | ${JSON.stringify(r.counts)}`);
console.log('errors', JSON.stringify(errors));
await b.close();
