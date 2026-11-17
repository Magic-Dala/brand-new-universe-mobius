// v0.47 Story chase browser tests: the shared page set-up (used by storycombat.e2e.mjs and storytune.e2e.mjs).
// Real app in headless Chromium, frames stepped by hand (deterministic, 60 Hz), input injected right after the real
// InputHub.update() — the same path a wrist web / Light Bomb / Fan Web takes from the headset.
// Software rendering is slow: the page waits are long on purpose (BOOT ms, default 240000 for the first load).
export const URL = process.env.URL || 'https://localhost:8443/';
export const BOOT = +(process.env.BOOT || 240000);
export const CHROME_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'];

/** A fresh page in the Story's chase stage (suited, the window open), frames under manual control. opts.combat: the dev switch. */
export async function openStory(browser, { combat = true, url = URL, boot = BOOT, viewport = { width: 320, height: 180 }, draw = 6 } = {}) {
  const p = await browser.newPage({ viewport, ignoreHTTPSErrors: true });
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(url, { waitUntil: 'load', timeout: boot });
  await p.waitForFunction(() => window.__mobius && !document.getElementById('enter').disabled, null, { timeout: boot });
  // the title's own warm-up (v0.30: every effect drawn hidden on the first title frames) must be over before Enter, as it is for a person
  await p.evaluate(() => { window.__f0 = window.__mobius.renderer.info.render.frame; });
  await p.waitForFunction(() => window.__mobius.renderer.info.render.frame >= window.__f0 + 12, null, { timeout: boot, polling: 250 });
  // import the module instance the app itself loaded: a dev server that has hot-reloaded a file serves it as "…js?t=<stamp>",
  // and a plain import('/src/…js') would then be a second, separate copy (its settings / audio would not be the game's)
  await p.evaluate(() => { window.__imp = (path) => { const hit = performance.getEntriesByType('resource').map((r) => r.name).filter((n) => n.split('?')[0].endsWith(path)).pop(); return import(hit ? hit.replace(location.origin, '') : path); }; });
  await p.evaluate(async (combat) => { (await window.__imp('/src/core/settings.js')).settings.storyCombat = combat; }, combat); // the dev switch, set before the Story starts
  // the title's "Dala City: Story & Arcade" entry (not a World Chase map), then the Story
  await p.evaluate(() => { const a = window.__mobius; a.pendingMap = 'classic'; a.enterDesktop(); });
  await p.waitForFunction(() => ['modeSelect', 'story'].includes(window.__mobius.state) && window.__mobius.worldName === 'city' && !window.__mobius.loader.visible, null, { timeout: boot, polling: 500 });
  await p.waitForTimeout(1500);
  await p.evaluate(async (draw) => {
    const a = window.__mobius, T = window.__THREE, hub = a.hub, orig = hub.update.bind(hub);
    const frame = a.frame.bind(a); a.frame = () => {}; // frames are stepped by the test from here on
    window.__inj = [];
    hub.update = (f, t) => { orig(f, t); for (const e of window.__inj.splice(0)) hub.events.push(e); }; // injected input, after the real update
    const s = a.story, loco = a.locomotion;
    const L = await window.__imp('/src/data/layout.js'), CH = await window.__imp('/src/game/chase.js');
    const X = window.__x = {
      a, s, T, loco, L, CH, c: s.chaseCtl, C: s.combat, E: s.endless,
      settings: (await window.__imp('/src/core/settings.js')).settings,
      audio: (await window.__imp('/src/core/audio.js')).audio,
      SC: (await window.__imp('/src/data/storyChase.js')).STORY_CHASE,
      // a hand-stepped frame runs the game but not the renderer's own loop, so the steps draw too: every `draw`-th one (6 = 10
      // pictures per second of game time, enough to show every effect; software rendering makes a picture per frame too slow). 0 = never
      draw, _f: 0,
      step(n = 1) { for (let i = 0; i < n; i++) { hub.events.length = 0; frame(1 / 60, 0, null); if (X.draw && ++X._f % X.draw === 0) a.renderer.render(a.scene, a.camera); } },
      render() { a.renderer.render(a.scene, a.camera); },
      progs: () => a.renderer.info.programs.length,
      chest: () => loco.feet(new T.Vector3()).add(new T.Vector3(0, 1.3, 0)),
      /** Hold the player still at a point (as chase.e2e does): clinging, no swing. */
      hold(pos) { loco.detach(true); loco.scripted = false; loco.placeAt(pos, null); loco.grounded = false; loco.cling = { building: 'X', normal: new T.Vector3(1, 0, 0) }; loco.vel.set(0, 0, 0); },
      /** The player at arc length sv of the story route (route height, or y). */
      at(sv, y) { const q = CH.routePoint(sv); q.y = y ?? CH.routeHeight(sv); X.hold(q); },
      /**
       * The player held at arc length X.base of the story route and Green Maniac put `gap` m ahead of him along it (his route
       * position and the jet itself: no creeping toward the roof while a check runs). dy: how far below the jet the player is.
       */
      base: 40,
      behind(gap, dy = 3) { const c = X.c, sv = X.base, bs = sv + gap, bp = CH.routePoint(bs); bp.y = CH.routeHeight(bs) + 4; c.bossS = bs; c._bossV = 0; a.boss.root.position.copy(bp); const q = CH.routePoint(sv); q.y = bp.y - dy; X.hold(q); },
      gap: () => X.c.bossS - Math.min(X.c.playerS, X.c.maxS + 10),
      /** A web from the right wrist aimed at a world point. */
      web(target, hand = 'right') { const o = X.chest().add(new T.Vector3(0.25, 0.1, 0)); window.__inj.push({ type: 'web', hand, origin: o, dir: target.clone().sub(o).normalize() }); },
      webBoss(hand = 'right') { X.C._refresh(); X.web(X.C.bossPos.clone(), hand); },
      /** A Light Bomb thrown from the right hand at a world point. */
      bomb(target) { const o = X.chest().add(new T.Vector3(0.25, 0.1, 0)), d = target.clone().sub(o).normalize(); window.__inj.push({ type: 'bombThrow', hand: 'right', origin: o, dir: d, velocity: d.clone().multiplyScalar(6), worldVelocity: d.clone().multiplyScalar(6) }); },
      fan() { const o = X.chest(), d = a.boss.root.position.clone().sub(o).normalize(); window.__inj.push({ type: 'fanWeb', t: 0, tContact: 0, open: 'left', fist: 'right', source: 'desktop', origin: o, dir: d }); },
      /** One pumpkin from his hand at the player (the same launch his throws use). */
      pumpkin(kind = 'normal') { const B = X.C.bombs, it = B._get(kind); if (!it) return null; a.boss.throwPoint(it.pos); B._launch(it, X.chest(), loco.vel); return it; },
      /** No throws of his own until the test wants them. */
      quiet(on = true) { X.C.attacks.next = on ? 1e9 : 0.5; },
      /** Fill pressure to a stall through the machine's own gain(). */
      stall() { const st = X.C.stumble; st.cancel(); for (let i = 0; i < X.SC.pressure.threshold; i++) st.gain('pumpkin', X.C.clock); },
      flying: () => X.C.bombs.items.filter((it) => it.active && it.phase === 'fly'),
      jetRope: () => loco.ropes.some((r) => r.anchor.kind === 'jet'),
    };
    { const jet = a.boss.jet, sd = jet.setDamage.bind(jet); X.jetDamage = null; jet.setDamage = (v) => { X.jetDamage = v; sd(v); }; } // (the jet's damage look has no getter: the last value set)
    // into the chase stage: suited, the window open, past the fly-by, out of the room
    a.go('story'); s.suited = true; a.setArmored(true); s.enterStage('chase');
    X.step(5 * 60 + 20); // the 5 s fly-by
    s.inRoom = false; loco.ignoreColliders = new Set();
    for (let sv = 8; sv <= X.base; sv += 8) { X.at(sv); X.step(2); } // out along the route (the chase counts progress in steps under 40 m)
    X.at(X.base); X.step(30);
  }, draw);
  return { p, errors };
}
