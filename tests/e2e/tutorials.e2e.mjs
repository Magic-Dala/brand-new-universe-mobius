// v0.49 Story tutorials end-to-end (headless Chromium + SwiftShader; needs `npm run dev`).
// The three tutorials open at their moments (after the radio, after the mirror, after the factory countdown), the game
// waits while one is open, the pages show the right clips, Skip / Back / Next / Done work, each shows once per Story run,
// and the "Tutorials" switch turns them off. Real app, frames stepped by hand at 60 Hz.
//   CHROME=/usr/bin/google-chrome URL=https://localhost:8443/ node tests/e2e/tutorials.e2e.mjs
// ONLY (default all): room, factory, off. Nothing here says anything about a Quest 3.
import { chromium } from 'playwright';
const URL = process.env.URL || 'https://localhost:8443/', BOOT = +(process.env.BOOT || 240000);
const GROUPS = (process.env.ONLY || 'room,factory,off').split(',').filter(Boolean);
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'];
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ARGS });
let fails = 0, passes = 0;
const check = (name, ok, info = '') => { if (ok) passes++; else fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''}`); };

/** A fresh page in Dala City's mode menu, frames under manual control, helpers in window.__x. */
async function open({ tutorials = true } = {}) {
  const p = await browser.newPage({ viewport: { width: 320, height: 180 }, ignoreHTTPSErrors: true });
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(URL, { waitUntil: 'load', timeout: BOOT });
  await p.waitForFunction(() => window.__mobius && !document.getElementById('enter').disabled, null, { timeout: BOOT });
  await p.evaluate(() => { window.__f0 = window.__mobius.renderer.info.render.frame; });
  await p.waitForFunction(() => window.__mobius.renderer.info.render.frame >= window.__f0 + 12, null, { timeout: BOOT, polling: 250 });
  await p.evaluate(() => { window.__imp = (path) => { const hit = performance.getEntriesByType('resource').map((r) => r.name).filter((n) => n.split('?')[0].endsWith(path)).pop(); return import(hit ? hit.replace(location.origin, '') : path); }; });
  await p.evaluate(async (on) => { const { settings } = await window.__imp('/src/core/settings.js'); settings.tutorials = on; }, tutorials);
  await p.evaluate(() => { const a = window.__mobius; a.pendingMap = 'classic'; a.enterDesktop(); });
  await p.waitForFunction(() => ['modeSelect', 'story'].includes(window.__mobius.state) && window.__mobius.worldName === 'city' && !window.__mobius.loader.visible, null, { timeout: BOOT, polling: 500 });
  await p.waitForTimeout(1500);
  await p.evaluate(async () => {
    const a = window.__mobius, frame = a.frame.bind(a); a.frame = () => {};
    const { settings } = await window.__imp('/src/core/settings.js');
    const D = await window.__imp('/src/data/tutorials.js');
    const X = window.__x = { a, s: a.story, settings, D,
      step: (n = 1) => { for (let i = 0; i < n; i++) { a.hub.events.length = 0; frame(1 / 60, 0, null); } },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      get T() { return a.story.tutorials; }, get P() { return a.tutorialPanel; },
      /** what the panel shows right now */
      view: () => { const P = a.tutorialPanel, T = a.story.tutorials;
        return { active: T.active, page: T.page, count: T.pageCount, visible: !!P?.visible, buttons: P ? P.panel.buttons.map((b) => b.id) : [],
          media: P ? P.showing() : [], loco: a.hub.ctx.allowLocomotion, attack: a.hub.ctx.allowAttack, stage: a.story.stage, state: a.state }; },
      press: (id) => { const P = a.tutorialPanel, b = P.panel.buttons.find((q) => q.id === id); if (!b) return false; P.panel.click(b); return true; },
      /** step until fn() is true (at most n frames); returns the frames used, or -1 */
      until: (fn, n = 2400) => { for (let i = 0; i < n; i++) { if (fn()) return i; X.step(1); } return fn() ? n : -1; },
      files: (id) => D.TUTORIALS[id].pages.map((pg) => pg.media.map((m) => m.file)),
      /** the brightest of five points across each clip plane as drawn on screen (0…255); the dark frame behind a clip is about 6 */
      drawn: () => { const T3 = window.__THREE, gl = a.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(4);
        a.renderer.render(a.scene, a.camera);
        return a.tutorialPanel.vid.filter((q) => q.want).map((q) => { let best = 0; for (const [u, v] of [[0, 0], [-0.3, 0.2], [0.3, 0.2], [-0.3, -0.2], [0.3, -0.2]]) { const c = new T3.Vector3(u, v, 0).applyMatrix4(q.mesh.matrixWorld).project(a.camera); gl.readPixels(Math.round((c.x * 0.5 + 0.5) * w), Math.round((c.y * 0.5 + 0.5) * h), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); best = Math.max(best, Math.round(0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2])); } return best; }); },
      /** Wait (the browser's own time: software decoding here is slow) until every clip of the open page is on screen. */
      settle: async (max = 120000) => { const t0 = performance.now(); for (;;) { X.step(1); const m = a.tutorialPanel.showing(); if (m.length && m.every((q) => q.shown && (q.kind !== 'video' || q.time > 0))) return true; if (performance.now() - t0 > max) return false; await X.sleep(250); } },
    };
  });
  return { p, errors };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ====================================================================================================== the room
if (GROUPS.includes('room')) {
  console.log('---- room: after the radio, after the mirror');
  const { p, errors } = await open();
  const ev = (f, arg) => p.evaluate(f, arg);

  const r0 = await ev(async () => { const X = window.__x, { a, s } = X;
    await a.tutorialPanel?.ready; // (the clips are fetched when the page loads: wait for that, as a player's load screen does)
    a.go('story'); X.step(3);
    const programs0 = a.renderer.info.programs.length;
    X.step(120); const during = X.view();
    const n = X.until(() => !!X.T.active || s.stage !== 'intro', 60 * 40);
    X.step(2); await X.settle(); // (the clips start on the browser's own time)
    return { during, n, at: X.view(), radioSeen: s._radioEnd > 0, programs0, programs1: a.renderer.info.programs.length, files: X.files('move') }; });
  check('during the radio broadcast: no tutorial', r0.during.active === null && !r0.during.visible && r0.during.stage === 'intro', r0.during);
  check('the radio has finished: tutorial 1 opens on page 1 of 2, and the suit step has not started', r0.n > 0 && r0.at.active === 'move' && r0.at.visible && r0.at.page === 0 && r0.at.count === 2 && r0.at.stage === 'intro', { frames: r0.n, at: r0.at });
  check('page 1 shows Movement and Movement (Teleport) side by side, playing, muted, looping', r0.at.media.length === 2 && same(r0.at.media.map((m) => m.file), r0.files[0]) && r0.at.media.every((m) => m.kind === 'video' && m.playing && m.muted && m.loop && m.shown), r0.at.media);
  check('page 1 has Skip and Next, no Back', same(r0.at.buttons, ['skip', 'next']), r0.at.buttons);
  check('while it is open the player cannot teleport, turn or attack', r0.at.loco === false && r0.at.attack === false && r0.during.loco === true, { during: r0.during.loco, open: r0.at.loco });
  check('showing the panel compiled no shader (ready before the room appears)', r0.programs1 === r0.programs0, { before: r0.programs0, after: r0.programs1 });

  const r1 = await ev(async () => { const X = window.__x, { a, s } = X;
    await X.settle(); const decoded = X.view().media.map((m) => ({ file: m.file, w: m.w, h: m.h, ready: m.ready, t: m.time })); const drawn = X.drawn();
    X.step(60 * 20); const waited = X.view(); // 20 s later: still open, still waiting
    X.press('next'); X.step(2); await X.settle(); const p2 = X.view(); const programs2 = a.renderer.info.programs.length;
    const noNext = X.press('next');
    X.press('back'); X.step(2); await X.settle(); const back = X.view(); X.press('next'); X.step(2);
    a.toggleMenu(); X.step(3); const paused = { visible: X.view().visible, menu: a.menus.current, active: X.T.active };
    a.toggleMenu(); X.step(3); const resumed = X.view();
    return { decoded, drawn, waited, p2, noNext, back, paused, resumed, programs2, files: X.files('move') }; });
  check('the clips decode as 960×540 H.264 and are running', r1.decoded.length === 2 && r1.decoded.every((m) => m.w === 960 && m.h === 540 && m.ready >= 2 && m.t > 0), r1.decoded);
  check('both clips are drawn on the panel (their pictures, not the dark frame behind them)', r1.drawn.length === 2 && r1.drawn.every((v) => v > 40), r1.drawn);
  check('20 s later the game is still waiting on page 1', r1.waited.active === 'move' && r1.waited.page === 0 && r1.waited.stage === 'intro', r1.waited);
  check('Next: page 2 shows Turn beside the swipe picture; buttons Skip, Back, Done', r1.p2.page === 1 && same(r1.p2.media.map((m) => m.file), r1.files[1]) && r1.p2.media[0].kind === 'video' && r1.p2.media[0].playing && r1.p2.media[1].kind === 'image' && r1.p2.media[1].shown && same(r1.p2.buttons, ['skip', 'back', 'done']) && r1.noNext === false, { page: r1.p2.page, media: r1.p2.media, buttons: r1.p2.buttons });
  check('Back returns to page 1', r1.back.page === 0 && same(r1.back.media.map((m) => m.file), r1.files[0]), r1.back.media);
  check('the pause menu hides the tutorial; resuming brings it back on the same page', r1.paused.visible === false && r1.paused.menu === 'pause' && r1.paused.active === 'move' && r1.resumed.visible && r1.resumed.page === 1, { paused: r1.paused, resumed: { visible: r1.resumed.visible, page: r1.resumed.page } });

  const r2 = await ev(() => { const X = window.__x, { s } = X;
    X.press('done'); X.step(3); const after = X.view(); const vids = X.P.videos().map((v) => v.paused);
    return { after, vids, objective: X.a.hud.objective }; });
  check('Done closes it: the suit step starts, movement is back, the clips stop', r2.after.active === null && !r2.after.visible && r2.after.stage === 'suit' && r2.after.loco === true && r2.vids.every(Boolean) && !!r2.objective, { after: r2.after, vids: r2.vids, objective: r2.objective });

  // ---- tutorial 2: right after the hands-up at the mirror
  const r3 = await ev(async () => { const X = window.__x, { a, s } = X;
    s._suitUp(); X.step(3); const mirror = X.view();
    s._mirrorDone(); X.step(3); const at = X.view();
    for (const w of a.room.parts.windowSashes) w.setOpen(1.2); X.step(30); const pushed = X.view().stage; // the window pushed open while the tutorial is up: nothing starts
    for (const w of a.room.parts.windowSashes) w.setOpen(0);
    const pages = []; do { X.step(2); await X.settle(); const v = X.view(); pages.push({ page: v.page, files: v.media.map((m) => m.file), shown: v.media.every((m) => m.shown), drawn: X.drawn(), buttons: v.buttons }); } while (X.press('next'));
    return { mirror, at, pushed, pages, files: X.files('skills') }; });
  check('before the mirror: no tutorial', r3.mirror.active === null && r3.mirror.stage === 'mirror', r3.mirror);
  check('right after the hands-up: tutorial 2 opens (8 pages) and the window step has not started', r3.at.active === 'skills' && r3.at.count === 8 && r3.at.page === 0 && r3.at.visible && r3.at.stage === 'mirror' && r3.at.loco === false, r3.at);
  check('the window cannot start the chase while tutorial 2 is open', r3.pushed === 'mirror', r3.pushed);
  check('its 8 pages show, in order: window, coins, wall, web, bomb, fan web, shield, then Red Target Punch + Fly Kick side by side', r3.pages.length === 8 && r3.pages.every((q, i) => q.page === i && same(q.files, r3.files[i]) && q.shown) && r3.pages[7].files.length === 2, r3.pages.map((q) => q.files.join('+')));
  check('every one of its 9 clips is drawn on the panel', r3.pages.flatMap((q) => q.drawn).length === 9 && r3.pages.every((q) => q.drawn.every((v) => v > 40)), r3.pages.map((q) => q.drawn.join('+')));
  check('first page Skip + Next; middle pages Skip + Back + Next; last page Skip + Back + Done', same(r3.pages[0].buttons, ['skip', 'next']) && r3.pages.slice(1, 7).every((q) => same(q.buttons, ['skip', 'back', 'next'])) && same(r3.pages[7].buttons, ['skip', 'back', 'done']), r3.pages.map((q) => q.buttons.join(',')));
  const r4 = await ev(() => { const X = window.__x; X.press('done'); X.step(3); return X.view(); });
  check('Done: the window step starts', r4.active === null && r4.stage === 'window' && r4.loco === true, r4);

  // ---- once per Story run: the stage restarted from the intro shows neither again
  const r5 = await ev(() => { const X = window.__x, { s } = X;
    s.enterStage('intro'); X.step(3);
    const n = X.until(() => !!X.T.active || s.stage !== 'intro', 60 * 40); const a1 = X.view();
    s._suitUp(); X.step(2); s._mirrorDone(); X.step(3); const a2 = X.view();
    return { n, a1, a2 }; });
  check('the intro restarted in the same run: the radio leads straight to the suit, and the mirror straight to the window', r5.n > 0 && r5.a1.active === null && r5.a1.stage === 'suit' && r5.a2.active === null && r5.a2.stage === 'window', { n: r5.n, a1: r5.a1.stage, a2: r5.a2.stage });

  // ---- a new Story run shows them again; Skip closes the whole tutorial; leaving Story closes the panel
  const r6 = await ev(() => { const X = window.__x, { a, s } = X;
    a.go('story'); X.step(3); const n = X.until(() => !!X.T.active || s.stage !== 'intro', 60 * 40); X.step(2); const again = X.view();
    X.press('skip'); X.step(3); const skipped = X.view();
    s._suitUp(); X.step(2); s._mirrorDone(); X.step(3); const t2 = X.view();
    X.press('next'); X.step(2); s.enterStage('chase'); X.step(3); const jumped = X.view(); // (a dev stage jump while it is open)
    return { n, again, skipped, t2, jumped }; });
  check('a new Story run shows tutorial 1 again; Skip on page 1 closes all of it and the suit step starts', r6.n > 0 && r6.again.active === 'move' && r6.skipped.active === null && r6.skipped.stage === 'suit' && !r6.skipped.visible, { again: r6.again.active, skipped: r6.skipped.stage });
  check('a stage jump while a tutorial is open closes it and does not run its "then"', r6.t2.active === 'skills' && r6.jumped.active === null && !r6.jumped.visible && r6.jumped.stage === 'chase', { t2: r6.t2.active, jumped: r6.jumped });
  check('room group: no page errors', errors.length === 0, errors.slice(0, 3));
  await p.close();
}

// ====================================================================================================== the factory
if (GROUPS.includes('factory')) {
  console.log('---- factory: after the blue-circle countdown');
  const { p, errors } = await open();
  const ev = (f, arg) => p.evaluate(f, arg);
  await ev(async () => { const X = window.__x, { a, s } = X; await a.tutorialPanel?.ready;
    a.go('story'); X.step(2); s.suited = true; s.flow.roofFired = true; s.enterStage('loadingInterior'); });
  // the interior loads on real time: step frames until the flow waits for the player at the circle
  for (let i = 0; i < 600; i++) { const st = await ev(() => { const X = window.__x; X.step(20); return X.s.flow.state; }); if (st === 'AwaitArenaCircle') break; await p.waitForTimeout(250); }
  const f0 = await ev(async () => { const X = window.__x, { a, s } = X, f = s.flow;
    const FD = await window.__imp('/src/data/factory.js'); X.ac = a.interior.toWorld(...FD.INTERIOR.arenaCircle.pos);
    X.step(30); const programs0 = a.renderer.info.programs.length;
    const before = { flow: f.state, tut: X.T.active, shown: X.T.shown('arcade') };
    a.locomotion.placeAt(X.ac, null); X.step(50); const counting = { countdown: f.countdown !== null, banner: a.hud.banner.text };
    const n = X.until(() => !!X.T.active || s.stage === 'arcadeBattle', 600); X.step(2); await X.settle();
    const at = X.view(); const snd = { song: a.arcade.state, flow: f.state };
    X.step(60 * 8); const waited = X.view(); const snd2 = { song: a.arcade.state, flow: f.state, countdown: f.countdown };
    return { before, counting, n, at, snd, waited, snd2, files: X.files('arcade'), programs0, programs1: a.renderer.info.programs.length }; });
  check('at the blue circle before the countdown: no tutorial', f0.before.flow === 'AwaitArenaCircle' && f0.before.tut === null && !f0.before.shown, f0.before);
  check('standing in the circle starts the countdown as before', f0.counting.countdown === true, f0.counting);
  check('the countdown ends: tutorial 3 opens (4 pages) and the battle has not started', f0.n > 0 && f0.at.active === 'arcade' && f0.at.count === 4 && f0.at.visible && f0.at.stage === 'factory' && f0.at.state === 'story' && f0.at.loco === false, { n: f0.n, at: f0.at, snd: f0.snd });
  check('page 1 shows the arcade Fan Web clip', same(f0.at.media.map((m) => m.file), f0.files[0]) && f0.at.media[0].shown && f0.at.media[0].playing, f0.at.media);
  check('8 s later the song still has not started', f0.waited.active === 'arcade' && f0.waited.stage === 'factory' && f0.waited.state === 'story' && f0.snd2.song !== 'playing', { waited: f0.waited.stage, snd2: f0.snd2 });
  check('no shader compiled when it opened', f0.programs1 === f0.programs0, { before: f0.programs0, after: f0.programs1 });

  const f1 = await ev(async () => { const X = window.__x, { a, s } = X, f = s.flow;
    const pages = []; do { X.step(2); await X.settle(); const v = X.view(); pages.push({ files: v.media.map((m) => m.file), shown: v.media.every((m) => m.shown), buttons: v.buttons }); } while (X.press('next'));
    X.press('done'); X.step(2); const closed = { view: X.view(), countdown: f.countdown, flow: f.state };
    const banners = new Set(); let n = 0; while (s.stage !== 'arcadeBattle' && n < 600) { X.step(1); n++; if (a.hud.banner.text) banners.add(a.hud.banner.text); }
    X.step(5);
    return { pages, closed, n, banners: [...banners], end: { stage: s.stage, state: a.state, song: a.arcade.state, tut: X.T.active }, files: X.files('arcade') }; });
  check('its 4 pages show Fan Web, Light Web, Energy Wave, Light Bomb; the last has Done', f1.pages.length === 4 && f1.pages.every((q, i) => same(q.files, f1.files[i]) && q.shown) && same(f1.pages[3].buttons, ['skip', 'back', 'done']), f1.pages.map((q) => q.files.join('+')));
  check('Done: the panel closes and a 3-2-1 runs before the song', f1.closed.view.active === null && !f1.closed.view.visible && f1.closed.countdown > 2 && f1.closed.countdown <= 3 && f1.closed.flow === 'AwaitArenaCircle' && ['3', '2', '1'].every((d) => f1.banners.includes(d)) && f1.n >= 150 && f1.n <= 200, { closed: f1.closed.countdown, frames: f1.n, banners: f1.banners });
  check('then the battle starts', f1.end.stage === 'arcadeBattle' && f1.end.state === 'arcade' && f1.end.tut === null, f1.end);

  const f2 = await ev(() => { const X = window.__x, { a, s } = X, f = s.flow;
    f.retryBoss(); X.step(60);
    let n = 0; while (s.stage !== 'arcadeBattle' && n < 900) { X.step(1); n++; if (X.T.active) break; }
    return { n, tut: X.T.active, stage: s.stage, state: a.state }; });
  check('a retry of the boss battle goes countdown → battle with no tutorial', f2.tut === null && f2.stage === 'arcadeBattle' && f2.n > 0, f2);
  check('factory group: no page errors', errors.length === 0, errors.slice(0, 3));
  await p.close();
}

// ====================================================================================================== the switch off, and the other modes
if (GROUPS.includes('off')) {
  console.log('---- off: the "Tutorials" switch, and the modes without tutorials');
  const { p, errors } = await open({ tutorials: false });
  const ev = (f, arg) => p.evaluate(f, arg);
  const o = await ev(async () => { const X = window.__x, { a, s } = X; await a.tutorialPanel?.ready;
    a.go('story'); X.step(3);
    const n = X.until(() => !!X.T.active || s.stage !== 'intro', 60 * 40); const a1 = X.view();
    s._suitUp(); X.step(2); s._mirrorDone(); X.step(3); const a2 = X.view();
    return { n, a1, a2, shown: ['move', 'skills', 'arcade'].map((id) => X.T.shown(id)) }; });
  check('"Tutorials" off: the radio leads straight to the suit and the mirror straight to the window; nothing counted as shown', o.n > 0 && o.a1.active === null && o.a1.stage === 'suit' && !o.a1.visible && o.a2.stage === 'window' && o.shown.every((x) => !x), { n: o.n, a1: o.a1.stage, a2: o.a2.stage, shown: o.shown });
  const o2 = await ev(async () => { const X = window.__x, { a } = X; X.settings.tutorials = true;
    a.go('arcade'); X.step(60 * 6); const arc = { state: a.state, song: a.arcade.state, tut: X.T.active, visible: !!a.tutorialPanel?.visible };
    return { arc }; });
  check('the standalone Arcade (switch on): no tutorial', o2.arc.tut === null && !o2.arc.visible && ['arcade', 'calibrate', 'songSelect'].includes(o2.arc.state), o2.arc);
  check('off group: no page errors', errors.length === 0, errors.slice(0, 3));
  await p.close();
}

console.log(`\n${fails ? 'FAIL' : 'PASS'} tutorials.e2e — ${passes} passed, ${fails} failed (groups: ${GROUPS.join(', ')})`);
await browser.close();
process.exit(fails ? 1 : 0);
