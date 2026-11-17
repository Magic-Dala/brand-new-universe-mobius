// v0.47 Story chase budget numbers (goal section 5): a MEASURING script, not a pass / fail test. Needs `npm run dev`.
// Draw calls and triangles of the main render (renderer.info.render, one eye, desktop headless Chromium + SwiftShader,
// 16:9) in the first chase, the dev switch off (the v0.46 Story) and on, at the same five route positions looking along
// the route, then with pumpkins in the air, then the combat's own peak. Also: programs, textures and geometries in memory,
// the size of the two new HUD canvases, the sample voice limit.
//   CHROME=/usr/bin/google-chrome URL=https://localhost:5173/ node tests/e2e/storybudget.e2e.mjs
// These are desktop numbers. They say nothing about a Quest 3.
import { chromium } from 'playwright';
import { openStory, CHROME_ARGS } from './storyharness.mjs';

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: CHROME_ARGS });
const out = {};
for (const combat of [false, true]) {
  const { p, errors } = await openStory(browser, { combat, draw: 0 }); // (drawn only where a number is read)
  out[combat ? 'on' : 'off'] = await p.evaluate((combat) => {
    const X = window.__x, { a, c, C, loco, T } = X, info = a.renderer.info;
    const look = (sv) => { const q = X.CH.routePoint(sv), d = X.CH.routePoint(sv + 4).sub(q); q.y = X.CH.routeHeight(sv); X.hold(q); loco.placeAt(q, Math.atan2(-d.x, -d.z)); loco.vel.set(0, 0, 0); };
    const lead = (sv) => { const bs = sv + 26, bp = X.CH.routePoint(bs); bp.y = X.CH.routeHeight(bs) + 4; c.bossS = bs; c._bossV = 0; a.boss.root.position.copy(bp); }; // he flies 26 m ahead, in view (the walk to each position is faster than he is)
    const read = () => { X.step(1); X.render(); return { calls: info.render.calls, tris: info.render.triangles }; };
    const quiet = () => { if (combat) X.quiet(); else c.bombs.timer = 1e9; };
    quiet();
    // A. cruising: five positions along the route, he leads ahead in view
    const idle = [], pool = combat ? C.bombs : c.bombs;
    const cruise = (list) => { for (const sv of list) { let s0 = Math.max(c.maxS, 8); while (s0 < sv) { s0 = Math.min(sv, s0 + 8); look(s0); X.step(2); } look(sv); lead(sv); X.step(40); look(sv); lead(sv); X.step(2); quiet(); idle.push({ s: sv, state: c.state, gap: +X.gap().toFixed(0), ...read() }); } };
    cruise([40, 150, 260]);
    // B. two of his pumpkins in the air (the same model either way), at 260 m
    for (let i = 0; i < 2; i++) { const it = pool._get('normal'); if (it) { a.boss.throwPoint(it.pos); pool._launch(it, X.chest(), loco.vel); } X.step(6); }
    const flying = pool.items.filter((it) => it.active).length; const action = { flying, ...read() };
    pool.clear(); X.step(2);
    cruise([380, 470]);
    // C. the same busy moment either way, at 470 m: two of his pumpkins shot down at once (their bursts and the webs)
    for (let i = 0; i < 2; i++) { const it = pool._get('normal'); if (it) { a.boss.throwPoint(it.pos); pool._launch(it, X.chest(), loco.vel); } } X.step(6);
    const up = pool.items.filter((q) => q.active); let shot = 0;
    if (combat) { up.forEach((it, i) => X.web(it.pos.clone(), i ? 'left' : 'right')); X.step(1); shot = up.filter((it) => !it.active).length; }
    else for (const it of up) { const o = X.chest(); shot += pool.tryShoot({ type: 'web', hand: 'right', origin: o, dir: it.pos.clone().sub(o).normalize() }) ? 1 : 0; }
    let busy = { calls: 0, tris: 0 }; for (let i = 0; i < 30; i++) { const r = read(); if (r.calls > busy.calls) busy = r; }
    busy.shot = shot; pool.clear(); X.step(40);
    // D. the combat's own peak (switch on only): stalled 12 m ahead with the red ring, a spread of three + a heavy pumpkin cleared by the Fan Web, a Light Bomb
    let peak = null;
    if (combat) {
      const near = () => { const bs = 470 + 12, bp = X.CH.routePoint(bs); bp.y = X.CH.routeHeight(bs) + 4; c.bossS = bs; c._bossV = 0; a.boss.root.position.copy(bp); };
      X.stall(); near(); X.step(8);
      for (let i = 0; i < 3; i++) X.pumpkin('normal'); X.pumpkin('giant'); X.step(4);
      C._refresh(); X.bomb(C.bossPos.clone()); X.fan(); X.step(3);
      let max = { calls: 0, tris: 0 }; for (let i = 0; i < 90; i++) { near(); const r = read(); if (r.calls > max.calls) max = { ...r, flying: C.bombs.items.filter((it) => it.active).length, ring: c.ringKind, stalled: C.stalled }; }
      peak = max; C.bombs.clear();
    }
    const canv = (pn) => pn?.canvas ? { w: pn.canvas.width, h: pn.canvas.height, bytes: pn.canvas.width * pn.canvas.height * 4 } : null;
    return { idle, action, busy, peak, programs: info.programs.length, textures: info.memory.textures, geometries: info.memory.geometries,
      hud: { storyP: canv(a.hud.storyP), sumP: canv(a.hud.sumP) }, maxVoices: X.audio.bank?.cfg?.maxVoices ?? null, sharedVoices: !!X.audio.storyBank && X.audio.storyBank.voices === X.audio.bank.voices };
  }, combat);
  out[combat ? 'on' : 'off'].errors = errors.slice(0, 3);
  await p.close();
}
const pct = (a, b) => `${b >= a ? '+' : ''}${(((b - a) / a) * 100).toFixed(1)} %`;
console.log('position | state | draw calls off → on | triangles off → on');
out.off.idle.forEach((o, i) => { const n = out.on.idle[i]; console.log(`${o.s} m | ${o.state} | ${o.calls} → ${n.calls} (${pct(o.calls, n.calls)}) | ${o.tris} → ${n.tris} (${pct(o.tris, n.tris)})`); });
const sum = (arr, k) => arr.reduce((x, y) => x + y[k], 0);
console.log(`mean of the five | | ${(sum(out.off.idle, 'calls') / 5).toFixed(1)} → ${(sum(out.on.idle, 'calls') / 5).toFixed(1)} (${pct(sum(out.off.idle, 'calls'), sum(out.on.idle, 'calls'))}) | ${Math.round(sum(out.off.idle, 'tris') / 5)} → ${Math.round(sum(out.on.idle, 'tris') / 5)} (${pct(sum(out.off.idle, 'tris'), sum(out.on.idle, 'tris'))})`);
console.log(`two pumpkins in the air (${out.off.action.flying} / ${out.on.action.flying} active) | | ${out.off.action.calls} → ${out.on.action.calls} (${pct(out.off.action.calls, out.on.action.calls)}) | ${out.off.action.tris} → ${out.on.action.tris} (${pct(out.off.action.tris, out.on.action.tris)})`);
console.log(`two pumpkins shot down at once, 470 m (${out.off.busy.shot} / ${out.on.busy.shot} shot) | | ${out.off.busy.calls} → ${out.on.busy.calls} (${pct(out.off.busy.calls, out.on.busy.calls)}) | ${out.off.busy.tris} → ${out.on.busy.tris} (${pct(out.off.busy.tris, out.on.busy.tris)})`);
const worstOff = Math.max(...out.off.idle.map((o) => o.calls), out.off.action.calls, out.off.busy.calls), worstOn = Math.max(...out.on.idle.map((o) => o.calls), out.on.action.calls, out.on.busy.calls, out.on.peak.calls);
const worstOffT = Math.max(...out.off.idle.map((o) => o.tris), out.off.action.tris, out.off.busy.tris), worstOnT = Math.max(...out.on.idle.map((o) => o.tris), out.on.action.tris, out.on.busy.tris, out.on.peak.tris);
console.log(`the combat's own busiest moment, switch on only (stalled ${out.on.peak.stalled}, ${out.on.peak.ring} ring, a spread and a heavy pumpkin cleared by the Fan Web, a Light Bomb; highest of 90 frames) | | ${out.on.peak.calls} | ${out.on.peak.tris}`);
console.log(`highest number measured anywhere | | ${worstOff} → ${worstOn} (${pct(worstOff, worstOn)}) | ${worstOffT} → ${worstOnT} (${pct(worstOffT, worstOnT)})`);
console.log(`programs ${out.off.programs} → ${out.on.programs}; textures in memory ${out.off.textures} → ${out.on.textures}; geometries ${out.off.geometries} → ${out.on.geometries}`);
console.log(`new HUD canvases (switch on): ${JSON.stringify(out.on.hud)}; sample voices at most ${out.on.maxVoices} (one pool for both banks: ${out.on.sharedVoices})`);
console.log('errors', JSON.stringify([out.off.errors, out.on.errors]));
await browser.close();
