// v0.25 stage 0 — performance probe (dev).
//
// What it measures, and what it does NOT:
//  • Per render pass (one renderer.render() call each): draw calls + triangles. A pass is labelled
//      'main'   = the frame's scene render. In WebXR WITHOUT multiview this single pass draws BOTH eyes, so its
//                 numbers are both eyes together; perEye ≈ main / 2 (three.js culls with the merged eye frustum).
//                 WITH multiview (v0.27: likely the Quest default, see src/core/xrTuning.js) each draw call renders
//                 both eyes at once → the counts already are per eye.
//      'mirror' = the room mirror render target (384×768, ≤ 30 Hz, only while the mirror can be seen)
//      'rt:*'   = any other render target.
//    (The old overlay read renderer.info after the LAST render call only = 'main'; the mirror was never in it.)
//  • Frame interval = time between two frame() calls (rAF / XR frame). Not GPU time.
//  • JS time = time spent in App.frame() (game logic, streaming, uploads queued). Not frame time.
//  • GPU time per pass only when EXT_disjoint_timer_query_webgl2 exists; otherwise reported as 'N/A'.
//    Disjoint results are thrown away. (Availability + accuracy in Quest Browser XR: to be checked on device.)
//  • Texture / render-target memory = an ESTIMATE from the sizes of textures referenced by the scene + known render
//    targets + the XR framebuffer. Shared by both eyes (never × 2). Separate from the JS heap (Chrome-only API).
//  Nothing here is a Quest measurement unless it was recorded on a Quest.

import { xrInfo, xrTargetMiB } from './xrTuning.js';

const HIST_EDGES = [11.1, 13.9, 16.7, 20.8, 27.8, 41.7]; // ms: 90 Hz, 72 Hz, 60 Hz, 1.5× 72 Hz (one missed vsync), 36 Hz, 24 Hz
const HIST_LABELS = ['<11.1', '11.1–13.9', '13.9–16.7', '16.7–20.8', '20.8–27.8', '27.8–41.7', '>41.7'];

export function createPerfProbe(renderer, { labelOf } = {}) {
  const gl = renderer.getContext();
  const timerExt = gl.getExtension?.('EXT_disjoint_timer_query_webgl2') || null;
  const st = {
    frame: 0,
    passes: new Map(), // label -> { n, calls, tris, lastCalls, lastTris, gpuMs[], frames }
    cur: new Map(), // this frame: label -> { calls, tris, n }
    last: new Map(),
    intervals: [], // ms, ring
    js: [], // ms, ring
    lastT: 0,
    queries: [], // { q, label }
    queryBusy: false,
    marks: [], // { t, kind, ms } spikes (build / recycle / create)
    recording: null,
  };
  const RING = 30000; // ≈ 7 min at 72 Hz (a whole bench 'long' run)
  const push = (arr, v) => { arr.push(v); if (arr.length > RING) arr.shift(); };
  const label = (rt) => (labelOf ? labelOf(rt) : null) || (rt ? `rt:${rt.texture?.name || rt.width + 'x' + rt.height}` : 'main');

  // ---- wrap renderer.render (non-invasive: same arguments, same order)
  const orig = renderer.render.bind(renderer);
  renderer.render = function (scene, camera) {
    const rt = renderer.getRenderTarget();
    const xrMain = renderer.xr.enabled && renderer.xr.isPresenting;
    const L = xrMain && (!rt || !labelOf?.(rt)) ? 'main' : label(rt);
    let q = null;
    if (timerExt && !st.queryBusy) { q = gl.createQuery(); gl.beginQuery(timerExt.TIME_ELAPSED_EXT, q); st.queryBusy = true; }
    orig(scene, camera);
    if (q) { gl.endQuery(timerExt.TIME_ELAPSED_EXT); st.queryBusy = false; st.queries.push({ q, label: L }); }
    const info = renderer.info.render; // autoReset → this call only
    const c = st.cur.get(L) || { calls: 0, tris: 0, n: 0 };
    c.calls += info.calls; c.tris += info.triangles; c.n++;
    st.cur.set(L, c);
  };
  const passOf = (L) => { let p = st.passes.get(L); if (!p) st.passes.set(L, (p = { frames: 0, calls: 0, tris: 0, maxCalls: 0, maxTris: 0, gpu: [] })); return p; };

  function pollQueries() {
    if (!timerExt || !st.queries.length) return;
    const disjoint = gl.getParameter(timerExt.GPU_DISJOINT_EXT);
    while (st.queries.length) {
      const { q, label: L } = st.queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      gl.deleteQuery(q); st.queries.shift();
      if (!disjoint) { const g = passOf(L).gpu; g.push(ns / 1e6); if (g.length > 600) g.shift(); }
    }
    if (st.queries.length > 64) { for (const { q } of st.queries) gl.deleteQuery(q); st.queries.length = 0; }
  }

  /** Call once at the top of every frame (before any rendering of this frame). */
  function beginFrame(now = performance.now()) {
    if (st.lastT) push(st.intervals, now - st.lastT);
    st.lastT = now;
    // close the previous frame's pass totals
    st.last = st.cur; st.cur = new Map();
    for (const [L, c] of st.last) { const p = passOf(L); p.frames++; p.calls += c.calls; p.tris += c.tris; p.maxCalls = Math.max(p.maxCalls, c.calls); p.maxTris = Math.max(p.maxTris, c.tris); }
    st.frame++;
    pollQueries();
    if (st.recording) st.recording.frames++;
  }
  const jsTime = (ms) => push(st.js, ms);
  /** Record a CPU spike (city build / recycle / create) for the report. */
  const mark = (kind, ms) => { if (ms > 0.5) { st.marks.push({ f: st.frame, kind, ms: +ms.toFixed(2) }); if (st.marks.length > 4000) st.marks.shift(); } };

  const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };
  function histogram(a) { const h = new Array(HIST_LABELS.length).fill(0); for (const v of a) { let i = HIST_EDGES.findIndex((e) => v < e); if (i < 0) i = HIST_EDGES.length; h[i]++; } return Object.fromEntries(HIST_LABELS.map((l, i) => [l, h[i]])); }

  /** Last frame, per pass. */
  function lastPasses() { return [...st.last].map(([L, c]) => ({ pass: L, calls: c.calls, tris: c.tris, renders: c.n })); }
  /** GPU ms per pass (median of the recent samples) or 'N/A'. */
  function gpuMs(L) { if (!timerExt) return 'N/A'; const g = st.passes.get(L)?.gpu; return g && g.length ? pct(g, 0.5) : 'N/A'; }

  /**
   * Estimated GPU memory of textures + render targets (bytes). Textures are counted once (shared by both eyes).
   * extraTargets: [{ name, rt }]. The XR framebuffer (colour + depth, both eyes) is added when presenting.
   */
  function memoryEstimate(scene, extraTargets = []) {
    const texs = new Set();
    scene.traverse((o) => {
      for (const m of [].concat(o.material || [])) {
        for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'lightMap', 'alphaMap', 'envMap', 'gradientMap', 'specularMap', 'bumpMap']) if (m[k]?.isTexture) texs.add(m[k]);
        if (m.uniforms) for (const u of Object.values(m.uniforms)) { const v = u?.value; if (v?.isTexture) texs.add(v); else if (Array.isArray(v)) for (const x of v) if (x?.isTexture) texs.add(x); }
      }
    });
    const rtTex = new Set(extraTargets.map((e) => e.rt?.texture));
    let tex = 0; const big = [];
    for (const t of texs) {
      if (rtTex.has(t)) continue;
      const im = t.image || {}; const w = im.width || im[0]?.width || t.source?.data?.width || 0, h = im.height || im[0]?.height || t.source?.data?.height || 0;
      const d = t.isDataArrayTexture || t.isData3DTexture ? im.depth || 1 : t.isCubeTexture ? 6 : 1;
      const bpp = t.isCompressedTexture ? 1 : t.type === 1015 /* Float */ ? 16 : t.type === 1016 /* HalfFloat */ ? 8 : t.format === 1028 /* Red */ ? 1 : 4;
      const mips = t.generateMipmaps || t.mipmaps?.length > 1 ? 4 / 3 : 1;
      const b = w * h * d * bpp * mips; tex += b;
      if (b > 512 * 1024) big.push({ name: t.name || m_name(t), w, h, d, MiB: +(b / 1048576).toFixed(2) });
    }
    let rts = 0; const rtList = [];
    for (const { name, rt } of extraTargets) { if (!rt) continue; const s = Math.max(1, rt.samples || 1); const b = rt.width * rt.height * (4 * s + (rt.depthBuffer ? 4 * s : 0)) + (s > 1 ? rt.width * rt.height * 4 : 0); rts += b; rtList.push({ name, w: rt.width, h: rt.height, MiB: +(b / 1048576).toFixed(2) }); }
    let xrFb = null;
    const XI = xrInfo(renderer);
    if (XI.width) xrFb = { w: XI.width, h: XI.height, views: XI.views, samples: XI.samples, layer: XI.layer, multiview: XI.multiview, MiB: xrTargetMiB(XI), note: 'XR target estimate: colour + depth per sample + resolve' };
    big.sort((a, b) => b.MiB - a.MiB);
    return { texturesMiB: +(tex / 1048576).toFixed(2), textureCount: texs.size, renderTargetsMiB: +(rts / 1048576).toFixed(2), renderTargets: rtList, xrFramebuffer: xrFb, largest: big.slice(0, 8), note: 'estimate from texture sizes; shared by both eyes; not the JS heap' };
  }
  const m_name = (t) => (t.isDataArrayTexture ? 'DataArrayTexture' : t.isCanvasTexture ? 'CanvasTexture' : 'Texture');

  /** Start a recording window (e.g. a bench run). */
  function startRecording(name, meta = {}) { st.recording = { name, meta, f0: st.frame, i0: st.intervals.length, j0: st.js.length, t0: performance.now(), frames: 0, passes0: snapshotPasses(), samples: [] }; }
  function snapshotPasses() { return new Map([...st.passes].map(([L, p]) => [L, { frames: p.frames, calls: p.calls, tris: p.tris }])); }
  /** Optional per-frame sample while recording (city stats etc.). */
  function sample(obj) { if (st.recording && st.recording.samples.length < 20000) st.recording.samples.push({ f: st.frame, ...obj }); }

  /** The report (JSON-able). Uses the active recording window, or the whole ring buffer. */
  function report(extra = {}) {
    const R = st.recording;
    const iv = R ? st.intervals.slice(Math.max(0, st.intervals.length - R.frames)) : st.intervals;
    const js = R ? st.js.slice(Math.max(0, st.js.length - R.frames)) : st.js;
    const passes = {};
    for (const [L, p] of st.passes) {
      const b = R?.passes0.get(L) || { frames: 0, calls: 0, tris: 0 };
      const fr = p.frames - b.frames; if (fr <= 0) continue;
      const calls = (p.calls - b.calls) / fr, tris = (p.tris - b.tris) / fr;
      passes[L] = { framesWithPass: fr, avgCalls: +calls.toFixed(1), avgTris: Math.round(tris), maxCalls: p.maxCalls, maxTris: p.maxTris, gpuMsMedian: gpuMs(L),
        ...(L === 'main' && renderer.xr.isPresenting ? (renderer.xr.isMultiview ? { perEyeCalls: +calls.toFixed(1), perEyeTris: Math.round(tris), note: 'XR multiview: each draw call renders both eyes (counts = per eye)' } : { perEyeCalls: +(calls / 2).toFixed(1), perEyeTris: Math.round(tris / 2), note: 'XR without multiview: main = both eyes' }) : {}) };
    }
    const avgIv = iv.length ? iv.reduce((s, v) => s + v, 0) / iv.length : 0;
    const marks = R ? st.marks.filter((m) => m.f >= R.f0) : st.marks;
    return {
      name: R?.name || 'rolling', meta: R?.meta || {}, at: new Date().toISOString(),
      device: { ua: navigator.userAgent, xr: renderer.xr.isPresenting, pixelRatio: renderer.getPixelRatio(), gpuTimer: timerExt ? 'EXT_disjoint_timer_query_webgl2' : 'N/A', xrSetup: xrInfo(renderer) },
      frames: iv.length,
      fps: avgIv ? +(1000 / avgIv).toFixed(1) : null,
      intervalMs: { p50: pct(iv, 0.5), p95: pct(iv, 0.95), p99: pct(iv, 0.99), max: iv.length ? +Math.max(...iv).toFixed(1) : null, histogram: histogram(iv), over20_8: iv.filter((v) => v > 20.8).length },
      jsMs: { p50: pct(js, 0.5), p95: pct(js, 0.95), max: js.length ? +Math.max(...js).toFixed(2) : null, note: 'App.frame() CPU time, not frame time' },
      passes,
      spikes: { count: marks.length, over3ms: marks.filter((m) => m.ms > 3).length, over3ByKind: marks.filter((m) => m.ms > 3).reduce((o, m) => ((o[m.kind] = (o[m.kind] || 0) + 1), o), {}), /* v0.30: which phase */ worst: [...marks].sort((a, b) => b.ms - a.ms).slice(0, 10) },
      heapMiB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(0) : 'N/A',
      ...extra,
    };
  }
  function stopRecording(extra) { const r = report(extra); if (st.recording) r.samples = summarizeSamples(st.recording.samples); st.recording = null; return r; }
  function summarizeSamples(s) {
    if (!s.length) return null;
    const keys = Object.keys(s[0]).filter((k) => k !== 'f' && typeof s[0][k] === 'number');
    return Object.fromEntries(keys.map((k) => { const a = s.map((x) => x[k]); return [k, { min: Math.min(...a), max: Math.max(...a), avg: +(a.reduce((p, v) => p + v, 0) / a.length).toFixed(2) }]; }));
  }

  return { beginFrame, jsTime, mark, lastPasses, gpuMs, memoryEstimate, report, startRecording, stopRecording, sample, get recording() { return st.recording; }, get gpuTimer() { return !!timerExt; }, HIST_LABELS };
}

/** Save a report: download as JSON (desktop / Quest Browser downloads) + keep the last one in localStorage. */
export function saveReport(rep) {
  const txt = JSON.stringify(rep, null, 1);
  try { localStorage.setItem('mobius.perf.last', txt); } catch { /* ignore */ }
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' }));
    a.download = `mobius-perf-${rep.name}-${rep.at.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  } catch (e) { console.warn('perf report download', e); }
  console.log('[perf-report]', txt);
  return txt;
}
