// v0.47 Story chase combat (home window → factory roof, and the chase after the factory): every new number.
// Pure data, no imports. The Story reads World Chase's FIGHT / CHASE_COMBAT / CLOSE / FEEL values and never edits them.
// Seconds, metres, metres per second. Read by src/game/stumble.js, storyAttacks.js, storyCombat.js, chase.js, endless.js.
export const STORY_CHASE = {
  // pressure: the hidden number that stalls his jet (the jet's smoke is its only indicator)
  //   web / pumpkin / lightBomb: points per web strike on him / pumpkin destroyed / Light Bomb blast that reaches him
  //   webInterval: at most one counted web strike per this long; threshold: he stalls; decay: rate per second after decayDelay
  //   without a gain; playerHit: added (negative) when a pumpkin blast reaches the player
  //   (threshold: the design's call was 8; tuned to 6 in stage S6, see docs/goals/v047-log.md)
  pressure: { web: 1, pumpkin: 1, lightBomb: 3, webInterval: 0.6, threshold: 6, decayDelay: 3, decayRate: 0.5, playerHit: -2 },
  // stall: its length, his speed cap during it, how long pressure cannot build after it, and the red ring's range along the route
  //   (the design's calls were time 4, speedCap 8, lockout 6; tuned in S6: at 8 m/s a stalled jet could not be reached from his
  //   30 m lead inside the stall, so a player below about 12 m/s never landed a punch)
  stall: { time: 6, speedCap: 3, lockout: 5, ringRange: 15 },
  // pacing: outside a stall he matches a faster player so the gap stays at minGap or more; noPass is the last-resort clamp;
  // boost: extra speed while he breaks away (lockout) until he has his lead back
  pacing: { minGap: 14, noPass: 1.5, boost: 6 },
  // attack tiers: tier 2 from this route tile (0-based), tier 3 once the player has passed the right turn; each punch adds one
  tiers: { tier2Tile: 2, tier3: 'afterTurn', max: 3 },
  // no new throw within nearTurn of the right turn or once he is within beforeRoof of the roof
  noThrow: { nearTurn: 45, beforeRoof: 25 },
  // a pumpkin blast that reaches the player: share of horizontal speed lost, push away from the blast
  player: { speedLoss: 0.4, push: 3 },
  coinBurst: 8, // Bitcoins a punch knocks out of him
  endless: { startTier: 2 }, // the chase after the factory starts here
  summaryTime: 5, // the run summary stays this long when free swinging starts
};
