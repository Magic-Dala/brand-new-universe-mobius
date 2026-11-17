// Story ending (v0.20): after the factory battle Green Maniac crashes out through the roll-up door and
// Mobius chases him into Dala City; the city keeps generating modules ahead — an endless swing.
//   lead (Green Maniac flies ahead along the route for CITY_CFG.endless.leadTiles modules, paced to the
//   player like in the chase) → escape (he climbs away into the sunset) → free (endless swinging; at
//   crossroads the player picks the exit by swinging into it).
// Falls / the street / leaving the corridor → a short fade to a checkpoint on a module that is kept.
// v0.47 (settings.storyCombat): the lead runs the Story chase combat (storyCombat.js) from tier 2; when the lead distance is
// done he waits out a stall or fly-in in progress, then lights the afterburner and escapes as before; a run summary shows
// as free swinging starts. Switch off = the v0.46 lead (no combat, no summary).
import * as THREE from 'three';
import { t } from '../core/i18n.js';
import { audio } from '../core/audio.js';
import { COLORS } from '../ui/panel.js';
import { CITY_CFG } from '../data/cityConfig.js';
import { EXIT_TILE } from '../data/layout.js';
import { settings } from '../core/settings.js';
import { STORY_CHASE } from '../data/storyChase.js';
import { holdS } from './storyAttacks.js';

const _v = new THREE.Vector3(), _c = new THREE.Vector3(), _w = new THREE.Vector3();
const LEAD = 32;
const CHEST = 1.3; // chest height above the feet (as in chase.js)

export class Endless {
  constructor(story) { this.story = story; this.app = story.app; this.state = null; this.tiles = 0; }
  get active() { return !!this.state; }
  // --------------------------------------------------------------- v0.47 Story combat (settings.storyCombat)
  get combat() { return this.story.combat; }
  get combatOn() { return settings.storyCombat !== false; }
  /** The combat loop is running for THIS chase (not the first one). */
  get _fighting() { const C = this.story.combat; return !!C && C.active && C.host === this._hostObj; }
  /** What the Story combat needs from the lead: positions along the generated route, the world, the tier, when he may throw. */
  _host() {
    if (this._hostObj) return this._hostObj;
    const self = this, eff = () => Math.min(self.playerS, self.maxS + 10);
    return (this._hostObj = {
      kind: 'endless', jetDamage: 0.15, // (the jet still smokes a little from the factory)
      get world() { return self.app.cityWorld; },
      bossS: () => self.bossS, playerS: eff, gap: () => self.bossS - eff(),
      segmentTier: () => STORY_CHASE.endless.startTier,
      throwsAllowed: () => self.state === 'lead' && !self._leadDone, // none once the lead distance is done (he is about to leave)
      active: () => self.state === 'lead',
      capBossSpeed: (v) => { self._cap = v; },
    });
  }
  _endCombat() { if (this._fighting) this.combat.stop(); this._cap = null; if (this._ringOn) { this.ringKind = this.story.chaseCtl.showRing(null, 0); this._ringOn = false; } }

  begin() {
    const app = this.app, w = app.cityWorld, loco = app.locomotion;
    // v7: 'wait' first — Green Maniac hovers just ahead, turned round on his jet, stretching at Mobius until Mobius
    // starts swinging; then he turns back and leads ('lead' → 'escape' → 'free' as before). Coins all the way.
    this.state = 'wait'; this.stateTime = 0; this.tiles = 0; this.startTile = EXIT_TILE; this._lastTile = -1; this._crossHint = -1; this._faced = false;
    this._leadDone = false; this._cap = null; this._ps = 0; this._prevS = null; this._bv = undefined; this.ringKind = null; this._ringOn = false; // v0.47
    w.mode = 'endless';
    const feet = loco.feet(new THREE.Vector3());
    const pr = w.progress(feet.x, feet.z, w.route.tiles[EXIT_TILE].s0 ?? 0);
    this.playerS = pr.s; this.maxS = pr.s;
    this.bossS = pr.s + 24; this.distance = 0;
    const bp = w.pointAt(this.bossS); app.boss.remount(); app.boss.setVisible(true); app.boss.jet.setDamage(0.15); app.boss.jet.setThrust(1);
    app.boss.root.position.set(bp.x, 14, bp.z); app.boss.resetScale();
    this.hum = audio.startJetHum?.();
    this.startFeet = feet.clone();
    app.coins?.startEndless(this);
    app.hud.showBanner(t('story.endless.chase'), 2.8, COLORS.bad, t('char.boss'));
    this.story.objective(t('story.obj.endless.chase'), [t('tut.swing')]);
  }
  stop() { this._endCombat(); this.state = null; this.hum?.stop(); this.hum = null; this.app.cityWorld?.pin('boss', null); }

  /** dt = the Story's (impact-time scaled) step; realDt = the unscaled one (v0.47; equal when no warp runs). */
  update(dt, tNow, realDt = dt) {
    if (!this.state) return;
    this.stateTime += dt;
    // v0.47: the combat loop belongs to the lead; the dev switch flipped mid-lead starts / stops it on this frame
    if (this.state === 'lead' && this.combatOn && !this._fighting && !this._leadDone) this.combat.begin(this._host(), { tier: STORY_CHASE.endless.startTier });
    else if (this._fighting && (!this.combatOn || this.state !== 'lead')) this._endCombat();
    const fighting = this._fighting;
    const app = this.app, w = app.cityWorld, loco = app.locomotion, boss = app.boss;
    const feet = loco.feet(new THREE.Vector3());
    const pr = w.progress(feet.x, feet.z, this.playerS);
    if (pr.s > this.maxS && pr.s - this.maxS < 45) { this.distance += pr.s - this.maxS; this.maxS = pr.s; }
    if (this._prevS != null && dt > 0) { const ds = pr.s - this._prevS; if (Math.abs(ds) < 8) this._ps += (Math.max(0, Math.min(40, ds / dt)) - this._ps) * Math.min(1, dt * 4); } // v0.47: the player's speed along the route (smoothed)
    this._prevS = pr.s;
    this.playerS = pr.s;
    // webs: anchors only (v0.47, in the lead: the pumpkin lock / web strike / (stalled) jet web or fly-in come first)
    for (const e of app.hub.events) {
      if (e.type !== 'web') continue;
      if (fighting && this.combat.onWeb(e, loco, _c.copy(feet).add(_w.set(0, CHEST, 0)))) continue;
      if (!loco.tryAttach(e)) { app.fx.web(e.origin, _v.copy(e.origin).addScaledVector(e.dir, 25)); audio.play('web'); }
    }
    if (fighting) this.combat.update(dt, realDt, tNow); // v0.47: tiered attacks, the stall loop, Light Bomb, Fan Web, Flow
    // blocks passed (objective)
    const tile = w.curTile;
    if (tile !== this._lastTile) {
      this._lastTile = tile; this.tiles = Math.max(this.tiles, tile - this.startTile);
      if (this.state === 'free') this.story.objective(t('story.obj.endless.free', { n: this.tiles }), [t('tut.swing'), t('story.explore.menu')]);
    }
    // crossroads ahead: tell the player they can choose (free phase)
    const pend = w.route.pending;
    if (this.state === 'free' && pend && pend.idx - tile <= 1 && this._crossHint !== pend.idx) { this._crossHint = pend.idx; app.hud.showBanner(t('story.endless.cross'), 2.4, COLORS.perfect); }

    if (this.state === 'wait') {
      const p = w.pointAt(this.bossS), y = Math.min(p.y + 3, feet.y + 9) + Math.sin(tNow * 1.4) * 0.3;
      const d = boss.flyToward(_v.set(p.x, y, p.z), 10, dt, tNow, w.pointAt(this.bossS + 12).setY(y)); // jet points up the route
      w.pin('boss', this._tileAt(this.bossS));
      this.hum?.setLevel(0.5);
      if (!this._faced && d < 2) { this._faced = true; boss.maniac.setState('faceBack'); } // turns round, stretches at Mobius
      const moved = Math.hypot(feet.x - this.startFeet.x, feet.z - this.startFeet.z) > 12 || feet.y - this.startFeet.y > 4;
      if (loco.attach || loco.wallRun || moved) { // Mobius is swinging → turn back to the front and lead
        this.state = 'lead'; this.stateTime = 0;
        boss.maniac.setState(this._faced ? 'faceFront' : 'ride');
      }
    } else if (this.state === 'lead') {
      const gap = this.bossS - Math.min(this.playerS, this.maxS + 10);
      let v = gap < 14 ? 19 : gap < LEAD ? 12 : gap < LEAD + 18 ? 5 : 0;
      // v0.47 Story combat pacing: the 14 m floor (he matches a faster player), the stall cap, the break-away; raises apply at once
      const paced = fighting && this.combat.running;
      if (paced) {
        v = this.combat.bossSpeed(v, gap, this._ps, LEAD);
        if (this._cap != null) v = Math.min(v, this._cap);
        if (v > (this._bv ?? v)) this._bv = v;
      }
      this._bv = (this._bv ?? v) + (v - (this._bv ?? v)) * Math.min(1, dt * 2.5);
      const lastReady = this._lastReadyS(), lim = Math.max(this.bossS, lastReady);
      this.bossS = Math.min(this.bossS + this._bv * dt, lim); // never into unbuilt modules
      if (paced) this.bossS = holdS(this.bossS, Math.min(this.playerS, this.maxS + 10), lim, undefined, this.combat.lunging); // v0.47: the 1.5 m last resort (never flown through; the built limit wins; v0.49: not during the fly-in)
      const p = w.pointAt(this.bossS), y = p.y + 3 + Math.sin(tNow * 1.4) * 0.8;
      boss.flyToward(_v.set(p.x, y, p.z), 26, dt, tNow, w.pointAt(this.bossS + 12).setY(y));
      if (paced) boss.bank(this.combat.bankWobble(tNow), 1 - Math.exp(-dt * 4)); // (the sputter of a stalled jet)
      w.pin('boss', this._tileAt(this.bossS));
      this.hum?.setLevel(1 - Math.min(1, boss.root.position.distanceTo(feet) / 70));
      if (tile >= this.startTile + CITY_CFG.endless.leadTiles) {
        // v0.47: a stall or fly-in in progress is played out first (no new throws, and he cannot stall again after it)
        if (fighting && (this.combat.stalled || this.combat.lunging)) this._leadDone = true;
        else {
          const fought = fighting;
          this._endCombat();
          this.state = 'escape'; this.stateTime = 0;
          if (fought) { boss.jet.setDamage(0.15); boss.jet.setThrust(1); audio.play('jetRecover'); app.voice?.say('ESCAPE', boss.maniac.root, { interrupt: true }); } // the afterburner and his parting line
          boss.throw(); audio.play('jetFlyby');
          app.hud.showBanner(t('story.endless.escaped'), 3.2, COLORS.warn, t('char.boss'));
        }
      }
    } else if (this.state === 'escape') { // climbs away toward the low sun, then gone
      const fwd = w.pointAt(this.bossS + 40).sub(w.pointAt(this.bossS)).setY(0);
      if (fwd.lengthSq() < 1e-6) { boss.root.getWorldDirection(fwd); fwd.setY(0); if (fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0); } // path end clamp → keep heading
      fwd.normalize();
      boss.root.position.addScaledVector(fwd, 30 * dt); boss.root.position.y += (10 + this.stateTime * 8) * dt;
      boss.face(boss.root.position.clone().addScaledVector(fwd, 10).add(_v.set(0, 6, 0)), 1 - Math.exp(-dt * 3)); boss.bank(-0.25, 0.1); boss.update(dt, tNow);
      this.hum?.setLevel(Math.max(0, 0.8 - this.stateTime * 0.2));
      if (this.stateTime > 5) {
        boss.setVisible(false); this.hum?.stop(); this.hum = null; w.pin('boss', null);
        this.state = 'free'; this._lastTile = -1;
        this.story.objective(t('story.obj.endless.free', { n: this.tiles }), [t('tut.swing'), t('story.explore.menu')]);
        app.hud.showBanner(t('story.endless.free'), 3, COLORS.perfect, t('place.city'));
        if (this.combatOn) app.hud.showSummary?.(this.combat.stats, STORY_CHASE.summaryTime); // v0.47: the whole Story run (both chases); blocks nothing, saves nothing
      }
    }
    // v0.47: the red ring on him / the blue ring on the jet hook, only while he is stalled in the lead (the chase's own ring mesh)
    const ring = this._fighting && this.state === 'lead' ? this.combat.ring() : null;
    if (ring || this._ringOn) { this.ringKind = this.story.chaseCtl.showRing(ring, tNow); this._ringOn = !!ring; }
  }
  _lastReadyS() {
    const w = this.app.cityWorld; let s = this.bossS;
    for (const e of w.paths) { if (e.s1 < this.bossS) continue; const c = w.tileCell(e.idx); if (!c || !c.ready) break; s = Math.max(s, e.s1 - 10); } // from his own tile forward
    return s;
  }
  _tileAt(s) { const w = this.app.cityWorld; for (const e of w.paths) if (s <= e.s1) return e.idx; return w.paths.at(-1)?.idx ?? null; }

  /** Recovery: a checkpoint on the current (or a recent, still kept) module; boss re-synced. */
  respawn() {
    const app = this.app, w = app.cityWorld, loco = app.locomotion, story = this.story;
    let cp = null;
    for (let k = w.curTile; k >= Math.max(0, w.curTile - CITY_CFG.behindTiles) && !cp; k--) cp = w.checkpointFor(k);
    if (this._fighting) this.combat.respawn(); // v0.47: a stall / fly-in is cancelled, pressure cleared, one Flow level lost
    story.fadeTo(1, 6, () => {
      loco.detach(true); loco.setCityMode([]);
      if (cp && cp.kind === 'cling') {
        loco.placeAt(new THREE.Vector3(...cp.pos), null); loco.grounded = false; loco.cling = { building: cp.building, normal: new THREE.Vector3(...cp.normal) };
      } else if (cp) { loco.placeAt(new THREE.Vector3(...cp.pos), null); if (cp.kind === 'roof') loco._landRoof(w.colliderOf(cp.building)); }
      else { const p = w.pointAt(this.maxS); loco.placeAt(new THREE.Vector3(p.x, 0, p.z), null); }
      if (this.state === 'lead') { this.bossS = Math.max(this.bossS, this.maxS + 18); const bp = w.pointAt(this.bossS); app.boss.root.position.set(bp.x, bp.y + 3, bp.z); }
      story.fadeTo(0, 3);
      app.hud.showBanner(t('story.checkpoint'), 1.8, COLORS.text);
    });
    return true;
  }
}
