// Brand New Universe - Mobius — app entry.
// IWSDK World owns the renderer loop, XR session and InputManager. All game
// logic runs inside ONE IWSDK ECS system (GameSystem) — no second render loop.
import { pickBgm, bgmGain, bgmUrl } from './core/bgm.js';
import * as THREE from 'three';
import { World, createSystem, SessionMode, ReferenceSpaceType, VisibilityState } from '@iwsdk/core';
import { hideDefaultInputVisuals, defaultInputVisualsHidden } from './input/hideDefaultHands.js';
import { t, getLang, setLang, LANGS, onLangChange } from './core/i18n.js';
import './worlds/i18n.js';
import { settings, getBest, setBest, onSettingsChange } from './core/settings.js';
import { audio } from './core/audio.js';
import { listSongs, loadSong } from './core/songs.js';
import { LoadingOverlay } from './ui/loading.js';
import { createFactoryInterior } from './art/factory.js';
import { INTERIOR, interiorSurface } from './data/factory.js';
import { InputHub } from './input/hub.js';
import { Effects } from './game/effects.js';
import { ArcadeGame } from './game/arcade.js';
import { LANE_TUNE } from './game/lanes.js';
import { loadArmoredPumpkin } from './art/armoredPumpkin.js';
import { Boss } from './game/boss.js';
import { Calibration } from './game/calibration.js';
import { Locomotion } from './game/locomotion.js';
import { LightShield } from './game/lightShield.js'; // v0.44 palm-facing light-web shield
import { TutorialPanel } from './ui/tutorialPanel.js'; // v0.49 Story tutorials
import { TimeWarp } from './game/timeWarp.js'; // v0.45 impact time
import { FEEL } from './data/feel.js';
import { Story } from './game/story.js';
import { HUD } from './ui/hud.js';
import { PanelManager, COLORS } from './ui/panel.js';
import { Menus } from './ui/menus.js';
import { initTitle } from './ui/title.js';
import { createSky, createLighting, SUN_DIRECTION } from './art/sky.js';
import { loadCityPBR } from './art/cityMaterials.js'; // v0.30 city
import { createCity, createFog } from './art/city.js';
import { createRoom } from './art/room.js';
import { createArmoredHand, createMobiusBody, createMobiusSuitDisplay } from './art/mobius.js';
import { loadMobiusModel, createMobiusModelDisplay, createMobiusModelBody } from './art/mobiusModel.js';
import { loadMobiusRig, createMobiusRigDisplay, createMobiusAvatar } from './art/mobiusRig.js';
import { WindFx } from './game/windFx.js';
import { SpeedFx } from './game/speedFx.js';
import { Coins } from './game/coins.js';
import { VoiceDirector } from './game/voice.js';
import { createPerfProbe, saveReport } from './core/perfProbe.js';
import { installXrTuning, xrInfo, xrTargetMiB } from './core/xrTuning.js';
import { createCityBench } from './game/cityBench.js';
import { cityQualityFlags, CITY_Q_FEATURES } from './art/cityQuality.js';
import { loadBossModels, loadBossModelsHD } from './art/bossModels.js';
import { loadPumpkinModels } from './art/pumpkinModels.js';
import { ROOM, ARCADE, KEY_BUILDINGS, STORY, FACTORY_EXT, roomToWorld, cityWorld } from './data/layout.js';
import { WorldChase } from './worlds/worldChase.js'; // v0.40 World Chase (eight worlds, endless pursuit)
import { installWorldMenus } from './worlds/worldMenus.js';
import { mapById, launchMap } from './worlds/maps.js';
const _cv = Array.from({ length: 7 }, () => new THREE.Vector3()), _cq = new THREE.Quaternion();
/** Room city culling: view-cone half angle and the window sample radius. */
const ROOM_CULL = { halfAngle: THREE.MathUtils.degToRad(64), sampleR: 0.25 }; // Quest 3 eye-corner ≈ 61°

const MIRROR_LAYER = 5;
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _hv = new THREE.Vector3(), _hq = new THREE.Quaternion();
/** v0.45: music low-pass for a time-warp scale — 20 kHz at 1, FEEL.warp.musicCutoff at the slowest configured scale (log frequency). */
const warpCutoff = (s) => { const W = FEEL.warp, k = THREE.MathUtils.clamp((1 - s) / (1 - W.defeat.scale), 0, 1); return 20000 * Math.pow(W.musicCutoff / 20000, k); };
/** v0.45 dev overlay: the detail profile this renderer resolved + its selection counters (forest / redrock, v0.46). */
const forestLine = (f, id = 'forest') => `${id} ${f.requested}→${f.quality} (${f.reason}${f.xr ? ', XR' : ''})  cull ${f.cull}  inst ${f.instances} (culled ${f.culled}, thinned ${f.thinned})  pools ${f.drawn}/${f.pools}  ${(f.tris / 1000).toFixed(0)}k tris  select ${f.rebuildMs}/${f.maxRebuildMs} ms ×${f.rebuilds}`;

class App {
  async init() {
    this.status = (key, vars, kind) => this.title?.setStatus(key, vars, kind);
    const container = document.getElementById('scene');
    this.world = await World.create(container, {
      xr: {
        sessionMode: SessionMode.ImmersiveVR,
        referenceSpace: { type: ReferenceSpaceType.LocalFloor, fallbackOrder: [ReferenceSpaceType.Local] },
        features: { handTracking: { required: false }, layers: false },
        offer: 'none',
      },
      features: { locomotion: false, grabbing: false, physics: false, spatialUI: false },
      input: { canvasPointerEvents: false },
      render: { fov: 62, near: 0.1, far: 1300 }, // near 0.1 (was 0.03): ~3× better depth precision → no distant z-fighting
    });
    const w = this.world;
    this.scene = w.scene; this.camera = w.camera; this.renderer = w.renderer;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.xrTune = installXrTuning(this.renderer); // v0.27: framebuffer scale / foveation / multiview A/B (applied at the next VR entry where needed)
    // one input system: IWSDK pointers/visuals off (we render armored hands + own UI pointer)
    for (const h of ['left', 'right']) {
      try { w.input.xr.multiPointers[h].toggleSubPointer('ray', false); w.input.xr.multiPointers[h].toggleSubPointer('touch', false); w.input.xr.multiPointers[h].toggleSubPointer('grab', false); } catch (e) { console.warn('pointer toggle', e); }
      try { w.input.visualAdapters.hand[h].toggleVisual(false); w.input.visualAdapters.controller[h].toggleVisual(false); } catch (e) { console.warn('visual toggle', e); }
    }
    this.camera.layers.disable(MIRROR_LAYER);

    // ---------------- environment
    this.scene.fog = createFog();
    this.sky = createSky({ sunDirection: SUN_DIRECTION });
    // the sky shader is drawn LAST among opaque objects (it sits at far depth), so it only shades
    // the few pixels where it is actually visible instead of the whole screen every frame
    { const g = new THREE.Group(); g.name = 'SkyGroup'; g.renderOrder = 1000; g.add(this.sky.root); this.scene.add(g); this.skyGroup = g; }
    this.lights = createLighting(this.scene, { sunDirection: SUN_DIRECTION });
    // Dala City (v0.20): modular NYC-style city streamed module by module (data: cityWorld, visuals: city)
    this.cityWorld = cityWorld;
    this.city = createCity({ world: cityWorld }); this.scene.add(this.city.root);
    // v0.30 city: kit pieces + CC0 textures loaded, sky reflection baked once, BEFORE the shader warm-up below
    try { await Promise.race([Promise.all([this.city.kit.loading, loadCityPBR().then((ok) => ok || loadCityPBR())]), new Promise((r) => setTimeout(r, 20000))]); } catch (e) { console.warn('city assets', e); }
    try { this.city.bakeReflections(this.renderer, this.sky.root); } catch (e) { console.warn('reflection bake', e); }
    this.city.setFocus(new THREE.Vector3(...roomToWorld(ROOM.playerStart.pos))); // the home block (title view out of the window)
    try { this.renderer.compile(this.scene, this.camera); } catch (e) { console.warn('compile', e); } // v0.27: city / art shaders + textures ready before the title shows
    // v0.30: objects that only appear DURING play are compiled now too (0 compiles in gameplay): the factory exterior
    // (created when its cell streams in) and every VFX material (normally warmed at the story start)
    try { const f = this.city.factory, vis = f.root.visible; f.root.visible = true; this.renderer.compile(f.root, this.camera, this.scene); f.root.visible = vis; } catch (e) { console.warn('compile factory', e); }
    cityWorld.on({ rebased: (dx, dz) => this._onRebase(dx, dz) });
    this.room = createRoom(); this.scene.add(this.room.root);
    // Mobius character model v3 (public/models/mobius_rigged.glb: rigged incl. fingers → rack suit, mirror body AND
    // the first-person hands, one skeleton); fallbacks: v2 mobius.glb (rack + mirror, old armored hands), procedural
    try { this.mobiusRig = await loadMobiusRig(); } catch (e) { console.warn('mobius_rigged.glb failed, using the older Mobius', e); this.mobiusRig = null; }
    if (!this.mobiusRig) try { this.mobiusModel = await loadMobiusModel(); } catch (e) { console.warn('mobius.glb failed, using procedural Mobius', e); this.mobiusModel = null; }
    this.suit = this.mobiusRig ? createMobiusRigDisplay(this.mobiusRig) : this.mobiusModel ? createMobiusModelDisplay(this.mobiusModel) : createMobiusSuitDisplay();
    this.room.parts.suitPlaceholder.visible = false;
    this.room.parts.suitMount.add(this.suit.root);
    // Green Maniac + Green Bat Jet models (procedural versions are the fallback)
    try { await loadBossModels(); } catch (e) { console.warn('boss GLBs failed, using procedural enemies', e); }
    try { await loadPumpkinModels(); } catch (e) { console.warn('pumpkin bomb GLBs failed, using procedural bombs', e); }
    loadArmoredPumpkin().catch((e) => console.warn('armored_pumpkin.glb failed, using the stand-in', e)); // v0.48 (in the background; the Arcade makes its pumpkin on the first run) // arcade bombs (normal + giant)
    this.boss = new Boss(this.scene);
    // HD boss set for the factory (arcade + story boss fight): fetched in the background, swapped in during the
    // factory Loading screen; the city chase keeps the lighter SD meshes (bigger scene, boss often far away)
    this.bossHD = null; this._bossHDState = 'loading';
    loadBossModelsHD().then((m) => { this.bossHD = m; this._bossHDState = 'ready'; }, (e) => { console.warn('HD boss models failed, factory uses SD', e); this._bossHDState = 'failed'; });
    this.fx = new Effects(this.scene);
    this.hud = new HUD(this.scene);
    this.panels = new PanelManager(); this.panels.attach(this.scene);
    this.hub = new InputHub(w);
    this.shield = new LightShield(this); // v0.44 (gesture: hub.shieldDet; blocking: ChaseBombs.blocker → shield.tryBlock)
    // first-person hands: the procedural armored glove (aiming + gestures; v3 look copies the New Mobius model).
    // With the rigged model the mirror body is the v3 avatar (its own skinned fingers) — it gets the same hand input.
    const glove = { left: createArmoredHand('left'), right: createArmoredHand('right') };
    if (this.mobiusRig) {
      this.avatar = createMobiusAvatar(this.mobiusRig); this.scene.add(this.avatar.root);
      this.avatar.setFirstPersonVisible(false); // (its skinned first-person hand copies are not used)
      const both = (h) => { const g = glove[h], a = this.avatar.hands[h]; return {
        root: g.root, handedness: h, glove: g, wristEmitter: g.wristEmitter, palmButtonAnchor: g.palmButtonAnchor, get armored() { return g.armored; },
        setJoints(p, q) { g.setJoints(p, q); a.setJoints(p, q); },
        setControllerPose(m, gv, tv) { g.setControllerPose(m, gv, tv); a.setControllerPose(m, gv, tv); },
        setArmored(v) { g.setArmored(v); a.setArmored(v); },
        setVisible(v) { g.setVisible(v); a.setVisible(v); },
      }; };
      this.hands = { left: both('left'), right: both('right') };
    } else this.hands = glove;
    for (const h of ['left', 'right']) { w.player.add(this.hands[h].root); this.hands[h].setVisible(false); }
    this._buildPalmButton();
    this._buildMirror();
    // v0.25 stage 0: per-pass render accounting (main / mirror / other RTs), GPU timer (if any), frame histogram
    this.probe = createPerfProbe(this.renderer, { labelOf: (rt) => (rt && rt === this.mirror?.rt ? 'mirror' : null) });
    this.bench = createCityBench(this);
    this.voice = new VoiceDirector(this); // v0.28 Green Maniac voice-over
    onSettingsChange((k) => { if (k === 'cityQ' || k === 'cityQOff') this.city.setQuality(cityQualityFlags()); });
    onSettingsChange((k) => { if (k === 'factoryQOff') this.interior?.applyFlags?.(); }); // v0.31: live factory feature toggles
    this.menus = new Menus(this);
    this.calibration = new Calibration(this);
    this.locomotion = new Locomotion(this);
    this.windFx = new WindFx(this); this.speedFx = new SpeedFx(this); this.coins = new Coins(this); // v0.23
    this.worldChase = new WorldChase(this); installWorldMenus(this); // v0.40
    this.timeWarp = new TimeWarp(); this.feelMusic = { warpCutoff: 20000, flowCutoff: 20000, lift: 1 }; // v0.45: impact time (World Chase world simulation only) + music bus
    this.arcade = new ArcadeGame(this);
    this.fx.prewarmVfx?.(8); // v0.30: every VFX material is drawn (invisibly) on the first title frames → compiled before any gameplay
    this.story = new Story(this);
    this.tutorialPanel = new TutorialPanel(this); // v0.49: the panel of the Story's tutorials (model: this.story.tutorials)
    this.locomotion.ignoreColliders = new Set(['A']);
    this.locomotion.setRoofBlockers('C', FACTORY_EXT.equipment); // no teleporting onto the factory roof equipment
    this.perf = { fps: 72, ms: 14, calls: 0, tris: 0, t: 0, acc: 0, n: 0 };
    // worlds: 'city' (Dala City + home room) | 'loading' | 'factory' (separate interior scene)
    this.worldName = 'city'; this.interior = null; this.interiorSurface = interiorSurface();
    this.loader = new LoadingOverlay(this);
    this._loadJob = null;
    this.debug = { failInteriorLoad: 0 };
    this.locomotion.onWebBlocked = () => { const now = performance.now() / 1000; if ((this._webBlockedT || 0) < now) { this._webBlockedT = now + 4; this.hud.showBanner(t('hint.webBlocked'), 1.6, COLORS.warn); } };
    this.damageFlash = this._buildDamageFlash();

    // arcade arena reference frame (feet on C roof, facing north)
    this.arenaOrigin = new THREE.Vector3(...ARCADE.playerPos);
    this.arenaForward = new THREE.Vector3(...ARCADE.forward);
    this.bossHome = new THREE.Vector3(...ARCADE.bossHome);

    this.state = 'title';
    this.xrActive = false;
    this.desktop = false;
    this._lastT = performance.now() / 1000;

    // ---------------- the single game system
    const app = this;
    class GameSystem extends createSystem({}, {}) {
      update(delta, time) { app.frame(delta, time, this.world.xrFrame); }
    }
    w.registerSystem(GameSystem);

    // XR session lifecycle
    this.renderer.xr.addEventListener('sessionstart', () => this._onSessionStart());
    this.renderer.xr.addEventListener('sessionend', () => this._onSessionEnd());
    w.visibilityState.subscribe((v) => { if (v === VisibilityState.Hidden || v === VisibilityState.VisibleBlurred) this.autoPause('xr-' + v); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.autoPause('page-hidden'); });
    audio.onStateChange((s) => { if (s !== 'running' && this.state === 'arcade') this.autoPause('audio-' + s); });

    this.title = initTitle(this);
    this.setTitleView();
    window.__mobius = this; window.__THREE = THREE; window.__t = t; // debug/test hooks
    window.__mobiusHandsHidden = () => defaultInputVisualsHidden(this.world.input); // v1.1: true = no default engine hand / controller mesh drawn
    await this.title.checkXR();
  }

  // =================================================================== frame
  frame(delta, time, xrFrame) {
    const tJs = performance.now();
    this.probe?.beginFrame(tJs);
    this._frameInner(delta, time, xrFrame);
    if (this.probe) {
      this.probe.jsTime(performance.now() - tJs);
      const c = this.city.stats, w = this.cityWorld.stats;
      this.probe.mark('cityPump', c.pumpMs || 0); this.probe.mark('cityBuild', c.phBuild || 0); this.probe.mark('cityDetail', c.phDetail || 0); this.probe.mark('cityBackdrop', c.phBack || 0);
      if (w.created !== this._pc) { this.probe.mark('cellCreate', w.createMs); this._pc = w.created; }
      if (w.recycled !== this._pr) { this.probe.mark('cellRecycle', w.recycleMs); this._pr = w.recycled; }
      const fd = this.worldName === 'world' ? this.worldChase.renderer?.extras?.stats : null;
      if (fd?.rebuilds && (fd !== this._pfdSource || fd.rebuilds !== this._pfd)) {
        this.probe.mark(this.worldChase.mapId === 'redrock' ? 'redrockSelect' : 'forestSelect', fd.rebuildMs);
        this._pfd = fd.rebuilds; this._pfdSource = fd;
      }
    }
  }
  /** v0.43: background music follows the game state (src/core/bgm.js). */
  _updateBgm() {
    const w = this.worldChase, want = pickBgm({ state: this.state, worldMapId: w.mapId, worldPaused: w.paused, worldResolved: !!w.state && !w.run?.running, worldLoadingMap: this._loadJob?.kind === 'world' ? this._worldPending : null,
      storyStage: this.story?.stage, storyPaused: this.story?.paused, menuOpen: this.menus.open });
    if (want) audio.setBgm(want.id, want.level, { gain: bgmGain(want.id), url: bgmUrl(want.id) }); else audio.setBgm(null);
  }
  /** v0.45: music bus filter — the slower of time warp / Flow meter, only during a running, unpaused World Chase; neutral otherwise. */
  _applyFeelMusic() {
    const m = this.feelMusic, on = (this.state === 'world' && this.worldChase.running && !this.worldChase.paused) || (!!this._storyFight && !this.story.paused); // (v0.47: + the Story chase while its combat runs)
    const c = on ? Math.min(m.warpCutoff, m.flowCutoff) : 20000, l = on ? m.lift : 1;
    if (audio.ctx && c === this._fmC && l === this._fmL) return; // (unchanged: no new automation event every frame)
    audio.setMusicFilter(c, l); this._fmC = audio.ctx ? c : null; this._fmL = l;
  }
  _frameInner(delta, time, xrFrame) {
    const tNow = performance.now() / 1000;
    this._updateBgm();
    const storyCombatOn = this.state === 'story' && settings.storyCombat !== false; // v0.47 dev switch (off = the v0.46 Story)
    const arcadeOn = this.state === 'arcade' || this.state === 'results'; // v0.48: the designed samples in the Arcade too (settings.designedSfx still governs them)
    audio.useArcade = arcadeOn;
    audio.useBank = this.state === 'world' || storyCombatOn || arcadeOn; // v0.45: the designed samples in World Chase; v0.47: and in all of Story
    audio.useStory = storyCombatOn; // v0.47: the Story's own samples (SFX_MANIFEST_STORY) only there, so World Chase sounds as before
    // v0.47: the Story chase / the chase after the factory while the combat loop runs → scaled time, music bus, Fan Web, Light Bomb lock
    const storyFight = this._storyFight = storyCombatOn && ['chase', 'endless'].includes(this.story.stage) && !!this.story.combat?.running;
    const dt = Math.min(0.1, Math.max(0, delta || tNow - this._lastT)); this._lastT = tNow;
    hideDefaultInputVisuals(this.world.input); // v1.1: IWSDK re-shows its white-outlined default hands every frame; keep only ours
    // v0.45 impact time: only the World Chase world simulation runs on simDt; head / hands / HUD / menus keep real dt.
    // Frozen while paused; reset (scale 1) the moment the chase is not running (menus, map change, restart, defeat, Arcade…).
    const warpOn = (this.state === 'world' && this.worldChase.running) || storyFight;
    const warpHeld = this.menus.open || (this.state === 'world' ? this.worldChase.paused : this.story.paused);
    const scale = warpOn && !warpHeld ? this.timeWarp.update(dt) : warpOn ? this.timeWarp.scale : (this.timeWarp.reset(), 1);
    const simDt = dt * scale;
    this.feelMusic.warpCutoff = warpCutoff(scale); this._applyFeelMusic();
    const hub = this.hub;
    // input context (priority model)
    const menuOpen = this.menus.open && !['results'].includes(this.menus.current) && this.state !== 'modeSelect' && this.state !== 'songSelect' && this.state !== 'calibrate';
    const inWorld = this.state === 'world' && this.worldChase.running && !this.menus.open && !this.worldChase.paused; // v0.40 (v0.41: not once the run is resolved)
    const tutOpen = this.state === 'story' && !!this.story.tutorials.active; // v0.49: a Story tutorial is open → no teleport, turn or attack (its buttons still work)
    const allowAttack = (this.state === 'arcade' && this.arcade.state === 'playing' && !this.menus.open) || (this.state === 'calibrate' && this.calibration.running) || (this.state === 'story' && this.story.allowAttack && !this.menus.open && !tutOpen) || (inWorld && this.worldChase.allowAttack);
    // v0.44 palm shield: only where Green Maniac's thrown pumpkins exist (Story chase, World Chase). Deliberately NOT in the
    // Arcade: its pumpkins are rhythm notes — a block would bypass the judgement, so the gesture is simply off there.
    const loco = this.locomotion;
    const shieldMode = settings.palmShield !== false && ((inWorld && this.worldChase.allowAttack) || (this.state === 'story' && this.story.allowAttack && !this.menus.open && !this.story.paused && ((this.story.stage === 'chase' && !this.story.inRoom) || (this._storyFight && this.story.stage === 'endless')))); // (v0.47: + the lead after the factory while its combat runs)
    hub.ctx.shieldRope.left = !!loco?.ropeOf('left'); hub.ctx.shieldRope.right = !!loco?.ropeOf('right'); // a hand still holding a swing web must release it first
    hub.setContext({ shield: shieldMode, shieldHold: !!loco && (!!loco.cling || !!loco.zip || loco.scripted || !!loco.frozen), allowAttack, bombLocked: (inWorld && !this.worldChase.lightBombReady) || (storyFight && !this.story.combat.lightBombReady), energyWave: this.state === 'arcade' && this.arcade.state === 'playing' && settings.arcadeArmored !== false, /* v0.48: only while the Arcade is playing */ fanWeb: (this.state === 'arcade' && this.arcade.state === 'playing') || (inWorld && this.worldChase.allowAttack) || (storyFight && this.story.allowAttack && !this.menus.open), fanWebControllers: this.state === 'arcade', menuOpen: this.menus.open && menuOpen, allowLocomotion: (this.state === 'story' && this.story.allowLocomotion && !this.menus.open && !tutOpen) || (inWorld && this.worldChase.allowLocomotion), uiHover: { ...this.panels.hoverHand } });
    if (this.state !== 'title') { hub.update(this.xrActive ? xrFrame : null, tNow); this.shield.update(dt, tNow); }
    // palm/controller menu toggle
    for (const e of hub.events) if (e.type === 'menu') this.toggleMenu();

    this._updateHands();
    this.menus.update();
    this.tutorialPanel.update(); // v0.49
    this.panels.update(hub);
    if (this.state === 'calibrate') this.calibration.update(hub.events);
    this._runLoadJob();
    this.loader.update(dt);
    if (this.worldName === 'factory') this.interior?.update(dt, tNow, this.camera); // smoke, embers, mist, crane hook
    this.arcade.update(dt, tNow);
    if (this.state === 'story') this.story.update(dt, tNow, simDt); // (v0.47: simDt for the two chases; fades / subtitles keep dt)
    else this.story._updateFade(dt); // fades (e.g. after the black Loading screen) also run in menus
    if (this.worldName === 'world') this.worldChase.update(simDt, tNow, dt); // v0.40 (streams + draws even while paused; v0.45: simDt + real dt for the finisher)
    if (!(this.state === 'world' && (this.worldChase.paused || this.menus.open))) this.locomotion.update(simDt, tNow); // a paused world chase freezes the swing (v0.45: simDt)
    this.windFx?.update(simDt); // v0.23 wind streaks + sound while swinging fast
    this.speedFx?.update(simDt); // v0.45 rope tension, near-miss whoosh, hand flash (World Chase)
    if (this.coins) { // v0.23 chase coins (the counter stays in the HUD for the rest of the story)
      const inChase = ((this.state === 'story' && ['chase', 'endless'].includes(this.story?.stage)) || (this.state === 'world' && this.worldChase.active)) && this.coins.active;
      const collecting = !(this.state === 'world' && !this.worldChase.running); // v0.41: no pickups after the run is resolved
      this.coins.root.visible = inChase;
      if (inChase && collecting && !this.story.paused && !(this.state === 'world' && (this.worldChase.paused || this.menus.open))) this.coins.update(simDt, tNow);
    }
    this.fx.update(simDt, this.camera); // v0.45: simDt (coins, wind, fx)
    this.hud.update(dt, this.camera, tNow);
    this._updateMinimap();
    this.sky.update(tNow);
    this.room.update(tNow);
    if (this.worldName === 'city') {
      const inCity = this.locomotion.mode === 'city';
      this.bench?.update(); // v0.25 dev: scripted city test route (moves the rig before the city streams)
      const focus = this._streamFocus || (inCity ? this.locomotion.feet(_v) : this.camera.getWorldPosition(_v));
      this.city.update(dt, focus, this.bench?.active ? this.bench.vel : inCity ? this.locomotion.vel : null);
      this._bossDetail();
      this._roomCityCull();
    } else if (this.worldName === 'world') this._bossDetail();
    this._cityAmbience(); // (stops itself outside the city: factory interior, arcade, title)
    this.voice?.update(dt);
    this._updatePerf(dt);
    this._updateMirror(tNow);
    this._updateDamageFlash(dt);
    if (this.state === 'title') this._animateTitle(tNow);
  }

  /**
   * Inside Mobius's room the city is only seen through the one window (directly or in the mirror). When neither
   * the head's view cone nor the mirror can show the window, the whole city (blocks, details, backdrop, skyline)
   * is not drawn — streaming / collisions are untouched, so turning back never pops anything in.
   */
  _roomCityCull() {
    const c = this.city; if (c.suspended) return;
    const inRoom = this.state !== 'arcade' && this.state !== 'results' && (this.state !== 'story' || this.story.inRoom);
    const head = this.camera.getWorldPosition(_cv[0]), A = KEY_BUILDINGS[0], o = ROOM.origin;
    const inside = inRoom && Math.abs(head.x - A.x) < A.w / 2 - 0.2 && Math.abs(head.z - A.z) < A.d / 2 - 0.2 && head.y > o[1] - 0.5 && head.y < o[1] + 4;
    let main = true, mirror = true;
    c.kit?.setLite?.(inside); // v0.30 room-lite (fewer kit draw calls through the window)
    if (inside) {
      const W = ROOM.window, fwd = _cv[1].set(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(_cq));
      const sees = (p, r) => { const d = _cv[2].copy(p).sub(head), L = d.length() || 1; return Math.acos(THREE.MathUtils.clamp(fwd.dot(d) / L, -1, 1)) < ROOM_CULL.halfAngle + Math.atan(r / L); };
      const win = _cv[3].set(...roomToWorld([(W.xMin + W.xMax) / 2, (W.yMin + W.yMax) / 2, W.z]));
      const winR = Math.hypot((W.xMax - W.xMin) / 2, (W.yMax - W.yMin) / 2);
      // 9 sample points on the window (corners, edge midpoints, centre) against the view cone (+ half the sample spacing)
      main = false;
      for (const fx of [0, 0.5, 1]) for (const fy of [0, 0.5, 1]) if (!main) main = sees(_cv[6].set(...roomToWorld([W.xMin + (W.xMax - W.xMin) * fx, W.yMin + (W.yMax - W.yMin) * fy, W.z])), ROOM_CULL.sampleR);
      mirror = false;
      const M = this.room.parts.mirror;
      if (M) { // the window can show in the mirror: virtual eye = head reflected across the mirror plane
        const mp = M.root.getWorldPosition(_cv[4]), n = _cv[5].set(0, 0, 1).applyQuaternion(M.root.getWorldQuaternion(_cq)), mr = Math.hypot(M.width, M.height) / 2;
        if (_cv[2].copy(win).sub(mp).dot(n) > 0) {
          const hm = _cv[1].copy(head).addScaledVector(n, -2 * _cv[2].copy(head).sub(mp).dot(n));
          const toM = _cv[2].copy(mp).sub(hm), toW = _cv[6].copy(win).sub(hm);
          mirror = toM.angleTo(toW) < Math.atan(mr / toM.length()) + Math.atan(winR / toW.length());
        }
      }
    }
    this._cityShow = { main, mirror };
    c.root.visible = main;
    this.roomCityHidden = !main;
  }
  /** v0.25 bench: the fixed room viewpoint (head at the player start, facing the window). */
  benchRoomPose() { const p = roomToWorld(ROOM.playerStart.pos); return { pos: new THREE.Vector3(p[0], p[1] + 1.6, p[2]), yaw: ROOM.playerStart.yaw }; }
  /** v0.25: keep / download a perf report. Inside a headset session the download waits until the session ends. */
  savePerfReport(rep) {
    if (this.xrActive) { this._pendingReport = rep; try { localStorage.setItem('mobius.perf.last', JSON.stringify(rep)); } catch { /* ignore */ } console.log('[perf-report] saved (download after leaving VR)'); this.hud.flashMessage?.('perf report saved'); return; }
    saveReport(rep);
  }
  /** v0.25: export the rolling perf window (dev menu). */
  exportPerf() {
    const fd = this.worldName === 'world' ? this.worldChase.renderer?.extras?.stats : null;
    const detailKey = this.worldChase.mapId === 'redrock' ? 'redrock' : 'forest';
    const rep = this.probe.report({ memory: this.probe.memoryEstimate(this.scene, [{ name: 'mirror', rt: this.mirror?.rt }]), quality: this.city.quality, city: { ...this.city.stats }, world: { ...this.cityWorld.stats }, pools: Object.fromEntries(Object.entries(this.city.details).map(([k, v]) => [k, `${v.used}/${v.cap}`])), state: this.state, stage: this.story?.stage, ...(fd ? { [detailKey]: { ...fd, byPool: undefined, map: this.worldChase.mapId, renderer: { ...this.worldChase.renderer.stats } } } : {}) });
    rep.name = `rolling-${this.state}`;
    this.savePerfReport(rep);
    return rep;
  }
  afterBench(restore) {
    if (restore?.state === 'story' || restore?.state === 'arcade') return;
    this.enterRoom();
    this.menus.show('mode');
  }
  /** v0.27 city ambience level: loud on the street, fading with height, muffled in the room, off in menus' title. */
  _cityAmbience() {
    const on = settings.cityAmbience !== false && this.worldName === 'city' && this.state !== 'title' && this.state !== 'arcade' && this.state !== 'results' && audio.ctx;
    if (!on) { if (this._amb) { this._amb.stop(); this._amb = null; } return; }
    if (!this._amb) { this._amb = audio.startCityAmbience(); this._ambLv = -1; }
    if (!this._amb) return;
    const y = this.camera.getWorldPosition(_v).y, inRoom = this.state !== 'story' || this.story.inRoom;
    const lv = inRoom ? 0.12 : 0.25 + 0.75 * Math.max(0, 1 - y / 110);
    if (Math.abs(lv - (this._ambLv ?? -1)) > 0.01) { this._ambLv = lv; this._amb.setLevel(lv); } // (not every frame: each call queues audio-param events)
  }
  /** Boss level of detail in the city: the HD set close by (< 30 m), the light set further away. */
  _bossDetail() {
    if (!this.bossHD || !this.boss.root.visible) return;
    const d = this.boss.root.position.distanceTo(this.camera.getWorldPosition(_v));
    if (this.boss.detail !== 'hd' && d < 30) this.boss.setDetail('hd', this.bossHD);
    else if (this.boss.detail === 'hd' && d > 40) this.boss.setDetail('sd');
  }
  /** Origin rebase (endless city, float precision): shift everything that lives in world space. */
  _onRebase(dx, dz) {
    this.locomotion.shift(dx, dz);
    const b = this.boss.root; b.position.x += dx; b.position.z += dz;
    this.coins?.shift(dx, dz);
    if (!this.boss.riding) { const m = this.boss.maniac.root; m.position.x += dx; m.position.z += dz; }
    this.fx.shift?.(dx, dz); this.shield?.shift(dx, dz);
    if (this._streamFocus) { this._streamFocus.x += dx; this._streamFocus.z += dz; }
    this._mapAt = null;
  }
  /** New story run: the city goes back to the fixed story route around the home block. */
  resetCityForStory() {
    const w = this.cityWorld;
    if (w.mode === 'story' && !w.oi && !w.oj && w.route.length <= 12) return;
    w.reset({ mode: 'story' });
    this.city.factory?.setDoorState?.('closed');
    this.city.setFocus(new THREE.Vector3(...roomToWorld(ROOM.playerStart.pos)));
  }
  _updatePerf(dt) {
    const P = this.perf; P.acc += dt; P.n++;
    const info = this.renderer.info.render; P.calls = info.calls; P.tris = info.triangles;
    if (P.acc >= (settings.devFanDebug ? 0.1 : 0.5)) {
      P.ms = (P.acc / P.n) * 1000; P.fps = P.n / P.acc; P.acc = 0; P.n = 0;
      const lines = settings.devTools ? [...(settings.devPerf ? this.devStats() : []), ...(settings.devFanDebug ? this.fanDebugLines() : [])] : [];
      this.hud.setDevStats(lines.length ? lines : null);
    }
  }
  /** Dev: Fan Web gesture state (open / fist / palm-up / upright / contact) for Quest 3 reports. */
  fanDebugLines() {
    const F = this.hub.fan, e = F?.debug?.eval, p = F?.debug?.pair, f = (x, d = 0) => (x === undefined ? '-' : x.toFixed(d));
    if (!e) return [`FAN ${F?.debug?.state || 'off'} (needs both hands tracked, arcade)`];
    return [
      `FAN ${F.debug.state}  open ${p?.open} / fist ${p?.fist}  armed ${F.armed ? 'Y' : 'n'}  engaged ${F.engaged ? 'Y' : 'n'}  fired ${this.arcade.fanStats?.fired ?? 0}`,
      `open ${e.open ? 'OK' : 'no'}  fist ${e.fist ? 'OK' : 'no'}  palmUp ${f(e.palmUpDeg)}°  upright ${f(e.uprightDeg)}°  pitch ${f(e.pitchDeg)}°  valid ${e.valid ? 'Y' : 'n'}`,
      `edge h ${f(e.height * 100, 1)} cm  lateral ${f(e.lateral * 100, 1)} cm  dist ${f(e.dist * 100, 1)} cm  contact ${e.contact ? 'Y' : 'n'}`,
    ];
  }
  devStats() {
    const P = this.perf, w = this.cityWorld.stats, c = this.city.stats, d = this.city.details;
    const pools = Object.entries(d).map(([k, v]) => `${k} ${v.used}/${v.cap}`).join('  ');
    const passes = this.probe ? this.probe.lastPasses() : [];
    const pm = passes.find((x) => x.pass === 'main'), rest = passes.filter((x) => x.pass !== 'main');
    const xr = this.renderer.xr.isPresenting, gpu = this.probe ? this.probe.gpuMs('main') : 'N/A';
    const q = this.city.quality || {}, qs = q.level === 'v0' ? 'v0 (original)' : `v1 ${CITY_Q_FEATURES.map((k) => (q[k] ? k : `-${k}`)).join(' ')}`;
    if (!this._memT || performance.now() - this._memT > 5000) { this._memT = performance.now(); this._mem = this.probe?.memoryEstimate(this.scene, [{ name: 'mirror', rt: this.mirror?.rt }]); }
    const M = this._mem;
    const XI = xrInfo(this.renderer);
    return [
      ...(this.bench?.lines || []),
      XI.presenting ? `XR ${XI.layer} ${XI.width}×${XI.height}${XI.views > 1 ? '×2 views' : ''}  multiview ${XI.multiview ? 'ON' : 'off'} (${XI.multiviewSetting})  MSAA ${XI.samples ?? '?'}  fov ${XI.foveationSet}→${XI.foveationLayer ?? '?'}  scale ${XI.renderScale}  RT≈${xrTargetMiB(XI)} MiB` : `XR not presenting  (multiview ${XI.multiviewSetting}, scale ${XI.renderScale}, foveation ${XI.foveationSet} at the next VR entry)`,
      `FPS ${P.fps.toFixed(0)}  frame ${P.ms.toFixed(1)} ms  main ${pm ? pm.calls : P.calls} calls ${((pm ? pm.tris : P.tris) / 1000).toFixed(0)}k tris${xr ? (XI.multiview ? ' (multiview: each call draws both eyes)' : ` (both eyes; per eye ≈ ${Math.round((pm ? pm.calls : P.calls) / 2)} / ${Math.round((pm ? pm.tris : P.tris) / 2000)}k)`) : ''}  GPU ${typeof gpu === 'number' ? gpu.toFixed(2) + ' ms' : gpu}`,
      `other passes: ${rest.length ? rest.map((x) => `${x.pass} ${x.calls}/${(x.tris / 1000).toFixed(0)}k`).join('  ') : 'none'}   city look ${qs}`,
      M ? `tex ≈ ${M.texturesMiB} MiB (${M.textureCount})  RT ${M.renderTargetsMiB} MiB${M.xrFramebuffer ? `  XR fb ${M.xrFramebuffer.w}×${M.xrFramebuffer.h} ≈ ${M.xrFramebuffer.MiB} MiB` : ''}  heap ${performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + ' MiB' : 'N/A'}` : '',
      ...(this.worldName === 'world' && this.worldChase.renderer?.extras?.stats?.requested ? [forestLine(this.worldChase.renderer.extras.stats, this.worldChase.mapId)] : []),
      `modules ${w.cells} (route ${w.route} side ${w.filler} cand ${w.cand})  anchors ${w.anchors}  colliders ${w.colliders}`,
      `cell pool ${c.cellsUsed}/${c.cellsCap}  inst ${c.instances}  detail cells ${c.detailCells}  backdrop ${c.backdrop}  queue ${c.queue}`,
      `create ${w.createMs.toFixed(2)}/${w.maxCreateMs.toFixed(1)} ms  build ${c.buildMs.toFixed(2)}/${c.maxBuildMs.toFixed(1)} ms  recycle ${w.recycleMs.toFixed(2)}/${w.maxRecycleMs.toFixed(1)} ms`,
      `tile ${this.cityWorld.curTile} ahead ${this.cityWorld.aheadTiles}  created ${w.created} recycled ${w.recycled}  rebases ${w.rebases}`,
      pools,
    ];
  }

  // =================================================================== states
  go(state, opts = {}) {
    if ((this.worldName === 'world' || this.state === 'world') && state !== 'world') { this.leaveWorld(() => this.go(state, opts)); return; } // v0.40
    if (this.worldName !== 'city' && state !== 'arcade' && state !== 'results') {
      // leaving the factory interior (main menu, mode select, title…): unload it and rebuild the city first
      this.storyArcade = false; this.arcade.stop(); this.story.stop(); this.boss.setVisible(false); this.menus.hide(); this.hud.setMode('off');
      this.leaveFactory(() => this.go(state, opts), { focus: roomToWorld(ROOM.playerStart.pos) });
      return;
    }
    const prev = this.state;
    if (this.storyArcade && state !== 'arcade') { this.storyArcade = false; this._resetArena(); this.story.stop(); } // left the story showdown
    this.state = state;
    this.menus.hide();
    if (prev === 'story' && state !== 'story') this.story.stop();
    if (state !== 'arcade' && state !== 'results') { this.arcade.stop(); this.boss.setVisible(false); }
    switch (state) {
      case 'modeSelect':
        this.hud.setMode('off'); this.locomotion.off();
        this.resetCityForStory();
        this.setArmored(true);
        this.enterRoom();
        audio.startRoomMusic();
        this.menus.show('mode');
        break;
      case 'songSelect':
        audio.startRoomMusic();
        if (prev !== 'calibrate' && prev !== 'modeSelect') this.enterRoom();
        listSongs().then((songs) => { if (this.state === 'songSelect') this.menus.show('select', { songs }); });
        break;
      case 'calibrate':
        this.menus.show('calib'); this.calibration.start();
        break;
      case 'story':
        audio.stopRoomMusic();
        this.story.start(opts);
        break;
      default: break;
    }
  }
  enterRoom() {
    const p = ROOM.playerStart.pos;
    this.locomotion.placeAt(new THREE.Vector3(...roomToWorld(p)), ROOM.playerStart.yaw);
    this.locomotion.setRoomMode();
  }
  setArmored(on) { for (const h of ['left', 'right']) this.hands[h].setArmored(on); }

  /**
   * @param {object} [opts] { story: true } = the story-mode showdown on Rooftop C (started from the
   * blue circle; uses the player's current spot and facing as the arena). Omitted → keep the current mode
   * (so Retry / Restart stay inside the story).
   */
  async startArcade(opts = {}) {
    if (opts.story !== undefined) this.storyArcade = !!opts.story;
    if (!this.storyArcade && this.worldName !== 'factory') {
      // v0.14: Arcade Mode is played inside the abandoned factory too (black Loading screen first)
      this.menus.hide(); audio.stopRoomMusic(); this.hud.setMode('off'); this.state = 'loading';
      this.loadFactoryWorld(() => { this.story.fadeTo(0, 2); this.startArcade(opts); });
      return;
    }
    this.menus.hide();
    audio.stopRoomMusic();
    this.state = 'arcade';
    if (this.storyArcade && opts.story && opts.arena) {
      // factory interior: arena = the PLAYER START circle, facing the far-north boss hover zone
      this.arenaOrigin.copy(opts.arena.origin); this.arenaForward.copy(opts.arena.forward); this.bossHome.copy(opts.arena.bossHome);
    } else if (this.storyArcade && opts.story) {
      // arena = where the player stands (inside the blue circle), facing the way they already face
      const feet = this.locomotion.feet();
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(_q)); f.y = 0;
      if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
      this.arenaOrigin.copy(feet); this.arenaForward.copy(f.normalize());
      this.bossHome.copy(feet).addScaledVector(this.arenaForward, 15).add(new THREE.Vector3(0, 5.5, 0));
    } else if (!this.storyArcade) this._resetArena();
    this.locomotion.off();
    if (this.storyArcade) this.locomotion.placeAt(this.arenaOrigin, null); // keep facing (no forced turn)
    else this.locomotion.placeAt(this.arenaOrigin, Math.atan2(-this.arenaForward.x, -this.arenaForward.z)); // face the boss zone
    this.hud.setMode('arcade');
    this.hud.showBanner(t('title.status.loading'), 120); // (v1.1: a 2½-minute song can take a while to decode; the song's start replaces it)
    this.boss.setVisible(true);
    try {
      const song = await loadSong(this.storyArcade ? 'mobius-boss-01' : settings.songId).catch(async (e) => {
        if (settings.songId !== 'mobius-boss-01' && e.code === 'reselect') throw e;
        if (settings.songId !== 'mobius-boss-01') { settings.songId = 'mobius-boss-01'; return loadSong('mobius-boss-01'); }
        throw e;
      });
      if (this.state !== 'arcade') return;
      this.currentSong = song;
      this.arcade.start({ song, chart: song.chart, difficulty: settings.difficulty });
    } catch (e) {
      console.error(e);
      const msg = e.code === 'reselect' ? t('import.reselect', { name: e.title || settings.songId }) : e.code === 'chart' ? t('err.chartLoad', { msg: e.message }) : t('err.audioLoad', { msg: e.message });
      this.hud.hideBanner();
      this.menus.showMessage(() => t('err.generic', { msg: '' }), () => msg, [{ label: () => t('select.back'), onClick: () => this.go('songSelect') }]);
    }
  }
  onArcadeFinished(result) {
    const prevBest = getBest(result.songId, result.difficulty);
    const newBest = !result.failed && (!prevBest || result.score > prevBest.score);
    if (newBest) setBest(result.songId, result.difficulty, { score: result.score, rank: result.rank, acc: result.accuracy, at: Date.now() });
    this.state = 'results';
    this.lastResult = result;
    this.hud.setMode('off'); this.fx.clear(); // results panel alone (HUD panels drew on top of it)
    this.menus.show('results', { result, newBest, songTitle: this.currentSong?.title, story: !!this.storyArcade,
      storyNextAt: this.storyArcade && !result.failed ? performance.now() / 1000 + 60 : 0 });
  }
  /** Story showdown won → "Next" (or the 60 s countdown) → Green Maniac escapes through the roll-up door. */
  storyArcadeNext() {
    if (!this.storyArcade) return;
    this.arcade.stop(); this.storyArcade = false; this._resetArena();
    this.menus.hide(); this.hud.hideBanner();
    this.state = 'story'; this.hud.setMode('story');
    this.story.enterStage(this.worldName === 'factory' ? 'escape' : 'endless');
  }
  /** Escape done (player at the broken door): black screen → Dala City outside the door → endless swinging. */
  exitFactoryToCity() {
    this.cityWorld.mode = 'endless';
    this.leaveFactory(() => { this.state = 'story'; this.hud.setMode('story'); this.story.enterStage('endless'); }, { focus: STORY.exitSpawn.pos, keepStory: true });
  }
  /** Story boss battle Retry: the interior checkpoint (no city reload, no re-chase, no re-blast). */
  storyBossRetry() {
    if (this.worldName === 'factory') { this.storyArcade = false; this._resetArena(); this.story.flow.retryBoss(); }
    else this.startArcade();
  }

  // =================================================================== World Chase (v0.40)
  /**
   * Load a world (map id) behind the black Loading screen and start its endless chase. Works from anywhere: the
   * room / main menu, a story or arcade, the factory, or another world (map switch: the old one is disposed first).
   */
  startWorld(mapId) {
    const map = mapById(mapId); if (!map) return;
    if (this._loadJob) return;
    this.menus.hide(); this.hud.hideBanner(); this.storyArcade = false;
    this.state = 'loading';
    this.loader.show('world.loading', { name: map.name[getLang()] || map.name.en });
    this.story.fadeTo(1, 10);
    this._worldPending = mapId;
    this._loadJob = { kind: 'world', gen: this.worldChase.steps(mapId) };
  }
  /** Leave the active world → Dala City (streamed behind the black screen) → then(). */
  leaveWorld(then) {
    if (this.worldName !== 'world' && !this.worldChase.renderer) { this.state = this.state === 'world' ? 'loading' : this.state; then(); return; }
    this.worldChase.teardown();
    this.menus.hide(); this.hud.setMode('off'); this.locomotion.off(); this.fx.clear(); this.boss.setVisible(false);
    this.state = 'loading';
    this.story.fadeTo(1, 10); this.loader.show('loading.city');
    this.worldName = 'loading';
    this.cityWorld.reset({ mode: 'story' });
    const focus = roomToWorld(ROOM.playerStart.pos);
    this._cityThen = then; this._cityFocus = focus;
    this._loadJob = { kind: 'city', gen: this._citySteps(then, focus) };
  }

  // =================================================================== worlds
  /** Black Loading screen → unload the city → load + set up the factory interior → fade in. */
  loadFactoryWorld(onReady = null) {
    if (this._loadJob) return;
    this._factoryOnReady = onReady || (() => this.story.enterStage('factory'));
    this.loader.show('loading.factory');
    this.story.fadeTo(1, 10);
    this._loadJob = { kind: 'factory', gen: this._factorySteps() };
  }
  *_factorySteps() {
    const story = this.story;
    // 1) stop the chase, bombs, city audio
    story.chaseCtl.stop(); story.flow.stopAudio(); for (const b of story.bombs) story._freeBomb(b);
    audio.stopRoomMusic(); this.fx.clear(); this.locomotion.off(); this.boss.setVisible(false); this.hud.setMode('off');
    story.allowAttack = false; story.allowLocomotion = false;
    yield 'stop';
    // 2) remove city objects, collisions, anchors, listeners and updates  3) free city-only resources
    this.worldName = 'loading';
    this.city.suspend(); // disposes all streamed chunk geometry; city.update() becomes a no-op
    this.room.root.visible = false; this.skyGroup.visible = false; story.chaseCtl.root.visible = false; story.flow.smoke.clear(); story.flow.sparks.clear();
    this.locomotion.markerAnchors = []; this.locomotion.anchorMesh.count = 0; this.cityWorld.pin('boss', null);
    this._cityLights = { sun: this.lights.sun.intensity, hemi: this.lights.hemi.intensity };
    this.lights.sun.intensity = 0; this.lights.hemi.intensity = 0;
    yield 'unloaded';
    // 4) load the interior scene (time-sliced) + the boss song
    if (this.debug.failInteriorLoad > 0) { this.debug.failInteriorLoad--; throw new Error('simulated interior load failure'); }
    const interior = createFactoryInterior();
    this._pendingInterior = interior;
    this.scene.add(interior.root);
    for (const s of interior.build()) yield s;
    let song = null, err = null;
    loadSong('mobius-boss-01').then((x) => { song = x; }, (e) => { err = e; });
    while (!song && !err) yield 'wait';
    if (err) throw err;
    for (let i = 0; this._bossHDState === 'loading' && i < 900; i++) yield 'wait'; // ≤ ~15 s, then SD is fine
    this.boss.setDetail('hd', this.bossHD);
    // 5) collisions (interior floor surface), lights, fog, enemy, spawn
    interior.activate(this.scene, this.renderer, this.camera);
    this.boss.root.position.copy(interior.toWorld(...INTERIOR.bossHover)); this.boss.setVisible(true); // compile the boss with the interior lights too
    try { this.renderer.compile(this.scene, this.camera); } catch (e) { console.warn('compile', e); } // shaders ready before the fade-in
    yield 'compiled';
    // 6) confirm ready, then fade in (the story sets the spawn, the boss and the arrival)
    if (!interior.ready) throw new Error('interior not ready');
    this.boss.setVisible(false);
    this.interior = interior; this._pendingInterior = null; this.worldName = 'factory';
    this.loader.hide();
    this._factoryOnReady?.();
  }
  _runLoadJob() {
    const job = this._loadJob; if (!job) return;
    const t0 = performance.now();
    try {
      while (performance.now() - t0 < 6) {
        const r = job.gen.next();
        if (r.done) { if (this._loadJob === job) this._loadJob = null; break; }
        if (r.value === 'wait') break;
      }
    } catch (e) {
      console.error('load failed', e);
      if (this._loadJob === job) this._loadJob = null;
      this._loadFailed(job.kind, e);
    }
  }
  _loadFailed(kind) {
    if (kind === 'world') { // v0.40
      this.worldChase.teardown();
      this.loader.showError('loading.error.world', { onRetry: () => { this.loader.hide(); this.worldName = this.city.suspended ? 'loading' : this.worldName; this.startWorld(this._worldPending); }, onMain: () => { this.loader.hide(); this.worldName = 'world'; this.leaveWorld(() => { this.state = 'loading'; this.go('modeSelect'); this.story.fadeTo(0, 2); }); } });
      return;
    }
    // partial interior cleanup; never a permanent black screen: Retry / Main Menu
    if (this._pendingInterior) { this._pendingInterior.deactivate(this.scene, this.renderer); this._pendingInterior.dispose(); this._pendingInterior = null; }
    this.loader.showError(kind === 'factory' ? 'loading.error.factory' : 'loading.error.city', {
      onRetry: () => { if (kind === 'factory') { this.loader.show('loading.factory'); this._loadJob = { kind, gen: this._factorySteps() }; } else { this.loader.show('loading.city'); this._loadJob = { kind, gen: this._citySteps(this._cityThen, this._cityFocus) }; } },
      onMain: () => { this.loader.hide(); this._restoreCitySync(); this.state = 'loading'; this.go('modeSelect'); this.story.fadeTo(0, 2); },
    });
  }
  /** Back to the ring city (black Loading screen while the chunks around `focus` stream in). */
  leaveFactory(then, { focus = null, keepStory = false } = {}) {
    if (this.worldName === 'city') { then(); return; }
    if (!keepStory) this.story.stop();
    this.state = 'loading';
    this.story.fadeTo(1, 10); this.loader.show('loading.city');
    this.locomotion.off(); this.fx.clear(); this.story.flow.stopAudio(); this.story.flow.arena.visible = false;
    this._cityThen = then; this._cityFocus = focus;
    this._loadJob = { kind: 'city', gen: this._citySteps(then, focus) };
  }
  *_citySteps(then, focus) {
    this._disposeInterior();
    yield 'interior-freed';
    this._restoreCityWorld();
    const f = new THREE.Vector3(...(focus || [0, 0, 0]));
    this._streamFocus = f; // the per-frame streaming must not fight over a different spot
    this.city.stream(f, 8);
    for (let i = 0; i < 900 && this.city.pendingNear(f) > 0; i++) { this.city.stream(f, 8); yield 'wait'; } // the visible surroundings first (behind the black screen)
    this._streamFocus = null;
    this.loader.hide();
    then();
    this.story.fadeTo(0, 2.5);
  }
  _disposeInterior() {
    for (const it of [this.interior, this._pendingInterior]) if (it) { it.deactivate(this.scene, this.renderer); it.dispose(); }
    this.interior = null; this._pendingInterior = null;
  }
  _restoreCityWorld() {
    if (this._cityLights) { this.lights.sun.intensity = this._cityLights.sun; this.lights.hemi.intensity = this._cityLights.hemi; this._cityLights = null; }
    this.skyGroup.visible = true; this.room.root.visible = true; this.story.chaseCtl.root.visible = true; this.boss.resetScale(); this.boss.setDetail('sd');
    this.city.resume(); this.worldName = 'city';
  }
  /** Immediate restore (XR session ended / error → main menu): no streaming wait. */
  _restoreCitySync() {
    this._loadJob = null; this.loader.hide(); this._streamFocus = null;
    if (this.worldChase?.teardown()) { this.worldName = 'loading'; } // v0.40: drop an active world
    if (this.worldName === 'city' && !this.city.suspended) return;
    this._disposeInterior(); this._restoreCityWorld();
    this.cityWorld.reset({ mode: 'story' });
    this.city.setFocus(new THREE.Vector3(...roomToWorld(ROOM.playerStart.pos)));
  }
  /** Factory arena (arcade + story battle): the PLAYER START circle, facing the roll-up door;
   *  Green Maniac hovers settings.arcadeBossDistance ahead (15–18 m), in front of the door. */
  factoryArena() {
    const F = INTERIOR, origin = this.interior.toWorld(...F.arenaCircle.pos);
    const forward = this.interior.toWorld(...F.bossHover).sub(origin).setY(0).normalize();
    const bossHome = origin.clone().addScaledVector(forward, settings.arcadeBossDistance + LANE_TUNE.bossBack); bossHome.y = origin.y + settings.arcadeBossHeight;
    return { origin, forward, bossHome };
  }
  _resetArena() {
    if (this.worldName === 'factory' && this.interior) { const a = this.factoryArena(); this.arenaOrigin.copy(a.origin); this.arenaForward.copy(a.forward); this.bossHome.copy(a.bossHome); return; }
    this.arenaOrigin.set(...ARCADE.playerPos); this.arenaForward.set(...ARCADE.forward); this.bossHome.set(...ARCADE.bossHome);
  }

  // =================================================================== menu
  toggleMenu() {
    if (this.state === 'title' || this.state === 'loading' || this.loader.visible) return; // the loader owns the screen (Retry / Main Menu on error)
    if (this.menus.current === 'pause' || this.menus.current === 'settings' && this.menus.ctx.back === 'pause') { this.menuResume(); return; }
    if (this.state === 'world') { // v0.40
      if (this.worldChase.state && !this.worldChase.run.running) return; // v0.41: resolved run — the results panel owns the screen
      if (this.menus.current === 'worldPause' || (this.menus.current === 'settings' && this.menus.ctx.back === 'worldPause') || (this.menus.current === 'worldMaps' && this.menus.ctx.from === 'pause')) { this.menuResume(); return; }
      if (this.menus.open) return;
      this.worldChase.pause(); this.menus.show('worldPause'); return;
    }
    if (this.menus.open) return; // other menus (select/results) are already UI states
    if (this.state === 'arcade') this.arcade.pause();
    if (this.state === 'story') this.story.pause();
    this.menus.show('pause');
  }
  menuResume() {
    this.menus.hide();
    if (this.state === 'arcade') { if (this.arcade.state === 'paused') { this.hud.hideBanner(); this.arcade.resume(); } }
    if (this.state === 'story') this.story.resume();
    if (this.state === 'world') this.worldChase.resume();
  }
  menuStayPaused() { this.menus.hide(); if (this.state === 'arcade' && this.arcade.state === 'paused') this.hud.showBanner(t('hud.paused'), 9999); }
  menuRestart() {
    this.menus.hide();
    if ((this.state === 'arcade' || this.state === 'results') && this.storyArcade && this.worldName === 'factory') this.storyBossRetry();
    else if (this.state === 'arcade' || this.state === 'results') this.startArcade();
    else if (this.state === 'story') this.story.restartStage();
    else if (this.state === 'world') this.worldChase.restart();
  }
  menuMain() { this.hud.hideBanner(); this.go('modeSelect'); }
  autoPause(reason) {
    if (this.loader.visible || this.state === 'loading') return; // loading keeps going; nothing to pause
    if (this.state === 'arcade' && this.arcade.state === 'playing') { this.arcade.pause(); if (!this.menus.open) this.menus.show('pause'); console.info('auto-pause', reason); }
    if (this.state === 'story' && !this.menus.open) { this.story.pause(); this.menus.show('pause'); }
    if (this.state === 'world' && !this.menus.open && this.worldChase.running) { this.worldChase.pause(); this.menus.show('worldPause'); }
  }
  recenter() {
    const target = this.state === 'arcade' || this.state === 'results' ? this.arenaOrigin : this.locomotion.feet();
    this.locomotion.placeAt(target, (this.state === 'arcade' || this.state === 'results') && !this.storyArcade ? ARCADE.playerYaw : this.world.player.rotation.y);
    this.menus.placeInFront(this.menus.panels[this.menus.current || 'pause']);
  }
  applySeated() { if (this.state === 'arcade' || this.state === 'results') this.recenter(); }
  eyeHeight() { const y = this.camera.position.y; return (this.xrActive && y > 0.7 ? y : 1.6) + (settings.seated ? settings.seatedOffset : 0); }
  tutorialLines(kind) {
    const k = this.hub.inputKind;
    const wave = settings.arcadeArmored !== false;
    if (k === 'controllers') return kind === 'arcade' ? [t('tut.ctrl.web'), t('tut.ctrl.bomb'), t('tut.ctrl.fan'), ...(wave ? [t('tut.ctrl.wave')] : []), t('tut.ctrl.menu')] : [t('tut.ctrl.web'), t('tut.ctrl.bomb'), t('tut.ctrl.menu')];
    if (k === 'desktop') return ['Desktop: click / E = right web, Q = left web, hold & release Space = light bomb, V = Fan Web, C = energy wave, Esc = menu'];
    return kind === 'arcade' ? [t('tut.web'), t('tut.bomb'), t('fan.tutorial'), ...(wave ? [t('wave.tutorial')] : []), t('tut.palm')] : [t('tut.web'), t('tut.palm')];
  }

  // =================================================================== XR
  enterXR() {
    audio.unlock();
    this.status('title.status.starting');
    try { this.world.launchXR(); } catch (e) { this.status('title.status.failed', { msg: e.message }, 'error'); }
  }
  enterDesktop() {
    audio.unlock();
    this.desktop = true;
    this.title.hide();
    this.camera.position.set(0, 1.6, 0); this.camera.rotation.set(0, 0, 0);
    this.hub.desk.yaw = 0; this.hub.desk.pitch = -0.05;
    this.launchSelected();
  }
  /** After Enter VR Game (or the desktop preview): the mode menu in Mobius's room (v0.49: the website no longer picks a World Chase map; that is done inside VR). */
  launchSelected() {
    const id = launchMap(this.pendingMap);
    this.pendingMap = null;
    if (id) this.startWorld(id); else this.go('modeSelect');
  }
  exitXR() {
    if (this.xrActive) this.world.exitXR();
    else { this.desktop = false; this.go('title-reset'); this.setTitleView(); this.title.show(); }
  }
  _onSessionStart() {
    this.xrActive = true; this.title.hide();
    this.xrTune.applyFov(); // fixed foveation from settings (default 1.0 = max: big fill-rate saving on Quest)
    this.camera.position.set(0, 0, 0);
    audio.unlock();
    this.launchSelected();
  }
  /**
   * v0.41 results "Back to Home": the home page = the title / main menu with the map selector (never the story
   * bedroom). In a headset this ends the XR session the way the app's Exit does (the session-end handler tears the
   * world down and shows the title); on the desktop preview the same cleanup runs directly. Nothing restarts.
   */
  returnHome() {
    this.worldChase.run.returning?.();
    this.menus.hide(); this.hud.hideBanner();
    if (this.xrActive) { try { this.world.exitXR(); } catch (e) { console.warn('exitXR', e); this._toTitle(); } return; }
    this.desktop = false; this._toTitle();
  }
  _toTitle() {
    this.bench?.cancel();
    this.storyArcade = false;
    this.arcade.stop(); this.story.stop(); this.menus.hide(); this.hud.setMode('off'); this.locomotion.off();
    this._restoreCitySync(); // drop the world / interior and bring the city back for the title view
    audio.stopRoomMusic();
    this.state = 'title'; this.setTitleView(); this.title.show();
  }
  _onSessionEnd() {
    this.xrActive = false;
    this.bench?.cancel();
    if (this._pendingReport) { const r = this._pendingReport; this._pendingReport = null; setTimeout(() => saveReport(r), 500); }
    this.storyArcade = false;
    this.arcade.stop(); this.story.stop(); this.menus.hide(); this.hud.setMode('off'); this.locomotion.off();
    this._restoreCitySync(); // drop the interior (if any) and bring the city back for the title view
    audio.stopRoomMusic();
    this.state = 'title'; this.setTitleView(); this.title.show(); this.status('title.status.ended');
  }

  // =================================================================== title
  setTitleView() {
    this.state = 'title';
    const rig = this.world.player; rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); rig.updateMatrixWorld(true);
    const p = roomToWorld(ROOM.titleCamera.pos), l = roomToWorld(ROOM.titleCamera.lookAt);
    this._titleCam = { p: new THREE.Vector3(...p), l: new THREE.Vector3(...l) };
    this.camera.position.copy(this._titleCam.p); this.camera.lookAt(this._titleCam.l);
    for (const h of ['left', 'right']) this.hands[h].setVisible(false);
    this.hud.setMode('off');
  }
  _animateTitle(t) {
    if (this.xrActive) return;
    const c = this._titleCam;
    this.camera.position.set(c.p.x + Math.sin(t * 0.13) * 0.06, c.p.y + Math.sin(t * 0.21) * 0.02, c.p.z);
    this.camera.lookAt(c.l.x + Math.sin(t * 0.1) * 0.15, c.l.y, c.l.z);
  }

  // =================================================================== hands
  _updateHands() {
    const hub = this.hub, w = this.world;
    for (const h of ['left', 'right']) {
      const hand = this.hands[h];
      if (this.state === 'title' || !this.xrActive) { hand.setVisible(false); continue; }
      if (hub.mode[h] === 'hand' && hub.features[h].tracked) {
        hand.setVisible(true); hand.setJoints(hub.features[h].pos, hub.features[h].quat);
      } else if (hub.mode[h] === 'controller') {
        const gs = w.player.gripSpaces[h]; gs.updateMatrix();
        const gp = w.input.xr.gamepads[h];
        hand.setVisible(true); hand.setControllerPose(gs.matrix, gp ? gp.getButtonValueByIdx(1) : 0, gp ? gp.getButtonValueByIdx(0) : 0);
      } else hand.setVisible(false);
    }
    // palm button visual
    const pb = hub.palmButton, vis = this.palmBtn;
    vis.visible = pb.visible && this.state !== 'title' && this.xrActive;
    if (vis.visible) {
      vis.position.copy(pb.center); vis.lookAt(_v.copy(pb.center).add(pb.normal));
      vis.material.color.setHSL(0.53, 1, 0.5 + 0.3 * pb.hover);
      vis.scale.setScalar(1 + 0.25 * pb.hover);
    }
    // v3 Mobius mirror body: posed every frame from the same hand input as the gloves
    if (this.avatar) {
      this.avatar.update({ head: { position: this.camera.getWorldPosition(_hv), quaternion: this.camera.getWorldQuaternion(_hq) }, player: w.player, floorY: w.player.position.y });
    }
  }
  _buildPalmButton() {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.02, 32), new THREE.MeshBasicMaterial({ color: 0x22d3ff, toneMapped: false, transparent: true, opacity: 0.95 }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.022, 0.027, 32), new THREE.MeshBasicMaterial({ color: 0xe8f7ff, toneMapped: false }));
    ring.position.z = 0.001; m.add(ring);
    m.visible = false; this.world.player.add(m); this.palmBtn = m;
  }

  // =================================================================== mirror
  _buildMirror() {
    const mir = this.room.parts.mirror;
    this.mirror = { ...mir, rt: new THREE.WebGLRenderTarget(384, 768, { samples: 0 }), cam: new THREE.PerspectiveCamera(), lastT: 0, active: true };
    this.mirror.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.mirror.cam.layers.enable(MIRROR_LAYER);
    mir.surface.material.map = this.mirror.rt.texture;
    mir.surface.material.map.wrapS = THREE.RepeatWrapping;
    mir.surface.material.map.repeat.x = -1; mir.surface.material.map.offset.x = 1; // mirror flip
    mir.surface.material.needsUpdate = true;
    if (this.avatar) { this.body = this.avatar; this.avatar.setBodyLayer(MIRROR_LAYER); return; } // (already in the scene)
    this.body = this.mobiusModel ? createMobiusModelBody(this.mobiusModel) : createMobiusBody();
    this.body.root.traverse((o) => o.layers.set(MIRROR_LAYER));
    this.scene.add(this.body.root);
  }
  _updateMirror(tNow) {
    const M = this.mirror;
    const inRoom = this.worldName === 'city' && this.state !== 'world' && this.state !== 'arcade' && this.state !== 'results' && (this.state !== 'story' || this.story.inRoom);
    if (!inRoom || tNow - M.lastT < 1 / 30) return;
    const head = this.camera.getWorldPosition(new THREE.Vector3());
    const C = M.root.getWorldPosition(new THREE.Vector3());
    const N = new THREE.Vector3(0, 0, 1).applyQuaternion(M.root.getWorldQuaternion(new THREE.Quaternion()));
    const dist = head.clone().sub(C).dot(N);
    if (dist < 0.05 || head.distanceTo(C) > 6) return; // behind mirror / far away
    M.lastT = tNow;
    // avatar pose (head + hands) — visible only to the mirror camera layer
    const hub = this.hub, b = this.body;
    const pose = { head: { position: head, quaternion: this.camera.getWorldQuaternion(new THREE.Quaternion()) }, left: null, right: null, floorY: this.world.player.position.y };
    for (const h of ['left', 'right']) {
      if (hub.mode[h] === 'hand' && hub.features[h].tracked) {
        const f = hub.features[h];
        const p = f.wrist.clone().applyMatrix4(this.world.player.matrixWorld);
        const q = new THREE.Quaternion(f.quat[0], f.quat[1], f.quat[2], f.quat[3]).premultiply(this.world.player.getWorldQuaternion(new THREE.Quaternion()));
        pose[h] = { position: p, quaternion: q };
      } else if (hub.grip[h].valid && hub.mode[h] !== 'desktop') pose[h] = { position: hub.grip[h].pos.clone(), quaternion: hub.grip[h].quat.clone() };
    }
    if (!this.avatar) b.setPose(pose); // (the v3 avatar is posed every frame in _updateHands)
    b.setVisible(this.story.suited || this.state !== 'story');
    // virtual camera: head reflected across the mirror plane, off-axis frustum fitted to the mirror
    const Hm = head.clone().addScaledVector(N, -2 * dist);
    const cam = M.cam;
    cam.position.copy(Hm);
    cam.quaternion.copy(M.root.getWorldQuaternion(_q)); // -Z of mirror root points away from room; camera looks into room
    cam.rotateY(Math.PI);
    cam.updateMatrixWorld(true);
    const local = C.clone().applyMatrix4(cam.matrixWorldInverse);
    const d = -local.z, near = Math.max(0.05, d - 0.02), s = near / d; // near plane ≈ mirror plane: clips the wall/shell behind it
    // in camera space mirror rect: centre local.xy, extents w/2,h/2 (camera axes ∥ mirror axes, x flipped)
    const hw = M.width / 2, hh = M.height / 2;
    cam.projectionMatrix.makePerspective((local.x - hw) * s, (local.x + hw) * s, (local.y + hh) * s, (local.y - hh) * s, near, 60);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    const r = this.renderer, xrOn = r.xr.enabled, prevRT = r.getRenderTarget();
    r.xr.enabled = false;
    M.surface.visible = false;
    const cityShown = this.city.root.visible; if (this._cityShow && !this.city.suspended) this.city.root.visible = this._cityShow.mirror; // the window may be visible only in the mirror
    // with the v3 body visible the mirror shows its own skinned hands → hide the first-person gloves while it renders
    const hideGloves = this.avatar && b.mesh.visible, gloveVis = hideGloves ? ['left', 'right'].map((h) => this.hands[h].root.visible) : null;
    if (hideGloves) for (const h of ['left', 'right']) this.hands[h].root.visible = false;
    // v0.26 mirror-lite: the city seen through the window in the 384×768 mirror skips the rooftop / street detail pools
    // (water towers, trees, lamps, anchor brackets…: ~13 draw calls) — too small to read there
    const lite = settings.mirrorCityLite !== false, poolVis = lite ? [...Object.values(this.city.details), ...Object.values(this.city.art.pools)].map((d) => { const v = d.mesh.visible; d.mesh.visible = false; return v; }) : null;
    const kitG = lite ? [this.city.kit?.root, ...Object.values(this.city.life?.meshes || {}), ...(this.city.art?.extraMeshes || [])].filter(Boolean) : [], kitVis = kitG.map((o) => { const v = o.visible; o.visible = false; return v; }); // v0.30: kit + city life skipped in the mirror too
    r.setRenderTarget(M.rt); r.render(this.scene, cam); r.setRenderTarget(prevRT);
    kitG.forEach((o, i) => { o.visible = kitVis[i]; });
    if (poolVis) [...Object.values(this.city.details), ...Object.values(this.city.art.pools)].forEach((d, i) => { d.mesh.visible = poolVis[i]; });
    if (hideGloves) ['left', 'right'].forEach((h, i) => { this.hands[h].root.visible = gloveVis[i]; });
    this.city.root.visible = cityShown;
    M.surface.visible = true;
    r.xr.enabled = xrOn;
  }

  _buildDamageFlash() {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 8), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, toneMapped: false }));
    m.renderOrder = 99; m.visible = false; this.camera.add(m); return { m, a: 0 };
  }
  flashDamage() { if (this.fx.vfx?.damageEdge()) return; /* v0.30 vfx: view-edge rim + shield crack (flag missBlast) */ this.damageFlash.a = Math.max(this.damageFlash.a, 0.2); } // softer, no strobing when several misses land together
  _updateDamageFlash(dt) { const d = this.damageFlash; d.a = Math.max(0, d.a - dt * 1.2); d.m.material.opacity = d.a; d.m.visible = d.a > 0.01; }

  _updateMinimap() {
    if (this.hud.mode === 'off') return;
    const head = this.camera.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(_q));
    const heading = Math.atan2(fwd.x, -fwd.z); // 0 = north
    const radius = this.worldName === 'factory' ? 30 : this.state === 'arcade' || this.state === 'results' ? 45 : 120;
    // ring city: only buildings around the player (both decks; the upper deck drawn as outlines)
    const tNow = performance.now() / 1000;
    if (!this._mapBuildings || !this._mapAt || tNow > this._mapNext || head.distanceTo(this._mapAt) > 40) {
      this._mapNext = tNow + 0.5; this._mapAt = head.clone();
      const R = radius * 1.6, out = [];
      if (this.worldName === 'world') { this._mapBuildings = this.worldChase.mapBoxes(head, R); } else
      if (this.worldName !== 'city') { this._mapBuildings = this.interior ? this.interior.mapBoxes() : []; } else
      for (const c of this.cityWorld.collidersNear(head.x, head.z, R)) {
        if (!c.base) continue; // one entry per building (base tier)
        out.push({ x: c.x, z: c.z, w: c.hw * 2, d: c.hd * 2, yaw: c.yaw, id: c.id, upper: false, highlight: KEY_BUILDINGS.some((k) => k.id === c.id) });
      }
      this._mapBuildings = out;
    }
    const markers = [];
    if (this.boss.root.visible) markers.push({ kind: 'boss', pos: this.boss.root.position });
    if (this.state === 'story') markers.push(...this.story.mapMarkers());
    if (this.state === 'world') markers.push(...this.worldChase.markers());
    this.hud.setMap({ center: head, heading: -heading, radius, buildings: this._mapBuildings, markers });
  }
}

const app = new App();
app.init().catch((e) => {
  console.error(e);
  const el = document.getElementById('status');
  if (el) { el.textContent = t('err.generic', { msg: e.message }); el.dataset.kind = 'error'; }
});
void getLang; void setLang; void LANGS; void onLangChange; void COLORS; void _m;
