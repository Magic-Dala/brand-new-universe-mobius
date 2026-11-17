// v0.44 palm shield + web pull end-to-end (headless Chromium + SwiftShader; needs a dev server: `npm run dev`, or
// `npm run dev:usb` with URL=http://localhost:5173/). Desktop preview — NOT a headset test:
//   - shield: the dev key (hold B = right-hand shield in front of the camera) runs the real energy / blocking path
//     against pumpkins launched from Green Maniac's hand; facing away, pause, run end and restart are checked too;
//   - pull: a web is attached to a real building anchor, then the player-local hand point (hub.handLocal) is moved
//     back toward the chest right after the real InputHub.update() — the same data the hand tracking provides.
// The palm gesture itself (joints → shield) is covered by tests/shield.test.mjs; hardware feel needs a Quest 3.
import { chromium } from 'playwright';
const MAP = process.env.MAP || 'foldscape';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'] });
const p = await b.newPage({ viewport: { width: +(process.env.W || 960), height: +(process.env.H || 540) }, ignoreHTTPSErrors: true });
const logs = []; p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`)); p.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const ev = (fn, arg) => p.evaluate(fn, arg);
const frames = async (n) => { const f0 = await ev(() => window.__frames || 0); await p.waitForFunction((x) => (window.__frames || 0) >= x, f0 + n, { timeout: 600000, polling: 50 }); };
const until = (fn, arg, timeout = 300000) => p.waitForFunction(fn, arg, { timeout, polling: 100 });

await p.goto(process.env.URL || 'https://localhost:8443/', { waitUntil: 'load' });
await p.waitForFunction(() => window.__mobius && !document.getElementById('enter').disabled, null, { timeout: 200000 });
await ev(() => {
  const a = window.__mobius, hub = a.hub, orig = hub.update.bind(hub), T = window.__THREE;
  window.__inj = []; window.__frames = 0;
  hub.update = (f, t) => { orig(f, t); window.__frames++; if (window.__aimFn) window.__aimFn(hub, T); if (window.__handFn) window.__handFn(hub, T); for (const e of window.__inj.splice(0)) hub.events.push(e); };
  a.audioOff = true;
  window.__chest = () => a.locomotion.feet(new T.Vector3()).add(new T.Vector3(0, 1.3, 0));
  /** Turn the desktop camera toward a world point (or away from it). */
  window.__look = (pt, away = false) => {
    const cam = a.camera, rig = a.world.player, c = cam.getWorldPosition(new T.Vector3()), d = pt.clone().sub(c); if (away) d.multiplyScalar(-1);
    hub.desk.yaw = Math.atan2(-d.x, -d.z) - rig.rotation.y; hub.desk.pitch = Math.max(-1.3, Math.min(1.3, Math.atan2(d.y, Math.hypot(d.x, d.z))));
  };
  window.__quiet = () => { const w = a.worldChase; w.clock = Math.max(w.clock, 7); w.bombs.timer = 99; w.fight.nextAttackIn = 1e9; w.bombs.clear(); };
  window.__launch = () => { const B = a.worldChase.bombs, it = B._get(); if (!it) return null; a.boss.throwPoint(it.pos); B._launch(it, window.__chest(), a.locomotion.vel); return it.id; };
});
const waitWorld = () => until((id) => { const a = window.__mobius; return a.state === 'world' && a.worldChase.state && a.worldChase.mapId === id && !a.loader.visible; }, MAP, 900000);
const flown = () => until(() => window.__mobius.worldChase.bombs.flying.length === 0, null, 120000);
const snap = () => ev(() => { const a = window.__mobius, w = a.worldChase, s = a.shield, l = a.locomotion; return { hp: w.hp.hp, blocked: w.bombs.stats.blocked, hits: w.bombs.stats.hits, exploded: w.bombs.stats.exploded, destroyed: w.bombs.stats.destroyed, energy: +s.energy.value.toFixed(1), up: s.anyActive, sBlocked: s.stats.blocked, ctx: a.hub.ctx.shield, att: !!l.attach, pst: l.pull.right.state, pulls: l.stats.pulls, pullDv: +l.stats.pullDv.toFixed(2), cut: +(w._pullLead?.cut || 0).toFixed(2), gap: +(w.bossS - w.playerS).toFixed(1), busy: a.hub.pullBusy.right, surge: +l.pull.surge.toFixed(2) }; });

console.log(`---- ${MAP}`);
await ev((id) => { const a = window.__mobius; a.pendingMap = id; a.enterDesktop(); }, MAP);
await waitWorld();
await ev(() => { window.__mobius.worldChase.stateTime = 99; });
await until(() => window.__mobius.worldChase.state === 'chase', null, 120000);
await ev(() => window.__quiet()); await frames(5);

// ================================================================ shield
let s0 = await snap();
check('fresh run: full shield energy, shield down, allowed in the World Chase', s0.energy === 100 && !s0.up && s0.ctx === true, JSON.stringify(s0));
await ev(() => { const a = window.__mobius; window.__aimFn = () => window.__look(a.worldChase.bossPos); a.hub.desk.keys.add('KeyB'); });
await frames(3);
let s1 = await snap();
check('hold B: the shield rises (same detector / energy path as the palm gesture)', s1.up === true);
if (process.env.OUT) { await frames(4); await p.screenshot({ path: `${process.env.OUT}/shieldpull-${MAP}-shield.png` }).catch(() => {}); }
await ev(() => window.__launch()); await flown(); await frames(2);
let s2 = await snap();
check('a pumpkin thrown at the player bursts on the shield: blocked once, no explosion, no hit, HP unchanged, energy spent', s2.blocked === s1.blocked + 1 && s2.sBlocked === 1 && s2.hits === s1.hits && s2.exploded === s1.exploded && s2.hp === s1.hp && s2.destroyed === s1.destroyed && s2.energy < s1.energy - 20, JSON.stringify({ s1, s2 }));
// facing away: the back of the shield does not protect
await ev(() => { const a = window.__mobius; a.shield.energy.reset(); window.__aimFn = () => window.__look(a.worldChase.bossPos, true); });
await frames(3); await ev(() => window.__launch()); await flown(); await frames(2);
let s3 = await snap();
check('shield turned away from the pumpkin: not blocked, the pumpkin hits', s3.up === true && s3.blocked === s2.blocked && s3.hits === s2.hits + 1 && s3.hp < s2.hp, JSON.stringify(s3));
// no shield: hit (control) — after the damage protection ran out
await ev(() => { const a = window.__mobius; a.hub.desk.keys.delete('KeyB'); window.__aimFn = () => window.__look(a.worldChase.bossPos); a.worldChase.hp.until = -1; });
await frames(3); await ev(() => window.__launch()); await flown(); await frames(2);
let s4 = await snap();
check('no shield: the same throw hits (control)', !s4.up && s4.hits === s3.hits + 1 && s4.blocked === s3.blocked && s4.hp < s3.hp, JSON.stringify(s4));
// pause: shield down, energy frozen
await ev(() => { const a = window.__mobius; a.shield.energy.value = 60; a.hub.desk.keys.add('KeyB'); }); await frames(3);
const up5 = (await snap()).up;
await ev(() => window.__mobius.toggleMenu()); await frames(4);
const s5 = await snap(); await frames(20); const s6 = await snap();
check('pause menu: the shield drops and its energy neither drains nor recharges', up5 && !s5.up && s5.ctx === false && s6.energy === s5.energy, JSON.stringify({ s5, s6 }));
await ev(() => window.__mobius.toggleMenu()); await frames(4);
check('resume: the held shield comes back', (await snap()).up === true);
await ev(() => { const a = window.__mobius; a.hub.desk.keys.delete('KeyB'); a.shield.energy.reset(); window.__aimFn = null; a.worldChase.hp.reset(); }); await frames(2);

// ================================================================ pull
const at0 = await ev(() => {
  const a = window.__mobius, loco = a.locomotion, T = window.__THREE, o = window.__chest().add(new T.Vector3(0.25, 0.1, 0));
  const fwd = a.worldChase.bossPos.clone().sub(o).setY(0).normalize();
  const an = loco.anchorCandidates(o).map((c) => c.anchor).filter((x) => x.valid && !loco.occluded(o, x.p, x.building) && !loco.occluded(window.__chest(), x.p, x.building) && x.p.clone().sub(o).normalize().dot(fwd) > 0.3 && x.p.distanceTo(o) > 18).sort((p, q) => p.p.distanceTo(o) - q.p.distanceTo(o))[0];
  if (!an) return null;
  const d = an.p.clone().sub(o).normalize();
  a.hub.desk.keys.add('KeyF'); // (desktop: holds the web)
  window.__inj.push({ type: 'web', hand: 'right', origin: o, dir: d });
  // the player-local hand point: stretched out 0.6 m from the chest, later pulled in to 0.3 m
  // (the stroke is driven per rendered frame inside the page, so slow SwiftShader frames cannot skip samples)
  window.__reach = 0.6; window.__stroke = null;
  window.__pull = () => { window.__reach = 0.6; window.__stroke = { f0: window.__frames, n: 12 }; };
  window.__handFn = (hub) => { const c = a.camera.position, S = window.__stroke; if (S) window.__reach = 0.6 - 0.3 * Math.min(1, (window.__frames - S.f0) / S.n); hub.handLocal.right.valid = true; hub.handLocal.right.pos.set(c.x + 0.17 * window.__reach / 0.6, c.y - 0.25, c.z - 0.575 * window.__reach / 0.6); };
  return { dist: +an.p.distanceTo(o).toFixed(1), id: an.id };
});
await frames(3);
const att = await ev(() => { const l = window.__mobius.locomotion; return { attached: !!l.attach, env: !!l.attach && !l.attach.anchor.moving, len: l.attach?.len }; });
check(`web attached to a building anchor (${at0?.id}, ${at0?.dist} m)`, !!at0 && att.attached && att.env, JSON.stringify(att));
await frames(8);
const p0 = await snap();
check('holding the web with a still hand: no pull', p0.pulls === 0 && p0.pullDv === 0, JSON.stringify(p0));
await ev(() => window.__pull()); await frames(18); // ≈ 30 cm stroke over 12 frames, then held
const p1 = await snap();
const still = await ev(() => !!window.__mobius.locomotion.attach);
check('pulling the web hand back: one stroke → speed toward the anchor, Green Maniac gives up some lead', p1.pulls === 1 && p1.pullDv > 2.5 && p1.pullDv <= 5.01 && (p1.cut > 1 || !still), JSON.stringify(p1));
await frames(10);
const p2 = await snap();
check('holding the hand at the chest afterwards: nothing more (only the smoothed tail of that one stroke, ≤ one full stroke in total)', p2.pulls === 1 && p2.pullDv <= 5.01, JSON.stringify(p2));
await frames(10);
const p3 = await snap();
check('…and then nothing', p3.pulls === 1 && p3.pullDv - p2.pullDv < 0.1 && p3.pullDv <= 5.01, JSON.stringify(p3));
// end of run mid-swing: frozen, no pull, no shield
await ev(() => { const a = window.__mobius; a.worldChase._resolve('defeat'); a.hub.desk.keys.add('KeyB'); window.__stroke = null; window.__reach = 0.6; }); await frames(3);
const f0 = await ev(() => { const a = window.__mobius; return { pos: a.world.player.position.toArray(), frozen: !!a.locomotion.frozen }; });
await ev(() => window.__pull()); await frames(16);
const f1 = await ev(() => { const a = window.__mobius; return { pos: a.world.player.position.toArray(), v: a.locomotion.vel.length(), pulls: a.locomotion.stats.pulls, up: a.shield.anyActive, ctx: a.hub.ctx.shield, flying: a.worldChase.bombs.flying.length }; });
check('run resolved: the rig stays frozen, a stroke does nothing, no shield, no pumpkins', f0.frozen && f1.v === 0 && f1.pos.every((x, i) => x === f0.pos[i]) && f1.pulls === p2.pulls && !f1.up && f1.ctx === false && f1.flying === 0, JSON.stringify({ f0, f1 }));
// restart: clean
await ev(() => { const a = window.__mobius; a.hub.desk.keys.delete('KeyB'); a.hub.desk.keys.delete('KeyF'); window.__handFn = null; a.menus.hide?.(); a.worldChase.restart(); });
await until(() => window.__mobius.loader.visible, null, 60000).catch(() => {});
await waitWorld(); await frames(5);
const r0 = await ev(() => { const a = window.__mobius, l = a.locomotion; return { energy: a.shield.energy.value, up: a.shield.anyActive, sBlocked: a.shield.stats.blocked, over: l.pull.over, surge: l.pull.surge, pending: l.pull.pending.right, st: l.pull.right.state, cut: a.worldChase._pullLead.cut, hp: a.worldChase.hp.hp, frozen: !!l.frozen, phase: a.worldChase.run.phase }; });
check('restart: shield full + down, no pull state, lead cut 0, fresh run', r0.energy === 100 && !r0.up && r0.sBlocked === 0 && r0.over === 0 && r0.surge === 0 && r0.pending === 0 && r0.st === 'idle' && r0.cut === 0 && r0.hp === 100 && !r0.frozen && r0.phase === 'preparing', JSON.stringify(r0));
if (process.env.OUT) await p.screenshot({ path: `${process.env.OUT}/shieldpull-${MAP}.png` }).catch(() => {});
check('no page errors', logs.length === 0, logs.slice(0, 5).join('\n'));
console.log(fails ? `FAILED (${fails})` : 'ALL PASS');
await b.close();
process.exit(fails ? 1 : 0);
