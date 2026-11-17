// v0.45 designed SFX manifest: audio.play name → { files (in public/audio/sfx/), gain, pitch? (jitter override), falloff? (false = positional pan, no distance attenuation) }.
// All files are normalized to -16 LUFS, so `gain` is the mix: boomEnemy / boomBlue / bossHit are the reference (1.0).
// Names without an entry (heavyWindup, flowUp) — or whose files failed to load — play the synthesized sound in
// src/core/audio.js; bossHit / stagger / release / heavyWindup play their v0.44 sound instead (V044_ALIAS there). Samples play in World Chase only (audio.useBank flag).
export const SFX_MANIFEST = {
  boomEnemy: { files: ['boomEnemy-1.mp3'], gain: 1.0 },
  boomBlue: { files: ['boomBlue-1.mp3'], gain: 1.0 },
  bossHit: { files: ['bossHit-1.mp3'], gain: 1.0, falloff: false }, // full level at the boss's 26 m lead, like v0.44's boom
  webHit: { files: ['webHit-1.mp3'], gain: 0.8 },
  shieldHit: { files: ['shieldHit-1.mp3'], gain: 0.8 },
  throw: { files: ['throw-1.mp3'], gain: 0.8 },
  attach: { files: ['attach-1.mp3'], gain: 0.6 },
  release: { files: ['release-1.mp3'], gain: 0.6 },
  pull: { files: ['pull-1.mp3'], gain: 0.6 },
  shieldOn: { files: ['shieldOn-1.mp3'], gain: 0.6 },
  stagger: { files: ['stagger-1.mp3'], gain: 1.0, falloff: false }, // boss feedback, like bossHit
  finisherYank: { files: ['finisherYank-1.mp3'], gain: 1.0, falloff: false },
  shieldBreak: { files: ['shieldBreak-1.mp3'], gain: 0.8 },
  whoosh: { files: ['whoosh-1.mp3'], gain: 0.6 },
  launch: { files: ['launch-1.mp3'], gain: 0.6 },
  coin: { files: ['coin-1.mp3'], gain: 0.4 },
  web: { files: ['web-1.mp3', 'web-2.mp3'], gain: 0.5 }, // ~6 dB under boomEnemy
};

// v0.47 Story chase combat: the Story's own samples (same folder, same processing, prompts in docs/goals/v047-sfx-prompts.md).
// A second export on purpose: SFX_MANIFEST above is what World Chase plays and stays as it was. audio.js consults this one
// first only while audio.useStory is on (Story with settings.storyCombat), so `punch`, `flowUp` and `heavyWindup` keep their
// v0.46 sound in World Chase. A name without an entry here plays the World Chase sample or the synthesized sound.
// Not yet auditioned: remove an entry to fall back.
export const SFX_MANIFEST_STORY = {
  jetStall: { files: ['jetStall-1.mp3', 'jetStall-2.mp3'], gain: 1.0, falloff: false }, // boss feedback, like stagger: full level at his lead
  jetRecover: { files: ['jetRecover-1.mp3'], gain: 0.8, falloff: false },
  heavyWindup: { files: ['heavyWindup-1.mp3'], gain: 0.8, falloff: false },
  flowUp: { files: ['flowUp-1.mp3'], gain: 0.5 },
  playerHit: { files: ['playerHit-1.mp3'], gain: 0.9 },
  punch: { files: ['punch-1.mp3'], gain: 1.0, falloff: false }, // the reward moment: full level
  coinBurst: { files: ['coinBurst-1.mp3'], gain: 0.5 },
  // more variations of the most-heard names (design 4.5): the World Chase files plus new takes, heard in Story only
  // (attach: both new takes came out as faint clicks and were left out, so Story plays the World Chase attach-1)
  web: { files: ['web-1.mp3', 'web-2.mp3', 'web-3.mp3', 'web-4.mp3'], gain: 0.5 },
  webHit: { files: ['webHit-1.mp3', 'webHit-2.mp3', 'webHit-3.mp3'], gain: 0.8 },
  boomEnemy: { files: ['boomEnemy-1.mp3', 'boomEnemy-2.mp3', 'boomEnemy-3.mp3'], gain: 1.0 },
  release: { files: ['release-1.mp3', 'release-2.mp3', 'release-3.mp3'], gain: 0.6 },
  throw: { files: ['throw-1.mp3', 'throw-2.mp3', 'throw-3.mp3'], gain: 0.8 },
};

// v0.48: the Arcade's own designed samples. A third export on purpose: World Chase (SFX_MANIFEST) and Story
// (SFX_MANIFEST_STORY) stay as they were. audio.js consults this one only while audio.useArcade is on. A name without an
// entry here plays the World Chase sample of that name, or the synthesized sound in src/core/audio.js.
// Stings are unpitched so they fit any song. comboUp1…3 and shellCrack1…3 are the rising steps.
export const SFX_MANIFEST_ARCADE = {
  // (no files yet: every v0.48 name plays its synthesized sound; prompts in docs/goals/v048-sfx-prompts.md)
};
