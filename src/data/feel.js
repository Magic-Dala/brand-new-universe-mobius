// v0.45 feel pass: every tunable number of the new feel systems (impact time warp, Flow meter, speed FX,
// grab-and-pull finisher, designed SFX) in one place. Pure data — no imports.
export const FEEL = {
  warp: {
    counter: { scale: 0.25, hold: 0.25, ease: 0.20 },
    break: { scale: 0.40, hold: 0.15, ease: 0.15 },
    defeat: { scale: 0.20, ease: 0.40 },
    punch: { scale: 0.1, hold: 0.15, ease: 0.3 }, // v0.46: the fly-in hit / a body contact on a staggered boss (v0.49: a near-freeze; was 0.5 / 0.08 / 0.12)
    approach: { dist: 5, scale: 0.25, ease: 0.2 }, // v0.49: the fly-in's last `dist` metres run in slow motion until the hit (ease: back to full speed when it ends with no hit)
    comfort: { holdMul: 0.5, minScale: 0.5 },
    musicCutoff: 700, // Hz at the slowest scale; opens linearly (in log frequency) to 20000 at scale 1
  },
  flow: {
    gains: { pumpkin: 1, block: 1, pull: 1, release: 1, bossHit: 1, counter: 3, fan: 2, punch: 2 },
    thresholds: [4, 10, 18], maxPoints: 24,
    decayDelay: 4, decayRate: 1, styleBase: 100, releaseSpeed: 12,
    beamBright: [0, 0.25, 0.5, 0.8], beamWidth: [0, 0.05, 0.10, 0.15],
    windTint: [0, 0.33, 0.66, 1], // 0 = current cool white, 1 = cyan (r × 0.35, g × 0.9, b × 1)
    musicCutoff: [5000, 9000, 14000, 20000], musicLift: [1, 1, 1.04, 1.1],
  },
  speed: { nearDist: 2.5, nearSpeed: 10, nearGap: 0.6, launchSpeed: 14, tensionAccel: [4, 30], tensionHz: [70, 190], tensionGain: 0.18, comfort: 0.5 },
  finisher: { timeout: 4, yankTime: 0.6, blastTime: 0.8, bonus: 1500, aimDeg: 25 },
  sfx: { maxVoices: 12, pitchJitter: 0.06 },
};
