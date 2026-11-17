// v0.28b intro e2e: room theme (ElevenLabs loop, not the procedural placeholder) plays in the room; the police radio
// voice-over plays from the nightstand radio with its [POLICE RADIO] subtitle, ducks the music, and the suit stage
// only starts after the broadcast has ended. Needs `npm run dev`. Usage: URL=https://localhost:8444/ node tests/e2e/intro-radio.e2e.mjs
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'] });
const p = await b.newPage({ viewport: { width: 320, height: 180 }, ignoreHTTPSErrors: true });
const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' || /voice|room theme/.test(m.text())) errors.push(m.text()); });
await p.goto(process.env.URL || 'https://localhost:8443/', { waitUntil: 'load' });
await p.waitForTimeout(6000);
await p.selectOption('#lang', process.env.LANG_UI || 'en');
await p.click('#enter-desktop', { force: true }).catch(() => p.click('#enter', { force: true }));
await p.waitForTimeout(800);
const r = await p.evaluate(async () => {
  const a = window.__mobius, s = a.story, V = a.voice;
  const aUrl = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/core/audio.js')) || '/src/core/audio.js'; const { audio } = await import(aUrl);
  const frame = a.frame.bind(a); a.frame = () => {};
  const step = (n = 1) => { for (let i = 0; i < n; i++) { a.hub.events.length = 0; frame(1 / 60, 0, null); } };
  const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
  const out = { ctx: audio.ctx?.state };
  await audio.loadRoomTheme(); V.preload(); await V._loading;
  out.theme = audio.roomTheme ? { dur: +audio.roomTheme.duration.toFixed(3), ch: audio.roomTheme.numberOfChannels } : null;
  (await import('/src/core/settings.js')).settings.tutorials = false; // v0.49: the tutorial after the radio has its own checks in tutorials.e2e.mjs
  a.go('story'); s.enterStage('intro'); step(2);
  out.roomMusic = audio.roomMusicKind;
  out.themeLoop = audio._room?.theme ? { loop: audio._room.theme.src.loop, loopEnd: audio._room.theme.src.loopEnd } : null;
  const log = []; let radio = null, sub = null, duck = null, suitAt = null;
  for (let i = 0; i < 60 * 20; i++) {
    step(1);
    const st = s.stage, tt = +(i / 60).toFixed(2);
    if (!radio && V.current?.line.id === 'RADIO') { radio = { t: tt, src: V.current.source?.name, dur: +(V.current.until - V.time).toFixed(2) }; }
    if (radio && !sub && s.subtitle?.text) sub = { tag: s.subtitle.tag, text: s.subtitle.text.slice(0, 40) };
    if (radio && duck === null && i % 10 === 0) { await sleep(150); duck = +audio.ambient.gain.value.toFixed(3); }
    if (st === 'suit' && suitAt === null) { suitAt = tt; break; }
    if (i % 60 === 0) await sleep(0);
  }
  await sleep(1500);
  out.radio = radio; out.subtitle = sub; out.ambientWhileRadio = duck; out.ambientAfter = +audio.ambient.gain.value.toFixed(3);
  out.suitAt = suitAt; out.radioEndsAt = radio ? +(radio.t + radio.dur).toFixed(2) : null;
  out.stillThemeInSuit = audio.roomMusicKind;
  s.enterStage('chase'); step(2); out.afterChase = audio.roomMusicKind;
  return out;
});
console.log(JSON.stringify(r, null, 1));
console.log('errors', errors);
await b.close();
