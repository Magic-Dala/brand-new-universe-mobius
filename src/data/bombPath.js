// v1.1 chase pumpkins: the flight path preview and the soft tracking — every tunable in one place.
// The numbers are first guesses tuned in a seeded simulation (tests/bombpath.test.mjs), not on a headset yet.
// Used by ChaseBombs (src/game/chaseBombs.js) and the path ribbon (src/game/bombPathFx.js).
export const BOMB_PATH = {
  tracking: {
    accel: { normal: 12, giant: 6 }, // m/s² of steering per pumpkin kind (the heavy pumpkin tracks at half strength)
    letGo: 0.45, // s before arrival: tracking ends, the rest of the flight is ballistic (a late dodge still works)
    letGoDist: 6, // m from the chest: tracking ends (whichever comes first)
    maxShift: 8, // m: the aim point never moves further than this from the aim at release
  },
  preview: {
    points: 24, // samples per path
    fadeNear: 3.0, // m: nothing is drawn this close to the player's head (the path ends at the player)
    fadeIn: 0.25, // s: after the release the path brightens from its held level to its flying level over this time
    fadeSpan: 2.0, // m beyond fadeNear over which the path fades out toward the player
    width: { normal: 0.10, giant: 0.18 }, // m (must read at 14–60 m on a headset)
    minDeg: 0.12, // deg: never thinner than this as seen from the player (far paths stay readable)
    opacity: { held: 0.55, flying: 0.9 }, // while he winds up / once thrown (comfort mode halves both)
    color: { normal: 0xff8c1a, giant: 0xff4a14 }, // pumpkin orange; the heavy pumpkin's path is redder (never blue, cyan or purple: those are the player's)
    dash: { period: 1.2, speed: 3.0, duty: 0.55 }, // m, m/s (toward the player), lit share: a dash passes a point speed / period = 2.5 times a second (≤ 3)
    maxPaths: 8, // paths drawn at once (a spread of three + one, held and flying)
  },
};
