// v1.1 Arcade songs end to end (headless Chromium + SwiftShader; needs `npm run dev`): the song lists (the title page's
// and the VR panel, with two imported songs: five entries), loading a 2½-minute song through the real start path, each
// new song played to the end under autoplay on every difficulty (totals consistent with the event count, no page error),
// the armored `step` (Catch the Light on Easy / Normal) and a chart without it (the first song), a stored chart with
// three-pumpkin clusters, and the decoded song buffers after switching songs. Prints PASS / FAIL lines; exit code 1 on
// any FAIL. Nothing here says anything about a Quest 3.
//   CHROME=/usr/bin/google-chrome URL=https://localhost:8443/ OUT=<dir for pictures> node tests/e2e/songs.e2e.mjs
import { launch, openArcade, URL, BOOT } from './arcadeharness.mjs';
const OUT = process.env.OUT || '.';
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''}`); };
const b = await launch();

// ---------------------------------------------------------------------------------------- the title page's list
{
  const p = await b.newPage({ viewport: { width: 1100, height: 800 }, ignoreHTTPSErrors: true });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL, { waitUntil: 'load', timeout: BOOT });
  await p.waitForFunction(() => window.__mobius && !document.getElementById('enter').disabled, null, { timeout: BOOT });
  const r = await p.evaluate(async () => {
    const S = await import('/src/core/songs.js');
    const blob = await (await fetch('audio/songs/mobius-boss-01.mp3')).blob();
    for (const name of ['Imported Song A.mp3', 'Imported Song B.mp3']) await S.importSongFile(new File([blob], name, { type: 'audio/mpeg' }));
    const list = await S.listSongs();
    return { ids: list.map((s) => s.id), titles: list.map((s) => s.title) };
  });
  await p.evaluate(() => document.getElementById('open-settings').click()); await p.waitForFunction(() => document.querySelectorAll('#song-list > li').length >= 5, null, { timeout: 120000 }).catch(() => {}); // (a script click: the emulator's own overlay may sit over the button)
  const li = await p.evaluate(() => [...document.querySelectorAll('#song-list > li')].map((x) => x.querySelector('strong')?.textContent + ' | ' + (x.querySelector('small')?.textContent || '')));
  await p.screenshot({ path: `${OUT}/songs-title-list.png` }).catch(() => {});
  check(`title page: the three built-in songs, then the imported ones (${li.length} entries)`, li.length === 5 && li[0].startsWith('Brand New Universe - Mobius') && li[1].startsWith('Cyber Boss: Phase 2') && li[2].startsWith('Catch the Light') && r.ids.slice(3).every((x) => x.startsWith('import-')), li);
  check('title page: each built-in song shows its own tempo and length', /BPM 150 .* 2:19/.test(li[1]) && /BPM 170 .* 2:36/.test(li[2]) && /BPM 125 .* 0:56/.test(li[0]), li.slice(0, 3));
  check('title page: no page errors', errs.length === 0, errs.join(' | '));
  // clean up: the two imports would stay in this browser profile's IndexedDB
  await p.evaluate(async () => { const S = await import('/src/core/songs.js'); for (const s of await S.listSongs()) if (!s.builtin) await S.deleteSong(s.id); });
  await p.close();
}

// ---------------------------------------------------------------------------------------- the Arcade
const { p, errors } = await openArcade(b, { viewport: { width: 1100, height: 800 } });
const ev = (fn, arg) => p.evaluate(fn, arg);
// the VR panel with five entries (two imported songs kept in memory for this check)
const vr = await ev(async () => {
  const X = window.__x, a = X.a, S = await window.__imp('/src/core/songs.js');
  const blob = await (await fetch('audio/songs/mobius-boss-01.mp3')).blob();
  for (const name of ['Imported Song A.mp3', 'Imported Song B.mp3']) await S.importSongFile(new File([blob], name, { type: 'audio/mpeg' }));
  const songs = await S.listSongs();
  a.state = 'songSelect'; a.menus.show('select', { songs }); a.menus.panels.select.dirty = true; a.menus.panels.select.redraw?.();
  const btns = a.menus.panels.select.buttons.filter((x) => /^song\d$/.test(x.id));
  const R = { labels: btns.map((x) => (typeof x.label === 'function' ? x.label() : x.label)), subs: btns.map((x) => (typeof x.sub === 'function' ? x.sub() : x.sub)), bottom: Math.max(...btns.map((x) => x.y + x.h)), ch: a.menus.panels.select.ch };
  // a picture of the panel itself (its canvas)
  const p = a.menus.panels.select; p.draw?.(); R.png = p.canvas.toDataURL('image/png');
  for (const s of songs) if (!s.builtin) await S.deleteSong(s.id);
  return R;
});
{ const fs = await import('node:fs'); try { fs.writeFileSync(`${OUT}/songs-vr-panel.png`, Buffer.from(vr.png.split(',')[1], 'base64')); } catch (e) { console.log('panel picture failed', e.message); } }
check(`VR song panel: five entries, the three built-in songs first (${vr.labels.join(' / ')})`, vr.labels.length === 5 && vr.labels[0] === 'Brand New Universe - Mobius' && vr.labels[1] === 'Cyber Boss: Phase 2' && vr.labels[2] === 'Catch the Light' && vr.bottom <= vr.ch - 170 + 2, { subs: vr.subs, bottom: vr.bottom });

// loading a 2½-minute song through the real start path (the loading banner covers the decode)
const ld = await ev(async () => {
  const X = window.__x, a = X.a, S = await window.__imp('/src/core/songs.js');
  X.settings.songId = 'catch-the-light'; a.state = 'songSelect';
  const t0 = performance.now(); let banner = false; const sb = a.hud.showBanner.bind(a.hud); a.hud.showBanner = (...args) => { banner = true; return sb(...args); };
  const done = a.startArcade(); await done;
  const R = { ms: Math.round(performance.now() - t0), banner, state: a.arcade.state, song: a.currentSong?.id, appState: a.state };
  a.hud.showBanner = sb; X.settings.songId = 'mobius-boss-01'; return R;
});
check(`a 2½-minute song loads through the start path with the loading banner (${ld.ms} ms), then plays`, ld.banner && ld.song === 'catch-the-light' && ld.state === 'playing' && errors.length === 0, ld);

// every new song to the end under autoplay, every difficulty
for (const id of ['cyber-boss-phase-2', 'catch-the-light']) {
  for (const d of ['hard', 'normal', 'easy']) {
    const r = await ev(async ({ id, d }) => {
      const X = window.__x, a = X.a, ar = X.ar, S = await window.__imp('/src/core/songs.js'), C = await window.__imp('/src/core/chart.js');
      X.song = await S.loadSong(id); X.settings.arcadeArmored = true;
      X.begin(d); ar.conductor.duration = X.song.buffer.duration;
      const res0 = C.resolveNotes(X.song.chart, d, { armored: true });
      const R = { total: ar.eventTotal, notes: ar.notes.length, seqs: ar.seqs.map((q) => ({ step: q.step, shells: q.shellTimes.map((t, i, arr) => (i ? +(t - arr[i - 1]).toFixed(3) : 0)) })), resolved: res0.notes.filter((n) => !n.row).length + new Set(res0.notes.filter((n) => n.row).map((n) => n.row)).size + res0.sequences.reduce((acc, q) => acc + q.hits + 1, 0) };
      let g = 0; while (ar.state === 'playing' && g++ < 20000) X.step(5);
      const res = a.lastResult || {}, c = res.counts || {};
      Object.assign(R, { state: ar.state, judged: (c.perfect || 0) + (c.good || 0) + (c.miss || 0), counts: c, armored: res.armored, rank: res.rank, failed: res.failed, sim: +X.sim.toFixed(1), dur: +X.song.buffer.duration.toFixed(2) });
      return R;
    }, { id, d });
    check(`${id} ${d}: played to the end under autoplay (${r.sim} s of ${r.dur} s), totals consistent with the event count (${r.judged} judged of ${r.total}; resolveNotes ${r.resolved}), no miss, every armored pumpkin full`, r.state === 'results' && !r.failed && r.judged === r.total && r.total === r.resolved && (r.counts.miss || 0) === 0 && r.armored.full === r.armored.sequences && r.armored.sequences >= 2, { counts: r.counts, rank: r.rank, armored: r.armored, seqs: r.seqs });
    if (id === 'catch-the-light' && d !== 'hard') check(`armored step 2 played through under autoplay (Catch the Light ${d}: shell beats ${r.seqs[0]?.shells.slice(1).join(' / ')} s apart = 2 beats at 170 BPM)`, r.seqs.every((q) => q.step === 2 && q.shells.slice(1).every((x) => Math.abs(x - 0.706) < 0.002)) && r.armored.shellHits === r.seqs.length * 3, r.seqs);
  }
}
// a chart without step (the first song) is unchanged: shells one beat apart
const one = await ev(async () => {
  const X = window.__x, ar = X.ar, S = await window.__imp('/src/core/songs.js');
  X.song = await S.loadSong('mobius-boss-01'); X.begin('normal'); ar.conductor.duration = X.song.buffer.duration;
  const R = { seqs: ar.seqs.map((q) => ({ step: q.step, raw: X.song.chart.difficulties.normal.events.find((e) => e.id === q.id).step, gaps: q.shellTimes.slice(1).map((t, i) => +(t - q.shellTimes[i]).toFixed(3)) })) };
  let g = 0; while (ar.state === 'playing' && g++ < 20000) X.step(5);
  R.armored = X.a.lastResult?.armored; return R;
});
check('a chart without `step` loads as before: shell beats one beat apart (0.48 s at 125 BPM), all armored pumpkins full under autoplay', one.seqs.every((q) => q.step === 1 && q.raw === undefined && q.gaps.every((x) => Math.abs(x - 0.48) < 0.002)) && one.armored.full === 3, one);
// a stored chart with three-pumpkin clusters (a v1.0 import in a browser): ordinary pumpkins, two at most at once
const st = await ev(async () => {
  const X = window.__x, ar = X.ar;
  const chart = { format: 'mobius-chart', version: 1, song: { id: 'import-old', title: 'Old import', audio: { storeKey: 'x' }, durationSec: 20 }, timing: { bpm: 125, offsetSec: 0.31, beatsPerBar: 4 }, difficulties: { normal: { travelSec: 2.05, events: [
    { id: 'n0', beat: 8, type: 'pumpkin', hand: 'R', lane: { x: 0.7, y: 0.5 } },
    { id: 'n1', beat: 12, type: 'cluster', hand: 'any', lane: { x: -0.22, y: 0.5 }, group: 'c1' }, { id: 'n2', beat: 12, type: 'cluster', hand: 'any', lane: { x: 0.22, y: 0.5 }, group: 'c1' }, { id: 'n3', beat: 12, type: 'cluster', hand: 'any', lane: { x: 0, y: 0.72 }, group: 'c1' },
    { id: 'n4', beat: 20, type: 'cluster', hand: 'any', lane: { x: -0.22, y: 0.5 }, group: 'c4' }, { id: 'n5', beat: 20, type: 'cluster', hand: 'any', lane: { x: 0.22, y: 0.5 }, group: 'c4' }, { id: 'n6', beat: 20, type: 'cluster', hand: 'any', lane: { x: 0, y: 0.72 }, group: 'c4' },
    { id: 'n7', beat: 24, type: 'pumpkin', hand: 'L', lane: { x: -0.7, y: 0.5 } }] } } };
  X.begin('normal', { chart });
  const types = [...new Set(ar.notes.map((n) => n.type))], at = {}; for (const n of ar.notes) at[n.time.toFixed(2)] = (at[n.time.toFixed(2)] || 0) + 1;
  let g = 0; while (ar.state === 'playing' && g++ < 5000) X.step(5);
  return { types, most: Math.max(...Object.values(at)), total: ar.eventTotal, judged: Object.values(X.a.lastResult?.counts || {}).reduce((a2, v) => a2 + v, 0) };
});
check(`a stored chart with three-pumpkin clusters loads as ordinary pumpkins, two at most at once (types ${st.types.join(', ')}, most at one moment ${st.most}, ${st.total} events)`, st.types.length === 1 && st.types[0] === 'pumpkin' && st.most === 2 && st.total === 6 && st.judged === 6, st);
// the decoded song buffers after switching songs
const buf = await ev(async () => {
  const S = await window.__imp('/src/core/songs.js'), A = (await window.__imp('/src/core/audio.js')).audio;
  const R = { steps: [] };
  for (const id of ['mobius-boss-01', 'cyber-boss-phase-2', 'catch-the-light', 'cyber-boss-phase-2', 'mobius-boss-01']) {
    const s = await S.loadSong(id);
    R.steps.push({ loaded: id, held: S.songBuffers().map((x) => `${x.id} ${(x.bytes / 1e6).toFixed(1)} MB`), bytes: S.songBuffers().reduce((acc, x) => acc + x.bytes, 0), decoded: s.buffer.length * s.buffer.numberOfChannels * 4 });
  }
  R.allThree = R.steps.slice(0, 3).reduce((acc, x) => acc + x.decoded, 0); // what v1.0 would hold after playing the three songs (it kept every decoded file)
  R.mapSongKeys = [...A.buffers.keys()].filter((k) => /audio\/songs\//.test(k));
  return R;
});
for (const s of buf.steps) console.log(`  after loading ${s.loaded}: ${s.held.join(' + ')} = ${(s.bytes / 1e6).toFixed(1)} MB`);
check(`song buffers: the first song plus at most one other (${(buf.steps[2].bytes / 1e6).toFixed(1)} MB held after the three songs, against ${(buf.allThree / 1e6).toFixed(1)} MB kept by v1.0)`, buf.steps.every((s) => s.held.length <= 2) && buf.steps[2].held.length === 2 && buf.mapSongKeys.length <= 2, buf.mapSongKeys);
check('Arcade: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await b.close();
console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
