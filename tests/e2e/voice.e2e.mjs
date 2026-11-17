// v0.28 Green Maniac voice-over e2e: chase start, Mobius still in his room → A1, A2, A3 in order, ~11 s apart,
// never overlapping, subtitles with the speaker tag; leaving the room stops new lines.
// Needs `npm run dev` running. Usage: URL=https://localhost:8444/ node tests/e2e/voice.e2e.mjs
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'] });
const p = await b.newPage({ viewport: { width: 320, height: 180 }, ignoreHTTPSErrors: true });
const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' || /voice/.test(m.text())) errors.push(m.text()); });
await p.goto(process.env.URL || 'https://localhost:8443/', { waitUntil: 'load' });
await p.waitForTimeout(6000);
await p.selectOption('#lang', process.env.LANG_UI || 'en');
await p.click('#enter-desktop', { force: true }).catch(() => p.click('#enter', { force: true }));
await p.waitForTimeout(800);
const r = await p.evaluate(async () => {
  const a = window.__mobius, s = a.story, T = window.__THREE, loco = a.locomotion, V = a.voice;
  const frame = a.frame.bind(a); a.frame = () => {};
  const step = (n = 1) => { for (let i = 0; i < n; i++) { a.hub.events.length = 0; frame(1 / 60, 0, null); } };
  const out = { audioCtx: true };
  const L = await import('/src/data/layout.js');
  a.go('story'); s.suited = true; a.setArmored(true); s.enterStage('window'); step(5);
  const o = L.ROOM.origin; loco.placeAt(new T.Vector3(o[0], o[1], o[2] - 2.4), 0); step(30);
  a.hub.desk.keys.add('KeyG'); step(50); a.hub.desk.keys.delete('KeyG'); step(1);
  out.stage = s.stage;
  step(60 * 5.5); // fly-by
  V.preload(); for (let k = 0; k < 40 && V.buffers.size < 3; k++) await new Promise((x) => setTimeout(x, 250)); // let the voice files load (real time)
  out.buffers = V.buffers.size;
  const log = []; let last = null, overlap = 0;
  for (let i = 0; i < 60 * 36; i++) {
    step(1);
    const id = V.current?.line.id || null;
    if (id && id !== last) log.push({ id, t: +V.time.toFixed(1), sub: s.subtitle.tag + ' ' + s.subtitle.text, facing: s.chaseCtl._facingBack });
    last = id;
    if (i % 60 === 0) await new Promise((x) => setTimeout(x, 0));
  }
  out.lines = log;
  // leave the room in the middle of a line: it fades out within ~1 s, then no new lines
  for (let k = 0; k < 60 * 15 && !V.current; k++) step(1);
  step(40); const speakingBefore = !!V.current;
  // v0.29: leave through the window → the A taunt is cut off and B (B1 first) plays right away, once
  const A0 = L.KEY_BUILDINGS[0], aLine = V.current?.line.id;
  const n0 = V.stats.played; loco.placeAt(new T.Vector3(o[0], o[1], A0.z - A0.d / 2 - 1.2), 0); step(2);
  out.jump = { cutOff: aLine, now: V.current?.line.id, sub: s.subtitle.tag + ' ' + s.subtitle.text, inRoom: s.inRoom };
  const bLen = V.current ? V.current.until - V.time : 0;
  for (let k = 0; k < 60 * (bLen + 0.5); k++) step(1);
  await new Promise((x) => setTimeout(x, 1200));
  out.afterB = { speaking: !!V.current, subtitle: s.subtitle.text };
  step(60 * 20);
  out.newAfterLeaving = V.stats.played - n0; // 1 = only the B line
  out.stats = V.stats;
  return out;
});
console.log(JSON.stringify(r, null, 1));
console.log('errors', errors);
await b.close();
