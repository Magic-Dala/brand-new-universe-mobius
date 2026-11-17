// v0.40 World Chase end-to-end (desktop Chromium + the IWER Quest 3 emulator). Needs `npm run dev` running.
//   MODE=shots  → title + every map at several route positions (OUT dir)
//   MODE=flow   → Enter VR (emulated) with a selected map → chase running → pause / restart / change map / main menu,
//                 repeated map switching with resource counts (leak check)
import { chromium } from 'playwright';
const OUT = process.env.OUT || '.';
const MODE = process.env.MODE || 'flow';
const MAPS = (process.env.MAPS || 'foldscape,forest,redrock,neon,moonlit,cloudpalace,aurora,molten').split(',');
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'] });
const p = await b.newPage({ viewport: { width: +(process.env.W || 1280), height: +(process.env.H || 720) }, ignoreHTTPSErrors: true });
const logs = []; p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`)); p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
await p.goto(process.env.URL || 'https://localhost:8443/', { waitUntil: 'load' });
await p.waitForFunction(() => window.__mobius && !document.getElementById('enter').disabled, null, { timeout: 120000 });
const waitWorld = async (id) => { try { await p.waitForFunction((id) => { const a = window.__mobius; return a.state === 'world' && a.worldChase.state && a.worldChase.mapId === id && !a.loader.visible; }, id, { timeout: 900000, polling: 500 }); } catch (e) { console.log('TIMEOUT waiting for', id, JSON.stringify(await p.evaluate(() => { const a = window.__mobius; return { state: a.state, wn: a.worldName, job: a._loadJob?.kind, loader: a.loader.state, err: a.loader.errKey }; }))); console.log(logs.slice(-30).join('\n')); throw e; } };
const info = () => p.evaluate(() => { const a = window.__mobius, w = a.worldChase, r = a.renderer.info; return { state: a.state, world: a.worldName, map: w.mapId, cs: w.state, mods: w.world?.live.size, ready: [...(w.world?.live.values() || [])].filter((c) => c.ready).length, anchors: w.renderer?.anchorMesh.count, coins: a.coins.items.length, geo: r.memory.geometries, tex: r.memory.textures, progs: r.programs?.length, calls: r.render.calls, tris: r.render.triangles, sceneChildren: a.scene.children.length, boss: a.boss.root.visible, loco: a.locomotion.world === w.world }; });

if (MODE === 'shots') {
  if (!process.env.SKIPTITLE) await p.screenshot({ path: `${OUT}/title.png`, timeout: 240000 });
  await p.evaluate(() => { const a = window.__mobius; a.audioOff = true; });
  for (const id of MAPS) {
    await p.evaluate((id) => { const a = window.__mobius; if (!a.desktop) { a.pendingMap = id; a.enterDesktop(); } else a.startWorld(id); }, id);
    await waitWorld(id);
    const positions = (process.env.POS || '14,120,260,420').split(',');
    for (const ps of positions) {
      const s = parseFloat(ps), up = ps.endsWith('u'); // "520u" = elevated view looking down the canyon
      await p.evaluate(({ s, id, up }) => {
        const a = window.__mobius, w = a.worldChase.world, T = window.__THREE;
        const pt = w.pointAt(s), ah = w.pointAt(s + 30);
        w.update(pt, { x: 0, y: 0, z: 0 }, 1 / 60, { force: true }); a.worldChase.renderer.pump(1e9);
        a.locomotion.placeAt(new T.Vector3(pt.x, pt.y - 1.6 + (up ? 9 : 0), pt.z), Math.atan2(-(ah.x - pt.x), -(ah.z - pt.z)));
        a.locomotion.grounded = true; a.locomotion.vel.set(0, 0, 0);
        a.hub.desk.yaw = 0; a.hub.desk.pitch = up ? -0.2 : 0.02;
        a.worldChase.bossS = s + 34; const bp = w.pointAt(a.worldChase.bossS); a.boss.root.position.set(bp.x, bp.y + 5.5, bp.z);
        a.hud.setMode('off'); a.worldChase.paused = true; // freeze for the shot
      }, { s, id, up });
      await p.waitForTimeout(1500);
      await p.screenshot({ path: `${OUT}/${id}-${ps}.png`, timeout: 240000 });
      console.log(id, ps, JSON.stringify(await info()));
    }
    await p.evaluate(() => { window.__mobius.worldChase.paused = false; });
  }
} else if (MODE === 'bench') {
  // fly each route at 18 m/s for BENCH seconds: streaming / recycling / rebase / coins / boss under load
  const secs = +(process.env.BENCH || 60);
  for (const id of MAPS) {
    await p.evaluate((id) => { const a = window.__mobius; if (!a.desktop) { a.pendingMap = id; a.enterDesktop(); } else a.startWorld(id); }, id);
    await waitWorld(id);
    const g0 = await info();
    await p.evaluate((secs) => { const w = window.__mobius.worldChase; w.lastBench = null; w.startBench(secs, 18); }, secs);
    await p.waitForFunction(() => !!window.__mobius.worldChase.lastBench, null, { timeout: 3600000, polling: 1000 });
    const r = await p.evaluate(() => window.__mobius.worldChase.lastBench);
    const g1 = await info();
    console.log('bench', id, JSON.stringify(r), 'geo', g0.geo, '→', g1.geo, 'mods', g1.mods, 'calls', g1.calls, 'tris', g1.tris);
  }
} else {
  // flow through the emulated headset
  await p.evaluate((id) => { window.__mobius.pendingMap = id; }, MAPS[0]); // v0.49: the website has no map picker any more (maps are picked inside VR)
  await p.screenshot({ path: `${OUT}/flow-title.png`, timeout: 240000 });
  await p.click('#enter', { force: true });
  await waitWorld(MAPS[0]);
  console.log('entered', JSON.stringify(await info()));
  await p.waitForTimeout(4000);
  await p.screenshot({ path: `${OUT}/flow-chase.png`, timeout: 240000 });
  // pause menu → restart → pause → change map
  await p.evaluate(() => window.__mobius.toggleMenu());
  console.log('pause', await p.evaluate(() => window.__mobius.menus.current));
  await p.screenshot({ path: `${OUT}/flow-pause.png`, timeout: 240000 });
  await p.evaluate(() => window.__mobius.menuRestart());
  await waitWorld(MAPS[0]); console.log('restart', JSON.stringify(await info()));
  const counts = [];
  for (const id of [...MAPS.slice(1), MAPS[0], MAPS[1]]) {
    await p.evaluate(() => { const a = window.__mobius; a.toggleMenu(); a.menus.show('worldMaps', { from: 'pause' }); });
    if (id === MAPS[1] && !counts.length) await p.screenshot({ path: `${OUT}/flow-maps.png`, timeout: 240000 });
    await p.evaluate((id) => { const a = window.__mobius; const btn = a.menus.panels.worldMaps.buttons.find((x) => x.id === `map-${id}`); btn.onClick(); }, id);
    await waitWorld(id);
    await p.waitForTimeout(1500);
    const i = await info(); counts.push(i); console.log('switch', id, JSON.stringify(i));
  }
  // main menu (back to the room) and back into a world from the mode menu
  await p.evaluate(() => { const a = window.__mobius; a.toggleMenu(); a.menuMain(); });
  await p.waitForFunction(() => window.__mobius.state === 'modeSelect' && window.__mobius.worldName === 'city', null, { timeout: 240000, polling: 500 });
  console.log('main menu', JSON.stringify(await info()));
  await p.screenshot({ path: `${OUT}/flow-mode.png`, timeout: 240000 });
  await p.evaluate(() => { const a = window.__mobius; a.menus.panels.mode.buttons.find((x) => x.id === 'world').onClick(); a.menus.panels.worldMaps.buttons.find((x) => x.id === 'map-neon').onClick(); });
  await waitWorld('neon'); console.log('from mode menu', JSON.stringify(await info()));
}
console.log(logs.slice(0, 40).join('\n'));
await b.close();
