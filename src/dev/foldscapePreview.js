// Foldscape City art preview (dev only — not part of the game build). Uses the SAME ChaseWorld + WorldRenderer + kit
// + shaders + CC0 texture arrays as the game; only the camera is free. Open /foldscape-preview.html.
//   #view=front|rear|left|right|up|sky|start|street|turn|landmark|vista|near|roof|ground|look   fixed, reproducible viewpoints (seed = the game's 1st run)
//   &s=<m> route position (overrides the view's), &q=high|low|off (foldscape detail quality), &dbg=anchors,cols
//   ?clean hides the overlay (screenshots). window.__fp exposes setView / info / stepRoute for tests/e2e/foldscape-art.e2e.mjs.
import * as THREE from 'three';
import { MAPS } from '../worlds/maps.js';
import { ChaseWorld } from '../worlds/chaseWorld.js';
import { WorldRenderer } from '../worlds/worldRenderer.js';
import { toWorld, pathY } from '../worlds/route.js';
import { WORLD_CHASE } from '../worlds/worldChase.js';
import { loadCityPBR, CITY_SHARED } from '../art/cityMaterials.js';

// the foldscape art module (absent in the pre-upgrade source: the preview then shows the legacy renderer)
const ART = Object.values(import.meta.glob('../worlds/art/foldscapeArt.js', { eager: true }))[0] || null;

if (location.search.includes('clean')) document.body.classList.add('clean');
const map = MAPS.find((m) => m.id === 'foldscape');
const hp = () => Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
const P0 = hp();
if (ART && P0.q) ART.FOLDSCAPE_ART.quality = P0.q;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; // (game: IWSDK default, no tone mapping)
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1300); // = the game's render config
scene.add(camera);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

const seed = WORLD_CHASE.seedBase + 7919; // the game's first run of a session
const world = new ChaseWorld(map, { seed });
let wr = null;
const pbr = loadCityPBR().then((ok) => ok || loadCityPBR()).then((ok) => { if (ok) CITY_SHARED.uPbrOn.value = 1; return !!ok; });
function createRenderer() { wr = new WorldRenderer(null, map, world); scene.add(wr.root); }
createRenderer();

// ------------------------------------------------------------------ viewpoints (route-relative → reproducible)
const R = world.route;
R.ensure(30);
const modOf = (type, from = 1) => R.modules.find((m) => m.idx >= from && m.type === type);
const W = (m, u, v, y) => { const [x, z] = toWorld(m, u, v); return new THREE.Vector3(x + world.off[0], y, z + world.off[1]); };
function routeCam(s, { dy = 0, pitch = 0.02, ahead = 30, yawOff = 0 } = {}) {
  const p = world.pointAt(s), a = world.pointAt(s + ahead);
  const d = new THREE.Vector3(a.x - p.x, 0, a.z - p.z).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), yawOff);
  const pos = p.clone(); pos.y += dy;
  return { s, pos, look: pos.clone().add(d.multiplyScalar(30)).add(new THREE.Vector3(0, Math.tan(pitch) * 30, 0)) };
}
/** An inner structure of a given kind on the given side near arc length s (for close-up views). */
function structNear(s, kinds, side = 1, pred = () => true) {
  let best = null;
  for (const m of R.modules) for (const st of m.structures) {
    if (st.role !== 'inner' || st.side !== side || !kinds.includes(st.kind) || !pred(st, m)) continue;
    const d = Math.abs(m.s0 + st.u - s); if (!best || d < best.d) best = { d, st, m };
  }
  return best;
}
// surround (v0.42): the player's eye on the route centre line (flight height), one heading each — the remote sky
// districts must read from here, not only from elevated shots. SURROUND_S: an open straight run (the game seed: modules
// 9–14 are straights / recovery, no landmark overhead, the rear corridor stays open for ~300 m).
const SURROUND_S = +(P0.ss || 1000);
const VIEWS = {
  overhead: () => { const m = modOf('landmark') || R.modules[4]; return routeCam(m.s0 + m.L * .32, { pitch: .68 }); },
  overheadLate: () => { const m = R.modules.find(m => m.type === 'landmark' && m.s0 > 1800) || modOf('landmark'); return routeCam(m.s0 + m.L * .32, { pitch: .68 }); },
  front: () => routeCam(SURROUND_S, { pitch: 0.08 }),
  rear: () => routeCam(SURROUND_S, { pitch: 0.08, yawOff: Math.PI }),
  left: () => routeCam(SURROUND_S, { pitch: 0.42, yawOff: Math.PI / 2 }),
  right: () => routeCam(SURROUND_S, { pitch: 0.42, yawOff: -Math.PI / 2 }),
  up: () => routeCam(SURROUND_S, { pitch: 1.05, yawOff: 0.6 }),
  // any heading: #view=look&ls=<s>&hd=<deg, + = right>&pt=<pitch rad>&dy=<m above the route>
  look: () => { const p = hp(); return routeCam(+(p.ls || SURROUND_S), { pitch: +(p.pt || 0.1), yawOff: THREE.MathUtils.degToRad(-(+(p.hd || 0))), dy: +(p.dy || 0) }); },
  sky: () => routeCam(120, { pitch: 0.58, ahead: 45 }),
  start: () => routeCam(14),
  street: () => routeCam(120),
  turn: () => { const m = R.modules.find((x) => x.idx > 0 && (x.type === 'turnL' || x.type === 'turnR' || x.type === 'rise')) || R.modules[3]; return routeCam(m.s0 + m.L * 0.45, { ahead: 40 }); },
  landmark: () => { const m = modOf('landmark') || R.modules[5]; return routeCam(m.s0 + m.L * 0.2, { pitch: 0.22 }); },
  vista: () => routeCam(300, { dy: 9, pitch: 0.1, ahead: 60 }),
  ground: () => { const c = routeCam(60, { pitch: 0.12 }); c.pos.y = 1.7; c.look.y = 1.7 + 30 * Math.tan(0.12); return c; },
  near: () => { // 7 m off a wide brick facade at flight height, looking along it (window bays, fire escape)
    const b = structNear(130, ['brick'], 1, (st, m) => st.h > pathY(m, st.u) + 6 && (st.uw ?? st.w) > 16 && !st.isPlatform) || structNear(130, ['brick', 'limestone'], -1);
    const { st, m } = b, f = Math.abs(st.v) - st.d / 2, y = pathY(m, st.u) - 1;
    const pos = W(m, st.u - 9, st.side * (f - 7), y), look = W(m, st.u + 3, st.side * (f + 0.2), y + 2.5);
    return { s: m.s0 + st.u, pos, look };
  },
  roof: () => { // above a brick roof (water tank, cornice) looking down the corridor face (fire escape)
    const b = structNear(170, ['brick'], -1) || structNear(170, ['brick'], 1);
    const { st, m } = b, f = Math.abs(st.v) - st.d / 2;
    const pos = W(m, st.u - (st.uw ?? st.w) * 0.9 - 4, st.side * (f - 4), st.h + 7), look = W(m, st.u + 2, st.side * (f + 2), st.h - 6);
    return { s: m.s0 + st.u, pos, look };
  },
};

// ------------------------------------------------------------------ debug overlays
const dbg = new THREE.Group(); dbg.name = 'PreviewDebug'; scene.add(dbg);
function buildDebug(flags) {
  for (const o of [...dbg.children]) { dbg.remove(o); o.geometry?.dispose(); o.material?.dispose(); }
  if (flags.includes('cols')) {
    const P = [];
    for (const c of world.live.values()) for (const k of c.colliders) {
      const cs = k.cos, sn = k.sin, pts = [];
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const lx = sx * k.hw, lz = sz * k.hd; pts.push([k.x + lx * cs + lz * sn, k.z - lx * sn + lz * cs]); }
      for (let i = 0; i < 4; i++) { const a = pts[i], b = pts[(i + 1) % 4]; for (const y of [k.y0, k.y1]) P.push(a[0], y, a[1], b[0], y, b[1]); P.push(a[0], k.y0, a[1], a[0], k.y1, a[1]); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    dbg.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x00ff88, depthTest: false, transparent: true, opacity: 0.6 })));
  }
  if (flags.includes('anchors')) {
    const P = [];
    for (const c of world.live.values()) for (const a of c.anchors) if (a.valid) { const n = a.normal; P.push(a.p.x, a.p.y, a.p.z, a.p.x + n[0] * 3, a.p.y + n[1] * 3 + (n[1] ? 0 : 0), a.p.z + n[2] * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    dbg.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xff2a6a, depthTest: false, transparent: true })));
  }
}

// ------------------------------------------------------------------ state / controls
const st = { view: P0.view || 'street', paused: true, yaw: 0, pitch: 0, keys: new Set(), s: 0, buildMs: 0 };
function syncLook() { const d = new THREE.Vector3(); camera.getWorldDirection(d); st.yaw = Math.atan2(-d.x, -d.z); st.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)); }
let streamS = 0;
/** Stream the route to arc length s like a player travelling there (ChaseWorld keeps progress continuity: walk in steps). */
function stream(sTarget) {
  const t0 = performance.now();
  const dir = Math.sign(sTarget - streamS) || 1;
  for (let s = streamS; dir * (sTarget - s) > 50; s += dir * 50) { world.update(world.pointAt(s), { x: 0, y: 0, z: 0 }, 1 / 60, { force: true }); wr.pump(1e9); }
  world.update(world.pointAt(sTarget), { x: 0, y: 0, z: 0 }, 1 / 60, { force: true }); streamS = sTarget;
  wr.pump(1e9);
  st.buildMs = performance.now() - t0;
}
function setView(name, sOverride) {
  const v = (VIEWS[name] || VIEWS.street)(); st.view = name;
  if (sOverride != null && !Number.isNaN(+sOverride)) Object.assign(v, routeCam(+sOverride));
  stream(v.s ?? 0);
  // streaming may have rebased the floating origin: recompute the camera in the new frame
  const v2 = sOverride != null && !Number.isNaN(+sOverride) ? routeCam(+sOverride) : (VIEWS[name] || VIEWS.street)();
  camera.position.copy(v2.pos); camera.lookAt(v2.look); syncLook(); st.s = v2.s;
  buildDebug((hp().dbg || '').split(','));
  for (const a of document.querySelectorAll('#ui a')) a.classList.toggle('on', a.dataset.v === name);
  wr.update(0, camera.position);
}
const ui = document.getElementById('ui');
for (const k of Object.keys(VIEWS)) { const a = document.createElement('a'); a.textContent = k; a.dataset.v = k; a.href = `#view=${k}`; ui.appendChild(a); }
addEventListener('hashchange', () => { const p = hp(); if (ART && p.q && p.q !== ART.FOLDSCAPE_ART.quality) { ART.FOLDSCAPE_ART.quality = p.q; rebuildRenderer(); } setView(p.view || st.view, p.s); });
function rebuildRenderer() { wr.dispose(); world.reset(); streamS = 0; createRenderer(); }
let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; });
addEventListener('pointerup', () => { drag = null; });
addEventListener('pointermove', (e) => { if (!drag) return; st.yaw -= (e.clientX - drag[0]) * 0.004; st.pitch = THREE.MathUtils.clamp(st.pitch - (e.clientY - drag[1]) * 0.004, -1.5, 1.5); drag = [e.clientX, e.clientY]; });
addEventListener('keydown', (e) => {
  st.keys.add(e.code);
  if (e.code === 'KeyP') st.paused = !st.paused;
  if (e.code === 'BracketRight' || e.code === 'BracketLeft') { const s = st.s + (e.code === 'BracketRight' ? 20 : -20); const p = hp(); p.s = String(Math.max(0, s)); location.hash = new URLSearchParams(p).toString(); }
});
addEventListener('keyup', (e) => st.keys.delete(e.code));

// ------------------------------------------------------------------ stats
const statsEl = document.getElementById('stats');
function info() {
  const r = renderer.info, det = wr.extras?.stats || null;
  return { view: st.view, s: +st.s.toFixed(1), calls: r.render.calls, tris: r.render.triangles, geo: r.memory.geometries, tex: r.memory.textures, progs: r.programs?.length, mods: world.live.size, ready: [...world.live.values()].filter((c) => c.ready).length, anchors: wr.anchorMesh.count, rendererStats: { ...wr.stats }, buildMs: +st.buildMs.toFixed(1), detail: det, quality: ART?.FOLDSCAPE_ART.quality ?? 'legacy', pbr: CITY_SHARED.uPbrOn.value, rebases: world.stats.rebases, sky: wr.backdropArt ? { ...wr.backdropArt.stats, loaded: wr.backdropArt.loaded } : null };
}
let last = performance.now(), frames = 0, fpsT = 0, fps = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const e = new THREE.Euler(st.pitch, st.yaw, 0, 'YXZ'); camera.quaternion.setFromEuler(e);
  const mv = new THREE.Vector3((st.keys.has('KeyD') ? 1 : 0) - (st.keys.has('KeyA') ? 1 : 0), (st.keys.has('KeyE') ? 1 : 0) - (st.keys.has('KeyQ') ? 1 : 0), (st.keys.has('KeyS') ? 1 : 0) - (st.keys.has('KeyW') ? 1 : 0));
  if (mv.lengthSq()) { camera.position.add(mv.applyQuaternion(camera.quaternion).multiplyScalar(dt * (st.keys.has('ShiftLeft') ? 60 : 15))); world.update(camera.position, { x: 0, y: 0, z: 0 }, dt); }
  wr.pump(2.5);
  wr.update(st.paused ? 0 : dt, camera.position);
  renderer.render(scene, camera);
  frames++; fpsT += dt; if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }
  const i = info();
  statsEl.textContent = `view ${i.view}  s ${i.s} m  q ${i.quality}  fps ${fps.toFixed(0)}${st.paused ? ' (paused)' : ''}\ncalls ${i.calls}  tris ${(i.tris / 1000).toFixed(1)}k  geo ${i.geo}  tex ${i.tex}  progs ${i.progs}\nmodules ${i.mods} (ready ${i.ready})  anchors ${i.anchors}  build ${i.buildMs} ms${i.detail ? `\ndetail ${JSON.stringify(i.detail)}` : ''}`;
  requestAnimationFrame(frame);
}
window.__fp = {
  ready: false, setView: (n, s) => setView(n, s), info, world: () => world, wr: () => wr, renderer, THREE,
  setQuality: (q) => { if (!ART) return false; ART.FOLDSCAPE_ART.quality = q; rebuildRenderer(); return true; },
  views: Object.keys(VIEWS),
  /** Put the camera on the route at s (like the player), stream without forcing the builds, render once. */
  placeAt: (s) => { world.update(world.pointAt(s), { x: 0, y: 0, z: 0 }, 1 / 60, { force: true }); streamS = s; const c2 = routeCam(s); camera.position.copy(c2.pos); camera.lookAt(c2.look); syncLook(); st.s = s; },
  render: () => { wr.update(0, camera.position); renderer.render(scene, camera); },
};
const extrasReady = () => Promise.resolve(wr.extras?.whenReady?.()).catch(() => null);
window.__fp.whenReady = async () => { await extrasReady(); wr.pump(1e9); wr.update(0, camera.position); };
pbr.then(async () => {
  setView(st.view, P0.s);
  await extrasReady(); wr.pump(1e9);
  try { renderer.compile(scene, camera); } catch (e) { console.warn(e); }
  window.__fp.ready = true;
  requestAnimationFrame(frame);
});
