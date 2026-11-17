// v0.30 / v0.31 e2e: 0 shader compiles during gameplay (real app, deterministic stepping). Needs the dev server.
// Counts WebGL programs (renderer.info.programs) after the story chase has started (loading done) and again after
// swinging the whole story route with every city feature streaming in AND every VFX family triggered; then the same
// inside the factory arcade (after 'playing'). Any new program = a compile during gameplay = FAIL.
// Usage: CHROME=… node tests/e2e/v030-compile.e2e.mjs
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'] });
const p = await b.newPage({ viewport: { width: 320, height: 180 }, ignoreHTTPSErrors: true });
const errors = []; p.on('pageerror', (e) => errors.push(e.message));
await p.goto(process.env.URL || 'https://localhost:8443/', { waitUntil: 'load' });
await p.waitForFunction(() => window.__mobius && document.getElementById('enter-desktop'), null, { timeout: 180000 });
await p.waitForTimeout(7000);
await p.click('#enter-desktop', { force: true }).catch(() => p.click('#enter', { force: true }));
await p.waitForTimeout(800);
const r = await p.evaluate(async () => {
  const a = window.__mobius, s = a.story, T = window.__THREE, loco = a.locomotion, B = a.bench;
  const frame = a.frame.bind(a); a.frame = () => {};
  const out = {}; const progs = () => a.renderer.info.programs.length;
  const names = () => a.renderer.info.programs.map((q) => q.name);
  const step = (n = 1) => { for (let i = 0; i < n; i++) { a.hub.events.length = 0; frame(1 / 60, 0, null); a.renderer.render(a.scene, a.camera); } };
  // ---- story chase start (the loading / setup part is allowed to compile)
  a.go('story'); s.suited = true; a.setArmored(true); s.enterStage('chase'); step(30);
  const p0 = progs(), n0 = names();
  // ---- swing the story route at 18 m/s (scripted camera, like the City bench) with every city layer streaming
  const w = a.cityWorld, P = new T.Vector3(), Q = new T.Vector3();
  for (let sv = 30; sv < 600; sv += 0.3) {
    w.pointAt(sv, P); w.pointAt(sv + 4, Q); const d = Q.sub(P); P.y = Math.max(28, P.y);
    B.pose(P, Math.atan2(-d.x, -d.z), -0.05); a.city.update(1 / 60, P, { x: -d.x * 4.5, y: 0, z: -d.z * 4.5 });
    if (Math.round(sv / 0.3) % 6 === 0) step(1);
  }
  // street level + a look back up (other LOD bands, the steam, the shafts)
  for (const [sv, y, yawOff] of [[200, 1.7, 0], [250, 22, -1.57], [300, 150, Math.PI]]) { w.pointAt(sv, P); P.y = y; B.pose(P, yawOff, 0); a.city.setFocus(P); step(20); }
  // ---- every VFX family (old API names route to the v0.30 effects when their flag is on)
  const cam = a.camera.getWorldPosition(new T.Vector3()), fwd = new T.Vector3(0, 0, -1).applyQuaternion(a.camera.getWorldQuaternion(new T.Quaternion()));
  const at = (dd, x = 0, y = 0) => cam.clone().addScaledVector(fwd, dd).add(new T.Vector3(x, y, 0));
  const fx = a.fx, V = fx.vfx || {};
  fx.web(at(0.5), at(9)); fx.net(at(9), 0.4); const beam = fx.web(at(0.5), at(14, 2, 6), { hold: true }); step(10); fx.releaseBeam(beam);
  fx.boom(at(8), { color: 0x5fd8ff, size: 1.4 }); fx.boom(at(7, 1), { color: 0xffa020, size: 1.0 }); fx.boom(at(6, -1), { color: 0xffb020, size: 2.8, life: 0.8 });
  for (const k of Object.keys(V)) if (typeof V[k] === 'function' && !/^_/.test(k)) { try { V[k](at(8, 0.5, 0.3), cam); } catch { /* signature differs: skip */ } }
  step(90);
  out.city = { programsAtStart: p0, programsAfter: progs(), newPrograms: names().filter((x) => !n0.includes(x)), kitInstances: a.city.kit?.stats.instances, kitReady: a.city.kit?.stats.ready };
  // ---- factory arcade (loading compiles are allowed; count from 'playing')
  a.frame = frame;
  return out;
});
await p.evaluate(() => window.__mobius.startArcade());
await p.waitForFunction(() => window.__mobius.arcade.state === 'playing', null, { timeout: 900000, polling: 500 });
const r2 = await p.evaluate(async () => {
  const a = window.__mobius, T = window.__THREE, frame = a.frame.bind(a); a.frame = () => {};
  const step = (n = 1) => { for (let i = 0; i < n; i++) { a.hub.events.length = 0; frame(1 / 60, 0, null); a.renderer.render(a.scene, a.camera); } };
  step(20); const p0 = a.renderer.info.programs.length, n0 = a.renderer.info.programs.map((q) => q.name);
  const cam = a.camera.getWorldPosition(new T.Vector3()), fwd = new T.Vector3(0, 0, -1).applyQuaternion(a.camera.getWorldQuaternion(new T.Quaternion()));
  const at = (dd, x = 0, y = 0) => cam.clone().addScaledVector(fwd, dd).add(new T.Vector3(x, y, 0));
  const fx = a.fx, V = fx.vfx || {};
  fx.web(at(0.5), at(8)); fx.net(at(8), 0.4); fx.boom(at(8), { color: 0x5fd8ff, size: 0.7 }); fx.boom(at(6, 1), { color: 0xffb020, size: 0.9 });
  const t3 = [at(5, -1.5), at(5, 0), at(5, 1.5)]; a.arcade.fanFx?.fire(at(0.4), t3); for (const q of t3) a.arcade.fanFx?.burst(q, cam);
  for (const k of Object.keys(V)) if (typeof V[k] === 'function' && !/^_/.test(k)) { try { V[k](at(7, 0.5, 0.3), cam); } catch { /* skip */ } }
  step(120); // the chart keeps playing (autoplay off: bombs fly, misses happen → miss VFX too)
  // v0.31: look around the rebuilt hall (other materials / LOD of the transparent layers) and wait for the
  // occasional wire sparks + pipe steam (first burst within ≤ 7.5 s) — still no new programs allowed
  const I = a.interior, O = I.root.position, rig = a.world.player;
  const keep = rig.position.clone();
  for (const [x, z] of [[-6, 12], [6, -12], [0, 16], [-8, -2]]) { rig.position.set(O.x + x, O.y, O.z + z); step(30); }
  rig.position.copy(keep); step(480);
  const res = { programsAtStart: p0, programsAfter: a.renderer.info.programs.length, newPrograms: a.renderer.info.programs.map((q) => q.name).filter((x) => !n0.includes(x)), interior: I.stats?.version || 'v0.30', drawCalls: I.stats?.drawCalls, tris: I.stats?.tris };
  a.frame = frame; return res;
});
console.log('city    ', JSON.stringify(r.city));
console.log('factory ', JSON.stringify(r2));
const ok = r.city.programsAfter === r.city.programsAtStart && r2.programsAfter === r2.programsAtStart && !errors.length;
console.log(`shaderCompilesDuringGameplay ${(r.city.programsAfter - r.city.programsAtStart) + (r2.programsAfter - r2.programsAtStart)}`);
console.log(ok ? 'PASS v030-compile' : 'FAIL v030-compile');
console.log('errors', errors);
await b.close();
process.exit(ok ? 0 : 1);
