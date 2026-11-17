// Two-hand "Fan Web" (扇形光網) gesture: one hand open, PALM UP (a tray); the other an UPRIGHT FIST
// (handshake orientation: thumb side up, little-finger side down) whose little-finger edge touches
// the centre of the open palm. Fires ONCE on contact; must separate before it can fire again.
// Built only from WebXR hand joints (positions + joint frames) — no SDK gesture API is assumed.
// All vectors are PLAYER-LOCAL (XR reference space), metres; +Y = up.
//
// Contact model (not wrist distance, not palm-centre distance):
//   palm zone  = open hand's palm centre lifted 1 cm along its palm normal (the palm surface);
//   fist edge  = midpoint of the fist's little-finger knuckle and middle joint, pushed 1.5 cm further
//                toward the little-finger side (the ulnar edge of the fist, "拳底").
//   contact    = edge height above the palm plane within [contactBelow, contactAbove] AND lateral
//                offset (in the palm plane) < contactLateral.
// Rejected on purpose: flat fist pressed knuckles/fingers-down (thumb side not up), fist on the BACK of a
// hand (open hand not palm-up), two fists, two palms.
import * as THREE from 'three';
import { J } from './gestures.js';

/** All tunables (dev panel / Quest 3 tuning). Angles in degrees, distances in metres, times in seconds. */
export const FAN_TUNING = {
  openMaxCurl: 0.38, // each of the 4 fingers below this curl = open hand (0 straight … 1 curled)
  fistMin: 0.6, // fistConfidence() above this = fist
  palmUpTol: 45, // open hand's palm normal within this of world-up
  uprightTol: 40, // fist's little-finger → thumb axis within this of world-up
  knuckleMaxPitch: 50, // fist forward (wrist → knuckles) at most this far from horizontal (rejects knuckles-down)
  contactAbove: 0.035, contactBelow: 0.025, // fist edge height above the palm surface (contact band)
  contactLateral: 0.055, // max offset from the palm centre inside the palm plane
  releaseDist: 0.085, // edge must get this far from the palm centre before re-arming
  engageDist: 0.16, // hands this close in the fan poses → single-hand web / light bomb are suppressed
  readyFrames: 2, // poses held this many frames before a contact can count
  contactFrames: 1, // contact frames to confirm (the FIRST contact frame's time is reported)
  lostTolerance: 0.12, // tracking gap kept without disarming (never fires during the gap)
  cooldown: 0.25, // minimum time between two fan webs
};

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3(), _e1 = new THREE.Vector3(); // helper-private temporaries (no aliasing)
const UP = new THREE.Vector3(0, 1, 0);
const deg = (r) => r * 57.29578;

/** Little-finger → thumb side axis of a hand (geometric: index knuckle − pinky knuckle). Works for both hands. */
export function thumbSideAxis(f, out = new THREE.Vector3()) {
  f.joint(J['index-finger-phalanx-proximal'], out); f.joint(J['pinky-finger-phalanx-proximal'], _s1);
  return out.sub(_s1).normalize();
}
/** The fist's little-finger edge (contact point). */
export function fistEdgePoint(f, out = new THREE.Vector3()) {
  const side = thumbSideAxis(f, _s2);
  f.joint(J['pinky-finger-phalanx-proximal'], out); f.joint(J['pinky-finger-phalanx-intermediate'], _e1);
  return out.add(_e1).multiplyScalar(0.5).addScaledVector(side, -0.015);
}
/** Palm contact centre (palm surface) + its normal. */
export function palmZone(f, out = new THREE.Vector3()) { return out.copy(f.palm).addScaledVector(f.palmNormal, 0.01); }

/**
 * Evaluate one assignment (open hand O, fist hand F). Returns a diagnostic object; `.valid` = poses OK,
 * `.contact` = edge in the contact band, `.dist` = edge ↔ palm centre distance.
 */
export function evaluatePair(O, F, T = FAN_TUNING) {
  const r = { valid: false, contact: false, open: false, fist: false, palmUpDeg: 180, uprightDeg: 180, pitchDeg: 90, height: 1, lateral: 1, dist: 1 };
  const maxCurl = Math.max(O.curl[1], O.curl[2], O.curl[3], O.curl[4]);
  r.open = maxCurl < T.openMaxCurl;
  r.fist = F.fistConfidence() > T.fistMin && F.meanCurl() > 0.55;
  r.palmUpDeg = deg(Math.acos(THREE.MathUtils.clamp(O.palmNormal.dot(UP), -1, 1)));
  const side = thumbSideAxis(F, _c);
  r.uprightDeg = deg(Math.acos(THREE.MathUtils.clamp(side.dot(UP), -1, 1)));
  F.joint(J['middle-finger-phalanx-proximal'], _d).sub(F.wrist).normalize();
  r.pitchDeg = deg(Math.asin(THREE.MathUtils.clamp(Math.abs(_d.y), 0, 1)));
  const zone = palmZone(O, _a), edge = fistEdgePoint(F, _b);
  const rel = edge.sub(zone);
  r.height = rel.dot(O.palmNormal);
  r.lateral = rel.addScaledVector(O.palmNormal, -r.height).length();
  r.dist = Math.hypot(r.height, r.lateral);
  r.valid = r.open && r.fist && r.palmUpDeg <= T.palmUpTol && r.uprightDeg <= T.uprightTol && r.pitchDeg <= T.knuckleMaxPitch;
  r.contact = r.valid && r.height <= T.contactAbove && r.height >= -T.contactBelow && r.lateral <= T.contactLateral;
  return r;
}

/**
 * Two-hand state machine: idle → ready (poses held, hands apart) → contact (confirm) → FIRE once →
 * waitRelease (until separated past releaseDist) → ready …
 * Tracking: a short gap keeps the state (no new contact can be created from missing data); a longer gap
 * disarms (separation must be seen again). A hand that appears already touching never fires.
 */
export class FanWebDetector {
  constructor() { this.reset(); }
  reset() {
    this.state = 'idle'; this.armed = false; this.readyCount = 0; this.contactCount = 0; this.firstContactT = 0;
    this.lastFire = -9; this.lostSince = null; this.pair = null; this.engaged = false;
    this.debug = { state: 'idle', pair: null, eval: null };
  }
  /**
   * @param {HandFeatures} L @param {HandFeatures} R @param {{t:number, allow:boolean}} ctx
   * @returns {null | { type:'fanWeb', t:number, tContact:number, open:'left'|'right', fist:'left'|'right' }}
   */
  update(L, R, ctx) {
    const T = FAN_TUNING, t = ctx.t;
    if (!L.tracked || !R.tracked || L.trackedFrames < 3 || R.trackedFrames < 3) {
      if (this.lostSince === null) this.lostSince = t;
      if (t - this.lostSince > T.lostTolerance) { this.state = 'idle'; this.armed = false; this.readyCount = 0; this.contactCount = 0; this.engaged = false; }
      this.debug.state = `${this.state}(lost)`;
      return null; // never fire without reliable data
    }
    this.lostSince = null;
    // pick the better assignment (left open + right fist, or the mirror)
    const eL = evaluatePair(L, R, T), eR = evaluatePair(R, L, T);
    const score = (e) => (e.valid ? 10 : 0) + (e.open ? 1 : 0) + (e.fist ? 1 : 0) - e.dist;
    const useL = score(eL) >= score(eR), e = useL ? eL : eR, pair = useL ? { open: 'left', fist: 'right' } : { open: 'right', fist: 'left' };
    this.debug.eval = e; this.debug.pair = pair; this.pair = pair;
    this.engaged = e.open && e.fist && e.dist < T.engageDist;
    const apart = !e.valid || e.dist > T.releaseDist;
    let out = null;
    const confirm = () => {
      if (this.contactCount < T.contactFrames) return;
      if (ctx.allow && t - this.lastFire >= T.cooldown) { out = { type: 'fanWeb', t, tContact: this.firstContactT, ...pair }; this.lastFire = t; }
      this.state = 'waitRelease'; this.armed = false; // holding the hands together never fires again
    };
    switch (this.state) {
      case 'idle':
        if (apart) this.armed = true; // separation observed (also covers "appeared already touching")
        if (e.valid && this.armed && !e.contact) { if (++this.readyCount >= T.readyFrames) this.state = 'ready'; } else if (!e.valid) this.readyCount = 0;
        break;
      case 'ready':
        if (!e.valid) { this.state = 'idle'; this.readyCount = 0; }
        else if (e.contact) { this.state = 'contact'; this.contactCount = 1; this.firstContactT = t; confirm(); }
        break;
      case 'contact':
        if (e.contact) { this.contactCount++; confirm(); } else { this.state = e.valid ? 'ready' : 'idle'; this.readyCount = 0; }
        break;
      case 'waitRelease':
        if (apart) { this.state = 'idle'; this.armed = true; this.readyCount = 0; }
        break;
      default: break;
    }
    this.debug.state = this.state;
    return out;
  }
}
