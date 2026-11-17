// World Chase (v0.40) — the shared endless pursuit played in all eight worlds.
//   Main menu → select map → Enter VR Game → load the selected world (black loading screen, time-sliced) →
//   intro (Green Maniac waits ahead on the Green Bat Jet, turned round, a short localized cue) → chase (endless):
//   swing between the fixed anchors, collect Bitcoins, shoot his telegraphed pumpkin bombs, break his shield, then web the
//   jet and pull in (v0.46: no web cut any more) or fly in for a hit inside close range → pause / restart / change map / main menu.
// Reuses: Locomotion (physics, wall run, cling), ChaseBombs, Coins, Boss, HUD, LoadingOverlay, the fade sphere.
// Owns: the ChaseWorld (route streaming) + WorldRenderer of the active map; everything is disposed on exit / switch.
// It never triggers the story finale (no roof dash / kick / roof collapse, no factory).
import * as THREE from 'three';
import { t, getLang } from '../core/i18n.js';
import { audio } from '../core/audio.js';
import { settings } from '../core/settings.js';
import { COLORS } from '../ui/panel.js';
import { ChaseWorld } from './chaseWorld.js';
import { WorldRenderer } from './worldRenderer.js';
import { mapById, getWorldBest, setWorldBest } from './maps.js';
import { ChaseBombs } from '../game/chaseBombs.js';
import { isEnvAnchor, WEB_HOLD_GRACE } from '../game/locomotion.js';
import { STORY_COMBAT } from '../data/storyCombat.js';
import { pickTarget, angularZoneSize } from '../game/aim.js';
import { GREEN_MANIAC_THROW_RELEASE } from '../art/enemies.js';
import { startWorldAmbience } from './ambience.js';
import { CHASE_COMBAT, Health, ChaseRun, selectTarget, shotIntent } from './chaseCombat.js';
import { ChaseLightBombs } from './chaseLightBombs.js';
import { BossFight, FIGHT, heavyCounterOk } from './bossFight.js';
import { BossFightFx, FIGHT_FX } from './bossFightFx.js';
import { FanWebFx } from '../game/fanWebFx.js';
import { flightTimeFor } from '../game/chaseBombs.js';
import { Flow } from '../game/flow.js';
import { FEEL } from '../data/feel.js';
import { Finisher } from './finisher.js';
import { WebPullDetector } from '../input/webPull.js';
import { PULL } from '../data/handCombat.js';
import { pickReaction, ReactionGate } from './hitReaction.js';
import { CloseRange } from './closeRange.js';
import { CLOSE } from '../data/closeCombat.js';
import { Lunge, webAtBoss, rebound, segPointDist, faceOnRing } from './lunge.js';
import './i18n.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3(), _hp = new THREE.Vector3(), _hf = new THREE.Vector3(), _hq = new THREE.Quaternion();
const _bv3 = new THREE.Vector3(), _O = new THREE.Vector3(); // (v0.46 contact: his velocity; the origin of the relative frame)
const IMPACT = { shield: FIGHT_FX.shieldColor, body: 0xff8a1a, flash: 0xffffff }; // v0.46 impact bursts (pooled fx.boom; colours outside the VfxKit routing → the light flash + ring + sparks)
const CHEST = 1.3, TT = STORY_COMBAT.tether, HANDS = ['left', 'right'];
export const WORLD_CHASE = {
  lead: CHASE_COMBAT.lead, // m: Green Maniac's preferred lead along the route (v0.41: 26, inside web / Light Bomb range)
  leadMax: CHASE_COMBAT.leadMax, // beyond this he slows to a hover and waits (stays visible)
  speeds: [21, 15, 7, 0], // m/s by gap band (< 16, < lead, < leadMax, beyond)
  readyMargin: 16, // m: never flies into modules that are not built yet
  bombQuiet: ['recovery', 'start'], // module types without new throws (calm sections)
  introMax: 6, // s: he waits at most this long for the first swing
  seedBase: 20261103,
  // v0.42 pursuit: Green Maniac follows the player's own route speed and holds a combat-distance band — he never
  // sprints away when you close in (good swinging really closes the gap), slows smoothly in openings, waits when far.
  follow: 0.45, // (m/s) per metre of gap error: v = playerSpeed − (gap − lead) × follow
  pullAway: 5, // m/s: at most this much faster than the player when they are inside the lead
  vMax: 22, accel: 7, // m/s, m/s² (smooth, readable speed changes)
  minGap: 8, // m: inside this he speeds up just enough not to be overtaken
  leadOpening: { stagger: 14, heavy: 20 }, // m: preferred lead while staggered / during a heavy windup or vent
  staggerSpeed: 6, // m/s cap while staggered (the jet visibly slows)
  upcoming: 28, // m ahead of the player checked for a blind turn / gate before starting an attack
  // v0.44 web pull (the player side: PULL in src/data/handCombat.js). Without this his speed matching cancels a pull within
  // a second. Now a pull is a SURGE he does not match, and it buys a little of his lead for a while:
  pull: {
    surgeMin: 0.5, // m/s of recent pull speed (locomotion.pull.surge) above which the player's speed counts as a surge
    surgeFollow: 0.2, // × how fast his reference of the player's speed rises during a surge (1 = as before: matched at once)
    leadPerMps: 0.5, // m of his preferred lead given up per m/s a pull added (a full stroke ≈ 5 m/s → 2.5 m)
    leadMax: 8, // m at most (chained pulls)
    minLead: 17, // m: the lead never drops below this through pulls (his throws need ≥ 14 m — attack fairness; minGap still holds)
    leadHold: 2.5, // s the gained ground is kept after the last pull …
    leadRecover: 1.0, // … then he eases back out at this rate (m/s)
  },
};
/** v0.44: the player's route speed as Green Maniac sees it — an EMA that lags behind on purpose while a pull surge lasts. Pure. */
export function chaseRefSpeed(ref, inst, surge, dt, P = WORLD_CHASE.pull) {
  const k = inst > ref && surge > P.surgeMin ? P.surgeFollow : 1;
  return ref + (inst - ref) * Math.min(1, dt * 1.5 * k);
}
/** v0.44: lead (m) Green Maniac gives up to recent pulls. st = { dv (pull speed seen so far), cut, hold }. Pure. */
export function pullLeadCut(st, pullDv, dt, P = WORLD_CHASE.pull) {
  if (pullDv > st.dv) { st.cut = Math.min(P.leadMax, st.cut + (pullDv - st.dv) * P.leadPerMps); st.hold = P.leadHold; }
  else if (st.hold > 0) st.hold -= dt;
  else if (st.cut > 0) st.cut = Math.max(0, st.cut - P.leadRecover * dt);
  st.dv = pullDv;
  return st.cut;
}
/**
 * Green Maniac's speed along the route for this frame (the v0.42 pursuit, extracted unchanged so it can be tested).
 * q = { gap, lead, ps (reference player speed), psNow (the player's actual route speed), slow, tetherStuck, breakAway, minGap? (v0.46; null = C.minGap),
 *   brakeAccel?, brakeHold? (v0.46, only with minGap), noFloor? (v0.46 revision 4: no floor at all — staggered in close range) }. Pure.
 */
export function pursuitSpeed(bv, q, dt, C = WORLD_CHASE) {
  const { gap, lead, ps, slow } = q;
  let v = ps - (gap - lead) * C.follow;
  v = THREE.MathUtils.clamp(v, 0, Math.min(C.vMax, ps + C.pullAway));
  if (gap > C.leadMax) v = 0; // far behind: he hovers and waits (stays in view)
  if (slow === 'stagger') v = Math.min(v, C.staggerSpeed); // the jet visibly slows — reachable
  const minGap = q.minGap ?? C.minGap; // (v0.46: close range lowers the floor to CLOSE.holdGap)
  // v0.46 close range (q.minGap set): the floor engages early enough to brake — at minGap + the distance the player closes while
  // he accelerates to their speed at q.brakeAccel (c² / 2a, + one frame) — and then accelerates at that rate. Unset: v0.45 exactly.
  const brake = q.minGap != null ? q.brakeAccel ?? C.accel * 2 : 0, close = brake ? Math.max(0, (q.psNow ?? ps) - bv) : 0;
  const floor = q.noFloor ? -Infinity : brake ? minGap + close * close / (2 * brake) + close * dt : minGap;
  if (gap < floor) v = Math.max(v, Math.max(ps, q.psNow ?? ps) + (slow === 'stagger' ? 1.5 : 4)); // never overtaken (no flying through him) — measured against the real speed, surge included
  else if (brake && gap < floor + (q.brakeHold ?? 0)) v = Math.max(v, q.psNow ?? ps); // (just above the floor: keep at least their speed once matched — no brake / stagger-cap chatter)
  if (q.tetherStuck) v = Math.min(v, TT.bossSlow);
  else if (q.breakAway && !slow) v = Math.max(v, 12) + TT.breakAwaySpeed;
  const brisk = q.breakAway ? C.minGap : minGap; // (the boost keeps the v0.45 brisk band: its 2.2 m floor does not slow the break-away; = minGap when unset)
  const acc = brake && gap < floor && v > bv ? brake : C.accel * (gap < brisk * 2 && v > bv ? 2 : 1); // (pulls away twice as briskly when Mobius is right on him)
  return bv + THREE.MathUtils.clamp(v - bv, -acc * dt, acc * dt); // smooth, rate-limited speed changes
}
/**
 * v0.42 map-aware variation (route data only — never a shortcut through scenery): `alt` = Green Maniac's flight height
 * offset (m) in the listed module types (tower maps alternate high / low per module → high / low approaches; arch maps
 * fly a little higher over open straights → upper routes), skipped wherever the offset point is blocked. `heavy` = module
 * types where a heavy throw is allowed (escape space).
 */
export const MAP_FIGHT = {
  default: { alt: { types: [], dy: 0 }, heavy: ['straight', 'recovery', 'rise', 'descend', 'bridgeHigh', 'bridgeLow'] },
  foldscape: { alt: { types: ['straight', 'rise'], dy: 1.5 }, heavy: ['straight', 'recovery', 'rise', 'descend', 'bridgeHigh'] },
  forest: { alt: { types: ['straight', 'recovery'], dy: 2.0 }, heavy: ['straight', 'recovery', 'rise', 'descend'] },
  redrock: { alt: { types: ['straight'], dy: 1.5 }, heavy: ['straight', 'recovery', 'rise', 'descend', 'bridgeHigh'] },
  neon: { alt: { types: ['straight', 'rise', 'descend'], dy: 2.2, alternate: true }, heavy: ['straight', 'recovery', 'rise', 'descend', 'bridgeHigh'] },
  moonlit: { alt: { types: ['straight', 'rise', 'descend'], dy: 2.0, alternate: true }, heavy: ['straight', 'recovery', 'rise', 'descend'] },
  cloudpalace: { alt: { types: ['straight', 'rise', 'descend'], dy: 2.0, alternate: true }, heavy: ['straight', 'recovery', 'rise', 'descend'] },
  aurora: { alt: { types: ['straight'], dy: 1.2 }, heavy: ['straight', 'recovery', 'rise', 'descend', 'bridgeHigh', 'bridgeLow'] }, // (the hot-orange core / lime shield already contrast with the ice blues)
  molten: { alt: { types: [], dy: 0 }, heavy: ['straight', 'recovery'] }, // only where there is room to dodge
};
const fightFlavor = (id) => MAP_FIGHT[id] || MAP_FIGHT.default;

export class WorldChase {
  constructor(app) {
    this.app = app; this.state = null; this.paused = false; this.mapId = null; this.runs = 0;
    this.world = null; this.renderer = null;
    this.bombs = new ChaseBombs(app, { ...STORY_COMBAT.bombs, ...CHASE_COMBAT.bombs, maxActive: 4, giantScale: FIGHT.heavy.scale, swept: true }); // (world override set per run; v0.42: 4 = a 3-pumpkin spread + 1)
    this.bombs.onPlayerHit = (it) => { if (!this._shieldHint && app.hub.inputKind === 'hands' && settings.palmShield !== false && !app.shield?.stats.blocked) { this._shieldHint = true; app.hud.showBanner(t('hint.shield'), 3.0, COLORS.text); } return this._hitByPumpkin(it); }; // v0.44: one hint after the first hit taken
    this._hitByPumpkin = (it) => this._playerHit(it.kind === 'giant' ? FIGHT.heavy.playerDamage : CHASE_COMBAT.player.pumpkinDamage, `pk${it.id}`, it.kind === 'giant' ? 'heavy' : 'pumpkin');
    this.bombs.onShotDown = (it, by) => this._onPumpkinDown(it, by); // v0.42: heavy-pumpkin counter (time + position)
    this.fight = new BossFight(); // v0.42 boss fight state machine (pure; src/worlds/bossFight.js)
    this.reactGate = new ReactionGate(); // v0.46 hit reactions: spacing + never during a telegraph / throw (time = this.clock)
    this.fightFx = new BossFightFx(app); // shield, power core, threat icon, counter ring
    this.fanFx = new FanWebFx(app.scene, 2, app.fx); // v0.42: the Fan Web in chase (spread defence)
    this.corePos = new THREE.Vector3(); this.coreN = new THREE.Vector3(); this.held = [];
    this.debugFight = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fightdebug');
    if (this.debugFight) this._installFightDebug();
    this.lightBombs = new ChaseLightBombs(app); // v0.41: the Arcade's Light Bomb, beat-free
    this.hp = new Health(CHASE_COMBAT.player.hp, CHASE_COMBAT.player.invuln); // Mobius
    this.bossHp = new Health(CHASE_COMBAT.boss.hp, 0); // Green Maniac
    this.flow = new Flow(); // v0.45 Flow meter (chained actions → beam / wind / music tint, style score)
    this.finisher = new Finisher(); this._finBeams = { left: null, right: null }; this._finPull = { left: new WebPullDetector(), right: new WebPullDetector() }; this._finBody = new THREE.Vector3(); this._finBodyOk = false; this._finIn = { t: 0, dt: 0, held: false, tracked: false, hand: null, body: this._finBody }; this._finYank = null; this._finT = 0; this._finLastHeld = { left: 0, right: 0 }; // v0.45 boss finisher (_finT: its real-time clock, pauses / menus excluded)
    this.run = new ChaseRun(); // preparing → active ⇄ paused → victory | defeat → results → returning
    this.locks = { left: null, right: null }; // aim-assist lock per hand (pumpkin id key), shown as a highlight
    this.bossPos = new THREE.Vector3(); this.bossPrev = new THREE.Vector3();
    this.jetAnchor = { id: 'JET-HOOK', p: new THREE.Vector3(), valid: false, moving: true, building: null, cell: null, kind: 'jet' };
    this.bossMarker = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), new THREE.MeshBasicMaterial({ color: 0xff5050, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
    this.bossMarker.renderOrder = 37; this.bossMarker.visible = false; app.scene.add(this.bossMarker);
    this.targetRing = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 40), new THREE.MeshBasicMaterial({ color: 0x7ef0ff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false }));
    this.targetRing.renderOrder = 36; this.targetRing.visible = false; app.scene.add(this.targetRing);
    // v0.46 close range: he lets the player come close (taunting); the red target ring on him while it lasts (the pass's one new draw call)
    this.closeRange = new CloseRange(); this._bossRootAt = new THREE.Vector3();
    const R = CLOSE.ring; this.closeRing = new THREE.Mesh(new THREE.RingGeometry(R.radius * 0.84, R.radius, 48), new THREE.MeshBasicMaterial({ color: R.color, transparent: true, opacity: R.opacity[1], depthTest: false, depthWrite: false, side: THREE.FrontSide, toneMapped: false, fog: false })); // (FrontSide: one pass; lookAt turns its +Z face to the camera)
    this.closeRing.renderOrder = 37; this.closeRing.visible = false; app.scene.add(this.closeRing);
    // v0.46 revision 4: the fly-in hit (lunge), body contact (swept, relative to him), impact bursts
    this.lunge = new Lunge(); this._lunging = false; this._lungeBeam = null; this._rb = { x: 0, y: 0, z: 0 }; this._faceStag = { on: false }; // (v0.49: he has turned to face the player in this stagger)
    this._prevRel = new THREE.Vector3(); this._relOk = false; this._contactT = -9; this._fxT = -9; this._dt = 1 / 72; this._ringOn = { blue: false, red: false };
  }
  get active() { return !!this.state; }
  get map() { return mapById(this.mapId); }
  get allowAttack() { return (this.state === 'chase' || this.state === 'intro' || this.state === 'finisher') && this.run.running; } // (v0.45: web events reach the finisher)
  get allowLocomotion() { return !!this.state && !this.paused && this.run.running; }
  /** v0.41: intro / chase (not resolved, not on the results panel). */
  get running() { return !!this.state && this.run.running; }
  get lightBombReady() { return this.lightBombs.ready; }
  /** v0.45: Flow meter switched on (settings.flowMeter; off = the v0.44 chase: no level, no tint, no style). */
  get flowOn() { return settings.flowMeter !== false; }
  /** v0.46: close combat switched on (settings.closeCombat; off = the v0.45 chase: hurt shake, no taunt, no punch). */
  get closeOn() { return settings.closeCombat !== false; }

  // ================================================================ load / unload
  /** Generator for App._runLoadJob: tear down what is there (city or a previous world), build the new world. */
  *steps(mapId) {
    const app = this.app, map = mapById(mapId); if (!map) throw new Error(`unknown map ${mapId}`);
    // 1) stop everything that is running
    app.story.stop(); app.story.fadeTo(1, 10); app.arcade.stop(); app.boss.setVisible(false); app.menus.hide(); app.hud.setMode('off'); // (story.stop clears the fade: black again)
    app.locomotion.off(); app.fx.clear(); audio.stopRoomMusic(); app.voice?.stop?.();
    this._stopRun();
    audio.loadSfx(); // v0.45: designed SFX decode in the background while the world loads (no-op before audio.unlock())
    yield 'stop';
    // 2) the city (or the previous world) out
    if (app.worldName === 'city') {
      app.city.suspend(); app.room.root.visible = false; app.skyGroup.visible = false; app.story.chaseCtl.root.visible = false;
      app.cityWorld.pin('boss', null);
      app._cityLights = { sun: app.lights.sun.intensity, hemi: app.lights.hemi.intensity, sunCol: app.lights.sun.color.clone(), hemiSky: app.lights.hemi.color.clone(), hemiGnd: app.lights.hemi.groundColor.clone(), sunPos: app.lights.sun.position.clone() };
      this._cityFog = app.scene.fog;
    } else if (app.worldName === 'factory') { app._disposeInterior(); }
    this.disposeWorld();
    app.worldName = 'loading';
    yield 'unloaded';
    // 3) the new world: data + renderer, lights, fog
    this.mapId = mapId; this.runs++;
    const seed = WORLD_CHASE.seedBase + this.runs * 7919;
    this.world = new ChaseWorld(map, { seed });
    this.renderer = new WorldRenderer(app, map, this.world);
    app.scene.add(this.renderer.root);
    this._rebaseOff = this.world.on({ rebased: (dx, dz) => this._onRebase(dx, dz) });
    this._applyLook(map);
    app.locomotion.world = this.world; app.locomotion.ignoreColliders = new Set();
    this.bombs.world = this.world;
    yield 'created';
    // 3b) maps whose detail assets must be on screen from the first frame (forest: extras.blockLoad) — wait behind the
    // black screen for the asset cache. ForestDetail owns a wall-clock timeout that activates the legacy fallback.
    const ex = this.renderer.extras;
    if (ex?.blockLoad) while (ex.loading) yield 'assets';
    // 4) stream the start + the modules ahead (behind the black screen), then compile every shader
    const start = this.world.pointAt(10);
    app.locomotion.placeAt(start.clone().setY(start.y - 2.5), null); // the rig is already at the start (streaming follows it)
    this.world.update(start, { x: 0, y: 0, z: 0 }, 1 / 60, { force: true });
    for (let i = 0; i < 900 && (this.renderer.pending > 0 || this.world.pendingNear(start, 400) > 0); i++) { this.renderer.pump(20); yield 'wait'; } // (behind the black screen: bigger slices)
    app.worldName = 'world';
    this.renderer.update(0, start);
    try { app.renderer.compile(app.scene, app.camera); } catch (e) { console.warn('compile world', e); }
    yield 'compiled';
    app.loader.hide();
    this.begin();
  }
  _applyLook(map) {
    const app = this.app, L = map.look, s = app.lights.sun, h = app.lights.hemi;
    s.color.set(L.sunColor); s.intensity = L.sunI; s.position.copy(_v.set(...L.sunDir).normalize().multiplyScalar(500));
    h.color.set(L.hemiSky); h.groundColor.set(L.hemiGround); h.intensity = L.hemiI;
    app.scene.fog = new THREE.Fog(L.fog.color, L.fog.near, L.fog.far * 1.1);
  }
  /** Remove the active world (renderer, data, listeners, audio). Safe to call twice. */
  disposeWorld() {
    this._stopRun();
    this._rebaseOff?.(); this._rebaseOff = null;
    if (this.renderer) { this.renderer.dispose(); this.renderer = null; }
    this.world = null; this.bombs.world = null;
  }
  /** Back to Dala City (used by the session end / main menu): restore lights, fog, locomotion world. */
  teardown() {
    const app = this.app;
    const had = !!this.renderer || app.worldName === 'world';
    this.disposeWorld();
    this.state = null; this.paused = false;
    app.locomotion.world = app.cityWorld; app.locomotion.ignoreColliders = new Set(['A']);
    if (this._cityFog) { app.scene.fog = this._cityFog; this._cityFog = null; }
    if (app._cityLights?.sunCol) { const c = app._cityLights; app.lights.sun.color.copy(c.sunCol); app.lights.hemi.color.copy(c.hemiSky); app.lights.hemi.groundColor.copy(c.hemiGnd); app.lights.sun.position.copy(c.sunPos); }
    app.hud.setCoins(0, false); app.coins?.stop();
    return had;
  }

  // ================================================================ run
  begin() {
    const app = this.app, w = this.world, loco = app.locomotion, map = this.map;
    let cell0 = w.live.get(0);
    if (!cell0 || !cell0.ready) { w.update(w.pointAt(10), { x: 0, y: 0, z: 0 }, 1 / 60, { force: true }); this.renderer.pump(1e9); cell0 = w.live.get(0); }
    const cp = cell0.checkpoints.find((c) => c.start) || cell0.checkpoints[0];
    loco.unfreeze(); loco.detach(true); loco.setCityMode([]);
    loco.placeAt(new THREE.Vector3(...cp.pos), cp.yaw);
    const col = w.colliderOf(cp.sid); if (col) loco._landRoof(col);
    this._hookLoco();
    app.timeWarp?.reset(); // v0.45: no impact time carries into a new run
    this.run.reset(); this.hp.reset(); this.bossHp.reset(); this.lightBombs.reset(); this.locks.left = this.locks.right = null; // v0.41: nothing leaks from the last run
    this._lastWebDmg = -9; this._hurtUntil = 0; this._resultShown = false;
    this.reactGate.reset(); this.closeRange.reset(); this._endLunge('begin'); this._relOk = false; this._contactT = -9; this._fxT = -9; this._tetherDmgStag = -1; this._faceStag.on = false; this._ringOn.blue = this._ringOn.red = false; this._poseAfterHit = false; // v0.46
    this.bench = null; // (dev bench never carries over into a new run)
    this.fight.reset(0xb055 + this.runs); this.fightFx.reset(); this.fanFx.clear(); this.held.length = 0; this._hitIds = new Set(); this._tele = null; // v0.42
    this.playerSpeed = 0; this.playerSpeedNow = 0; this._pullLead = { dv: app.locomotion.stats.pullDv || 0, cut: 0, hold: 0 }; app.shield?.reset(); this._pullHint = this._pullHint || false; // v0.44
    this._prevPS = null; this._fair = { fair: false }; this._fairT = 0; this._altOff = 0; this._popT = {}; this.fightStats = { coreHits: 0, counters: 0, heavyKills: 0, fans: 0, fanPumpkins: 0, shieldHits: 0, blocked: 0, lunges: 0, lungeHits: 0, contacts: 0, bursts: 0 }; // (v0.46: + lunges, contacts, impact bursts)
    this.flow.reset(); this._blk = app.shield?.stats.blocked || 0; // v0.45
    this._finAbort(); // v0.45: no finisher carries into a new run
    app.setArmored(true); app.story.inRoom = false; app.story.suited = true;
    this.state = 'intro'; this.stateTime = 0; this.paused = false; this.clock = 0;
    this.playerS = cp.s; this.maxS = cp.s; this.distance = 0; this.startS = cp.s; this.cp = cp;
    this.bossS = cp.s + 30; this._bv = 0; this._faced = false; this.startFeet = loco.feet(new THREE.Vector3());
    this.stats = { coins: 0, bombsShot: 0, bombHits: 0, tethers: 0, respawns: 0, t: 0 };
    this.tether = null; this.jetAnchor.valid = false; // (v0.46: no tether cooldown / break-away — the web cut is gone)
    this.bombs.reset(0x5eed + this.runs); this.bombs.world = w;
    const bp = w.pointAt(this.bossS); app.boss.remount(); app.boss.resetScale(); app.boss.setVisible(true); app.boss.jet.setDamage(0); app.boss.jet.setThrust(1);
    app.boss.root.position.set(bp.x, bp.y + 4, bp.z); app.boss.face(w.pointAt(this.bossS + 12).setY(bp.y + 4), 1);
    this.hum = audio.startJetHum?.();
    app.coins.startWorld(this);
    for (const c of w.live.values()) if (c.ready) app.coins.addCell(c);
    app.hud.setMode('chase'); app.hud.setCoins(0, true); this._hud(true);
    app.hud.showBanner(t('world.intro'), 3.2, COLORS.bad, map.name[getLang()] || map.name.en);
    this._objective(true);
    this.amb = startWorldAmbience(map.look.ambience);
    app.story.fadeTo(0, 2.2);
    app.state = 'world';
    if (app.voice && app.boss.root.visible) setTimeout(() => { if (this.state && !this.paused) app.voice?.say('B', app.boss.maniac.root, { interrupt: true }); }, 1400);
  }
  _stopRun() {
    const app = this.app;
    if (this.state && this.stats) this._saveBest();
    this.app.speedFx?.stop(); // v0.45
    this.hum?.stop(); this.hum = null; this.amb?.stop(); this.amb = null;
    this.bombs.clear(); this.lightBombs.clear(); this._endTether();
    this.app.shield?.reset(); // v0.44
    this.app.timeWarp?.reset(); // v0.45
    this._flowClear(); // v0.45: no Flow tint / music filter outside the chase
    this._finAbort(); // v0.45: finisher off, its held strands released
    this.fightFx.reset(); this.fanFx.clear(); this.held.length = 0; this._tele = null; // v0.42: nothing of the fight survives the run
    this.reactGate.reset(); this.closeRange.reset(); this._endLunge('stop'); // v0.46
    this.bossMarker.visible = false; this.targetRing.visible = false; this.closeRing.visible = false;
    this.locks.left = this.locks.right = null;
    this.app.locomotion.unfreeze?.();
    this._unhookLoco();
    if (this.state) { app.coins?.stop(); app.boss.setVisible(false); }
    this.state = null;
  }
  /** Same map, a fresh run (new route seed → endlessly replayable). Reloads behind the black screen. */
  restart() { this.app.startWorld(this.mapId); }
  pause() { if (!this.run.running) return; this._endLunge('pause'); this.paused = true; this.run.pause(); this.lightBombs.hideOrbs(); this.hum?.setLevel(0); this.amb?.setLevel(0.25); }
  resume() { this.paused = false; this.run.resume(); this.amb?.setLevel(1); for (const h of HANDS) this._finPull[h].reset(); } // (v0.45: a hand moved during the pause is never a finisher pull)
  _saveBest() {
    const best = getWorldBest(this.mapId) || { distance: 0, coins: 0 };
    const d = Math.round(this.distance || 0), c = this.app.coins?.count || 0;
    const st = this.run.final ? this.run.final.style || 0 : this.flowOn ? this.flow.style : 0, bs = best.style || 0; // v0.45: best style (records without one keep working)
    if (d > best.distance || c > best.coins || st > bs) setWorldBest(this.mapId, { distance: Math.max(d, best.distance), coins: Math.max(c, best.coins), ...(st || bs ? { style: Math.max(st, bs) } : {}), at: Date.now() });
  }
  summary() { const b = getWorldBest(this.mapId); return { distance: Math.round(this.distance || 0), coins: this.app.coins?.count || 0, bombs: this.stats?.bombsShot || 0, tethers: this.stats?.tethers || 0, style: this.flowOn ? this.flow.style : null, best: b }; }

  // ---------------------------------------------------------------- locomotion callbacks (story's are restored after)
  _hookLoco() {
    const loco = this.app.locomotion;
    this._savedCb = { onFall: loco.onFall, onStreet: loco.onStreet, onOutOfBounds: loco.onOutOfBounds, onAnchorLost: loco.onAnchorLost, onPull: loco.onPull, onRelease: loco.onRelease };
    const hazard = () => { this._playerHit(CHASE_COMBAT.player.hazardDamage, null, 'hazard'); return this.run.over; }; // v0.41: falling costs HP (defeat freezes in place)
    loco.onFall = () => { if (this.finisher.active) return true; this.app.flashDamage(); if (hazard()) return true; return this.respawn('story.fail.fall'); }; // (v0.45: no flash / recovery during the finisher — the run resolves and freezes Mobius right after)
    loco.onOutOfBounds = () => this.respawn('story.fail.bounds');
    loco.onStreet = () => { if (this.finisher.active) return; if (this.map.gen.lethalFloor) { if (!hazard()) this.respawn(`world.fail.${this.map.gen.floor}`); } else this.app.hud.showBanner(t('story.hint.street'), 2.2, COLORS.warn); };
    loco.onAnchorLost = () => this.app.hud.showBanner(t('hint.anchorLost'), 1.6, COLORS.warn);
    loco.onPull = () => this._flowGain('pull'); loco.onRelease = (sp) => this._onRelease(sp); // v0.45 Flow + launch pop
  }
  /** v0.45: a web let go at speed counts for the Flow meter. */
  _onRelease(sp) { if (sp >= FEEL.flow.releaseSpeed) this._flowGain('release'); this.app.speedFx?.onRelease(sp); } // (+ v0.45 launch pop)
  _unhookLoco() { const s = this._savedCb; if (!s) return; Object.assign(this.app.locomotion, s); this._savedCb = null; }

  // ================================================================ per frame
  /** dt = world (time-warped) dt; realDt = unscaled frame dt (v0.45: the finisher runs on real time). */
  update(dt, tNow, realDt = dt) {
    const app = this.app, w = this.world; if (!w || !this.renderer) return;
    const loco = app.locomotion, cam = app.camera.getWorldPosition(_d);
    // streaming + visuals (also while paused: the world stays drawn)
    if (this.bench) this._benchStep(dt);
    const feet = loco.feet(new THREE.Vector3());
    if (this.state && this.run.running) w.update(feet, loco.vel, dt); // (not before begin(); v0.41: not after the run is resolved — the player's surroundings stay exactly as they are)
    this.renderer.pump(this.paused || !this.run.running ? 4 : 2.5);
    this.renderer.update(dt, cam, app.camera); // (app.camera: in XR three keeps the both-eye union frustum + head pose on it)
    app.hud.root.visible = app.hud.mode !== 'off' && !app.menus.open; // menus open: the HUD steps aside
    if (!this.state) { this.bossMarker.visible = false; this.targetRing.visible = false; this.closeRing.visible = false; return; }
    if (!this.run.running) { this._updateResolved(dt, tNow, feet); return; }
    if (this.paused) { this.bossMarker.visible = false; this.targetRing.visible = false; this.closeRing.visible = false; this._clearHighlights(); return; }
    this.stateTime += dt; this.clock += dt; this.stats.t += dt; this.run.tick(dt); if (dt > 0) this._dt = dt;
    this.hp.tick(dt); this.bossHp.tick(dt);
    // progress along the route (only continuous forward progress counts as distance)
    const pr = w.progress(feet.x, feet.z, this.playerS);
    if (pr.s > this.maxS && pr.s - this.maxS < 45) { this.distance += pr.s - this.maxS; this.maxS = pr.s; }
    if (this._prevPS != null && dt > 0) { const ds = pr.s - this._prevPS; if (Math.abs(ds) < 8) { this.playerSpeedNow = THREE.MathUtils.clamp(ds / dt, 0, 40); this.playerSpeed = chaseRefSpeed(this.playerSpeed, this.playerSpeedNow, loco.pull?.surge || 0, dt); } } // v0.42: route speed (EMA); v0.44: lags behind during a pull surge
    if (!this._pullHint && app.hub.inputKind === 'hands' && loco.attach && isEnvAnchor(loco.attach.anchor) && this.state === 'chase' && this.clock > 4) { this._pullHint = true; app.hud.showBanner(t('hint.pull'), 3.0, COLORS.text); } // v0.44: once per session
    this._prevPS = pr.s;
    this.playerS = pr.s;
    // checkpoint: the latest built one we have passed
    const cp = w.checkpointBefore(this.maxS); if (cp && cp.s > (this.cp?.s ?? -1)) this.cp = cp;
    w.pin('cp', this.cp ? w.moduleAtS(this.cp.s)?.idx : null);
    // jet hook + Green Maniac's hit centre (webs / Light Bombs)
    app.boss.jet.root.updateWorldMatrix(true, false);
    this.jetAnchor.p.set(...TT.hook); app.boss.jet.root.localToWorld(this.jetAnchor.p);
    this.bossPrev.copy(this.bossPos); this._bossCenter(this.bossPos); this._bossRootAt.copy(app.boss.root.position); // (v0.46: the ring follows his move this frame)
    const chest = (this._chest || (this._chest = new THREE.Vector3())).copy(feet).add(_v.set(0, CHEST, 0));
    // v0.41 aim assist: per-hand pumpkin lock (highlight = the target a web from that hand will hit)
    this.fightFx.corePos(this.corePos); this.fightFx.coreNormal(this.coreN);
    this._updateLocks(chest);
    // v0.45: webs at the jet become finisher strands; finisherKey = desktop dev. `this.state === 'finisher'` is read at each
    // use (not cached): a kill earlier in this frame (web, Light Bomb, tether) starts it, and nothing of the normal fight may run after that.
    for (const e of app.hub.events) { if (e.type === 'web') { if (this.state === 'finisher') this._finWeb(e, loco); else this._onWeb(e, loco, chest); } else if (e.type === 'fanWeb') this._onFanWeb(e, chest); else if (e.type === 'finisherKey' && this.state === 'finisher') this._finKey(); }
    // v0.46 revision 4: the fly-in (scripted rig motion) and body contact (a hit + a push back; never flown through)
    if (this._lunging) { if (this.state === 'chase' && this.closeOn && app.boss.root.visible && !this._respawning && this.fight.state === 'staggered') this._updateLunge(dt, loco, chest, feet); else this._endLunge(this.fight.state !== 'staggered' ? 'staggerEnd' : 'state'); } // (fix round 1: the stagger ending mid-flight cancels it — no hit, no rebound)
    this._checkContact(chest);
    // v0.41 Light Bomb (free, no beat)
    const bossValid = this.state === 'chase' && app.boss.root.visible;
    this.lightBombs.update(dt, { events: app.hub.events, clock: this.clock, allowThrow: this.allowAttack && this.state !== 'finisher', bombs: this.bombs, world: w, chest, playerVel: loco.vel,
      boss: { pos: this.bossPos, prev: this.bossPrev, radius: CHASE_COMBAT.boss.radius, valid: bossValid },
      core: { pos: this.corePos, radius: FIGHT.core.radius, valid: bossValid && this._coreVisible(chest) },
      heavyRadius: FIGHT.heavy.hitRadius,
      onBossHit: (dmg, at, id, zone) => this._fightHit('lightBomb', zone || 'body', at, id), onPumpkin: () => { this.stats.bombsShot++; this._flowGain('pumpkin'); } }); // v0.45: + Flow
    if (!this.run.running) { this._updateResolved(0, tNow, feet); return; } // (a Light Bomb just won the run)
    if (this.state === 'finisher') { this._updateFinisher(dt, realDt, tNow, feet); if (!this.run.running) { this._updateResolved(0, tNow, feet); return; } } // v0.45
    else this._updateBoss(dt, tNow, feet);
    this._updateTether(dt, loco);
    this._updateFight(dt, tNow, chest, feet); // v0.42: the fight decides every throw (ChaseBombs' own scheduler stays off)
    this.bombs.update(dt, { allow: false, boss: app.boss, chest, playerVel: loco.vel });
    this.fanFx.update(dt);
    this._updateFlow(dt); // v0.45
    if (this.bombs.stats.thrown === 1 && !this._bombHint) { this._bombHint = true; app.hud.showBanner(t('story.hint.bombs'), 2.6, COLORS.warn); }
    if (this.bombs.stats.hits !== this._hits) { this._hits = this.bombs.stats.hits; this.stats.bombHits = this._hits; }
    this._closePose(); // v0.46
    if (this._hurtUntil && this.clock >= this._hurtUntil) { this._hurtUntil = 0; const m = app.boss.maniac; if (this.run.running && this.state === 'chase' && this.fight.state !== 'staggered' && (!this.closeOn || m.state === 'hurt')) m.setState(this._restPose()); } // (v0.46: only a hurt it started; back to the close-range pose)
    this._updateVisuals(dt, tNow, feet);
    this._hud();
    if ((this._objT = (this._objT || 0) - dt) <= 0) { this._objT = 0.5; this._objective(); }
  }
  /** Green Maniac's body (web / Light Bomb target): between his chest and the jet. */
  _bossCenter(out) {
    const b = this.app.boss; b.root.updateMatrixWorld(true);
    b.maniac.hitCenter.getWorldPosition(out); return out.lerp(b.root.getWorldPosition(_v), 0.35);
  }

  // ---------------------------------------------------------------- v0.41 combat: aim assist, webs, damage
  _pumpkinCands() {
    const out = this._cands || (this._cands = []); out.length = 0;
    for (const it of this.bombs.items) if (it.active && it.phase === 'fly') out.push({ pos: it.pos, vel: it.vel, key: `p${it.id}`, it, radius: it.kind === 'giant' ? FIGHT.heavy.hitRadius : undefined });
    return out;
  }
  _pickPumpkin(origin, dir, lock, chest) {
    const A = CHASE_COMBAT.aim, cands = this._pumpkinCands(); if (!cands.length) return null;
    const cam = this.app.camera, head = cam.getWorldPosition(_hp), fwd = _hf.set(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(_hq));
    const w = this.world;
    return selectTarget(origin, dir, cands, { ...A, head, headFwd: fwd, chest, lock, occluded: (o, p) => !!w?.segmentBlocked(o.x, o.y, o.z, p.x, p.y, p.z) });
  }
  _updateLocks(chest) {
    const hub = this.app.hub, lit = this._lit || (this._lit = new Set()); lit.clear();
    for (const h of ['left', 'right']) {
      const a = hub.aim[h];
      const pk = a.valid && !hub.ctx.menuOpen ? this._pickPumpkin(a.origin, a.dir, this.locks[h], chest) : null;
      this.locks[h] = pk ? pk.cand.key : null;
      if (pk) lit.add(pk.cand.it);
    }
    for (const it of this.bombs.items) this.bombs.highlight(it, it.active && lit.has(it) ? 1 : 0);
  }
  _clearHighlights() { for (const it of this.bombs.items) this.bombs.highlight(it, 0); this.locks.left = this.locks.right = null; }
  /** Green Maniac in the web's aim (cone + his radius, range, clear line)? */
  _bossAim(origin, dir) {
    if (this.state !== 'chase' || !this.app.boss.root.visible) return null;
    const B = CHASE_COMBAT.boss, w = this.world;
    return selectTarget(origin, dir, [{ pos: this.bossPos, radius: B.radius, key: 'boss' }], { coneDeg: B.aimDeg, maxRange: B.webRange, minRange: 1, occlusionChecks: 1, occluded: (o, p) => !!w?.segmentBlocked(o.x, o.y, o.z, p.x, p.y, p.z) });
  }
  /**
   * One wrist web: (1) a pumpkin that threatens or that this hand's lock highlights, (2) Green Maniac when aimed at
   * him more closely than at a pumpkin (tether in range, otherwise a web strike), (3) a pumpkin vs a swing anchor by
   * intent (shotIntent: the anchor wins when the aim is clearly closer to it and no pumpkin threatens), (4) swing.
   */
  _onWeb(e, loco, chest) {
    const app = this.app, A = CHASE_COMBAT.aim;
    if (this._lunging) return; // v0.46: the fly-in owns the rig (both hands): a web during it does nothing
    const pk = this._pickPumpkin(e.origin, e.dir, this.locks[e.hand], chest);
    const core = this._coreAim(e.origin, e.dir, chest); // v0.42: the open power core (only when eligible + visible + in range + clear)
    const boss = core ? null : this._bossAim(e.origin, e.dir);
    const tg = core || boss;
    this.lastPick = { t: +this.clock.toFixed(2), hand: e.hand, pumpkin: pk ? +pk.angle.toFixed(1) : null, core: core ? +core.angle.toFixed(1) : null, boss: boss ? +boss.angle.toFixed(1) : null };
    // v0.42: a threatening or highlighted pumpkin always wins (the highlight = what the web hits) — unless the aim is clearly on the open core
    if (pk && (pk.tti < A.imminent || pk.sticky) && !(core && core.norm < 0.5 * pk.norm)) { this._shootPumpkin(pk, e); this.lastPick.took = 'pumpkin'; return; }
    if (core && (!pk || core.norm <= pk.norm)) { // (v0.46: inside close range a staggered boss's open core is "him" too — the fly-in hit)
      if (this.closeOn && this.fight.state === 'staggered' && this.closeRange.state === 'close') { this.lastPick.took = 'boss'; this._webBoss(e, loco, chest); return; }
      this._webCore(e, core); this.lastPick.took = 'core'; return;
    }
    if (boss && (!pk || boss.norm <= pk.norm)) { this.lastPick.took = 'boss'; this._webBoss(e, loco, chest); return; }
    if (pk) {
      const other = loco.ropeOf(e.hand === 'left' ? 'right' : 'left')?.anchor || null;
      const anc = loco.pickAnchor(e.origin, e.dir, other);
      if (shotIntent(pk, anc ? anc.score : null, A) === 'pumpkin') { this._shootPumpkin(pk, e); return; }
    }
    if (!loco.tryAttach(e)) { app.fx.web(e.origin, _v.copy(e.origin).addScaledVector(e.dir, 25)); audio.play('web', 0, e.origin); }
    this.lastPick.took ??= 'swing';
  }
  /** v0.42: is the core open, on the side facing the player, within range? (cheap; LOS is checked by the aim query) */
  _coreVisible(from) {
    if (!this.fight.coreEligible || this.state !== 'chase' || !this.app.boss.root.visible) return false;
    const C = FIGHT.core; _w.copy(from).sub(this.corePos); const d = _w.length(); if (d > C.range || d < 1) return false;
    return _w.dot(this.coreN) / d >= Math.cos(C.viewDeg * Math.PI / 180);
  }
  _coreAim(origin, dir) {
    if (!this._coreVisible(origin)) return null;
    const C = FIGHT.core, w = this.world;
    return selectTarget(origin, dir, [{ pos: this.corePos, radius: C.radius, key: 'core' }], { coneDeg: C.aimDeg, maxRange: C.range, minRange: 1, occlusionChecks: 1, occluded: (o, p) => !!w?.segmentBlocked(o.x, o.y, o.z, p.x, p.y, p.z) });
  }
  _webCore(e) {
    const app = this.app; app.fx.web(e.origin, this.corePos); app.fx.net(this.corePos.clone(), 0.4); audio.play('webHit');
    this._fightHit('web', 'core', this.corePos.clone(), null);
  }
  /** v0.42 Fan Web in chase: clears the pumpkins in a wide horizontal fan (spatial grouping — no beat), chips the shield. */
  _onFanWeb(e, chest) {
    const F = CHASE_COMBAT.fan, w = this.world, app = this.app, o = e.origin || chest, D2R = Math.PI / 180;
    let dir = _d.copy(e.dir || _v.set(0, 0, -1)); dir.y *= 0.5; dir.normalize();
    const fly = this.bombs.items.filter((it) => it.active && it.phase === 'fly');
    const ang = (p) => { _w.copy(p).sub(o); const L = _w.length(); return { L, a: Math.acos(THREE.MathUtils.clamp(_w.dot(dir) / Math.max(L, 1e-6), -1, 1)) / D2R }; };
    const inCone = (it) => { const q = ang(it.pos); return q.L <= F.range && q.a <= F.coneDeg + Math.atan((it.kind === 'giant' ? FIGHT.heavy.hitRadius : 1.2) / Math.max(1, q.L)) / D2R && !w?.segmentBlocked(o.x, o.y, o.z, it.pos.x, it.pos.y, it.pos.z); };
    let hit = fly.filter(inCone);
    if (!hit.length) { // re-centre on the incoming group when it is roughly in front (forgiving: the gesture's direction is the head)
      const near = fly.filter((it) => { const q = ang(it.pos); return q.L <= F.range && q.a <= F.groupDeg; });
      if (near.length) { _v.set(0, 0, 0); for (const it of near) _v.add(it.pos); _v.divideScalar(near.length).sub(o).normalize(); dir.copy(_v); hit = fly.filter(inCone); }
    }
    this.fightStats.fans++; audio.play('fanCharge');
    const pts = hit.map((it) => it.pos.clone());
    if (!pts.length) for (const k of [-1, 0, 1]) pts.push(_w.copy(dir).applyAxisAngle(_v.set(0, 1, 0), k * F.coneDeg * 0.8 * D2R).multiplyScalar(14).add(o).clone());
    this.fanFx.fire(o, pts, 0x4fc8ff, { hit: hit.length > 0 });
    for (const it of hit) { if (this.bombs.shootDown(it, o, 'fan')) { this.stats.bombsShot++; this.fightStats.fanPumpkins++; this.fanFx.burst(it.pos, app.camera.getWorldPosition(_hp)); } }
    if (hit.length) { audio.play('fanHit'); for (const h of ['left', 'right']) app.hub.haptic?.(h, 0.45, 50); this._flowGain('fan'); } // v0.45: + Flow (once per Fan Web)
    // the boss inside the fan: shield chip only (the Fan Web is a defence tool)
    if (this.state === 'chase' && app.boss.root.visible) { const q = ang(this.bossPos); if (q.L <= F.range && q.a <= F.coneDeg) this._fightHit('fan', 'body', this.bossPos.clone(), null); }
  }
  _shootPumpkin(pk, e) {
    if (this.bombs.shootDown(pk.cand.it, e.origin, 'web')) { this.stats.bombsShot++; this.app.hub.haptic?.(e.hand, 0.35, 30); this._flowGain('pumpkin'); } // (heavy counter: _onPumpkinDown; v0.45: + Flow)
    if (this.locks[e.hand] === pk.cand.key) this.locks[e.hand] = null;
  }
  /**
   * v0.46 revision 4: the shield decides (webAtBoss). Shield up → always a web strike (never the jet, never a lunge). Shield
   * broken (staggered): beyond close range within the tether's reach → the web attaches to the jet (held while the hand holds
   * it and he stays staggered; pull in with the v0.44 web pull); inside close range → the fly-in hit. Close combat off → never a
   * lunge (attach / strike only). No line of sight to the jet → a strike.
   */
  _webBoss(e, loco, chest) {
    const app = this.app, p = this.jetAnchor.p, dist = chest.distanceTo(p);
    const staggered = this.fight.state === 'staggered';
    const los = staggered && !this.world.segmentBlocked(chest.x, chest.y, chest.z, p.x, p.y, p.z); // (only needed when staggered)
    const how = this._respawning ? 'strike' : webAtBoss({ staggered, inClose: this.closeOn && this.closeRange.state === 'close', los, dist, minDist: TT.minDist, maxDist: TT.maxDist, tethered: !!this.tether }); // (fix round 1: a held jet web no longer blocks the fly-in — _startLunge releases it; no attach / lunge during the respawn fade)
    if (this.lastPick) this.lastPick.how = how;
    if (how === 'lunge') { this._startLunge(e, loco, chest); return; }
    if (how === 'attach') {
      this.jetAnchor.valid = true;
      if (loco.attachTo(this.jetAnchor, e)) { this._startTether(); return; }
      this.jetAnchor.valid = false;
    }
    // web strike: the web visibly reaches him (protected: the shield takes it)
    const at = this._shieldPoint(e.origin, _hf);
    app.fx.web(e.origin, at); app.fx.net(at.clone(), 0.5); audio.play('webHit');
    this._fightHit('web', 'body', at.clone(), null);
  }
  /** Where a shot from `from` meets the shield bubble (≈ his body when the shield is down). */
  _shieldPoint(from, out) {
    const st = this.fight.state, up = st === 'staggered' || st === 'defeated';
    out.copy(from).sub(this.bossPos); const L = out.length(); return out.multiplyScalar(up ? 0 : Math.min(L - 0.5, 2.6) / Math.max(L, 1e-6)).add(this.bossPos);
  }
  /**
   * v0.42 the ONE entry for hits on Green Maniac: the fight decides HP / shield and the feedback; HP goes through
   * _bossHit (Health). id: a hit id (a Light Bomb's contact + blast count once).
   */
  _fightHit(src, zone, at, id) {
    if (!this.run.running || this.state !== 'chase') return null;
    if (id != null) { if (this._hitIds.has(id)) return null; this._hitIds.add(id); }
    const r = this.fight.hit(src, zone), app = this.app, fx = app.fx, popAt = _w.copy(at).add(_v.set(0, 1.2, 0)).clone();
    const K = this.fightStats;
    switch (r.kind) {
      case 'blocked': K.blocked++; this.fightFx.shieldHit(at, 0.35); if (!r.limited) this._pop('fight.blocked', popAt, COLORS.dim, 0.5); break;
      case 'shield': K.shieldHits++; this.fightFx.shieldHit(at, src === 'lightBomb' || src === 'punch' ? 1 : 0.7); if (src !== 'punch') this._pop('fight.shield', popAt, '#b6ff6a', 0.45); if (src === 'lightBomb') audio.play('boomBlue'); break; // (v0.46: a punch pops its own close.blocked)
      case 'break': this.fightFx.shieldHit(at, 1); this._pop('fight.break', popAt, COLORS.perfect, 0); break;
      case 'counter': K.counters++; if (zone === 'core') K.coreHits++; this._flowGain('counter'); this._pop('fight.counter', popAt, COLORS.perfect, 0); break;
      case 'weak': case 'weakCore': case 'capped': if (zone === 'core') K.coreHits++; if (src !== 'punch') this._pop(zone === 'core' ? 'fight.weakCore' : 'fight.weak', popAt, '#ffe08a', 0.2); break; // (v0.46: a punch pops close.hit)
    }
    if (r.kind !== 'blocked' && r.kind !== 'none' && (r.hp > 0 || r.st > 0)) this._impactFx(src, r.kind, at); // v0.46: every hit that deals HP or shield damage
    this.lastHit = { t: +this.clock.toFixed(2), src, zone, kind: r.kind, hp: r.hp, st: r.st };
    if (this.closeOn && r.kind !== 'blocked' && r.kind !== 'none') this._react(src); // v0.46: every hit that connects plays a reaction
    if (r.hp > 0) this._bossHit(r.hp, at, id, src, r.kind);
    else if (r.kind === 'blocked' || r.kind === 'shield') { audio.play('fizzle'); for (const h of ['left', 'right']) app.hub.haptic?.(h, 0.15, 20); }
    void fx;
    return r;
  }
  /**
   * v0.46 hit reaction (close combat on): headHit / bodyHit on Green Maniac, gated (ReactionGate: spacing, never during a
   * telegraph / throw). The clip returns to his loop by itself; a model without the clips shows the hurt shake instead,
   * which the v0.45 _hurtUntil timer ends (not during a stagger: the stagger's own hurt pose stays).
   */
  _react(src) {
    if (!this.reactGate.allow(this.clock, this.fight.state)) return false;
    const m = this.app.boss.maniac;
    if (!m.setState('hit', pickReaction(src))) return false; // ignored by the model (throw / turn / …): the slot stays free
    this.reactGate.mark(this.clock);
    if (m.state === 'hurt' && this.fight.state !== 'staggered') this._hurtUntil = this.clock + CHASE_COMBAT.boss.hurtTime;
    return true;
  }
  /**
   * v0.46 impact burst (playtest: "when hit boss there was nothing VFX"): pooled fx.boom only, at most one per CLOSE.fx.minGap.
   * Size by source (web / Fan Web / tether small, Light Bomb / counter medium, punch large + a short white flash ring); shield up
   * (shield / break) → the shield's lime at the shield point, staggered → orange on his body. The punch's white ring is a
   * close-combat part: off with the switch or in comfort mode. True when a burst was shown.
   */
  _impactFx(src, kind, at) {
    if (src !== 'punch' && this.clock - this._fxT < CLOSE.fx.minGap) return false; // (fix round 1: the punch's burst always shows — and stamps the limiter)
    this._fxT = this.clock; this.fightStats.bursts++;
    const fx = this.app.fx, punch = src === 'punch', size = punch ? 1.8 : src === 'lightBomb' || src === 'counter' ? 1.1 : 0.6;
    fx.boom(at, { color: kind === 'shield' || kind === 'break' ? IMPACT.shield : IMPACT.body, size, life: punch ? 0.55 : 0.4 });
    if (punch && this.closeOn && !settings.comfortMode) fx.boom(at, { color: IMPACT.flash, size: 1.3, life: 0.2 });
    return true;
  }
  /** World popup with a per-key throttle (no clutter from repeated chip hits). */
  _pop(key, at, color, gap = 0.4) { const n = this.clock; if ((this._popT[key] ?? -9) + gap > n) return; this._popT[key] = n; this.app.fx.popup(key, at, color); }
  /** v0.42: a pumpkin was destroyed (web / Light Bomb / Fan Web). Heavy near the jet right after the release = COUNTER. */
  _onPumpkinDown(it, by) {
    if (it.kind !== 'giant' || it.launchT == null || !this.run.running) return;
    const tSince = this.clock - it.launchT, dj = it.pos.distanceTo(this.app.boss.root.position);
    this.fightStats.heavyKills++;
    if (this.fight.state === 'vent' && heavyCounterOk(tSince, dj)) {
      this.app.fx.vfx?.giantBlast?.(it.pos, { size: 0.9, smoke: false }) || this.app.fx.boom(it.pos, { color: 0xff8a1a, size: 2, life: 0.7 });
      const r = this._fightHit('counter', 'core', it.pos.clone(), `hv${it.id}`);
      if (r && r.kind !== 'counter') this._flowGain('counter'); // v0.45 (a 'counter' result already counted in _fightHit)
    } else this._pop('fight.heavyDown', _w.copy(it.pos).add(_v.set(0, 1, 0)).clone(), COLORS.good, 0);
    void by;
  }
  /** Authoritative Green Maniac damage (web strike / tether / Light Bomb). */
  _bossHit(dmg, at, id, src, kind = 'hit') {
    if (!this.run.running || this.state === 'finisher') return 0; // (v0.45: he is already down)
    const d = this.bossHp.damage(dmg, this.clock, id, src); if (!d) return 0;
    const app = this.app, boss = app.boss;
    this.stats.bossDamage = (this.stats.bossDamage || 0) + d;
    this._jetDamageLook();
    if (!this.closeOn && d >= 2 && !this.tether && this.fight.state !== 'telegraph') { boss.maniac.setState('hurt'); this._hurtUntil = this.clock + CHASE_COMBAT.boss.hurtTime; } // (no flinch on tiny shield chips, never mid-windup) (v0.46: close combat on → _react instead)
    if (d >= 2) { audio.play('bossHit', 0, at); for (const h of ['left', 'right']) app.hub.haptic?.(h, 0.3, 30); app.hud.pulse?.('boss'); }
    if (kind !== 'counter') this._flowGain('bossHit'); // v0.45 (a counter counts once, in _fightHit)
    if (this.bossHp.dead) { if (settings.finisher !== false && !this.hp.dead) this._startFinisher(); else { this.fight.defeat(); this._resolve('victory'); } } // v0.45: the finisher instead of an instant victory
    void kind;
    return d;
  }
  _jetDamageLook() { const f = 1 - this.bossHp.frac; this.app.boss.jet.setDamage(Math.max(f, this.fight.phase >= 3 ? 0.8 : 0, this.fight.state === 'staggered' ? 0.7 : 0)); }
  /** Authoritative Mobius damage (pumpkin blast once per bomb id, hazards); damage protection in Health. */
  _playerHit(dmg, id, src) {
    if (!this.run.running || this.finisher.active) return 0; // (v0.45: nothing hurts Mobius during the finisher — a simultaneous death goes to whoever came first)
    const d = this.hp.damage(dmg, this.clock, id, src); if (!d) return 0;
    this.stats.damage = (this.stats.damage || 0) + d;
    this.app.hud.pulse?.('player');
    if (this.flowOn) this.flow.hurt(); // v0.45: getting hurt drops a Flow level
    if (this.hp.dead) this._resolve('defeat');
    return d;
  }

  // ---------------------------------------------------------------- v0.41 run end: freeze → effect → results
  _resolve(outcome) {
    const app = this.app, loco = app.locomotion, boss = app.boss, map = this.map;
    const coins = app.coins?.count || 0;
    if (!this.run.resolve(outcome, { mapId: this.mapId, mapName: map ? (map.name[getLang()] || map.name.en) : '', coins, distance: Math.round(this.distance || 0), hp: this.hp.hp, bossHp: this.bossHp.hp, bombsShot: this.stats.bombsShot, tethers: this.stats.tethers, ...(this.flowOn ? { style: this.flow.style, peakFlow: this.flow.peak } : {}) })) return false; // v0.45: + style / peak Flow
    this.state = outcome; this.stateTime = 0;
    const fin = this.finisher.state === 'done'; this._finAbort(); // v0.45 (the finisher already blew the jet up)
    // freeze the player exactly where they are (rig only — the head keeps tracking)
    this._endTether(); this._endLunge('resolve'); loco.freeze();
    this.frozenAt = loco.rig.position.clone();
    // stop attacks, damage and pending impacts
    this.bombs.clear(); this.lightBombs.clear(); this._clearHighlights();
    this.held.length = 0; this._tele = null; this.fightFx.setIcon(null); if (outcome === 'victory') this.fight.defeat(); // v0.42: no further attacks
    this.bossMarker.visible = false; this.targetRing.visible = false; this._closeEnd();
    this.bossHold = boss.root.position.clone();
    app.hud.hideBanner(); app.hud.setObjectiveVisible(false);
    if (outcome === 'victory') {
      boss.maniac.setState('angryLoop'); boss.jet.setDamage(1); boss.jet.setThrust?.(0.3);
      if (!fin) { app.fx.vfx?.blueBomb(this.bossPos, { size: 1.6 }) || app.fx.boom(this.bossPos, { color: 0x5fd8ff, size: 2.2 }); audio.play('boomEnemy'); }
      audio.play('perfect');
      app.hud.showBanner(t('world.victory'), CHASE_COMBAT.results.delay + 0.3, COLORS.perfect, t('world.bossDown'));
    } else {
      app.flashDamage?.(); audio.play('damage');
      app.hud.showBanner(t('world.defeat'), CHASE_COMBAT.results.delay + 0.3, COLORS.bad, t('world.playerDown'));
    }
    this.hum?.setLevel(0.25);
    this._saveBest();
    this._hud(true);
    return true;
  }
  _updateResolved(dt, tNow, feet) {
    const app = this.app, boss = app.boss;
    this.run.tick(dt);
    // Green Maniac settles: hovers where he was (defeated: sinks a little, smoking), facing Mobius
    if (this.bossHold) {
      const k = this.run.outcome === 'victory' ? Math.min(1, this.run.transitionT / 2) : 0;
      _v.copy(this.bossHold); _v.y += Math.sin(tNow * 1.3) * 0.25 - 1.2 * k;
      boss.flyToward(_v, 4, dt, tNow, _w.copy(feet).setY(_v.y));
    }
    this.bossMarker.visible = false; this.targetRing.visible = false; this.closeRing.visible = false;
    this.fightFx.update(dt, this.fight, tNow, this.app.camera.getWorldPosition(_hp), null); this.fanFx.update(dt);
    if (this.run.phase !== 'results' && this.run.transitionT >= CHASE_COMBAT.results.delay && !this._resultShown) this.showResults();
  }
  showResults() {
    if (this._resultShown || !this.run.showResults()) return;
    this._resultShown = true; this.state = 'results';
    this.app.hud.hideBanner();
    this.app.menus.show('worldResults', { worldResult: { ...this.run.final } });
  }
  // ---------------------------------------------------------------- v0.45 boss finisher
  // The last hit stalls the jet in slow motion (timeWarp hold); webs aimed at it within FEEL.finisher.aimDeg become held
  // strands (one per hand); with both hands on it a pull stroke (WebPullDetector, fed like Locomotion._updatePull) yanks it
  // down into the blast. No input → it blows up by itself after FEEL.finisher.timeout. The Finisher runs on REAL dt.
  _startFinisher() {
    const app = this.app, boss = app.boss;
    this.fight.defeat(); this.bombs.clear(); this.lightBombs.clear(); this._endTether(); this._endLunge('finisher'); this._clearHighlights();
    this.held.length = 0; this._tele = null; this.fightFx.setIcon(null); this._hurtUntil = 0; this._closeEnd(); // v0.46
    this.state = 'finisher'; this.stateTime = 0;
    this._finAbort(); this.finisher.start(); this.bossHold = boss.root.position.clone();
    if (settings.impactTime !== false) app.timeWarp?.hold(FEEL.warp.defeat.scale, { comfort: !!settings.comfortMode }); // (impact time off: the finisher at full speed)
    boss.jet.setDamage(1); boss.jet.setThrust(0.1);
    this._finBanner('fin.web');
  }
  /** Finisher off + its strands released (run start / stop / resolve). */
  _finAbort() {
    this.finisher.abort(); this._finRelease(); this._finYank = null; this._finBodyOk = false; this._finT = 0;
    if (this._finBan) { this._finBan = null; this.app.hud?.hideBanner(); } // (the long-lived prompt never outlives the finisher)
    const pb = this.app.hub?.pullBusy; for (const h of HANDS) { this._finPull[h].reset(); if (pb) pb[h] = false; }
  }
  _finRelease(hand) { for (const h of HANDS) if ((!hand || h === hand) && this._finBeams[h]) { this.app.fx.releaseBeam(this._finBeams[h]); this._finBeams[h] = null; } }
  /** Prompt that stays up for the whole real-time window: shown with a long duration (HUD banners run on the wall clock, which
   *  keeps going during a pause and between slow frames), re-shown if another banner replaced it, taken down explicitly at the
   *  yank / blast / abort (and by _resolve). */
  _finBanner(key, dur = 60) {
    const hud = this.app.hud, txt = t(key);
    if (this._finBan === key && hud.banner?.text === txt && hud.banner.until - hud._now > 1) return;
    this._finBan = key; hud.showBanner(txt, dur, COLORS.perfect, t('fin.sub'));
  }
  /** A web in the finisher: aimed at the jet → that hand's strand (instead of a swing); anywhere else → a normal swing. */
  _finWeb(e, loco) {
    const F = this.finisher, j = this.jetAnchor.p;
    _w.copy(j).sub(e.origin); const L = _w.length();
    const ang = L > 1e-3 ? Math.acos(THREE.MathUtils.clamp(_w.dot(e.dir) / L, -1, 1)) * 180 / Math.PI : 180;
    if ((F.state === 'stall' || F.state === 'tethered') && ang <= FEEL.finisher.aimDeg) { this._finTether(e.hand, e.origin); return; }
    if (!loco.tryAttach(e)) { this.app.fx.web(e.origin, _v.copy(e.origin).addScaledVector(e.dir, 25)); audio.play('web', 0, e.origin); }
  }
  _finTether(h, origin) {
    const app = this.app, hub = app.hub, F = this.finisher;
    F.tether(h); if (!F.hands[h]) return; this._finLastHeld[h] = this._finT;
    if (app.locomotion.ropeOf(h)) app.locomotion.detachHand(h, true); // that hand lets go of its swing first
    this._finRelease(h);
    this._finBeams[h] = app.fx.web(origin, this.jetAnchor.p, { hold: true, follow: (out) => { if (hub.aim[h].valid) hub.aimOriginNow(h, out); } });
    app.fx.net(this.jetAnchor.p.clone(), 0.5); audio.play('webHit', 0, origin); hub.haptic?.(h, 0.4, 40);
  }
  /** Desktop dev (F): both strands + the pull at once. */
  _finKey() {
    const hub = this.app.hub, chest = this._chest, st = this.finisher.state; if (st !== 'stall' && st !== 'tethered') return;
    for (const h of HANDS) this._finTether(h, hub.aim[h].valid ? hub.aim[h].origin : chest);
    this.finisher.pull();
  }
  /** Pull stroke on either strand (body point smoothed like Locomotion._updatePull). True when a stroke started this frame. */
  _finPullStep(realDt, tNow) {
    const hub = this.app.hub, F = this.finisher, cam = this.app.camera.position, c = this._finIn;
    _hp.set(cam.x, cam.y - PULL.chestDrop, cam.z);
    if (!this._finBodyOk) { this._finBody.copy(_hp); this._finBodyOk = true; } else this._finBody.lerp(_hp, 1 - Math.exp(-realDt / PULL.bodySmooth));
    let go = false;
    for (const h of HANDS) {
      const hl = hub.handLocal?.[h];
      c.t = tNow; c.dt = realDt; c.held = F.hands[h]; c.tracked = !!hl?.valid && !hub.trackingLost?.[h]; c.hand = hl?.pos || null;
      this._finPull[h].update(c);
      if (hub.pullBusy) hub.pullBusy[h] = this._finPull[h].busy(tNow); // (as Locomotion._updatePull: the forward reset after a pull is not a web flick)
      if (this._finPull[h].justStarted) go = true;
    }
    return go;
  }
  /** Per running frame in state 'finisher': dt = world dt (hover), realDt = the finisher's clock (never while a menu is open). */
  _updateFinisher(dt, realDt, tNow, feet) {
    const app = this.app, F = this.finisher, hub = app.hub, boss = app.boss, live = !app.menus.open, rdt = live ? realDt : 0;
    this._finT += rdt;
    if (rdt > 0 && this._finPullStep(rdt, tNow)) F.pull(); // (before the release check: a pull and an opening hand in one frame still pulls)
    if (F.state === 'stall' || F.state === 'tethered') for (const h of HANDS) { // an opened hand / released trigger lets go — after the same grace as a swing web (web.held flickers)
      if (!F.hands[h]) continue;
      if (hub.webHeld[h]) this._finLastHeld[h] = this._finT;
      else if (this._finT - this._finLastHeld[h] > (hub.trackingLost?.[h] ? WEB_HOLD_GRACE.lost : WEB_HOLD_GRACE.held)) { F.untether(h); this._finRelease(h); }
    }
    for (const e of F.update(rdt)) this._onFinisherEvent(e, feet);
    if (!this.run.running) return;
    const Y = this._finYank;
    if (Y) { Y.t = Math.min(FEEL.finisher.yankTime, Y.t + rdt); const k = Y.t / FEEL.finisher.yankTime; boss.root.position.lerpVectors(Y.from, Y.to, k * k * (3 - 2 * k)); }
    else if (this.bossHold) { _v.copy(this.bossHold); _v.y += Math.sin(tNow * 1.3) * 0.25; boss.flyToward(_v, 4, dt, tNow, _w.copy(feet).setY(_v.y)); } // stalled: hovers where he was hit, facing Mobius
    for (const h of HANDS) if (this._finBeams[h]) this._finBeams[h].to.copy(this.jetAnchor.p); // strands stay on the jet
    this.hum?.setLevel(0.3);
    if (F.state === 'stall') this._finBanner('fin.web'); else if (F.state === 'tethered') this._finBanner('fin.pull');
  }
  _onFinisherEvent(e, feet) {
    const app = this.app, boss = app.boss, hub = app.hub;
    switch (e.type) {
      case 'tethered': this._finBanner('fin.pull'); for (const h of HANDS) hub.haptic?.(h, 0.5, 60); break;
      case 'yank': { // 6 m down and 4 m along the player's flattened head forward — never toward the player
        audio.play('finisherYank'); for (const h of HANDS) { if (this._finBeams[h]) this._finBeams[h].pulse = 1; hub.haptic?.(h, 0.8, 120); }
        const from = boss.root.position.clone(), f = _hf.set(0, 0, -1).applyQuaternion(app.camera.getWorldQuaternion(_hq)).setY(0), r = _d.copy(from).sub(feet).setY(0);
        if (f.lengthSq() < 1e-6) f.copy(r); f.normalize();
        if (f.dot(r) < 0 && r.lengthSq() > 1e-6) f.copy(r).normalize(); // facing away from the jet: straight away from the player instead
        this._finYank = { t: 0, from, to: from.clone().add(_v.set(0, -6, 0)).addScaledVector(f, 4) };
        this._finBan = null; app.hud.hideBanner();
        break;
      }
      case 'blast': {
        boss.root.updateMatrixWorld(true); const at = this._bossCenter(_w).clone();
        app.fx.vfx?.giantBlast?.(at, { size: 1.4 }) || app.fx.boom(at, { color: 0xff8a1a, size: 2.6, life: 0.8 });
        audio.play('boomEnemy'); boss.maniac.setState('hurt'); for (const h of HANDS) hub.haptic?.(h, 1, 160);
        app.timeWarp?.release(FEEL.warp.defeat.ease); this._finRelease();
        if (this._finBan) { this._finBan = null; app.hud.hideBanner(); } // (timeout: the prompt goes with the jet)
        break;
      }
      case 'done':
        this.stats.finisher = e.byPlayer ? 'player' : 'timeout';
        if (e.byPlayer && this.flowOn) this.flow.bonus(FEEL.finisher.bonus); // before _resolve: lands in run.final.style and the saved best
        this._resolve('victory');
        break;
    }
  }

  // ---------------------------------------------------------------- v0.45 Flow meter
  _flowGain(kind) { return this.run.running && this.flowOn ? this.flow.gain(kind) : 0; }
  /** Per running frame (world dt: slow motion slows the decay): shield blocks → gain, level changes → sound, level → tints. */
  _updateFlow(dt) {
    const F = this.flow, bl = this.app.shield?.stats.blocked || 0;
    if (bl > this._blk) this._flowGain('block'); this._blk = bl;
    if (!this.flowOn && (F.points || F.style || F.peak)) F.reset(); // switched off mid-run: level 0, no style
    for (const e of F.update(dt)) if (e.type === 'levelUp') audio.play('flowUp');
    this._flowFx(this.flowOn ? F.level : -1);
  }
  /** level → beam brightness (fx.flowLevel), wind tint, music low-pass / lift; -1 = neutral (off / outside the chase). */
  _flowFx(L) {
    const app = this.app, C = FEEL.flow, on = L >= 0;
    app.fx.flowLevel = on ? L : 0; if (app.windFx) app.windFx.flowTint = on ? C.windTint[L] : 0;
    if (app.feelMusic) { app.feelMusic.flowCutoff = on ? C.musicCutoff[L] : 20000; app.feelMusic.lift = on ? C.musicLift[L] : 1; }
  }
  _flowClear() { this._flowFx(-1); }
  /** HUD pips: level + how far the next one is filled. */
  _flowHud() {
    const F = this.flow, T = FEEL.flow.thresholds, L = F.level; if (L >= T.length) return { level: L, frac: 1 };
    const lo = L ? T[L - 1] : 0; return { level: L, frac: THREE.MathUtils.clamp((F.points - lo) / (T[L] - lo), 0, 1) };
  }
  /** HUD data (throttled by the HUD's own change check). */
  _hud(force) {
    const r = this.run, lb = this.lightBombs;
    this.app.hud.setChase?.({ bossHp: this.bossHp.frac, bossLag: this.bossHp.lag / this.bossHp.max, bossHpN: Math.ceil(this.bossHp.hp), bossMax: this.bossHp.max,
      hp: this.hp.frac, hpLag: this.hp.lag / this.hp.max, hpN: Math.ceil(this.hp.hp), hpMax: this.hp.max,
      time: r.final ? r.final.time : r.time, bomb: lb.readiness, bombReady: lb.ready && this.allowAttack && this.state !== 'finisher', hurt: this.clock - this.hp.lastHitT < 0.5,
      fight: this.state === 'intro' ? null : { state: this.fight.state, attack: this.fight.attack, shield: this.fight.shieldFrac, window: this.fight.windowFrac, phase: this.fight.phase, broken: this.fight.staggerCause === 'break' },
      flow: this.flowOn ? this._flowHud() : null }, force); // v0.45
  }
  _objective(force) {
    const d = Math.round(this.distance || 0), gap = Math.max(0, Math.round(this.bossS - this.playerS));
    const key = `${d}|${Math.round(gap / 5)}`; if (!force && key === this._objKey) return; this._objKey = key;
    const k = this.app.hub.inputKind, bomb = k === 'controllers' ? t('tut.ctrl.bomb') : k === 'desktop' ? 'Desktop: hold & release Space = Light Bomb' : t('tut.bomb');
    this.app.story.objective(t('world.obj', { m: d.toLocaleString(), gap }), this.state === 'intro' ? [t('tut.swing'), bomb] : []);
  }

  // ---------------------------------------------------------------- Green Maniac: controlled distance management
  _updateBoss(dt, tNow, feet) {
    const app = this.app, w = this.world, boss = app.boss, C = WORLD_CHASE;
    if (this.state === 'intro') {
      const p = w.pointAt(this.bossS), y = p.y + 4 + Math.sin(tNow * 1.4) * 0.3;
      const d = boss.flyToward(_v.set(p.x, y, p.z), 10, dt, tNow, w.pointAt(this.bossS + 12).setY(y));
      if (!this._faced && d < 2) { this._faced = true; boss.maniac.setState('faceBack'); }
      const moved = Math.hypot(feet.x - this.startFeet.x, feet.z - this.startFeet.z) > 8 || feet.y - this.startFeet.y > 3;
      if (app.locomotion.attach || moved || this.stateTime > C.introMax) {
        this.state = 'chase'; this.stateTime = 0; this.run.start(); boss.maniac.setState(this._faced ? 'faceFront' : 'ride'); audio.play('jetFlyby'); // v0.41: the chase timer starts here
        app.hud.showBanner(t('world.go'), 2.0, COLORS.bad, t('char.boss'));
      }
      w.pin('boss', w.moduleAtS(this.bossS)?.idx);
      this.hum?.setLevel(0.5);
      return;
    }
    const eff = Math.min(this.playerS, this.maxS + 10), gap = this.bossS - eff, F = this.fight;
    // v0.46 close range: inside CLOSE.tauntIn he holds the gap (floor CLOSE.holdGap) and taunts (_closePose); camping → boost
    this.closeRange.update(dt, gap, F.state === 'staggered', this.closeOn); // (revision 4: no hint on the taunt — the rings and their hints are for a staggered boss, _updateVisuals)
    // v0.42 pursuit: follow the player's route speed toward a lead band (no sprint when Mobius closes in)
    // v0.44: successful web pulls buy ground — he gives up a little of his normal lead for a while (never in an opening: those leads are already short)
    const cut = pullLeadCut(this._pullLead, app.locomotion.stats.pullDv || 0, dt);
    const slow = F.slowed, lead = slow ? C.leadOpening[slow] : Math.max(C.pull.minLead, C.lead - cut);
    this._bv = pursuitSpeed(this._bv, this.closeRange.pursuit({ gap, lead, ps: this.playerSpeed, psNow: this.playerSpeedNow, slow, tetherStuck: !!this.tether, breakAway: false }), dt, C); // (v0.46: + minGap, the boost, the close-range hold; revision 4: no break-away after a web cut — there is none)
    const lim = w.readyUntil(this.bossS) - C.readyMargin;
    this.bossS = Math.max(this.bossS, Math.min(this.bossS + this._bv * dt, lim));
    const cl = this.closeRange.clamps; this.bossS = this.closeRange.holdS(this.bossS, eff, lim, this._lunging); if (this.closeRange.clamps > cl) this._bv = Math.max(this._bv, this.playerSpeedNow); // v0.46: never flown through (last resort; lim wins)
    w.pin('boss', w.moduleAtS(this.bossS)?.idx);
    const p = w.pointAt(this.bossS), mod = w.moduleAtS(this.bossS);
    // map-aware flight height (route metadata only; skipped when that point is inside scenery)
    const fl = fightFlavor(this.mapId).alt; let dy = 0;
    if (fl.dy && mod && fl.types.includes(mod.type)) { dy = fl.alternate ? (mod.idx % 2 ? fl.dy : -fl.dy * 0.6) : fl.dy; if (w.pointBlocked(p.x, p.y + 5.5 + dy, p.z, 2.5)) dy = 0; }
    this._altOff += (dy - this._altOff) * Math.min(1, dt * 0.8);
    const y = p.y + 5.5 + this._altOff + Math.sin(tNow * 1.4) * (slow === 'stagger' ? 0.3 : 0.8);
    const target = _v.set(p.x, y, p.z);
    if (this._bv < 1.5) { target.x += Math.sin(tNow * 0.9) * 2.0; target.z += Math.cos(tNow * 0.9) * 1.2; } // hovering in front, waiting
    const look = w.pointAt(this.bossS + 14); look.y = y;
    boss.flyToward(target, 26, dt, tNow, look); // speed-limited → never teleports
    const a0 = w.headingAt(this.bossS), a1 = w.headingAt(this.bossS + 20);
    const wob = slow === 'stagger' ? Math.sin(tNow * 4.2) * 0.14 : 0; // staggered: a gentle, readable wobble (his roll, never the camera)
    boss.bank(THREE.MathUtils.clamp(-(a1 - a0) * 1.6, -0.45, 0.45) + wob, 1 - Math.exp(-dt * 3)); // readable bank into turns
    boss.jet.setThrust(slow === 'stagger' ? 0.2 : F.state === 'vent' ? 0.55 : 1);
    this.hum?.setLevel(1 - Math.min(1, boss.root.position.distanceTo(feet) / 75));
  }

  // ---------------------------------------------------------------- v0.42 boss fight driver (fairness → fight → animation / projectiles)
  _fairness(chest) {
    const w = this.world, app = this.app, quiet = CHASE_COMBAT.bombs.quietModules, C = WORLD_CHASE;
    const bmod = w.moduleAtS(this.bossS), pmod = w.moduleAtS(this.playerS), ahead = w.moduleAtS(this.playerS + C.upcoming);
    const dist = app.boss.root.position.distanceTo(chest);
    const calm = !quiet.includes(bmod?.type) && !quiet.includes(pmod?.type) && !['turnL', 'turnR', 'gate'].includes(ahead?.type);
    const base = this.state === 'chase' && !this.tether && app.story.fade.a < 0.01 && this.clock > 6 && !this._respawning;
    let los = this._fair.los ?? false;
    if ((this._fairT -= 1) <= 0 || !base) { this._fairT = 12; app.boss.throwPoint(_w); los = !w.segmentBlocked(_w.x, _w.y, _w.z, chest.x, chest.y, chest.z); } // line of sight ≈ 5×/s (bounded cost)
    const hv = fightFlavor(this.mapId).heavy;
    const heavyOk = hv.includes(pmod?.type) && hv.includes(ahead?.type) && hv.includes(bmod?.type);
    const flying = this.bombs.items.reduce((n, it) => n + (it.active && it.phase === 'fly' ? 1 : 0), 0);
    this._fair = { fair: base && calm && los, base, calm, los, dist, flying, heavyOk, abort: this._respawning || (!base && this.state === 'chase'), bossHpFrac: this.bossHp.frac };
    return this._fair;
  }
  _updateFight(dt, tNow, chest) {
    const app = this.app, boss = app.boss, F = this.fight, B = this.bombs;
    if (this.state !== 'chase') { this.fightFx.update(dt, F, tNow, app.camera.getWorldPosition(_hp), null); return; }
    const ctx = this._fairness(chest);
    const evs = F.update(dt, ctx);
    for (const e of evs) this._onFightEvent(e, chest);
    // telegraph: held pumpkins follow his hand (decorative: phase 'held' — never a target, never a counter)
    const T = this._tele;
    if (T && F.state === 'telegraph') {
      T.t += dt; const len = FIGHT.telegraph[T.kind];
      if (T.angry && boss.maniac.state !== 'faceFront') { T.angry = false; if (!T.turned) boss.maniac.setState('angry'); } // v0.46 (heavy from a taunt)
      if (T.kind === 'heavy' && !T.turned && T.t >= len - 0.6 - GREEN_MANIAC_THROW_RELEASE) { T.turned = true; boss.maniac.setState('turn'); }
      if (!T.threw && T.t >= len - GREEN_MANIAC_THROW_RELEASE) { T.threw = true; boss.throw(); }
      boss.throwPoint(_w); boss.root.updateMatrixWorld(true);
      _d.set(1, 0, 0).transformDirection(boss.root.matrixWorld); // the jet's right axis (spread fan)
      const k = Math.min(1, T.t / len);
      this.held.forEach((it, i) => {
        if (!it.active) return;
        if (T.kind === 'heavy') { const up = T.threw ? 0 : 1; boss.maniac.hitCenter.getWorldPosition(_v); it.pos.copy(_v).addScaledVector(_d, 0.9 * up).add(_hf.set(0, 0.5 * up, 0)).lerp(_w, T.threw ? 1 : 0); /* held up beside him, clear of the HUD bar */ it.p.root.scale.setScalar(FIGHT.heavy.scale * (0.55 + 0.45 * Math.min(1, k * 1.6))); }
        else if (T.kind === 'spread') it.pos.copy(_w).addScaledVector(_d, (i - 1) * (0.25 + 0.45 * Math.min(1, k * 2))).add(_hf.set(0, Math.abs(i - 1) * -0.1, 0));
        else it.pos.copy(_w);
        it.p.root.position.copy(it.pos); it.p.setGlow(0.5 + 0.5 * Math.abs(Math.sin(T.t * (T.kind === 'heavy' ? 9 : 14)))); it.p.update(dt); it.p.root.lookAt(chest);
      });
    }
    // the heavy pumpkin's counter window (time AND distance) → ring around it
    let hv = null;
    if (F.state === 'vent') for (const it of B.items) if (it.active && it.phase === 'fly' && it.kind === 'giant' && it.launchT != null) {
      const ts = this.clock - it.launchT, dj = it.pos.distanceTo(boss.root.position);
      if (heavyCounterOk(ts, dj)) hv = { pos: it.pos, radius: FIGHT.heavy.hitRadius * 0.9, frac: 1 - ts / FIGHT.heavy.counterTime };
    }
    this.fightFx.update(dt, F, tNow, app.camera.getWorldPosition(_hp), hv);
    this._jetDamageLook();
    if (this.debugFight) this._fightDebugTick(dt);
  }
  _onFightEvent(e, chest) {
    const app = this.app, boss = app.boss, B = this.bombs, H = FIGHT.heavy, loco = app.locomotion;
    const corePop = () => _w.copy(this.corePos).add(_v.set(0, 1.4, 0)).clone();
    switch (e.type) {
      case 'telegraph': {
        const k = e.attack; this._tele = { kind: k, t: 0, threw: false, turned: false };
        this.held.length = 0;
        const n = k === 'spread' ? 3 : 1;
        for (let i = 0; i < n; i++) { const it = B._get(k === 'heavy' ? 'giant' : 'normal'); if (it) { it.phase = 'held'; boss.throwPoint(it.pos); it.p.root.position.copy(it.pos); this.held.push(it); } }
        this.fightFx.setIcon(k);
        const back = boss.maniac.facingBack; this._tele.back = back && k !== 'heavy'; // v0.46: taunting (facing the player behind him): he keeps facing them until this throw is released
        if (k === 'heavy') { if (back) { boss.maniac.setState('faceFront'); this._tele.angry = true; /* the windup clip faces forward: after the turn (_updateFight) */ } else boss.maniac.setState('angry'); audio.play('alarm'); audio.play('heavyWindup'); /* v0.45 */ app.hud.showBanner(t('fight.heavyIncoming'), 1.8, COLORS.bad, t('fight.heavyHow')); if (this.held[0]) app.fx.vfx?.giantCharge?.(this.held[0].p); }
        else { if (!back) boss.maniac.setState('turn'); /* (v0.46: already facing the player: the throw is the turned-around one) */ audio.play('tick'); if (k === 'spread' && !this._spreadHint) { this._spreadHint = true; app.hud.showBanner(t('fight.spreadIncoming'), 2.0, COLORS.warn, t(app.hub.inputKind === 'hands' ? 'fight.spreadHowHands' : 'fight.spreadHow')); } }
        break;
      }
      case 'ventOpen': audio.play('thrust'); this._pop('fight.coreOpen', corePop(), '#ffb070', 0); break;
      case 'release': {
        const k = e.attack, its = this.held.filter((it) => it.active && it.phase === 'held'); this.held.length = 0; this.fightFx.setIcon(null);
        if (!its.length) break;
        if (k === 'spread') {
          _d.copy(chest).sub(boss.root.position).setY(0).normalize(); _hf.set(-_d.z, 0, _d.x); // lateral axis at the player
          its.forEach((it, i) => B._launch(it, chest, loco.vel, { T: FIGHT.spread.flight + 0.08 * Math.abs(i - 1), offset: _hp.copy(_hf).multiplyScalar((i - 1) * FIGHT.spread.lateral) }));
        } else if (k === 'heavy') {
          const it = its[0], T = H.flight[0] + Math.random() * (H.flight[1] - H.flight[0]);
          B._launch(it, chest, loco.vel, { T, blast: H.blast, gravity: H.gravity }); it.launchT = this.clock;
          app.hud.showBanner(t('fight.counterNow'), 1.3, COLORS.perfect, '');
        } else { const it = its[0]; B._launch(it, chest, loco.vel, { T: THREE.MathUtils.clamp(flightTimeFor(it.pos.distanceTo(chest), B.cfg), FIGHT.single.flight[0], FIGHT.single.flight[1]) }); }
        if (B.stats.thrown === its.length && !this._bombHint) { this._bombHint = true; app.hud.showBanner(t('story.hint.bombs'), 2.6, COLORS.warn); }
        break;
      }
      case 'cancel': for (const it of this.held) if (it.active && it.phase === 'held') B._free(it); this.held.length = 0; this._tele = null; this.fightFx.setIcon(null); break;
      case 'stagger': {
        for (const it of this.held) if (it.active && it.phase === 'held') B._free(it); this.held.length = 0; this._tele = null; this.fightFx.setIcon(null);
        boss.maniac.setState('hurt'); this._hurtUntil = 0; audio.play('perfect'); audio.play('stagger'); /* v0.45: own stagger sound */
        for (const h of ['left', 'right']) app.hub.haptic?.(h, 0.6, 90);
        app.hud.showBanner(t(e.cause === 'break' ? 'fight.shieldBroken' : 'fight.counterOk'), 1.6, COLORS.perfect, t(e.cause === 'break' ? 'fight.breakHow' : 'fight.staggerHow'));
        app.fx.vfx?.blueBomb?.(this.bossPos, { size: 0.8 }) || app.fx.boom(this.bossPos, { color: 0x9dff3a, size: 1.2, life: 0.5 });
        if (settings.impactTime !== false) app.timeWarp?.request(e.cause === 'break' ? 'break' : 'counter', { comfort: settings.comfortMode }); // v0.45 impact time
        break;
      }
      case 'recover': audio.play('charge'); this._pop('fight.recovering', _w.copy(this.bossPos).add(_v.set(0, 2.2, 0)).clone(), COLORS.warn, 0); if (this.fight.state === 'recovering') { if (boss.maniac.state === 'hit') this._poseAfterHit = true; else boss.maniac.setState(this._restPose()); } break; // (v0.46: the stagger ends in the close-range pose — after a hit reaction that is still playing: the punch that caps a stagger keeps its Head Hit)
      case 'shieldUp': this._pop('fight.protected', _w.copy(this.bossPos).add(_v.set(0, 2.2, 0)).clone(), '#b6ff6a', 0); break;
      case 'phase': if (e.phase === 3) { app.hud.showBanner(t('fight.phase3'), 2.0, COLORS.bad, t('char.boss')); audio.play('alarm'); } else if (e.phase === 2) app.hud.showBanner(t('fight.phase2'), 1.8, COLORS.warn, t('char.boss')); break;
    }
  }

  // ---------------------------------------------------------------- v0.42 debug (?fightdebug): overlay + keys; never in the normal UI
  _installFightDebug() {
    if (typeof document === 'undefined') return;
    const el = document.createElement('pre'); el.id = 'fight-debug';
    Object.assign(el.style, { position: 'fixed', left: '8px', top: '8px', zIndex: 9999, margin: 0, padding: '8px 10px', font: '12px/1.35 ui-monospace,Menlo,monospace', color: '#cfffd0', background: 'rgba(0,10,0,0.72)', pointerEvents: 'none', whiteSpace: 'pre', maxWidth: '46vw' });
    document.body.appendChild(el); this._dbgEl = el; this._dbgT = 0;
    addEventListener('keydown', (ev) => {
      if (!this.active || this.state !== 'chase') return;
      const D = this.debug, k = ev.code;
      if (k === 'Digit1') D.phase(1); else if (k === 'Digit2') D.phase(2); else if (k === 'Digit3') D.phase(3);
      else if (k === 'KeyH') D.attack('heavy'); else if (k === 'KeyJ') D.attack('spread'); else if (k === 'KeyU') D.attack('single');
      else if (k === 'KeyK') D.setBossHp(0.05); else if (k === 'KeyG') D.setBossHp(1 / this.bossHp.max); else if (k === 'KeyX') D.stagger(); else if (k === 'Digit0') D.reset();
    });
  }
  /** Debug / tuning hooks (tests, ?fightdebug keys). */
  get debug() {
    return {
      setBossHp: (frac) => { this.bossHp.hp = Math.max(0.5, this.bossHp.max * frac); this.bossHp.lag = this.bossHp.hp; this._jetDamageLook(); },
      phase: (n) => { const f = n === 1 ? 1 : n === 2 ? 0.6 : 0.25; this.debug.setBossHp(f); },
      attack: (kind) => { if (kind === 'heavy') this.fight.fightT = Math.max(this.fight.fightT, FIGHT.heavy.first); return this.fight.forceAttack(kind); },
      stagger: () => this.fight.forceStagger('counter'),
      reset: () => { this.bossHp.reset(); this.fight.reset(0xb055 + this.runs); this.bombs.clear(); this.held.length = 0; this._tele = null; this.fightFx.reset(); },
    };
  }
  _fightDebugTick(dt) {
    if ((this._dbgT -= dt) > 0 || !this._dbgEl) return; this._dbgT = 0.2;
    const f = this.fight.snapshot(), q = this._fair, gap = this.bossS - this.playerS;
    this._dbgEl.textContent = [
      `FIGHT ${f.state}${f.attack ? ' / ' + f.attack : ''}  t ${f.t}s  phase ${f.phase}  next ${f.nextAttackIn}s  sinceHeavy ${f.sinceHeavy}s`,
      `boss HP ${this.bossHp.hp.toFixed(1)}/${this.bossHp.max}  shield ${f.stability}/${FIGHT.shield.max}  core ${f.coreOpen ? 'OPEN' : 'shut'}  window ${f.window}  opening ${f.opening}`,
      `pull: strokes ${this.app.locomotion.stats.pulls}  surge ${(this.app.locomotion.pull?.surge || 0).toFixed(1)} m/s  lead cut ${this._pullLead.cut.toFixed(1)} m   shield: energy ${Math.round(this.app.shield?.energy.value ?? 0)}  blocked ${this.app.shield?.stats.blocked ?? 0}`,
      `gap ${gap.toFixed(1)} m  bossV ${this._bv.toFixed(1)}  playerV ${this.playerSpeed.toFixed(1)}  dist ${q.dist?.toFixed(1)}  fair ${q.fair} (calm ${q.calm} los ${q.los} heavyOk ${q.heavyOk}) flying ${q.flying}`,
      `pick ${JSON.stringify(this.lastPick || {})}`,
      `hit  ${JSON.stringify(this.lastHit || {})}`,
      `stats ${JSON.stringify(this.fightStats)} ${JSON.stringify(f.stats.attacks)} counters ${f.stats.counters} breaks ${f.stats.breaks} missed ${f.stats.missedHeavies}`,
      `keys: 1/2/3 phase · U single · J spread · H heavy · X stagger · K boss 5% · G boss 1 HP · 0 reset`,
    ].join('\n');
  }

  // ---------------------------------------------------------------- jet tether (v0.46 revision 4: a staggered boss only, no web cut)
  // R4.2: beyond close range a web at a staggered Green Maniac attaches to the jet and stays for as long as the hand holds it
  // and he stays staggered (the player closes in with the v0.44 web pull); the first attach in a stagger deals the tether
  // damage. R4.4: no counter — no turn-and-throw, no cut blast / banner, no cooldown, no break-away. When the stagger ends the
  // web lets go quietly (release sound only).
  tetherCheck(chest) {
    if (this.state !== 'chase') return { ok: false, why: 'state' };
    if (this.tether) return { ok: false, why: 'busy' };
    if (this.fight.state === 'telegraph' || this.fight.state === 'vent') return { ok: false, why: 'busy' }; // v0.42: never during a windup
    const d = chest.distanceTo(this.jetAnchor.p);
    if (d > TT.maxDist || d < TT.minDist) return { ok: false, why: 'range', dist: d };
    const p = this.jetAnchor.p; if (this.world.segmentBlocked(chest.x, chest.y, chest.z, p.x, p.y, p.z)) return { ok: false, why: 'occluded', dist: d };
    return { ok: true, dist: d };
  }
  _startTether() {
    this.tether = { t: 0 }; this.stats.tethers++;
    const app = this.app, p = this.jetAnchor.p;
    audio.play('webHit'); app.fx.net(p.clone(), 0.5); for (const h of ['left', 'right']) app.hub.haptic?.(h, 0.45, 60);
    app.hud.showBanner(t('story.tether.hit'), 1.4, COLORS.perfect, t('char.jet'));
    const n = this.fight.stats.staggers; // only the first attach in a stagger deals damage
    if (this._tetherDmgStag !== n) { this._tetherDmgStag = n; this._fightHit('tether', 'body', p.clone(), null); }
  }
  _updateTether(dt, loco) {
    const T = this.tether; if (!T) return;
    T.t += dt;
    if (!loco.holds(this.jetAnchor)) { this.tether = null; this.jetAnchor.valid = false; return; } // the hand let go (locomotion released the web)
    if (this.fight.state !== 'staggered' || this.state !== 'chase') { this._releaseTether(); return; } // the stagger ended: a quiet release
    if (T.t < TT.pullTime) { const chest = loco.feet(_v).add(_w.set(0, CHEST, 0)); loco.vel.addScaledVector(_d.copy(this.jetAnchor.p).sub(chest).normalize(), TT.pullAccel * dt); }
  }
  /** Let go of the jet web without a scene: the release sound (silent = none), no blast, no banner, no cooldown, no break-away. */
  _releaseTether(silent = false) {
    if (!this.tether && !this.app.locomotion.holds(this.jetAnchor)) return;
    this.app.locomotion.detachAnchor(this.jetAnchor, true);
    if (!silent) audio.play('release', 0, this.jetAnchor.p);
    this.jetAnchor.valid = false; this.tether = null;
  }
  _endTether() { this.app.locomotion.detachAnchor(this.jetAnchor); this.jetAnchor.valid = false; this.tether = null; }

  // ---------------------------------------------------------------- v0.46 revision 4: the fly-in hit and body contact
  /** A web at a staggered boss inside close range: Mobius flies at him (scripted rig) — Lunge decides speed / contact / timeout. */
  _startLunge(e, loco, chest) {
    const app = this.app, hub = app.hub, h = e.hand;
    this._releaseTether(true); // a held jet web is released when the lunge starts
    loco.detach(true); loco.cling = null; loco.wallRun = null; loco.zip = null; loco.grounded = false; loco.scripted = true; this._lunging = true;
    _d.copy(this.bossPos).sub(chest); const L = _d.length(); if (L > 1e-6) _d.divideScalar(L);
    this.lunge.start(this.clock, { v0: loco.vel.dot(_d), comfort: !!settings.comfortMode, away: WORLD_CHASE.staggerSpeed });
    this._lungeBeam = app.fx.web(e.origin, this.bossPos, { hold: true, follow: (out) => { if (hub.aim[h]?.valid) hub.aimOriginNow(h, out); } });
    audio.play('attach', 0, e.origin); hub.haptic?.(h, 0.4, 50);
    this.fightStats.lunges++; this.lastLunge = { t: +this.clock.toFixed(2), from: +L.toFixed(2), done: null };
  }
  /** Per chase frame while lunging: move the rig toward his body point (swept: never inside the contact distance). */
  _updateLunge(dt, loco, chest, feet) {
    const r = this.lunge.update(dt, { gap: _d.copy(this.bossPos).sub(chest).length() });
    const L = _d.length(); if (L > 1e-6) _d.divideScalar(L);
    if (!r.done && settings.impactTime !== false && this.app.timeWarp?.approach(L, { comfort: !!settings.comfortMode })) audio.play('slowmoIn'); // v0.49: the last metres in slow motion
    if (r.step > 0) {
      _v.copy(_d).multiplyScalar(r.step);
      if (this.world.pointBlocked(chest.x + _v.x, chest.y + _v.y, chest.z + _v.z, 0.35)) { this._endLunge('blocked'); return; } // scenery in the way: give up (no hit)
      loco.rig.position.add(_v); loco.rig.updateMatrixWorld(true); chest.add(_v); feet.add(_v);
    }
    loco.vel.copy(_d).multiplyScalar(r.speed);
    if (this._lungeBeam) this._lungeBeam.to.copy(this.bossPos);
    if (r.done === 'contact') { this._endLunge('contact'); this._contact(chest, true); this.app.timeWarp?.cancelApproach(); } // (cancelApproach: only when the contact was no punch — a punch or the finisher has taken the warp over)
    else if (r.done === 'timeout') this._endLunge('timeout'); // no hit, no rebound, no hint: the swing goes on with the fly-in's speed
  }
  /** The fly-in is over (contact / timeout / blocked / pause / respawn / finisher / resolve / run stop): locomotion is free again. */
  _endLunge(why) {
    const was = this._lunging; this.lunge.reset(); this._lunging = false;
    if (this._lungeBeam) { this.app.fx.releaseBeam(this._lungeBeam); this._lungeBeam = null; }
    if (!was) return false;
    this.app.locomotion.scripted = false; this._relOk = false;
    if (why !== 'contact') this.app.timeWarp?.cancelApproach(); // v0.49: no hit → time returns to full speed
    if (this.lastLunge) this.lastLunge.done = why;
    return true;
  }
  /** R4.3: any chase frame outside a lunge — the chest within CLOSE.lunge.contact of his body point (swept, relative to him). */
  _checkContact(chest) {
    if (!this.closeOn || this.state !== 'chase' || this._lunging || this._respawning || !this.app.boss.root.visible) { this._relOk = false; return; }
    const C = CLOSE.lunge, rel = _w.copy(chest).sub(this.bossPos);
    let hit = rel.length() <= C.contact;
    if (!hit && this._relOk && this._prevRel.distanceToSquared(rel) < 36) hit = segPointDist(this._prevRel, rel, _O) <= C.contact; // (≥ 6 m in one frame = a teleport, not a pass)
    this._prevRel.copy(rel); this._relOk = true;
    if (hit && this.clock - this._contactT >= C.cooldown) this._contact(chest, false);
  }
  /**
   * A contact (the fly-in's end or a body contact): any jet web detached; pushed back (relative speed toward him dropped,
   * CLOSE.lunge.rebound away + reboundUp up; locomotion stays free); then the hit. Staggered → the punch (Head Hit via the
   * reaction rules, punch sound, FEEL.warp.punch, Flow gain, "Direct hit!"); shield up → the punch on the shield
   * (protected.punch, shield-point burst, webHit sound, "Shield!").
   */
  _contact(chest, lunge) {
    const app = this.app, loco = app.locomotion, hub = app.hub, stag = this.fight.state === 'staggered';
    this._contactT = this.clock; this._relOk = false; this.fightStats.contacts++; if (lunge) this.fightStats.lungeHits++;
    this._releaseTether(true);
    _bv3.copy(this.bossPos).sub(this.bossPrev).divideScalar(this._dt); // his velocity (last frame)
    _w.copy(chest).sub(this.bossPos); const L = _w.length(); if (L > 1e-6) _w.divideScalar(L); else _w.copy(loco.vel).negate().normalize();
    const rb = rebound(_hp.copy(loco.vel).sub(_bv3), _w, CLOSE.lunge, this._rb);
    loco.vel.set(rb.x, rb.y, rb.z).add(_bv3); loco.grounded = false;
    const hl = Math.hypot(_w.x, _w.z), away = hl > 1e-6 ? (rb.x * _w.x + rb.z * _w.z) / hl : 0; // (the new horizontal relative speed away from him; _w is reused below)
    const at = stag ? this.bossPos.clone() : this._shieldPoint(chest, _hf).clone(), popAt = _hf.copy(at).add(_v.set(0, 1.2, 0)).clone();
    const r = this._fightHit('punch', 'body', at, null);
    for (const h of HANDS) hub.haptic?.(h, stag ? 0.9 : 0.5, stag ? 120 : 60);
    if (!r) return null;
    if (r.kind === 'weak' || r.kind === 'weakCore' || r.kind === 'capped') {
      audio.play('punch', 0, at); this._pop('close.hit', popAt, COLORS.perfect, 0.3);
      if (settings.impactTime !== false) app.timeWarp?.impact('punch', { comfort: !!settings.comfortMode }); // (v0.49: ends the fly-in's slow approach with the near-freeze)
      this._flowGain('punch');
    } else if (!r.limited) { // (a punch inside FIGHT.punchInterval: only the push back — no "Shield!" on a staggered boss)
      audio.play('webHit', 0, at);
      if (r.kind !== 'break') this._pop('close.blocked', popAt, '#b6ff6a', 0.3);
    }
    this.lastContact = { t: +this.clock.toFixed(2), lunge, kind: r.kind, hp: r.hp, st: r.st, vel: +loco.vel.length().toFixed(2), away: +away.toFixed(2) };
    return r;
  }
  _hint(key, text) { const now = performance.now() / 1000; this._hints = this._hints || {}; if ((this._hints[key] || 0) > now) return; this._hints[key] = now + 6; this.app.hud.showBanner(text, 2.2, COLORS.warn); }

  // ---------------------------------------------------------------- recovery
  /** Falls / lethal floor / far outside: a short fade to the latest built checkpoint; Green Maniac re-synced. */
  respawn(why) {
    const app = this.app, w = this.world, loco = app.locomotion, story = app.story;
    if (!w || this._respawning || !this.run.running || this.finisher.active) return true; // (v0.41: never after the run is resolved; v0.45: nor during the finisher)
    this._respawning = true;
    const cp = w.checkpointBefore(this.maxS) || this.cp;
    this.bombs.clear(); this._endTether(); this._endLunge('respawn'); this.stats.respawns++; this.held.length = 0; // (v0.42: a telegraph in progress is cancelled by the fight's abort)
    if (why) app.hud.showBanner(t(why), 2.4, COLORS.warn);
    story.fadeTo(1, 6, () => {
      this._respawning = false;
      if (!this.run.running || this.finisher.active) { story.fadeTo(0, 3); return; } // resolved (or the finisher started, v0.45) during the fade: stay where we are
      loco.detach(true); loco.setCityMode([]);
      if (cp) {
        loco.placeAt(new THREE.Vector3(...cp.pos), cp.yaw);
        if (cp.kind === 'roof') { const col = w.colliderOf(cp.sid); if (col) loco._landRoof(col); } else loco.grounded = false;
        this.playerS = cp.s; this.maxS = Math.max(this.maxS, cp.s);
      }
      this.bossS = Math.max(this.playerS + 26, Math.min(this.bossS, this.playerS + 44)); // hidden by the fade
      const bp = w.pointAt(this.bossS); app.boss.root.position.set(bp.x, bp.y + 5.5, bp.z); this._bv = 0;
      story.fadeTo(0, 3);
      app.hud.showBanner(t('story.checkpoint'), 1.8, COLORS.text);
    });
    return true;
  }

  // ---------------------------------------------------------------- visuals
  _updateVisuals(dt, tNow, feet) {
    const app = this.app, bp = app.boss.root.position, cam = app.camera.getWorldPosition(_d);
    const far = bp.distanceTo(feet);
    this.bossMarker.visible = far > 22; // only when he is far: restrained
    this.bossMarker.position.set(bp.x, bp.y + 4.5 + Math.sin(tNow * 4) * 0.3, bp.z); this.bossMarker.rotation.y += dt * 2;
    this.bossMarker.scale.setScalar(Math.max(1, far / 25));
    const chest = _v.copy(feet).add(_w.set(0, CHEST, 0));
    // v0.46 revision 4: rings only while his shield is broken (staggered) and close combat is on — blue beyond close range
    // (web + pull), red inside it (the fly-in hit); never both; a hint when one appears (6 s repeat guard)
    const stag = this.state === 'chase' && this.closeOn && this.fight.state === 'staggered' && app.boss.root.visible && !this._respawning; // (fix round 1: no rings during the respawn fade)
    const inClose = stag && this.closeRange.state === 'close', p = this.jetAnchor.p;
    const ok = stag && !inClose && this.tetherCheck(chest).ok;
    const red = inClose && (this._lunging || !this.world.segmentBlocked(chest.x, chest.y, chest.z, p.x, p.y, p.z));
    if (ok && !this._ringOn.blue) this._hint('closePull', t('close.pull'));
    if (red && !this._ringOn.red) this._hint('closeRed', t('close.hint'));
    if (faceOnRing(this._faceStag, this.fight.state === 'staggered', red)) app.boss.maniac.setState('taunt'); // v0.49: the red ring is on → he turns to face the player (the stagger's hurt pose has his back to them); the recover event picks the pose after it
    this._ringOn.blue = ok; this._ringOn.red = red;
    this.targetRing.visible = ok;
    if (ok) { const p = this.jetAnchor.p; this.targetRing.position.copy(p); this.targetRing.lookAt(cam); this.targetRing.scale.setScalar(0.9 * Math.max(1, p.distanceTo(cam) / 20) * (1 + 0.06 * Math.sin(tNow * 6))); }
    // v0.46 red target ring: on his body while close range is open (billboard, pulsing opacity)
    const ring = this.closeRing, on = red; ring.visible = on;
    if (on) { const R = CLOSE.ring; ring.position.copy(this.bossPos).add(bp).sub(this._bossRootAt); ring.lookAt(cam); /* (his body centre + how far he flew since it was measured) */ ring.material.opacity = R.opacity[0] + (R.opacity[1] - R.opacity[0]) * (0.5 + 0.5 * Math.sin(tNow * 2 * Math.PI * R.pulseHz)); }
  }
  // ---------------------------------------------------------------- v0.46 close range: his pose
  /** The loop he rests in now: taunting inside close range, else riding (turning forward first if he still faces back). */
  _restPose() { const m = this.app.boss.maniac; return !this.closeOn ? 'ride' : this.closeRange.state === 'close' ? 'taunt' : m.facingBack ? 'faceFront' : 'ride'; }
  /**
   * Per running chase frame: close range open → he taunts as soon as he is free (riding: no throw / turn / windup / tether /
   * stagger running); closed → a taunt turns forward again. A stagger keeps its own pose (the recover event picks the pose).
   */
  _closePose() {
    if (this.state !== 'chase') return;
    const m = this.app.boss.maniac;
    if (this._poseAfterHit && m.state !== 'hit') { this._poseAfterHit = false; if (this.fight.state !== 'staggered') m.setState(this._restPose()); } // (the stagger ended during a hit reaction)
    if (this.fight.state === 'staggered') return;
    const s = m.state;
    if (this.closeRange.state === 'close') { if (s === 'ride' && this.fight.state !== 'telegraph' && !this.tether) m.setState('taunt'); }
    else if (m.facingBack && (s === 'taunt' || s === 'faceBack') && !(this.fight.state === 'telegraph' && this._tele?.back)) m.setState('faceFront'); // (a throw aimed back at the player keeps him facing them until it is released)
  }
  /** Close range over (finisher, run resolved): no ring, and he turns forward if he was taunting (he hovers facing Mobius). */
  _closeEnd() { this.closeRange.reset(); this.closeRing.visible = false; const m = this.app.boss.maniac; if (m.facingBack) m.setState('faceFront'); }
  /** Minimap: route dots ahead. */
  markers() {
    if (!this.world) return [];
    const out = [];
    for (let s = Math.floor(this.playerS / 16) * 16; s < this.playerS + 220; s += 16) out.push({ kind: 'route', pos: this.world.pointAt(s).setY(0) });
    return out;
  }
  mapBoxes(head, R) {
    const out = []; if (!this.world) return out;
    for (const c of this.world.collidersNear(head.x, head.z, R)) if (c.base && c.role !== 'overhead') out.push({ x: c.x, z: c.z, w: c.hw * 2, d: c.hd * 2, yaw: c.yaw, id: c.id, upper: false, highlight: false });
    return out;
  }

  // ---------------------------------------------------------------- dev bench (tests / perf): fly the route at a fixed speed
  /** Moves the rig along the route at `speed` m/s for `seconds` (streaming, recycling, boss, coins all run). */
  startBench(seconds = 60, speed = 18) {
    const app = this.app; app.locomotion.detach(true);
    this.bench = { t: 0, seconds, speed, s: this.playerS, frames: 0, worst: 0, buildMax: 0, createMax: 0, sumDt: 0, slow: 0, mods: 0, maxMods: 0 };
  }
  _benchStep(dt) {
    const B = this.bench, w = this.world, loco = this.app.locomotion; B.t += dt; B.frames++; B.sumDt += dt; B.worst = Math.max(B.worst, dt); if (dt > 1 / 50) B.slow++;
    B.s += B.speed * dt; const p = w.pointAt(B.s), a = w.headingAt(B.s);
    loco.placeAt(p.setY(p.y - 1.4), -a); loco.grounded = false; loco.vel.set(Math.sin(a) * B.speed, 0, -Math.cos(a) * B.speed);
    B.buildMax = Math.max(B.buildMax, this.renderer.stats.buildMs); B.createMax = Math.max(B.createMax, w.stats.createMs); B.maxMods = Math.max(B.maxMods, w.live.size);
    if (B.t >= B.seconds) { B.done = true; B.result = { seconds: +B.t.toFixed(1), distance: Math.round(B.s - (this.startS || 0)), frames: B.frames, avgMs: +((B.sumDt / B.frames) * 1000).toFixed(1), worstMs: +(B.worst * 1000).toFixed(1), slowFrames: B.slow, maxBuildMs: +B.buildMax.toFixed(2), maxCreateMs: +B.createMax.toFixed(2), maxModules: B.maxMods, rebases: w.stats.rebases, created: w.stats.created, recycled: w.stats.recycled, coins: this.app.coins.count }; this.lastBench = B.result; this.bench = null; }
  }

  // ---------------------------------------------------------------- world events
  onCellReady(cell) { if (this.state) this.app.coins.addCell(cell); }
  onCellRemoved(cell) { this.app.coins?.removeCell?.(cell); }
  _onRebase(dx, dz) {
    const app = this.app;
    app.locomotion.shift(dx, dz);
    app.boss.root.position.x += dx; app.boss.root.position.z += dz;
    if (!app.boss.riding) { const m = app.boss.maniac.root; m.position.x += dx; m.position.z += dz; }
    app.coins?.shift(dx, dz); app.fx.shift?.(dx, dz); app.shield?.shift(dx, dz); this.bombs.shift?.(dx, dz); this.lightBombs.shift(dx, dz); this.bossPos.x += dx; this.bossPos.z += dz; this.bossPrev.x += dx; this.bossPrev.z += dz; this._bossRootAt.x += dx; this._bossRootAt.z += dz;
    if (this.startFeet) { this.startFeet.x += dx; this.startFeet.z += dz; }
    for (const v of [this.bossHold, this._finYank?.from, this._finYank?.to]) if (v) { v.x += dx; v.z += dz; } // v0.45 finisher hover / yank path
  }
}
export { settings };
