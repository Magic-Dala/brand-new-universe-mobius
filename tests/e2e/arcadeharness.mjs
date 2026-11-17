// v0.48: shared set-up for the Arcade browser tests (the real game in the v0.31 factory hall, a simulated music clock).
// Needs the dev server. openArcade() boots the game, enters the Arcade the way the menu does and hands back a page with
// window.__x: begin(difficulty, opts) restarts the song on a clock the test steps; step(n) runs whole game frames.
import { chromium } from 'playwright';
export const URL = process.env.URL || 'https://localhost:8443/';
export const BOOT = +(process.env.BOOT_MS || 600000);
export const launch = () => chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'] });

export async function openArcade(browser, { url = URL, boot = BOOT, viewport = { width: 320, height: 180 }, pre = null } = {}) {
  const p = await browser.newPage({ viewport, ignoreHTTPSErrors: true });
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(url, { waitUntil: 'load', timeout: boot });
  await p.waitForFunction(() => window.__mobius && !document.getElementById('enter').disabled, null, { timeout: boot });
  await p.evaluate(() => { window.__f0 = window.__mobius.renderer.info.render.frame; });
  await p.waitForFunction(() => window.__mobius.renderer.info.render.frame >= window.__f0 + 12, null, { timeout: boot, polling: 250 });
  await p.evaluate(() => { window.__imp = (path) => { const hit = performance.getEntriesByType('resource').map((r) => r.name).filter((n) => n.split('?')[0].endsWith(path)).pop(); return import(hit ? hit.replace(location.origin, '') : path); }; });
  if (pre) await p.evaluate(async (pre) => { Object.assign((await window.__imp('/src/core/settings.js')).settings, pre); }, pre); // dev switches, set before the Arcade starts
  await p.evaluate(() => { const a = window.__mobius; a.pendingMap = 'classic'; a.enterDesktop(); });
  await p.waitForFunction(() => ['modeSelect', 'story'].includes(window.__mobius.state) && window.__mobius.worldName === 'city' && !window.__mobius.loader.visible, null, { timeout: boot, polling: 500 });
  await p.waitForTimeout(1000);
  await p.evaluate(() => { const a = window.__mobius; a.storyArcade = false; a.startArcade(); });
  await p.waitForFunction(() => window.__mobius.state === 'arcade' && window.__mobius.worldName === 'factory' && window.__mobius.arcade.state === 'playing' && !window.__mobius.loader.visible, null, { timeout: boot, polling: 500 });
  await p.evaluate(async () => {
    const a = window.__mobius, T = window.__THREE, hub = a.hub, ar = a.arcade, orig = hub.update.bind(hub);
    const frame = a.frame.bind(a); a.frame = () => {}; // frames are stepped by the test from here on
    window.__inj = [];
    hub.update = (f, t) => { orig(f, t); for (const e of window.__inj.splice(0)) hub.events.push(e); };
    const settings = (await window.__imp('/src/core/settings.js')).settings;
    const info = a.renderer.info;
    a.onArcadeFinished = (r) => { a.lastResult = r; };
    const X = window.__x = {
      a, ar, T, settings, sim: -2, dt: 1 / 60, song: a.currentSong,
      /** restart the song on a stepped clock. opts: { chart, autoplay = true } */
      begin(difficulty = 'normal', { chart = null, autoplay = true } = {}) {
        settings.difficulty = difficulty; settings.offsetMs = 0; a.lastResult = null;
        a.state = 'arcade';
        ar.start({ song: X.song, chart: chart || X.song.chart, difficulty }); ar.conductor.stop();
        const c = ar.conductor; X.sim = -2;
        c.now = () => X.sim; c.tick = () => { if (X.sim >= c.duration) { c.state = 'ended'; c.onEnded?.(); } }; c.state = 'playing';
        c.pause = () => { c.state = 'paused'; }; c.resume = () => { c.state = 'playing'; };
        if (chart?.song?.durationSec) Object.defineProperty(c, 'duration', { value: chart.song.durationSec, configurable: true, writable: true });
        ar.debug.autoplay = autoplay; for (const k of ['autoplayArmored', 'autoplayWave', 'autoplayShellSkip', 'autoplayDt', 'autoplayFan']) delete ar.debug[k]; // a clean run: no leftovers of an earlier check
      },
      step(n = 1) { for (let i = 0; i < n; i++) { hub.events.length = 0; frame(X.dt, 0, null); X.sim += X.dt; } },
      until(t) { let g = 0; while (X.sim < t && ar.state === 'playing' && g++ < 200000) X.step(1); },
      inject(e) { window.__inj.push(e); },
      render() { a.renderer.render(a.scene, a.camera); return { calls: info.render.calls, tris: info.render.triangles }; },
      lights() { let n = 0; a.scene.traverseVisible((o) => { if (o.isLight && !o.isAmbientLight && !o.isHemisphereLight && o.intensity > 0) n++; }); return n; },
      programs() { return info.programs.length; },
    };
  });
  return { p, errors };
}
