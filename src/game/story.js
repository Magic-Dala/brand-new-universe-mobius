// Story Mode (故事模式) – explicit state machine reusing the shared input, weapons, locomotion and HUD.
// v0.20 stages (v0.21: chase bombs + jet tether; the roof is triggered by a web dash + kick):
//   intro → suit → mirror → window → chase (flyby…roof standoff, chase.js) → roofEvent (kick, giant bomb, blast, fall,
//   fade) → loadingInterior (black) → factory (separate interior) → arcadeBattle (music battle) →
//   escape (Green Maniac crashes out through the roll-up door, Mobius follows) → endless (Dala City keeps
//   generating modules: chase him, then free swinging; endless.js).
// Every stage supports success, failure → retry, pause/resume and exit. The old rooftop platform /
// rebar / ten-bombs / sunset ending is gone.
import * as THREE from 'three';
import { t } from '../core/i18n.js';
import { audio } from '../core/audio.js';
import { settings } from '../core/settings.js';
import { Panel, techFrame, wrapText, COLORS, FONT } from '../ui/panel.js';
import { ROOM, STORY, KEY_BUILDINGS, roomToWorld } from '../data/layout.js';
import { Chase } from './chase.js';
import { Endless } from './endless.js';
import { FactoryFlow, FLOW_STATES } from './factoryFlow.js';
import { INTERIOR } from '../data/factory.js';
import { StreetRampage } from './streetRampage.js';
import { StoryCombat } from './storyCombat.js';
import { Tutorials } from './tutorial.js'; // v0.49: which tutorial is open, which page (the panel: src/ui/tutorialPanel.js)

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
const ROOM_STAGES = ['intro', 'suit', 'mirror', 'window'];
const STAGES = ['intro', 'suit', 'mirror', 'window', 'chase', 'roofEvent', 'loadingInterior', 'factory', 'arcadeBattle', 'escape', 'endless'];
const CHASE_FLOW = { bossFlyby: 'Chase', chaseStraight: 'Chase', chaseRightTurn: 'Chase', approachPlatform: 'FactoryRoofApproach', roofStandoff: 'RoofStandoff', roofDash: 'RoofWebDash' };
export { STAGES, FLOW_STATES };

export class Story {
  constructor(app) {
    this.app = app;
    this.stage = null; this.paused = false; this.time = 0; this.stageTime = 0;
    this.suited = false; this.inRoom = true;
    this.allowAttack = false; this.allowLocomotion = false;
    this.tutorials = new Tutorials(); this._tutThen = null; // v0.49: the three tutorials (each at most once per run) and what happens when the open one closes
    this.root = new THREE.Group(); this.root.name = 'story'; app.scene.add(this.root);
    // subtitle / objective panel (used before the HUD exists, and for radio subtitles)
    this.sub = new Panel({ width: 0.9, height: 0.2, ppm: 1100, name: 'subtitle', render: (g) => this._drawSub(g) });
    this.sub.interactive = false; this.sub.mat.depthTest = false; this.sub.mesh.renderOrder = 60;
    this.subRoot = new THREE.Group(); this.subRoot.add(this.sub.root); this.sub.root.position.set(0, -0.3, -1.25); this.sub.root.lookAt(0, -0.1, 0);
    app.scene.add(this.subRoot); this.subRoot.visible = false;
    this.subtitle = { tag: '', text: '', note: '', until: 0 };
    this.bombs = []; // (v0.20: no thrown-bomb stages in the city any more)
    // fade sphere — own group order: drawn after every scene group → a true full black
    this.fadeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 8), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false }));
    this.fadeMesh.renderOrder = 120; this.fadeMesh.visible = false;
    this.fadeGroup = new THREE.Group(); this.fadeGroup.name = 'Fade'; this.fadeGroup.renderOrder = 2000; this.fadeGroup.add(this.fadeMesh); app.camera.add(this.fadeGroup);
    this.fade = { a: 0, target: 0, speed: 2, then: null };
    this.combat = new StoryCombat(app, this); // v0.47: the stall-and-punch loop shared by the chase and the chase after the factory (settings.storyCombat)
    this.chaseCtl = new Chase(this);
    this.endless = new Endless(this);
    this.flow = new FactoryFlow(this);
    this.rampage = new StreetRampage(app); // v6: Green Maniac outside the closed window
    // recovery: falls, landing on the street, leaving the playable corridor → nearest kept checkpoint
    const recover = (why) => {
      if (this.stage === 'chase' && this.chaseCtl.active && !this.inRoom) { this.say('', t(why), 2.5); return this.chaseCtl.respawn(); }
      if (this.stage === 'endless') { this.say('', t(why), 2.5); return this.endless.respawn(); }
      return false;
    };
    app.locomotion.onFall = () => { this.app.flashDamage(); return recover('story.fail.fall'); };
    app.locomotion.onStreet = () => { if (this.stage === 'chase' || this.stage === 'endless') app.hud.showBanner(t('story.hint.street'), 2.2, COLORS.warn); }; // v0.22c: landing on the street is fine — web back up
    app.locomotion.onOutOfBounds = () => recover('story.fail.bounds');
    app.locomotion.onAnchorLost = () => app.hud.showBanner(t('hint.anchorLost'), 1.6, COLORS.warn);
    app.locomotion.onCling = () => { this.app.hud.showBanner(t('story.cling'), 1.6, COLORS.perfect); };
    app.locomotion.onWallRun = () => { if (!this._wallRunHint) { this._wallRunHint = true; this.app.hud.showBanner(t('story.wallrun'), 2.6, COLORS.perfect); } }; // v0.23 (first run once)
  }

  // ================================================================ control
  start({ stage = 'intro' } = {}) {
    this.stopAll();
    this.tutorials.reset(); this._tutThen = null; this.app.tutorialPanel?.preload(); // v0.49: a new run shows the tutorials again; their clips load now
    this.suited = stage !== 'intro' && stage !== 'suit';
    this._factoryCheckpoint = false;
    this.app.resetCityForStory?.();
    this.combat.resetRun(); // v0.47: the run summary starts again
    if (this.combat.on) { this.combat.prepare(); this.combat.compile(); audio.loadStorySfx?.(); } // pools + shaders + samples before play (a no-op until audio is unlocked)
    this.app.fx.prewarmVfx?.(4); // v0.30 vfx: kit shaders compiled at the story start, never during play
    this.enterStage(stage);
  }
  stop() { this.stopAll(); this.tutorials.reset(); this._tutThen = null; this.stage = null; this.subRoot.visible = false; this.app.hud.setMode('off'); }
  stopAll() {
    const app = this.app;
    this.paused = false;
    app.boss.remount(); app.boss.setVisible(false); app.boss.jet.setDamage(0);
    this.rampage?.clear();
    app.coins?.stop(); app.hud.setCoins?.(0, false); // v0.23
    app.locomotion.detach(true);
    this.chaseCtl?.stop(); this.chaseCtl?.reset(); this.endless?.stop(); this._chaseTriggered = false; this._kick = null;
    this.combat?.stop(); app.hud.hideSummary?.(); // v0.47
    for (const s of app.room.parts.windowSashes) s.setOpen(0);
    app.suit.root.visible = true;
    app.room.parts.radioCtl.setActive(false);
    this.flow?.reset();
    this.fadeTo(0, 10);
  }
  pause() { this.paused = true; this.chaseCtl?.hum?.setLevel(0); this.endless?.hum?.setLevel(0); this.flow?.onPause(); }
  resume() { this.paused = false; this.flow?.onResume(); }
  /** The explicit flow state of the story (see FLOW_STATES), null outside it. */
  get flowState() {
    if (this.stage === 'chase') { const T = this.chaseCtl.tether; if (T) return T.phase === 'stuck' ? 'JetTether' : 'TetherCounter'; return this.chaseCtl.state ? CHASE_FLOW[this.chaseCtl.state] : 'Chase'; }
    if (this.stage === 'roofEvent' || this.stage === 'factory' || this.stage === 'escape') return this.flow.state;
    if (this.stage === 'loadingInterior') return 'LoadingInterior';
    if (this.stage === 'arcadeBattle') return 'BossEncounter';
    if (this.stage === 'endless') return this.endless.state === 'free' ? 'EndlessSwing' : 'EndlessChase';
    return null;
  }
  restartStage() {
    const s = this.stage;
    if (s === 'roofEvent' || (s === 'chase' && ['roofStandoff', 'roofDash'].includes(this.chaseCtl.state))) { this.paused = false; this.flow.restartRoofEvent(); return; }
    if (s === 'chase' && this.chaseCtl.active) { this.paused = false; this.chaseCtl.respawn(); return; } // checkpoint, no flyby replay
    if (s === 'loadingInterior') { this.paused = false; return; } // the loader owns this (Retry on error)
    if (s === 'factory' || s === 'arcadeBattle') { this.paused = false; this.flow.retryBoss(); return; } // interior checkpoint only
    if (s === 'escape') { this.paused = false; this.flow.beginEscape(); return; }
    if (s === 'endless') { this.paused = false; this.endless.respawn(); return; }
    this.stopAll();
    this.suited = !['intro', 'suit'].includes(s);
    this.app.setArmored(this.suited);
    this.enterStage(s);
  }
  next() { const i = STAGES.indexOf(this.stage); this.enterStage(STAGES[Math.min(STAGES.length - 1, i + 1)]); }

  enterStage(stage) {
    const app = this.app, loco = app.locomotion, hud = app.hud;
    if (this.tutorials.active) { this.tutorials.skip(); this.tutorials.drain(); this._tutThen = null; } // v0.49: a stage jump (restart, dev skip) while a tutorial is open closes it; its "then" does not run
    this.stage = stage; this.stageTime = 0; this.counter = 0; this.failCount = 0;
    this.allowAttack = false; this.allowLocomotion = false;
    this.subRoot.visible = true;
    const roomStages = ['intro', 'suit', 'mirror', 'window'];
    const A = KEY_BUILDINGS[0];
    this.inRoom = roomStages.includes(stage) || (stage === 'chase' && loco.feet().z > A.z - A.d / 2 - 0.6 && loco.feet().y > 70 && loco.feet().y < 79);
    app.setArmored(this.suited);
    hud.setMode(this.suited ? 'story' : 'off');
    loco.ignoreColliders = new Set(this.inRoom ? ['A'] : []);
    if (this.inRoom && (stage === 'intro' || !this._placedInRoom)) { app.enterRoom(); this._placedInRoom = true; }
    if (this.inRoom) { loco.setRoomMode(); this.allowLocomotion = true; }
    switch (stage) {
      case 'intro':
        this._radioOn = false; this._alarmOn = false; this._radioEnd = 0; this.app.voice?.stop?.();
        app.setArmored(false); this.suited = false;
        audio.startRoomMusic();
        this.objective(t('story.obj.listen'));
        break;
      case 'suit': this.objective(t('story.obj.suit')); break;
      case 'mirror': this.objective(t('story.obj.mirror')); break;
      case 'window': this.objective(t('story.obj.window')); break;
      case 'chase':
        // WaitingForWindow is done: the window is open. The chase controller owns the rest.
        audio.stopRoomMusic();
        this.allowAttack = true; this.allowLocomotion = true;
        for (const w of app.room.parts.windowSashes) w.setOpen(Math.max(w.angle, 1.1));
        loco.setCityMode(this.inRoom ? (loco.setRoomMode(), loco.surfaces) : loco.surfaces);
        if (!this.chaseCtl.active) this.chaseCtl.begin();
        break;
      case 'roofEvent':
        this.chaseCtl.stop();
        if (!this.flow.active && !this.flow.startRoofEvent(this._kick)) { this.restartRoofFinale(); return; } // never blow the roof without a kick
        break;
      case 'loadingInterior':
        this.subRoot.visible = false;
        this.flow.setState('LoadingInterior');
        app.loadFactoryWorld();
        break;
      case 'factory':
        if (app.worldName !== 'factory') { this.enterStage('loadingInterior'); return; } // dev skip → load first
        this.inRoom = false;
        hud.setMode('story');
        this.flow.beginInterior({ checkpoint: !!this._factoryCheckpoint });
        this._factoryCheckpoint = true;
        break;
      case 'arcadeBattle':
        // the interior arena circle + countdown start the arcade boss battle (app.state → 'arcade');
        // winning → results → Next → app.storyArcadeNext() → 'escape'
        this.subRoot.visible = false;
        app.hud.showBanner(t('story.showdown'), 2, COLORS.bad, t('char.boss'));
        app.boss.remount(); app.boss.setVisible(true);
        app.startArcade({ story: true, arena: app.worldName === 'factory' ? this.flow.arenaFrame() : null });
        break;
      case 'escape':
        if (app.worldName !== 'factory') { this.enterStage('endless'); return; }
        this.inRoom = false; hud.setMode('story');
        this.flow.beginEscape();
        break;
      case 'endless':
        // back in Dala City outside the broken roll-up door (the app restored the city behind a black screen)
        this.inRoom = false;
        this.allowAttack = true; this.allowLocomotion = true;
        hud.setMode('story');
        if (!this.endless.active) {
          loco.setCityMode([]);
          const p = STORY.exitSpawn.pos; loco.placeAt(_v.set(p[0], p[1], p[2]), STORY.exitSpawn.yaw);
          loco.surfaces = [{ y: 0, street: true, cx: p[0], cz: p[2], r: 40, blockers: [] }];
          this.flow.setRoof('netted'); app.city.factory?.setDoorState('broken');
          this.endless.begin();
        }
        break;
      default: break;
    }
  }
  /**
   * v0.49: open tutorial `id` ('move' | 'skills' | 'arcade') now; `then` runs when the player closes it (Done or Skip).
   * False when it does not open (the "Tutorials" switch is off, or it was already shown in this Story run): the caller
   * carries on at once. While one is open the stage that opened it waits and the player cannot move or attack (main.js).
   */
  tutorial(id, then) {
    if (!this.tutorials.open(id, { enabled: settings.tutorials !== false })) return false;
    this.tutorials.drain(); this._tutThen = then;
    this.objective(''); this.say('', '', 0); // the step's own prompt comes back with the next stage
    return true;
  }
  objective(text, tutorial = []) {
    this.app.hud.setObjective(text, tutorial);
    this.currentObjective = text;
    if (!this.suited) this.say('', text, 0, '');
  }
  say(tag, text, dur = 4, note = '') { this.subtitle = { tag, text, note, until: dur ? this.time + dur : 0 }; this.sub.dirty = true; }

  // ================================================================ frame
  /** dt = real frame time (fades, subtitles, the stage clock); simDt = the impact-time scaled step for the two chases (v0.47; = dt when no warp runs). */
  update(dt, tPerf, simDt = dt) {
    this._updateFade(dt);
    this._followSub(dt);
    if (this.paused || !this.stage) return;
    this.time += dt; this.stageTime += dt;
    if (this.subtitle.until && this.time > this.subtitle.until) { this.subtitle = { tag: '', text: this.suited ? '' : this.currentObjective || '', note: '', until: 0 }; this.sub.dirty = true; }
    if (this._tutThen) for (const e of this.tutorials.drain()) if (e.type === 'close') { const f = this._tutThen; this._tutThen = null; f?.(); } // v0.49: the tutorial was closed → what it was holding back
    const fn = this[`_s_${this.stage}`];
    if (fn) fn.call(this, dt, tPerf, simDt);
    if (ROOM_STAGES.includes(this.stage) || this.rampage.busy) this._roomBoss(dt, tPerf);
    this.app.room.parts.radioCtl.setActive(this.stage === 'intro' && this.stageTime > 3 && !this.tutorials.active);
  }

  /**
   * v6: while Mobius is still in his room with the window CLOSED, Green Maniac rampages over the street outside (flies
   * around, lobs pumpkin bombs at the street — StreetRampage). Pushing the window open starts the chase fly-by from
   * wherever he is; he then waits ahead, turns around to face Mobius and stretches (chase.js) until Mobius leaves.
   */
  _roomBoss(dt, tPerf) {
    const app = this.app, show = app._cityShow ? app._cityShow.main || app._cityShow.mirror : true;
    const rampage = ROOM_STAGES.includes(this.stage) && !this._chaseTriggered;
    if (rampage && !this.rampage.active) this.rampage.start();
    if (!rampage && this.rampage.active) this.rampage.stop();
    if (rampage || this.rampage.busy) this.rampage.update(dt, tPerf, rampage ? show : true);
  }

  // ---------------------------------------------------------------- stages
  _s_intro() {
    if (this.tutorials.active) return; // v0.49: tutorial 1 is open (the radio has finished): the suit step waits
    const s = this.stageTime;
    // v0.28b: the recorded police radio (from the radio on the nightstand); the synth placeholder only if the file is
    // not available after 6 s. The suit stage waits until the broadcast has finished.
    if (s > 2.4 && !this._alarmOn) { this._alarmOn = true; audio.play('alarm'); }
    if (s > 3 && !this._radioOn) {
      const d = this.app.voice?.say('RADIO', this.app.room?.parts?.radio) || 0;
      if (d > 0) { this._radioOn = true; this._radioEnd = s + d; }
      else if (s > 6) { this._radioOn = true; this._radioEnd = 12.5; audio.play('radio'); this.say(t('story.radioTag'), t('story.radio'), 9, t('story.voPlaceholder')); }
    }
    if (this._radioOn && s > Math.max(12.5, (this._radioEnd ?? 0) + 0.6)) { this._radioOn = false; this._alarmOn = false; const go = () => this.enterStage('suit'); if (!this.tutorial('move', go)) go(); } // v0.49: how to move and turn, then the suit
  }
  _s_suit() {
    const app = this.app, hub = app.hub;
    const grab = app.room.parts.armorRackGrabPoint.getWorldPosition(_v);
    const near = (h) => hub.grip[h].valid && hub.grip[h].pos.distanceTo(grab) < (hub.mode[h] === 'desktop' ? 3 : 0.45);
    const both = near('left') && near('right') && hub.grip.left.closed && hub.grip.right.closed;
    const one = ['left', 'right'].some((h) => near(h) && hub.grip[h].closed);
    this.counter = both ? this.counter + 1 : one ? this.counter + 0.35 : 0;
    if (this.counter > 20) this._suitUp();
  }
  _suitUp() {
    const app = this.app;
    app.suit.root.visible = false; this.suited = true; app.setArmored(true);
    audio.play('suitUp'); app.fx.boom(app.room.parts.armorRackGrabPoint.getWorldPosition(_v), { color: 0x7ef0ff, size: 1.2 });
    app.hud.setMode('story'); app.hud.showBanner(t('story.suitOn'), 2.2, COLORS.perfect);
    this.say('', '', 0);
    this.enterStage('mirror');
  }
  _s_mirror() {
    if (this.tutorials.active) return; // v0.49: tutorial 2 is open: the window step waits
    const app = this.app, hub = app.hub, cam = app.camera;
    const m = app.room.parts.mirror.root.getWorldPosition(_v);
    const head = cam.getWorldPosition(_w);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(_q));
    const toM = m.clone().sub(head); const d = toM.length(); toM.normalize();
    const looking = d < 3.2 && fwd.dot(toM) > 0.8;
    const raised = ['left', 'right'].every((h) => hub.grip[h].valid && hub.grip[h].pos.y > head.y - 0.15) || hub.mode.right === 'desktop';
    this.counter = looking && raised ? this.counter + 1 : Math.max(0, this.counter - 2);
    if (this.counter > 45) this._mirrorDone();
  }
  /** The hands-up at the mirror is done: v0.49 tutorial 2 (the window, coins and every skill), then the window step. */
  _mirrorDone() {
    this.app.hud.showBanner(t('story.mirror'), 2, COLORS.perfect); audio.play('perfect');
    const go = () => this.enterStage('window'); if (!this.tutorial('skills', go)) go();
  }
  _s_window() {
    const app = this.app, hub = app.hub, sashes = app.room.parts.windowSashes;
    const o = ROOM.origin, W = ROOM.window;
    for (const h of ['left', 'right']) {
      const g = hub.grip[h]; if (!g.valid) continue;
      const lx = g.pos.x - o[0], ly = g.pos.y - o[1], lz = g.pos.z - o[2];
      if (hub.mode[h] === 'desktop') {
        if (g.closed && app.camera.getWorldPosition(_v).distanceTo(new THREE.Vector3(o[0], o[1] + 1.5, o[2] - 3)) < 2.4) for (const s of sashes) s.setOpen(s.angle + 0.04);
        continue;
      }
      if (ly < W.yMin - 0.1 || ly > W.yMax + 0.1 || lz > W.z + 0.18) continue;
      const push = Math.max(0, (W.z + 0.18) - lz); // hand past the frame line → push outward
      for (const s of sashes) {
        const onSide = s.side === 'west' ? lx < 0.05 : lx > -0.05;
        if (onSide && lx > W.xMin - 0.1 && lx < W.xMax + 0.1) s.setOpen(Math.max(s.angle, Math.min(s.maxAngle, push * 4.5)));
      }
    }
    // passable: one sash ≥ 60° (1.7 m wide leaf) – triggers the chase ONCE (re-opening never respawns the boss)
    if (!this._chaseTriggered && sashes.some((s) => s.angle >= 1.05)) { this._chaseTriggered = true; audio.play('good'); this.enterStage('chase'); }
  }
  _s_chase(dt, tPerf, simDt = dt) { this.chaseCtl.update(simDt, this.time, dt); this.flow.update(dt, this.time); }
  _s_roofEvent(dt) { this.flow.update(dt, this.time); }
  _s_factory(dt) { this.flow.update(dt, this.time); }
  _s_escape(dt) { this.flow.update(dt, this.time); }
  _s_endless(dt, tPerf, simDt = dt) { this.endless.update(simDt, this.time, dt); this.flow.update(dt, this.time); }
  /** Called by the chase controller when the web dash really touched Green Maniac (once per run). */
  onChaseComplete(kick = null) {
    if (this.stage !== 'chase' || this.flow.roofFired || !kick) return; // no kick → nothing (the circle alone never fires)
    this._kick = kick;
    this.enterStage('roofEvent');
  }
  /** Restart the roof finale: roof intact, Mobius on the roof, Green Maniac back on the jet over the circle. */
  restartRoofFinale() {
    const app = this.app, loco = app.locomotion;
    this.paused = false;
    this.flow.reset(); this._kick = null;
    app.boss.remount();
    this.stage = 'chase'; this.stageTime = 0; this.inRoom = false;
    this.allowAttack = true; this.allowLocomotion = true;
    app.hud.setMode('story');
    loco.setCityMode([]); loco.ignoreColliders = new Set();
    const p = STORY.roofSpawn.pos;
    if (!app.cityWorld.colliderOf('C')) app.city.setFocus(_v.set(p[0], p[1], p[2])); // factory block not streamed yet (e.g. restart after a reload)
    loco.placeAt(_v.set(p[0], p[1], p[2]), null); loco._landRoof(app.cityWorld.colliderOf('C'));
    this.chaseCtl.resumeAtRoof();
    this.fadeTo(0, 10);
  }
  _freeBomb(b) { b.active = false; if (b.p) b.p.root.visible = false; }

  failRetry(msg, stage) {
    this.paused = true;
    this.app.menus.showMessage(() => t('result.failed'), () => msg, [
      { label: () => t('story.retry'), onClick: () => { this.app.menus.hide(); this.paused = false; this.enterStage(stage); } },
      { label: () => t('menu.main'), onClick: () => this.app.go('modeSelect') },
    ]);
  }

  // ---------------------------------------------------------------- misc
  fadeTo(a, speed = 2, then = null) { this.fade.target = a; this.fade.speed = speed; this.fade.then = then; if (speed >= 10) { this.fade.a = a; } }
  _updateFade(dt) {
    const f = this.fade;
    if (f.a !== f.target) { const s = Math.sign(f.target - f.a); f.a = THREE.MathUtils.clamp(f.a + s * dt * f.speed, 0, 1); if ((s > 0 && f.a >= f.target) || (s < 0 && f.a <= f.target)) { f.a = f.target; const cb = f.then; f.then = null; cb?.(); } }
    else if (f.then) { const cb = f.then; f.then = null; cb(); }
    this.fadeMesh.material.opacity = f.a; this.fadeMesh.visible = f.a > 0.001;
  }
  _followSub(dt) {
    if (!this.subRoot.visible) return;
    const cam = this.app.camera; cam.getWorldPosition(_v); cam.getWorldQuaternion(_q);
    const e = new THREE.Euler().setFromQuaternion(_q, 'YXZ');
    const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, e.y, 0, 'YXZ'));
    this.subRoot.position.copy(_v); this.subRoot.quaternion.slerp(target, 1 - Math.exp(-dt * 4));
    this.sub.update();
    // hide the subtitle panel when the HUD already shows the objective and nothing is being said
    this.sub.root.visible = !!(this.subtitle.text) && (!this.suited || !!this.subtitle.tag || this.subtitle.until > 0);
  }
  _drawSub(g) {
    const s = this.subtitle, W = this.sub.cw, H = this.sub.ch;
    if (!s.text) return;
    techFrame(g, 4, 4, W - 8, H - 8, { fill: 'rgba(4,12,26,0.82)', c: 18 });
    g.textAlign = 'left'; g.textBaseline = 'top';
    let y = 18;
    if (s.tag) { g.fillStyle = '#ff6b6b'; g.font = `800 24px ${FONT}`; g.fillText(s.tag, 24, y); y += 32; }
    g.fillStyle = COLORS.text; g.font = `600 ${s.tag ? 26 : 30}px ${FONT}`;
    y = wrapText(g, s.text, 24, y, W - 48, s.tag ? 33 : 38, 3);
    if (s.note) { g.fillStyle = COLORS.dim; g.font = `500 18px ${FONT}`; g.fillText(s.note, 24, Math.min(H - 28, y + 2)); }
  }
  mapMarkers() {
    const app = this.app, m = [];
    const P = (arr) => new THREE.Vector3(...arr);
    switch (this.stage) {
      case 'suit': m.push({ kind: 'objective', pos: app.room.parts.armorRackGrabPoint.getWorldPosition(new THREE.Vector3()) }); break;
      case 'mirror': m.push({ kind: 'objective', pos: app.room.parts.mirror.root.getWorldPosition(new THREE.Vector3()) }); break;
      case 'window': m.push({ kind: 'objective', pos: P(roomToWorld([0, 1.5, -3])) }); break;
      case 'chase': m.push(...this.chaseCtl.markers()); break;
      case 'roofEvent': m.push({ kind: 'objective', pos: P(STORY.circle.pos) }); break;
      case 'factory': m.push({ kind: 'objective', pos: P(INTERIOR.arenaCircle.pos).add(P(INTERIOR.origin)) }); break;
      case 'escape': if (this.flow.doorMarkerPos) m.push({ kind: 'objective', pos: this.flow.doorMarkerPos }); break;
      case 'endless': { const w = app.cityWorld; for (let s = Math.floor(this.endless.playerS / 18) * 18; s < this.endless.playerS + 200; s += 18) m.push({ kind: 'route', pos: w.pointAt(s).setY(0) }); break; }
      default: break;
    }
    if (this.stage === 'chase' || this.stage === 'endless') for (const a of app.locomotion.markerAnchors) m.push({ kind: 'anchor', pos: a.p, active: app.locomotion.holds(a) });
    return m;
  }
}
void _w; void _q; void ROOM; void wrapText; void techFrame; void FONT;
