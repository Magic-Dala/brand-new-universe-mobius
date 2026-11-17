// v0.25 stage 0 — fixed city test route (dev): same seed, same camera, before / after comparisons.
//
//  views (static, fixed camera): every view is measured with the ORIGINAL look (v0) and the NEW look (v1) at the
//         same pose, back to back, so the report holds the real increment per view.
//  route  (moving): the story route at 18 m/s (the swing speed cap) from the home block to the factory roof,
//         at flight height, looking along the route — streaming / build spikes / pools while moving.
//  long   (moving): the endless city for 6 km at 18 m/s (≈ 5.5 min) → usually 2–3 origin rebases (the endless route
//         turns, so the straight-line distance grows slower than the path; 3.6 km gave only one).
// The camera path is scripted (not physics): swing input cannot be reproduced, a scripted path can.
// The city seed is CITY_CFG.seed / storySeed (fixed). Nothing here touches gameplay data; the endless run resets the
// city back to the story route when it ends.
import * as THREE from 'three';
import { CITY_CFG } from '../data/cityConfig.js';
import { settings } from '../core/settings.js';
import { cityQualityFlags } from '../art/cityQuality.js';
import { saveReport } from '../core/perfProbe.js';

const SPEED = 18; // m/s (settings.swingSpeedLimit default)
const SETTLE = 75, MEASURE = 150; // frames per static measurement
/** Static views: [name, s along the route, height (null = flight height), yaw offset from the route heading, pitch, lateral offset]. */
export const BENCH_VIEWS = [
  ['room-window', 'room', 0, -0.05],
  ['room-mirror', 'room', -1.57, 0],
  ['avenue', 200, null, 0, -0.08, 0],
  ['street-level', 200, 1.7, 0, 0.06, 4],
  ['turn', 430, null, -1.2, -0.1, 0],
  ['factory-roof', 520, null, -1.57, -0.2, 0],
  ['facade-close', 250, 22, -1.57, 0.0, 6], // a near facade (0–35 m band): wall-run / coin height
  ['high-lookback', 300, 150, Math.PI, -0.35, 0],
  ['lod-edge', 150, 60, 0, -0.04, 0], // looks down the avenue into the 430 m backdrop boundary
];

export function createCityBench(app) {
  const yawOf = (d) => Math.atan2(-d.x, -d.z);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  const B = { active: false, vel: new THREE.Vector3(), job: null, lines: null };

  function headingAt(s) { const w = app.cityWorld; w.pointAt(s, _a); w.pointAt(s + 4, _b); return yawOf(_b.sub(_a)); }
  function pose(pos, yaw, pitch) {
    const rig = app.world.player;
    app.locomotion.off();
    if (app.xrActive) { rig.position.set(pos.x, pos.y - 1.6, pos.z); rig.rotation.set(0, yaw, 0); } // head height ≈ 1.6 m above the rig
    else { rig.position.set(pos.x, pos.y - 1.6, pos.z); rig.rotation.set(0, 0, 0); app.hub.desk.yaw = yaw; app.hub.desk.pitch = pitch; }
    rig.updateMatrixWorld(true);
  }
  function viewPose(v) {
    const [, s, h, yawOff, pitch, lat] = v;
    if (s === 'room') { const r = app.benchRoomPose(); return { pos: r.pos, yaw: r.yaw + h, pitch: yawOff }; }
    const w = app.cityWorld, p = w.pointAt(s, new THREE.Vector3()), hd = headingAt(s);
    if (lat) p.add(new THREE.Vector3(Math.cos(hd), 0, -Math.sin(hd)).multiplyScalar(lat)); // + = right of the heading
    p.y = h ?? Math.max(28, p.y);
    return { pos: p, yaw: hd + yawOff, pitch };
  }
  const flagsFor = (level) => cityQualityFlags({ level });

  /** Coroutine-style runner, stepped once per frame from App.frame(). */
  function* views(names, settle = SETTLE, measure = MEASURE) {
    const out = [];
    const list = BENCH_VIEWS.filter((v) => !names || names.includes(v[0]));
    for (const v of list) {
      const P = viewPose(v);
      const res = { view: v[0], pos: [+P.pos.x.toFixed(1), +P.pos.y.toFixed(1), +P.pos.z.toFixed(1)], yaw: +P.yaw.toFixed(3) };
      for (const level of ['v0', 'v1']) {
        app.city.setQuality(flagsFor(level));
        pose(P.pos, P.yaw, P.pitch); app.city.setFocus(P.pos);
        for (let f = 0; f < settle; f++) { B.lines = [`BENCH ${v[0]} ${level} settle ${f}/${settle}`]; pose(P.pos, P.yaw, P.pitch); yield; }
        app.probe.startRecording(`${v[0]}-${level}`, { level });
        for (let f = 0; f < measure; f++) { B.lines = [`BENCH ${v[0]} ${level} measure ${f}/${measure}`]; pose(P.pos, P.yaw, P.pitch); yield; }
        res[level] = app.probe.stopRecording();
        delete res[level].device;
      }
      res.delta = deltaOf(res.v0, res.v1);
      out.push(res);
    }
    app.city.setQuality();
    return { kind: 'views', views: out };
  }
  function deltaOf(a, b) {
    const m0 = a.passes.main || {}, m1 = b.passes.main || {};
    return { mainCalls: +((m1.avgCalls ?? 0) - (m0.avgCalls ?? 0)).toFixed(1), mainTris: (m1.avgTris ?? 0) - (m0.avgTris ?? 0), fps: a.fps && b.fps ? +(b.fps - a.fps).toFixed(1) : null, p95: a.intervalMs.p95 != null ? +(b.intervalMs.p95 - a.intervalMs.p95).toFixed(2) : null, gpuMain: typeof m0.gpuMsMedian === 'number' && typeof m1.gpuMsMedian === 'number' ? +(m1.gpuMsMedian - m0.gpuMsMedian).toFixed(2) : 'N/A' };
  }
  function* moving(kind) {
    const w = app.cityWorld, endless = kind === 'long';
    if (endless) { w.mode = 'endless'; w.route.ensure(30); w._ensurePaths(); }
    let s = endless ? 40 : 30; const end = endless ? 6040 : 600;
    const p = w.pointAt(s, new THREE.Vector3()); p.y = Math.max(28, p.y); pose(p, headingAt(s), -0.05); app.city.setFocus(p);
    for (let f = 0; f < 30; f++) yield;
    app.probe.startRecording(`${kind}-${cityQualityFlags().level}`, { speed: SPEED, from: s, to: end, quality: cityQualityFlags() });
    const reb0 = w.stats.rebases; let f = 0, rebFrames = [];
    w.on({ rebased: () => rebFrames.push(f) });
    let last = performance.now();
    while (s < end) {
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now; f++;
      s += SPEED * dt;
      if (endless) { const pd = w.route.pending; if (pd && w.curTile >= pd.idx - 1) { const ex = pd.allowed || pd.exits; w.choose(ex[0]); } }
      const q = w.pointAt(s, new THREE.Vector3()); q.y = Math.max(28, q.y);
      const hd = headingAt(s);
      B.vel.set(-Math.sin(hd), 0, -Math.cos(hd)).multiplyScalar(SPEED);
      pose(q, hd, -0.05);
      const c = app.city.stats;
      app.probe.sample({ cells: w.stats.cells, queue: c.queue, cellsUsed: c.cellsUsed, detailCells: c.detailCells, backdrop: c.backdrop, instances: c.instances, anchors: w.stats.anchors, pumpMs: c.pumpMs || 0 });
      B.lines = [`BENCH ${kind} s=${s.toFixed(0)}/${end} m  rebases ${w.stats.rebases - reb0}`];
      yield;
    }
    const pools = Object.fromEntries(Object.entries(app.city.details).map(([k, v]) => [k, `${v.used}/${v.cap}`]));
    const rep = app.probe.stopRecording({ rebases: w.stats.rebases - reb0, rebaseFrames: rebFrames, poolMiss: app.city.stats.poolMiss, pools, cellPool: `${app.city.stats.cellsUsed}/${app.city.stats.cellsCap}` });
    B.vel.set(0, 0, 0);
    if (endless) app.resetCityForStory();
    return { kind, run: rep };
  }

  /** Start a bench run: 'views' | 'route' | 'long'. Ends by saving the JSON report. */
  B.start = (kind = 'views', opts = {}) => {
    if (B.active) return false;
    if (app.worldName !== 'city') return false;
    B.active = true; B.kind = kind;
    B.restore = { state: app.state };
    app.menus.hide();
    B.job = kind === 'views' ? views(opts.views, opts.settle, opts.measure) : moving(kind); // v0.30: settle / measure frames (headless bench)
    return true;
  };
  B.update = () => {
    if (!B.active) return;
    const r = B.job.next();
    if (!r.done) return;
    B.active = false; B.lines = null;
    const memory = app.probe.memoryEstimate(app.scene, [{ name: 'mirror', rt: app.mirror?.rt }]);
    const rep = { name: `city-bench-${B.kind}`, at: new Date().toISOString(), seed: CITY_CFG.seed, storySeed: CITY_CFG.storySeed, quality: cityQualityFlags(), renderScale: settings.renderScale, xr: app.xrActive, ...r.value, memory, device: app.probe.report().device, note: 'desktop numbers are not Quest numbers; perEye only in XR' };
    B.last = rep;
    app.savePerfReport(rep);
    app.afterBench?.(B.restore);
  };
  B.cancel = () => { if (!B.active) return; B.active = false; B.lines = null; B.vel.set(0, 0, 0); app.city.setQuality(); app.afterBench?.(B.restore); };
  B.viewPose = viewPose; B.pose = pose;
  return B;
}
