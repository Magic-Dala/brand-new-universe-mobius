// Optional end-to-end check. Needs `npm run dev` running and `npx playwright install chromium`.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'] });
const p = await b.newPage({ viewport: { width: 320, height: 180 }, ignoreHTTPSErrors: true });
const logs = [];
p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
p.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
await p.goto((process.env.URL || 'https://localhost:8443/'), { waitUntil: 'load' });
await p.waitForTimeout(6000);
await p.click('#enter'); await p.waitForTimeout(800);
const out = await p.evaluate(async () => {
  const a = window.__mobius, ar = a.arcade;
  const { settings } = await import('/src/core/settings.js');
  const { loadSong } = await import('/src/core/songs.js');
  const song = await loadSong('mobius-boss-01');
  const results = {};
  // stop the real render-driven updates from interfering
  const realFrame = a.frame.bind(a); a.frame = () => {};
  async function run(diff, { autoplay = true, dtOffset = 0, jitter = 0, offsetMs = 0, pause = false } = {}) {
    settings.difficulty = diff; settings.offsetMs = offsetMs;
    a.state = 'arcade'; a.locomotion.placeAt(a.arenaOrigin, 0);
    ar.start({ song, chart: song.chart, difficulty: diff });
    ar.conductor.stop();
    let sim = -2.0; const c = ar.conductor;
    c.now = () => sim; c.tick = () => { if (sim >= c.duration) { c.state = 'ended'; c.onEnded?.(); } }; c.state = 'playing';
    c.pause = () => { c.state = 'paused'; }; c.resume = () => { c.state = 'playing'; };
    ar.debug.autoplay = autoplay; ar.debug.autoplayDt = dtOffset;
    const step = 1 / 72; let frames = 0, maxActive = 0, spawnedEarly = 0;
    const spawnLeads = [];
    while (ar.state === 'playing' && sim < 70) {
      a.hub.events.length = 0;
      if (pause && Math.abs(sim - 30) < step / 2) { ar.pause(); const before = ar.notes.map(n => n.pos.clone()); ar.update(step, 0); ar.update(step, 0); const moved = ar.notes.some((n, i) => n.pos.distanceTo(before[i]) > 1e-9); ar.resume(); results.pauseMoved = moved; }
      ar.update(step, sim + 100); a.fx.update(step, a.camera);
      maxActive = Math.max(maxActive, ar.pumpkins.filter(x => x.active).length);
      sim += step + (jitter ? (Math.random() - 0.5) * jitter : 0); frames++;
    }
    const log = ar.debug.log;
    const r = ar.result || ar.score.summary();
    return { diff, frames, endT: +sim.toFixed(2), state: ar.state, total: ar.eventTotal, rows: ar.rowList.length, rowsCleared: ar.rowList.filter((r) => r.state === 'cleared').length, judged: log.length, counts: r.counts, score: r.score, maxCombo: r.maxCombo, acc: +r.accuracy.toFixed(3), rank: r.rank, failed: r.failed,
      maxAbsDt: +Math.max(...log.map(l => Math.abs(l.dt))).toFixed(4), leftoverActive: ar.pumpkins.filter(x => x.active).length, maxActive, flights: ar.flights.length };
  }
  a.onArcadeFinished = (r) => { a.lastResult = r; };
  const rs = [];
  for (const d of ['easy', 'normal', 'hard']) rs.push(await run(d));
  rs.push({ case: 'late 120ms (good)', ...(await run('normal', { dtOffset: 0.12 })) });
  rs.push({ case: 'late 200ms (miss) noFail', ...(await (async () => { settings.noFail = true; const r = await run('normal', { dtOffset: 0.2 }); settings.noFail = false; return r; })()) });
  rs.push({ case: 'offset +100ms, hits at +100ms', ...(await run('normal', { dtOffset: 0.1, offsetMs: 100 })) });
  rs.push({ case: 'no input → fail', ...(await run('normal', { autoplay: false })) });
  rs.push({ case: 'pause at 30s', ...(await run('normal', { pause: true })), pauseMoved: results.pauseMoved });
  settings.offsetMs = 0;
  a.frame = realFrame;
  return rs;
});
for (const r of out) console.log(JSON.stringify(r));
console.log(logs.join('\n'));
await b.close();
