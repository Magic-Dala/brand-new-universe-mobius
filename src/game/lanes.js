// Arcade: three floating rhythm lanes (left / centre / right) — the holographic guide that
// Mobius' armour display projects between Green Maniac and the player. Not a floor road:
// thin glowing edges, a faint grid band, beat markers and arrows that FLOW TOWARD THE PLAYER
// at exactly the bombs' speed (driven by the song clock, not by frame accumulation), and a
// fixed judgement ring per lane in front of the player.
// One draw call for the three bands (shared shader), 3 rings + 3 glow discs.
import * as THREE from 'three';
import { settings } from '../core/settings.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3();
export const LANES = 3;

/** Lane index for a chart event: explicit `track` (0 L, 1 C, 2 R) or derived from lane.x. */
export function laneOf(e) {
  if (Number.isInteger(e.track) && e.track >= 0 && e.track < LANES) return e.track;
  const x = e.lane?.x ?? 0;
  return x <= -0.6 ? 0 : x >= 0.6 ? 2 : 1;
}
/** Assign tracks to resolved notes; notes sharing a beat never share a lane (clusters fan out). */
export function assignTracks(notes) {
  const groups = new Map();
  for (const n of notes) { n.track = laneOf(n); if (n.row) continue; const k = Math.round(n.time * 20); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); } // fan rows keep their lanes
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    if (g.length >= LANES || g[0].group) { g.sort((a, b) => (a.lane?.x ?? 0) - (b.lane?.x ?? 0)); g.forEach((n, i) => { n.track = Math.round((i * (LANES - 1)) / Math.max(1, g.length - 1)); }); continue; }
    const used = new Set();
    for (const n of g) { if (used.has(n.track)) n.track = [1, 0, 2].find((l) => !used.has(l)) ?? n.track; used.add(n.track); }
  }
  return notes;
}

const VERT = /* glsl */`
attribute float aDist; attribute float aLane;
varying vec2 vUv; varying float vDist; varying float vLane;
void main() { vUv = uv; vDist = aDist; vLane = aLane; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = /* glsl */`
uniform float uNow, uBeat, uOffset, uSpeed, uLen, uOpacity; uniform vec3 uEdge, uFill, uMark, uHot;
varying vec2 vUv; varying float vDist; varying float vLane;
void main() {
  float across = abs(vUv.x - 0.5) * 2.0;                       // 0 centre … 1 edge
  float edge = smoothstep(0.86, 0.97, across) * (1.0 - smoothstep(0.985, 1.0, across));
  // arrival time of a bomb at this spot (music clock): markers on beats move toward the player
  float tArr = uNow + vDist / uSpeed;
  float ph = fract((tArr - uOffset) / uBeat);
  float mark = (1.0 - smoothstep(0.0, 0.035, min(ph, 1.0 - ph))) * (1.0 - across * 0.6);
  // chevrons (apex toward the player) at half beats inside the band
  float chev = fract((tArr - uOffset) / (uBeat * 0.5) + across * 0.22);
  float arrow = (1.0 - smoothstep(0.0, 0.06, abs(chev - 0.5))) * step(across, 0.38);
  float grid = (1.0 - smoothstep(0.0, 0.02, abs(fract(vDist * 1.25) - 0.5) - 0.47)) * 0.25; // faint cross lines
  // fade near Green Maniac and just behind the judgement ring; beat pulse
  float far = 1.0 - smoothstep(uLen * 0.82, uLen, vDist);
  float near = smoothstep(-0.7, 0.0, vDist);
  float beatPh = fract((uNow - uOffset) / uBeat);
  float pulse = 0.85 + 0.15 * (1.0 - smoothstep(0.0, 0.25, beatPh));
  float hotK = vLane < 0.5 ? uHot.x : vLane < 1.5 ? uHot.y : uHot.z;
  vec3 col = uFill * (0.08 + grid) + uEdge * edge * 1.5 + uMark * (mark * 0.9 + arrow * 0.6);
  float a = (0.07 + grid * 0.5 + edge * 1.2 + mark * 0.75 + arrow * 0.55) * far * near * pulse * (1.0 + hotK * 0.6);
  gl_FragColor = vec4(col * (1.0 + hotK * 0.5), a * uOpacity);
}`;

/**
 * 2026-11-15, on the designer's word after headset tries: wider lanes, and Green Maniac pushed back to the north door so the
 * track is longer. These sit on top of the lane settings (settings.arcadeLane*, arcadeBossDistance) instead of replacing
 * their defaults: a headset keeps its saved settings, so new defaults would not reach it, and the pinned defaults stay as
 * tests/factory-layout-golden.test.mjs records them.
 */
export const LANE_TUNE = { widthMul: 1.75, spacingAdd: 0.5, bossBack: 2.8 }; // band 0.42 → 0.735 m, rings 0.9 → 1.4 m apart (18.4° off centre at 4.2 m; the comfort limit in tests/lanes.test.mjs was raised from 16° to 20° on the designer's word, 2026-11-16), he hovers 16.5 → 19.3 m away (the door is at 20.5 m)
// (The lanes still meet Green Maniac 1.7 m apart: wider there would put the side lamps at 4 m inside the lane corridor, where the hall show is off.)
export class LaneGuides {
  constructor(scene) {
    this.root = new THREE.Group(); this.root.name = 'arcade-lanes'; this.root.visible = false; scene.add(this.root);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
      uniforms: { uNow: { value: 0 }, uBeat: { value: 0.48 }, uOffset: { value: 0 }, uSpeed: { value: 6 }, uLen: { value: 12 }, uOpacity: { value: 0.55 },
        uEdge: { value: new THREE.Color(0x8a7dff) }, uFill: { value: new THREE.Color(0x4a5cff) }, uMark: { value: new THREE.Color(0x7fb8ff) }, uHot: { value: new THREE.Vector3() } },
    });
    this.band = new THREE.Mesh(new THREE.BufferGeometry(), this.mat); this.band.frustumCulled = false; this.band.renderOrder = 3; this.root.add(this.band);
    // fixed judgement rings (one per lane) + soft glow discs; brightness follows the approaching bomb
    const ringGeo = new THREE.RingGeometry(0.88, 1.0, 56), discGeo = new THREE.CircleGeometry(0.88, 40);
    this.rings = [];
    for (let i = 0; i < LANES; i++) {
      const rm = new THREE.MeshBasicMaterial({ color: 0x5fc8ff, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false });
      const dm = new THREE.MeshBasicMaterial({ color: 0x3a6cff, transparent: true, opacity: 0.04, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false });
      const g = new THREE.Group(); const ring = new THREE.Mesh(ringGeo, rm), disc = new THREE.Mesh(discGeo, dm);
      ring.renderOrder = 4; disc.renderOrder = 4; g.add(disc, ring); this.root.add(g);
      this.rings.push({ g, ring, disc, rm, dm, hot: 0 });
    }
    this.start = [0, 1, 2].map(() => new THREE.Vector3()); this.strike = [0, 1, 2].map(() => new THREE.Vector3());
    this.dir = [0, 1, 2].map(() => new THREE.Vector3()); this.len = [12, 12, 12];
  }
  /**
   * Lay the lanes out for an arena. origin = player rig origin (floor), forward = toward the boss,
   * bossHome = boss hover point. All distances / heights are settings (Quest-tunable).
   */
  layout(origin, forward, bossHome, eyeHeight = 1.6) {
    const f = _v.copy(forward).setY(0).normalize(), right = _w.set(-f.z, 0, f.x);
    const k = eyeHeight / 1.6;
    const sp = settings.arcadeLaneSpacing + LANE_TUNE.spacingAdd, h = settings.arcadeLaneHeight * k, lift = settings.arcadeLaneCenterLift * k;
    const dBoss = Math.max(6, _u.copy(bossHome).sub(origin).setY(0).length());
    const farD = Math.max(settings.arcadeStrikeDistance + 3, dBoss - 1.6), spread = settings.arcadeLaneStartSpread;
    const farY = Math.min(bossHome.y - origin.y - 0.9, h + settings.arcadeLaneRise * k);
    const pos = [], uv = [], dist = [], lane = [], idx = [];
    for (let i = 0; i < LANES; i++) {
      const s = i - 1, y = h + (s === 0 ? lift : 0);
      this.strike[i].copy(origin).addScaledVector(f, settings.arcadeStrikeDistance).addScaledVector(right, s * sp).setY(origin.y + y);
      this.start[i].copy(origin).addScaledVector(f, farD).addScaledVector(right, s * spread).setY(origin.y + farY + (s === 0 ? lift : 0));
      this.dir[i].subVectors(this.strike[i], this.start[i]); this.len[i] = this.dir[i].length(); this.dir[i].normalize();
      // band: a ribbon BELOW the bomb path (the bombs fly just above it), from the boss end to just past the ring
      const drop = settings.arcadeLaneBandDrop * k, wNear = settings.arcadeLaneWidth * LANE_TUNE.widthMul, wFar = wNear * 1.35;
      const N = 24, base = pos.length / 3;
      for (let j = 0; j <= N; j++) {
        const t = j / N, along = -0.7 + (this.len[i] + 0.7) * t; // metres from the ring toward the boss (negative = behind the ring)
        const c = _u.copy(this.strike[i]).addScaledVector(this.dir[i], -along); c.y -= drop * (1 - 0.35 * t);
        const half = (wNear + (wFar - wNear) * t) / 2;
        for (const side of [-1, 1]) { pos.push(c.x + right.x * side * half, c.y, c.z + right.z * side * half); uv.push(side < 0 ? 0 : 1, t); dist.push(along); lane.push(i); }
        if (j < N) { const a = base + j * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
      }
      // ring faces the player's head
      const R = this.rings[i]; R.g.position.copy(this.strike[i]);
      R.g.lookAt(_u.copy(origin).setY(origin.y + eyeHeight)); R.g.scale.setScalar(settings.arcadeRingRadius);
    }
    const g = this.band.geometry; g.dispose();
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); ng.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    ng.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1)); ng.setAttribute('aLane', new THREE.Float32BufferAttribute(lane, 1)); ng.setIndex(idx);
    this.band.geometry = ng;
    this.mat.uniforms.uLen.value = Math.max(...this.len);
  }
  /** Point on lane `i` at progress u (0 = near the boss, 1 = the judgement ring; >1 continues toward the player). */
  point(i, u, out = new THREE.Vector3()) { return out.copy(this.start[i]).addScaledVector(this.dir[i], this.len[i] * u); }
  /** Per frame: song time (s), beat length (s), chart offset (s), bomb travel time (s), hotness per lane (0..1). */
  update(now, beatSec, offsetSec, travel, hot) {
    const U = this.mat.uniforms;
    U.uNow.value = now; U.uBeat.value = beatSec; U.uOffset.value = offsetSec; U.uSpeed.value = this.len[1] / Math.max(0.3, travel);
    U.uOpacity.value = settings.arcadeLaneOpacity;
    for (let i = 0; i < LANES; i++) {
      const R = this.rings[i]; R.hot += ((hot?.[i] || 0) - R.hot) * 0.35;
      R.rm.opacity = 0.22 + 0.65 * R.hot; R.dm.opacity = 0.03 + 0.12 * R.hot;
    }
    U.uHot.value.set(this.rings[0].hot, this.rings[1].hot, this.rings[2].hot);
  }
  /** Fan Web hit: all three judgement rings flash once (decays through the normal hotness smoothing). */
  pulseAll() { for (const R of this.rings) R.hot = 1.6; }
  setVisible(v) { this.root.visible = v; }
}
