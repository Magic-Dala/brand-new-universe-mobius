// v0.30 Dala City life + skyline (renderer only; no colliders; deterministic from fixed hashes — same seed, same look).
//   hero     3 landmark towers (kit pieces hero_deco_tower / hero_glass_tower / hero_spire_tower) far outside the
//            playable corridor (≥ 380 m from the story route), visible from the route. 1 draw call each.
//   shafts   light-shaft cards: soft warm columns hanging in the streets that run toward the sun (additive, ≤ 8, 1 call)
//   birds    3 small flocks circling over the roofs + 2 far aircraft with a slow (1 Hz) nav-light blink (1 call)
//   steam    manhole steam near the camera (looping GPU puffs, alpha-blended, 1 call)
//   neon     slow, comfortable flicker / breathing on the blade signs (≤ 1 Hz)
//   traffic2 denser traffic (×1.75) with stretched tail-light trails
// Every animation is computed in the vertex shader from one time uniform: no per-frame allocation, no CPU loops.
import * as THREE from 'three';
import { SUN_DIRECTION } from './sky.js';
import { artHash } from './cityArt.js';
import { softTexture } from './particles.js';
import { CITY_SHARED, CITY_COMMON_GLSL } from './cityMaterials.js';

const HERO = [['hero_deco_tower', 150, -1, 470], ['hero_glass_tower', 360, 1, 430], ['hero_taipei_tower', 560, -1, 400]]; // [piece, route s, side, lateral m] — v0.30c: the landmark behind the factory is a Taipei-101-style tower

export function createCityLife({ root, world, cfg, art, kit }) {
  const G = new THREE.Group(); G.name = 'CityLife'; root.add(G);
  const T = CITY_SHARED.uCityTime, flags = {};
  const sunH = new THREE.Vector2(SUN_DIRECTION.x, SUN_DIRECTION.z).normalize();

  // ---------------------------------------------------------------- hero towers
  const hero = { meshes: [], placed: false };
  function placeHero() {
    if (hero.placed || !kit?.stats.ready || !kit.pieces) return;
    const p = new THREE.Vector3(), q = new THREE.Vector3(), nrm = new THREE.Vector3();
    for (const [name, s, side, lat] of HERO) {
      const g = kit.pieces[name]?.[0]; if (!g) continue;
      world.pointAt(s, p); world.pointAt(s + 6, q); q.sub(p).normalize(); nrm.set(-q.z, 0, q.x).multiplyScalar(side * lat);
      const m = new THREE.InstancedMesh(g.clone(), kit.matFor('hero', 0), 1);
      m.geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3));
      m.geometry.setAttribute('aKit', new THREE.InstancedBufferAttribute(new Float32Array([3, (HERO.findIndex((h) => h[0] === name) + 0.5) / 8, 0, 1]), 4));
      m.setMatrixAt(0, new THREE.Matrix4().makeRotationY(artHash(s, 5) * 6.28).setPosition(p.x + nrm.x, 0, p.z + nrm.z));
      m.frustumCulled = false; m.name = `hero:${name}`; m.visible = !!flags.hero; G.add(m); hero.meshes.push(m);
    }
    hero.placed = hero.meshes.length > 0;
  }

  // ---------------------------------------------------------------- light shafts (camera-facing cylindrical cards)
  const SH = 8;
  const shafts = (() => {
    const g = new THREE.InstancedBufferGeometry(); const base = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    g.index = base.index; g.attributes.position = base.attributes.position; g.attributes.uv = base.attributes.uv;
    const aP = new THREE.InstancedBufferAttribute(new Float32Array(SH * 4), 4); g.setAttribute('aP', aP); g.instanceCount = 0;
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
      uniforms: { uT: T, uSun: { value: new THREE.Vector3(sunH.x, 0, sunH.y) } },
      vertexShader: `attribute vec4 aP; uniform float uT; varying vec2 vUv; varying float vA;
        void main(){ vUv = uv; vec3 c = aP.xyz; vec3 toC = c - cameraPosition; toC.y = 0.0; float d = length(toC);
          vec3 right = normalize(vec3(-toC.z, 0.0, toC.x));
          vec3 wp = c + right * position.x * aP.w + vec3(0.0, position.y * aP.w * 4.2, 0.0);
          vA = smoothstep(25.0, 70.0, d) * (1.0 - smoothstep(260.0, 380.0, d));
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); }`,
      fragmentShader: `uniform float uT; varying vec2 vUv; varying float vA;
        void main(){ float x = abs(vUv.x - 0.5) * 2.0; float edge = 1.0 - smoothstep(0.35, 1.0, x);
          float streak = 0.75 + 0.25 * sin(vUv.x * 23.0 + uT * 0.15) * sin(vUv.x * 7.0 - uT * 0.11);
          float h = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
          float a = edge * streak * h * vA * 0.10;
          gl_FragColor = vec4(vec3(1.0, 0.72, 0.42) * a, 1.0); }`,
    });
    const mesh = new THREE.Mesh(g, m); mesh.name = 'light-shafts'; mesh.frustumCulled = false; mesh.renderOrder = 960; G.add(mesh);
    return { mesh, g, aP, at: null };
  })();
  function placeShafts(cam) {
    const S = cfg.cell, [gx, gz] = world.cellCenter(0, 0);
    const alongX = Math.abs(sunH.x) > Math.abs(sunH.y); // the street direction most aligned with the sun
    const key = `${Math.round((cam.x - gx) / S)},${Math.round((cam.z - gz) / S)}`; if (key === shafts.at) return; shafts.at = key;
    let n = 0; const A = shafts.aP.array;
    for (let k = -1; k <= 1; k++) for (const dist of [110, 190]) {
      if (n >= SH) break;
      let x, z;
      if (alongX) { z = gz + (Math.round((cam.z - gz) / S) + k) * S; x = cam.x + Math.sign(sunH.x) * dist; x = gx + Math.round((x - gx) / S) * S + Math.sign(sunH.x) * S * 0.5; }
      else { x = gx + (Math.round((cam.x - gx) / S) + k) * S; z = cam.z + Math.sign(sunH.y) * dist; z = gz + Math.round((z - gz) / S) * S + Math.sign(sunH.y) * S * 0.5; }
      if (world.pointBlocked(x, 2, z, 3)) continue;
      A.set([x, 0, z, 9 + artHash(x | 0, z | 0) * 5], n * 4); n++;
    }
    shafts.g.instanceCount = n; shafts.aP.needsUpdate = true;
  }

  // ---------------------------------------------------------------- birds + aircraft (one instanced V-shape mesh)
  const NB = 42, NA = 2;
  const birds = (() => {
    const wing = new Float32Array([0, 0, 0, -1, 0.15, -0.35, 0, 0, -0.25, 0, 0, 0, 1, 0.15, -0.35, 0, 0, -0.25]); // two wings (x = span)
    const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(wing, 3));
    const aB = new THREE.InstancedBufferAttribute(new Float32Array((NB + NA) * 4), 4); g.setAttribute('aB', aB); g.instanceCount = NB + NA;
    for (let i = 0; i < NB + NA; i++) aB.setXYZW(i, i < NB ? Math.floor(i / 14) : 3 + (i - NB), artHash(i, 1), artHash(i, 2), artHash(i, 3));
    const m = new THREE.ShaderMaterial({
      side: THREE.DoubleSide, fog: false, uniforms: { uT: T, uC: { value: new THREE.Vector3() }, uSun: { value: SUN_DIRECTION } },
      vertexShader: `attribute vec4 aB; uniform float uT; uniform vec3 uC; varying float vL;
        void main(){ float fl = aB.x; vec3 p = position; vL = 0.0;
          if (fl < 2.5) { // flocks: each bird circles a flock centre with its own phase, wings flap ~3 Hz (visual motion, not a flash)
            vec3 c = uC + vec3(sin(fl * 2.1) * 140.0, 70.0 + fl * 18.0, cos(fl * 1.7) * 140.0);
            float a = uT * (0.10 + 0.03 * aB.y) + aB.z * 6.283; float r = 14.0 + aB.w * 22.0;
            vec3 o = c + vec3(cos(a) * r, sin(a * 2.0 + aB.y * 6.0) * 2.5, sin(a) * r);
            float flap = sin(uT * 18.0 + aB.y * 40.0) * 0.5; p.y += abs(p.x) * flap; p *= 0.55;
            float h = a + 1.5708; mat2 R = mat2(cos(h), -sin(h), sin(h), cos(h)); p.xz = R * p.xz; gl_Position = projectionMatrix * viewMatrix * vec4(o + p, 1.0);
          } else { // aircraft: far, slow, straight; nav light blinks at 1 Hz (well under the 3 Hz comfort limit)
            float k = fl - 3.0; float tt = fract(uT * 0.004 + aB.y);
            vec3 o = uC + vec3(mix(-900.0, 900.0, tt), 260.0 + k * 60.0, -600.0 + k * 1100.0 + aB.z * 200.0);
            p *= 6.0; vL = step(0.85, fract(uT * 1.0 + aB.w)); gl_Position = projectionMatrix * viewMatrix * vec4(o + p, 1.0);
          } }`,
      fragmentShader: `varying float vL; void main(){ gl_FragColor = vec4(mix(vec3(0.16, 0.12, 0.17), vec3(1.0, 0.25, 0.2), vL), 1.0); }`,
    });
    const mesh = new THREE.Mesh(g, m); mesh.name = 'birds'; mesh.frustumCulled = false; G.add(mesh);
    return { mesh, m };
  })();

  // ---------------------------------------------------------------- manhole steam (looping GPU puffs)
  const NV = 36, PUFF = 9;
  const steam = (() => {
    const g = new THREE.InstancedBufferGeometry(); const base = new THREE.PlaneGeometry(1, 1);
    g.index = base.index; g.attributes.position = base.attributes.position; g.attributes.uv = base.attributes.uv;
    const aS = new THREE.InstancedBufferAttribute(new Float32Array(NV * PUFF * 4), 4); g.setAttribute('aS', aS); g.instanceCount = 0;
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, uniforms: { uT: T, map: { value: softTexture() } },
      vertexShader: `attribute vec4 aS; uniform float uT; varying vec2 vUv; varying float vA;
        void main(){ vUv = uv; float ph = fract(uT / 4.5 + aS.w); vec3 c = aS.xyz;
          vec3 o = c + vec3(sin(ph * 3.0 + aS.w * 20.0) * 0.6 + ph * 1.2, ph * 6.5, cos(ph * 2.0 + aS.w * 9.0) * 0.5);
          float s = 0.6 + ph * 2.6; float d = distance(o, cameraPosition);
          vA = smoothstep(0.0, 0.15, ph) * (1.0 - ph) * 0.32 * smoothstep(1.5, 5.0, d) * (1.0 - smoothstep(90.0, 140.0, d));
          vec4 mv = viewMatrix * vec4(o, 1.0); mv.xy += position.xy * s; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying float vA;
        void main(){ float t = texture2D(map, vUv).a; float a = t * vA; if (a < 0.004) discard; gl_FragColor = vec4(vec3(0.86, 0.82, 0.84), a); }`,
    });
    const mesh = new THREE.Mesh(g, m); mesh.name = 'manhole-steam'; mesh.frustumCulled = false; mesh.renderOrder = 9; G.add(mesh);
    return { mesh, g, aS, at: null };
  })();
  function placeSteam(cam) {
    const S = cfg.cell, [gx, gz] = world.cellCenter(0, 0), ci = Math.round((cam.x - gx) / S), cj = Math.round((cam.z - gz) / S);
    const key = `${ci},${cj}`; if (key === steam.at) return; steam.at = key;
    let n = 0; const A = steam.aS.array;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const cx = gx + (ci + di) * S, cz = gz + (cj + dj) * S, I = ci + di, J = cj + dj;
      for (let k = 0; k < 8 && n < NV; k++) {
        if (artHash(I, J, k, 919) > 0.28) continue;
        const a = k < 4 ? [(k & 1 ? 21 : -21), (k & 2 ? 1.9 : -1.9)] : [(k & 1 ? 1.9 : -1.9), (k & 2 ? 21 : -21)];
        const x = cx + a[0], z = cz + a[1]; if (world.pointBlocked(x, 1, z, 1)) continue;
        for (let p = 0; p < PUFF; p++) A.set([x, 0.1, z, p / PUFF + artHash(I, J, k) * 0.13], (n * PUFF + p) * 4);
        n++;
      }
    }
    steam.g.instanceCount = n * PUFF; steam.aS.needsUpdate = true;
  }

  // ---------------------------------------------------------------- neon flicker (blade signs) + traffic2
  const signMat = art?.pools?.signs?.mesh.material;
  const NEON = { value: 0 };
  if (signMat) {
    const prev = signMat.onBeforeCompile;
    signMat.onBeforeCompile = (sh) => {
      prev?.(sh);
      sh.uniforms.uNeonT = T; sh.uniforms.uNeonOn = NEON;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vNeonPh;').replace('#include <uv_vertex>', '#include <uv_vertex>\n  vNeonPh = aAtlas.x * 7.0 + aAtlas.y * 13.0;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNeonT, uNeonOn; varying float vNeonPh;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n  if (uNeonOn > 0.5) { float b = 0.9 + 0.1 * sin(uNeonT * 0.8 + vNeonPh) + 0.25 * step(0.6, fract(vNeonPh * 0.37)) * smoothstep(0.0, 0.2, sin(uNeonT * 0.55 + vNeonPh * 3.0)); diffuseColor.rgb *= 1.0 + 0.55 * b * smoothstep(0.35, 0.8, max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b))); }');
    };
    signMat.customProgramCacheKey = () => 'blade-signs-atlas-neon';
    signMat.needsUpdate = true;
  }

  // ---------------------------------------------------------------- per frame
  function update(dt, cam) {
    if (!cam) return;
    if (flags.hero && !hero.placed) placeHero();
    if (flags.shafts) placeShafts(cam);
    if (flags.steam) placeSteam(cam);
    if (flags.birds) birds.m.uniforms.uC.value.set(Math.round(cam.x / 200) * 200, 0, Math.round(cam.z / 200) * 200);
  }
  function setFlags(f) {
    for (const k of ['hero', 'shafts', 'birds', 'steam', 'neon', 'traffic2']) flags[k] = !!f[k];
    for (const m of hero.meshes) m.visible = flags.hero;
    shafts.mesh.visible = flags.shafts; birds.mesh.visible = flags.birds; steam.mesh.visible = flags.steam;
    NEON.value = flags.neon ? 1 : 0;
    if (art) art.trafficBoost = flags.traffic2 ? 1.75 : 1;
    shafts.at = steam.at = null;
  }
  function shift(dx, dz) {
    for (const m of hero.meshes) { const e = m.instanceMatrix.array; e[12] += dx; e[14] += dz; m.instanceMatrix.needsUpdate = true; }
    shafts.at = steam.at = null;
  }
  return { update, setFlags, shift, hero, meshes: { shafts: shafts.mesh, birds: birds.mesh, steam: steam.mesh }, flags };
}
void CITY_COMMON_GLSL;
