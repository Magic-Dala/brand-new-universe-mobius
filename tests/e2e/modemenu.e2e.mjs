// v0.49 menu order end-to-end (headless Chromium + SwiftShader; needs `npm run dev`).
// The website's title page has one Enter VR Game button and no map picker; entering always opens the mode menu in
// Mobius's room, with Story (yellow "Recommended" label) on top, then Arcade, then World Chase.
//   CHROME=/usr/bin/google-chrome URL=https://localhost:8443/ node tests/e2e/modemenu.e2e.mjs
// SHOT=<file.jpg> also saves a picture of the menu. Nothing here says anything about a Quest 3.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const URL = process.env.URL || 'https://localhost:8443/', BOOT = +(process.env.BOOT || 240000);
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'];
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ARGS });
let fails = 0, passes = 0;
const check = (name, ok, info = '') => { if (ok) passes++; else fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, ignoreHTTPSErrors: true });
// a returning player whose last World Chase map is remembered by the browser
await ctx.addInitScript(() => { try { localStorage.setItem('mobius.map.v1', 'neon'); } catch { /* */ } });
const p = await ctx.newPage();
const errors = []; p.on('pageerror', (e) => errors.push(e.message));
await p.goto(URL, { waitUntil: 'load', timeout: BOOT });
await p.waitForFunction(() => window.__mobius && !document.getElementById('enter').disabled, null, { timeout: BOOT });

// ---------------------------------------------------------------- the website
const t0 = await p.evaluate(async () => {
  const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && !el.hidden && el.offsetParent !== null;
  const M = await import('/src/worlds/maps.js');
  const buttons = [...document.querySelectorAll('#title button')].filter(vis).map((b) => b.id);
  return { buttons, picker: ['map-picker', 'map-select', 'map-card', 'map-prev', 'map-next'].filter((id) => document.getElementById(id)), selects: [...document.querySelectorAll('#title select')].filter(vis).map((s) => s.id),
    mode: window.__mobius.title.xrMode, onHeadset: (await import('/src/data/modeMenu.js')).desktopLinkShown('vr'),
    enterText: document.querySelector('#enter span').textContent, remembered: M.getSelectedMap(), pending: window.__mobius.pendingMap ?? null }; });
check('title page: no map picker', t0.picker.length === 0 && same(t0.selects, ['lang']), { picker: t0.picker, selects: t0.selects });
check('title page: one Enter button and Settings (plus the desktop-preview link, which shows only under this desktop emulator, never on a headset)', t0.mode === 'emulated' && same(t0.buttons, ['enter', 'open-settings', 'enter-desktop']) && t0.onHeadset === false, { mode: t0.mode, buttons: t0.buttons, onHeadset: t0.onHeadset });
check('the browser still remembers the last chase map (neon), and the title page hands no map to the game', t0.remembered === 'neon' && t0.pending === null, { remembered: t0.remembered, pending: t0.pending });

// ---------------------------------------------------------------- Enter → the mode menu, never a chase world
await p.evaluate(() => { window.__mobius.enterDesktop(); }); // (what the Enter button does without a headset; with one it starts the VR session and then the same launch)
await p.waitForFunction(() => window.__mobius.state !== 'title' && !window.__mobius.loader.visible, null, { timeout: BOOT, polling: 500 });
await p.waitForTimeout(1500);
const m0 = await p.evaluate(async () => {
  const a = window.__mobius, I = await import('/src/core/i18n.js'), P = await import('/src/ui/panel.js'), panel = a.menus.panels.mode;
  const frame = a.frame.bind(a); a.frame = () => {}; window.__step = (n = 1) => { for (let i = 0; i < n; i++) { a.hub.events.length = 0; frame(1 / 60, 0, null); } };
  const list = () => panel.buttons.filter((b) => ['story', 'arcade', 'world'].includes(b.id)).sort((x, y) => x.y - y.y).map((b) => ({ id: b.id, y: b.y, label: b.label(), tag: b.tag ? b.tag() : null, style: b.style || null }));
  I.setLang('en'); window.__step(3); const en = list();
  // the label's colour on the panel: a pixel inside the tag, left of its text
  const story = panel.buttons.find((b) => b.id === 'story'), g = panel.g;
  g.font = `800 24px ${P.FONT}`; const tw = Math.ceil(g.measureText(story.tag()).width) + 30, tx = story.x + story.w - tw - 16, ty = story.y + 12;
  const px = [...g.getImageData(Math.round(tx + 6), Math.round(ty + 19), 1, 1).data].slice(0, 3);
  const hex = P.TAG_YELLOW, want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  I.setLang('zh-Hant'); window.__step(3); const zh = list(); I.setLang('en'); window.__step(3);
  return { state: a.state, world: a.worldName, menu: a.menus.current, visible: panel.visible, en, zh, px, want, row: panel.buttons.filter((b) => ['lang', 'exit'].includes(b.id)).map((b) => b.y) }; });
check('Enter opens the mode menu in the room (not the remembered chase world)', m0.state === 'modeSelect' && m0.world === 'city' && m0.menu === 'mode' && m0.visible, { state: m0.state, world: m0.world, menu: m0.menu });
check('from the top: Story Mode, Arcade Mode, World Chase', same(m0.en.map((b) => b.id), ['story', 'arcade', 'world']) && same(m0.en.map((b) => b.label), ['Story Mode', 'Arcade Mode', 'World Chase']), m0.en.map((b) => `${b.y}:${b.label}`));
check('only Story has the "Recommended" label, and only Story is highlighted', same(m0.en.map((b) => b.tag), ['Recommended', null, null]) && same(m0.en.map((b) => b.style), ['primary', null, null]), m0.en.map((b) => [b.tag, b.style]));
check('the label is drawn in yellow on the panel', m0.px.every((v, i) => Math.abs(v - m0.want[i]) <= 6), { drawn: m0.px, want: m0.want });
check('Traditional Chinese: same order, label 推薦', same(m0.zh.map((b) => b.id), ['story', 'arcade', 'world']) && same(m0.zh.map((b) => b.tag), ['推薦', null, null]), m0.zh.map((b) => `${b.label}${b.tag ? ' [' + b.tag + ']' : ''}`));
check('language and Exit VR sit under the three modes', m0.row.length === 2 && m0.row.every((y) => y > m0.en[2].y), m0.row);

// ---------------------------------------------------------------- nothing far away is drawn over the menu or a tutorial
// (A playtest showed a distant building of the skyline painted across the menu: the skyline and the city's light shafts were drawn
// after the panel. Each is hidden in turn; a pixel inside the panel that changes was being painted over.)
const o0 = await p.evaluate(async () => {
  const a = window.__mobius, T3 = window.__THREE, gl = a.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const grab = () => { a.renderer.render(a.scene, a.camera); const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const rect = (mesh) => { const g = mesh.geometry.parameters, xs = [], ys = []; for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) { const q = new T3.Vector3(u * g.width, v * g.height, 0).applyMatrix4(mesh.matrixWorld).project(a.camera); xs.push((q.x * 0.5 + 0.5) * W); ys.push((q.y * 0.5 + 0.5) * H); } return [Math.max(0, Math.ceil(Math.min(...xs)) + 4), Math.max(0, Math.ceil(Math.min(...ys)) + 4), Math.min(W, Math.floor(Math.max(...xs)) - 4), Math.min(H, Math.floor(Math.max(...ys)) - 4)]; };
  const diff = (A, B, [x0, y0, x1, y1], min) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > min) n++; } return n; };
  /** For the skyline and the light shafts: `behind` = its pixels inside the panel's outline with the panel hidden (it really is behind the panel);
   *  `over` = pixels of the panel it changes strongly (painted over it; seen faintly through the panel's 10 % see-through does not count). */
  window.__over = (mesh, root) => { grab(); /* (first: the panel's and the camera's matrices are current) */ const out = {}, r = rect(mesh); out.area = Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
    const pair = (o) => { const was = o.visible, A = grab(); o.visible = false; const B = grab(); o.visible = was; return [A, B]; };
    for (const name of ['Skyline', 'light-shafts']) { const o = a.scene.getObjectByName(name); if (!o) { out[name] = 'missing'; continue; }
      const [A, B] = pair(o); root.visible = false; const [C, D] = pair(o); root.visible = true;
      out[name] = { behind: diff(C, D, r, 12), over: diff(A, B, r, 40) }; }
    return out; };
  /** Inside a panel's outline: pixels that differ between the game's own skyline order and the skyline forced first (`own`), and between forced last and forced first (`late`: proves the skyline is behind this panel). */
  window.__order = (mesh) => { grab(); const sky = a.scene.getObjectByName('Skyline'), o = sky.renderOrder, r = rect(mesh); const P0 = grab(); sky.renderOrder = -1000; const P1 = grab(); sky.renderOrder = 950; const P2 = grab(); sky.renderOrder = o; return { skylineOrder: o, own: diff(P0, P1, r, 12), late: diff(P2, P1, r, 12) }; };
  window.__step(3);
  return window.__over(a.menus.panels.mode.mesh, a.menus.panels.mode.root); });
check('the far skyline and the light shafts are in view behind the menu, and neither is drawn over it', o0.area > 20000 && o0.Skyline.behind > 100 && o0.Skyline.over === 0 && o0['light-shafts'].over === 0, o0);

if (process.env.SHOT) { const data = await p.evaluate(() => { const a = window.__mobius; window.__step(2); a.renderer.render(a.scene, a.camera); return a.renderer.domElement.toDataURL('image/jpeg', 0.92); }); writeFileSync(process.env.SHOT, Buffer.from(data.split(',')[1], 'base64')); console.log('saved', process.env.SHOT); }

// ---------------------------------------------------------------- each button goes where it says
const c0 = await p.evaluate(async () => {
  const a = window.__mobius, S = (await import('/src/core/settings.js')).settings, panel = a.menus.panels.mode, press = (id) => panel.click(panel.buttons.find((b) => b.id === id));
  S.tutorials = false;
  press('world'); window.__step(3); const world = { menu: a.menus.current, state: a.state, maps: a.menus.panels.worldMaps.buttons.filter((b) => b.id.startsWith('map-')).length };
  a.menus.panels.worldMaps.buttons.find((b) => b.id === 'back').onClick(); window.__step(3); const back = a.menus.current;
  press('arcade'); window.__step(3); const arcade = a.state;
  a.go('modeSelect'); window.__step(3);
  press('story'); window.__step(3); const story = { state: a.state, stage: a.story.stage };
  // a tutorial panel in the same spot (facing the window): the clips paused so two pictures can be compared
  S.tutorials = true; a.story.tutorial('skills', () => {}); window.__step(4); for (const v of a.tutorialPanel.videos()) v.pause();
  const tut = { visible: a.tutorialPanel.visible, ...window.__over(a.tutorialPanel.panel.mesh, a.tutorialPanel.panel.root) };
  // the HUD's centre banner with the skyline behind it (the HUD is partly see-through, so the test is the draw order itself:
  // the picture with the game's own order must equal the picture with the skyline forced to be drawn first)
  a.story.tutorials.skip(); a.hud.setMode('story'); a.hud.showBanner('Jet stalled!', 9, '#7ef9ff', 'Get close and web the red ring'); window.__step(3);
  const hud = window.__order(a.hud.ban.mesh);
  return { world, back, arcade, story, tut, hud }; });
check('World Chase opens the map picker inside VR (8 maps), Back returns to the mode menu', c0.world.menu === 'worldMaps' && c0.world.maps === 8 && c0.back === 'mode', c0.world);
check('Arcade opens the song menu; Story starts the Story', c0.arcade === 'songSelect' && c0.story.state === 'story' && c0.story.stage === 'intro', { arcade: c0.arcade, story: c0.story });
check('a tutorial panel in front of the window: nothing far away is drawn over it either', c0.tut.visible && c0.tut.area > 20000 && c0.tut.Skyline.behind > 100 && c0.tut.Skyline.over === 0 && c0.tut['light-shafts'].over === 0, c0.tut);
check('the HUD banner with the skyline behind it: the skyline is not drawn over it', c0.hud.late > 20 && c0.hud.own === 0, c0.hud);
check('no page errors', errors.length === 0, errors.slice(0, 3));
console.log(`\n${fails ? 'FAIL' : 'PASS'} modemenu.e2e — ${passes} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
