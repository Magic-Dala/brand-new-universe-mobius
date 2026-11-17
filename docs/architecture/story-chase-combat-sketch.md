# Story chase combat: architecture sketch (v0.47)

Design: `docs/superpowers/specs/2026-11-14-story-arcade-rework-design.md` sections 4 and 5 (approved, fixed).
Transcription in the kit's format: `design/gdd/story-chase-combat.md`. Plan: `docs/superpowers/plans/2026-11-14-story-combat.md`.
This is the gameplay programmer's sketch for `/team-combat` phase 2. It records how the code is cut, not what the design is.
Nothing here was verified on a Quest 3.

## Modules

| File | Kind | Owns |
|---|---|---|
| `src/data/storyChase.js` | data | every new number (`STORY_CHASE`) |
| `src/game/stumble.js` | pure | pressure, stall, lockout, punches, tier. No three.js, no defeated state |
| `src/game/storyAttacks.js` | pure | the throw scheduler (`StoryAttacks`), `segmentTier`, `throwWindow`, `pacedSpeed`, `holdS`, `hitVelocity` |
| `src/game/storyCombat.js` | wiring | one `StoryCombat` for both chases: pools, input, effects, sound, HUD data |
| `src/game/chase.js` | host | first chase: adapter, pacing hook, web routing, ring |
| `src/game/endless.js` | host | chase after the factory: adapter, pacing hook, web routing, escape, summary |

Reused by import, unchanged: `selectTarget`, `shotIntent`, `webAtBoss`, `rebound`, `segPointDist` (`chaseCombat.js`, `closeRange.js`),
`ChaseLightBombs`, `Lunge`, `ReactionGate`, `pickReaction`, `Flow`, `TimeWarp`, `FanWebFx`, `ChaseBombs`, `chooseAttack` and the `FIGHT` numbers.
`worldChase.js` is not imported and not changed; the few lines it inlines (aim cone test, impact burst choice) are duplicated in `storyCombat.js`.

## The host adapter

`StoryCombat.begin(host, { tier })` takes a plain object from the chase that owns it:

```
kind            'chase' | 'endless'
world           the city world (segmentBlocked / pointBlocked for line of sight)
bossS()         his arc length on the route
playerS()       the player's (capped at maxS + 10, as the pacing already does)
gap()           bossS - playerS
segmentTier()   1..3 from the route (first chase) or the start tier (after the factory)
throwsAllowed() the no-throw zones
active()        the loop may act this frame (not the room, the fly-by, the roof, the escape)
capBossSpeed(v) the stall cap, 0 during a fly-in, null for none
jetDamage       the jet's resting damage look
```

The combat never moves Green Maniac along the route. The host keeps its own pacing and asks `combat.bossSpeed(base, gap, playerSpeed, lead)`
for the speed, then applies `holdS` (the 1.5 m last resort). That keeps `chase.js` and `endless.js` the only writers of `bossS`.

## Frame order

```
main.js     timeWarp → simDt (Story stages chase and endless included when the switch is on)
story.js    _s_chase / _s_endless(simDt, time, realDt)
host        route progress → webs (combat.onWeb first) → combat.update(dt, realDt, tNow) → boss pacing → ring
combat      geometry → aim lock → Fan Web → fly-in → body contact → Light Bombs → stumble events → jet web
            → his attacks → pumpkins → Flow → jet damage look → speed cap → HUD data
```

Head pose, hands, HUD timers, fades and voice use real time; everything in `combat.update` that is gameplay uses the scaled step.

## Switch

`settings.storyCombat` (dev menu, default on). Each host checks it every frame, so flipping it mid-chase starts or stops the loop on that frame.
Off: neither host calls into `StoryCombat`, `audio.useBank` is false in Story, the old tether, counter and `tryShoot` run. The pools are only
built when a Story run starts with the switch on.

## No shader compiles during play

`StoryCombat.prepare()` builds every pool at Story start; `compile()` runs `renderer.compile` over them (each pumpkin highlight level,
both Fan Web materials) and over what the chase first shows mid-run (pooled effects, arrival circle, marker, ring, Bitcoins, camera-attached meshes).
`tests/e2e/storycombat.e2e.mjs` and `tests/e2e/v030-compile.e2e.mjs` count programs.

## Sound

Protected `tests/sfx.test.mjs` fixes `SFX_MANIFEST` at 17 names and `audio.play('heavyWindup')` silent without a sample. So the Story's
new samples live in a second export `SFX_MANIFEST_STORY`, and the heavy wind-up falls back through `audio.playOr('heavyWindup', 'heavyWindupStory')`.

## Not built here

Boss health, shield, core, vent, finisher, player health, defeat, results panel, run clock, per-map bests (design 4.4 "Not moved").
