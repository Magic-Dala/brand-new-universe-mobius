// Optional end-to-end check. Needs `npm run dev` running and `npx playwright install chromium`.
import { chromium } from 'playwright';
const OUT = process.env.OUT || '.';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'] });
const p = await b.newPage({ viewport: { width: 1100, height: 620 }, ignoreHTTPSErrors: true });
const logs = []; p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`)); p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
await p.goto((process.env.URL || 'https://localhost:8443/'), { waitUntil: 'load' });
await p.waitForTimeout(10000);
console.log('status:', await p.textContent('#status'), '| button:', await p.textContent('#enter'));
await p.screenshot({ path: `${OUT}/xr-title.png`, timeout: 240000 }); // (SwiftShader: one XR frame of the full city can take ~7 s)
await p.click('#enter', { force: true });
await p.waitForTimeout(7000);
const st = await p.evaluate(() => { const a = window.__mobius; return { xr: a.xrActive, state: a.state, menu: a.menus.current, mode: a.hub.mode, sources: a.world.session ? [...a.world.session.inputSources].map(s => [s.handedness, !!s.hand, !!s.gamepad, s.profiles?.[0]]) : null, cam: a.camera.position.toArray().map(v => +v.toFixed(2)), rig: a.world.player.position.toArray().map(v => +v.toFixed(2)), handsVis: [a.hands.left.root.visible, a.hands.right.root.visible] }; });
console.log(JSON.stringify(st));
await p.screenshot({ path: `${OUT}/xr-mode.png`, timeout: 240000 });
console.log(logs.slice(0, 25).join('\n'));
await b.close();
