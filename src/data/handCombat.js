// v0.44 hand play — every tunable of the two hand-tracking features in one place:
//   SHIELD: the palm-facing light-web shield (gesture, body, collision, energy)  → src/input/palmShield.js, src/game/lightShield.js
//   PULL:   pulling an anchored web back to accelerate toward its anchor          → src/input/webPull.js, src/game/locomotion.js
// The Green Maniac side of the pull balance lives with his other pursuit numbers: WORLD_CHASE.pull (src/worlds/worldChase.js).
// Units: metres, seconds, degrees, m/s. Gesture numbers are PLAYER-LOCAL (XR reference space), like gestures.js.
export const SHIELD = {
  // ---- gesture: open hand, palm facing forward, raised in front of the body (all three together)
  openEnter: 0.38, openExit: 0.55, // largest finger curl (index…pinky; 0 straight … 1 curled): below = open. The thumb is free.
  faceEnterDeg: 50, faceExitDeg: 68, // palm normal vs the head's horizontal forward (a forgiving cone, wider to keep)
  heightEnter: -0.5, heightExit: -0.62, // palm height relative to the head (m): a hand hanging at the hip never qualifies
  forwardEnter: 0.2, forwardExit: 0.12, // palm in front of the head along its horizontal forward (m)
  maxSpeedEnter: 1.6, // m/s: a hand still flying (throw follow-through, a wave) does not raise the shield
  enterDwell: 0.14, exitDwell: 0.12, // s the pose must hold before the shield rises / may lapse before it drops (hysteresis in time)
  lostGrace: 0.25, // s of tracking loss the raised shield survives (it never blocks while the hand is not tracked)
  recoverFrames: 6, // tracked frames after a (re)acquisition before the shield may rise
  webLock: 0.45, // s after that hand let go of a web (the hand opens to release — often palm-forward when aiming up): not a shield yet
  bombLock: 0.7, // s after a Light Bomb throw / fizzle / cancel from that hand: opening the hand is not a shield
  fanLock: 0.4, // s after a Fan Web: neither hand raises a shield
  pinchDist: 0.025, // m thumb–index: a pinch (UI select / teleport) is never a shield
  // ---- body: a disc in front of the palm, facing along the palm normal
  radius: 0.36, // m (the drawn disc = the effective area)
  offset: 0.1, // m in front of the palm centre
  pumpkinPad: 0.6, // × the pumpkin's own radius added to the catch radius (its edge clipping the rim still counts)
  standoff: 0.9, // m in front of the disc: from here a pumpkin whose path meets the disc is "held" (its proximity fuse waits)
  maxIncidenceDeg: 78, // paths more grazing than this slide past
  // ---- energy (one pool for both hands)
  energyMax: 100,
  holdDrain: 12, // per second, per raised shield (≈ 8 s of one shield from full)
  blockCost: 24, // per blocked pumpkin
  heavyCost: 60, // per blocked heavy (giant) pumpkin
  regenDelay: 1.0, // s with no shield raised before it recharges
  regen: 18, // per second
  minRaise: 20, // cannot be raised below this
  breakLock: 2.5, // s after running empty (overload) …
  rearmEnergy: 40, // … and it must recharge to this — and the hand must leave the pose — before it rises again
};

export const PULL = {
  // ---- gesture: keep the web pose, pull the hand back toward the body (reach = hand ↔ chest distance, player-local)
  chestDrop: 0.25, // m below the head: the body point the reach is measured from (smoothed, so a head bob is not a pull)
  bodySmooth: 0.2, // s smoothing of that body point
  armReach: 0.32, // m: a stroke can only start with the hand at least this far out (a hand held at the chest never pulls)
  startTravel: 0.015, // m: backward motion smaller than this is tracking jitter
  minTravel: 0.07, // m of backward travel before a stroke counts at all
  fullTravel: 0.26, // m of backward travel for a full-strength stroke (comfortable — no need to yank)
  maxTravel: 0.5, // m: travel beyond this is ignored
  tolDeg: 50, // the hand's path may be this far off the straight line to the chest
  speedShare: 0.2, // share of the strength that depends on speed (capped): a slow full stroke = 80%
  speedLo: 0.3, speedHi: 1.2, // m/s backward hand speed for 0 … 100% of that share
  reverse: 0.035, // m the hand moves forward again → the stroke is over
  stallSpeed: 0.06, stallTime: 0.3, // m/s, s: the hand stopped → the stroke is over (holding it there gives nothing more)
  resetTravel: 0.12, // m the hand must move forward again (clear reset) before the next stroke
  cooldown: 0.3, // s between two strokes (rapid pumping only gets every other stroke)
  maxJump: 0.12, // m of reach change in ONE sample = a tracking jump (re-baselined, never a pull) …
  maxHandSpeed: 6, jumpFloor: 0.04, // … or faster than this (m/s) while moving more than jumpFloor in that sample (frame-time jitter alone never trips it)
  recoverFrames: 6, // tracked frames after a tracking loss; then a forward reset is required first
  flickGuard: 0.35, // s around a stroke's forward reset during which the web "flick re-fire" stays off for that hand
  // ---- effect on the swing
  boost: 5.0, // m/s added toward that hand's anchor by one full-strength stroke (spread over the stroke — an acceleration)
  smooth: 0.12, // s low-pass on the applied impulse (no step in velocity)
  // On a taut rope the automatic retraction (settings.swingReelSpeed) already hauls the body in, and rope tension would
  // cancel a purely radial speed within half a second. So a pull is HELD for a moment: the rope is taken in at the pulled
  // speed on top of the automatic rate, and the tension keeps that inward speed alive. Rope taken in per full stroke
  // ≈ boost × hold (2.5 m) at ≤ boost × budgetMax m/s — the body follows its own speed, so there is no position snap.
  hold: 0.5, // s (exponential) the pulled inward speed is kept up by the rope
  nearFade: [0.5, 4], // m beyond the minimum rope length over which the pull fades in (no slamming into the anchor's wall)
  budgetMax: 1.3, // strokes' worth of strength that can be spent at once (both hands share it)
  bothScale: 0.65, // both hands pulling in the same moment: each counts this much (two webs = 1.3× one, not double)
  budgetRefill: 0.9, // strength per second flowing back (bounds what rapid small strokes can add up to)
  overMax: 3.0, // m/s the swing speed limit may be exceeded by right after pulls (so a pull is felt at full speed too) …
  overShare: 0.6, // … built up by this share of each pull's speed …
  overDecay: 2.0, // … and given back at this rate (m/s per s) — also after letting go, so the momentum carries into the next swing
  comfortScale: 0.6, // comfort mode: gentler pulls and no over-limit
  surgeTau: 2.0, // s: how long a pull counts as a "surge" for Green Maniac's pursuit (he does not match it)
};
