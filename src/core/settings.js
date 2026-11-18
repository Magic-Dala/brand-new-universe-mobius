// Persistent user settings (localStorage, wrapped in try/catch).
const LS_KEY = 'mobius.settings.v1';

export const DEFAULTS = {
  masterVolume: 0.8,
  musicVolume: 0.9,
  sfxVolume: 0.8,
  voiceVolume: 1.0, // v0.28 Green Maniac voice-over
  subtitles: true, // v0.28 voice-over subtitles
  offsetMs: 0, // audio/input offset; + = judge later
  assistMargin: 0.10, // 10% expansion per side (hit zone = 120%)
  aimMode: 'hand', // 'hand' (hand forward: wrist → middle knuckle) | 'palm'
  anchorAssistDeg: 10, // swing-anchor aim tolerance: half-angle of the acceptance cone
  webPitchDeg: 0, // optional tilt of the hand-tracking web direction (negative = downward); v0.5: removed (0)
  arcadeAssistDeg: 5, // arcade: minimum aim tolerance (half-angle) on top of the 10% projected-radius margin (0 = margin only)
  webFlick: true, // arcade/story: while holding the web pose, a quick forward flick fires again
  wallCling: true, // swinging: touching a wall makes the hands stick to it
  wallClimb: true, // while clinging AND facing the wall: grab (fist/grip) and pull to climb
  wallRun: true, // v0.23: touching a wall (not facing it, not looking straight up/down, not at an edge) → run along it
  designedSfx: true, // v0.45: sample-based SFX in front of the synthesized ones (off = v0.44 synth only)
  impactTime: true, // v0.45: impact time warp (World Chase)
  flowMeter: true, // v0.45: Flow meter (World Chase)
  speedFx: true, // v0.45: speed effects (World Chase)
  finisher: true, // v0.45: grab-and-pull finisher (World Chase)
  closeCombat: true, // v0.46: close combat (World Chase): taunt, punch, hit reactions (off = v0.45)
  storyCombat: true, // v0.47: Story chase combat (the stall-and-punch loop, Light Bomb, Fan Web, Flow, samples in Story; off = the v0.46 Story)
  tutorials: true, // v0.49: the Story's tutorial panels (after the radio, after the mirror, after the factory countdown); off = none
  windFx: true, // v0.23: wind streaks + wind sound while swinging fast (comfort mode halves it)
  arcadeAutoAim: true, // arcade: gesture + timing only — the due note is targeted automatically (off = aim + timing)
  // v0.16 arcade lanes / arena (Quest-tunable; metres at 1.6 m eye height — scaled by the player's eye height)
  arcadeLaneSpacing: 0.9, // lateral distance between the three judgement rings
  arcadeLaneHeight: 1.15, // judgement ring height (waist–chest)
  arcadeLaneCenterLift: 0.1, // centre lane a little higher
  arcadeLaneStartSpread: 1.7, // lateral spread of the lanes at Green Maniac's end
  arcadeLaneRise: 1.4, // how much higher the lanes start near the boss
  arcadeLaneWidth: 0.42, // holographic band width (near the player)
  arcadeLaneBandDrop: 0.26, // band sits this far below the bomb path
  arcadeLaneOpacity: 0.9, // guide brightness (kept below webs / hit effects)
  arcadeRingRadius: 0.27, // judgement ring radius
  arcadeStrikeDistance: 4.2, // judgement ring distance in front of the player
  arcadeBossDistance: 16.5, // Green Maniac hover distance (15–18 m)
  arcadeBossHeight: 4.4, // hover height above the floor
  arcadeBossScale: 0.55, // Green Maniac + Green Bat Jet scale in the arcade battle (smaller than before)
  storyBossScale: 0.9, // v0.31b: Green Maniac + Green Bat Jet size in the city / roof story (user: 10% smaller)
  roofKnockExtra: 1.0, // v0.31b: m added to the roof kick-off knockback (user: he landed too close to Mobius)
  arcadeTravelSec: 0, // bomb flight time override (s); 0 = the chart's travelSec per difficulty
  noFail: false,
  haptics: true,
  snapAngle: 45,
  vignette: true,
  shortFall: false, // story roof blast: shorter scripted fall (≈2 m instead of ≈6 m) before the fade
  // ---- v0.20 city swinging (Quest-tunable; city layout / streaming / corridor live in src/data/cityConfig.js)
  swingSpeedLimit: 18, // m/s maximum speed (comfort mode × 0.75)
  swingAccel: 2.0, // m/s² swing assist along the swing / look direction ("acceleration")
  swingDrag: 0.05, // 1/s air drag ("deceleration")
  swingAssist: 1.0, // overall assist strength (scales the swing assist + look steering), 0 = pure pendulum
  webMaxLength: 60, // m web (rope) length limit
  anchorMaxDist: 60, // m anchor reach
  anchorMinDist: 3, // m
  anchorMinElevDeg: -25, // anchors further below the hand than this are not offered
  anchorAssistMargin: 0.0, // anchor aim assist (independent of the pumpkin-bomb assistMargin)
  releaseBoost: 1.6, // m/s added when letting go mid-swing (forward / up) — carries the momentum
  thrusterAssist: true, // back-pack thrusters cap the fall speed when no web is attached
  thrusterMaxFall: 11, // m/s
  fallRecoverSec: 10, // v0.22c: only a continuous fall with no anchor grabbed this long returns to the last checkpoint
  comfortMode: false, // slower, stronger vignette, gentler steering, no release boost
  devPerf: false, // dev: performance overlay (FPS, draw calls, triangles, modules, anchors, pools)
  devFanDebug: false, // dev: Fan Web gesture overlay (open / fist / palm-up / upright / contact / state)
  cityQ: 'v1', // v0.25 city look: 'v1' new (stage 0/1 upgrade) | 'v0' the original v0.24 look (A/B comparison)
  xrMultiview: 'auto', // v0.27: 'auto' = three uses OCULUS_multiview when the browser has it (projection layer) | 'off' = A/B baseline (next VR entry)
  xrFoveation: 1, // v0.27: fixed foveation 0…1 (applied live; 1 = max, the previous hard-coded value)
  cityAmbience: true, // v0.27: city traffic rumble + distant horns (fades with height; muffled in the room)
  mirrorCityLite: true, // v0.26: the room mirror skips the city detail pools (water towers, trees, lamps, brackets) — fewer draw calls
  vfxOff: [], // v0.30: new VFX families turned off one by one (old v0.29 look) — see src/game/vfx/vfxFlags.js
  factoryQ: 'v1', // v0.31 factory interior: 'v1' the rebuild (default since v0.43) | 'v0' the old v0.30 hall (still selectable: ?fq=0 or dev settings)
  factoryQOff: [], // v0.31: features turned off one by one (probe, streaks, cones, dust, sway, props, lmfull, life) — src/art/factoryQuality.js
  cityQOff: [], // v0.25: v1 features turned off one by one (win, ground, var, ao, shade, tex) — see src/art/cityQuality.js
  swingReelSpeed: 7, // m/s automatic rope retraction while swinging (v0.44: unchanged on purpose — the route regression bots depend on it; pulling the web by hand adds its own rope take-in + speed, see PULL in src/data/handCombat.js)
  webPull: true, // v0.44: pull an anchored web's hand back toward the body to accelerate toward that anchor
  bombPath: true, // v1.1: chase pumpkins show their flight path (held and in flight; Story chase / World Chase)
  bombTracking: true, // v1.1: chase pumpkins track the player a little in flight (off = the v1.0 ballistic flight)
  palmShield: true, // v0.44: open hand, palm forward, raised = light-web shield (Story chase / World Chase; not the Arcade)
  swingMinRope: 5, // rope never shorter than this (m)
  swingSteer: true, // swinging: horizontal motion turns toward where the headset looks
  swingSteerRate: 110, // deg/s turn rate toward the look direction while on a web (air: 40%)
  renderScale: 0.9, // XR framebuffer scale (applied when entering VR): 0.9 ≈ 19% fewer pixels, smoother on Quest
  seated: false,
  seatedOffset: 0.45, // metres added to eye height in seated mode
  thumbFallback: false,
  hudIntensity: 0.85,
  devTools: false,
  // Judgement windows (seconds, ±). Tunable in dev panel.
  perfectWindow: 0.075,
  goodWindow: 0.16,
  difficulty: 'normal',
  songId: 'mobius-boss-01',
};

/**
 * v0.48 dev switches of the Arcade. They live beside DEFAULTS, not in it: tests/factory-layout-golden.test.mjs hashes
 * every DEFAULTS key that starts with "arcade" (the lane and boss layout), and that test must pass unchanged.
 */
export const ARCADE_SWITCHES = {
  arcadeShow: true, // the Arcade hall pulses on the beat and follows the combo, combo sounds (off = the hall as in v0.46)
  arcadeArmored: true, // armored pumpkins and the energy wave (off = the armored events are dropped when the chart loads: the v0.46 event count)
};
let current = { ...DEFAULTS, ...ARCADE_SWITCHES };
try {
  const raw = localStorage.getItem(LS_KEY);
  if (raw) current = { ...DEFAULTS, ...ARCADE_SWITCHES, ...JSON.parse(raw) };
} catch { /* ignore */ }

// v0.2: web aim moved from palm normal to the index+pinky direction
// v0.3: web aim = hand forward (wrist → middle knuckle)
if (current.aimMode !== 'hand' && current.aimMode !== 'palm') current.aimMode = 'hand';
if ((current._aimMigrated || 0) < 3) { current.aimMode = 'hand'; current._aimMigrated = 3; }
if ((current._aimMigrated || 0) < 5) { current.webPitchDeg = 0; current._aimMigrated = 5; } // v0.5: −15° tilt removed
if ((current._aimMigrated || 0) < 6) { current.arcadeAssistDeg = 5; current._aimMigrated = 6; }
if ((current._aimMigrated || 0) < 7) { current.arcadeAutoAim = true; current._aimMigrated = 7; } // v0.17: auto-aim back on by default
if ((current._aimMigrated || 0) < 8) { current.swingSpeedLimit = DEFAULTS.swingSpeedLimit; current._aimMigrated = 8; } // v0.20: city-scale swing speed
if ((current._factoryMigrated || 0) < 1) { current.factoryQ = 'v1'; current._factoryMigrated = 1; } // v0.43: the new factory interior becomes the default once (saved settings from before stored 'v0')

const listeners = new Set();
export const settings = new Proxy(current, {
  set(obj, k, v) {
    obj[k] = v;
    try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch { /* ignore */ }
    listeners.forEach((f) => f(k, v));
    return true;
  },
});
export const onSettingsChange = (f) => (listeners.add(f), () => listeners.delete(f));
export function resetSettings() {
  for (const k of Object.keys(DEFAULTS)) if (k !== 'songId') settings[k] = DEFAULTS[k];
  for (const k of Object.keys(ARCADE_SWITCHES)) settings[k] = ARCADE_SWITCHES[k];
}

// Best scores
const BEST_KEY = 'mobius.best.v1';
export function getBest(songId, diff) {
  try { return JSON.parse(localStorage.getItem(BEST_KEY) || '{}')[`${songId}:${diff}`] || null; } catch { return null; }
}
export function setBest(songId, diff, rec) {
  try {
    const all = JSON.parse(localStorage.getItem(BEST_KEY) || '{}');
    all[`${songId}:${diff}`] = rec;
    localStorage.setItem(BEST_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}
