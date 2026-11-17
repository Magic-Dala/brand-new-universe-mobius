// Story chase (追逐): home window → 5 straight blocks north → right turn → 1 block east → factory roof.
// Explicit sub-state machine (player-progress driven, not timers):
//   bossFlyby → chaseStraight → chaseRightTurn → approachPlatform → roofStandoff → roofDash → (kick → roofEvent)
// Overlays during the chase (never change the route or the destination):
//   · pumpkin bombs thrown back at the player (chaseBombs.js) — shoot them or swing away;
//   · jet tether: a web on the Green Bat Jet (moving hook) sticks briefly, then Green Maniac blows it off
//     (flow states JetTether → TetherCounter), with a re-tether cooldown.
// Finale (v0.21): Green Maniac hovers over the roof circle; a web hit on HIM starts a one-shot web dash;
// a real (swept) contact kicks him off the jet → roofEvent. Standing in the circle alone does nothing.
// Progress is measured ALONG the story route centre line (STORY_ROUTE), never by straight-line distance.
// v0.47 (settings.storyCombat, default on): in the throw states, outside the room, the Story combat loop (storyCombat.js)
// takes the webs first, throws the tiered attacks instead of chaseBombs' scheduler, and Green Maniac's pacing gets the 14 m
// floor, the stall speed cap and the 1.5 m last resort. The jet tether + counter do not run. Switch off = everything below
// exactly as v0.46. The roof finale (standoff, dash, kick) is the same either way.
import * as THREE from 'three';
import { t } from '../core/i18n.js';
import { audio } from '../core/audio.js';
import { COLORS } from '../ui/panel.js';
import { STORY_ROUTE as ROUTE, CHECKPOINTS, CHASE_FLYBY, STORY, KEY_BUILDINGS, roomToWorld, FACTORY_TILE } from '../data/layout.js';
import { inFootprint } from '../data/box.js';
import { loadSong } from '../core/songs.js';
import { ChaseBombs } from './chaseBombs.js';
import { pickTarget, angularZoneSize } from './aim.js';
import { STORY_COMBAT } from '../data/storyCombat.js';
import { GREEN_MANIAC_THROW_RELEASE } from '../art/enemies.js';
import { settings } from '../core/settings.js';
import { CLOSE } from '../data/closeCombat.js';
import { segmentTier, throwWindow, holdS } from './storyAttacks.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3(), _rc = new THREE.Vector3();
const CHEST = 1.3;
const TT = STORY_COMBAT.tether, RF = STORY_COMBAT.roof, BB = STORY_COMBAT.bombs;
const A = KEY_BUILDINGS[0], C = KEY_BUILDINGS[1];
const LEAD = 30; // desired boss lead along the route (m)
const CP_TURN = CHECKPOINTS.at(-1); // the last checkpoint is on the turn module
export const CHASE_STATES = ['bossFlyby', 'chaseStraight', 'chaseRightTurn', 'approachPlatform', 'roofStandoff', 'roofDash'];
const THROW_STATES = ['chaseStraight', 'chaseRightTurn', 'approachPlatform'];
/** Closest-approach parameter of segment a→b to point c (0..1) — swept contact test (pure). */
export function segPointT(a, b, c) { const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L2 = dx * dx + dy * dy + dz * dz; if (L2 < 1e-12) return 0; return Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy + (c.z - a.z) * dz) / L2)); }
export function segPointDist(a, b, c) { const k = segPointT(a, b, c); return Math.hypot(a.x + (b.x - a.x) * k - c.x, a.y + (b.y - a.y) * k - c.y, a.z + (b.z - a.z) * k - c.z); }

/** Route helpers (pure – unit tested). */
export function routePoint(s, out = new THREE.Vector3()) {
  const S = Math.max(0, Math.min(ROUTE.length, s));
  for (const g of ROUTE.seg) {
    if (S <= g.s0 + g.len || g === ROUTE.seg[ROUTE.seg.length - 1]) {
      const k = g.len ? (S - g.s0) / g.len : 0;
      return out.set(g.a[0] + (g.b[0] - g.a[0]) * k, 0, g.a[1] + (g.b[1] - g.a[1]) * k);
    }
  }
  return out;
}
/** Project a world xz onto the route. `hint` (last progress) resolves the turn corner ambiguity. */
export function routeProgress(x, z, hint = 0) {
  let best = null;
  for (const g of ROUTE.seg) {
    const [ax, az] = g.a, [bx, bz] = g.b;
    const dx = bx - ax, dz = bz - az;
    const k = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (g.len * g.len || 1)));
    const px = ax + dx * k, pz = az + dz * k;
    const dist = Math.hypot(x - px, z - pz);
    const s = g.s0 + k * g.len;
    const score = dist + 0.35 * Math.max(0, Math.abs(s - hint) - 25);
    if (!best || score < best.score) best = { s, dist, score };
  }
  return best;
}
/** Green Maniac / swing height along the route (descends toward the low factory roof). */
export function routeHeight(s) {
  const S = Math.max(0, Math.min(ROUTE.length, s));
  for (const g of ROUTE.seg) if (S <= g.s0 + g.len || g === ROUTE.seg.at(-1)) return g.ya + (g.yb - g.ya) * (g.len ? (S - g.s0) / g.len : 0);
  return ROUTE.endHeight;
}
/** Route tile index at arc length s. */
export function routeTileAt(s) { let k = 0; for (let i = 0; i < ROUTE.tileStart.length; i++) if (s >= ROUTE.tileStart[i]) k = i; return k; }

export class Chase {
  constructor(story) {
    this.story = story; this.app = story.app;
    this.state = null;
    this.root = new THREE.Group(); this.root.name = 'chase'; this.app.scene.add(this.root);
    this.flybyCurve = new THREE.CatmullRomCurve3(CHASE_FLYBY.map((p) => new THREE.Vector3(...p)));
    this._buildCircle(); this._buildTurnArrow(); this._buildBossMarker(); this._buildTargetRing();
    this.bombs = new ChaseBombs(this.app);
    // the Green Bat Jet's moving web hook (NOT a building anchor: never in the city world / recycling)
    this.jetAnchor = { id: 'JET-HOOK', p: new THREE.Vector3(), valid: false, moving: true, building: null, cell: null, kind: 'jet' };
    this._runs = 0;
    this.reset();
  }
  reset() {
    this.state = null; this.flybyDone = false; this.playerS = 0; this.maxS = 0; this.bossS = 0; this.nearTurn = false;
    this.cp = CHECKPOINTS[0]; this.stateTime = 0; this._hint = {}; this._waved = false;
    this.circle.visible = false; this.arrow.visible = false; this.bossMarker.visible = false; this.targetRing.visible = false;
    this.app.cityWorld?.pin('boss', null);
    this.clock = 0; // chase-local time (frozen while paused) for cooldowns
    this._endTether(false); this._endDash(null);
    this.tetherReadyAt = 0; this.dashReadyAt = 0; this.breakAwayUntil = 0;
    this._cap = null; this._ps = 0; this._prevS = null; // v0.47: the combat's speed cap, the player's route speed
    this.bombs?.reset(0x5eed + (this._runs = (this._runs || 0) + 1));
    this._bombHint = false;
    this.cstats = { tethers: 0, counters: 0, dashes: 0, dashAborts: 0, kicks: 0, tetherRefused: 0 };
  }
  get active() { return !!this.state; }
  // --------------------------------------------------------------- v0.47 Story combat (settings.storyCombat)
  get combat() { return this.story.combat; }
  get combatOn() { return settings.storyCombat !== false; }
  /** The combat loop is running for THIS chase (not the chase after the factory). */
  get _fighting() { const C = this.story.combat; return !!C && C.active && C.host === this._hostObj; }
  /** What the Story combat needs from this chase: positions along the route, the world, the tier, the throw rules, a speed cap. */
  _host() {
    if (this._hostObj) return this._hostObj;
    const self = this, eff = () => Math.min(self.playerS, self.maxS + 10);
    return (this._hostObj = {
      kind: 'chase', jetDamage: 0,
      get world() { return self.app.cityWorld; },
      bossS: () => self.bossS, playerS: eff, gap: () => self.bossS - eff(),
      segmentTier: () => segmentTier({ tile: routeTileAt(Math.min(self.maxS, ROUTE.length - 1)), afterTurn: self.maxS >= ROUTE.sTurn }),
      throwsAllowed: () => throwWindow({ playerS: self.maxS, bossS: self.bossS, sTurn: ROUTE.sTurn, length: ROUTE.length }),
      active: () => THROW_STATES.includes(self.state) && self.flybyDone && !self.story.inRoom && !self.dash,
      capBossSpeed: (v) => { self._cap = v; },
    });
  }

  // --------------------------------------------------------------- lifecycle
  begin() {
    const app = this.app;
    this.reset();
    // v6: he was rampaging over the street outside the window → the fly-by starts exactly where he is (no jump);
    // via the usual first point when the direct leg to the window would cut through a building
    const fly = CHASE_FLYBY.map((p) => new THREE.Vector3(...p));
    if (app.boss.root.visible && app.boss.root.position.distanceTo(fly[0]) < 90) {
      const b0 = app.boss.root.position.clone(), w = app.cityWorld;
      const direct = !w?.segmentBlocked(b0.x, b0.y, b0.z, fly[1].x, fly[1].y, fly[1].z, null, null, 0);
      if (direct || b0.distanceTo(fly[0]) < 4) fly[0] = b0; else fly.unshift(b0);
    }
    this.flybyCurve = new THREE.CatmullRomCurve3(fly);
    this._facingBack = false; this._bSaid = false;
    app.boss.remount(); app.boss.setVisible(true); app.boss.jet.setDamage(0); app.boss.jet.setThrust(1);
    this.setState('bossFlyby');
    this.app.coins?.start(); // v0.23: coins along the route (fresh for this run)
    if (this.combatOn) this.combat.begin(this._host(), { tier: 1 }); // v0.47
    audio.play('jetFlyby');
    this.hum = audio.startJetHum?.();
    app.hud.showBanner(t('story.obj.chase'), 2.6, COLORS.bad, t('char.boss'));
    this.story.objective(t('story.obj.chase'), [t('story.hint.leave'), t('tut.swing')]);
  }
  stop() {
    this.hum?.stop(); this.hum = null;
    this.circle.visible = false; this.arrow.visible = false; this.bossMarker.visible = false; this.targetRing.visible = false;
    this.state = null;
    this.app.cityWorld?.pin('boss', null);
    this.bombs.clear(); this._endTether(false); this._endDash(null); // no leftover timers / webs / bombs
    if (this._fighting) this.combat.stop(); // v0.47
    this.app.shield?.reset(); // v0.44: shield down, energy full for the next run
  }
  /** Story restart of the roof finale: back to the standoff (Green Maniac on the jet over the circle). */
  resumeAtRoof() {
    const app = this.app;
    if (this._fighting) this.combat.stop(); // v0.47: the roof finale has no combat loop
    this.reset(); this.flybyDone = true; this.nearTurn = true; this.maxS = ROUTE.length; this.playerS = ROUTE.length; this.cp = CP_TURN;
    this.bossS = ROUTE.length + 4;
    app.boss.remount(); app.boss.setVisible(true); app.boss.jet.setDamage(0); app.boss.jet.setThrust(1);
    app.boss.root.position.copy(this.hoverPoint(0));
    this.hum = this.hum || audio.startJetHum?.();
    this._toStandoff();
  }
  setState(s) { this.state = s; this.stateTime = 0; this.app.locomotion.chaseState = s; }

  // --------------------------------------------------------------- per frame
  /** dt = the Story's (impact-time scaled) step; realDt = the unscaled one (v0.47; equal when no warp runs). */
  update(dt, tNow, realDt = dt) {
    if (!this.state) return;
    this.stateTime += dt; this.clock += dt;
    // v0.47: the dev switch flipped during the chase → the combat loop starts / stops on this frame
    if (this.combatOn && !this._fighting && !['roofStandoff', 'roofDash'].includes(this.state)) { this.bombs.clear(); this._endTether(false); this.combat.begin(this._host(), { tier: 1 }); }
    else if (!this.combatOn && this._fighting) { this.combat.stop(); this._cap = null; }
    const fighting = this._fighting;
    const app = this.app, loco = app.locomotion, hub = app.hub;
    const feet = loco.feet(new THREE.Vector3());
    const story = this.story;

    // leaving the room through the window
    if (story.inRoom && feet.z < A.z - A.d / 2 - 0.6) {
      story.inRoom = false; loco.ignoreColliders = new Set();
      // v0.29 B: Green Maniac reacts to the jump (cuts off an A taunt); once per chase attempt, only if he is in view
      if (!this._bSaid && app.boss.root.visible) { this._bSaid = true; app.voice?.say('B', app.boss.maniac.root, { interrupt: true }); }
    }

    // route progress (continuity-hinted projection); only continuous progress counts
    const pr = routeProgress(feet.x, feet.z, this.playerS);
    if (this._prevS != null && dt > 0) { const ds = pr.s - this._prevS; if (Math.abs(ds) < 8) this._ps += (Math.max(0, Math.min(40, ds / dt)) - this._ps) * Math.min(1, dt * 4); } // v0.47: the player's speed along the route (smoothed)
    this._prevS = pr.s;
    this.playerS = pr.s; this.lateral = pr.dist;
    if (pr.dist < 48 && pr.s > this.maxS && pr.s - this.maxS < 40) this.maxS = pr.s;
    if (Math.hypot(feet.x - ROUTE.turn[0], feet.z - ROUTE.turn[1]) < 34 && this.maxS >= ROUTE.sTurn - 34) this.nearTurn = true;
    const next = CHECKPOINTS[CHECKPOINTS.indexOf(this.cp) + 1];
    if (next && this.maxS >= next.s + 12 && (next !== CP_TURN || this.nearTurn)) this.cp = next;

    this._updateJetHook();
    this._handleWebs(hub, loco);
    this._updateBoss(dt, tNow, feet);
    this._updateTether(dt, loco);
    if (this.dash) { this._updateDash(dt, loco); if (!this.state) return; } // kicked → roofEvent took over
    if (fighting) this.combat.update(dt, realDt, tNow); // v0.47: tiered attacks, the stall loop, Light Bomb, Fan Web, Flow
    else this._updateBombs(dt, loco, feet);
    this._updateVisuals(dt, tNow, feet);

    const onC = this.onPlatformC(feet);
    const routeDone = this.routeComplete();
    if (onC && !routeDone && ['chaseStraight', 'chaseRightTurn'].includes(this.state)) this.hint('routeFirst', t('story.hint.routeFirst'));
    if (!onC && this.lateral > 40 && !story.inRoom && !loco.cling) this.hint('offRoute', t('story.hint.offRoute'));

    switch (this.state) {
      case 'bossFlyby':
        if (this.stateTime >= 5.0) { this.flybyDone = true; this.bossS = routeProgress(CHASE_FLYBY.at(-1)[0], CHASE_FLYBY.at(-1)[2], 0).s; this.setState('chaseStraight'); }
        break;
      case 'chaseStraight':
        if (this.maxS >= ROUTE.sTurn - 70 && !story.inRoom) {
          this.setState('chaseRightTurn');
          app.hud.showBanner(t('story.turnRight'), 2.4, COLORS.warn);
          this.story.objective(t('story.obj.turn'), [t('tut.swing')]);
          audio.play('alarm');
        }
        break;
      case 'chaseRightTurn':
        if (this.nearTurn && this.maxS >= ROUTE.sTurn + 15) { this.setState('approachPlatform'); this.story.objective(t('story.obj.land.factory'), [t('tut.swing')]); }
        break;
      case 'approachPlatform':
        if (this.bossS >= ROUTE.length - 1 && this.routeComplete() && this.app.boss.root.position.distanceTo(this.hoverPoint(tNow)) < RF.arriveDist) this._toStandoff();
        else if (this.bossS >= ROUTE.length - 1 && !this.routeComplete() && onC) this.hint('routeFirst', t('story.hint.routeFirst'));
        break;
      case 'roofStandoff': {
        // standing in the circle alone never starts anything: the trigger is a web hit on Green Maniac
        const c = STORY.circle;
        if (onC && Math.hypot(feet.x - c.pos[0], feet.z - c.pos[2]) < c.radius + 0.5) this.hint('aimBoss', t('story.roof.aimBoss'));
        break;
      }
      case 'roofDash': break; // _updateDash
      default: break;
    }
  }
  _toStandoff() {
    if (this._fighting) this.combat.cancel(); // v0.47: he reached the roof — a stall in progress is cancelled, pressure cleared; the v0.21 finale takes over
    this._cap = null;
    this.setState('roofStandoff');
    this.story.objective(t('story.obj.roofAim'), [t('tut.web')]);
    this.app.hud.showBanner(t('story.roof.standoff'), 2.6, COLORS.bad, t('char.boss'));
    loadSong('mobius-boss-01').catch(() => {}); // prefetch the boss song (audio decode only)
    this.bossS = ROUTE.length + 4;
  }
  /** Green Maniac's hover point: right above the blue circle (the expected landing spot). */
  hoverPoint(tNow, out = new THREE.Vector3()) {
    const P = STORY.circle.pos;
    return out.set(P[0], C.h + RF.hoverHeight + Math.sin(tNow * 1.3) * RF.bob, P[2]);
  }
  /** His body: the dash target / contact centre. */
  bossBody(out = new THREE.Vector3()) { return out.copy(this.app.boss.root.position).add(_w.set(0, RF.targetUp, 0)); }
  routeComplete() { return this.nearTurn && this.maxS >= ROUTE.sTurn + 15 && this.cp === CP_TURN; }
  onPlatformC(feet) {
    const loco = this.app.locomotion;
    return loco.grounded && !loco.attach && Math.abs(feet.y - C.h) < 0.3 && inFootprint(C, feet.x, feet.z);
  }
  hint(key, text) {
    const now = performance.now() / 1000;
    if ((this._hint[key] || 0) > now) return;
    this._hint[key] = now + 6;
    this.app.hud.showBanner(text, 2.2, COLORS.warn);
  }

  // --------------------------------------------------------------- input
  _handleWebs(hub, loco) {
    const app = this.app, story = this.story;
    for (const e of hub.events) {
      if (e.type !== 'web') continue;
      if (story.inRoom) {
        // from inside the room only anchors seen through the open window are reachable
        if (e.dir.z > -0.25) { app.fx.web(e.origin, _v.copy(e.origin).addScaledVector(e.dir, 3)); audio.play('fizzle'); continue; }
        const a = loco.tryAttach(e);
        if (a) { audio.play('web'); loco.zipTo(new THREE.Vector3(...roomToWorld([0, 0.2, -5.2])), 0.75); }
        else { app.fx.web(e.origin, _v.copy(e.origin).addScaledVector(e.dir, 20)); audio.play('web'); }
        continue;
      }
      if (this.dash) continue; // one dash at a time: no conflicting shots
      if (this.state === 'roofStandoff') { if (this._tryDash(e, loco)) continue; }
      else if (THROW_STATES.includes(this.state)) {
        if (this._fighting) { if (this.combat.onWeb(e, loco, loco.feet(new THREE.Vector3()).add(_w.set(0, CHEST, 0)))) continue; } // v0.47: pumpkin lock / web strike / (stalled) jet web or fly-in
        else {
          if (this.bombs.tryShoot(e)) continue; // a flying pumpkin bomb in the aim
          if (this._tryTether(e, loco)) continue; // the jet (moving hook) in the aim, close and visible
        }
      }
      if (!loco.tryAttach(e)) { app.fx.web(e.origin, _v.copy(e.origin).addScaledVector(e.dir, 25)); audio.play('web'); }
    }
  }

  // --------------------------------------------------------------- jet tether (+ counter)
  _updateJetHook() {
    const boss = this.app.boss;
    boss.jet.root.updateWorldMatrix(true, false);
    this.jetAnchor.p.set(...TT.hook); boss.jet.root.localToWorld(this.jetAnchor.p);
  }
  /** Can the jet hook be tethered from this chest position right now? → { ok, why, dist } */
  tetherCheck(chest) {
    if (!THROW_STATES.includes(this.state) || !this.flybyDone || this.story.inRoom) return { ok: false, why: 'state' };
    if (this.tether) return { ok: false, why: 'busy' };
    if (this.clock < this.tetherReadyAt) return { ok: false, why: 'cooldown' };
    const d = chest.distanceTo(this.jetAnchor.p);
    if (d > TT.maxDist || d < TT.minDist) return { ok: false, why: 'range', dist: d };
    const w = this.app.cityWorld, p = this.jetAnchor.p;
    if (w?.segmentBlocked(chest.x, chest.y, chest.z, p.x, p.y, p.z)) return { ok: false, why: 'occluded', dist: d };
    return { ok: true, dist: d };
  }
  _tryTether(e, loco) {
    const p = this.jetAnchor.p, d = e.origin.distanceTo(p), s = angularZoneSize(d, TT.assistDeg, 0, TT.minHalf);
    if (!pickTarget(e.origin, e.dir, [{ pos: p, w: s, h: s }], { margin: 0, maxDist: 90 })) return false; // not aimed at the jet (far aims still get the "too far" hint)
    const chest = loco.feet(_v).add(_w.set(0, CHEST, 0));
    const chk = this.tetherCheck(chest);
    if (!chk.ok) { if (chk.why === 'range' || chk.why === 'occluded') { this.cstats.tetherRefused++; this.hint('tetherFar', t(chk.why === 'range' ? 'story.tether.far' : 'story.tether.blocked')); } return false; } // → normal building web
    this.jetAnchor.valid = true;
    if (!loco.attachTo(this.jetAnchor, e)) { this.jetAnchor.valid = false; return false; }
    this.tether = { phase: 'stuck', t: 0, hand: e.hand, threw: false };
    this.cstats.tethers++;
    const app = this.app;
    app.boss.maniac.setState('turn'); // he notices the web on his jet → turns around (then throws, see _updateTether)
    audio.play('webHit'); app.fx.net(p.clone(), 0.5); for (const h of ['left', 'right']) app.hub.haptic?.(h, 0.45, 60);
    app.hud.showBanner(t('story.tether.hit'), 1.4, COLORS.perfect, t('char.jet'));
    return true;
  }
  _updateTether(dt, loco) {
    const T = this.tether; if (!T) return;
    T.t += dt;
    if (T.phase === 'stuck') {
      const held = loco.holds(this.jetAnchor);
      if (held && T.t < TT.pullTime) { // short pull: the player clearly feels the hit
        const chest = loco.feet(_v).add(_w.set(0, CHEST, 0));
        loco.vel.addScaledVector(_d.copy(this.jetAnchor.p).sub(chest).normalize(), TT.pullAccel * dt);
      }
      // throw timed so the bomb leaves his hand exactly when the web is cut (turn → throw → blast)
      if (held && !T.threw && T.t >= TT.counterDelay - GREEN_MANIAC_THROW_RELEASE) { T.threw = true; this.app.boss.throw(); }
      if (T.t >= TT.counterDelay || !held) this._counter(held);
    } else if (T.phase === 'counter' && T.t >= 0.45) this._endTether(true);
  }
  /** Green Maniac pulls a small bomb and blows the web off: one event even with two hands (single tether). */
  _counter(held) {
    const app = this.app, loco = app.locomotion, T = this.tether;
    T.phase = 'counter'; T.t = 0;
    this.cstats.counters++;
    if (held) {
      const chest = loco.feet(_v).add(_w.set(0, CHEST, 0));
      const cut = _d.copy(this.jetAnchor.p).lerp(chest, 0.18);
      if (!T.threw) { T.threw = true; app.boss.throw(); }
      app.fx.boom(cut, { color: 0xffa020, size: 0.55, life: 0.4 });
      audio.play('fizzle'); audio.play('boomEnemy');
      T.velBefore = loco.vel.clone();
      loco.detachAnchor(this.jetAnchor); // momentum kept as is (no release boost, no reverse push, no teleport); a web on a building in the other hand stays
      app.hud.showBanner(t('story.tether.cut'), 1.8, COLORS.warn, t('char.boss'));
    }
    this.jetAnchor.valid = false;
    this.tetherReadyAt = this.clock + TT.cooldown;
    this.breakAwayUntil = this.clock + TT.breakAway;
  }
  _endTether(normal) {
    const loco = this.app.locomotion;
    loco.detachAnchor(this.jetAnchor);
    this.jetAnchor.valid = false;
    this.tether = null; void normal;
  }

  // --------------------------------------------------------------- roof: web dash → kick
  dashCheck(chest) {
    if (this.state !== 'roofStandoff') return { ok: false, why: 'state' };
    if (this.clock < this.dashReadyAt) return { ok: false, why: 'cooldown' };
    const b = this.bossBody(_d), d = chest.distanceTo(b);
    if (d > RF.dashRange) return { ok: false, why: 'range', dist: d };
    if (this.app.cityWorld?.segmentBlocked(chest.x, chest.y, chest.z, b.x, b.y, b.z)) return { ok: false, why: 'occluded', dist: d };
    return { ok: true, dist: d };
  }
  _tryDash(e, loco) {
    const b = this.bossBody(new THREE.Vector3()), d = e.origin.distanceTo(b), s = angularZoneSize(d, RF.assistDeg, 0, RF.minHalf);
    if (!pickTarget(e.origin, e.dir, [{ pos: b, w: s, h: s }], { margin: 0, maxDist: 120 })) return false;
    const chest = loco.feet(_v).add(_w.set(0, CHEST, 0));
    const chk = this.dashCheck(chest);
    if (!chk.ok) { if (chk.why !== 'cooldown') this.hint('dashNo', t(chk.why === 'range' ? 'story.roof.far' : 'story.roof.blocked')); return chk.why === 'cooldown'; }
    // 1–3: validated → web to his body, old building webs cleared
    loco.detach(true); loco.cling = null; loco.grounded = false; loco.scripted = true;
    const app = this.app, hub = app.hub, h = e.hand;
    const beam = app.fx.web(e.origin, b, { hold: true, follow: (out) => { if (hub.aim[h]?.valid) hub.aimOriginNow(h, out); } });
    this.dash = { t: 0, speed: Math.min(6, loco.vel.length()), beam, hand: h };
    this.bombs.clear();
    this.setState('roofDash');
    this.cstats.dashes++;
    audio.play('webHit'); audio.play('attach');
    for (const hh of ['left', 'right']) hub.haptic?.(hh, 0.4, 60);
    return true;
  }
  /** 4–7: fast but smooth approach, swept contact (no tunnelling), environment checks, timeout → safe abort. */
  _updateDash(dt, loco) {
    const D = this.dash; D.t += dt;
    const app = this.app, rig = app.world.player, w = app.cityWorld;
    const target = this.bossBody(new THREE.Vector3());
    D.beam.to.copy(target);
    if (!app.boss.root.visible) return this._abortDash('lost');
    if (D.t > RF.dashTimeout) return this._abortDash('timeout');
    D.speed = Math.min(RF.dashSpeed, D.speed + RF.dashAccel * dt);
    const chest = loco.feet(new THREE.Vector3()).add(_w.set(0, CHEST, 0));
    const dir = target.clone().sub(chest); const dist = dir.length(); dir.divideScalar(dist || 1);
    const stepLen = Math.min(dist, D.speed * dt);
    const n = Math.max(1, Math.ceil(stepLen / 0.3)), step = dir.clone().multiplyScalar(stepLen / n);
    const a = chest.clone(), b = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      b.copy(a).add(step);
      if (segPointDist(a, b, target) <= RF.contactRadius) { // swept: the chest passed within reach this sub-step
        rig.position.add(_v.copy(b).sub(chest)); rig.updateMatrixWorld(true);
        loco.vel.copy(dir).multiplyScalar(D.speed);
        return this._kick(target, dir.clone().multiplyScalar(D.speed));
      }
      const fy = b.y - CHEST;
      if (w?.pointBlocked(b.x, b.y, b.z, 0.35) || w?.pointBlocked(b.x, fy + 0.5, b.z, 0.2) || (fy < 0.2)) { rig.position.add(_v.copy(a).sub(chest)); rig.updateMatrixWorld(true); return this._abortDash('blocked'); }
      a.copy(b);
    }
    rig.position.add(_v.copy(a).sub(chest)); rig.updateMatrixWorld(true);
    loco.vel.copy(dir).multiplyScalar(D.speed); // (vignette)
    if (segPointDist(chest, a, target) <= RF.contactRadius) return this._kick(target, loco.vel.clone());
  }
  _abortDash(why) {
    const app = this.app, loco = app.locomotion, v = loco.vel.clone();
    this._endDash(null);
    loco.setCityMode(loco.surfaces); loco.grounded = false;
    loco.vel.copy(v.lengthSq() > 25 ? v.setLength(5) : v); // safe: gentle carry-over, swing / fall normally again
    this.cstats.dashAborts++;
    this.dashReadyAt = this.clock + RF.retryCooldown;
    this.setState('roofStandoff');
    app.hud.showBanner(t(why === 'blocked' ? 'story.roof.blocked' : 'story.roof.dashFail'), 2.0, COLORS.warn);
    this.lastAbort = why;
  }
  _endDash(kickPoint) {
    const D = this.dash; if (!D) return;
    this.app.fx.releaseBeam(D.beam);
    if (!kickPoint) this.app.locomotion.scripted = false;
    this.dash = null;
  }
  /** Contact: kick Green Maniac off the jet — ONCE → the roof event (kick-off, landing, giant bomb, blast). */
  _kick(point, vel) {
    const app = this.app;
    this._endDash(point); // the rig stays scripted: the roof event lands the player
    this.cstats.kicks++;
    app.fx.boom(point, { color: 0xbff4ff, size: 1.2, life: 0.5 });
    audio.play('punch'); audio.play('boomEnemy');
    for (const h of ['left', 'right']) app.hub.haptic?.(h, 0.9, 140);
    this.kickInfo = { point: point.clone(), vel: vel.clone() };
    this.targetRing.visible = false; this.circle.visible = false; this.arrow.visible = false;
    this.stop();
    this.story.onChaseComplete(this.kickInfo);
  }

  // --------------------------------------------------------------- bombs
  _updateBombs(dt, loco, feet) {
    const story = this.story;
    const allow = THROW_STATES.includes(this.state) && this.flybyDone && !story.inRoom && !this.tether && story.fade.a < 0.01
      && Math.abs(this.maxS - ROUTE.sTurn) > BB.pauseNearTurn && this.bossS < ROUTE.length - 25;
    this.bombs.update(dt, { allow, boss: this.app.boss, chest: _v.copy(feet).add(_w.set(0, CHEST, 0)), playerVel: loco.vel });
    if (this.bombs.stats.thrown === 1 && !this._bombHint) { this._bombHint = true; this.app.hud.showBanner(t('story.hint.bombs'), 2.6, COLORS.warn); }
  }

  // --------------------------------------------------------------- boss
  /** Furthest route arc length Green Maniac may fly to: the end of the last BUILT story module (− margin). */
  bossLimit() {
    const w = this.app.cityWorld; if (!w) return ROUTE.length + 4;
    let lim = this.bossS; // tiles behind Green Maniac may already be recycled: scan from his own tile forward
    for (let k = routeTileAt(Math.min(this.bossS, ROUTE.length - 1)); k <= FACTORY_TILE; k++) { const c = w.tileCell(k); if (!c || !c.ready) break; lim = k === FACTORY_TILE ? ROUTE.length + 4 : (ROUTE.tileStart[k + 1] ?? ROUTE.length) - 10; }
    return lim;
  }
  _updateBoss(dt, tNow, feet) {
    const boss = this.app.boss;
    if (this.state === 'bossFlyby') {
      const k = Math.min(1, this.stateTime / 5.0), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const p = this.flybyCurve.getPointAt(e), ahead = this.flybyCurve.getPointAt(Math.min(1, e + 0.04));
      boss.root.position.copy(p); boss.face(ahead, this.stateTime < 0.9 ? 1 - Math.exp(-dt * 6) : 1); boss.bank(Math.sin(e * Math.PI) * -0.4); boss.update(dt, tNow); // (eases out of the window-facing hover)
      this.hum?.setLevel(1 - Math.min(1, p.distanceTo(feet) / 60));
      this.app.cityWorld?.pin('boss', 0);
      return;
    }
    // pacing by the lead ALONG the route: player slow → slow down / hover; player close → speed up (smoothly)
    const eff = Math.min(this.playerS, this.maxS + 10);
    const gap = this.bossS - eff;
    let speed;
    if (['roofStandoff', 'roofDash'].includes(this.state)) speed = 18;
    else speed = gap < 14 ? 18 : gap < LEAD ? 12 : gap < LEAD + 16 ? 5 : 0;
    if (this.tether?.phase === 'stuck') speed = Math.min(speed, TT.bossSlow); // tethered: no yanking the player around
    else if (this.clock < this.breakAwayUntil && gap < LEAD + 16) speed = Math.max(speed, 12) + TT.breakAwaySpeed; // after the cut: pull away smoothly
    // v0.47 Story combat pacing: the 14 m floor (he matches a faster player), the stall cap, the break-away; raises apply at once
    const fighting = this._fighting && this.combat.running;
    if (fighting) {
      speed = this.combat.bossSpeed(speed, gap, this._ps, LEAD);
      if (this._cap != null) speed = Math.min(speed, this._cap);
      if (speed > (this._bossV ?? speed)) this._bossV = speed;
    }
    this._bossV = (this._bossV ?? speed) + (speed - (this._bossV ?? speed)) * Math.min(1, dt * 2.5);
    const lim = Math.min(ROUTE.length + 4, Math.max(this.bossS, this.bossLimit()));
    this.bossS = Math.min(this.bossS + this._bossV * dt, lim); // never into unbuilt modules
    if (fighting) this.bossS = holdS(this.bossS, eff, lim, undefined, this.combat.lunging); // v0.47: the 1.5 m last resort (never flown through; the built limit wins; v0.49: not during the fly-in)
    this.app.cityWorld?.pin('boss', routeTileAt(Math.min(this.bossS, ROUTE.length - 1)));
    const atEnd = this.bossS >= ROUTE.length;
    let target;
    if (atEnd) target = this.hoverPoint(tNow); // waits right above the blue circle (small bob only)
    else {
      target = routePoint(this.bossS); target.y = routeHeight(this.bossS) + 4 + Math.sin(tNow * 1.4) * 0.8;
      if (this._bossV < 1) { target.x += Math.sin(tNow * 0.9) * 2.5; target.z += Math.cos(tNow * 0.9) * 1.5; } // hover in front
    }
    const look = atEnd ? feet.clone().setY(feet.y + 1.5) : routePoint(this.bossS + 12).setY(target.y);
    // v6: Mobius still in his room after the fly-by → once Green Maniac has stopped at his waiting point he turns
    // around on the jet (jet still pointing up the avenue) to face Mobius and stretches; when Mobius leaves the room
    // he turns back to the front and surfs on.
    if (this.story.inRoom && !atEnd && !this._facingBack && (this._bossV ?? 9) < 1.5) { this._facingBack = true; boss.maniac.setState('faceBack'); }
    else if (this._facingBack && !this.story.inRoom) { this._facingBack = false; boss.maniac.setState('faceFront'); }
    // v0.28 voice A: while he waits facing the window and Mobius is still in his room, a taunt every ~11 s
    if (this._facingBack && this.story.inRoom && !this.story.paused) this.app.voice?.request('A', boss.maniac.root);
    boss.flyToward(target, atEnd ? 14 : 26, dt, tNow, look); // speed-limited → never teleports
    // readable turn: bank + wave before the right turn
    const toTurn = ROUTE.sTurn - this.bossS;
    boss.bank((toTurn < 24 && toTurn > -14 ? -0.4 : 0) + (fighting ? this.combat.bankWobble(tNow) : 0), 1 - Math.exp(-dt * 4)); // (v0.47: + the sputter of a stalled jet)
    if (toTurn < 30 && toTurn > 22 && !this._waved) { this._waved = true; boss.throw(); }
    this.hum?.setLevel(1 - Math.min(1, boss.root.position.distanceTo(feet) / 70));
  }

  // --------------------------------------------------------------- respawn
  /** Fall / street / out of range: back to the latest checkpoint (never on a recycled module), boss resynced. */
  respawn() {
    const app = this.app, loco = app.locomotion, story = this.story;
    let cp = this.cp;
    const w = app.cityWorld;
    if (!cp.room && w && !w.checkpointFor(cp.tile)) cp = CHECKPOINTS.slice().reverse().find((c) => c.room || w.checkpointFor(c.tile)) || CHECKPOINTS[0];
    this.bombs.clear(); this._endTether(false);
    if (this._fighting) this.combat.respawn(); // v0.47: a stall / fly-in is cancelled, pressure cleared, one Flow level lost
    if (this.dash) this._endDash(null);
    story.fadeTo(1, 6, () => {
      loco.detach(true);
      if (cp.room) {
        app.enterRoom(); story.inRoom = true; loco.ignoreColliders = new Set(['A']); this._bSaid = false;
        loco.setCityMode(loco.surfaces);
        for (const s of app.room.parts.windowSashes) s.setOpen(Math.max(s.angle, 1.4));
      } else {
        loco.setCityMode([]);
        loco.placeAt(new THREE.Vector3(...cp.pos), null);
        loco.grounded = false; loco.cling = { building: cp.building, normal: new THREE.Vector3(...cp.normal) };
        story.inRoom = false; loco.ignoreColliders = new Set();
      }
      this.playerS = cp.s; this.maxS = Math.max(this.maxS, cp.s);
      this.bossS = Math.min(Math.max(this.bossS, cp.s + 10), cp.s + LEAD + 10);
      const bp = routePoint(this.bossS); bp.y = routeHeight(this.bossS) + 4; app.boss.root.position.copy(bp); // hidden by the fade
      if (this.state === 'bossFlyby') this.setState('chaseStraight');
      if (this.state === 'roofDash') this.setState('roofStandoff');
      if (this.state === 'roofStandoff') this.bossS = ROUTE.length + 4; // he keeps waiting over the circle
      story.fadeTo(0, 3);
      app.hud.showBanner(t('story.checkpoint'), 1.8, COLORS.text);
    });
    return true;
  }

  // --------------------------------------------------------------- visuals
  _buildCircle() {
    const g = new THREE.Group(); g.name = 'arrival-circle';
    const c = STORY.circle;
    g.position.set(c.pos[0], c.pos[1] + 0.035, c.pos[2]);
    const mk = (geo, color, opacity) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; m.renderOrder = 12; return m; };
    this.circleRing = mk(new THREE.RingGeometry(c.radius - 0.16, c.radius, 64), 0x22d3ff, 0.95);
    this.circleInner = mk(new THREE.RingGeometry(c.radius * 0.55, c.radius * 0.62, 48), 0x7ef0ff, 0.6);
    this.circleFill = mk(new THREE.CircleGeometry(c.radius - 0.16, 48), 0x1a6bff, 0.16);
    g.add(this.circleFill, this.circleInner, this.circleRing);
    this.pillar = new THREE.Mesh(new THREE.CylinderGeometry(c.radius * 0.95, c.radius * 0.95, 10, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x22d3ff, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false }));
    this.pillar.position.y = 5; g.add(this.pillar);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 4), new THREE.MeshBasicMaterial({ color: 0x7ef0ff, toneMapped: false, fog: false }));
    arrow.rotation.x = Math.PI; arrow.position.y = 3; this.circleArrow = arrow; g.add(arrow);
    g.visible = false; this.circle = g; this.root.add(g);
  }
  _buildTurnArrow() {
    const sh = new THREE.Shape();
    sh.moveTo(-3, 0.9); sh.lineTo(1, 0.9); sh.lineTo(1, 2.4); sh.lineTo(4, 0); sh.lineTo(1, -2.4); sh.lineTo(1, -0.9); sh.lineTo(-3, -0.9); sh.closePath();
    const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshBasicMaterial({ color: 0x22d3ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, toneMapped: false, fog: false }));
    // at the turn intersection, facing back toward the approaching player (south) → its tip points right (east)
    m.rotation.y = ROUTE.turnYaw;
    m.position.set(ROUTE.turn[0], routeHeight(ROUTE.sTurn) + 6, ROUTE.turn[1] + 4);
    m.visible = false; this.arrow = m; this.root.add(m);
  }
  _buildBossMarker() {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), new THREE.MeshBasicMaterial({ color: 0xff5050, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
    m.renderOrder = 37; m.visible = false; this.bossMarker = m; this.app.scene.add(m);
  }
  _buildTargetRing() {
    // restrained target hint: a thin ring on the jet hook (tether possible) / around Green Maniac (roof dash)
    const m = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 40), new THREE.MeshBasicMaterial({ color: 0x7ef0ff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false }));
    m.renderOrder = 36; m.visible = false; this.targetRing = m; this.app.scene.add(m);
  }
  /**
   * Draw the target ring (or hide it: ring = null). ring: { pos, r, color, red? }. Returns 'red' | 'blue' | null.
   * v0.47: also used by the chase after the factory (endless.js) for the Story combat's rings.
   */
  showRing(ring, tNow) {
    const cam = this.app.camera.getWorldPosition(_rc), m = this.targetRing.material, R = CLOSE.ring, red = !!ring?.red;
    this.targetRing.visible = !!ring;
    m.depthTest = !red; m.opacity = red ? R.opacity[0] + (R.opacity[1] - R.opacity[0]) * (0.5 + 0.5 * Math.sin(tNow * 2 * Math.PI * R.pulseHz)) : 0.8; // (the red ring is never hidden behind him)
    if (ring) {
      this.targetRing.position.copy(ring.pos); this.targetRing.lookAt(cam);
      this.targetRing.scale.setScalar(ring.r * Math.max(1, ring.pos.distanceTo(cam) / 20) * (1 + 0.06 * Math.sin(tNow * 6)));
      m.color.set(ring.color);
    }
    return ring ? (red ? 'red' : 'blue') : null;
  }
  _updateVisuals(dt, tNow, feet) {
    const app = this.app, s = this.state, cam = app.camera.getWorldPosition(_d);
    const bp = app.boss.root.position;
    this.bossMarker.visible = s !== 'roofDash';
    this.bossMarker.position.set(bp.x, bp.y + 4.5 + Math.sin(tNow * 4) * 0.3, bp.z);
    this.bossMarker.rotation.y += dt * 2;
    this.bossMarker.scale.setScalar(Math.max(1, bp.distanceTo(feet) / 25));
    this.arrow.visible = s === 'chaseStraight' || s === 'chaseRightTurn';
    if (this.arrow.visible) this.arrow.material.opacity = (s === 'chaseRightTurn' ? 0.6 : 0.35) + 0.3 * Math.sin(tNow * 5) ** 2;
    // target ring: only when the action is actually available
    const chest = _v.copy(feet).add(_w.set(0, CHEST, 0));
    let ring = null;
    if (s === 'roofStandoff' && this.dashCheck(chest).ok) ring = { pos: this.bossBody(new THREE.Vector3()), r: 1.6, color: 0xff6a5a };
    else if (this._fighting) ring = this.combat.ring(); // v0.47: rings only while he is stalled — red on him inside 15 m (the fly-in), blue on the jet hook beyond it (web + pull)
    else if (THROW_STATES.includes(s) && !this.tether && this.tetherCheck(chest).ok) ring = { pos: this.jetAnchor.p, r: 0.9, color: 0x7ef0ff };
    this.ringKind = this.showRing(ring, tNow);
    if (ring?.red) this.bossMarker.visible = false; // v0.47: the red ring on him says where he is; the marker above him would be a second sign (and a second draw call)
    this.circle.visible = ['approachPlatform', 'roofStandoff', 'roofDash'].includes(s);
    if (this.circle.visible) {
      const pulse = 0.5 + 0.5 * Math.sin(tNow * 3.2);
      this.circle.scale.setScalar(1); this.circleRing.material.color.set(0x22d3ff);
      this.circleRing.material.opacity = 0.75 + 0.2 * pulse; this.circleFill.material.opacity = 0.1 + 0.1 * pulse;
      this.circleInner.scale.setScalar(1 + 0.25 * pulse);
      this.pillar.material.opacity = 0.05 + 0.05 * pulse;
      this.circleArrow.position.y = 2.6 + Math.sin(tNow * 2.5) * 0.35;
      this.circleArrow.rotation.y += dt * 1.5;
    }
  }
  /** Minimap markers: route dots, next waypoint, arrival circle. */
  markers() {
    if (!this.state) return [];
    const out = [];
    for (let s = Math.max(0, Math.floor(this.playerS / 16) * 16); s <= ROUTE.length; s += 16) out.push({ kind: 'route', pos: routePoint(s) });
    const next = this.state === 'chaseStraight' ? routePoint(ROUTE.sTurn) : this.state === 'chaseRightTurn' ? routePoint(ROUTE.sTurn + 30) : new THREE.Vector3(STORY.circle.pos[0], 0, STORY.circle.pos[2]);
    out.push({ kind: 'objective', pos: next });
    return out;
  }
}
