// v0.47 Story chase combat — one object, owned by Story, used by both the first chase (chase.js) and the chase after the
// factory (endless.js) through a small host object each of them passes to begin(). It brings most of World Chase's toolset
// into the Story (pumpkin aim lock, Light Bomb, Fan Web, web strikes on Green Maniac, the fly-in punch, hit reactions, impact
// bursts, Flow, impact time) with the stumble-and-punch loop of src/game/stumble.js in place of health and shield.
//
// What is NOT here, on purpose (design 4.4): boss health, shield, core and vent, the finisher, player health, defeat, a
// results panel, a run clock. Nothing in this file can end the chase; Green Maniac always gets away.
//
// The pure World Chase modules are imported and read; src/worlds/worldChase.js is neither imported nor changed (design 4.7):
// the few small pieces that are inlined there (web routing, the telegraph's held pumpkins, the fly-in) are duplicated here.
// Everything is behind settings.storyCombat: with the switch off begin() is never called and this object stays idle.
import * as THREE from 'three';
import { t } from '../core/i18n.js';
import { audio } from '../core/audio.js';
import { settings } from '../core/settings.js';
import { COLORS } from '../ui/panel.js';
import { STORY_CHASE } from '../data/storyChase.js';
import { STORY_COMBAT } from '../data/storyCombat.js';
import { FEEL } from '../data/feel.js';
import { CLOSE } from '../data/closeCombat.js';
import { GREEN_MANIAC_THROW_RELEASE } from '../art/enemies.js';
import { Stumble } from './stumble.js';
import { StoryAttacks, pacedSpeed, hitVelocity } from './storyAttacks.js';
import { ChaseBombs, flightTimeFor, planHeldThrows } from './chaseBombs.js';
import { Flow } from './flow.js';
import { FanWebFx } from './fanWebFx.js';
import { CHASE_COMBAT, selectTarget, shotIntent } from '../worlds/chaseCombat.js';
import { ChaseLightBombs } from '../worlds/chaseLightBombs.js';
import { FIGHT, heavyCounterOk } from '../worlds/bossFight.js';
import { Lunge, webAtBoss, rebound, segPointDist } from '../worlds/lunge.js';
import { pickReaction, ReactionGate } from '../worlds/hitReaction.js';
import '../worlds/i18n.js'; // (the fight / close strings reused below)

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3(), _hp = new THREE.Vector3(), _hf = new THREE.Vector3(), _hq = new THREE.Quaternion();
const _bv3 = new THREE.Vector3(), _O = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
const CHEST = 1.3, TT = STORY_COMBAT.tether, HANDS = ['left', 'right'], D2R = Math.PI / 180;
const IMPACT = { body: 0xff8a1a, flash: 0xffffff, sparks: 0xff6a20 }; // impact bursts on him (pooled fx.boom, as World Chase's)
const STALL_LINE_DELAY = 0.6; // s from the stall to his line
const FIRST_THROW = 3; // s after the loop starts running before his first telegraph may begin

export class StoryCombat {
  constructor(app, story) {
    this.app = app; this.story = story; this.cfg = STORY_CHASE;
    this.stumble = new Stumble(); this.attacks = new StoryAttacks(); this.flow = new Flow();
    this.reactGate = new ReactionGate(); this.lunge = new Lunge();
    this.bombs = null; this.lightBombs = null; this.fanFx = null; // built once by prepare()
    this.host = null; this.active = false; this.kind = null; this.clock = 0; this._runs = 0;
    this.bossPos = new THREE.Vector3(); this.bossPrev = new THREE.Vector3(); this._bossLast = new THREE.Vector3(); this._bossOk = false;
    this.jetAnchor = { id: 'JET-HOOK', p: new THREE.Vector3(), valid: false, moving: true, building: null, cell: null, kind: 'jet' }; // (its own object: never the v0.21 tether's)
    this.jetWeb = null; this.locks = { left: null, right: null }; this.held = []; this._tele = null;
    this._lunging = false; this._lungeBeam = null; this._rb = { x: 0, y: 0, z: 0 }; this._hv = { x: 0, y: 0, z: 0 };
    this._prevRel = new THREE.Vector3(); this._relOk = false; this._contactT = -9; this._fxT = -9; this._dt = 1 / 72;
    this._chest = new THREE.Vector3(); this._feet = new THREE.Vector3(); this._compiled = false; this._sayAt = -1; this._los = false; this._losT = 0; this._boost = false; this._recoverAt = -1; this._saved = null;
    this._popT = {}; this._hints = {}; this._blk = 0; this._wasRunning = false;
    this.totals = { style: 0, punches: 0, pumpkins: 0, peakFlow: 0 }; // the whole Story run (both chases)
    this._firstStall = false; this._shieldHint = false; this._spreadHint = false;
    this._newStats();
  }
  _newStats() { this.cstats = { stalls: 0, timeouts: 0, punches: 0, strikes: 0, lunges: 0, lungeHits: 0, contacts: 0, hitsTaken: 0, jetWebs: 0, fans: 0, counters: 0, bursts: 0 }; }

  // ================================================================ state
  /** The dev switch (default on). Off = v0.46 Story: nothing here runs. */
  get on() { return settings.storyCombat !== false; }
  get closeOn() { return settings.closeCombat !== false; }
  get flowOn() { return settings.flowMeter !== false; }
  /** begin() was called and stop() was not, and the host says the loop may act this frame (outside the room, a throw state). */
  get running() { return this.active && !!this.host && !!this.host.active(); }
  get stalled() { return this.stumble.state === 'stalled'; }
  get lunging() { return this._lunging; }
  get lightBombReady() { return !this.lightBombs || this.lightBombs.ready; }
  /** Stats of the whole Story run: style score, punches landed, pumpkins destroyed, peak Flow level. */
  get stats() { return { style: Math.round(this.totals.style + this.flow.style), punches: this.totals.punches, pumpkins: this.totals.pumpkins, peakFlow: Math.max(this.totals.peakFlow, this.flow.peak) }; }
  /** Red ring: he is stalled, the gap along the route is stall.ringRange or less, the line to him is clear (close combat on). */
  get ringOn() { return this.running && this.closeOn && this.stalled && this._bossOk && (this._lunging || (this.host.gap() <= this.cfg.stall.ringRange && this._ringLos)); }
  /** Blue ring on the jet hook: he is stalled, beyond the red ring's range, and a web can stick to the jet from here. */
  get jetWebOk() { return this.running && this.stalled && this._bossOk && !this._lunging && !this.jetWeb && !this.ringOn && this._jetReach; }
  /** The ring to draw right now, or null: red on him inside the ring range (the fly-in), blue on the jet hook beyond it (web + pull). Only while he is stalled. */
  ring() {
    if (this.ringOn) return { pos: this.bossPos, r: CLOSE.ring.radius, color: CLOSE.ring.color, red: true };
    if (this.jetWebOk) return { pos: this.jetAnchor.p, r: 0.9, color: 0x7ef0ff };
    return null;
  }
  /** His roll wobble while the jet sputters (radians, added to the host's bank). */
  bankWobble(tNow) { return this.active && this.stalled ? Math.sin(tNow * 4.2) * 0.14 : 0; }

  // ================================================================ pools (built once; compiled before play)
  /** Build the pumpkin, Light Bomb and Fan Web pools. Safe to call again. */
  prepare() {
    if (this.bombs) return;
    const app = this.app;
    this.bombs = new ChaseBombs(app, { ...STORY_COMBAT.bombs, ...CHASE_COMBAT.bombs, maxActive: 4, giantScale: FIGHT.heavy.scale, swept: true }); // (World Chase's pool: a spread of three + one)
    this.bombs.root.name = 'storyCombatBombs';
    this.bombs.onPlayerHit = (it) => this._playerHit(it);
    this.bombs.onShotDown = (it, by) => this._onPumpkinDown(it, by);
    const pre = []; for (let i = 0; i < 4; i++) pre.push(this.bombs._get('normal')); pre.push(this.bombs._get('giant')); // every model exists before play
    for (const it of pre) if (it) this.bombs._free(it);
    this.lightBombs = new ChaseLightBombs(app);
    this.fanFx = new FanWebFx(app.scene, 2, app.fx);
    app.fx.preloadPopups?.([['close.hit', COLORS.perfect], ['fight.counter', COLORS.perfect]]); // popup textures made ahead of time (no canvas work during play)
  }
  /**
   * Compile every material this object can show (pumpkins + their highlight hulls, the heavy pumpkin, Light Bombs, the Fan
   * Web, the jet's sparks) against the scene's current lights, so nothing compiles during play. Cheap when already compiled.
   */
  compile() {
    const app = this.app, r = app.renderer; if (!this.bombs || !r?.compile) return;
    const go = (o) => { try { r.compile(o, app.camera, app.scene); } catch (e) { console.warn('storyCombat compile', e?.message || e); } };
    for (const lvl of [1, 2, 0]) { for (const it of this.bombs.items) it.p.setHighlight?.(lvl); go(this.bombs.root); }
    go(this.lightBombs.root);
    if (this.bombs.pathFx) { this.bombs.pathFx.prewarm(true); go(this.bombs.pathFx.mesh); this.bombs.pathFx.prewarm(false); } // v1.1 the path preview
    for (const f of this.fanFx.fans) { const m0 = f.m.material; for (const m of [f.mat, f.mat2]) if (m) { f.m.material = m; go(f.m); } f.m.material = m0; }
    go(this.fanFx.root); go(app.boss.jet.root);
    // the Story chase's own pooled visuals, first shown mid-chase until now (the v0.30 compile test counted them): the pooled
    // webs / nets / bursts / popups, the arrival circle and turn arrow, the boss marker and target ring, the Bitcoins
    const ch = this.story.chaseCtl;
    // … and what hangs on the camera (the comfort vignette a fly-in's speed brings up, the HUD panels, the fade)
    for (const o of [app.fx.root, ch?.root, ch?.bossMarker, ch?.targetRing, app.coins?.root, app.camera]) if (o) go(o);
    // … and the objects the v0.30 title warm-up shows for its first frames (wind streaks…): compiled here as well, so a
    // Story started before those frames were drawn still has them ready
    for (const w of app.fx.vfx?.warmObjs || []) if (w.obj) go(w.obj);
    this._compiled = true;
  }
  /** A new Story run (Story.start): the run totals and the once-per-run hints start again. */
  resetRun() {
    this.totals.style = 0; this.totals.punches = 0; this.totals.pumpkins = 0; this.totals.peakFlow = 0;
    this.flow.reset(); this._firstStall = false; this._shieldHint = false; this._spreadHint = false; this._bombHint = false;
  }

  // ================================================================ lifecycle
  /**
   * Start the loop for one chase. host: { kind, world (segmentBlocked / pointBlocked), bossS(), playerS(), gap(),
   * segmentTier(), throwsAllowed(), active(), capBossSpeed(v | null), jetDamage (the jet's resting damage look, 0 … 1) }.
   * tier: the base tier (1 the first chase, STORY_CHASE.endless.startTier after the factory).
   */
  begin(host, { tier = 1 } = {}) {
    if (this.active) this.stop();
    this.prepare();
    const app = this.app, loco = app.locomotion;
    this.host = host; this.kind = host.kind || 'chase'; this.active = true; this.clock = 0; this._runs++;
    this.stumble.reset({ tier }); this.attacks.reset(0x57a11 + this._runs * 7919); this.reactGate.reset(); this.lunge.reset();
    this.bombs.reset(0x5eed + this._runs); this.bombs.world = host.world; this.lightBombs.reset(); this.fanFx.clear();
    this._newStats(); this._clear(true);
    this._bossOk = false; this._los = false; this._losT = 0; this._ringLos = false; this._jetReach = false; this._boost = false; this._recoverAt = -1;
    this._contactT = -9; this._fxT = -9; this._popT = {}; this._hints = {}; this._wasRunning = false; this._bombHint = false; this._hintAt = 0; this._ringHint = this._jetHint = -1;
    this._blk = app.shield?.stats.blocked || 0;
    this._saved = { onPull: loco.onPull, onRelease: loco.onRelease };
    loco.onPull = () => this._flowGain('pull');
    loco.onRelease = (sp) => { if (this.running) { if (sp >= FEEL.flow.releaseSpeed) this._flowGain('release'); app.speedFx?.onRelease(sp); } };
    if (!this._compiled) this.compile(); // (Story.start already did it for this run; only a switch turned on mid-run compiles here)
  }
  /** The chase is over (or the Story stopped, or the switch went off): nothing is left running. The run totals are kept. */
  /** He rides the jet again (after a stall's hurt pose) and the jet shows its resting damage look. A hit reaction in progress plays on, then returns to the ride. */
  _restoreBoss() {
    const boss = this.app.boss, m = boss.maniac;
    if (m && (m.state === 'hurt' || m.state === 'hit' || this.stalled || this._recoverAt >= 0)) m.setState(m.facingBack ? 'faceFront' : 'ride');
    boss.jet.setDamage(this.host?.jetDamage || 0); boss.jet.setThrust(1);
  }
  stop() {
    if (!this.active) return;
    const app = this.app, loco = app.locomotion;
    this._restoreBoss();
    this._clear(false); this.stumble.cancel();
    this.totals.style += this.flow.style; this.totals.peakFlow = Math.max(this.totals.peakFlow, this.flow.peak); this.flow.reset(); this._flowFx(-1);
    if (this._saved) { loco.onPull = this._saved.onPull; loco.onRelease = this._saved.onRelease; this._saved = null; }
    this.host?.capBossSpeed?.(null);
    app.boss.jet.setThrust(1); app.hud.setStory?.(null);
    this.host = null; this.active = false; this._wasRunning = false;
  }
  /** He reached the roof (or the host leaves the throw states): a stall, a fly-in, the jet web and every pumpkin end; pressure 0. */
  cancel() {
    if (!this.active) return;
    this._restoreBoss(); // (before the stall state is dropped: the roof finale and a checkpoint get him as v0.46 had him)
    this._clear(false); this.stumble.cancel(); this._boost = false; this._recoverAt = -1;
    this.host?.capBossSpeed?.(null);
  }
  /** A fall / leaving the corridor sent the player to a checkpoint: as cancel(), and one Flow level is lost (design 4.3). */
  respawn() { if (!this.active) return; this.cancel(); if (this.flowOn) this.flow.hurt(); }
  /** Pools emptied, the rig released, no web on the jet, no telegraph. quiet: no release sound. */
  _clear(quiet) {
    this.bombs?.clear(); this.lightBombs?.clear(); this.fanFx?.clear();
    this._endLunge('clear'); this._releaseJetWeb(true);
    this.held.length = 0; this._tele = null; this.attacks.cancel();
    this.locks.left = this.locks.right = null; this._relOk = false; this._sayAt = -1;
    void quiet;
  }

  // ================================================================ per frame
  /** dt = the Story's scaled (impact time) step; realDt = the unscaled one; tNow = the Story's clock (bob / pulse phases). */
  update(dt, realDt, tNow) {
    if (!this.active) return;
    const app = this.app, host = this.host, loco = app.locomotion, boss = app.boss, hud = app.hud;
    if (!host.active()) { // the room, the fly-by, the roof: nothing acts and nothing of ours is in the air
      if (this._wasRunning) { this._wasRunning = false; this.cancel(); }
      this._flowFx(-1); hud.setStory?.(null);
      return;
    }
    this._wasRunning = true;
    this.clock += dt; if (dt > 0) this._dt = dt;
    this._refresh();
    this.bossPrev.copy(this._bossOk ? this._bossLast : this.bossPos); this._bossLast.copy(this.bossPos); this._bossOk = boss.root.visible;
    const feet = loco.feet(this._feet), chest = this._chest.copy(feet).add(_v.set(0, CHEST, 0));
    this._updateLocks(chest);
    for (const e of app.hub.events) if (e.type === 'fanWeb') this._onFanWeb(e, chest);
    // the fly-in (scripted rig motion) and body contact
    if (this._lunging) { if (this.stalled && this.closeOn && boss.root.visible && !this._fading()) this._updateLunge(dt, loco, chest, feet); else this._endLunge(this.stalled ? 'state' : 'stallEnd'); }
    this._checkContact(chest);
    // Light Bomb (the Arcade's input, free of the beat; World Chase's projectile)
    this.lightBombs.update(dt, { events: app.hub.events, clock: this.clock, allowThrow: !this._fading(), bombs: this.bombs, world: host.world, chest, playerVel: loco.vel,
      boss: { pos: this.bossPos, prev: this.bossPrev, radius: CHASE_COMBAT.boss.radius, valid: boss.root.visible },
      heavyRadius: FIGHT.heavy.hitRadius,
      onBossHit: (dmg, at) => this._bossHit('lightBomb', at) });
    // the stumble loop
    this.stumble.update(dt);
    for (const e of this.stumble.drain()) this._onStumble(e, chest);
    if (this._sayAt >= 0 && this.clock >= this._sayAt) { this._sayAt = -1; if (this.stalled) app.voice?.say('STALL', boss.maniac.root); }
    if (this._recoverAt >= 0 && this.clock >= this._recoverAt) { this._recoverAt = -1; audio.play('jetRecover', 0, this.bossPos); boss.jet.setThrust(1); boss.maniac.setState(boss.maniac.facingBack ? 'faceFront' : 'ride'); } // after a punch: the jet catches and he rides again (the Head Hit plays out first)
    this._updateJetWeb(dt, loco);
    this._updateAttacks(dt, chest);
    this.bombs.update(dt, { allow: false, boss, chest, playerVel: loco.vel }); // (the scheduler above decides every throw; ChaseBombs' own stays off)
    this.fanFx.update(dt);
    this._updateFlow(dt);
    // the jet: pressure is its damage look (the only indicator); a stall sputters
    boss.jet.setDamage(this.stalled ? 1 : Math.max(host.jetDamage || 0, 0.7 * this.stumble.frac));
    if (this.stalled) boss.jet.setThrust(0.2);
    host.capBossSpeed?.(this._lunging ? 0 : this.stalled ? this.cfg.stall.speedCap : null);
    // rings (read by the host's visuals): line of sight to him / reach of the jet hook, a few times a second
    if ((this._losT -= 1) <= 0) {
      this._losT = 6; const w = host.world, p = this.jetAnchor.p, dj = chest.distanceTo(p);
      const clear = this.stalled && boss.root.visible && !w?.segmentBlocked(chest.x, chest.y, chest.z, p.x, p.y, p.z);
      this._ringLos = clear; this._jetReach = clear && dj >= TT.minDist && dj <= TT.maxDist;
    }
    // v0.49: the red ring is on → he turns on the jet to face the player (the Taunt pose), once per stall, and stays turned until it ends
    if (this.stumble.face(this.ringOn)) boss.maniac.setState('taunt');
    // one hint per stall and ring, once the stall's own banner has had its time
    if (this.stalled && this.clock >= this._hintAt) {
      const n = this.stumble.stalls;
      if (this.ringOn) { if (this._ringHint !== n) { this._ringHint = n; hud.showBanner(t('close.hint'), 2.0, COLORS.bad); } }
      else if (this.jetWebOk && this._jetHint !== n) { this._jetHint = n; hud.showBanner(t('close.pull'), 2.0, COLORS.perfect); }
    }
    if (this.bombs.stats.thrown >= 1 && !this._bombHint) { this._bombHint = true; hud.showBanner(t('story.hint.bombs'), 2.6, COLORS.warn); }
    hud.setStory?.(this.hud());
    void realDt; void tNow;
  }
  /** HUD data for the Story panel: Light Bomb readiness and the Flow pips. Nothing else (no health, no boss bar). */
  hud() {
    const lb = this.lightBombs, F = this.flow, T = FEEL.flow.thresholds, L = F.level;
    const lo = L ? T[L - 1] : 0, frac = L >= T.length ? 1 : THREE.MathUtils.clamp((F.points - lo) / (T[L] - lo), 0, 1);
    return { bomb: lb.readiness, bombReady: lb.ready, flow: this.flowOn ? { level: L, frac } : null };
  }
  _fading() { return this.story.fade.a > 0.01; }
  /** The jet hook and his body centre for this frame (also called by onWeb, which runs before update()). */
  _refresh() {
    const b = this.app.boss;
    b.root.updateMatrixWorld(true);
    this.jetAnchor.p.set(...TT.hook); b.jet.root.localToWorld(this.jetAnchor.p);
    b.maniac.hitCenter.getWorldPosition(this.bossPos); this.bossPos.lerp(b.root.getWorldPosition(_v), 0.35); // between his chest and the jet (World Chase's body point)
  }
  /**
   * His speed along the route for this frame. base = the host's v0.46 pacing speed, gap = his lead (m), playerSpeed = the
   * player's route speed, lead = the lead he wants back after a break-away. Idle (switch off, not running): base.
   */
  bossSpeed(base, gap, playerSpeed, lead = 30) {
    if (!this.running) return base;
    if (this._lunging) return 0; // he hangs in place while the player flies in
    if (this._boost && (gap >= lead || this.stumble.state !== 'lockout')) this._boost = false; // he has his lead back
    return pacedSpeed({ base, gap, playerSpeed, state: this.stumble.state, boost: this._boost ? this.cfg.pacing.boost : 0 }, this.cfg);
  }

  // ================================================================ aim lock, webs
  _pumpkinCands() {
    const out = this._cands || (this._cands = []); out.length = 0;
    for (const it of this.bombs.items) if (it.active && it.phase === 'fly') out.push({ pos: it.pos, vel: it.vel, key: `p${it.id}`, it, radius: it.kind === 'giant' ? FIGHT.heavy.hitRadius : undefined });
    return out;
  }
  _pickPumpkin(origin, dir, lock, chest) {
    const cands = this._pumpkinCands(); if (!cands.length) return null;
    const cam = this.app.camera, head = cam.getWorldPosition(_hp), fwd = _hf.set(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(_hq)), w = this.host.world;
    return selectTarget(origin, dir, cands, { ...CHASE_COMBAT.aim, head, headFwd: fwd, chest, lock, occluded: (o, p) => !!w?.segmentBlocked(o.x, o.y, o.z, p.x, p.y, p.z) });
  }
  /** Per-hand pumpkin lock (the highlight is the pumpkin a web from that hand will hit); the heavy pumpkin's counter window shows as the stronger highlight. */
  _updateLocks(chest) {
    const hub = this.app.hub, lit = this._lit || (this._lit = new Set()); lit.clear();
    for (const h of HANDS) {
      const a = hub.aim[h], pk = a?.valid && !hub.ctx.menuOpen ? this._pickPumpkin(a.origin, a.dir, this.locks[h], chest) : null;
      this.locks[h] = pk ? pk.cand.key : null; if (pk) lit.add(pk.cand.it);
    }
    const jet = this.app.boss.root.position;
    for (const it of this.bombs.items) {
      const counter = it.active && it.phase === 'fly' && it.kind === 'giant' && it.launchT != null && this.stumble.state === 'chasing' && heavyCounterOk(this.clock - it.launchT, it.pos.distanceTo(jet));
      this.bombs.highlight(it, counter ? 2 : it.active && lit.has(it) ? 1 : 0);
    }
  }
  /** Green Maniac in the web's aim (World Chase's cone: 7 degrees + his radius, 48 m, a clear line)? */
  _bossAim(origin, dir) {
    if (!this.app.boss.root.visible) return null;
    const B = CHASE_COMBAT.boss, w = this.host.world;
    return selectTarget(origin, dir, [{ pos: this.bossPos, radius: B.radius, key: 'boss' }], { coneDeg: B.aimDeg, maxRange: B.webRange, minRange: 1, occlusionChecks: 1, occluded: (o, p) => !!w?.segmentBlocked(o.x, o.y, o.z, p.x, p.y, p.z) });
  }
  /**
   * One wrist web during the chase. True when it was used here: (1) a pumpkin that threatens or that this hand's lock
   * highlights, (2) Green Maniac when the aim is closer to him than to a pumpkin (a web strike; stalled: the jet web or the
   * fly-in), (3) a pumpkin against a swing anchor by intent. False: the caller swings with it as usual.
   */
  onWeb(e, loco, chest) {
    if (!this.running) return false;
    if (this._lunging) return true; // the fly-in owns the rig (both hands)
    this._refresh();
    const A = CHASE_COMBAT.aim;
    const pk = this._pickPumpkin(e.origin, e.dir, this.locks[e.hand], chest);
    const boss = this._bossAim(e.origin, e.dir);
    this.lastPick = { t: +this.clock.toFixed(2), hand: e.hand, pumpkin: pk ? +pk.angle.toFixed(1) : null, boss: boss ? +boss.angle.toFixed(1) : null };
    if (pk && (pk.tti < A.imminent || pk.sticky)) { this._shootPumpkin(pk, e); this.lastPick.took = 'pumpkin'; return true; }
    if (boss && (!pk || boss.norm <= pk.norm)) { this.lastPick.took = 'boss'; this._webBoss(e, loco, chest); return true; }
    if (pk) {
      const other = loco.ropeOf(e.hand === 'left' ? 'right' : 'left')?.anchor || null, anc = loco.pickAnchor(e.origin, e.dir, other);
      if (shotIntent(pk, anc ? anc.score : null, A) === 'pumpkin') { this._shootPumpkin(pk, e); this.lastPick.took = 'pumpkin'; return true; }
    }
    this.lastPick.took = 'swing';
    return false;
  }
  _shootPumpkin(pk, e) {
    if (this.bombs.shootDown(pk.cand.it, e.origin, 'web')) this.app.hub.haptic?.(e.hand, 0.35, 30); // (pressure, Flow, the heavy counter: _onPumpkinDown)
    if (this.locks[e.hand] === pk.cand.key) this.locks[e.hand] = null;
  }
  /**
   * A web aimed at him (design 4.1, World Chase's webAtBoss): not stalled → a web strike (pressure); stalled: inside the red
   * ring's range → the fly-in, beyond it within the tether's reach → the web sticks to the jet. No line → a strike.
   */
  _webBoss(e, loco, chest) {
    const app = this.app, p = this.jetAnchor.p, dist = chest.distanceTo(p), stalled = this.stalled, w = this.host.world;
    const los = stalled && !w?.segmentBlocked(chest.x, chest.y, chest.z, p.x, p.y, p.z);
    const how = this._fading() ? 'strike' : webAtBoss({ staggered: stalled, inClose: this.closeOn && this.host.gap() <= this.cfg.stall.ringRange, los, dist, minDist: TT.minDist, maxDist: TT.maxDist, tethered: !!this.jetWeb });
    this.lastPick.how = how;
    if (how === 'lunge') { this._startLunge(e, loco, chest); return; }
    if (how === 'attach') {
      this.jetAnchor.valid = true;
      if (loco.attachTo(this.jetAnchor, e)) { this._startJetWeb(); return; }
      this.jetAnchor.valid = false;
    }
    // web strike: the web visibly reaches him
    const at = _hf.copy(e.origin).sub(this.bossPos); const L = at.length(); at.multiplyScalar(Math.min(0.9, Math.max(0, L - 0.5)) / Math.max(L, 1e-6)).add(this.bossPos);
    app.fx.web(e.origin, at); app.fx.net(at.clone(), 0.5); audio.play('webHit', 0, at);
    if (!this._bossHit('web', at.clone())) { audio.play('fizzle'); app.hub.haptic?.(e.hand, 0.15, 20); } // rate limited, or he is breaking away
  }
  /** A hit on him that may build pressure. src: 'web' | 'lightBomb'. True when it counted (then: burst, reaction, sound, Flow). */
  _bossHit(src, at) {
    if (!this.stumble.gain(src, this.clock)) return false;
    const app = this.app;
    if (src === 'web') this.cstats.strikes++;
    if (src !== 'lightBomb') this._impactFx(src, at); // (a Light Bomb's own blast is the burst: no second one on top of it)
    this._react(src);
    audio.play('bossHit', 0, at); for (const h of HANDS) app.hub.haptic?.(h, 0.3, 30);
    this._flowGain('bossHit');
    this.lastHit = { t: +this.clock.toFixed(2), src, pressure: this.stumble.pressure };
    return true;
  }
  /** Hit reaction on Green Maniac (close combat on): Head Hit / Hit To Body, at most one per CLOSE.react.minGap, never during a wind-up or throw. */
  _react(src) {
    if (!this.closeOn) return false;
    if (!this.reactGate.allow(this.clock, this.attacks.state === 'telegraph' ? 'telegraph' : this.attacks.state === 'hold' ? 'attack' : 'protected')) return false;
    if (!this.app.boss.maniac.setState('hit', pickReaction(src))) return false;
    this.reactGate.mark(this.clock);
    return true;
  }
  /** Impact burst at the hit point: pooled fx.boom, at most one per CLOSE.fx.minGap (a punch always shows). */
  _impactFx(src, at) {
    const punch = src === 'punch';
    if (!punch && this.clock - this._fxT < CLOSE.fx.minGap) return false;
    this._fxT = this.clock; this.cstats.bursts++;
    const fx = this.app.fx;
    fx.boom(at, { color: IMPACT.body, size: punch ? 1.8 : src === 'lightBomb' || src === 'counter' ? 1.1 : 0.6, life: punch ? 0.55 : 0.4 });
    if (punch && !settings.comfortMode) fx.boom(at, { color: IMPACT.flash, size: 1.3, life: 0.2 });
    return true;
  }
  _pop(key, at, color, gap = 0.4) { const n = this.clock; if ((this._popT[key] ?? -9) + gap > n) return; this._popT[key] = n; this.app.fx.popup(key, at, color); }

  // ================================================================ pumpkins: destroyed / reached the player
  /** A pumpkin was destroyed by a web, a Light Bomb or the Fan Web: pressure, the run total, Flow; a heavy one inside its counter window stalls him at once. */
  _onPumpkinDown(it, by) {
    if (!this.active) return;
    this.totals.pumpkins++;
    if (it.kind === 'giant' && it.launchT != null && heavyCounterOk(this.clock - it.launchT, it.pos.distanceTo(this.app.boss.root.position)) && this.stumble.counter()) {
      this.cstats.counters++;
      this.app.fx.vfx?.giantBlast?.(it.pos, { size: 0.9, smoke: false }) || this.app.fx.boom(it.pos, { color: 0xff8a1a, size: 2, life: 0.7 });
      this._pop('fight.counter', _w.copy(it.pos).add(_v.set(0, 1.2, 0)).clone(), COLORS.perfect, 0);
      this._flowGain('counter');
      return;
    }
    this.stumble.gain('pumpkin', this.clock);
    if (by !== 'fan') this._flowGain('pumpkin'); // (the Fan Web counts once per fan)
  }
  /**
   * A pumpkin blast reached the player (ChaseBombs already played today's flash, sound and haptics). Design 4.3: 40 % of
   * horizontal speed lost with a small push away from the blast (never downward), one Flow level lost, pressure − 2.
   * No health: nothing here can end the chase.
   */
  _playerHit(it) {
    const app = this.app, loco = app.locomotion;
    this.cstats.hitsTaken++;
    const v = hitVelocity(loco.vel, _d.copy(this._chest).sub(it.pos), this.cfg, this._hv);
    loco.vel.set(v.x, v.y, v.z);
    if (this.flowOn) this.flow.hurt();
    this.stumble.playerHit();
    audio.play('playerHit');
    if (!this._shieldHint && app.hub.inputKind === 'hands' && settings.palmShield !== false && !app.shield?.stats.blocked) { this._shieldHint = true; app.hud.showBanner(t('hint.shield'), 3.0, COLORS.text); }
  }

  // ================================================================ Fan Web (World Chase's spatial fan: no beat)
  _onFanWeb(e, chest) {
    const F = CHASE_COMBAT.fan, w = this.host.world, app = this.app, o = e.origin || chest;
    const dir = _d.copy(e.dir || _v.set(0, 0, -1)); dir.y *= 0.5; dir.normalize();
    const fly = this.bombs.items.filter((it) => it.active && it.phase === 'fly');
    const ang = (p) => { _w.copy(p).sub(o); const L = _w.length(); return { L, a: Math.acos(THREE.MathUtils.clamp(_w.dot(dir) / Math.max(L, 1e-6), -1, 1)) / D2R }; };
    const inCone = (it) => { const q = ang(it.pos); return q.L <= F.range && q.a <= F.coneDeg + Math.atan((it.kind === 'giant' ? FIGHT.heavy.hitRadius : 1.2) / Math.max(1, q.L)) / D2R && !w?.segmentBlocked(o.x, o.y, o.z, it.pos.x, it.pos.y, it.pos.z); };
    let hit = fly.filter(inCone);
    if (!hit.length) { // re-centre on the incoming group when it is roughly in front
      const near = fly.filter((it) => { const q = ang(it.pos); return q.L <= F.range && q.a <= F.groupDeg; });
      if (near.length) { _v.set(0, 0, 0); for (const it of near) _v.add(it.pos); _v.divideScalar(near.length).sub(o).normalize(); dir.copy(_v); hit = fly.filter(inCone); }
    }
    this.cstats.fans++; audio.play('fanCharge');
    const pts = hit.map((it) => it.pos.clone());
    if (!pts.length) for (const k of [-1, 0, 1]) pts.push(_w.copy(dir).applyAxisAngle(_Y, k * F.coneDeg * 0.8 * D2R).multiplyScalar(14).add(o).clone());
    this.fanFx.fire(o, pts, 0x4fc8ff, { hit: hit.length > 0 });
    for (const it of hit) if (this.bombs.shootDown(it, o, 'fan')) this.fanFx.burst(it.pos, app.camera.getWorldPosition(_hp));
    if (hit.length) { audio.play('fanHit'); for (const h of HANDS) app.hub.haptic?.(h, 0.45, 50); this._flowGain('fan'); }
  }

  // ================================================================ tiered attacks (design 4.2)
  _updateAttacks(dt, chest) {
    const app = this.app, boss = app.boss, host = this.host, B = this.bombs, w = host.world;
    if ((this._losA = (this._losA || 0) - 1) <= 0) { this._losA = 12; boss.throwPoint(_w); this._los = !w?.segmentBlocked(_w.x, _w.y, _w.z, chest.x, chest.y, chest.z); } // ≈ 5 × a second
    const allow = this.clock > FIRST_THROW && host.throwsAllowed() && this.stumble.state !== 'stalled' && !this._lunging && !this._fading() && boss.root.visible && this._los;
    const flying = B.items.reduce((n, it) => n + (it.active && it.phase === 'fly' ? 1 : 0), 0);
    this.tier = this.stumble.tier(host.segmentTier());
    for (const e of this.attacks.update(dt, { tier: this.tier, allow, dist: boss.root.position.distanceTo(chest), flying })) this._onAttack(e, chest);
    // telegraph: the held pumpkins follow his hand (decorative: phase 'held' — never a target)
    const T = this._tele;
    if (T && this.attacks.state === 'telegraph') {
      T.t += dt; const len = FIGHT.telegraph[T.kind];
      if (T.kind === 'heavy' && !T.turned && T.t >= len - 0.6 - GREEN_MANIAC_THROW_RELEASE) { T.turned = true; boss.maniac.setState('turn'); }
      if (!T.threw && T.t >= len - GREEN_MANIAC_THROW_RELEASE) { T.threw = true; boss.throw(); }
      boss.throwPoint(_w); boss.root.updateMatrixWorld(true);
      _d.set(1, 0, 0).transformDirection(boss.root.matrixWorld); // the jet's right axis (the spread fans out along it)
      const k = Math.min(1, T.t / len);
      this.held.forEach((it, i) => {
        if (!it.active) return;
        if (T.kind === 'heavy') { const up = T.threw ? 0 : 1; boss.maniac.hitCenter.getWorldPosition(_v); it.pos.copy(_v).addScaledVector(_d, 0.9 * up).add(_hf.set(0, 0.5 * up, 0)).lerp(_w, T.threw ? 1 : 0); it.p.root.scale.setScalar(FIGHT.heavy.scale * (0.55 + 0.45 * Math.min(1, k * 1.6))); }
        else if (T.kind === 'spread') it.pos.copy(_w).addScaledVector(_d, (i - 1) * (0.25 + 0.45 * Math.min(1, k * 2))).add(_hf.set(0, Math.abs(i - 1) * -0.1, 0));
        else it.pos.copy(_w);
        it.p.root.position.copy(it.pos); it.p.setGlow(0.5 + 0.5 * Math.abs(Math.sin(T.t * (T.kind === 'heavy' ? 9 : 14)))); it.p.update(dt); it.p.root.lookAt(chest);
      });
      planHeldThrows(B, this.held, T, k, chest, boss.root.position); // v1.1 path preview: the flight each held pumpkin would take if released now
    }
  }
  _freeHeld() { for (const it of this.held) if (it.active && it.phase === 'held') this.bombs._free(it); this.held.length = 0; this._tele = null; }
  _onAttack(e, chest) {
    const app = this.app, boss = app.boss, B = this.bombs, H = FIGHT.heavy, loco = app.locomotion;
    switch (e.type) {
      case 'telegraph': {
        const k = e.attack; this._freeHeld(); this._tele = { kind: k, t: 0, threw: false, turned: false, heavyT: k === 'heavy' ? H.flight[0] + this.attacks.peek() * (H.flight[1] - H.flight[0]) : 0 }; // (v1.1: the heavy flight time the release will roll, for the path preview)
        for (let i = 0, n = k === 'spread' ? 3 : 1; i < n; i++) { const it = B._get(k === 'heavy' ? 'giant' : 'normal'); if (it) { it.phase = 'held'; boss.throwPoint(it.pos); it.p.root.position.copy(it.pos); this.held.push(it); } }
        if (k === 'heavy') {
          boss.maniac.setState('angry'); audio.play('alarm'); audio.playOr('heavyWindup', 'heavyWindupStory'); // (the sample, else the Story's own synthesized wind-up: 'heavyWindup' itself stays silent as in v0.44)
          app.hud.showBanner(t('fight.heavyIncoming'), 1.8, COLORS.bad, t('story.heavySub'));
          if (this.held[0]) app.fx.vfx?.giantCharge?.(this.held[0].p);
        } else {
          boss.maniac.setState('turn'); audio.play('tick');
          if (k === 'spread' && !this._spreadHint) { this._spreadHint = true; app.hud.showBanner(t('fight.spreadIncoming'), 2.0, COLORS.warn, t(app.hub.inputKind === 'hands' ? 'fight.spreadHowHands' : 'fight.spreadHow')); }
        }
        break;
      }
      case 'release': {
        const k = e.attack, its = this.held.filter((it) => it.active && it.phase === 'held'); this.held.length = 0; this._tele = null;
        if (!its.length) break;
        if (k === 'spread') {
          _d.copy(chest).sub(boss.root.position).setY(0).normalize(); _hf.set(-_d.z, 0, _d.x); // lateral axis at the player
          its.forEach((it, i) => B._launch(it, chest, loco.vel, { T: FIGHT.spread.flight + 0.08 * Math.abs(i - 1), offset: _hp.copy(_hf).multiplyScalar((i - 1) * FIGHT.spread.lateral) }));
        } else if (k === 'heavy') {
          const it = its[0], T = H.flight[0] + this.attacks.rand() * (H.flight[1] - H.flight[0]);
          B._launch(it, chest, loco.vel, { T, blast: H.blast, gravity: H.gravity }); it.launchT = this.clock;
          app.hud.showBanner(t('fight.counterNow'), 1.3, COLORS.perfect, '');
        } else { const it = its[0]; B._launch(it, chest, loco.vel, { T: THREE.MathUtils.clamp(flightTimeFor(it.pos.distanceTo(chest), B.cfg), FIGHT.single.flight[0], FIGHT.single.flight[1]) }); }
        break;
      }
      case 'cancel': this._freeHeld(); if (boss.maniac.state === 'turn' || boss.maniac.state === 'angry') boss.maniac.setState(boss.maniac.facingBack ? 'faceFront' : 'ride'); break;
      default: break;
    }
  }

  // ================================================================ the stumble loop's look and sound
  _onStumble(e, chest) {
    const app = this.app, boss = app.boss, hud = app.hud;
    switch (e.type) {
      case 'stall': {
        this.cstats.stalls++; this._freeHeld(); this.attacks.cancel(); this._boost = false; this._recoverAt = -1;
        boss.maniac.setState('hurt'); boss.jet.setThrust(0.2);
        audio.play('stagger', 0, this.bossPos); audio.play('jetStall', 0, this.bossPos);
        for (const h of HANDS) app.hub.haptic?.(h, 0.6, 90);
        app.fx.boom(this.bossPos, { color: IMPACT.sparks, size: 0.7, life: 0.5 }); // sparks off the jet (a colour the instanced effect kit takes: no extra draw calls while its systems are already on screen)
        if (settings.impactTime !== false) app.timeWarp?.request(e.cause === 'counter' ? 'counter' : 'break', { comfort: !!settings.comfortMode });
        if (!this._firstStall) { this._firstStall = true; this._hintAt = this.clock + 3.0; hud.showBanner(t('story.stall.first'), 3.0, COLORS.perfect, t('story.stall.firstSub')); } // once per Story run (it already says what to do)
        else { this._hintAt = this.clock + 0.9; hud.showBanner(t('story.stall.jet'), 1.4, COLORS.perfect, ''); }
        this._sayAt = this.clock + STALL_LINE_DELAY; // his line comes a beat after the sputter (and its subtitle panel after the burst)
        this._losT = 0; // (the ring is evaluated on this frame)
        break;
      }
      case 'recover': // the stall timed out: no punch, no reward — he pulls away
        this.cstats.timeouts++; this._boost = true; this._releaseJetWeb(false); this._endLunge('stallEnd');
        audio.play('jetRecover', 0, this.bossPos); boss.jet.setThrust(1);
        boss.maniac.setState(boss.maniac.facingBack ? 'faceFront' : 'ride');
        break;
      case 'punch': this._boost = true; this._recoverAt = this.clock + 0.45; break; // (the hit itself: _contact; the jet catches a moment later)
      default: break; // lockoutEnd: pressure can build again, nothing to show
    }
    void chest;
  }

  // ================================================================ a web on the jet (only while he is stalled; no counter)
  _startJetWeb() {
    this.jetWeb = { t: 0 }; this.cstats.jetWebs++;
    const app = this.app, p = this.jetAnchor.p;
    audio.play('webHit', 0, p); app.fx.net(p.clone(), 0.5); for (const h of HANDS) app.hub.haptic?.(h, 0.45, 60);
    app.hud.showBanner(t('story.tether.hit'), 1.4, COLORS.perfect, t('char.jet'));
  }
  _updateJetWeb(dt, loco) {
    const T = this.jetWeb; if (!T) return;
    T.t += dt;
    if (!loco.holds(this.jetAnchor)) { this.jetWeb = null; this.jetAnchor.valid = false; return; } // the hand let go
    if (!this.stalled) { this._releaseJetWeb(false); return; } // the stall ended: a quiet release
    if (T.t < TT.pullTime) { const chest = loco.feet(_v).add(_w.set(0, CHEST, 0)); loco.vel.addScaledVector(_d.copy(this.jetAnchor.p).sub(chest).normalize(), TT.pullAccel * dt); }
  }
  _releaseJetWeb(silent) {
    const loco = this.app.locomotion;
    if (!this.jetWeb && !loco.holds(this.jetAnchor)) { this.jetAnchor.valid = false; return; }
    loco.detachAnchor(this.jetAnchor, true);
    if (!silent) audio.play('release', 0, this.jetAnchor.p);
    this.jetAnchor.valid = false; this.jetWeb = null;
  }

  // ================================================================ the fly-in and the punch (World Chase's Lunge / rebound)
  _startLunge(e, loco, chest) {
    const app = this.app, hub = app.hub, h = e.hand;
    this._releaseJetWeb(true);
    loco.detach(true); loco.cling = null; loco.wallRun = null; loco.zip = null; loco.grounded = false; loco.scripted = true; this._lunging = true;
    _d.copy(this.bossPos).sub(chest); const L = _d.length(); if (L > 1e-6) _d.divideScalar(L);
    this.lunge.start(this.clock, { v0: loco.vel.dot(_d), comfort: !!settings.comfortMode, away: 0 }); // (he hangs in place during it: bossSpeed)
    this._lungeBeam = app.fx.web(e.origin, this.bossPos, { hold: true, follow: (out) => { if (hub.aim[h]?.valid) hub.aimOriginNow(h, out); } });
    audio.play('attach', 0, e.origin); hub.haptic?.(h, 0.4, 50);
    this.cstats.lunges++; this.lastLunge = { t: +this.clock.toFixed(2), from: +L.toFixed(2), done: null };
  }
  _updateLunge(dt, loco, chest, feet) {
    const r = this.lunge.update(dt, { gap: _d.copy(this.bossPos).sub(chest).length() });
    const L = _d.length(); if (L > 1e-6) _d.divideScalar(L);
    if (!r.done && settings.impactTime !== false && this.app.timeWarp?.approach(L, { comfort: !!settings.comfortMode })) audio.play('slowmoIn'); // v0.49: the last metres in slow motion
    if (r.step > 0) {
      _v.copy(_d).multiplyScalar(r.step);
      if (this.host.world?.pointBlocked(chest.x + _v.x, chest.y + _v.y, chest.z + _v.z, 0.35)) { this._endLunge('blocked'); return; } // scenery in the way: no hit, no penalty
      loco.rig.position.add(_v); loco.rig.updateMatrixWorld(true); chest.add(_v); feet.add(_v);
    }
    loco.vel.copy(_d).multiplyScalar(r.speed);
    if (this._lungeBeam) this._lungeBeam.to.copy(this.bossPos);
    if (r.done === 'contact') { this._endLunge('contact'); this._contact(chest, true); this.app.timeWarp?.cancelApproach(); } // (cancelApproach: only when the contact was no punch)
    else if (r.done === 'timeout') this._endLunge('timeout');
  }
  /** The fly-in is over (contact / timeout / blocked / the stall ended / respawn / roof / stop): locomotion is free again, and its slow motion ends unless the hit takes it over. */
  _endLunge(why) {
    const was = this._lunging; this.lunge.reset(); this._lunging = false;
    if (this._lungeBeam) { this.app.fx.releaseBeam(this._lungeBeam); this._lungeBeam = null; }
    if (!was) return false;
    this.app.locomotion.scripted = false; this._relOk = false;
    if (why !== 'contact') this.app.timeWarp?.cancelApproach(); // v0.49: no hit → time returns to full speed
    if (this.lastLunge) this.lastLunge.done = why;
    return true;
  }
  /** Any frame outside a fly-in: the chest within CLOSE.lunge.contact of his body point (swept, relative to him). */
  _checkContact(chest) {
    if (this._lunging || this._fading() || !this.app.boss.root.visible) { this._relOk = false; return; }
    const C = CLOSE.lunge, rel = _w.copy(chest).sub(this.bossPos);
    let hit = rel.length() <= C.contact;
    if (!hit && this._relOk && this._prevRel.distanceToSquared(rel) < 36) hit = segPointDist(this._prevRel, rel, _O) <= C.contact; // (6 m or more in one frame is a teleport, not a pass)
    this._prevRel.copy(rel); this._relOk = true;
    if (hit && this.clock - this._contactT >= C.cooldown) this._contact(chest, false);
  }
  /**
   * Contact (the fly-in's end, or the body): the player is pushed back (never flown through). While he is stalled (close
   * combat on) it is the punch: Head Hit, the punch sound, impact time, Flow, a burst of Bitcoins, and he breaks away.
   * Outside a stall it only pushes the player back (design 4.1).
   */
  _contact(chest, lunge) {
    const app = this.app, loco = app.locomotion, hub = app.hub;
    this._contactT = this.clock; this._relOk = false; this.cstats.contacts++; if (lunge) this.cstats.lungeHits++;
    this._releaseJetWeb(true);
    _bv3.copy(this.bossPos).sub(this.bossPrev).divideScalar(this._dt); if (_bv3.lengthSq() > 3600) _bv3.set(0, 0, 0); // his velocity last frame (a respawn jump is not one)
    _w.copy(chest).sub(this.bossPos); const L = _w.length(); if (L > 1e-6) _w.divideScalar(L); else _w.copy(loco.vel).negate().normalize();
    const rb = rebound(_hp.copy(loco.vel).sub(_bv3), _w, CLOSE.lunge, this._rb);
    loco.vel.set(rb.x, rb.y, rb.z).add(_bv3); loco.grounded = false;
    const punched = this.closeOn && this.stumble.punch();
    for (const h of HANDS) hub.haptic?.(h, punched ? 0.9 : 0.5, punched ? 120 : 60);
    this.lastContact = { t: +this.clock.toFixed(2), lunge, punched, vel: +loco.vel.length().toFixed(2) };
    if (!punched) { audio.play('webHit', 0, this.bossPos); return false; }
    const at = this.bossPos.clone();
    this.cstats.punches++; this.totals.punches++;
    this.reactGate.reset(); if (app.boss.maniac.setState('hit', 'head')) this.reactGate.mark(this.clock);
    audio.play('punch', 0, at); this._impactFx('punch', at);
    this._pop('close.hit', _hf.copy(at).add(_v.set(0, 1.2, 0)).clone(), COLORS.perfect, 0.3);
    if (settings.impactTime !== false) app.timeWarp?.impact('punch', { comfort: !!settings.comfortMode }); // (v0.49: ends the fly-in's slow approach with the near-freeze)
    this._flowGain('punch');
    if (app.coins?.burst?.(at, this.cfg.coinBurst)) audio.play('coinBurst', 0, at);
    app.voice?.say('PUNCHED', app.boss.maniac.root);
    return true;
  }

  // ================================================================ Flow (World Chase's meter: beam, wind, music, pips, style)
  _flowGain(kind) { return this.running && this.flowOn ? this.flow.gain(kind) : 0; }
  _updateFlow(dt) {
    const F = this.flow, bl = this.app.shield?.stats.blocked || 0;
    if (bl > this._blk) this._flowGain('block'); this._blk = bl;
    if (!this.flowOn && (F.points || F.style || F.peak)) F.reset(); // switched off mid-run
    for (const e of F.update(dt)) if (e.type === 'levelUp') audio.play('flowUp');
    this._flowFx(this.flowOn ? F.level : -1);
  }
  /** level → web beam brightness, wind tint, the music bus low-pass and lift; -1 = neutral. */
  _flowFx(L) {
    const app = this.app, C = FEEL.flow, on = L >= 0;
    app.fx.flowLevel = on ? L : 0; if (app.windFx) app.windFx.flowTint = on ? C.windTint[L] : 0;
    if (app.feelMusic) { app.feelMusic.flowCutoff = on ? C.musicCutoff[L] : 20000; app.feelMusic.lift = on ? C.musicLift[L] : 1; }
  }
}
