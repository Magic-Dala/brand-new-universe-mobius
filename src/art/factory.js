// Abandoned Halloween factory — the separate INTERIOR scene (loaded during the black Loading
// screen; the city is unloaded first, so they never render together).
// v0.15: the hall itself is the Blender rebuild of the reference sheet
// (tools/blender/build_factory.py → art/factory/factory_interior.blend → public/models/factory_interior.glb,
// ~40k triangles, one mesh, one primitive per material). This module loads it, converts the
// materials to cheap Quest-friendly ones, and adds the live parts: low fog, smoke through the
// breach, embers on the crash debris, landing dust, a few real lights.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { INTERIOR } from '../data/factory.js';
import { canvasTexture, rng } from './toon.js';
import { Billboards, StaticGlows, softTexture } from './particles.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { factoryFlags } from './factoryQuality.js';
import { createFactoryInteriorV2 } from './factoryV2.js';

const MODEL = 'models/factory_interior.glb';
const LIGHTMAP = 'models/factory_lightmap.webp'; // Cycles bake (tools/blender/bake_lightmap.py), stored as irradiance × LM_STORE
const LM_STORE = 0.35, LM_GAIN = 1.35; // decode scale + exposure (≈ the Blender render's exposure)
const LM_INTENSITY = Math.PI * LM_GAIN / LM_STORE; // three's Basic/Standard lightmap term divides by π

function mistTexture() {
  return canvasTexture(256, 256, (ctx, S) => {
    const r = rng(73); ctx.clearRect(0, 0, S, S);
    for (let k = 0; k < 40; k++) { const x = r() * S, y = r() * S, rad = 30 + r() * 70; const g = ctx.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { ctx.save(); ctx.translate(dx, dy); ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2); ctx.restore(); } }
  }, { repeat: true });
}

const GLOW = /led_|lamp_|pumpkin_glow|ember|window/;
/** Blender PBR (MeshStandardMaterial) → Quest-friendly: Lambert for most, Basic for glowing parts,
 *  Standard (no metal) only for the wet floor (specular sheen from the lamps). */
function convertMaterial(m, own, lm) {
  const name = (m.name || '').replace(/^M_/, '');
  const map = m.map || null;
  if (map) { map.anisotropy = 4; own(map); }
  let out;
  if (name === 'plenum') out = new THREE.MeshBasicMaterial({ color: 0x050308 });
  else if (lm && !GLOW.test(name)) {
    // baked: albedo × baked light (all lamps, bounces, soft shadows) — no real-time lighting cost
    const color = m.color.clone().multiplyScalar(m.metalness > 0.5 ? 1.25 : 1);
    if (name === 'concrete') { // wet floor: keeps a real-time specular sheen from the hall lights
      out = new THREE.MeshStandardMaterial({ map, roughnessMap: m.roughnessMap || null, roughness: 1, metalness: 0, lightMap: lm, lightMapIntensity: LM_INTENSITY / Math.PI * 1.0 });
      if (m.roughnessMap) own(m.roughnessMap);
    } else out = new THREE.MeshBasicMaterial({ map, color, lightMap: lm, lightMapIntensity: LM_INTENSITY });
    if (/pumpkin/.test(name)) out.color.multiplyScalar(1.6);
    if (m.transparent || m.alphaTest > 0 || /banner|web/.test(name)) { out.alphaTest = name === 'web' ? 0.25 : 0.45; out.side = THREE.DoubleSide; out.transparent = false; }
  }
  else if (GLOW.test(name)) {
    const c = m.emissive.clone().multiplyScalar(Math.min(1.1, (m.emissiveIntensity || 1) * 0.22)); // warm, not blown out white
    out = new THREE.MeshBasicMaterial({ color: map ? new THREE.Color(1.15, 1.0, 0.95) : c, map, toneMapped: false });
    if (name === 'window') { out.color.setRGB(1, 1, 1); if (m.emissiveMap) { out.map = m.emissiveMap; own(m.emissiveMap); } }
  } else if (name === 'concrete') {
    out = new THREE.MeshStandardMaterial({ map, roughnessMap: m.roughnessMap || null, roughness: 1, metalness: 0 });
    if (m.roughnessMap) own(m.roughnessMap);
  } else {
    out = new THREE.MeshLambertMaterial({ color: m.color.clone().multiplyScalar(m.metalness > 0.5 ? 1.35 : 1), map });
    if (name === 'pumpkin') { out.emissive = new THREE.Color(0.35, 0.1, 0.01); }
    if (m.transparent || m.alphaTest > 0 || /banner|web/.test(name)) { out.alphaTest = name === 'web' ? 0.25 : 0.45; out.side = THREE.DoubleSide; out.transparent = false; }
  }
  out.name = `factory-${name}`;
  return own(out);
}

export function createFactoryInterior() {
  if (factoryFlags().level === 'v1') return createFactoryInteriorV2(); // v0.31 rebuild (the v0.30 hall below stays selectable: ?fq=0)
  const F = INTERIOR, { h } = F.size;
  const root = new THREE.Group(); root.name = 'FactoryInterior'; root.visible = false;
  root.position.set(...F.origin);
  const disposables = [];
  const own = (x) => { if (x && !disposables.includes(x)) disposables.push(x); return x; };
  const lights = [];
  let fx = null, ready = false, mist = null, atmo = null, stats = { tris: 0, materials: 0 };
  const B = F.breach;

  function* build() {
    // ------------------------------------------------ the Blender hall (async load, the loader waits)
    const base = (import.meta.env && import.meta.env.BASE_URL) || './';
    const href = new URL(base + MODEL, document.baseURI).href;
    let gltf = null, err = null, lm = null, lmDone = false;
    new GLTFLoader().loadAsync(href).then((g) => { gltf = g; }, (e) => { err = e; });
    new THREE.TextureLoader().loadAsync(new URL(base + LIGHTMAP, document.baseURI).href).then((t) => { lm = t; lmDone = true; }, (e) => { console.warn('lightmap missing → real-time lighting only', e); lmDone = true; });
    while ((!gltf && !err) || !lmDone) yield 'wait';
    if (err) throw err;
    if (lm) { lm.flipY = false; lm.channel = 1; lm.colorSpace = THREE.SRGBColorSpace; lm.anisotropy = 4; own(lm); }
    stats.lightmap = !!lm;
    yield 'loaded';
    const cache = new Map();
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      own(o.geometry);
      const conv = (m) => { if (!cache.has(m)) cache.set(m, convertMaterial(m, own, lm)); return cache.get(m); };
      o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
      o.matrixAutoUpdate = false; o.updateMatrix();
      stats.tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    });
    for (const m of cache.keys()) m.dispose?.();
    stats.materials = cache.size;
    root.add(gltf.scene);
    yield 'materials';

    // ------------------------------------------------ low fog (3 drifting layers)
    mist = new THREE.Group(); mist.name = 'LowFog';
    const mt = own(mistTexture());
    for (const [y, sc] of [[0.25, 1], [0.6, 1.3], [1.0, 1.7]]) {
      const tex = own(mt.clone()); tex.repeat.set(1.2 * sc, 2 * sc);
      const m = new THREE.Mesh(own(new THREE.PlaneGeometry(F.size.w, F.size.d).rotateX(-Math.PI / 2)), own(new THREE.MeshBasicMaterial({ map: tex, color: 0xb89ad0, transparent: true, depthWrite: false, opacity: 0.22 - y * 0.12 })));
      m.position.y = y; m.renderOrder = 7; mist.add(m);
    }
    root.add(mist);
    yield 'fog';

    // ------------------------------------------------ atmosphere: lamp halos, light cones, window shafts, dust
    const halo = [];
    for (const [x, y, z, purple] of F.lamps || []) halo.push({ pos: [x, y, z], size: y > 7 ? 1.5 : 0.9, color: purple ? 0x9a6cff : 0xffa050, alpha: purple ? 0.5 : 0.55 });
    for (const [x, y, z, sc] of F.pumpkins || []) halo.push({ pos: [x, y + 0.42 * sc, z], size: 1.1 * sc, color: 0xff7a20, alpha: 0.42 });
    halo.push({ pos: [-8.2, 0.9, 14.6], size: 3.2, color: 0xff6a20, alpha: 0.45 }); // debris fire
    const glows = own(new StaticGlows(halo, { name: 'LampHalos' })); root.add(glows.mesh);
    const cones = [];
    for (const [x, y, z, purple] of F.lamps || []) {
      if (y < 7) continue; // hanging lamps only
      const c = new THREE.CylinderGeometry(0.45, 2.3, 5.2, 18, 1, true); c.translate(x, y - 2.65, z);
      const col = new THREE.Color(purple ? 0x7a54ff : 0xffa055), cols = [], P = c.attributes.position;
      for (let i = 0; i < P.count; i++) { const k = (P.getY(i) - (y - 5.25)) / 5.2; const a = 0.05 + 0.95 * k * k; cols.push(col.r * a, col.g * a, col.b * a); }
      c.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); cones.push(c);
    }
    // warm shafts slanting down from the clerestory windows (both long walls)
    for (const sx of [-1, 1]) for (let z = -15; z <= 15; z += 6) {
      const top = new THREE.Vector3(sx * (F.size.w / 2 - 0.3), 10.6, z), bot = new THREE.Vector3(sx * 2.0, 0.2, z + 2.2), w = 2.2;
      const g = new THREE.BufferGeometry(); const a = [top.x, top.y, top.z - w / 2, top.x, top.y, top.z + w / 2, bot.x, bot.y, bot.z + w * 0.8, bot.x, bot.y, bot.z - w * 0.8];
      g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
      const c1 = new THREE.Color(0xffa860).multiplyScalar(0.55), c0 = new THREE.Color(0x000000);
      g.setAttribute('color', new THREE.Float32BufferAttribute([c1.r, c1.g, c1.b, c1.r, c1.g, c1.b, c0.r, c0.g, c0.b, c0.r, c0.g, c0.b], 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      cones.push(g);
    }
    for (const c of cones) { if (!c.attributes.uv) c.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(c.attributes.position.count * 2), 2)); if (!c.attributes.normal) c.computeVertexNormals(); }
    const beams = new THREE.Mesh(own(mergeGeometries(cones.map((c) => (c.index ? c.toNonIndexed() : c)))), own(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false })));
    beams.name = 'LightCones'; beams.renderOrder = 8; root.add(beams);
    // wet-floor look without a reflection pass: soft additive light streaks on the floor under every
    // lamp / pumpkin (elongated toward the player's usual view, like reflections on wet concrete)
    const refl = [], rt = softTexture();
    const streak = (x, z, w, l, col, a) => {
      const g = new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2).translate(x, 0.02, z);
      const c = new THREE.Color(col).multiplyScalar(a), cols = [];
      for (let i = 0; i < g.attributes.position.count; i++) cols.push(c.r, c.g, c.b);
      g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); refl.push(g);
    };
    for (const [x, y, z, purple] of F.lamps || []) if (y > 7) streak(x, z + 1.2, 1.1, 4.2, purple ? 0x8a5cff : 0xff9a40, 0.55); else streak(x * 0.92, z + 0.8, 0.6, 2.2, 0xffa050, 0.4);
    for (const [x, y, z, sc] of F.pumpkins || []) if (y < 0.5) streak(x, z + 0.7 * sc, 0.7 * sc, 1.6 * sc, 0xff7020, 0.5);
    streak(-7.0, 12.5, 2.6, 4.5, 0xff6020, 0.45); // debris fire
    const reflMat = own(new THREE.MeshBasicMaterial({ map: rt, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    const reflMesh = new THREE.Mesh(own(mergeGeometries(refl)), reflMat); reflMesh.name = 'WetFloorReflections'; reflMesh.renderOrder = 2; root.add(reflMesh);
    atmo = { glows };
    yield 'atmosphere';

    // ------------------------------------------------ particles + lights
    fx = {
      smoke: own(new Billboards(48, { color: 0x50465a, gravity: -0.25, drag: 0.5, name: 'InteriorSmoke' })),
      embers: own(new Billboards(24, { color: 0xff8a3a, additive: true, gravity: -0.6, drag: 0.8, name: 'InteriorEmbers' })),
      dust: own(new Billboards(40, { color: 0x9a8a90, gravity: 0.3, drag: 1.6, name: 'LandingDust' })),
      motes: own(new Billboards(60, { color: 0xffc890, additive: true, gravity: -0.02, drag: 0.2, texture: softTexture(), name: 'DustMotes' })),
      t: 0,
    };
    for (const k of ['smoke', 'embers', 'dust', 'motes']) root.add(fx[k].mesh);
    const hemi = new THREE.HemisphereLight(0x7a5a9a, 0x1a1016, 0.6); hemi.name = 'FactoryHemi';
    const warmA = new THREE.PointLight(0xff9a50, 46, 20, 1.4); warmA.position.set(0, 7.6, 6); warmA.name = 'HallWarmSouth';
    const warmB = new THREE.PointLight(0xff9a50, 42, 20, 1.4); warmB.position.set(0, 7.6, -6); warmB.name = 'HallWarmNorth';
    const fire = new THREE.PointLight(0xff7a30, 26, 14, 1.6); fire.position.set(-8.2, 1.4, 14.6); fire.name = 'DebrisFire';
    const purple = new THREE.PointLight(0x9a62ff, 34, 22, 1.5); purple.position.set(0, 7.5, -12); purple.name = 'BossZonePurple';
    lights.push(hemi, warmA, warmB, fire, purple);
    for (const l of lights) root.add(l);
    for (let i = 0; i < 90; i++) step(1 / 15, i / 15); // smoke column already there on fade-in
    root.updateMatrixWorld(true);
    yield 'done';
  }

  const _p = new THREE.Vector3(), _v = new THREE.Vector3();
  function step(dt, t) {
    if (!fx) return;
    fx.t += dt;
    if (Math.random() < dt * 6) fx.smoke.spawn(_p.set(-8.2 + (Math.random() - 0.5) * 3, 0.8 + Math.random() * 1.5, 14.6 + (Math.random() - 0.5) * 2.4), _v.set((Math.random() - 0.5) * 0.3, 0.9 + Math.random() * 0.5, -0.3), { life: 9, size: [1.2, 4.2], alpha: 0.3 });
    if (Math.random() < dt * 3) fx.smoke.spawn(_p.set(B.x + (Math.random() - 0.5) * 4, h - 0.5, B.z + (Math.random() - 0.5) * 4), _v.set((Math.random() - 0.5) * 0.4, 0.15, (Math.random() - 0.5) * 0.4), { life: 6, size: [2, 4], alpha: 0.22 });
    if (Math.random() < dt * 4) fx.embers.spawn(_p.set(-9.5 + Math.random() * 3, 0.3, 13 + Math.random() * 3.5), _v.set((Math.random() - 0.5) * 0.4, 1.2 + Math.random(), (Math.random() - 0.5) * 0.4), { life: 2.5, size: [0.08, 0.02], alpha: 0.9 });
    if (Math.random() < dt * 8) { const lp = (F.lamps || [])[Math.floor(Math.random() * (F.lamps || []).length)]; if (lp && lp[1] > 7) fx.motes.spawn(_p.set(lp[0] + (Math.random() - 0.5) * 3, 1 + Math.random() * 5, lp[2] + (Math.random() - 0.5) * 3), _v.set((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.08), { life: 6 + Math.random() * 4, size: [0.03, 0.05], alpha: 0.8 }); }
    fx.smoke.update(dt); fx.embers.update(dt); fx.dust.update(dt); fx.motes.update(dt);
    atmo?.glows.update(t);
    if (mist) for (const m of mist.children) { m.material.map.offset.x = (t * 0.006 * (1 + m.position.y)) % 1; m.material.map.offset.y = (t * 0.004) % 1; }
    const fire = lights[3]; if (fire) fire.intensity = 24 + Math.sin(t * 7.3) * 1.5 + Math.sin(t * 3.1) * 1.5; // gentle, never strobing
  }

  let prevFog = null, prevTone = null;
  const api = {
    root,
    /** time-sliced builder (yields section names; 'wait' = waiting for the model download) */
    *build() { for (const s of build()) { if (s === 'done') ready = true; yield s; } },
    get ready() { return ready; },
    get stats() { return stats; },
    /** interior-local → world */
    toWorld: (x, y, z, out = new THREE.Vector3()) => out.set(x + F.origin[0], y + F.origin[1], z + F.origin[2]),
    activate(scene, renderer) {
      prevFog = scene.fog; scene.fog = new THREE.Fog(0x1c1226, 14, 60); root.visible = true;
      if (renderer) { prevTone = { tm: renderer.toneMapping, ex: renderer.toneMappingExposure }; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15; } // filmic contrast indoors
    },
    deactivate(scene, renderer) {
      if (prevFog !== null) scene.fog = prevFog; prevFog = null; root.visible = false;
      if (renderer && prevTone) { renderer.toneMapping = prevTone.tm; renderer.toneMappingExposure = prevTone.ex; } prevTone = null;
    },
    update(dt, t) { if (root.visible) step(dt, t); },
    landingDust(x, z) { for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; fx?.dust.spawn(_p.set(x - F.origin[0] + Math.cos(a) * 0.3, 0.15, z - F.origin[2] + Math.sin(a) * 0.3), _v.set(Math.cos(a) * 2.2, 0.4 + Math.random() * 0.5, Math.sin(a) * 2.2), { life: 1.6, size: [0.5, 1.6], alpha: 0.5 }); } },
    dispose() { root.parent?.remove(root); for (const x of disposables) x.dispose?.(); disposables.length = 0; ready = false; },
    /** minimap boxes (world) */
    mapBoxes() { return F.blockers.map((b, i) => ({ x: (b.x0 + b.x1) / 2 + F.origin[0], z: (b.z0 + b.z1) / 2 + F.origin[2], w: b.x1 - b.x0, d: b.z1 - b.z0, yaw: 0, id: `F${i}`, upper: false, highlight: b.kind === 'debris' })); },
    views: {
      spawn: { pos: new THREE.Vector3(F.spawn.pos[0] + F.origin[0], 1.6 + F.origin[1], F.spawn.pos[2] + F.origin[2]), look: new THREE.Vector3(F.bossHover[0] + F.origin[0], 3 + F.origin[1], F.bossHover[2] + F.origin[2]) },
      arena: { pos: new THREE.Vector3(F.arenaCircle.pos[0] + F.origin[0], 1.7 + F.origin[1], F.arenaCircle.pos[2] + 2.5 + F.origin[2]), look: new THREE.Vector3(F.origin[0], F.origin[1] + 4, F.origin[2] - 12) },
      top: { pos: new THREE.Vector3(F.origin[0] + 0.01, F.origin[1] + 42, F.origin[2] + 0.5), look: new THREE.Vector3(F.origin[0], F.origin[1], F.origin[2]) },
      side: { pos: new THREE.Vector3(F.origin[0] + 8.0, F.origin[1] + 7.0, F.origin[2] + 16.5), look: new THREE.Vector3(F.origin[0] - 2, F.origin[1] + 4, F.origin[2] - 6) },
    },
  };
  return api;
}
