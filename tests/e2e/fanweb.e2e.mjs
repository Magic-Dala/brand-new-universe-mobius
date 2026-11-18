// v0.22 Fan Web rows in the arcade battle (real ArcadeGame, simulated music clock). Needs the dev server.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'] });
const p = await b.newPage({ viewport: { width: 320, height: 180 }, ignoreHTTPSErrors: true });
const logs = []; p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await p.goto(process.env.URL || 'https://localhost:8443/', { waitUntil: 'load' });
await p.waitForFunction(() => window.__mobius && !document.getElementById('enter').disabled, null, { timeout: +(process.env.BOOT || 600000) }); // (v1.1: wait for the game itself; a fixed 6 s was too short on a slow machine)
await p.click('#enter-desktop', { force: true }).catch(() => p.click('#enter', { force: true })); await p.waitForTimeout(800);
const out = await p.evaluate(async () => {
  const a = window.__mobius, ar = a.arcade, T = window.__THREE, R = {};
  const { settings } = await import('/src/core/settings.js');
  const { loadSong } = await import('/src/core/songs.js');
  const song = await loadSong('mobius-boss-01');
  const realFrame = a.frame.bind(a); a.frame = () => {};
  let flashes = 0; const realFlash = a.flashDamage.bind(a); a.flashDamage = () => { flashes++; realFlash(); };
  a.onArcadeFinished = (r) => { a.lastResult = r; };
  const step = 1 / 72; let sim;
  const begin = (diff = 'normal') => {
    settings.difficulty = diff; settings.offsetMs = 0; settings.noFail = false;
    a.state = 'arcade'; a.locomotion.placeAt(a.arenaOrigin, 0);
    ar.start({ song, chart: song.chart, difficulty: diff }); ar.conductor.stop();
    sim = -2; const c = ar.conductor; c.now = () => sim; c.tick = () => { if (sim >= c.duration) { c.state = 'ended'; c.onEnded?.(); } }; c.state = 'playing';
    c.pause = () => { c.state = 'paused'; }; c.resume = () => { c.state = 'playing'; };
    ar.debug.autoplay = true; ar.debug.autoplayFan = false; // one-hand notes autoplayed, rows answered by the test
  };
  const tick = (events = []) => { a.hub.events.length = 0; a.hub.events.push(...events); ar.update(step, sim + 100); a.fx.update(step, a.camera); sim += step; };
  const until = (time, ev) => { while (sim < time && ar.state === 'playing') tick(ev?.(sim) || []); };
  const fan = (tContactSong, lagFrames = 0) => ({ type: 'fanWeb', tContact: tContactSong + 100, t: tContactSong + 100 + lagFrames * step, open: 'left', fist: 'right', origin: a.camera.getWorldPosition(new T.Vector3()).add(new T.Vector3(0, -0.45, 0)), dir: a.arenaForward.clone() });
  const snap = () => ({ score: ar.score.score, combo: ar.score.combo, miss: ar.score.counts.miss, perfect: ar.score.counts.perfect, good: ar.score.counts.good, shield: ar.score.shield, invalid: ar.score.invalid.length });
  const row = (id) => ar.rows.get(id), Tof = (id) => ar.noteTime(row(id));

  begin('normal');
  R.rows = ar.rowList.map((r) => ({ id: r.id, t: +r.time.toFixed(3), practice: !!r.practice, tracks: r.members.map((m) => m.track), sameTime: r.members.every((m) => m.time === r.time) }));
  R.events = { total: ar.eventTotal, notes: ar.notes.length };
  // three members in flight together: same arrival, same depth
  until(Tof('f0') - 0.5);
  { const m = row('f0').members; R.inFlight = { states: m.map((x) => x.state), depthSpread: (() => { const d = m.map((x) => x.pos.clone().sub(a.arenaOrigin).dot(a.arenaForward)); return +(Math.max(...d) - Math.min(...d)).toFixed(3); })(), strikeDepth: m.map((x) => +x.strike.distanceTo(a.arenaOrigin).toFixed(2)), cueVisible: ar.fanFx.cues.some((c) => c.line.visible && c.icon.visible), doubleRing: m.every((x) => x.ring && x.ring2), banner: a.hud.banner.text, sub: a.hud.banner.sub }; }
  // f0 practice: no answer → no shield loss, no combo break, one popup
  { const s0 = snap(), f0 = flashes; until(Tof('f0') + 0.6); const s1 = snap(); R.practiceMiss = { state: row('f0').state, shieldLoss: +(s0.shield - s1.shield).toFixed(1), comboBroken: s1.combo < s0.combo, missDelta: s1.miss - s0.miss, flashes: flashes - f0 }; }
  // f1: early fan (−0.4 s) → TOO EARLY, nothing cleared; one-hand web at the beat → row untouched, no spam penalty; fan +30 ms (lag 2 frames) → PERFECT
  until(Tof('f1') - 0.4);
  { const s0 = snap(); tick([fan(sim)]); R.early = { state: row('f1').state, early: ar.fanStats.early, alive: row('f1').members.filter((m) => m.state === 'flying').length, scoreDelta: snap().score - s0.score }; }
  until(Tof('f1'));
  { const s0 = snap(); const m = row('f1').members[0], o = a.camera.getWorldPosition(new T.Vector3()); ar._onWeb({ hand: 'right', origin: o, dir: m.pos.clone().sub(o).normalize() }, sim); R.singleWeb = { alive: row('f1').members.filter((x) => x.state === 'flying').length, invalidDelta: snap().invalid - s0.invalid, state: row('f1').state }; }
  until(Tof('f1') + 0.03 + 2 * step);
  { const s0 = snap(); tick([fan(Tof('f1') + 0.03, 2)]); const s1 = snap(); const lg = ar.debug.log.filter((l) => l.id === 'f1');
    R.hit = { state: row('f1').state, judged: row('f1').judged, members: row('f1').members.map((m) => m.state), comboDelta: s1.combo - s0.combo, perfectDelta: s1.perfect - s0.perfect, scoreDelta: s1.score - s0.score, logDt: lg[0]?.dt, logs: lg.length, nextRow: row('f2').state, nextAlive: row('f2').members.filter((m) => m.state === 'pending' || m.state === 'flying').length }; }
  // f2: +120 ms → GOOD; a second fan right after must not score again nor clear f3
  until(Tof('f2') + 0.12);
  { const s0 = snap(); tick([fan(sim)]); tick([fan(sim)]); const s1 = snap(); R.good = { judged: row('f2').judged, goodDelta: s1.good - s0.good, comboDelta: s1.combo - s0.combo, logs: ar.debug.log.filter((l) => l.id === 'f2').length, f3: row('f3').state, emptyShots: ar.fanStats.empty }; }
  // f3: no answer while the hands were TRYING (detector engaged) → ONE group miss, shown as "pose not recognised";
  // one shield hit, one damage flash, combo broken once
  { const s0 = snap(), f0 = flashes; until(Tof('f3') - 0.4); a.hub.fan.engaged = true; until(Tof('f3') + 0.25); a.hub.fan.engaged = false;
    const s1 = snap(); R.groupMiss = { state: row('f3').state, missDelta: s1.miss - s0.miss, shieldLoss: +(s0.shield - s1.shield).toFixed(1), combo: s1.combo, logs: ar.debug.log.filter((l) => l.id === 'f3').length, poseFail: ar.fanStats.poseFail };
    // late fan right after the missed row → TOO LATE feedback, no score
    const s2 = snap(); tick([fan(sim)]); R.late = { late: ar.fanStats.late, scoreDelta: snap().score - s2.score };
    until(Tof('f3') + 0.8); R.groupMiss.flashes = flashes - f0; }
  // pause: nothing moves; resume
  { ar.pause(); const before = ar.notes.map((n) => n.pos.clone()); const st = ar.rowList.map((r) => r.state).join(); ar.update(step, sim + 100); ar.update(step, sim + 100); R.pause = { moved: ar.notes.some((n, i) => n.pos.distanceTo(before[i]) > 1e-9), rowsSame: ar.rowList.map((r) => r.state).join() === st }; ar.resume(); }
  until(80);
  R.end = { state: ar.state, leftoverPumpkins: ar.pumpkins.filter((x) => x.active).length, fanFxActive: ar.fanFx.activeCount, rings: a.fx.rings.items.filter((r) => r.active).length, fan: a.lastResult?.fan, total: a.lastResult?.total, counts: a.lastResult?.counts };
  // retry → rows reset, stats reset; switch song difficulty → new rows
  begin('normal'); R.retry = { rows: ar.rowList.map((r) => r.state).join(), fired: ar.fanStats.fired, fx: ar.fanFx.activeCount };
  begin('hard'); R.hard = { rows: ar.rowList.length, events: ar.eventTotal };
  // long run with full autoplay (incl. rows): bounded objects, everything cleared
  ar.debug.autoplayFan = true; let maxFx = 0, maxRing = 0;
  while (ar.state === 'playing' && sim < 70) { tick(); maxFx = Math.max(maxFx, ar.fanFx.activeCount); maxRing = Math.max(maxRing, a.fx.rings.items.length); }
  R.autoHard = { counts: a.lastResult?.counts, fan: a.lastResult?.fan, maxFx, ringPool: maxRing, leftover: ar.pumpkins.filter((x) => x.active).length, fxAfter: ar.fanFx.activeCount };
  a.frame = realFrame; a.flashDamage = realFlash;
  return R;
});
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(14), JSON.stringify(v));
console.log('errors', logs);
await b.close();
