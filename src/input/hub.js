// InputHub: single action layer on top of IWSDK's InputManager.
// Sources: hand tracking (joints from XRFrame), controllers (IWSDK gamepads +
// grip/ray spaces), desktop mouse/keyboard (dev). Output = per-frame actions
// in WORLD space with a priority/context model:
//   menu/UI  >  teleport/turn  >  web  >  light bomb  >  story grab/punch
import * as THREE from 'three';
import { HandFeatures, HandGestureMachine, PalmButton, ThumbSwipeDetector } from './gestures.js';
import { FanWebDetector, FAN_TUNING, fistEdgePoint, palmZone } from './fanWeb.js';
import { EnergyWaveDetector, WAVE_TUNING } from './energyWave.js';
import { PalmShieldDetector } from './palmShield.js';
import { SHIELD } from '../data/handCombat.js';
import { settings } from '../core/settings.js';

const HANDS = ['left', 'right'];
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _UP = new THREE.Vector3(0, 1, 0);

export class InputHub {
  constructor(world) {
    this.world = world;
    this.features = { left: new HandFeatures('left'), right: new HandFeatures('right') };
    this.machines = { left: new HandGestureMachine('left'), right: new HandGestureMachine('right') };
    this.palmButton = new PalmButton();
    this.fan = new FanWebDetector(); // two-hand Fan Web (扇形光網), arcade only (ctx.fanWeb)
    this.wave = new EnergyWaveDetector(); // v0.48 two-palm energy wave, Arcade only (ctx.energyWave)
    this.fanBlockUntil = { left: -9, right: -9 }; // after a fan web: no light bomb from the fist hand until it reopens
    this.thumbSwipe = new ThumbSwipeDetector();
    // v0.44 palm-facing light-web shield (hands; desktop: hold B). The gesture + its arbitration live here, the shield itself in game/lightShield.js
    this.shieldDet = { left: new PalmShieldDetector('left'), right: new PalmShieldDetector('right') };
    // v0.44 web pull: the hand point in PLAYER-LOCAL space (palm / controller grip) — locomotion measures the pull from it
    this.handLocal = { left: { valid: false, pos: new THREE.Vector3() }, right: { valid: false, pos: new THREE.Vector3() } };
    this.pullBusy = { left: false, right: false }; // set by locomotion: a pull stroke / its forward reset is in progress → no web flick re-fire from that hand
    this.mode = { left: 'none', right: 'none' }; // 'hand' | 'controller' | 'desktop' | 'none'
    this.events = [];
    this.ctx = { allowAttack: false, menuOpen: false, allowLocomotion: false, fanWeb: false, fanWebControllers: true, energyWave: false, bombLocked: false, uiHover: { left: false, right: false },
      // v0.44 shield: `shield` = the mode allows it (Story chase / World Chase combat; never the Arcade), `shieldReady` = energy allows raising one (LightShield),
      // `shieldRope[h]` = that hand still holds a swing web (locomotion), `shieldHold` = climbing / scripted motion / frozen (no shield from either hand)
      shield: false, shieldReady: true, shieldRope: { left: false, right: false }, shieldHold: false }; // bombLocked: v0.41 World Chase Light Bomb cooldown
    this.aim = {
      left: { origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), valid: false },
      right: { origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), valid: false },
    };
    this.pointers = {
      left: { origin: new THREE.Vector3(), dir: new THREE.Vector3(), valid: false, selectDown: false, selectHeld: false, selectUp: false, tip: new THREE.Vector3(), tipValid: false },
      right: { origin: new THREE.Vector3(), dir: new THREE.Vector3(), valid: false, selectDown: false, selectHeld: false, selectUp: false, tip: new THREE.Vector3(), tipValid: false },
    };
    this.grip = { // world-space hand/grip pose for punching & grabbing
      left: { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), closed: false, closedDown: false, closedUp: false, valid: false, _prevClosed: false },
      right: { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), closed: false, closedDown: false, closedUp: false, valid: false, _prevClosed: false },
    };
    this.webHeld = { left: false, right: false };
    this.bombCharge = { left: 0, right: 0 };
    this.teleport = { aiming: false, commit: false, cancel: false, hand: 'right', _pinchT: 0 };
    this.headPos = new THREE.Vector3(); this.headFwd = new THREE.Vector3(0, 0, -1);
    this.headPosLocal = new THREE.Vector3(); this.headFwdLocal = new THREE.Vector3(); this.headRightLocal = new THREE.Vector3();
    this.ctrlPrev = { left: null, right: null };
    this.ctrlCharging = { left: false, right: false };
    this.ctrlHist = { left: [], right: [] };
    this.microgestures = { seen: false };
    this.trackingLost = { left: false, right: false };
    this._initDesktop();
  }

  // ------------------------------------------------------------- desktop
  _initDesktop() {
    this.desk = { keys: new Set(), down: new Set(), up: new Set(), mouse: new THREE.Vector2(), click: 0, rclick: 0, yaw: 0, pitch: 0, dragging: false, wheel: 0 };
    const d = this.desk;
    const el = () => this.world.renderer?.domElement;
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (!d.keys.has(e.code)) d.down.add(e.code);
      d.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => { d.keys.delete(e.code); d.up.add(e.code); });
    window.addEventListener('pointermove', (e) => {
      const c = el(); if (!c) return;
      const r = c.getBoundingClientRect();
      d.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      if (d.dragging) { d.yaw -= e.movementX * 0.0035; d.pitch = Math.max(-1.3, Math.min(1.3, d.pitch - e.movementY * 0.0035)); }
    });
    window.addEventListener('pointerdown', (e) => {
      if (e.target !== el()) return;
      if (e.button === 0) d.click++;
      if (e.button === 2) d.dragging = true;
    });
    window.addEventListener('pointerup', (e) => { if (e.button === 2) d.dragging = false; });
    window.addEventListener('contextmenu', (e) => { if (e.target === el()) e.preventDefault(); });
  }

  setContext(c) { Object.assign(this.ctx, c); }

  /** Main per-frame update. `frame` may be null (desktop). t = seconds (performance clock). */
  update(frame, t) {
    const w = this.world;
    this.events.length = 0;
    this._dt = Math.min(0.1, Math.max(0, t - (this._tPrev ?? t))); this._tPrev = t;
    this.handLocal.left.valid = this.handLocal.right.valid = false;
    const session = w.session;
    const player = w.player;
    player.updateMatrixWorld(true);
    w.camera.getWorldPosition(this.headPos);
    this.headFwd.set(0, 0, -1).applyQuaternion(w.camera.getWorldQuaternion(_q));
    // player-local head (for gesture forward checks)
    this.headPosLocal.copy(w.camera.position);
    this.headFwdLocal.set(0, 0, -1).applyQuaternion(w.camera.quaternion); this.headFwdLocal.y = 0;
    if (this.headFwdLocal.lengthSq() < 1e-6) this.headFwdLocal.set(0, 0, -1);
    this.headFwdLocal.normalize();
    this.headRightLocal.set(-this.headFwdLocal.z, 0, this.headFwdLocal.x);

    for (const h of HANDS) {
      const p = this.pointers[h]; p.selectDown = p.selectUp = false; p.valid = false; p.tipValid = false;
      this.aim[h].valid = false; this.grip[h].valid = false;
    }
    this.teleport.commit = false; this.teleport.cancel = false;

    if (session && frame) this._updateXR(frame, t, session);
    else this._updateDesktop(t);

    // gate attacks by context (menu/UI hover/teleport aiming)
    if (!this.ctx.allowAttack || this.ctx.menuOpen) {
      this.events = this.events.filter((e) => !['web', 'bombThrow', 'bombCharge', 'fanWeb', 'energyWave'].includes(e.type));
    } else {
      this.events = this.events.filter((e) => !(['web', 'bombCharge'].includes(e.type) && (this.ctx.uiHover[e.hand] || (this.teleport.aiming && this.teleport.hand === e.hand))));
    }
    // attach world-space aim to attack events
    for (const e of this.events) {
      if (e.type === 'web' || e.type === 'bombThrow') {
        const a = this.aim[e.hand];
        e.origin = a.origin.clone(); e.dir = a.dir.clone(); e.t = t;
        if (e.type === 'bombThrow' && e.velocity && !e.worldVelocity) e.worldVelocity = e.velocity.clone().applyQuaternion(player.getWorldQuaternion(_q));
      }
      if (e.type === 'fanWeb' && !e.origin) { // contact point between the hands (world) + head forward
        e.origin = (e.localOrigin || this.headPosLocal.clone().add(_v.set(0, -0.45, 0).addScaledVector(this.headFwdLocal, 0.35))).clone().applyMatrix4(player.matrixWorld);
        e.dir = this.headFwd.clone(); e.t ??= t; e.tContact ??= t;
        e.wrists = HANDS.map((h) => (this.aim[h].valid ? this.aim[h].origin.clone() : null));
      }
      if (e.type === 'energyWave' && !e.origin) { // v0.48: the point between the palms (world)
        e.origin = (e.localOrigin || this.headPosLocal.clone().add(_v.set(0, -0.3, 0).addScaledVector(this.headFwdLocal, 0.4))).clone().applyMatrix4(player.matrixWorld);
        e.dir = this.headFwd.clone(); e.t ??= t; e.tContact ??= t;
        e.wrists = HANDS.map((h) => (this.aim[h].valid ? this.aim[h].origin.clone() : null));
      }
    }
    // desktop key edges consumed
    this.desk.down.clear(); this.desk.up.clear(); this.desk.click = 0;
  }

  _updateXR(frame, t, session) {
    const w = this.world, ref = w.xrReferenceSpace, player = w.player;
    const sources = { left: null, right: null };
    for (const src of session.inputSources) {
      if (src.handedness !== 'left' && src.handedness !== 'right') continue;
      if (src.hand) sources[src.handedness] = src;
      else if (src.gamepad && !sources[src.handedness]?.hand) sources[src.handedness] = src;
    }
    const allowAttack = this.ctx.allowAttack && !this.ctx.menuOpen;
    for (const h of HANDS) {
      const src = sources[h];
      const f = this.features[h];
      if (src?.hand) {
        this.mode[h] = 'hand';
        f.readFrame(frame, src, ref, t);
        this.trackingLost[h] = !f.tracked;
        const ev = this.machines[h].update(f, { t, allowWeb: allowAttack, allowBomb: allowAttack && !this.ctx.bombLocked, allowFlick: settings.webFlick && !this.pullBusy[h], headForward: this.headFwdLocal }); // (v0.44: the forward reset of a web pull is not a flick)
        this.events.push(...ev);
        this.webHeld[h] = this.machines[h].web.held;
        this.bombCharge[h] = this.machines[h].bomb.state === 'charging' ? this.machines[h].bomb.charge : 0;
        if (f.tracked) { this._handAim(h, f); this.handLocal[h].pos.copy(f.palm); this.handLocal[h].valid = true; }
        this._handPointer(h, f, src);
        this._handGrip(h, f);
      } else if (src?.gamepad) {
        this.mode[h] = 'controller';
        this.trackingLost[h] = false;
        f.setTracked(false, t); this.machines[h].reset();
        this._controller(h, src, t, allowAttack);
      } else {
        this.mode[h] = 'none';
        this.trackingLost[h] = this.features[h].tracked || this.trackingLost[h];
        f.setTracked(false, t);
        if (this.machines[h].bomb.state === 'charging') this.events.push({ type: 'bombCancel', hand: h });
        this.machines[h].reset();
        this.webHeld[h] = false; this.bombCharge[h] = 0;
      }
    }
    // two-hand Fan Web + arbitration (before the palm button: the fan pose must never open the menu)
    if (this.mode.left === 'hand' && this.mode.right === 'hand' && this.ctx.fanWeb) this._fanWeb(t, allowAttack);
    else { this.fan.engaged = false; if (this.mode.left !== 'hand' || this.mode.right !== 'hand') this.fan.update(this.features.left, this.features.right, { t, allow: false }); }
    // v0.48 energy wave: only while the Arcade is playing (ctx.energyWave). Outside it the detector is not even run, so it can
    // never fire, suppress a web, or get in the way of the palm shield in Story's chase or World Chase.
    if (this.ctx.energyWave && this.mode.left === 'hand' && this.mode.right === 'hand') this._energyWave(t, allowAttack);
    else if (this.wave.state !== 'idle' || this.wave.engaged) this.wave.reset();
    // palm button (hands only): explicit right index fingertip press; never while the hands are in the fan pose
    if (this.mode.left === 'hand' && this.mode.right === 'hand' && !this.fan.engaged) {
      if (this.palmButton.update(this.features.left, this.features.right, this.headPosLocal, t)) this.events.push({ type: 'menu', source: 'palm' });
    } else this.palmButton.visible = false;
    this._shields(t); // v0.44 (after the fan web + palm button: both win over the shield)

    // microgestures from IWSDK hand gamepads (Quest: 5 swipe-left, 6 swipe-right, 9 tap/confirm)
    const gpR = w.input.xr.gamepads.right, gpL = w.input.xr.gamepads.left;
    if (this.mode.right === 'hand' && gpR) {
      for (const [idx, ev] of [[5, -1], [6, 1]]) if (gpR.getButtonDownByIdx(idx)) { this.microgestures.seen = true; this.events.push({ type: 'turn', dir: ev, source: 'microgesture' }); }
      if (gpR.getButtonDownByIdx(9)) { this.microgestures.seen = true; if (this.teleport.aiming) this.teleport.commit = true; }
    }
    if (this.mode.right === 'hand' && settings.thumbFallback && !this.microgestures.seen) {
      const d = this.thumbSwipe.update(this.features.right, t, this.headRightLocal);
      if (d) this.events.push({ type: 'turn', dir: d, source: 'thumb-fallback' });
    }
    // teleport (right hand pinch-hold) – only when locomotion allowed
    this._teleportHands(t, gpR);
    void gpL;
  }

  /**
   * Fan Web detection + gesture arbitration. While the hands are in / near the fan pose (fan.engaged), and
   * right after a fan web: no single-hand web, no light-bomb charge / throw from either hand (releasing the
   * fist afterwards is never a throw). A charge that had started (fist made far away) is cancelled silently.
   */
  /** v0.48: energy wave detection + arbitration: while both palms are in the wave pose close together, no one-hand web and no Light Bomb charge. */
  _energyWave(t, allowAttack) {
    const W = this.wave, ev = W.update(this.features.left, this.features.right, { t, headPos: this.headPosLocal, headFwd: this.headFwdLocal, allow: allowAttack });
    if (ev) this.events.push({ type: 'energyWave', t, tContact: ev.tContact, localOrigin: ev.origin, source: 'hands' });
    if (W.engaged || ev || t - W.lastFire < 0.35) {
      for (const h of HANDS) { const m = this.machines[h]; if (m.bomb.state === 'charging') { m.bomb.state = 'idle'; m.bomb.charge = 0; this.events.push({ type: 'bombCancel', hand: h, reason: 'energyWave', silent: true }); } }
      this.events = this.events.filter((e) => !['web', 'bombCharge', 'bombThrow', 'bombFizzle'].includes(e.type));
    }
  }
  _fanWeb(t, allowAttack) {
    const L = this.features.left, R = this.features.right, F = this.fan;
    const ev = F.update(L, R, { t, allow: allowAttack });
    if (ev) {
      const o = F.pair.open === 'left' ? L : R, fi = F.pair.fist === 'left' ? L : R;
      ev.localOrigin = palmZone(o, new THREE.Vector3()).add(fistEdgePoint(fi, _v)).multiplyScalar(0.5);
      this.events.push(ev);
    }
    if (F.engaged || ev || t - F.lastFire < 0.35) {
      for (const h of HANDS) {
        const m = this.machines[h];
        if (m.bomb.state === 'charging') { m.bomb.state = 'idle'; m.bomb.charge = 0; this.events.push({ type: 'bombCancel', hand: h, reason: 'fanWeb', silent: true }); }
        m.bomb.armed = false; this.fanBlockUntil[h] = t + 0.5; // re-arms only after the fist opens again
      }
      this.events = this.events.filter((e) => !['web', 'bombCharge', 'bombThrow', 'bombFizzle'].includes(e.type));
    } else this.events = this.events.filter((e) => !(['bombCharge', 'bombThrow', 'bombFizzle'].includes(e.type) && t < this.fanBlockUntil[e.hand]));
    this.fanDebug = F.debug;
  }

  /**
   * v0.44 palm shield + gesture arbitration (hands only). A hand may raise the shield only while it is free:
   *   - not holding / firing a web (pose, held web, or a swing rope still attached — it must release first), and not
   *     within SHIELD.webLock of letting go (the opening hand of a release is not a shield);
   *   - not charging a Light Bomb, and not within SHIELD.bombLock after a throw / fizzle / cancel (opening the hand ≠ shield);
   *   - not in / right after the Fan Web poses, not pressing or offering the palm menu button;
   *   - not pinching, hovering a panel, or aiming a teleport; no menu open; not climbing / scripted / frozen (ctx.shieldHold).
   * The other hand is untouched: it keeps swinging, pulling, shooting.
   */
  _shields(t) {
    const G = SHIELD, c = this.ctx, dt = this._dt || 1 / 72;
    const fanBusy = this.fan.engaged || t - this.fan.lastFire < G.fanLock;
    const palmBusy = this.palmButton.visible && (this.palmButton.hover > 0 || this.palmButton.pressing);
    for (const h of HANDS) {
      const det = this.shieldDet[h];
      let tr = null;
      if (this.mode[h] === 'hand' || this.mode[h] === 'none') { // ('none' = the hand left tracking: the detector's own loss grace applies)
        const f = this.features[h], m = this.machines[h];
        for (const e of this.events) if (e.hand === h && (e.type === 'bombThrow' || e.type === 'bombFizzle' || e.type === 'bombCancel')) det.lock(t, G.bombLock);
        const webBusy = m.web.active || m.web.held || this.webHeld[h] || c.shieldRope[h];
        if (webBusy) det.lock(t, G.webLock); // opening the hand to let go of a web is a release, not a shield
        const blocked = c.menuOpen || c.shieldHold || c.uiHover[h] || this.pointers[h].selectHeld || (this.teleport.aiming && this.teleport.hand === h)
          || webBusy || m.bomb.state === 'charging'
          || fanBusy || palmBusy || (h === 'left' && this.palmButton.visible) || (f.tracked && f.pinchDistance < G.pinchDist);
        tr = det.update(f, { t, dt, headPos: this.headPosLocal, headFwd: this.headFwdLocal, allow: c.shield && c.shieldReady, blocked });
      } else tr = det.drop(); // controllers have no shield gesture
      if (tr) this.events.push({ type: tr === 'on' ? 'shieldOn' : 'shieldOff', hand: h });
    }
  }
  /** World-space shield disc pose of a hand (centre in front of the palm, normal = palm direction). False when the hand has no pose right now. */
  shieldPose(h, outPos, outNormal) {
    const pm = this.world.player.matrixWorld;
    if (this.mode[h] === 'hand') {
      const f = this.features[h]; if (!f.tracked) return false;
      outNormal.copy(f.palmNormal);
      outPos.copy(f.palm).addScaledVector(f.palmNormal, SHIELD.offset).applyMatrix4(pm);
      outNormal.transformDirection(pm);
      return true;
    }
    if (this.mode[h] === 'desktop') { // dev: in front of the camera, facing where it looks
      const cam = this.world.camera;
      outNormal.set(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(_q));
      cam.getWorldPosition(outPos).addScaledVector(outNormal, 0.5); outPos.y -= 0.15;
      return true;
    }
    return false;
  }

  _handAim(h, f) {
    const a = this.aim[h];
    const pm = this.world.player.matrixWorld;
    // origin: inner wrist (palm side), slightly toward the palm
    // web leaves the wrist emitter toward where the extended index + pinky point (default),
    // optional legacy mode: palm normal
    a.origin.copy(f.webOrigin).applyMatrix4(pm);
    if (settings.aimMode === 'palm') a.dir.copy(f.palmNormal);
    else a.dir.copy(f.webDir);
    a.dir.transformDirection(pm);
    // pitch correction: tilt toward world-down by webPitchDeg (default −15°, Quest 3 feedback)
    if (settings.webPitchDeg) {
      _v.crossVectors(a.dir, _UP);
      if (_v.lengthSq() > 1e-6) a.dir.applyAxisAngle(_v.normalize(), THREE.MathUtils.degToRad(settings.webPitchDeg)).normalize();
    }
    a.valid = true;
  }
  _handPointer(h, f, src) {
    const p = this.pointers[h];
    const gp = this.world.input.xr.gamepads[h];
    const raySpace = this.world.player.raySpaces[h];
    raySpace.getWorldPosition(p.origin);
    p.dir.set(0, 0, -1).applyQuaternion(raySpace.getWorldQuaternion(_q));
    p.valid = f.tracked;
    const held = !!(gp && gp.getButtonPressedByIdx(0));
    p.selectDown = held && !p.selectHeld; p.selectUp = !held && p.selectHeld; p.selectHeld = held;
    if (f.tracked) { p.tip.copy(f.indexTip).applyMatrix4(this.world.player.matrixWorld); p.tipValid = true; }
    void src;
  }
  _handGrip(h, f) {
    const g = this.grip[h];
    if (!f.tracked) { g.valid = false; return; }
    g.pos.copy(f.palm).applyMatrix4(this.world.player.matrixWorld);
    g.vel.copy(f.vel).applyQuaternion(this.world.player.getWorldQuaternion(_q));
    const closed = f.fistConfidence() > 0.55;
    g.closedDown = closed && !g._prevClosed; g.closedUp = !closed && g._prevClosed; g._prevClosed = g.closed = closed;
    g.valid = true;
  }

  _controller(h, src, t, allowAttack) {
    const w = this.world, gp = w.input.xr.gamepads[h];
    const ray = w.player.raySpaces[h], gs = w.player.gripSpaces[h];
    const a = this.aim[h], p = this.pointers[h], g = this.grip[h];
    ray.getWorldPosition(a.origin); a.dir.set(0, 0, -1).applyQuaternion(ray.getWorldQuaternion(_q)); a.valid = true;
    p.origin.copy(a.origin); p.dir.copy(a.dir); p.valid = true;
    gs.getWorldPosition(p.tip); p.tip.addScaledVector(a.dir, 0.06); p.tipValid = true;
    const trig = gp ? gp.getButtonPressedByIdx(0) : false;
    const squeeze = gp ? gp.getButtonPressedByIdx(1) : false;
    p.selectDown = trig && !p.selectHeld; p.selectUp = !trig && p.selectHeld; p.selectHeld = trig;
    // grip pose & velocity (player-local history → world)
    gs.getWorldPosition(g.pos); gs.getWorldQuaternion(g.quat); g.valid = true;
    const local = gs.position;
    this.handLocal[h].pos.copy(local); this.handLocal[h].valid = true; // v0.44 web pull (trigger held = web held)
    const hist = this.ctrlHist[h]; hist.push({ t, x: local.x, y: local.y, z: local.z });
    while (hist.length > 2 && t - hist[0].t > 0.07) hist.shift();
    const vLocal = new THREE.Vector3();
    if (hist.length >= 2) { const A = hist[0], B = hist[hist.length - 1], dt = Math.max(1e-3, B.t - A.t); vLocal.set((B.x - A.x) / dt, (B.y - A.y) / dt, (B.z - A.z) / dt); }
    g.vel.copy(vLocal).applyQuaternion(w.player.getWorldQuaternion(_q));
    g.closedDown = squeeze && !g._prevClosed; g.closedUp = !squeeze && g._prevClosed; g._prevClosed = g.closed = squeeze;
    // web = trigger edge; hold = trigger held. Both triggers within 120 ms (arcade) = Fan Web instead.
    if (gp?.getButtonDownByIdx(0) && allowAttack && !this.ctrlCharging[h] && !this.ctx.uiHover[h]) {
      this._trigT = this._trigT || { left: -9, right: -9 }; this._trigT[h] = t;
      const other = h === 'left' ? 'right' : 'left';
      if (this.ctx.energyWave && t - this._trigT[other] <= WAVE_TUNING.triggerGap && this.mode[other] === 'controller' && this.grip[h].valid && this.grip[other].valid && this.grip[h].pos.distanceTo(this.grip[other].pos) <= WAVE_TUNING.controllerDist) {
        // v0.48: both triggers within 80 ms with the controllers held together = the energy wave (apart, it is the Fan Web as before)
        this.events = this.events.filter((e) => !(e.type === 'web' && e.hand === other && e.t === undefined));
        this.events.push({ type: 'energyWave', t, tContact: t, source: 'controllers' }); this._trigT[other] = this._trigT[h] = -9;
      } else if (this.ctx.fanWeb && this.ctx.fanWebControllers !== false && t - this._trigT[other] <= 0.12 && this.mode[other] === 'controller') { // (v0.42: off in the World Chase — two triggers there are two swings)
        this.events = this.events.filter((e) => !(e.type === 'web' && e.hand === other && e.t === undefined));
        this.events.push({ type: 'fanWeb', t, tContact: t, open: other, fist: h, source: 'controllers' }); this._trigT[other] = this._trigT[h] = -9;
      } else this.events.push({ type: 'web', hand: h });
    }
    this.webHeld[h] = trig;
    // light bomb = squeeze hold → swing → release
    if (gp?.getButtonDownByIdx(1) && allowAttack && !this.ctx.bombLocked) { this.ctrlCharging[h] = true; this._ctrlChargeT = t; this.events.push({ type: 'bombCharge', hand: h }); }
    if (this.ctrlCharging[h]) {
      this.bombCharge[h] = Math.min(1, (t - (this._ctrlChargeT || t)) / 0.35);
      if (!allowAttack) { this.ctrlCharging[h] = false; this.events.push({ type: 'bombCancel', hand: h }); }
      else if (gp && gp.getButtonUpByIdx(1)) {
        this.ctrlCharging[h] = false; this.bombCharge[h] = 0;
        const sp = vLocal.length(), fw = sp > 1e-3 ? vLocal.dot(this.headFwdLocal) / sp : 0;
        if (sp > 1.1 && fw > 0.4) this.events.push({ type: 'bombThrow', hand: h, velocity: vLocal.clone() });
        else this.events.push({ type: 'bombFizzle', hand: h });
      }
    } else this.bombCharge[h] = 0;
    // menu: Y (left, idx 5) / B (right, idx 5)
    if (gp?.getButtonDownByIdx(5)) this.events.push({ type: 'menu', source: 'button' });
    // locomotion: right thumbstick
    const ax = src.gamepad.axes;
    const sx = ax.length >= 4 ? ax[2] : ax[0] || 0, sy = ax.length >= 4 ? ax[3] : ax[1] || 0;
    if (h === 'right') {
      const st = this._stick || (this._stick = { x: 0, aiming: false });
      if (Math.abs(sx) > 0.75 && Math.abs(st.x) <= 0.75) this.events.push({ type: 'turn', dir: Math.sign(sx), source: 'stick' });
      st.x = sx;
      if (h === 'right') {
        const aim = sy < -0.7;
        if (aim && this.ctx.allowLocomotion) { this.teleport.aiming = true; this.teleport.hand = 'right'; }
        else if (!aim && this.teleport.aiming && this.teleport.hand === 'right' && this.mode.right === 'controller') { this.teleport.aiming = false; this.teleport.commit = true; }
      }
    }
  }

  _teleportHands(t, gpR) {
    if (this.mode.right !== 'hand') return;
    const T = this.teleport, f = this.features.right;
    if (!this.ctx.allowLocomotion || this.ctx.menuOpen || this.ctx.uiHover.right || !f.tracked) {
      if (T.aiming && T.hand === 'right') { T.aiming = false; T.cancel = true; }
      T._pinchT = 0; return;
    }
    const pinching = gpR ? gpR.getButtonPressedByIdx(0) : f.pinchDistance < 0.02;
    if (pinching && !this.machines.right.web.active && this.machines.right.bomb.state !== 'charging') {
      if (!T._pinchT) T._pinchT = t;
      if (t - T._pinchT > 0.28) { T.aiming = true; T.hand = 'right'; }
    } else {
      if (T.aiming && T.hand === 'right') { T.aiming = false; T.commit = true; }
      T._pinchT = 0;
    }
  }

  // -------------------------------------------------------- desktop mode
  _updateDesktop(t) {
    const w = this.world, d = this.desk, cam = w.camera;
    this.mode.left = this.mode.right = 'desktop';
    cam.rotation.set(d.pitch, d.yaw, 0, 'YXZ');
    cam.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(); ray.setFromCamera(d.mouse, cam);
    const allow = this.ctx.allowAttack && !this.ctx.menuOpen;
    for (const h of HANDS) {
      const a = this.aim[h], p = this.pointers[h], g = this.grip[h];
      const side = h === 'left' ? -1 : 1;
      a.origin.set(side * 0.22, -0.25, -0.35).applyMatrix4(cam.matrixWorld);
      a.dir.copy(ray.ray.direction); a.valid = true;
      p.origin.copy(ray.ray.origin); p.dir.copy(ray.ray.direction); p.valid = h === 'right';
      g.pos.copy(a.origin); g.quat.copy(cam.getWorldQuaternion(_q)); g.valid = true; g.vel.set(0, 0, 0);
    }
    const pr = this.pointers.right;
    const clicked = d.click > 0;
    pr.selectDown = clicked; pr.selectUp = clicked; pr.selectHeld = false;
    // attacks
    if (allow) {
      if (clicked && !this.ctx.uiHover.right) this.events.push({ type: 'web', hand: 'right' });
      if (d.down.has('KeyQ')) this.events.push({ type: 'web', hand: 'left' });
      if (d.down.has('KeyE')) this.events.push({ type: 'web', hand: 'right' });
      if (d.down.has('KeyF')) this.events.push({ type: 'finisherKey', hand: 'right' }); // v0.45 dev: finisher (both strands + pull; World Chase only)
      if (d.down.has('KeyC') && this.ctx.energyWave) this.events.push({ type: 'energyWave', t, tContact: t, source: 'desktop' }); // v0.48 dev: energy wave
      if (d.down.has('KeyV') && this.ctx.fanWeb) this.events.push({ type: 'fanWeb', t, tContact: t, open: 'left', fist: 'right', source: 'desktop' }); // dev: Fan Web
      if (d.down.has('Space') && !this.ctx.bombLocked) { this._deskCharge = t; this.events.push({ type: 'bombCharge', hand: 'right' }); }
      if (d.up.has('Space') && this._deskCharge) {
        const v = this.aim.right.dir.clone().multiplyScalar(4);
        this.events.push({ type: 'bombThrow', hand: 'right', velocity: v, worldVelocity: v.clone() });
        this._deskCharge = 0;
      }
    } else this._deskCharge = 0;
    this.bombCharge.right = this._deskCharge ? Math.min(1, (t - this._deskCharge) / 0.35) : 0;
    { // v0.44 dev: hold B = the right-hand shield (same energy / blocking path as the palm gesture)
      const tr = this.shieldDet.right.setManual(!!(this.ctx.shield && this.ctx.shieldReady && !this.ctx.menuOpen && d.keys.has('KeyB')));
      if (tr) this.events.push({ type: tr === 'on' ? 'shieldOn' : 'shieldOff', hand: 'right' });
      this.shieldDet.left.drop();
    }
    this.webHeld.right = d.keys.has('KeyE') || d.keys.has('KeyF');
    this.webHeld.left = d.keys.has('KeyQ');
    // punch / grab emulation for story mode
    const closed = d.keys.has('KeyG');
    for (const g of [this.grip.left, this.grip.right]) { g.closedDown = closed && !g._prevClosed; g.closedUp = !closed && g._prevClosed; g._prevClosed = g.closed = closed; }
    const gr = this.grip.right;
    if (d.down.has('KeyR')) { gr.vel.copy(this.aim.right.dir).multiplyScalar(4); this.events.push({ type: 'punch', hand: 'right' }); gr.pos.copy(cam.getWorldPosition(_v)).addScaledVector(this.aim.right.dir, 0.6); }
    if (d.up.has('KeyG')) gr.vel.copy(this.aim.right.dir).multiplyScalar(5);
    if (d.down.has('Escape') || d.down.has('KeyM')) this.events.push({ type: 'menu', source: 'key' });
    if (d.down.has('ArrowLeft')) this.events.push({ type: 'turn', dir: -1, source: 'key' });
    if (d.down.has('ArrowRight')) this.events.push({ type: 'turn', dir: 1, source: 'key' });
    if (d.down.has('KeyT') && this.ctx.allowLocomotion) { this.teleport.aiming = true; this.teleport.hand = 'right'; }
    if (d.up.has('KeyT') && this.teleport.aiming) { this.teleport.aiming = false; this.teleport.commit = true; }
    void _m;
  }

  /** World-space web origin recomputed with the CURRENT rig transform (rig may have moved this frame). */
  aimOriginNow(h, out) {
    const p = this.world.player; p.updateMatrixWorld(true);
    if (this.mode[h] === 'hand' && this.features[h].tracked) return out.copy(this.features[h].webOrigin).applyMatrix4(p.matrixWorld);
    if (this.mode[h] === 'controller') return p.raySpaces[h].getWorldPosition(out);
    return out.copy(this.aim[h].origin);
  }
  /** Is any attack-capable input present? */
  get inputKind() {
    if (this.mode.right === 'hand' || this.mode.left === 'hand') return 'hands';
    if (this.mode.right === 'controller' || this.mode.left === 'controller') return 'controllers';
    if (this.mode.right === 'desktop') return 'desktop';
    return 'none';
  }
  haptic(h, intensity, ms) {
    const s = this.world.session; if (!s) return;
    for (const src of s.inputSources) if (src.handedness === h && src.gamepad && !src.hand) {
      const act = src.gamepad.hapticActuators?.[0];
      if (settings.haptics) try { act?.pulse?.(intensity, ms); } catch { /* ignore */ }
    }
  }
}
