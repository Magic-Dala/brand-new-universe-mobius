// v0.49 the punch moment in Story's chase, end-to-end (headless Chromium + SwiftShader; needs `npm run dev`).
// Green Maniac turns to face the player when the red ring comes on; the fly-in's last metres run in slow motion; the hit is
// a near-freeze; time always returns to full speed, whatever ends the fly-in.
// Real app, frames stepped by hand at 60 Hz (storyharness.mjs). Prints PASS / FAIL lines; exit code 1 on any FAIL.
//   CHROME=/usr/bin/google-chrome URL=https://localhost:8443/ node tests/e2e/punchmoment.e2e.mjs
// Nothing here says anything about a Quest 3.
import { chromium } from 'playwright';
import { openStory, CHROME_ARGS } from './storyharness.mjs';

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: CHROME_ARGS });
let fails = 0, passes = 0;
const check = (name, ok, info = '') => { if (ok) passes++; else fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''}`); };

const { p, errors } = await openStory(browser, { combat: true, draw: 0 });
const ev = (f, arg) => p.evaluate(f, arg);

// helpers living in the page: a log of the sounds played, and one whole fly-in with the time scale recorded per frame
await ev(async () => {
  const X = window.__x, A = X.audio, pl = A.play.bind(A);
  X.snd = []; A.play = (n, ...r) => { X.snd.push(n); return pl(n, ...r); };
  X.F = (await window.__imp('/src/data/feel.js')).FEEL;
  /** Stalled with the ring on at 12 m, then a web at the ring. Steps until the fly-in ends (or `stopWhen` says so). */
  X.flyIn = ({ stopWhen = null, max = 600 } = {}) => {
    const { C, a, loco } = X, w = a.timeWarp;
    X.quiet(); X.stall(); X.step(1); X.behind(12); X.step(8);
    const pose0 = { state: a.boss.maniac.state, faced: C.stumble.faced, ring: C.ringOn };
    const punches0 = C.stumble.punches, snd0 = X.snd.length;
    loco.cling = null; X.webBoss(); X.step(1);
    const out = { pose0, started: C.lunging, frames: 0, slowFrames: 0, slowScales: new Set(), startDist: null, stopped: false };
    while (C.lunging && out.frames < max) {
      if (w.approaching) { out.slowFrames++; out.slowScales.add(+w.scale.toFixed(3)); if (out.startDist == null) out.startDist = +X.chest().distanceTo(C.bossPos).toFixed(2); }
      if (stopWhen && stopWhen(out)) { out.stopped = true; break; }
      X.step(1); out.frames++;
    }
    out.slowScales = [...out.slowScales]; out.done = C.lastLunge?.done; out.punches = C.stumble.punches - punches0; out.snd = X.snd.slice(snd0);
    out.scaleNow = +w.scale.toFixed(3); out.approaching = w.approaching;
    return out;
  };
  /** n more frames: the time scale of each, and whether the Head Hit was seen. */
  X.after = (n) => { const { a } = X, s = []; let hit = false, hitFacing = false; for (let i = 0; i < n; i++) { s.push(+a.timeWarp.scale.toFixed(3)); if (a.boss.maniac.state === 'hit') { hit = true; hitFacing = hitFacing || a.boss.maniac.facingBack; } X.step(1); } return { s, hit, hitFacing }; };
});
const F = await ev(() => window.__x.F.warp);

// ---------------------------------------------------------------- he turns to face the player when the ring comes on
const r1 = await ev(() => { const X = window.__x, { C, a } = X, m = a.boss.maniac;
  X.quiet(); X.stall(); X.step(1);
  X.behind(21); X.step(8); const far = { ring: C.ringOn, state: m.state, facing: m.facingBack, faced: C.stumble.faced };
  X.behind(12); X.step(8); const near = { ring: C.ringOn, state: m.state, faced: C.stumble.faced };
  X.step(120); const turned = { state: m.state, facing: m.facingBack };
  X.behind(21); X.step(30); const backOff = { ring: C.ringOn, state: m.state, facing: m.facingBack, stalled: C.stalled };
  return { far, near, turned, backOff }; });
check('stalled at 21 m (no red ring): he keeps his back to the player', !r1.far.ring && !r1.far.facing && !r1.far.faced && r1.far.state === 'hurt', r1.far);
check('stalled at 12 m (red ring on): he turns to face the player (Taunt)', r1.near.ring && r1.near.faced && r1.near.state === 'taunt' && r1.turned.state === 'taunt' && r1.turned.facing === true, { near: r1.near, turned: r1.turned });
check('once turned he stays turned for the rest of the stall (no flapping when the ring goes off)', r1.backOff.stalled && !r1.backOff.ring && r1.backOff.facing === true, r1.backOff);

// ---------------------------------------------------------------- the stall runs out while he faces the player
const r2 = await ev(() => { const X = window.__x, { C, a } = X, m = a.boss.maniac;
  X.step(60 * 7); const out = { stumble: C.stumble.state, state: m.state, facing: m.facingBack };
  X.step(60 * 6); return { out, later: { stumble: C.stumble.state, state: m.state, facing: m.facingBack, scale: a.timeWarp.scale } }; });
check('the stall runs out: he turns forward and rides again', r2.out.stumble !== 'stalled' && r2.later.state === 'ride' && r2.later.facing === false && r2.later.scale === 1, r2);

// ---------------------------------------------------------------- the fly-in: slow motion, the near-freeze, back to full speed
const r3 = await ev(() => { const X = window.__x, { C, a } = X;
  const fly = X.flyIn(); const aft = X.after(60);
  const end = { scale: a.timeWarp.scale, active: a.timeWarp.active, approaching: a.timeWarp.approaching, stumble: C.stumble.state, scripted: X.loco.scripted };
  X.step(60 * 6); const back = { state: a.boss.maniac.state, facing: a.boss.maniac.facingBack, stumble: C.stumble.state };
  return { fly, aft, end, back }; });
{
  const f = r3.fly, s = r3.aft.s, freeze = s.filter((v) => v <= F.punch.scale + 1e-6).length, slowSec = +(f.slowFrames / 60).toFixed(2);
  check('before the web he already faces the player', f.pose0.ring && f.pose0.faced && f.pose0.state === 'taunt', f.pose0);
  check(`slow motion starts ${f.startDist} m out (inside ${F.approach.dist} m) at ${F.approach.scale}× and lasts ${slowSec} s before the hit`, f.started && f.startDist <= F.approach.dist && f.startDist > F.approach.dist - 1 && f.slowScales.length === 1 && f.slowScales[0] === F.approach.scale && slowSec >= 0.35 && slowSec <= 0.85, { startDist: f.startDist, slowFrames: f.slowFrames, scales: f.slowScales, frames: f.frames });
  check('the wind-down sound plays once as time slows', f.snd.filter((n) => n === 'slowmoIn').length === 1, f.snd);
  check(`the hit lands by itself: contact, punches + 1, Head Hit while he faces the player`, f.done === 'contact' && f.punches === 1 && r3.aft.hit && r3.aft.hitFacing && f.snd.includes('punch'), { done: f.done, punches: f.punches, hit: r3.aft.hit, hitFacing: r3.aft.hitFacing });
  check(`near-freeze at ${F.punch.scale}× for ${freeze} frames (${F.punch.hold} s), then back to full speed within ${F.punch.ease} s`, s[0] === F.punch.scale && freeze >= 7 && freeze <= 11 && s[45] === 1 && r3.end.scale === 1 && !r3.end.active && !r3.end.approaching && !r3.end.scripted, { first: s.slice(0, 12), at30: s[30], at45: s[45], end: r3.end });
  check('after the punch he turns forward and rides again', r3.back.state === 'ride' && r3.back.facing === false, r3.back);
}

// ---------------------------------------------------------------- nothing leaves the game in slow motion
const r4 = await ev(() => { const X = window.__x, { C, a, c } = X, w = a.timeWarp;
  const fly = X.flyIn({ stopWhen: (o) => o.slowFrames >= 6 });
  const mid = { lunging: C.lunging, approaching: w.approaching, scale: w.scale };
  c.respawn(); X.step(1); const now = { lunging: C.lunging, approaching: w.approaching };
  X.step(30); const end = { scale: w.scale, active: w.active };
  X.step(90); return { stopped: fly.stopped, mid, now, end }; });
check('a respawn during the slow motion ends it: full speed again within half a second', r4.stopped && r4.mid.approaching && r4.mid.scale === F.approach.scale && !r4.now.lunging && !r4.now.approaching && r4.end.scale === 1 && !r4.end.active, r4);

const r5 = await ev(() => { const X = window.__x, { C, a } = X, w = a.timeWarp;
  const fly = X.flyIn({ stopWhen: (o) => o.slowFrames >= 6 });
  const mid = { approaching: w.approaching };
  C.cancel(); X.step(2); const now = { lunging: C.lunging, approaching: w.approaching, scripted: X.loco.scripted };
  X.step(30); return { stopped: fly.stopped, mid, now, end: { scale: w.scale, active: w.active, state: a.boss.maniac.state } }; });
check('the stall ends during the slow motion (he reaches the roof): no hit, full speed again', r5.stopped && r5.mid.approaching && !r5.now.lunging && !r5.now.approaching && !r5.now.scripted && r5.end.scale === 1 && !r5.end.active, r5);

// ---------------------------------------------------------------- the switches
const r6 = await ev(() => { const X = window.__x, { a } = X; X.step(60 * 3);
  X.settings.impactTime = false;
  const fly = X.flyIn(); const aft = X.after(40); X.settings.impactTime = true;
  X.step(60 * 6);
  return { done: fly.done, punches: fly.punches, slowFrames: fly.slowFrames, snd: fly.snd.includes('slowmoIn'), min: Math.min(...aft.s), faced: fly.pose0.faced, scale: a.timeWarp.scale }; });
check('impact time off: no slow motion and no wind-down sound; he still turns and the punch still lands', r6.done === 'contact' && r6.punches === 1 && r6.slowFrames === 0 && !r6.snd && r6.min === 1 && r6.faced, r6);

const r7 = await ev(() => { const X = window.__x, { a } = X;
  X.settings.comfortMode = true;
  const fly = X.flyIn(); const aft = X.after(40); X.settings.comfortMode = false;
  X.step(60 * 6);
  return { done: fly.done, punches: fly.punches, scales: fly.slowScales, min: Math.min(...aft.s), end: a.timeWarp.scale }; });
check(`comfort mode: the punch lands and time never runs below ${F.comfort.minScale}×`, r7.done === 'contact' && r7.punches === 1 && r7.scales.length === 1 && r7.scales[0] === F.comfort.minScale && r7.min === F.comfort.minScale && r7.end === 1, r7);

check('no page errors', errors.length === 0, errors.slice(0, 3));
console.log(`\n${passes} PASS, ${fails} FAIL`);
await browser.close();
process.exit(fails ? 1 : 0);
