// v0.48 Arcade hall show, armored pumpkin and energy wave: browser proof (the real game in the v0.31 hall, a stepped
// music clock; headless Chrome with software rendering). Groups (ONLY=show,play,off,wave,chart2): prints PASS / FAIL lines.
import { readFileSync } from 'node:fs';
import { launch, openArcade } from './arcadeharness.mjs';
const ONLY = (process.env.ONLY || 'show,play,off,wave,chart2').split(',');
let pass = 0, fail = 0;
const ok = (c, name, detail = '') => { if (c) { pass++; console.log(`PASS ${name}${detail ? ` | ${detail}` : ''}`); } else { fail++; console.log(`FAIL ${name}${detail ? ` | ${detail}` : ''}`); } };
const b = await launch();

if (ONLY.includes('show')) {
  // ---- the hall on the beat: uniforms at rest with the switch off; the corridor's brightness at show level 3
  const { p, errors } = await openArcade(b, { viewport: { width: 640, height: 360 } });
  const r = await p.evaluate(async () => {
    const X = window.__x, a = X.a, T = X.T, hall = a.interior, R = {};
    const rest = (s) => s.uShowE.every((v) => v === 0) && s.uShow.every((v) => v === 0) && s.uShowB.every((v) => v === 0) && s.uShowC.every((v) => v === 0) && s.uShowD.every((v) => v === 0) && s.light === 0;
    X.settings.arcadeShow = false; X.begin('hard'); X.until(12);
    R.off = { rest: rest(hall.showState), level: X.ar.show.level, active: X.ar.show.active };
    X.settings.arcadeShow = true; X.begin('hard'); X.until(12);
    R.on = { state: hall.showState, level: X.ar.show.level, programs0: X.programs() };
    // which parts of the picture lie inside the lane corridor: one ray per 10 × 10 pixel block against the hall's own meshes;
    // a block is inside when the first surface it sees is inside the corridor (three lanes plus 1.5 m each side, the player to the north door)
    const C = hall.showState.corridor, cam = a.camera, org = hall.toWorld(0, 0, 0);
    const W = a.renderer.domElement.width, H = a.renderer.domElement.height, BS = 10, bw = Math.floor(W / BS), bh = Math.floor(H / BS);
    const meshes = []; hall.root.traverse((o) => { if (o.isMesh && /^FactoryV2_(atlas|floor|cutout|emissive)$/.test(o.name)) meshes.push(o); });
    const rc = new T.Raycaster(), ndc = new T.Vector2(), inBlock = new Uint8Array(bw * bh); let nIn = 0;
    cam.updateMatrixWorld(true);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      ndc.set(((bx + 0.5) * BS / W) * 2 - 1, 1 - ((by + 0.5) * BS / H) * 2); rc.setFromCamera(ndc, cam);
      const hit = rc.intersectObjects(meshes, false)[0]; if (!hit) continue;
      const x = hit.point.x - org.x, z = hit.point.z - org.z;
      if (Math.abs(x) <= C.xHalf && z >= C.zNorth - 0.3 && z <= C.zSouth) { inBlock[by * bw + bx] = 1; nIn++; }
    }
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d', { willReadFrequently: true });
    const shot = () => { a.renderer.render(a.scene, a.camera); g.drawImage(a.renderer.domElement, 0, 0); const d = g.getImageData(0, 0, W, H).data; let si = 0, ni = 0, so = 0, no = 0; for (let y = 0; y < bh * BS; y++) for (let x = 0; x < bw * BS; x++) { const i = (y * W + x) * 4, l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; if (inBlock[Math.floor(y / BS) * bw + Math.floor(x / BS)]) { si += l; ni++; } else { so += l; no++; } } return { in: si / Math.max(1, ni), out: so / Math.max(1, no), share: ni / (ni + no) }; };
    // the same frame drawn twice, only the show's numbers differ: beat trough and beat peak at level 3 (lamp chase, strips, brighter streaks)
    // (chase 0 = every lamp at its peak together: the largest change the show can make; with the chase on the lamps peak one after another)
    const lvl3 = (beat, phase, chase = 0) => ({ beat, level: 3, dip: 0, hue: [1.75, 0.91, 0.34], swing: 0.25, phase, attack: 0.083, fall: 0.55, chase, strips: 1, flare: beat * 0.25, streak: 0.15, wave: 0, waveR: 0, band: beat * 0.25, bandPos: 0.4, wash: beat * 0.46, hop: beat * 0.3, ceil: 3 }); // (2026-11-15: with the light band, the colour wash and the pumpkins at the top of their hop)
    X.ar.lanes.setVisible(false); // the lanes pulse on the beat by themselves (v0.16); they are not part of the hall
    X.ar.boss.setVisible(false); a.hud.setMode('off'); // Green Maniac dances and the HUD counts: neither is the hall
    hall.setShow(lvl3(0, 0.999)); hall.update(0, 100, a.camera); const lo = shot();
    hall.setShow(lvl3(1, 0.083)); hall.update(0, 100, a.camera); const hi = shot();
    hall.setShow(lvl3(1, 0.083, 0.5)); hall.update(0, 100, a.camera); const chase = shot();
    hall.setShow({ ...lvl3(1, 0.083), dip: 0.40 }); hall.update(0, 100, a.camera); const burst = shot();
    hall.setShow({ ...lvl3(0, 0.999), dip: -0.65 }); hall.update(0, 100, a.camera); const dim = shot();
    hall.setShow(); hall.update(0, 100, a.camera); const restShot = shot();
    X.ar.boss.setVisible(true); a.hud.setMode('arcade');
    X.ar.lanes.setVisible(true);
    R.corr = { lo, hi, chase, burst, dim, rest: restShot, blocks: [nIn, bw * bh] };
    X.until(14); R.on.programs1 = X.programs(); R.on.lights = X.lights();
    X.begin('hard');
    // the live show never writes more than its level allows
    let maxSwing = 0, maxLight = 0, minGain = 0, maxGain = 0; const lv = new Set();
    while (X.ar.state === 'playing' && X.sim < 60) { X.step(2); const s = hall.showState; maxSwing = Math.max(maxSwing, s.uShow[0]); maxLight = Math.max(maxLight, Math.abs(s.light)); minGain = Math.min(minGain, s.uShow[1]); maxGain = Math.max(maxGain, s.uShow[1]); lv.add(X.ar.show.level); }
    R.live = { maxSwing, maxLight, minGain, maxGain, levels: [...lv].sort(), programs2: X.programs() };
    R.live.stats = { ...X.ar.showStats };
    // S4: the player stops answering from 34 s to 39 s → misses: the level drops one at a time, the hall dips, he taunts
    X.begin('hard'); X.until(34); const lvBefore = X.ar.show.level; X.ar.debug.autoplay = false;
    let dipMin = 0, lvMin = 9; const seen = [];
    while (X.sim < 39) { X.step(1); dipMin = Math.min(dipMin, hall.showState.uShow[1]); const l = X.ar.show.level; if (seen.at(-1) !== l) seen.push(l); lvMin = Math.min(lvMin, l); }
    R.miss = { lvBefore, seen, dipMin, stats: { ...X.ar.showStats }, misses: X.ar.score.counts.miss, light: hall.showState.light };
    X.ar.stop(); R.afterStop = rest(hall.showState);
    return R;
  });
  const pc = (a, c) => Math.abs(c - a) / Math.max(1e-6, a) * 100;
  ok(r.off.rest && !r.off.active, 'arcadeShow = false: the hall uniforms stay at rest for the whole run', JSON.stringify(r.off));
  ok(r.on.state.uShow[0] > 0 && r.on.state.uShowB[1] > 0, 'arcadeShow = true: the hall receives the beat', `swing ${r.on.state.uShow[0].toFixed(3)}`);
  const dIn = pc(r.corr.lo.in, r.corr.hi.in), dOut = pc(r.corr.lo.out, r.corr.hi.out);
  ok(dIn <= 5, 'show level 3, beat trough against beat peak: mean brightness inside the lane corridor differs by at most 5 %', `inside ${r.corr.lo.in.toFixed(3)} → ${r.corr.hi.in.toFixed(3)} (${dIn.toFixed(2)} %); outside ${r.corr.lo.out.toFixed(3)} → ${r.corr.hi.out.toFixed(3)} (${dOut.toFixed(2)} %); the corridor is ${(r.corr.lo.share * 100).toFixed(0)} % of the picture (${r.corr.blocks[0]} of ${r.corr.blocks[1]} blocks)`);
  ok(r.corr.hi.out > r.corr.lo.out, 'the same two pictures: the hall outside the corridor is brighter on the beat', `${dOut.toFixed(2)} %`);
  ok(pc(r.corr.rest.in, r.corr.burst.in) <= 5 && pc(r.corr.rest.in, r.corr.dim.in) <= 5, 'the chorus burst (+40 % on a level 3 peak) and the chorus dim (to 35 %): the corridor within 5 % of the hall at rest', `rest ${r.corr.rest.in.toFixed(3)}, burst ${r.corr.burst.in.toFixed(3)} (${pc(r.corr.rest.in, r.corr.burst.in).toFixed(2)} %), dim ${r.corr.dim.in.toFixed(3)} (${pc(r.corr.rest.in, r.corr.dim.in).toFixed(2)} %); outside: rest ${r.corr.rest.out.toFixed(3)}, burst ${r.corr.burst.out.toFixed(3)}, dim ${r.corr.dim.out.toFixed(3)}`);
  ok(pc(r.corr.lo.in, r.corr.chase.in) <= 5, 'level 3 with the lamp chase on: the corridor within 5 % too', `${r.corr.lo.in.toFixed(3)} → ${r.corr.chase.in.toFixed(3)} (${pc(r.corr.lo.in, r.corr.chase.in).toFixed(2)} %); outside ${r.corr.chase.out.toFixed(3)}`);
  ok(r.live.maxSwing <= 0.25 + 1e-6 && r.live.maxLight <= 0.12 * 0.65 + 1e-6, 'a whole Hard run under autoplay: swing at most 25 %, the warm lights within 8 %', JSON.stringify(r.live));
  ok(r.live.minGain >= -0.65 - 1e-6 && r.live.maxGain <= 0.40 + 1e-6 && r.live.minGain < -0.5 && r.live.maxGain > 0.2, 'the chorus dim (to 35 %) and its burst (at most +40 %) happen on the current song', `${r.live.minGain.toFixed(3)} … ${r.live.maxGain.toFixed(3)}`);
  ok(r.live.levels.join() === '0,1,2,3', 'a perfect run climbs through show levels 0 to 3', r.live.levels.join());
  ok(r.live.stats.ups === 3 && r.live.stats.reacts >= 3 && r.live.stats.taunts === 0 && r.live.stats.downs === 0, 'a perfect Hard run: three level-ups, Green Maniac reacts to runs of 8 hits (those with no throw within 0.6 s), no taunt', JSON.stringify(r.live.stats));
  ok(r.miss.seen.every((l, i) => i === 0 || l === r.miss.seen[i - 1] - 1) && r.miss.seen.length >= 2 && r.miss.dipMin <= -0.29 && r.miss.dipMin >= -0.30 - 1e-6, 'misses: the show level drops one at a time and the hall dips 30 %', `levels ${r.miss.seen.join(' → ')}, dip ${r.miss.dipMin.toFixed(3)}, ${r.miss.misses} misses`);
  ok(r.miss.stats.taunts >= 1 && r.miss.stats.taunts <= 1 && r.miss.stats.downs >= 1, 'two misses in a row: he taunts, once in those 5 s', JSON.stringify(r.miss.stats));
  ok(r.on.programs0 === r.on.programs1 && r.on.programs1 === r.live.programs2, 'no shader program is added during the song', `${r.on.programs0} → ${r.live.programs2}`);
  ok(r.on.lights === 4, 'real-time lights unchanged (4 point lights)', String(r.on.lights));
  ok(r.afterStop, 'stopping the Arcade puts the hall back at rest');
  ok(errors.length === 0, 'show: no page errors', JSON.stringify(errors));
  await p.close();
}
if (ONLY.includes('play') || ONLY.includes('off') || ONLY.includes('wave') || ONLY.includes('chart2')) {
  const { p, errors } = await openArcade(b);
  if (ONLY.includes('play')) {
    // ---- autoplay of the whole song on all three difficulties: every armored pumpkin destroyed, totals consistent
    const r = await p.evaluate(async () => {
      const X = window.__x, R = {};
      for (const d of ['easy', 'normal', 'hard']) {
        X.settings.arcadeArmored = true; X.settings.arcadeShow = true; X.begin(d);
        const total = X.ar.eventTotal, seqs = X.ar.seqs.map((q) => ({ id: q.id, beat: q.beat, hits: q.hits, gap: q.gap, practice: q.practice }));
        const real = X.ar.armored?.real; let stages = new Set(), maxVisible = 0;
        while (X.ar.state === 'playing' && X.sim < 70) { X.step(2); const A = X.ar.armored; if (A?.root.visible && X.ar._liveSeq()) { stages.add(A.stage); let v = 0; A.root.children.forEach((c) => { if (c.visible) v++; }); maxVisible = Math.max(maxVisible, v); } }
        const res = X.a.lastResult || {}, c = res.counts || {};
        R[d] = { total, seqs, real, stages: [...stages].sort(), maxVisible, counts: c, judged: (c.perfect || 0) + (c.good || 0) + (c.miss || 0), armored: res.armored, rank: res.rank, failed: res.failed, state: X.ar.state, log: X.ar.debug.log.filter((l) => l.armored).length, show: X.ar.showStats, programs: X.programs() };
      }
      return R;
    });
    const want = { easy: 54, normal: 97, hard: 126 };
    for (const d of ['easy', 'normal', 'hard']) {
      const x = r[d];
      ok(x.state === 'results' && !x.failed && x.armored?.sequences === 3 && x.armored.full === 3 && x.armored.miss === 0 && x.armored.partial === 0 && x.armored.shellHits === 9, `${d}: autoplay of the whole song, every armored pumpkin destroyed (3 of 3, all layers off)`, JSON.stringify(x.armored));
      ok(x.judged === x.total && x.counts.miss === 0 && x.log === 12, `${d}: totals consistent with the event count`, `${x.total} rhythm events (${want[d]} in v0.46), judged ${x.judged}: ${JSON.stringify(x.counts)}, rank ${x.rank}; 12 armored judgements (3 × (3 shell beats + 1 wave))`);
      ok(x.real === true && x.stages.join() === '0,1,2,3' && x.maxVisible === 1, `${d}: the real model, stages 0 to 3 shown one at a time`, `stages ${x.stages.join()}, most visible at once ${x.maxVisible}`);
    }
    ok(r.easy.programs === r.hard.programs, 'three songs in a row with armored pumpkins and the show: no shader program added', `${r.easy.programs} → ${r.hard.programs}`);
  }
  if (ONLY.includes('off')) {
    const r = await p.evaluate(async () => {
      const X = window.__x, R = { off: {}, on: {} };
      for (const d of ['easy', 'normal', 'hard']) { X.settings.arcadeArmored = false; X.begin(d); R.off[d] = { total: X.ar.eventTotal, seqs: X.ar.seqs.length, notes: X.ar.notes.length }; X.settings.arcadeArmored = true; X.begin(d); R.on[d] = { total: X.ar.eventTotal, seqs: X.ar.seqs.length }; }
      X.settings.arcadeArmored = false; X.begin('normal'); X.step(30); R.ctx = X.a.hub.ctx.energyWave;
      while (X.ar.state === 'playing' && X.sim < 70) X.step(2);
      const c = X.a.lastResult?.counts || {}; R.run = { counts: c, armored: X.a.lastResult?.armored, pumpkin: !!X.ar.armored?.root.visible };
      X.settings.arcadeArmored = true;
      return R;
    });
    ok(r.off.easy.total === 54 && r.off.normal.total === 97 && r.off.hard.total === 126 && r.off.hard.seqs === 0, 'arcadeArmored = false: 54 / 97 / 126 rhythm events, as in v0.46', `${r.off.easy.total} / ${r.off.normal.total} / ${r.off.hard.total}; on: ${r.on.easy.total} / ${r.on.normal.total} / ${r.on.hard.total}`);
    ok(r.run.counts.perfect + r.run.counts.good === 97 && r.run.counts.miss === 0 && r.run.armored.sequences === 0 && r.run.armored.waves === 0 && !r.run.pumpkin && r.ctx === false, 'arcadeArmored = false: a whole Normal run has no armored pumpkin, no wave, and the wave gesture is not even listened for', JSON.stringify(r.run));
  }
  if (ONLY.includes('wave')) {
    const r = await p.evaluate(async () => {
      const X = window.__x, a = X.a, ar = X.ar, R = {};
      const T = (q, t) => t + X.settings.offsetMs / 1000, snap = () => ({ score: ar.score.score, combo: ar.score.combo, miss: ar.score.counts.miss, good: ar.score.counts.good, perfect: ar.score.counts.perfect, shield: ar.score.shield, invalid: ar.score.invalid.length });
      const wave = (lag = 0) => ({ type: 'energyWave', t: 0, tContact: -lag, source: 'test' });
      // a wave with nothing due: a fizzle = an invalid shot; the combo and the score do not move
      X.settings.arcadeArmored = true; X.begin('normal'); ar.debug.autoplayArmored = false; X.until(8);
      { const s0 = snap(); ar._onEnergyWave(wave(), X.sim, 0); const s1 = snap(); R.fizzle = { fizzles: ar.armoredStats.fizzles, invalid: s1.invalid - s0.invalid, combo: s1.combo - s0.combo, score: s1.score - s0.score, ctx: a.hub.ctx.energyWave }; }
      // the first sequence is practice: answered by nothing → no miss counted, no shield lost, no damage flash
      const q0 = ar.seqs[0]; let flashes = 0; const rf = a.flashDamage.bind(a); a.flashDamage = () => { flashes++; rf(); };
      X.until(q0.holdTime - 0.2); R.fly = { state: q0.state, visible: ar.armored.root.visible, stage: ar.armored.stage };
      X.until(q0.holdTime + 0.1); R.hold = { state: q0.state, atRing: +ar.armored.root.position.distanceTo(ar.lanes.strike[1]).toFixed(3), pips: ar.armoredFx.pips.visible };
      { const s0 = snap(), f0 = flashes; X.until(q0.waveTime + 1.2); const s1 = snap(); R.practice = { state: q0.state, outcome: q0.seq.outcome, missDelta: s1.miss - s0.miss, shieldLoss: +(s0.shield - s1.shield).toFixed(1), flashes: flashes - f0, banner: ar._armTutShown, gone: !ar.armored.root.visible }; }
      // second sequence, by hand: web early (no crack), webs on beats 1 and 3 (beat 2 missed → that layer stays), a wave too early, then the wave on time → partial, Good
      const q1 = ar.seqs[1], cam = () => a.camera.getWorldPosition(new X.T.Vector3()), web = () => { const o = cam(); return { hand: 'right', origin: o, dir: q1.pos.clone().sub(o).normalize() }; };
      X.until(q1.shellTimes[0] - 0.45); { ar._onWeb(web(), X.sim); R.earlyWeb = { layers: q1.seq.layers, invalid: ar.score.invalid.at(-1) === X.sim ? 1 : 0 }; }
      X.until(q1.shellTimes[0] + 0.02); { const s0 = snap(); ar._onWeb(web(), X.sim); const s1 = snap(); R.crack1 = { layers: q1.seq.layers, stage: ar.armored.stage, charge: q1.seq.charge, perfect: s1.perfect - s0.perfect, combo: s1.combo - s0.combo }; ar._onWeb(web(), X.sim); R.crack1.again = q1.seq.layers; }
      X.until(q1.shellTimes[1] + 0.4); R.miss2 = { layers: q1.seq.layers, stage: ar.armored.stage, shell: [...q1.seq.shell], missDelta: snap().miss };
      X.until(q1.shellTimes[2] + 0.1); { const s0 = snap(); ar._onWeb(web(), X.sim); const s1 = snap(); R.crack3 = { layers: q1.seq.layers, stage: ar.armored.stage, charge: q1.seq.charge, good: s1.good - s0.good }; }
      // 2026-11-15: the join counts at any moment while it holds. Here 0.5 s before the wave beat with one layer left: the blast starts,
      // stays on, burns the last layer off and destroys it; Good (not on the beat, armor left); a second join adds nothing
      X.until(q1.waveTime - 0.5); { const s0 = snap(); ar._onEnergyWave(wave(), X.sim, 0); const s1 = snap();
        R.partial = { outcome: q1.seq.outcome, state: q1.state, good: s1.good - s0.good, perfect: s1.perfect - s0.perfect, miss: s1.miss - s0.miss, beam: ar.armoredFx.beam.visible, sustain: ar.armoredFx.sustain, stillThere: ar.armored.root.visible, stage0: ar.armored.stage };
        ar._onEnergyWave(wave(), X.sim, 0); R.partial.second = snap().good - s1.good;
        X.step(8); R.partial.beamHeld = ar.armoredFx.beam.visible && ar.armoredFx.beam.material.uniforms.uOpacity.value > 0.9 && ar.armoredFx.orbB.visible;
        X.step(12); R.partial.stageBurned = ar.armored.stage; X.step(30); R.partial.gone = !ar.armored.root.visible && q1.state === 'done'; X.step(50); R.partial.beamOff = !ar.armoredFx.beam.visible; R.partial.missAfter = snap().miss - s1.miss; }
      // third sequence: three webs then the wave 30 ms late, reported 2 frames after contact → full, Perfect on the CONTACT time, weight 3, and it carries on into Green Maniac
      const q2 = ar.seqs[2]; const web2 = () => { const o = cam(); return { hand: 'left', origin: o, dir: q2.pos.clone().sub(o).normalize() }; };
      for (let i = 0; i < 3; i++) { X.until(q2.shellTimes[i]); ar._onWeb(web2(), X.sim); }
      R.three = { layers: q2.seq.layers, stage: ar.armored.stage, charge: q2.seq.charge };
      // pause while it holds: nothing moves
      { ar.pause(); const pos = ar.armored.root.position.clone(), st = q2.state; ar.update(X.dt, 0); ar.update(X.dt, 0); R.pause = { moved: ar.armored.root.position.distanceTo(pos) > 1e-9, state: q2.state === st, layers: q2.seq.layers }; ar.resume(); ar._resumeAt = 0; }
      X.until(q2.waveTime + 0.03 + 2 * X.dt); { const s0 = snap(); let hit = 0; const m = ar.boss.maniac, ss = m.setState.bind(m); m.setState = (st, v) => { if (st === 'hit') hit++; return ss(st, v); };
        ar._onEnergyWave(wave(2 * X.dt), X.sim, 0); const s1 = snap(); const lg = ar.debug.log.filter((l) => l.id === 'a2.w')[0];
        const want = X.sim - 2 * X.dt - q2.waveTime, flare = ar.show._flare, during = { state: q2.state, there: ar.armored.root.visible };
        X.step(40); m.setState = ss;
        R.full = { outcome: q2.seq.outcome, perfect: s1.perfect - s0.perfect, scoreDelta: s1.score - s0.score, base: Math.round(300 * (1 + Math.min(s0.combo + 1, 60) / 30) * 3), want, logDt: lg?.dt, bossHit: hit, flare, during, gone: !ar.armored.root.visible && q2.state === 'done' }; }
      R.stats = { ...ar.armoredStats };
      // a miss that counts (not practice): restart, let the second sequence go unanswered
      X.begin('normal'); ar.debug.autoplayArmored = false; { const q = ar.seqs[1]; X.until(q.holdTime); const s0 = snap(), f0 = flashes; X.until(q.waveTime + 1.2); const s1 = snap(); R.realMiss = { outcome: q.seq.outcome, missDelta: s1.miss - s0.miss, flashes: flashes - f0, shieldLoss: +(s0.shield - s1.shield).toFixed(1) }; }
      // outside the Arcade: the flag is off, the detector idle, and an injected wave event changes nothing
      ar.stop(); a.go('modeSelect'); X.step(3);
      { const sc = ar.armoredStats.waves; X.inject(wave()); X.step(2); R.outside = { state: a.state, ctx: a.hub.ctx.energyWave, shield: a.hub.ctx.shield, detector: a.hub.wave.state, engaged: a.hub.wave.engaged, waves: ar.armoredStats.waves - sc, beam: ar.armoredFx.beam.visible, pips: ar.armoredFx.pips.visible }; }
      a.flashDamage = rf;
      return R;
    });
    ok(r.fizzle.fizzles === 1 && r.fizzle.invalid === 0 && r.fizzle.combo === 0 && r.fizzle.score === 0 && r.fizzle.ctx === true, 'a wave with no armored pumpkin out: a fizzle; combo and score untouched, and it is not an invalid shot (trying the gesture never overheats)', JSON.stringify(r.fizzle));
    ok(r.fly.state === 'flying' && r.fly.visible && r.hold.state === 'holding' && r.hold.atRing < 0.05 && r.hold.pips, 'the armored pumpkin flies in and holds at the centre judgement ring one beat before its first shell beat; the charge pips show', JSON.stringify({ ...r.fly, ...r.hold }));
    ok(r.practice.outcome === 'miss' && r.practice.missDelta === 0 && r.practice.shieldLoss === 0 && r.practice.flashes === 0 && r.practice.banner && r.practice.gone, 'the first armored pumpkin of a run is practice: a how-to banner, and letting it go costs nothing', JSON.stringify(r.practice));
    ok(r.earlyWeb.layers === 3 && r.earlyWeb.invalid === 1, 'a web 0.45 s before a shell beat cracks nothing (Early)', JSON.stringify(r.earlyWeb));
    ok(r.crack1.layers === 2 && r.crack1.stage === 1 && r.crack1.charge === 1 && r.crack1.perfect === 1 && r.crack1.combo === 1 && r.crack1.again === 2, 'a web on the first shell beat: one layer off, stage 1 swaps in, one charge pip, one Perfect; a second web on the same beat does nothing', JSON.stringify(r.crack1));
    ok(r.miss2.layers === 2 && r.miss2.stage === 1 && r.miss2.shell[1] === 'miss', 'a missed shell beat leaves that layer on (nothing grows back)', JSON.stringify(r.miss2));
    ok(r.crack3.layers === 1 && r.crack3.stage === 2 && r.crack3.charge === 2 && r.crack3.good === 1, 'the third shell beat 0.1 s late: Good, stage 2, two pips', JSON.stringify(r.crack3));
    ok(r.partial.outcome === 'partial' && r.partial.state === 'blasting' && r.partial.good === 1 && r.partial.perfect === 0 && r.partial.miss === 0 && r.partial.second === 0, 'palms joined 0.5 s before the wave beat with a layer left: it counts at once, Good, no miss; a second join adds nothing', JSON.stringify(r.partial));
    ok(r.partial.beam && r.partial.sustain && r.partial.stillThere && r.partial.beamHeld && r.partial.stage0 === 2 && r.partial.stageBurned === 3 && r.partial.gone && r.partial.beamOff && r.partial.missAfter === 0, 'the blast stays on from the join until the pumpkin is destroyed: the last layer burns off, then it explodes, then the beam fades', `stage ${r.partial.stage0} → ${r.partial.stageBurned}, gone ${r.partial.gone}, beam off after ${r.partial.beamOff}`);
    ok(r.three.layers === 0 && r.three.stage === 3 && r.three.charge === 3, 'three shell beats hit: the bare core (stage 3), three pips on each hand', JSON.stringify(r.three));
    ok(!r.pause.moved && r.pause.state && r.pause.layers === 0, 'pause while it holds: nothing moves');
    ok(r.full.outcome === 'full' && r.full.perfect === 1 && r.full.scoreDelta === r.full.base && Math.abs(r.full.logDt - r.full.want) < 0.0002 && r.full.want > 0.02 && r.full.want < 0.05 && r.full.bossHit === 1 && r.full.flare === 1 && r.full.during.state === 'blasting' && r.full.gone, 'all layers off, the wave joined about 30 ms after the beat and reported 2 frames later: Perfect, judged on the contact time, weight 3, the candles flare, and the last wave carries on into Green Maniac (Head Hit)', JSON.stringify(r.full));
    ok(r.realMiss.outcome === 'miss' && r.realMiss.missDelta === 4 && r.realMiss.flashes === 1 && r.realMiss.shieldLoss > 0, 'a later armored pumpkin left alone: three shell misses and the wave miss, and it explodes on the player once', JSON.stringify(r.realMiss));
    ok(r.outside.state === 'modeSelect' && r.outside.ctx === false && r.outside.detector === 'idle' && !r.outside.engaged && r.outside.waves === 0 && !r.outside.beam && !r.outside.pips, 'outside the Arcade an energy-wave event does nothing: the flag is off, the detector idle, no beam', JSON.stringify(r.outside));
  }
  if (ONLY.includes('chart2')) {
    // ---- S7: a second chart (96 BPM changing to 150 BPM, no sections, a click track): the same code plays it through
    const r = await p.evaluate(async () => {
      const X = window.__x, a = X.a, R = {};
      const chart = await (await fetch('/tests/fixtures/click-96-150.chart.json')).json();
      (await window.__imp('/src/core/chart.js')).validateChart(chart);
      const audio = (await window.__imp('/src/core/audio.js')).audio;
      const buffer = await audio.ctx.decodeAudioData(await (await fetch('/tests/fixtures/click-96-150.wav')).arrayBuffer());
      const real = X.song; X.song = { id: chart.song.id, title: chart.song.title, buffer, chart };
      R.chart = { sections: chart.sections ?? chart.generator?.sections ?? null, tempoMap: chart.timing.tempoMap, buffer: +buffer.duration.toFixed(2), duration: chart.song.durationSec };
      for (const d of ['normal', 'hard']) {
        X.settings.arcadeArmored = true; X.settings.arcadeShow = true; X.begin(d, { chart });
        const total = X.ar.eventTotal, seqs = X.ar.seqs.map((q) => q.beat), tChange = X.ar.clock.beatToSec(48);
        let prev = 0, peaksA = 0, peaksB = 0, gainMin = 0, gainMax = 0, maxSwing = 0; const lv = new Set(), hues = new Set(), gaps = [];
        let lastPeak = null;
        while (X.ar.state === 'playing' && X.sim < chart.song.durationSec + 3) {
          X.step(1); const o = X.ar.show.out; if (!o) continue;
          if (prev < 0.95 && o.beat >= 0.95 && X.sim > 0.5) { if (X.sim < tChange - 0.3) peaksA++; else if (X.sim > tChange + 0.3) peaksB++; if (lastPeak !== null) gaps.push(X.sim - lastPeak); lastPeak = X.sim; }
          prev = o.beat; gainMin = Math.min(gainMin, o.dip); gainMax = Math.max(gainMax, o.dip); maxSwing = Math.max(maxSwing, o.swing); lv.add(o.level); hues.add(o.hue.map((v) => v.toFixed(1)).join());
        }
        const res = a.lastResult || {}, c = res.counts || {};
        R[d] = { total, seqs, state: X.ar.state, counts: c, judged: (c.perfect || 0) + (c.good || 0) + (c.miss || 0), armored: res.armored, rank: res.rank, levels: [...lv].sort(), hues: hues.size, peaksA, peaksB, tChange: +tChange.toFixed(2), end: +X.sim.toFixed(1), minGap: +Math.min(...gaps).toFixed(3), gainMin, gainMax, maxSwing: +maxSwing.toFixed(3), programs: X.programs() };
      }
      X.song = real;
      return R;
    });
    ok(r.chart.sections === null && r.chart.tempoMap.length === 2 && Math.abs(r.chart.buffer - r.chart.duration) < 0.1, 'the second chart: no sections, a tempo change (96 → 150 BPM), its own click track decoded', JSON.stringify(r.chart));
    for (const d of ['normal', 'hard']) {
      const x = r[d];
      ok(x.state === 'results' && x.judged === x.total && x.counts.miss === 0 && x.armored.sequences === 2 && x.armored.full === 2, `second chart, ${d}: plays through under autoplay with armored pumpkins placed (2) and destroyed`, `${x.total} events judged ${x.judged} ${JSON.stringify(x.counts)}, rank ${x.rank}, sequences at beats ${x.seqs.join(', ')}, ended at ${x.end} s`);
      const hzA = x.peaksA / (x.tChange - 0.8), hzB = x.peaksB / (x.end - x.tChange - 0.3);
      ok(Math.abs(hzA - 1.6) < 0.15 && Math.abs(hzB - 2.5) < 0.2 && x.minGap >= 1 / 3 - 0.02, `second chart, ${d}: the hall pulses on every beat at both tempos and never faster than 3 Hz`, `${hzA.toFixed(2)} Hz at 96 BPM, ${hzB.toFixed(2)} Hz at 150 BPM, shortest gap between two peaks ${x.minGap} s`);
      ok(x.gainMin === 0 && x.gainMax === 0 && x.levels.join() === '0,1,2,3' && x.hues > 3 && x.maxSwing <= 0.25 + 1e-6, `second chart, ${d}: no chorus dim or burst (no sections), show levels 0 to 3, the accent colour steps`, `gain ${x.gainMin} … ${x.gainMax}, levels ${x.levels.join()}, swing up to ${x.maxSwing}`);
    }
    ok(r.normal.programs === r.hard.programs, 'second chart: no shader program added', `${r.normal.programs} → ${r.hard.programs}`);
  }
  ok(errors.length === 0, `${ONLY.filter((g) => g !== 'show').join(', ')}: no page errors`, JSON.stringify(errors));
  await p.close();
}
console.log(`\n${pass} PASS, ${fail} FAIL`);
await b.close();
process.exit(fail ? 1 : 0);
