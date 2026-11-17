// Single locomotion owner for the player rig (world.player):
//  - teleport (arc + landing validation), snap turn (microgesture / stick / fallback)
//  - web swinging on FIXED building anchors of the streaming city (pendulum with a rope-length limit,
//    reel-in, inertia, air drag, release momentum, re-grab), collisions with the simplified building
//    boxes, landing on roofs / the street, wall cling + climb, thruster fall assist, the playable
//    corridor (height / lateral range) with safe recovery, comfort vignette + speed limits.
// The rig is only translated or yawed; the head is never rolled, pitched or shaken.
import * as THREE from 'three';
import { settings } from '../core/settings.js';
import { audio } from '../core/audio.js';
import { pickTarget, angularZoneSize } from './aim.js';
import { ROOM, ROOM_BLOCKERS } from '../data/layout.js';
import { cityWorld } from '../data/cityWorld.js';
import { CITY_CFG } from '../data/cityConfig.js';
import { worldToBox } from '../data/box.js';
import { PULL } from '../data/handCombat.js';
import { WebPullDetector } from '../input/webPull.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _f = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Vector3(), _p2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const CHEST = 1.3; // metres above feet used as the swing body point (stable vs. crouching)
const TOP = 1.85; // body top above feet
const R_BODY = 0.35;
const MARKERS = 160; // nearby anchor glow markers (only reachable + visible ones)
/**
 * Wall running (v0.23): touching a wall while swinging / flying starts a wall run unless the player clearly wants to
 * climb — looking steeply up / down (|pitch| > pitchClimbDeg), facing the wall head-on (look·normal < faceWall), at a
 * building edge (< edgeMargin m from a vertical corner), or just under the roof / just above the street. The run goes
 * along the wall toward where the head looks (projected on the wall, ±maxElevDeg), steered continuously by the head.
 * Ends: face the wall → cling / climb; look away from the wall → jump off; a web → swing on (momentum kept); past a
 * corner → fly off; up over the roof edge → mantle; maxTime → slide off.
 */
export const WALLRUN = {
  pitchClimbDeg: 50, faceWall: -0.8, lookAway: 0.55, edgeMargin: 1.5, topMargin: 2.2, bottomMargin: 3,
  speedMin: 7, speed: 10, speedMax: 13, accel: 4, steer: 6, maxElevDeg: 30, sag: 1.6, maxTime: 4.0,
  gap: 0.04, jumpOff: [4, 2.5], stepEvery: 0.3,
};
const _near = [], _cols = [], _hp = new THREE.Vector3();
const HANDS = ['left', 'right'];
/** s a held web survives without the web pose / trigger (hand-tracked web.held flickers); longer while tracking is lost. */
export const WEB_HOLD_GRACE = { held: 0.15, lost: 0.5 };
const _pd = new THREE.Vector3(), _pb = new THREE.Vector3();
const _pullIn = { t: 0, dt: 0, held: false, tracked: false, hand: null, body: null }; // reused detector input (no per-frame objects)
/** Is this a FIXED environmental anchor (a building / scenery anchor)? The jet hook and any other moving target is not. */
export const isEnvAnchor = (a) => !!a && a.valid !== false && !a.moving && a.kind !== 'jet';

/** Effective swing tuning (settings + comfort mode). */
export function swingTuning() {
  const comfort = !!settings.comfortMode;
  return {
    maxSpeed: settings.swingSpeedLimit * (comfort ? 0.75 : 1),
    accel: settings.swingAccel * settings.swingAssist,
    drag: settings.swingDrag * (comfort ? 1.6 : 1),
    steer: settings.swingSteerRate * settings.swingAssist * (comfort ? 0.6 : 1),
    rope: settings.webMaxLength,
    releaseBoost: comfort ? 0 : settings.releaseBoost,
    thrusterFall: settings.thrusterAssist ? settings.thrusterMaxFall : Infinity,
    vignette: settings.vignette ? (comfort ? 1.25 : 1) : 0,
  };
}

export class Locomotion {
  constructor(app) {
    this.app = app;
    this.world = app.cityWorld || cityWorld;
    this.mode = 'off'; // off | room | city
    this.scripted = false; // story-driven rig motion (web dash): no swing / teleport / snap turn
    this.surfaces = []; // teleport surfaces: { y, x0,x1,z0,z1, blockers:[{x0,x1,z0,z1}], bounds?:{x0,x1,z0,z1} }
    this.vel = new THREE.Vector3();
    this.grounded = true;
    this.ropes = []; // v0.24: one web per hand, both can hold at once: [{ anchor, hand, len, beam, lastHeld }] (last = newest)
    this.safePoint = new THREE.Vector3();
    this.markerAnchors = []; this._nextMarkers = 0;
    this.onWebBlocked = null; this._ropeBlocked = 0;
    this.onFall = null; this.onLand = null; this.onAttach = null; this.onStreet = null; this.onOutOfBounds = null; this.onAnchorLost = null; this.onRelease = null;  // v0.45
    this.stats = { swings: 0, maxSpeed: 0, releases: 0, thrustT: 0, pulls: 0, pullDv: 0 };
    // v0.44 web pull (PULL in src/data/handCombat.js): one stroke detector per hand, a shared strength budget, the
    // smoothed impulse still to apply, the temporary allowance over the speed limit, and the recent "surge" (m/s the
    // pulls added lately — Green Maniac's pursuit does not match it)
    this.pull = { left: new WebPullDetector(), right: new WebPullDetector(), pending: { left: 0, right: 0 }, budget: PULL.budgetMax, over: 0, surge: 0, body: new THREE.Vector3(), bodyOk: false, lastT: -9 };
    this._out = 0; this._airT = 0; this._thrust = 0;
    // per-building roof keep-outs (box frame rects): equipment (no teleport) and holes (no floor)
    this.roofBlockers = new Map(); this.roofHoles = new Map();
    this._buildVisuals();
  }
  get colliders() { return this.world; }
  /** Anchors currently selectable (valid, built) — tests / tools. */
  get anchors() { return this.world.activeAnchors; }
  setRoofBlockers(id, rects) { this.roofBlockers.set(id, rects || []); }
  /** Roof hole (box-frame rect) in a building's roof: its collision is removed there. null clears. */
  setRoofHole(id, rect) { if (rect) this.roofHoles.set(id, [rect]); else this.roofHoles.delete(id); }
  _inRects(list, bx, bz, pad = 0) { return !!list && list.some((q) => bx > q.x0 - pad && bx < q.x1 + pad && bz > q.z0 - pad && bz < q.z1 + pad); }
  _buildVisuals() {
    const scene = this.app.scene;
    const N = 48;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    this.arc = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x22d3ff, transparent: true, opacity: 0.9, toneMapped: false, fog: false }));
    this.arc.frustumCulled = false; this.arc.visible = false; this.arcN = N; scene.add(this.arc);
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x22d3ff, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false }));
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 3).rotateX(-Math.PI / 2), this.marker.material); arrow.position.set(0, 0.02, -0.36);
    this.marker.add(arrow); this.marker.visible = false; scene.add(this.marker);
    // anchor markers (small instanced glow diamonds), only reachable + visible ones
    const geo = new THREE.OctahedronGeometry(0.42, 0);
    this.anchorMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0x7ef0ff, transparent: true, opacity: 0.75, toneMapped: false, fog: false, depthWrite: false }), MARKERS);
    this.anchorMesh.count = 0; this.anchorMesh.frustumCulled = false; this.anchorMesh.renderOrder = 30;
    this.anchorMesh.visible = false; scene.add(this.anchorMesh);
    // per-hand target hint (right: white, left: lilac)
    this.anchorHint = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.22, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false, fog: false }));
    this.anchorHint.renderOrder = 36; this.anchorHint.visible = false; scene.add(this.anchorHint);
    this.anchorHintL = this.anchorHint.clone(); this.anchorHintL.material = this.anchorHint.material.clone(); this.anchorHintL.material.color.set(0xd7c2ff); scene.add(this.anchorHintL);
    // comfort vignette (camera-attached)
    const vg = new THREE.SphereGeometry(0.3, 24, 12);
    this.vigMat = new THREE.ShaderMaterial({
      uniforms: { strength: { value: 0 } }, transparent: true, depthTest: false, depthWrite: false, side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform float strength; varying vec3 vP; void main(){ float c = clamp(-vP.z, 0.0, 1.0); float a = smoothstep(0.92, 0.55, c) * strength; gl_FragColor = vec4(0.0, 0.02, 0.06, a); }',
    });
    this.vignette = new THREE.Mesh(vg, this.vigMat); this.vignette.renderOrder = 100; this.vignette.frustumCulled = false; this.vignette.visible = false;
    this.app.camera.add(this.vignette);
    // back-pack thruster flames (seen below / behind when looking down): rig-attached, fade in with the assist
    const flameMat = new THREE.MeshBasicMaterial({ color: 0x7ad8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
    const flameGeo = new THREE.ConeGeometry(0.07, 0.55, 10, 1, true).translate(0, -0.275, 0);
    this.thrusters = new THREE.Group(); this.thrusters.name = 'Thrusters'; this.thrusterMat = flameMat;
    for (const sx of [-1, 1]) { const f = new THREE.Mesh(flameGeo, flameMat); f.position.set(sx * 0.15, 1.05, 0.26); this.thrusters.add(f); }
    this.thrusters.visible = false;
    this.app.world.player.add(this.thrusters);
  }

  // ------------------------------------------------------------ rig helpers
  get rig() { return this.app.world.player; }
  feet(out = new THREE.Vector3()) { const cam = this.app.camera; cam.getWorldPosition(out); out.y = this.rig.position.y; return out; }
  /** Put the user's current head xz over `pos` (feet), facing yaw (rad, 0 = north). */
  placeAt(pos, yaw = null) {
    const rig = this.rig, cam = this.app.camera;
    if (yaw !== null) rig.rotation.set(0, yaw, 0);
    rig.updateMatrixWorld(true);
    const headLocal = _v.copy(cam.position); headLocal.y = 0;
    headLocal.applyQuaternion(rig.quaternion);
    rig.position.set(pos.x - headLocal.x, pos.y + (settings.seated ? settings.seatedOffset : 0), pos.z - headLocal.z);
    rig.updateMatrixWorld(true);
    this.vel.set(0, 0, 0); this.grounded = true; this.cling = null; this.wallRun = null; this.safePoint.copy(pos); this._out = 0; this._airT = 0;
    this._pullReset(); // (a placement — checkpoint, teleport, scene change — never carries a pull over)
  }
  snapTurn(dir) {
    const rig = this.rig, cam = this.app.camera;
    const head = cam.getWorldPosition(_v).clone();
    const ang = -dir * THREE.MathUtils.degToRad(settings.snapAngle);
    _q.setFromAxisAngle(UP, ang);
    rig.position.sub(head).applyQuaternion(_q).add(head);
    rig.rotation.y += ang;
    rig.updateMatrixWorld(true);
    audio.play('turn');
  }
  /** Origin rebase: shift every world-space thing this module owns. */
  shift(dx, dz) {
    const rig = this.rig; rig.position.x += dx; rig.position.z += dz; rig.updateMatrixWorld(true);
    this.safePoint.x += dx; this.safePoint.z += dz;
    if (this.zip) { this.zip.from.x += dx; this.zip.from.z += dz; this.zip.to.x += dx; this.zip.to.z += dz; }
    for (const s of this.surfaces) if (!s.obb && s.x0 !== undefined) { s.x0 += dx; s.x1 += dx; s.z0 += dz; s.z1 += dz; for (const b of s.blockers) { b.x0 += dx; b.x1 += dx; b.z0 += dz; b.z1 += dz; } }
    if (this.cling?.grab) for (const h of ['left', 'right']) if (this.cling.grab[h]) { this.cling.grab[h].x += dx; this.cling.grab[h].z += dz; }
    if (this._mk) this._mk.next = 0;
  }

  setRoomMode() {
    this.scripted = false;
    const o = ROOM.origin;
    const pad = 0.22;
    this.mode = 'room';
    this.surfaces = [{
      y: o[1], x0: o[0] - 2.5 + pad, x1: o[0] + 2.5 - pad, z0: o[2] - 3 + 0.35, z1: o[2] + 3 - pad,
      blockers: ROOM_BLOCKERS.map((b) => ({ x0: o[0] + b.x - b.w / 2 - pad, x1: o[0] + b.x + b.w / 2 + pad, z0: o[2] + b.z - b.d / 2 - pad, z1: o[2] + b.z + b.d / 2 + pad })),
      bounds: { x0: o[0] - 2.5, x1: o[0] + 2.5, z0: o[2] - 3, z1: o[2] + 3, y1: o[1] + 2.8 },
    }];
    this.anchorMesh.visible = false;
  }
  /** Separate interior scene (factory): teleport + snap turn on one floor, no swinging, no city collision. */
  setInteriorMode(surface, origin, height) {
    this.scripted = false;
    const [ox, oy, oz] = origin;
    this.detach(true);
    this.mode = 'room';
    this.surfaces = [{
      y: oy, x0: ox + surface.x0, x1: ox + surface.x1, z0: oz + surface.z0, z1: oz + surface.z1,
      blockers: surface.blockers.map((b) => ({ x0: ox + b.x0, x1: ox + b.x1, z0: oz + b.z0, z1: oz + b.z1 })),
      bounds: { x0: ox + surface.x0 - 0.4, x1: ox + surface.x1 + 0.4, z0: oz + surface.z0 - 0.4, z1: oz + surface.z1 + 0.4, y1: oy + height },
    }];
    this.vel.set(0, 0, 0); this.grounded = true; this.cling = null; this.wallRun = null;
    this.anchorMesh.visible = false; this.markerAnchors = [];
  }
  setCityMode(surfaces) { this.scripted = false; this.mode = 'city'; this.surfaces = surfaces || []; this.anchorMesh.visible = true; this._out = 0; }
  /**
   * v0.41 World Chase end of run: hold the rig exactly where it is (also mid-air / mid-swing / over a hazard).
   * Webs released silently (no release boost), velocity / wall run / cling cleared; update() then does nothing that
   * moves the rig — no gravity, swing forces, thrusters, collisions, bounds recovery, fall callbacks, snap turns or
   * teleports — and hides the aim visuals. The headset pose is untouched (only the rig is held). unfreeze() / off().
   */
  freeze() { this.detach(true); this.vel.set(0, 0, 0); this.cling = null; this.wallRun = null; this._out = 0; this.frozen = true; this._hideAim(); this._pullReset(); }
  unfreeze() { this.frozen = false; this.vel.set(0, 0, 0); this._out = 0; this._airT = 0; this._pullReset(); }
  _hideAim() { this.arc.visible = false; this.marker.visible = false; this.anchorHint.visible = false; this.anchorHintL.visible = false; this.vignette.visible = false; this.thrusters.visible = false; this.vigMat.uniforms.strength.value = 0; this.anchorMesh.count = 0; }
  off() { this.frozen = false; this.mode = 'off'; this._pullReset(); this.detach(true); this.arc.visible = false; this.marker.visible = false; this.anchorMesh.visible = false; this.anchorHint.visible = false; this.anchorHintL.visible = false; this.vignette.visible = false; this.thrusters.visible = false; }

  // ------------------------------------------------------------ teleport
  _validLanding(p) {
    for (const s of this.surfaces) {
      if (Math.abs(p.y - s.y) > 0.05) continue;
      if (s.obb) {
        const [bx, bz] = worldToBox(s.obb, p.x, p.z); if (Math.abs(bx) > s.obb.hw - s.inset || Math.abs(bz) > s.obb.hd - s.inset) continue;
        if (this._inRects(this.roofBlockers.get(s.obb.id), bx, bz, 0.3) || this._inRects(this.roofHoles.get(s.obb.id), bx, bz, 0.3)) return false;
        return true;
      }
      if (s.street) { if (this.world.pointBlocked(p.x, 0.5, p.z, 0.4)) return false; if (Math.hypot(p.x - s.cx, p.z - s.cz) > s.r) continue; return true; }
      if (p.x < s.x0 || p.x > s.x1 || p.z < s.z0 || p.z > s.z1) continue;
      if (s.blockers.some((b) => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1)) return false;
      return true;
    }
    return false;
  }
  _arc(origin, dir) {
    const pos = this.arc.geometry.attributes.position;
    const v = dir.clone().multiplyScalar(7.5), p = origin.clone(), dt = 0.03;
    let hit = null, n = 0;
    const bounds = this.surfaces[0]?.bounds;
    for (; n < this.arcN; n++) {
      pos.setXYZ(n, p.x, p.y, p.z);
      const next = p.clone().addScaledVector(v, dt); v.y -= 9.8 * dt;
      if (bounds && (next.x < bounds.x0 || next.x > bounds.x1 || next.z < bounds.z0 || next.z > bounds.z1 || next.y > bounds.y1)) { n++; break; }
      for (const s of this.surfaces) {
        if (p.y >= s.y && next.y < s.y) { const k = (p.y - s.y) / (p.y - next.y); hit = p.clone().lerp(next, k); hit.y = s.y; break; }
      }
      if (hit) { n++; pos.setXYZ(n, hit.x, hit.y, hit.z); n++; break; }
      p.copy(next);
    }
    for (let i = n; i < this.arcN; i++) pos.setXYZ(i, p.x, p.y, p.z);
    pos.needsUpdate = true;
    return hit && this._validLanding(hit) ? hit : (hit ? { invalid: hit } : null);
  }

  // ------------------------------------------------------------ anchors
  /** Anchor candidates in reach: distance + elevation limits, independent angular assist (not the bomb margin). */
  /** Newest web (compat: most code only needs "am I on a web"). */
  get attach() { return this.ropes.length ? this.ropes[this.ropes.length - 1] : null; }
  ropeOf(h) { return this.ropes.find((r) => r.hand === h) || null; }
  holds(anchor) { return this.ropes.some((r) => r.anchor === anchor); }
  _syncAttached() { this.world.setAttached(this.ropes.map((r) => r.anchor)); }
  anchorCandidates(origin, exclude = null) {
    const out = [], maxD = settings.anchorMaxDist, minD = settings.anchorMinDist, minEl = Math.sin(THREE.MathUtils.degToRad(settings.anchorMinElevDeg));
    for (const a of this.world.anchorsNear(origin.x, origin.z, maxD, _near)) {
      if (a === exclude || (Array.isArray(exclude) && exclude.includes(a))) continue;
      const d = a.p.distanceTo(origin);
      if (d > maxD || d < minD) continue;
      if ((a.p.y - origin.y) / d < minEl) continue; // far below the hand: no useful swing
      const s = angularZoneSize(d, settings.anchorAssistDeg, settings.anchorAssistMargin);
      out.push({ pos: a.p, w: s, h: s, anchor: a });
    }
    return out;
  }
  /** @param ownBuilding id of the anchor's building: grazing hits on it near the anchor are ignored */
  occluded(origin, target, ownBuilding) {
    return this.world.segmentBlocked(origin.x, origin.y, origin.z, target.x, target.y, target.z, ownBuilding || null);
  }
  /**
   * Glow markers for anchors in reach AND visible (restrained: small, fade in / out). The candidate list
   * refreshes every 0.25 s, visibility is re-tested for 32 anchors per frame (round robin).
   */
  _refreshMarkers(t) {
    const chest = this.feet(_v).add(_w.set(0, CHEST, 0));
    const st = this._mk || (this._mk = { list: [], idx: 0, state: new Map(), next: 0, m: new THREE.Matrix4(), s: new THREE.Vector3(), q: new THREE.Quaternion() });
    if (t >= st.next) {
      st.next = t + 0.25;
      const list = [];
      for (const a of this.world.anchorsNear(chest.x, chest.z, settings.anchorMaxDist + 2, _near)) { const d = a.p.distanceTo(chest); if (d < settings.anchorMaxDist && d > 2) list.push([d, a]); }
      list.sort((x, y) => x[0] - y[0]); st.list = list.slice(0, MARKERS * 2).map((x) => x[1]);
      const keep = new Set(st.list); for (const [a, v] of st.state) if (!keep.has(a) || !a.valid) { v.on = false; v.seen = 0; }
    }
    const L = st.list;
    for (let k = 0; k < Math.min(32, L.length); k++) {
      const a = L[st.idx++ % L.length];
      if (!a.valid) continue;
      const v = st.state.get(a) || { on: false, seen: 0, miss: 0, k: 0 };
      if (!this.occluded(chest, a.p, a.building)) { v.seen++; v.miss = 0; if (v.seen >= 2) v.on = true; } else { v.miss++; v.seen = 0; if (v.miss >= 2) v.on = false; }
      st.state.set(a, v);
    }
    const dt = Math.min(0.05, t - (st.t || t)); st.t = t;
    let n = 0; this.markerAnchors = [];
    for (const [a, v] of st.state) {
      if (!a.valid) v.on = false;
      v.k = THREE.MathUtils.clamp(v.k + (v.on ? dt : -dt) / 0.25, 0, 1);
      if (v.k <= 0) { if (!v.on && !v.seen) st.state.delete(a); continue; }
      if (n >= MARKERS) continue;
      const e = v.k * v.k * (3 - 2 * v.k) * Math.min(1.6, Math.max(0.7, a.p.distanceTo(chest) / 30));
      st.m.compose(a.p, st.q, st.s.setScalar(e)); this.anchorMesh.setMatrixAt(n++, st.m);
      if (v.on) this.markerAnchors.push(a);
    }
    this.anchorMesh.count = n; this.anchorMesh.instanceMatrix.needsUpdate = true;
  }
  pickAnchor(origin, dir, exclude = null) {
    return pickTarget(origin, dir, this.anchorCandidates(origin, exclude), { margin: settings.anchorAssistMargin, maxDist: settings.anchorMaxDist, occludedCandidate: true, occluded: (o, p, c) => this.occluded(o, p, c?.anchor?.building) });
  }
  tryAttach(e) {
    const other = this.ropeOf(e.hand === 'left' ? 'right' : 'left')?.anchor || null; // the other hand's web: never grab the same anchor
    const pick = this.pickAnchor(e.origin, e.dir, other);
    let a = pick?.target.anchor;
    // sticky lock: forming the web pose rotates the hand, so the aim at the moment of
    // firing drifts. If this hand showed an anchor hint in the last 0.35 s, use it.
    const hint = this.lastHint?.[e.hand];
    if (!a && hint && hint.anchor.valid && hint.anchor !== other && performance.now() / 1000 - hint.t < 0.35 && hint.anchor.p.distanceTo(e.origin) < settings.anchorMaxDist && !this.occluded(e.origin, hint.anchor.p, hint.anchor.building)) a = hint.anchor;
    if (a && this.mode === 'city') { const chest = this.feet(_v).add(_w.set(0, CHEST, 0)); if (!this.app.story?.inRoom && this.occluded(chest, a.p, a.building)) a = null; } // the rope itself must be clear
    if (!a || !a.valid) return null;
    const chest = this.feet(_v).add(_w.set(0, CHEST, 0));
    const dist = chest.distanceTo(a.p), T = swingTuning();
    if (dist > T.rope + 1) return null; // beyond the web's length
    return this._attachAnchor(a, e, dist);
  }
  /**
   * Attach to a given anchor without picking (v0.21: the Green Bat Jet's moving hook). `a.p` may move every
   * frame; the rope follows it. a = { id, p, valid, moving: true, building: null, cell: null }.
   */
  attachTo(a, e) {
    if (!a || !a.valid || this.mode !== 'city') return null;
    const chest = this.feet(_v).add(_w.set(0, CHEST, 0));
    return this._attachAnchor(a, e, chest.distanceTo(a.p));
  }
  _attachAnchor(a, e, dist) {
    const T = swingTuning();
    this.detachHand(e.hand, true); // this hand's previous web (the other hand keeps holding its own)
    const len = Math.max(4, Math.min(T.rope, dist * 0.97));
    const fx = this.app.fx;
    const hub = this.app.hub, h = e.hand;
    const beam = fx.web(e.origin, a.p, { hold: true, follow: (out) => { if (hub.aim[h].valid) hub.aimOriginNow(h, out); } }); // re-evaluated after the rig moves → stays on the wrist
    this.ropes.push({ anchor: a, hand: h, len, beam, lastHeld: performance.now() / 1000, blocked: 0 });
    this._syncAttached();
    this._ropeBlocked = 0;
    if (this.cling) this.vel.addScaledVector(this.cling.normal, 2.5); // push off the wall
    if (this.wallRun) { this.vel.addScaledVector(this.wallRun.normal, 2.0); this.wallRun = null; } // swing on from a wall run
    this.cling = null; this.clingBlockUntil = performance.now() / 1000 + 0.45;
    this.grounded = false; this._airT = 0;
    this.stats.swings++;
    audio.play('attach', 0, e.origin); // v0.45: positional at the hand (World Chase listener)
    this.onAttach?.(a);
    return a;
  }
  /** Let go of the web. Momentum is kept (+ a small release boost when swinging forward / upward). */
  detach(silent) {
    if (!this.ropes.length) return;
    for (const r of this.ropes) this.app.fx.releaseBeam(r.beam);
    this.ropes = []; this._syncAttached();
    this._releaseFx(silent);
  }
  /** Let go of one hand's web only. The release boost / sound only when it was the last web. */
  detachHand(h, silent) {
    const r = this.ropeOf(h); if (!r) return;
    this.app.fx.releaseBeam(r.beam);
    this.ropes = this.ropes.filter((x) => x !== r); this._syncAttached();
    const hb = this.app.hub, hp = hb?.aim?.[h]?.valid ? (hb.aimOriginNow(h, _hp), _hp) : null; // v0.45: the let-go hand's point (positional sound)
    if (!this.ropes.length) this._releaseFx(silent, hp); else if (!silent) audio.play('release', 0, hp); // v0.45: 'release' (no sample → v0.44 'web')
  }
  /** Release every web holding a given anchor (e.g. the jet hook). */
  detachAnchor(a, silent = true) { for (const r of this.ropes.filter((x) => x.anchor === a)) this.detachHand(r.hand, silent); }
  _releaseFx(silent, hp = null) {
    if (!silent) {
      audio.play('release', 0, hp); // v0.45: the designed let-go sample in World Chase; elsewhere / without it the v0.44 'web'
      const T = swingTuning(), sp = this.vel.length();
      this.onRelease?.(sp); // v0.45: release speed (before the boost) → World Chase Flow
      if (T.releaseBoost > 0 && sp > 6 && this.vel.y > -2) { this.vel.addScaledVector(_v.copy(this.vel).normalize(), T.releaseBoost); this.vel.y += T.releaseBoost * 0.6; }
      this.stats.releases++;
    }
  }

  // ------------------------------------------------------------ v0.44 web pull
  /** Nothing of a pull survives: strokes, queued impulse, over-limit, surge (freeze / placement / mode change). */
  _pullReset() {
    const S = this.pull; if (!S) return;
    S.left.reset(); S.right.reset(); S.pending.left = S.pending.right = 0; S.budget = PULL.budgetMax; S.over = 0; S.surge = 0; S.bodyOk = false;
    const hub = this.app.hub; if (hub?.pullBusy) hub.pullBusy.left = hub.pullBusy.right = false;
    for (const r of this.ropes) r.pullV = 0;
  }
  /** Decay of the over-limit allowance / surge / budget refill — every swing frame (also in free flight, so the momentum of a pull carries into the next swing). */
  _pullDecay(dt) {
    const S = this.pull, P = PULL;
    S.budget = Math.min(P.budgetMax, S.budget + P.budgetRefill * dt);
    if (S.over > 0) S.over = Math.max(0, S.over - P.overDecay * dt);
    if (S.surge > 0) { S.surge *= Math.exp(-dt / P.surgeTau); if (S.surge < 0.05) S.surge = 0; }
  }
  /**
   * Manual web pull while attached (called from the swing integration, before the rope constraints):
   * each hand holding the web pose on a web that is attached to a FIXED ENVIRONMENTAL anchor can be pulled back toward
   * the body → a smooth acceleration toward THAT anchor (existing momentum kept) + a limited, rate-capped rope take-in.
   * Stroke detection is player-local (hub.handLocal vs a smoothed chest point under the head): rig motion, snap turns,
   * origin rebasing and tracking-space jumps cannot create a pull. Both hands share one strength budget.
   * Never for the jet hook / moving targets, never while a menu is open; scripted motion and freezes never get here.
   */
  _updatePull(dt, t, hub, body) {
    const S = this.pull, P = PULL, comfort = !!settings.comfortMode;
    const allow = settings.webPull !== false && !hub.ctx?.menuOpen && !this.zip && !!hub.handLocal;
    if (allow) { // chest point in player-local space (smoothed: a nod or a head bob is not a stroke)
      const cam = this.app.camera.position;
      _pb.set(cam.x, cam.y - P.chestDrop, cam.z);
      if (!S.bodyOk) { S.body.copy(_pb); S.bodyOk = true; } else S.body.lerp(_pb, 1 - Math.exp(-dt / P.bodySmooth));
    } else S.bodyOk = false;
    const both = isEnvAnchor(this.ropeOf('left')?.anchor) && isEnvAnchor(this.ropeOf('right')?.anchor);
    for (const h of HANDS) {
      const r = this.ropeOf(h), det = S[h], hl = hub.handLocal?.[h];
      const env = !!r && isEnvAnchor(r.anchor);
      _pullIn.t = t; _pullIn.dt = dt; _pullIn.held = allow && env && !!hub.webHeld[h];
      _pullIn.tracked = !!hl?.valid && !hub.trackingLost?.[h]; _pullIn.hand = hl?.pos || null; _pullIn.body = S.body;
      const df = det.update(_pullIn);
      if (hub.pullBusy) hub.pullBusy[h] = det.busy(t);
      if (!env || !allow) { S.pending[h] = 0; if (r) r.pullV = 0; continue; }
      if (det.justStarted) { // one restrained cue per stroke: the strand tightens (sound + a brief brightening + controller haptic)
        this.stats.pulls++; S.lastT = t;
        audio.play('pull'); if (r.beam) r.beam.pulse = 1; hub.haptic?.(h, 0.35, 40);
        this.onPull?.(h, r.anchor);
      }
      S.pending[h] += df;
      if (S.pending[h] <= 1e-5) { S.pending[h] = 0; }
      else {
        let use = S.pending[h] * Math.min(1, dt / P.smooth); // low-pass: an acceleration, never a step
        S.pending[h] -= use;
        if (both && S.pending[h === 'left' ? 'right' : 'left'] > 1e-5) use *= P.bothScale; // both hands hauling at once: capped combined strength
        if (use > S.budget) use = S.budget; // one budget for both hands
        S.budget -= use;
        _pd.copy(r.anchor.p).sub(body); const dist = _pd.length();
        if (use > 0 && dist > 1e-3) {
          const near = THREE.MathUtils.smoothstep(dist, settings.swingMinRope + P.nearFade[0], settings.swingMinRope + P.nearFade[1]); // fades out close to the anchor
          const dv = use * P.boost * (comfort ? P.comfortScale : 1) * near;
          this.vel.addScaledVector(_pd, dv / dist); // toward this hand's anchor: forward, sideways (redirect) or backward (brake) — never a generic forward boost
          if (!comfort) S.over = Math.min(P.overMax, S.over + dv * P.overShare);
          S.surge += dv; this.stats.pullDv += dv;
          r.pullV = Math.min(P.boost * P.budgetMax, (r.pullV || 0) + dv); // held by the rope for a moment (see PULL.hold)
        }
      }
      if (r.pullV > 0) { // limited rope take-in at the pulled speed (the body moves in with its own velocity — no snap toward the anchor)
        const step = r.pullV * dt;
        const R2 = this.ropes, span = R2.length > 1 ? R2[0].anchor.p.distanceTo(R2[1].anchor.p) + 1 : 0;
        if (R2.length < 2 || R2[0].len + R2[1].len - step > span) r.len = Math.max(settings.swingMinRope, r.len - step); // two webs must still span the gap between their anchors
        r.pullV *= Math.exp(-dt / P.hold); if (r.pullV < 0.05 || r.len <= settings.swingMinRope) r.pullV = 0;
      }
    }
  }

  // ------------------------------------------------------------ frame
  update(dt, t) {
    dt = Math.min(dt, 1 / 30);
    const hub = this.app.hub;
    this.arc.visible = false; this.marker.visible = false; this.anchorHint.visible = false; this.anchorHintL.visible = false;
    if (this.mode === 'off') { this.vignette.visible = false; this.thrusters.visible = false; return; }
    if (this.frozen) { this._hideAim(); return; } // v0.41: run resolved — the rig stays put
    if (this.scripted) {
      this._pullReset(); // v0.44: scripted motion (web dash, kick landing) owns the rig — no pull carries in or out // v0.21 story web dash / kick landing: the story moves the rig; only the comfort vignette runs here
      const V = swingTuning().vignette, sp = this.vel.length();
      const target = V ? THREE.MathUtils.clamp((sp - 2) / 8, 0, 0.85) * V : 0;
      this.vigMat.uniforms.strength.value += (target - this.vigMat.uniforms.strength.value) * Math.min(1, dt * 6);
      this.vignette.visible = this.vigMat.uniforms.strength.value > 0.01; this.thrusters.visible = false;
      return;
    }
    for (const e of hub.events) if (e.type === 'turn' && !hub.ctx.menuOpen) this.snapTurn(e.dir);
    const T = hub.teleport;
    if (this.grounded && !this.attach && this.surfaces.length) {
      const ptr = hub.pointers[T.hand];
      if ((T.aiming || T.commit) && ptr.valid) {
        const origin = ptr.origin, dir = ptr.dir.clone();
        if (dir.y < -0.2 && this.mode === 'room') dir.y = -0.2;
        const res = this._arc(origin, dir.normalize());
        const ok = res && !res.invalid;
        this.arc.visible = T.aiming; this.arc.material.color.set(ok ? 0x22d3ff : 0xff4d6d);
        const at = ok ? res : res?.invalid;
        if (at && T.aiming) {
          this.marker.visible = true; this.marker.position.copy(at); this.marker.material.color.set(ok ? 0x22d3ff : 0xff4d6d);
          this.marker.rotation.y = Math.atan2(-(at.x - origin.x), -(at.z - origin.z));
        }
        if (T.commit && ok) { const yaw = this.rig.rotation.y; this.placeAt(res, null); this.rig.rotation.y = yaw; audio.play('teleport'); }
      }
    }
    if (this.mode === 'city') this._updateSwing(dt, t, hub);
    const sp = this.vel.length();
    this.stats.maxSpeed = Math.max(this.stats.maxSpeed, sp);
    const V = swingTuning().vignette;
    const target = V && this.mode === 'city' ? THREE.MathUtils.clamp((sp - 2) / 8, 0, 0.85) * V : 0;
    this.vigMat.uniforms.strength.value += (target - this.vigMat.uniforms.strength.value) * Math.min(1, dt * 6);
    this.vignette.visible = this.vigMat.uniforms.strength.value > 0.01;
  }

  _updateSwing(dt, t, hub) {
    this._refreshMarkers(t);
    const Tn = swingTuning();
    // per-hand aim hint (also feeds the sticky lock used by tryAttach). Each hand keeps its own target;
    // the hand holding a web shows none, and the other hand never targets that same anchor.
    this.lastHint = this.lastHint || { left: null, right: null };
    for (const h of ['left', 'right']) {
      const hintMesh = h === 'right' ? this.anchorHint : this.anchorHintL;
      hintMesh.visible = false;
      const a = hub.aim[h];
      if (!a.valid || hub.ctx.menuOpen) continue;
      if (this.ropeOf(h)) continue;
      const near = hub.mode[h] !== 'hand' || hub.machines[h].web.conf > 0.08;
      if (!near) continue;
      const exclude = this.ropes.length ? this.ropes.map((r) => r.anchor) : null;
      let pick = this.pickAnchor(a.origin, a.dir, exclude);
      const last = this.lastHint[h], nowS = performance.now() / 1000;
      if (last && last.anchor.valid && !exclude?.includes(last.anchor) && nowS - last.t < 0.15 && (!pick || (pick.target.anchor !== last.anchor && pick.score > (last.score ?? 1) - 0.2))) {
        const d = last.anchor.p.distanceTo(a.origin);
        if (d < settings.anchorMaxDist) pick = { target: { anchor: last.anchor, pos: last.anchor.p }, dist: d, score: last.score, held: true };
      }
      if (pick) {
        if (!pick.held) this.lastHint[h] = { anchor: pick.target.anchor, t: nowS, score: pick.score };
        hintMesh.visible = true; hintMesh.position.copy(pick.target.pos);
        hintMesh.lookAt(this.app.camera.getWorldPosition(_v));
        hintMesh.scale.setScalar(pick.dist * 0.03 * (1 + Math.sin(t * 5) * 0.05));
      }
    }
    // release when the web pose / trigger is let go (150 ms grace; 500 ms on tracking loss)
    // (each hand's web separately: two webs can hold at once)
    for (const r of [...this.ropes]) {
      const h = r.hand;
      if (hub.webHeld[h]) r.lastHeld = t;
      const grace = hub.trackingLost[h] ? WEB_HOLD_GRACE.lost : WEB_HOLD_GRACE.held;
      if (t - r.lastHeld > grace) { this.detachHand(h); continue; }
      // the anchor's module was recycled / invalidated (never expected while attached): safe release
      if (!r.anchor.valid) { this.detachHand(h, true); audio.play('fizzle'); if (!this.ropes.length) this.onAnchorLost?.(); continue; }
      // the web must never pass through a building: if one comes between body and anchor, release safely
      if (!this.zip && !this.app.story?.inRoom) {
        const chest = this.feet(_v).add(_w.set(0, CHEST, 0));
        if (this.occluded(chest, r.anchor.p, r.anchor.building)) { if (++r.blocked >= 2) { this.detachHand(h, true); audio.play('fizzle'); this.onWebBlocked?.(); } }
        else r.blocked = 0;
      }
    }
    this._pullDecay(dt);
    if (!this.attach && (this.pull.left.state !== 'idle' || this.pull.right.state !== 'idle' || this.pull.pending.left || this.pull.pending.right)) { // no web: no stroke, nothing queued (the over-limit / surge just decay)
      this.pull.left.reset(); this.pull.right.reset(); this.pull.pending.left = this.pull.pending.right = 0;
      if (hub.pullBusy) hub.pullBusy.left = hub.pullBusy.right = false;
    }
    if (this.grounded && !this.attach) { this._airT = 0; this.vel.set(0, 0, 0); this.pull.over = 0; this._checkSupport(); this._thrusterFx(dt, 0); this._bounds(dt); return; }
    if (this.cling && !this.attach) { this._airT = 0; this.vel.set(0, 0, 0); this.pull.over = 0; this._climb(hub); this._thrusterFx(dt, 0); return; }
    if (this.wallRun && !this.attach && !this.zip) { this._airT = 0; this._wallRunStep(dt); this._thrusterFx(dt, 0); this._bounds(dt); return; }

    const rig = this.rig;
    if (this.zip) {
      const z = this.zip; z.t += dt; const k = Math.min(1, z.t / z.dur), e = k * k * (3 - 2 * k);
      const feetNow = this.feet(_f);
      const want = _b.copy(z.from).lerp(z.to, e);
      rig.position.add(want.sub(feetNow)); rig.updateMatrixWorld(true);
      if (k >= 1) {
        this.vel.copy(z.to).sub(z.from).multiplyScalar(0.9 / z.dur);
        for (const r of this.ropes) r.len = Math.max(4, this.feet(_f).add(_w.set(0, CHEST, 0)).distanceTo(r.anchor.p) * 0.98);
        this.zip = null;
      }
      return;
    }
    // ---------------- integrate
    const feet = this.feet(_f);
    const body = _b.copy(feet).add(_w.set(0, CHEST, 0));
    const g = 9.8 * (this.attach ? 1.0 : 0.85);
    this.vel.y -= g * dt;
    this.vel.multiplyScalar(Math.max(0, 1 - Tn.drag * dt)); // air drag (decay)
    let thrust = 0;
    if (this.attach) {
      this._updatePull(dt, t, hub, body); // v0.44: manual pull (adds to the velocity + takes in a little rope) — the constraints below still hold
      { const red = settings.swingReelSpeed * dt, R2 = this.ropes;
        // two webs: never reel them so short that together they can't span the gap between the anchors
        const span = R2.length > 1 ? R2[0].anchor.p.distanceTo(R2[1].anchor.p) + 1 : 0;
        if (R2.length < 2 || R2[0].len + R2[1].len - 2 * red > span) for (const r of R2) if (r.len > settings.swingMinRope) r.len = Math.max(settings.swingMinRope, r.len - red); }
      // steering pushes perpendicular to the newest web; two webs = the body hangs from both (a V) — the
      // pull points between the anchors so the swing feels stronger and steadier
      const a = this.ropes.length > 1 ? _p2.copy(this.ropes[0].anchor.p).add(this.ropes[1].anchor.p).multiplyScalar(0.5) : this.attach.anchor.p;
      const n = _n.copy(body).sub(a); const dist = n.length(); n.divideScalar(dist || 1);
      if (settings.swingSteer) {
        const look = this.lookDir(_t);
        this._steer(look, Tn.steer, dt);
        const push = _v.copy(look).addScaledVector(n, -look.dot(n));
        if (push.lengthSq() > 1e-4) this.vel.addScaledVector(push.normalize(), Tn.accel * 1.3 * dt);
      } else {
        const tan = _v.copy(this.vel).addScaledVector(n, -this.vel.dot(n));
        if (tan.lengthSq() > 0.01) this.vel.addScaledVector(tan.normalize(), Tn.accel * dt);
      }
      const next = _t.copy(body).addScaledVector(this.vel, dt);
      for (let it = 0; it < (this.ropes.length > 1 ? 4 : 1); it++) for (const r of this.ropes) { // rope-length constraints (inelastic): remove the outward radial velocity
        const ap = r.anchor.p;
        _d.copy(next).sub(ap); const nl = _d.length();
        if (nl > r.len) {
          _d.multiplyScalar(r.len / nl);
          const nn = _c.copy(_d).normalize(); const radial = this.vel.dot(nn);
          const keep = -(r.pullV || 0); // v0.44: a taut rope keeps a pull's inward speed alive for a moment (0 = the plain inelastic rope)
          if (radial > keep) this.vel.addScaledVector(nn, keep - radial);
          next.copy(ap).add(_d);
        }
      }
      this._limit();
      _v.copy(next).sub(body);
    } else {
      if (settings.swingSteer) this._steer(this.lookDir(_t), Tn.steer * 0.4, dt); // light air control
      // back-pack thrusters: cap the fall speed (assist + visual feedback, never a replacement for swinging)
      if (this.vel.y < -Tn.thrusterFall) { thrust = Math.min(1, (-Tn.thrusterFall - this.vel.y) / 4 + 0.4); this.vel.y += Math.min(-Tn.thrusterFall - this.vel.y, 14 * dt); }
      this._limit();
      _v.copy(this.vel).multiplyScalar(dt);
    }
    this._thrusterFx(dt, thrust);
    // move in ≤ 0.3 m sub-steps so fast swings can't tunnel through thin geometry
    const nSub = Math.max(1, Math.ceil(_v.length() / 0.3)); const stepV = _w.copy(_v).divideScalar(nSub);
    for (let k = 0; k < nSub; k++) {
      rig.position.add(stepV); rig.updateMatrixWorld(true);
      const wasFree = !this.cling && !this.grounded;
      this._collide();
      if (wasFree && (this.cling || this.grounded)) break;
    }
    // v0.22c: no fall penalty — only a CONTINUOUS fall with no anchor grabbed (no web, no wall, no roof / street)
    // for settings.fallRecoverSec (10 s) returns to the last checkpoint
    this._airT = this.attach || this.grounded || this.cling ? 0 : this._airT + dt;
    if (this._airT > (settings.fallRecoverSec || 10)) { this._airT = 0; this.detach(true); if (this.onFall?.() !== true) this.placeAt(this.safePoint); }
    this._bounds(dt);
  }
  /** Playable corridor (lateral range around the route, soft ceiling) → recovery after outGrace. */
  _bounds(dt) {
    const f = this.feet(_f), C = CITY_CFG.corridor;
    if (f.y + TOP > C.maxHeight) { this.rig.position.y -= f.y + TOP - C.maxHeight; if (this.vel.y > 0) this.vel.y = 0; this.rig.updateMatrixWorld(true); }
    if (this.world.customBounds) { if (this.world.cells.size) this.world.customBounds(this, f, dt); return; } // v0.40 World Chase: the world owns its corridor
    if (this.app.story?.inRoom || !this.world.cells.size) { this._out = 0; return; }
    if (this.app.story?.stage === 'endless') { this._freeBounds(f, dt); return; } // free swinging: no route corridor
    if (this.world.inCorridor(f.x, f.y, f.z)) { this._out = 0; return; }
    this._out += dt;
    if (this._out > C.outGrace) { this._out = 0; this.detach(true); if (this.onOutOfBounds?.() !== true && this.onFall?.() !== true) this.placeAt(this.safePoint); }
  }
  /**
   * Endless city (after the factory): swing anywhere that is built. Only at the edge of the streamed city
   * (no built block under the player) a soft push steers back toward the route — no teleport, no message.
   * Safety net: lost far outside the city for a long time → quiet recovery.
   */
  _freeBounds(f, dt) {
    const c = this.world.cellAt(f.x, f.z);
    if (c && c.ready) { this._out = 0; return; }
    this._out += dt;
    const pr = this.world.progress(f.x, f.z), p = this.world.pointAt(pr.s, _n);
    const dir = _t.set(p.x - f.x, 0, p.z - f.z); const d = dir.length(); if (d < 1e-3) return; dir.divideScalar(d);
    const outward = this.vel.x * -dir.x + this.vel.z * -dir.z;
    if (outward > 0) this.vel.addScaledVector(dir, outward * Math.min(1, dt * 6)); // bleed off the outward speed
    this.vel.addScaledVector(dir, 9 * dt); // gentle pull back toward the city
    if (this._out > 8) { this._out = 0; this.detach(true); if (this.onOutOfBounds?.() !== true) this.placeAt(this.safePoint); }
  }
  _thrusterFx(dt, thrust) {
    this._thrust += (thrust - this._thrust) * Math.min(1, dt * 8);
    const on = this._thrust > 0.03;
    this.thrusters.visible = on;
    this.app.fx.vfx?.thruster(this.thrusters, this._thrust, dt); // v0.30 vfx: flame shader + nozzle glow + exhaust puffs
    if (on) {
      this.thrusterMat.opacity = 0.35 + 0.5 * this._thrust * (0.85 + 0.15 * Math.sin(performance.now() / 37));
      for (const m of this.thrusters.children) m.scale.set(1, 0.6 + this._thrust * 0.9, 1);
      this.stats.thrustT += dt;
      if (thrust > 0.3 && (this._thrustSnd || 0) < performance.now()) { this._thrustSnd = performance.now() + 420; audio.play('thrust'); }
    }
  }
  /** Horizontal (yaw-only) direction the headset is looking at, world space. Never rotates the head. */
  lookDir(out = new THREE.Vector3()) {
    out.set(0, 0, -1).applyQuaternion(this.app.camera.getWorldQuaternion(_q)); out.y = 0;
    if (out.lengthSq() < 1e-6) out.set(0, 0, -1);
    return out.normalize();
  }
  /** Rotate the horizontal part of the velocity toward `look` by at most rateDeg·dt, keeping speed. */
  _steer(look, rateDeg, dt) {
    const hx = this.vel.x, hz = this.vel.z, sp = Math.hypot(hx, hz);
    if (sp < 0.8) return;
    const cur = Math.atan2(hx, hz), want = Math.atan2(look.x, look.z);
    let diff = want - cur; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
    if (Math.abs(diff) > THREE.MathUtils.degToRad(150)) return; // looking backwards: don't U-turn
    const step = THREE.MathUtils.degToRad(rateDeg) * dt;
    const a = cur + THREE.MathUtils.clamp(diff, -step, step);
    this.vel.x = Math.sin(a) * sp; this.vel.z = Math.cos(a) * sp;
  }
  _limit() {
    let max = swingTuning().maxSpeed + (this.pull?.over || 0); // v0.44: a pull may exceed the limit briefly (decays; 0 in comfort mode)
    const cap = this.world.speedCapAt(this.feet(_n)); // never fly into a module that is not built yet
    if (cap < max) max = cap;
    const sp = this.vel.length();
    if (sp > max) this.vel.multiplyScalar(max / sp);
  }
  _collide() {
    const f = this.feet(new THREE.Vector3()), r = R_BODY, rig = this.rig;
    for (const c of this.world.collidersNear(f.x, f.z, 4, _cols)) {
      if (this.ignoreColliders?.has(c.id)) continue;
      if (f.y > c.y1 + 0.02 || f.y + TOP < c.y0) continue;
      const [bx, bz] = worldToBox(c, f.x, f.z);
      if (Math.abs(bx) > c.hw + r || Math.abs(bz) > c.hd + r) continue;
      if (this._inRects(this.roofHoles.get(c.id), bx, bz, -r)) continue; // falling through a blown roof section
      const pens = [
        { ax: 'x', s: 1, d: c.hw + r - bx }, { ax: 'x', s: -1, d: bx + c.hw + r },
        { ax: 'z', s: 1, d: c.hd + r - bz }, { ax: 'z', s: -1, d: bz + c.hd + r },
        { ax: 'up', d: c.y1 - f.y },
      ];
      if (c.y0 > 0.5) pens.push({ ax: 'down', d: f.y + TOP - c.y0 }); // setback tiers: bump the underside
      const pen = pens.sort((a, b) => a.d - b.d)[0];
      if (pen.ax === 'up' || (this.vel.y < 0 && c.y1 - f.y < 0.6 && pen.ax !== 'down')) {
        rig.position.y += c.y1 - f.y; // land on the roof
        if (!this.attach) { this.grounded = true; this.wallRun = null; this.vel.set(0, 0, 0); this.safePoint.set(f.x, c.y1, f.z); this.onLand?.(c.id); this._landRoof(c); }
        else if (this.vel.y < 0) this.vel.y = 0;
      } else if (pen.ax === 'down') {
        rig.position.y -= pen.d; if (this.vel.y > 0) this.vel.y *= -0.1;
      } else {
        const nx = pen.ax === 'x' ? c.cos * pen.s : c.sin * pen.s, nz = pen.ax === 'x' ? -c.sin * pen.s : c.cos * pen.s;
        rig.position.x += nx * pen.d; rig.position.z += nz * pen.d;
        const vn = this.vel.x * nx + this.vel.z * nz;
        if (this.wallRun && this.wallRun.collider !== c) this.wallRun = null; // ran into another building: decide again
        if (settings.wallCling && !this.cling && !this.wallRun && !this.grounded && performance.now() / 1000 >= (this.clingBlockUntil || 0)) {
          const tAx = pen.ax === 'x' ? { x: c.sin, z: c.cos, coord: bz, half: c.hd } : { x: c.cos, z: -c.sin, coord: bx, half: c.hw };
          const run = this._wallRunDecision(c, nx, nz, tAx);
          this.detach(true);
          if (run) this._startWallRun(c, nx, nz, tAx, run);
          else {
            this.cling = { building: c.id, collider: c, normal: new THREE.Vector3(nx, 0, nz) };
            this.vel.set(0, 0, 0);
            this.safePoint.copy(this.feet(new THREE.Vector3()));
            audio.play('attach'); this.app.hub?.haptic?.('left', 0.6, 60); this.app.hub?.haptic?.('right', 0.6, 60);
            this.onCling?.(c.id);
          }
        } else {
          if (vn < 0) { this.vel.x -= nx * vn * 1.15; this.vel.z -= nz * vn * 1.15; }
          this.vel.multiplyScalar(0.9);
        }
      }
      rig.updateMatrixWorld(true);
    }
    // the street (ground level): land, then the story decides (recovery to a checkpoint)
    const f2 = this.feet(new THREE.Vector3());
    if (f2.y < 0) {
      rig.position.y -= f2.y; rig.updateMatrixWorld(true);
      if (!this.attach) {
        this.grounded = true; this.vel.set(0, 0, 0); this.cling = null; this.wallRun = null;
        this.surfaces = [{ y: 0, street: true, cx: f2.x, cz: f2.z, r: 40, blockers: [] }];
        audio.play('land'); this.onStreet?.();
      } else if (this.vel.y < 0) this.vel.y = 0;
    }
  }
  _landRoof(c) {
    const inset = 0.6;
    if (c.x0 !== undefined) this.surfaces = [{ y: c.y1, x0: c.x0 + inset, x1: c.x1 - inset, z0: c.z0 + inset, z1: c.z1 - inset, blockers: [] }];
    else this.surfaces = [{ y: c.y1, obb: c, inset, blockers: [] }];
  }
  _onSurface(f) {
    return this.surfaces.some((s) => {
      if (Math.abs(f.y - s.y) >= 0.1) return false;
      if (s.street) return true;
      if (s.obb) { const [bx, bz] = worldToBox(s.obb, f.x, f.z); return Math.abs(bx) <= s.obb.hw + 1 && Math.abs(bz) <= s.obb.hd + 1 && !this._inRects(this.roofHoles.get(s.obb.id), bx, bz); }
      return f.x >= s.x0 - 1 && f.x <= s.x1 + 1 && f.z >= s.z0 - 1 && f.z <= s.z1 + 1;
    });
  }
  _checkSupport() {
    const f = this.feet(new THREE.Vector3());
    if (f.y < 0.1) return; // on the street
    const on = this.world.collidersNear(f.x, f.z, 2, _cols).some((c) => !this.ignoreColliders?.has(c.id) && Math.abs(f.y - c.y1) < 0.1 && (() => { const [bx, bz] = worldToBox(c, f.x, f.z); return Math.abs(bx) <= c.hw && Math.abs(bz) <= c.hd && !this._inRects(this.roofHoles.get(c.id), bx, bz); })());
    if (!on && !this._onSurface(f) && this.mode === 'city') this.grounded = false;
  }
  /** True when the head faces the wall we're clinging to (within ±60°). */
  facingWall() {
    if (!this.cling) return false;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.app.camera.getWorldQuaternion(_q)); f.y = 0;
    if (f.lengthSq() < 1e-6) return false;
    return f.normalize().dot(this.cling.normal) < -0.5;
  }
  /**
   * Hand-over-hand climbing while clinging & facing the wall: a closed hand (fist / grip) near the wall
   * "grabs" it; moving that hand moves the body the opposite way. Reaching the roof edge mantles.
   */
  _climb(hub) {
    const c = this.cling;
    c.grab = c.grab || { left: null, right: null };
    if (!settings.wallClimb || !this.facingWall()) { c.grab.left = c.grab.right = null; this.climbing = false; return; }
    const rig = this.rig, n = c.normal;
    let moved = false;
    for (const h of ['left', 'right']) {
      const g = hub.grip[h];
      if (!g.valid || !g.closed) { c.grab[h] = null; continue; }
      const feet = this.feet(_w);
      const toWall = g.pos.clone().sub(feet).dot(n);
      if (!c.grab[h]) { if (Math.abs(toWall) < 0.9 || hub.mode[h] === 'desktop') { c.grab[h] = g.pos.clone(); this.lastGrabHand = h; this.app.hub?.haptic?.(h, 0.4, 25); } continue; }
      if (this.lastGrabHand !== h && c.grab[this.lastGrabHand]) continue;
      const delta = c.grab[h].clone().sub(g.pos);
      delta.addScaledVector(n, -delta.dot(n));
      if (delta.lengthSq() > 0.25) delta.setLength(0.5);
      rig.position.add(delta); rig.updateMatrixWorld(true);
      c.grab[h].copy(g.pos).add(delta);
      moved = true;
    }
    const d = hub.desk;
    if (d && hub.mode.right === 'desktop') { const dy = (d.keys.has('KeyW') ? 1 : 0) - (d.keys.has('KeyS') ? 1 : 0); if (dy) { rig.position.y += dy * 0.05; rig.updateMatrixWorld(true); moved = true; } }
    this.climbing = moved || !!(c.grab.left || c.grab.right);
    const col = c.collider || this.world.colliderOf(c.building);
    const feet = this.feet(new THREE.Vector3());
    if (col && feet.y + CHEST >= col.y1 + 0.1) this._mantle(col, n);
    if (feet.y < 1) { this.placeAt(new THREE.Vector3(feet.x, 0, feet.z).addScaledVector(n, 0.6)); this.onStreet?.(); }
  }
  /** Over the roof edge of `col` (wall normal n): step onto the roof, 1 m in from the edge. */
  _mantle(col, n) {
    const rig = this.rig, feet = this.feet(new THREE.Vector3());
    const top = feet.clone().addScaledVector(n, -1.0); top.y = col.y1;
    const [bx, bz] = worldToBox(col, top.x, top.z);
    const cx = THREE.MathUtils.clamp(bx, -col.hw + 0.6, col.hw - 0.6), cz = THREE.MathUtils.clamp(bz, -col.hd + 0.6, col.hd - 0.6);
    top.x = col.x + cx * col.cos + cz * col.sin; top.z = col.z - cx * col.sin + cz * col.cos;
    const yaw = rig.rotation.y; this.placeAt(top, null); rig.rotation.y = yaw;
    this.wallRun = null; this.cling = null;
    this._landRoof(col); this.onLand?.(col.id); audio.play('teleport');
  }

  // ------------------------------------------------------------------------------------------- wall run
  /** Head forward (3D) in world space. */
  _look3(out) { return out.set(0, 0, -1).applyQuaternion(this.app.camera.getWorldQuaternion(_q)); }
  /** At a wall contact: run (returns the start direction) or null = cling / climb. */
  _wallRunDecision(c, nx, nz, tAx) {
    if (settings.wallRun === false || this.mode !== 'city' || this.app.story?.inRoom) return null;
    const W = WALLRUN, f = this.feet(_d), look = this._look3(_c);
    if (Math.abs(Math.asin(THREE.MathUtils.clamp(look.y, -1, 1))) > THREE.MathUtils.degToRad(W.pitchClimbDeg)) return null; // straight up / down → climb
    const hx = look.x, hz = look.z, hl = Math.hypot(hx, hz) || 1;
    if ((hx * nx + hz * nz) / hl < W.faceWall) return null; // facing the wall → climb
    if (tAx.half - Math.abs(tAx.coord) < W.edgeMargin) return null; // building edge → cling
    if (c.y1 - f.y < W.topMargin + CHEST || f.y < W.bottomMargin) return null; // under the roof edge / just above the street
    const dir = this._runDir(look, nx, nz, new THREE.Vector3());
    return dir;
  }
  /** Run direction: the head direction projected on the wall plane, elevation clamped (null when ~no in-plane part). */
  _runDir(look, nx, nz, out) {
    const d = look.x * nx + look.z * nz;
    out.set(look.x - nx * d, look.y, look.z - nz * d);
    const h = Math.hypot(out.x, out.z);
    if (h < 0.25) return null; // looking (almost) straight at / away from the wall
    const maxE = Math.tan(THREE.MathUtils.degToRad(WALLRUN.maxElevDeg));
    out.y = THREE.MathUtils.clamp(out.y / h, -maxE, maxE) * h;
    return out.normalize();
  }
  _startWallRun(c, nx, nz, tAx, dir) {
    const W = WALLRUN, n = new THREE.Vector3(nx, 0, nz);
    const along = this.vel.clone().addScaledVector(n, -this.vel.dot(n)).length();
    this.wallRun = { collider: c, building: c.id, normal: n, tAx: new THREE.Vector3(tAx.x, 0, tAx.z), half: tAx.half, axis: tAx.x === c.sin && tAx.z === c.cos ? 'z' : 'x', t: 0, stepT: 0, side: 0, speed: THREE.MathUtils.clamp(along, W.speedMin, W.speedMax) };
    this.vel.copy(dir).multiplyScalar(this.wallRun.speed);
    this.grounded = false; this.cling = null;
    this.safePoint.copy(this.feet(new THREE.Vector3()));
    audio.play('attach'); this.app.hub?.haptic?.('left', 0.5, 50); this.app.hub?.haptic?.('right', 0.5, 50);
    this.stats.wallRuns = (this.stats.wallRuns || 0) + 1;
    this.onWallRun?.(c.id);
  }
  _endWallRun(push = 0, up = 0) {
    const W = this.wallRun; if (!W) return;
    this.vel.addScaledVector(W.normal, push); this.vel.y += up;
    this.wallRun = null; this.clingBlockUntil = performance.now() / 1000 + 0.35;
  }
  _wallRunStep(dt) {
    const R = this.wallRun, W = WALLRUN, n = R.normal, c = R.collider, rig = this.rig;
    R.t += dt;
    const look = this._look3(_c), hx = look.x, hz = look.z, hl = Math.hypot(hx, hz) || 1, toWall = (hx * n.x + hz * n.z) / hl;
    // the head decides: facing the wall → cling / climb; looking away → jump off; too long → slide off
    if (toWall < W.faceWall || Math.abs(Math.asin(THREE.MathUtils.clamp(look.y, -1, 1))) > THREE.MathUtils.degToRad(W.pitchClimbDeg)) {
      this.wallRun = null; this.vel.set(0, 0, 0);
      this.cling = { building: c.id, collider: c, normal: n.clone() }; this.onCling?.(c.id); return;
    }
    if (toWall > W.lookAway) { this.vel.addScaledVector(_t.set(hx, 0, hz).normalize(), 2); this._endWallRun(W.jumpOff[0], W.jumpOff[1]); audio.play('thrust'); return; }
    if (R.t > W.maxTime) { this._endWallRun(1.2, 0); return; }
    // velocity: toward the head direction on the wall plane, speed easing to the run speed, a slight sag over time
    const dir = this._runDir(look, n.x, n.z, _t);
    R.speed += (THREE.MathUtils.clamp(W.speed, W.speedMin, swingTuning().maxSpeed) - R.speed) * Math.min(1, dt * W.accel * 0.25);
    if (dir) this.vel.lerp(_v.copy(dir).multiplyScalar(R.speed), 1 - Math.exp(-dt * W.steer));
    this.vel.y -= W.sag * (0.3 + R.t / W.maxTime) * dt * 2; // gravity creeps back in the longer the run
    this.vel.addScaledVector(n, -this.vel.dot(n)); // stay on the wall plane
    // move (sub-steps; other buildings still collide), then hold the body exactly gap off this wall
    const move = _v.copy(this.vel).multiplyScalar(dt);
    const nSub = Math.max(1, Math.ceil(move.length() / 0.3)); move.divideScalar(nSub);
    for (let k = 0; k < nSub && this.wallRun; k++) { rig.position.add(move); rig.updateMatrixWorld(true); this._hugWall(); this._collide(); }
    if (!this.wallRun) return; // a collision changed the state (other wall, roof, street)
    const f = this.feet(_f), [bx, bz] = worldToBox(c, f.x, f.z), along = R.axis === 'z' ? bz : bx;
    if (Math.abs(along) > R.half + 0.3) { this._endWallRun(1.0, 0.5); return; } // past the corner: fly off
    if (f.y + CHEST * 0.6 > c.y1) { if (this.vel.y > -0.5) this._mantle(c, n); else this._endWallRun(1, 0); return; } // over the roof edge
    if (f.y < 1) { this.wallRun = null; this.placeAt(new THREE.Vector3(f.x, 0, f.z).addScaledVector(n, 0.6)); this.onStreet?.(); return; }
    // footsteps
    R.stepT += dt;
    if (R.stepT >= W.stepEvery * (10 / Math.max(6, R.speed))) { R.stepT = 0; R.side ^= 1; audio.play('wallStep'); this.app.hub?.haptic?.(R.side ? 'left' : 'right', 0.25, 20); }
  }
  /** Keep the body R_BODY + gap off the running wall (box frame), so the own wall never registers as a new contact. */
  _hugWall() {
    const R = this.wallRun, c = R.collider, rig = this.rig, f = this.feet(_f);
    const [bx, bz] = worldToBox(c, f.x, f.z);
    const want = (R.axis === 'z' ? c.hw : c.hd) + R_BODY + WALLRUN.gap; // distance from the centre along the normal axis
    const cur = R.axis === 'z' ? bx : bz, d = want - Math.abs(cur);
    if (Math.abs(d) > 1e-4) { rig.position.x += R.normal.x * d; rig.position.z += R.normal.z * d; rig.updateMatrixWorld(true); }
  }
  /** Straight eased pull of the feet point to `to` over `dur` seconds (no rotation). */
  zipTo(to, dur = 0.7) { this.cling = null; this.wallRun = null; this.zip = { from: this.feet(new THREE.Vector3()), to: to.clone(), t: 0, dur }; this.grounded = false; }
  launchFrom(pos, vel) { this.cling = null; this.wallRun = null; this.placeAt(pos); this.grounded = false; this.vel.copy(vel); }
}
