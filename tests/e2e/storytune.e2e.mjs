// v0.47 Story chase tuning (goal S6): a MEASURING script, not a pass / fail test. Needs `npm run dev`.
// A scripted average player plays the real first chase (real app, real StoryCombat, frames stepped by hand at 60 Hz,
// input injected after the real InputHub.update()). One row per seed: punches landed, stalls, stalls that timed out,
// pumpkins destroyed, hits taken, peak Flow, chase seconds. The goal: every seed lands 2 to 4 punches.
//   CHROME=/usr/bin/google-chrome URL=https://localhost:5173/ SEEDS=1,2,3,4,5,6 node tests/e2e/storytune.e2e.mjs
//   SET='{"stall":{"time":5}}'  overrides STORY_CHASE keys for this run only (to try a value before writing it to the data file)
// The scripted player (the plan's Task 7; all of it is a model, none of it is a person, and none of it is a Quest 3):
//   - moves along the route at 13 m/s with a seeded ± 20 % wobble (the swing speed limit is 18 m/s), keeps its height on the route;
//     (its velocity is reported to the game, so his throws lead it as they lead a person); a pumpkin hit costs it 40 % of that speed, recovered over 2 s; while its web holds the stalled jet it gains 3.5 m/s (the pull);
//   - fires one web every 1.1 s (± 0.2 s): at the nearest flying pumpkin if there is one, else at Green Maniac; on target 55 % of the time;
//   - throws a Light Bomb every 6 s when one is ready, on target 50 % of the time;
//   - sees the red ring and webs it 1.2 s later (the fly-in); never uses the shield or the Fan Web.
// Rendering is skipped (logic only), so nothing here measures frame time.
import { chromium } from 'playwright';
import { openStory, CHROME_ARGS } from './storyharness.mjs';

const SEEDS = (process.env.SEEDS || '1,2,3,4,5,6').split(',').map(Number);
const SET = process.env.SET ? JSON.parse(process.env.SET) : null;
const MODEL = { speed: 13, wobble: 0.2, webEvery: 1.1, webJitter: 0.2, webHit: 0.55, bombEvery: 6, bombHit: 0.5, ringReact: 1.2, hitLoss: 0.4, hitRecover: 2, pullGain: 3.5, ...(process.env.MODEL ? JSON.parse(process.env.MODEL) : {}) };
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: CHROME_ARGS });
const { p, errors } = await openStory(browser, { combat: true, draw: 0 });

const cfg = await p.evaluate((SET) => { const X = window.__x; if (SET) for (const [k, v] of Object.entries(SET)) { if (v && typeof v === 'object') Object.assign(X.SC[k], v); else X.SC[k] = v; } return JSON.parse(JSON.stringify(X.SC)); }, SET);
console.log('STORY_CHASE', JSON.stringify({ pressure: cfg.pressure, stall: cfg.stall, pacing: cfg.pacing }));
console.log('MODEL', JSON.stringify(MODEL));
console.log('seed | punches | stalls | timed out | web strikes | pumpkins | Light Bomb hits | hits taken | peak Flow | his throws | chase s | end');

const rows = [];
for (const seed of SEEDS) {
  const r = await p.evaluate(({ seed, M }) => {
    const X = window.__x, { a, s, c, C, loco, L, T } = X, DT = 1 / 60;
    let st = seed >>> 0; const rnd = () => { st = (st + 0x6d2b79f5) >>> 0; let t = Math.imul(st ^ (st >>> 15), 1 | st); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    // a fresh chase for this seed: the Story from its start, the fly-by, out of the room
    a.go('story'); s.suited = true; a.setArmored(true); s.enterStage('chase'); X.step(5 * 60 + 20); s.inRoom = false; loco.ignoreColliders = new Set();
    for (let sv = 8; sv <= 24; sv += 8) { X.at(sv); X.step(2); }
    C.attacks.reset(1000 + seed * 7919);
    const off = (target, deg) => { const o = X.chest(), d = target.clone().sub(o), ang = deg * Math.PI / 180 * (rnd() < 0.5 ? -1 : 1); d.applyAxisAngle(new T.Vector3(0, 1, 0), ang); return o.add(d); };
    let sv = 24, t = 0, slow = 0, nextWeb = 0.5 + rnd(), nextBomb = 3 + rnd() * 3, ringSince = -1, hits0 = C.cstats.hitsTaken, wasLunging = false, frames = 0, end = 'timeout';
    const ph = rnd() * 6.28, period = 6 + rnd() * 3, lbHits0 = C.lightBombs?.stats?.hitsBoss || 0;
    const LEN = L.STORY_ROUTE.length, log = []; let lastSt = C.stumble.state, lastCs = c.state, lastRun = C.running;
    while (frames < 60 * 240) {
      frames++; t += DT;
      if (c.state === 'roofStandoff') { end = 'roof'; break; }
      if (C.cstats.hitsTaken > hits0) { hits0 = C.cstats.hitsTaken; slow = 1; }
      slow = Math.max(0, slow - DT / M.hitRecover);
      if (C.lunging) { wasLunging = true; }
      else {
        if (wasLunging) { wasLunging = false; sv = Math.max(sv, c.playerS); } // the fly-in and its push-back moved the rig: go on from where it is
        let v = M.speed * (1 + M.wobble * Math.sin(ph + (t / period) * 6.28)) * (1 - M.hitLoss * slow);
        if (X.jetRope()) v = Math.min(18, v + M.pullGain);
        sv = Math.min(LEN - 6, sv + v * DT);
        X.at(sv);
        loco.vel.copy(X.CH.routePoint(Math.min(LEN, sv + 1)).sub(X.CH.routePoint(sv)).setY(0).normalize().multiplyScalar(v)); // (held in place by the script, but its speed is what his throws lead)
      }
      // the red ring: seen, then webbed 1.2 s later
      if (C.ringOn && !C.lunging) { if (ringSince < 0) ringSince = t; if (t - ringSince >= M.ringReact) { loco.cling = null; X.webBoss(); ringSince = -1; nextWeb = t + M.webEvery; } }
      else if (!C.ringOn) ringSince = -1;
      // the web cadence
      if (t >= nextWeb && !C.lunging && !C.ringOn) {
        nextWeb = t + M.webEvery + (rnd() * 2 - 1) * M.webJitter;
        C._refresh(); const fl = X.flying(), chest = X.chest();
        let target = C.bossPos.clone(); if (fl.length) { fl.sort((p1, p2) => p1.pos.distanceTo(chest) - p2.pos.distanceTo(chest)); target = fl[0].pos.clone(); }
        X.web(rnd() < M.webHit ? target : off(target, 16), rnd() < 0.5 ? 'left' : 'right');
      }
      // the Light Bomb
      if (t >= nextBomb && C.lightBombReady && !C.lunging) { nextBomb = t + M.bombEvery; C._refresh(); X.bomb(rnd() < M.bombHit ? C.bossPos.clone() : off(C.bossPos.clone(), 40)); }
      X.step(1);
      if (C.stumble.state !== lastSt) { lastSt = C.stumble.state; log.push(`${t.toFixed(1)}s ${lastSt}${lastSt === 'stalled' ? ' (gap ' + X.gap().toFixed(0) + ' m)' : ''}`); }
      if (c.state !== lastCs) { lastCs = c.state; log.push(`${t.toFixed(1)}s [${lastCs}]`); }
      if (C.running !== lastRun) { lastRun = C.running; log.push(`${t.toFixed(1)}s loop ${lastRun ? 'on' : 'off'}`); }
    }
    const S = C.stats, cs = C.cstats;
    return { seed, punches: C.stumble.punches, stalls: cs.stalls, timedOut: cs.stalls - C.stumble.punches, strikes: cs.strikes, pumpkins: S.pumpkins, lbHits: (C.lightBombs?.stats?.hitsBoss || 0) - lbHits0, hits: cs.hitsTaken, peakFlow: S.peakFlow, throws: { ...C.attacks.stats }, secs: +(frames / 60).toFixed(1), end, tier: C.stumble.tier(c._host().segmentTier()), stage: s.stage, log };
  }, { seed, M: MODEL });
  rows.push(r);
  if (process.env.VERBOSE) console.log(`   timeline: ${r.log.join(' · ')}`);
  console.log(`${r.seed} | ${r.punches} | ${r.stalls} | ${r.timedOut} | ${r.strikes} | ${r.pumpkins} | ${r.lbHits} | ${r.hits} | ${r.peakFlow} | ${JSON.stringify(r.throws)} | ${r.secs} | ${r.end}`);
}
const pn = rows.map((r) => r.punches);
console.log(`punches per seed: ${pn.join(', ')} (min ${Math.min(...pn)}, max ${Math.max(...pn)}, mean ${(pn.reduce((x, y) => x + y, 0) / pn.length).toFixed(2)}); in the 2 to 4 band: ${pn.filter((n) => n >= 2 && n <= 4).length} of ${pn.length}`);
console.log('errors', JSON.stringify(errors.slice(0, 3)));
await browser.close();
