// Joint-based hand features + gesture recognizers.
// All vectors are in PLAYER-LOCAL space (XR reference space), metres.
import * as THREE from 'three';

export const JOINTS = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];
export const J = Object.fromEntries(JOINTS.map((n, i) => [n, i]));
// finger chains (metacarpal..tip) for index, middle, ring, pinky
const CHAINS = [[5, 6, 7, 8, 9], [10, 11, 12, 13, 14], [15, 16, 17, 18, 19], [20, 21, 22, 23, 24]];
const THUMB = [1, 2, 3, 4];

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x, lo, hi) => clamp01((x - lo) / (hi - lo));

/** Tunable recognizer thresholds (exposed in the dev panel). */
export const GESTURE_TUNING = {
  curlBendLo: 40, // degrees of summed bend considered "extended"
  curlBendHi: 175, // degrees considered "fully curled"
  webEnter: 0.5, webExit: 0.4, webEnterFrames: 3, webExitFrames: 3, // v0.24: 3 frames to enter (less twitchy)
  // v0.24 web pose: middle + ring must be FULLY curled; index + pinky only need to be not curled (no need to
  // straighten them completely); the thumb is ignored. Curl 0 = straight … 1 = fully curled (bend 40°…175°).
  webCurlLo: 0.8, webCurlHi: 0.95, // middle / ring: confidence 0 at 0.8, 1 at 0.95 (≈ 148°…168° of summed bend = tucked in)
  webExtLo: 0.2, webExtHi: 0.45, // index / pinky: confidence 1 while curl ≤ 0.55, 0 once curl ≥ 0.8
  webHoldCurl: [0.55, 0.75], // keep HOLDING a fired web while middle / ring stay at least this curled (relaxing slightly mid-swing is fine)
  flickSpeed: 1.0, flickRearm: 0.35, flickCooldown: 0.22, // forward flick while holding the pose re-fires
  webCooldown: 0.14,
  fistEnter: 0.62, fistEnterFrames: 3,
  openCurl: 0.42, // mean curl below this = hand open
  throwMinSpeed: 1.2, throwPeakSpeed: 1.6, throwForwardDot: 0.45, throwWindow: 0.22,
  bombCooldown: 0.5,
  recoverFrames: 5,
};

export class HandFeatures {
  constructor(handedness) {
    this.handedness = handedness;
    this.pos = new Float32Array(75);
    this.quat = new Float32Array(100);
    this.radii = new Float32Array(25);
    this.tracked = false;
    this.trackedFrames = 0;
    this.curl = new Float32Array(5); // thumb, index, middle, ring, pinky
    this.wrist = new THREE.Vector3();
    this.palm = new THREE.Vector3();
    this.palmNormal = new THREE.Vector3(0, 0, -1);
    this.fingerDir = new THREE.Vector3(0, 0, -1);
    this.indexTip = new THREE.Vector3();
    this.thumbTip = new THREE.Vector3();
    this.webDir = new THREE.Vector3(0, 0, -1); // web direction: hand forward (wrist → middle knuckle)
    this.webOrigin = new THREE.Vector3();     // inner wrist (web emitter), not the palm centre
    this.vel = new THREE.Vector3();
    this._hist = []; // [{t, x,y,z}] palm history for velocity
    this.peakSpeed = 0; this.peakT = 0;
  }
  joint(i, out) { return out.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]); }

  /** Read joints from an XRFrame. Returns tracked flag. */
  readFrame(frame, inputSource, refSpace, tSec) {
    const hand = inputSource?.hand;
    let ok = false;
    if (hand && frame.fillPoses) {
      const spaces = this._spaces || (this._spaces = JOINTS.map((n) => hand.get(n)));
      if (this._handRef !== hand) { this._spaces = JOINTS.map((n) => hand.get(n)); this._handRef = hand; }
      const m = this._mats || (this._mats = new Float32Array(16 * 25));
      try {
        ok = frame.fillPoses(this._spaces, refSpace, m);
        if (ok && frame.fillJointRadii) frame.fillJointRadii(this._spaces, this.radii);
      } catch { ok = false; }
      if (ok) {
        const mat = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3();
        for (let i = 0; i < 25; i++) {
          mat.fromArray(m, i * 16); mat.decompose(p, _q, s);
          this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
          this.quat[i * 4] = _q.x; this.quat[i * 4 + 1] = _q.y; this.quat[i * 4 + 2] = _q.z; this.quat[i * 4 + 3] = _q.w;
        }
      }
    } else if (hand) {
      ok = true;
      for (let i = 0; i < 25; i++) {
        const pose = frame.getJointPose(hand.get(JOINTS[i]), refSpace);
        if (!pose) { ok = false; break; }
        const { position: P, orientation: O } = pose.transform;
        this.pos.set([P.x, P.y, P.z], i * 3); this.quat.set([O.x, O.y, O.z, O.w], i * 4);
      }
    }
    this.setTracked(ok, tSec);
    return ok;
  }

  /** Inject synthetic joints (desktop / tests). */
  setJoints(pos, quat, tSec) { this.pos.set(pos); this.quat.set(quat); this.setTracked(true, tSec); }

  setTracked(ok, tSec) {
    if (!ok) { this.tracked = false; this.trackedFrames = 0; this._hist.length = 0; this.vel.set(0, 0, 0); return; }
    this.tracked = true; this.trackedFrames++;
    this._derive(tSec);
  }

  _derive(t) {
    const T = GESTURE_TUNING;
    // curls
    for (let f = 0; f < 4; f++) this.curl[f + 1] = this._chainCurl(CHAINS[f], T);
    this.curl[0] = this._chainCurl(THUMB, { curlBendLo: 25, curlBendHi: 110 });
    this.joint(J.wrist, this.wrist);
    // palm centre: avg of wrist, index & pinky metacarpal bases, middle proximal
    this.joint(J['index-finger-phalanx-proximal'], _a);
    this.joint(J['pinky-finger-phalanx-proximal'], _b);
    this.joint(J['middle-finger-metacarpal'], _c);
    this.palm.copy(this.wrist).add(_a).add(_b).add(_c).multiplyScalar(0.25);
    // palm normal: -Y of middle metacarpal joint (WebXR: +Y = back of the hand)
    const qi = J['middle-finger-metacarpal'] * 4;
    _q.set(this.quat[qi], this.quat[qi + 1], this.quat[qi + 2], this.quat[qi + 3]);
    this.palmNormal.set(0, -1, 0).applyQuaternion(_q);
    this.fingerDir.set(0, 0, -1).applyQuaternion(_q);
    // web direction = hand forward: wrist → middle-finger knuckle (proximal joint).
    // Independent of how the fingers are curled, so it stays stable in the web pose.
    this.joint(J['middle-finger-phalanx-proximal'], _b);
    this.webDir.copy(_b).sub(this.wrist);
    if (this.webDir.lengthSq() < 1e-8) this.webDir.copy(this.fingerDir);
    this.webDir.normalize();
    // emitter on the inner wrist (palm side), slightly forward of the wrist joint
    this.webOrigin.copy(this.wrist).addScaledVector(this.palmNormal, 0.02).addScaledVector(this.fingerDir, 0.01);
    this.joint(J['index-finger-tip'], this.indexTip);
    this.joint(J['thumb-tip'], this.thumbTip);
    // velocity from ~70 ms history
    const h = this._hist;
    h.push({ t, x: this.palm.x, y: this.palm.y, z: this.palm.z });
    while (h.length > 2 && t - h[0].t > 0.07) h.shift();
    if (h.length >= 2) {
      const a = h[0], b = h[h.length - 1], dt = Math.max(1e-3, b.t - a.t);
      this.vel.set((b.x - a.x) / dt, (b.y - a.y) / dt, (b.z - a.z) / dt);
    }
    const sp = this.vel.length();
    if (sp > this.peakSpeed || t - this.peakT > T.throwWindow) { this.peakSpeed = sp; this.peakT = t; }
  }

  _chainCurl(chain, T) {
    let bend = 0;
    for (let k = 0; k + 2 < chain.length; k++) {
      this.joint(chain[k], _a); this.joint(chain[k + 1], _b); this.joint(chain[k + 2], _c);
      const v1 = _b.clone().sub(_a), v2 = _c.clone().sub(_b);
      const l = v1.length() * v2.length();
      if (l > 1e-8) bend += Math.acos(Math.max(-1, Math.min(1, v1.dot(v2) / l))) * 57.2958;
    }
    return smooth(bend, T.curlBendLo, T.curlBendHi);
  }

  get pinchDistance() { return this.indexTip.distanceTo(this.thumbTip); }

  /** Web-shooter pose (v0.24): middle + ring fully curled; index + pinky roughly out (not curled); thumb free. */
  webConfidence() {
    const c = this.curl, T = GESTURE_TUNING;
    const ext = (x) => smooth(1 - x, T.webExtLo, T.webExtHi);
    const cur = (x) => smooth(x, T.webCurlLo, T.webCurlHi);
    return Math.min(ext(c[1]), ext(c[4]), cur(c[2]), cur(c[3]));
  }
  /** Looser check used only to keep holding a web that already fired. */
  webHoldConfidence() {
    const c = this.curl, H = GESTURE_TUNING.webHoldCurl;
    return Math.min(smooth(1 - c[1], 0.1, 0.3), smooth(1 - c[4], 0.1, 0.3), smooth(c[2], H[0], H[1]), smooth(c[3], H[0], H[1]));
  }
  fistConfidence() {
    const c = this.curl;
    const cur = (x) => smooth(x, 0.45, 0.72);
    return Math.min(cur(c[1]), cur(c[2]), cur(c[3]), cur(c[4]));
  }
  meanCurl() { return (this.curl[1] + this.curl[2] + this.curl[3] + this.curl[4]) / 4; }
}

/**
 * Per-hand gesture state machine. Produces discrete events.
 * Rules: hysteresis + frame debounce, cooldowns, re-arm requires leaving the
 * pose, tracking loss disarms everything until the pose has been seen absent.
 */
export class HandGestureMachine {
  constructor(handedness) {
    this.handedness = handedness;
    this.web = { active: false, armed: false, enterCount: 0, exitCount: 0, lastFire: -9, conf: 0, held: false };
    this.bomb = { state: 'idle', armed: false, count: 0, t0: 0, cooldownUntil: 0, charge: 0 };
    this.wasTracked = false;
  }
  reset() {
    this.web.active = false; this.web.armed = false; this.web.enterCount = 0; this.web.exitCount = 0; this.web.held = false;
    if (this.bomb.state === 'charging') this.bomb.state = 'idle';
    this.bomb.armed = false; this.bomb.count = 0; this.bomb.charge = 0;
  }

  /**
   * @param {HandFeatures} f
   * @param {object} ctx { t, allowWeb, allowBomb, headForward:Vector3 (player-local, horizontal) }
   * @returns {Array} events
   */
  update(f, ctx) {
    const T = GESTURE_TUNING;
    const out = [];
    if (!f.tracked) {
      if (this.wasTracked) { if (this.bomb.state === 'charging') out.push({ type: 'bombCancel', hand: this.handedness, reason: 'tracking' }); this.reset(); }
      this.wasTracked = false;
      return out;
    }
    this.wasTracked = true;
    const recovering = f.trackedFrames < T.recoverFrames;
    const t = ctx.t;

    // ---------------- web pose with hysteresis
    const wc = f.webConfidence();
    this.web.conf = wc;
    if (!this.web.active) {
      this.web.enterCount = wc > T.webEnter ? this.web.enterCount + 1 : 0;
      if (this.web.enterCount >= T.webEnterFrames && !recovering) {
        this.web.active = true; this.web.exitCount = 0;
        const canFire = this.web.armed && t - this.web.lastFire >= T.webCooldown && this.bomb.state !== 'charging' && ctx.allowWeb;
        if (canFire) { out.push({ type: 'web', hand: this.handedness }); this.web.lastFire = t; }
        this.web.armed = false; // must leave the pose before firing again
      } else if (wc < T.webExit && !recovering) {
        this.web.armed = true; // pose observed absent → re-arm
      }
    } else {
      this.web.exitCount = wc < T.webExit ? this.web.exitCount + 1 : 0;
      if (this.web.exitCount >= T.webExitFrames) { this.web.active = false; this.web.armed = true; }
      // flick re-fire: holding the pose, jab the hand forward (along the web direction)
      if (ctx.allowFlick !== false && this.web.active) {
        const fwd = f.vel.dot(f.webDir);
        if (fwd < T.flickRearm) this.web.flickArmed = true;
        if (this.web.flickArmed && fwd > T.flickSpeed && t - this.web.lastFire >= T.flickCooldown && ctx.allowWeb && this.bomb.state !== 'charging' && !recovering) {
          out.push({ type: 'web', hand: this.handedness, flick: true }); this.web.lastFire = t; this.web.flickArmed = false;
        }
      }
    }
    this.web.held = this.web.active || (this.web.held && f.webHoldConfidence() > 0.5); // v0.24: looser hold

    // ---------------- light bomb: fist → forward throw → open
    const fc = f.fistConfidence();
    const B = this.bomb;
    if (B.state === 'idle') {
      if (fc < 0.3) B.armed = true;
      B.count = fc > T.fistEnter ? B.count + 1 : 0;
      if (B.armed && !recovering && B.count >= T.fistEnterFrames && t >= B.cooldownUntil && ctx.allowBomb && !this.web.active) {
        B.state = 'charging'; B.t0 = t; B.armed = false;
        out.push({ type: 'bombCharge', hand: this.handedness });
      }
    } else if (B.state === 'charging') {
      B.charge = Math.min(1, (t - B.t0) / 0.35);
      if (!ctx.allowBomb) { B.state = 'idle'; out.push({ type: 'bombCancel', hand: this.handedness, reason: 'blocked' }); }
      else if (f.meanCurl() < T.openCurl) {
        // opened: was it a forward throw?
        const v = f.vel, sp = v.length();
        const fwd = ctx.headForward;
        const forwardness = sp > 1e-3 ? v.dot(fwd) / sp : 0;
        const recentPeak = t - f.peakT <= T.throwWindow ? f.peakSpeed : sp;
        const ok = B.charge > 0.25 && sp >= T.throwMinSpeed && recentPeak >= T.throwPeakSpeed && forwardness >= T.throwForwardDot;
        B.state = 'idle'; B.cooldownUntil = t + (ok ? T.bombCooldown : 0.15); B.charge = 0;
        out.push(ok ? { type: 'bombThrow', hand: this.handedness, velocity: v.clone() } : { type: 'bombFizzle', hand: this.handedness });
      }
    }
    return out;
  }
}

/**
 * Left-palm button pressed by the right index fingertip.
 * Proximity → hover, penetration past threshold → press. Re-arm requires
 * withdrawing beyond `rearmDist`. Only active when the palm faces the head.
 */
export class PalmButton {
  constructor() {
    this.radius = 0.028; this.hoverDist = 0.07; this.pressDepth = -0.006; this.rearmDist = 0.035;
    this.armed = true; this.lastPress = -9; this.hover = 0; this.visible = false; this.pressing = false;
    this.center = new THREE.Vector3(); this.normal = new THREE.Vector3();
  }
  update(left, right, headPos, t) {
    this.visible = false; this.hover = 0; this.pressing = false;
    if (!left.tracked) { this.armed = false; return false; }
    this.center.copy(left.palm).addScaledVector(left.palmNormal, 0.015);
    this.normal.copy(left.palmNormal);
    const toHead = _a.copy(headPos).sub(this.center).normalize();
    const facing = toHead.dot(this.normal);
    this.visible = facing > 0.55;
    // explicit fingertip press only (index extended) — a fist never presses the palm button
    if (!this.visible || !right.tracked || right.trackedFrames < 6 || right.curl[1] > 0.5) { this.armed = this.armed && this.visible; if (!this.visible) this.armed = true; return false; }
    const rel = _b.copy(right.indexTip).sub(this.center);
    const d = rel.dot(this.normal); // signed distance along normal
    const lateral = rel.addScaledVector(this.normal, -d).length();
    if (lateral < this.radius * 1.6 && d < this.hoverDist) this.hover = 1 - Math.max(0, d) / this.hoverDist;
    if (d > this.rearmDist || lateral > this.radius * 3) this.armed = true;
    if (this.armed && lateral < this.radius && d < this.pressDepth && d > -0.05 && t - this.lastPress > 0.4) {
      this.armed = false; this.lastPress = t; this.pressing = true;
      return true;
    }
    return false;
  }
}

/**
 * Experimental joint-based thumb swipe (fallback when native microgestures are
 * unavailable). Thumb tip must rest against the side of the index finger, then
 * slide sideways (across the finger) ≥ 1.8 cm within 300 ms. Direction is taken
 * relative to the head's right vector so "swipe right" turns right.
 */
export class ThumbSwipeDetector {
  constructor() { this.track = null; this.lastFire = -9; }
  update(f, t, headRight) {
    if (!f.tracked) { this.track = null; return 0; }
    f.joint(J['index-finger-phalanx-proximal'], _a);
    f.joint(J['index-finger-phalanx-distal'], _b);
    const axis = _c.copy(_b).sub(_a); const len = axis.length(); axis.normalize();
    const rel = f.thumbTip.clone().sub(_a);
    const along = rel.dot(axis);
    const dist = rel.addScaledVector(axis, -along).length();
    const touching = dist < 0.03 && along > -0.015 && along < len + 0.02;
    if (!touching) { this.track = null; return 0; }
    const x = f.thumbTip.dot(headRight);
    if (!this.track || t - this.track.t > 0.3) { this.track = { t, x }; return 0; }
    const d = x - this.track.x;
    if (Math.abs(d) > 0.018 && t - this.lastFire > 0.5) {
      this.lastFire = t; this.track = null;
      return d > 0 ? 1 : -1;
    }
    return 0;
  }
}
